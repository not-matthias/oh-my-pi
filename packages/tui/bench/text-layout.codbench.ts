/**
 * CodSpeed/tinybench variant of `text-layout.ts`.
 *
 * One task per text-layout primitive over a representative sample set (plain,
 * ANSI, wide/CJK, hyperlinks, wrapped). Six tasks:
 *   - visibleWidth        — terminal display width (plain + ansi).
 *   - truncateToWidth     — width-bounded truncation with unicode ellipsis.
 *   - wrapTextWithAnsi    — ANSI-aware line wrapping.
 *   - sliceWithWidth      — visible-width slice preserving ANSI state.
 *   - extractSegments     — visible-width segment extraction.
 *   - matchesKey          — key-sequence matching across modifier combos.
 *
 * Warmup and iteration counts are left to tinybench.
 */
import { visibleWidth, wrapTextWithAnsi, truncateToWidth, sliceWithWidth, extractSegments, Ellipsis } from "../src/utils";
import { matchesKey } from "../src/keys";
import { createBench } from "../../../bench/codspeed";

const samples = {
	plain: "hello world this is a plain ASCII string with some words",
	ansi: "\x1b[31mred text\x1b[0m and \x1b[4munderlined content\x1b[24m with emoji 😅😅",
	links: "prefix \x1b]8;;https://example.com\x07link\x1b]8;;\x07 suffix",
	wide: "日本語のテキストとemoji 🚀✨ mixed with ascii",
	wrapped: "This is a long line that should wrap multiple times when rendered with ANSI \x1b[32mcolors\x1b[0m and tabs\tbetween words.",
};

const wrapWidth = 40;

const bench = createBench();

bench.add("visibleWidth", () => {
	visibleWidth(samples.plain);
	visibleWidth(samples.ansi);
});

bench.add("truncateToWidth", () => {
	truncateToWidth(samples.ansi, 32, Ellipsis.Unicode, true);
});

bench.add("wrapTextWithAnsi", () => {
	wrapTextWithAnsi(samples.wrapped, wrapWidth);
});

bench.add("sliceWithWidth", () => {
	sliceWithWidth(samples.ansi, 3, 18, true);
});

bench.add("extractSegments", () => {
	extractSegments(samples.ansi, 10, 20, 15, true);
});

bench.add("matchesKey", () => {
	matchesKey("\x1b[A", "up");
	matchesKey("\x1b[1;5C", "ctrl+right");
	matchesKey("\x1b[1;2D", "shift+left");
});

await bench.run();
console.table(bench.table());
