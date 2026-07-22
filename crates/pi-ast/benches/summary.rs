//! CodSpeed benchmarks for `pi-ast`'s tree-sitter powered structural analysis.
//!
//! These exercise the two CPU-bound public entry points that back the
//! hashline `summary` and `replace block N:` operators:
//!
//! - [`pi_ast::summary::summarize_code`] — parse source and emit a folded
//!   structural summary.
//! - [`pi_ast::block::block_range_at`] — parse source and resolve the block
//!   that begins on a given line.
//!
//! Both are dominated by tree-sitter parsing plus AST traversal, so they are
//! deterministic and a good fit for CodSpeed's simulation instrument.

use pi_ast::{
	block::{BlockRangeOptions, block_range_at},
	summary::{SummaryOptions, summarize_code},
};

fn main() {
	divan::main();
}

/// A representative Rust source sample with nested items, functions and
/// comments so the elision/fold machinery has real work to do. Repeated to
/// give the parser a non-trivial input size.
fn rust_source() -> String {
	const UNIT: &str = r#"
/// A small cache keyed by string identifiers.
///
/// This doc comment is intentionally several lines long so the comment
/// elision path in `summarize_code` has something to fold. It describes the
/// invariants that callers must uphold when interacting with the cache.
pub struct Cache {
    entries: std::collections::HashMap<String, Vec<u8>>,
    capacity: usize,
}

impl Cache {
    pub fn new(capacity: usize) -> Self {
        Self {
            entries: std::collections::HashMap::new(),
            capacity,
        }
    }

    pub fn insert(&mut self, key: String, value: Vec<u8>) -> Option<Vec<u8>> {
        if self.entries.len() >= self.capacity {
            if let Some(first) = self.entries.keys().next().cloned() {
                self.entries.remove(&first);
            }
        }
        self.entries.insert(key, value)
    }

    pub fn get(&self, key: &str) -> Option<&Vec<u8>> {
        self.entries.get(key)
    }

    pub fn summarize(&self) -> usize {
        let mut total = 0usize;
        for (name, bytes) in &self.entries {
            if !name.is_empty() {
                total = total.saturating_add(bytes.len());
            }
        }
        total
    }
}

fn helper(values: &[i64]) -> i64 {
    values
        .iter()
        .copied()
        .filter(|value| *value % 2 == 0)
        .map(|value| value * value)
        .sum()
}
"#;
	UNIT.repeat(12)
}

/// A representative TypeScript source sample: classes, interfaces, generics
/// and functions, again repeated for a realistic size.
fn typescript_source() -> String {
	const UNIT: &str = r#"
/**
 * A tiny event emitter used across the codebase.
 *
 * The doc block is deliberately verbose so the comment-folding branch of the
 * summarizer is exercised on the TypeScript grammar as well as Rust.
 */
interface Listener<T> {
    (event: T): void;
}

export class Emitter<T> {
    private listeners: Array<Listener<T>> = [];

    public on(listener: Listener<T>): () => void {
        this.listeners.push(listener);
        return () => {
            const index = this.listeners.indexOf(listener);
            if (index >= 0) {
                this.listeners.splice(index, 1);
            }
        };
    }

    public emit(event: T): void {
        for (const listener of this.listeners) {
            listener(event);
        }
    }
}

export function partition<T>(items: readonly T[], predicate: (item: T) => boolean): [T[], T[]] {
    const yes: T[] = [];
    const no: T[] = [];
    for (const item of items) {
        if (predicate(item)) {
            yes.push(item);
        } else {
            no.push(item);
        }
    }
    return [yes, no];
}
"#;
	UNIT.repeat(12)
}

/// Baseline summary: fold only the outermost elidable spans (no BFS unfold).
#[divan::bench]
fn summarize_rust(bencher: divan::Bencher) {
	let code = rust_source();
	bencher.with_inputs(|| code.clone()).bench_values(|code| {
		divan::black_box(summarize_code(SummaryOptions {
			code,
			lang: Some("rust".to_string()),
			path: None,
			min_body_lines: None,
			min_comment_lines: None,
			unfold_until_lines: None,
			unfold_limit_lines: None,
		}))
		.unwrap()
	});
}

/// Summary with progressive BFS unfolding enabled — exercises the
/// `select_folded_spans` traversal on top of parsing.
#[divan::bench]
fn summarize_rust_unfold(bencher: divan::Bencher) {
	let code = rust_source();
	bencher.with_inputs(|| code.clone()).bench_values(|code| {
		divan::black_box(summarize_code(SummaryOptions {
			code,
			lang: Some("rust".to_string()),
			path: None,
			min_body_lines: None,
			min_comment_lines: None,
			unfold_until_lines: Some(80),
			unfold_limit_lines: Some(160),
		}))
		.unwrap()
	});
}

/// Summary of TypeScript source, resolving the language by file path.
#[divan::bench]
fn summarize_typescript(bencher: divan::Bencher) {
	let code = typescript_source();
	bencher.with_inputs(|| code.clone()).bench_values(|code| {
		divan::black_box(summarize_code(SummaryOptions {
			code,
			lang: None,
			path: Some("emitter.ts".to_string()),
			min_body_lines: None,
			min_comment_lines: None,
			unfold_until_lines: None,
			unfold_limit_lines: None,
		}))
		.unwrap()
	});
}

/// Resolve the block that begins on a mid-file line of the Rust sample.
#[divan::bench]
fn block_range_rust(bencher: divan::Bencher) {
	let code = rust_source();
	bencher.with_inputs(|| code.clone()).bench_values(|code| {
		divan::black_box(block_range_at(BlockRangeOptions {
			code,
			lang: Some("rust".to_string()),
			path: None,
			line: 7,
		}))
		.unwrap()
	});
}
