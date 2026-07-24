use criterion::{Criterion, black_box, criterion_group, criterion_main};
use pi_ast::{
	SupportLang,
	block::{BlockRangeOptions, block_range_at},
	ops::{compile_pattern, resolve_strictness},
};

const RUST_SOURCE: &str = r#"use std::collections::HashMap;

fn main() {
    let mut map = HashMap::new();
    map.insert("key", 42);
    if let Some(value) = map.get("key") {
        println!("{value}");
    }
    let result = match value {
        0 => "zero",
        1 => "one",
        _ => "many",
    };
    for (k, v) in &map {
        println!("{k}: {v}");
    }
}

struct Container<T> {
    inner: Vec<T>,
}

impl<T> Container<T> {
    fn push(&mut self, item: T) {
        self.inner.push(item);
    }
}
"#;

fn bench_block_range_at(c: &mut Criterion) {
	let source = RUST_SOURCE.to_string();
	let lang = "rust".to_string();
	c.bench_function("block_range_at_rust", |b| {
		b.iter(|| {
			let opts = BlockRangeOptions {
				code: source.clone(),
				lang: Some(lang.clone()),
				path: None,
				line: 5, // line of `fn main() {`
			};
			let result = block_range_at(opts).unwrap();
			black_box(result);
		});
	});
}

fn bench_compile_pattern(c: &mut Criterion) {
	let strictness = resolve_strictness(None);
	let lang = SupportLang::Rust;
	c.bench_function("compile_pattern_rust", |b| {
		b.iter(|| {
			let pattern = compile_pattern(
				black_box("fn $NAME($$$ARGS) { $$$BODY }"),
				None,
				black_box(&strictness),
				lang,
			)
			.unwrap();
			black_box(pattern);
		});
	});
}

criterion_group!(benches, bench_block_range_at, bench_compile_pattern);
criterion_main!(benches);
