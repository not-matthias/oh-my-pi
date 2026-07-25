/**
 * CodSpeed/tinybench variant of `transcript-compose.bench.ts`.
 *
 * Measures the per-tick `TranscriptContainer.render(width)` cost after N
 * finalized assistant blocks are committed into native scrollback. Each task
 * builds N committed finalized blocks + a live tail OUTSIDE the timed window,
 * then the tinybench `fn` performs one pure render tick of the live tail.
 *
 * Two tasks (N=500, N=5000) preserve the depth-vs-flat cost comparison: a
 * flat (compacted) committed prefix yields a roughly constant ratio between the
 * two. Warmup and iteration counts are left to tinybench.
 */
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { Settings } from "../src/config/settings";
import { AssistantMessageComponent } from "../src/modes/components/assistant-message";
import { TranscriptContainer } from "../src/modes/components/transcript-container";
import { initTheme } from "../src/modes/theme/theme";
import { createBench } from "../../../bench/codspeed";

const WIDTH = 100;

function makeMarkdownCorpus(targetGraphemes: number): string {
	const para =
		"The quick brown fox jumps over the lazy dog while 🚀 emoji and a `code span` " +
		"plus **bold** and _italic_ text exercise the markdown lexer and the grapheme segmenter. ";
	const codeBlock = "\n```ts\nconst x: number = compute(a, b) + delta;\nreturn x.toFixed(2);\n```\n\n";
	const list = "\n- first bullet item\n- second bullet item with `inline`\n- third\n\n";
	let out = "";
	let i = 0;
	while (out.length < targetGraphemes) {
		out += `## Section ${++i}\n\n${para}${para}${codeBlock}${list}`;
	}
	return out.slice(0, targetGraphemes);
}

function makeTextMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "bench",
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

/** Build N committed finalized blocks + a live tail and return the tick fn plus
 *  the tail component (so the harness can advance revealed per iteration). */
function setup(n: number): { tick: () => void; container: TranscriptContainer } {
	const histText = makeMarkdownCorpus(240);
	const tailCorpus = makeMarkdownCorpus(1200);
	const container = new TranscriptContainer();
	for (let i = 0; i < n; i++) {
		const c = new AssistantMessageComponent();
		c.updateContent(makeTextMessage(histText));
		c.markTranscriptBlockFinalized();
		container.addChild(c);
	}
	const tail = new AssistantMessageComponent();
	container.addChild(tail);
	let revealed = Math.floor(tailCorpus.length * 0.5);
	tail.updateContent(makeTextMessage(tailCorpus.slice(0, revealed)), { transient: true });

	// Warm every block's markdown L1 cache and establish the assembled frame,
	// then commit exactly the seam the container reports (what the TUI does):
	// every finalized-history row plus the separator before the live tail. The
	// container compacts that committed prefix on the next render.
	container.render(WIDTH);
	const committed = container.getNativeScrollbackLiveRegionStart() ?? 0;
	container.setNativeScrollbackCommittedRows(committed);
	container.render(WIDTH);

	const tick = () => {
		revealed += 20;
		if (revealed > tailCorpus.length) revealed = Math.floor(tailCorpus.length * 0.5);
		tail.updateContent(makeTextMessage(tailCorpus.slice(0, revealed)), { transient: true });
		container.render(WIDTH);
	};

	return { tick, container };
}

await Settings.init({ inMemory: true });
await initTheme("dark");

const setup500 = setup(500);
const setup5000 = setup(5000);

const bench = createBench();

bench.add("render N=500", () => {
	setup500.tick();
});

bench.add("render N=5000", () => {
	setup5000.tick();
});

console.log(`\nCodSpeed bench: transcript-compose (live tail tick, width ${WIDTH})\n`);
await bench.run();
console.table(bench.table());
