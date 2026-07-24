use std::{
	fs,
	path::PathBuf,
	sync::LazyLock,
	time::{SystemTime, UNIX_EPOCH},
};

use criterion::{Criterion, black_box, criterion_group, criterion_main};
use pi_walker::{WalkDetail, WalkFilter, WalkRequest};

const DIRECTORY_FANOUT: [usize; 5] = [5, 5, 5, 4, 2];
const CONTENT_FILE_COUNT: usize = 15_000;
const NODE_MODULES_PACKAGES: usize = 50;
const NODE_MODULES_FILES_PER_PACKAGE: usize = 10;

static SYNTHETIC_ROOT: LazyLock<PathBuf> = LazyLock::new(build_synthetic_tree);

fn bench_collect_file_candidates_gitignore(c: &mut Criterion) {
	let root = SYNTHETIC_ROOT.as_path();
	c.bench_function("collect_file_candidates_gitignore", |b| {
		b.iter(|| {
			let req = WalkRequest::new(root)
				.hidden(true)
				.gitignore(true)
				.detail(WalkDetail::Minimal);
			let candidates = req.collect_file_candidates().unwrap();
			black_box(candidates.len());
		});
	});
}

fn bench_collect_files_full_detail(c: &mut Criterion) {
	let root = SYNTHETIC_ROOT.as_path();
	c.bench_function("collect_files_full_detail", |b| {
		b.iter(|| {
			let req = WalkRequest::new(root)
				.hidden(true)
				.gitignore(true)
				.detail(WalkDetail::Full)
				.filter(WalkFilter::files_only());
			let files = req.collect_files().unwrap();
			black_box(files.len());
		});
	});
}

fn build_synthetic_tree() -> PathBuf {
	let root = unique_temp_root("pi-walker-bench");
	fs::create_dir_all(&root).expect("create synthetic root");
	fs::create_dir_all(root.join(".git")).expect("create repo marker");

	let mut directories = vec![root.clone()];
	let mut level = vec![root.clone()];
	for (depth, fanout) in DIRECTORY_FANOUT.iter().enumerate() {
		let mut next_level = Vec::with_capacity(level.len() * fanout);
		for (parent_index, parent) in level.iter().enumerate() {
			for child in 0..*fanout {
				let dir = parent.join(format!("d{depth:02}-{parent_index:04}-{child:02}"));
				fs::create_dir_all(&dir).expect("create synthetic directory");
				directories.push(dir.clone());
				next_level.push(dir);
			}
		}
		level = next_level;
	}

	for (i, dir) in directories.iter().enumerate() {
		if i.is_multiple_of(10) {
			fs::write(dir.join(".gitignore"), format!("/ignored-{i:04}-*.txt\n"))
				.expect("write gitignore");
		}
	}

	for file_index in 0..CONTENT_FILE_COUNT {
		let dir_id = file_index % directories.len();
		let local = file_index / directories.len();
		let name = if dir_id.is_multiple_of(10) && local == 0 {
			format!("ignored-{dir_id:04}-{local:03}.txt")
		} else {
			format!("file-{dir_id:04}-{local:03}.txt")
		};
		let path = directories[dir_id].join(name);
		let mut content = String::with_capacity(512);
		content.push_str(&format!("line {file_index:05} deterministic pi walker payload\n"));
		let filler = format!("line {file_index:05} deterministic pi walker payload text\n");
		while content.len() < 512 + (file_index * 73) % 3_488 {
			content.push_str(&filler);
		}
		fs::write(path, content).expect("write content file");
	}

	let node_modules = root.join("node_modules");
	for package in 0..NODE_MODULES_PACKAGES {
		let package_dir = node_modules.join(format!("pkg-{package:02}"));
		fs::create_dir_all(&package_dir).expect("create node_modules package");
		for file in 0..NODE_MODULES_FILES_PER_PACKAGE {
			let path = package_dir.join(format!("file-{file:02}.js"));
			fs::write(path, "module.exports = {};\n").expect("write node_modules file");
		}
	}

	root
}

fn unique_temp_root(prefix: &str) -> PathBuf {
	let ts = SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.expect("system time")
		.as_nanos();
	let pid = std::process::id();
	std::env::temp_dir().join(format!("{prefix}-{pid}-{ts}"))
}

criterion_group!(benches, bench_collect_file_candidates_gitignore, bench_collect_files_full_detail);
criterion_main!(benches);
