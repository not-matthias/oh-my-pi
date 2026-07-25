/**
 * CodSpeed/tinybench variant of `streaming-throughput.bench.ts`.
 *
 * Mirrors `StreamingRevealController`'s per-tick work: re-count the visible
 * units of the target (memoized `BlockUnitCounter.count`) and rebuild the
 * display message (`buildDisplayMessage`), which slices each text block to the
 * revealed prefix. One `BlockUnitCounter` is created per episode and shared by
 * `countOf` + `sliceOf`, exactly as the controller holds one `#unitCounter` per
 * streaming episode.
 *
 * One tinybench task drives a full reveal episode (initial render at revealed=0
 * then the `nextStep` catch-up loop) against a representative large assistant
 * message. Warmup and iteration counts are left to tinybench.
 */
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { BlockUnitCounter, buildDisplayMessage, nextStep } from "../src/modes/controllers/streaming-reveal";
import { createBench } from "../../../bench/codspeed";

const HIDE_THINKING = false;
const PROSE_ONLY = true;

/** Prose + code + accented text + multibyte grapheme clusters (ZWJ families,
 *  flag sequences, skin-tone modifiers, CJK), representative of LLM output that
 *  makes Intl.Segmenter do real per-cluster work. */
const CHUNK = `Here is an overview of the rendering pipeline changes.

The streaming reveal controller now advances the revealed prefix each tick. Consider the helper:

\`\`\`ts
function sliceToUnits(text: string, units: number): string {
\tlet end = 0;
\tfor (const { index, segment } of segmenter.segment(text)) {
\t\tif (--units < 0) break;
\t\tend = index + segment.length;
\t}
\treturn text.slice(0, end);
}
\`\`\`

This handles café, naïve résumés, and emoji clusters like the 👨‍👩‍👧‍👦 family, the 🏳️‍🌈 flag, and the 👩🏽 skin-tone modifier. CJK text such as 日本語のテスト also segments correctly, and the heart ❤️ beats steadily. Each grapheme cluster is one user-perceived character: "👨‍👩‍👧‍👦" is a single unit, not seven code points. The decomposed sequence e followed by a combining acute accent (e + \\u0301) is likewise a single cluster, distinct from the precomposed form.

The adaptive step is \`nextStep = max(3, ceil(backlog / 8))\`, so the tick count stays roughly constant while the per-tick slice cost grows with the rendered prefix. Incremental slicing lowers that per-update cost from the prefix length to the per-step delta.

`;

function makeMessage(textBlocks: string[]): AssistantMessage {
	return {
		role: "assistant",
		content: textBlocks.map(text => ({ type: "text" as const, text })),
		api: "anthropic-messages",
		provider: "anthropic",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 0,
	};
}

/** Total visible graphemes of the target's text blocks via the counter (mirrors
 *  the controller's `#visibleUnits` for text-only blocks). */
function textUnits(target: AssistantMessage, counter: BlockUnitCounter): number {
	let total = 0;
	for (let i = 0; i < target.content.length; i++) {
		const block = target.content[i];
		if (block?.type === "text") total += counter.count(i, block.text);
	}
	return total;
}

/** Drive one full reveal episode: a fresh counter shared by countOf + sliceOf,
 *  an initial render at revealed = 0 (mirrors `begin`), then the `nextStep`
 *  catch-up loop (mirrors `#tick`). */
function revealEpisode(target: AssistantMessage): void {
	const counter = new BlockUnitCounter();
	const countOf = (index: number, text: string): number => counter.count(index, text);
	const sliceOf = (index: number, text: string, units: number): string => counter.slice(index, text, units);
	buildDisplayMessage(target, 0, HIDE_THINKING, PROSE_ONLY, countOf, sliceOf);
	let revealed = 0;
	for (;;) {
		const total = textUnits(target, counter);
		if (revealed >= total) break;
		revealed = Math.min(total, revealed + nextStep(total - revealed));
		buildDisplayMessage(target, revealed, HIDE_THINKING, PROSE_ONLY, countOf, sliceOf);
	}
}

// Two text blocks of differing lengths exercise multi-block counter indexing.
const target = makeMessage([CHUNK.repeat(16), CHUNK.repeat(12)]);

const bench = createBench();

bench.add("reveal episode", () => {
	revealEpisode(target);
});

console.log("\nCodSpeed bench: streaming-throughput\n");
await bench.run();
console.table(bench.table());
