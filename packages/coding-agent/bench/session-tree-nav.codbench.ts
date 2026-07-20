/**
 * CodSpeed/tinybench variant of `session-tree-nav.bench.ts`.
 *
 * Measures the O(N) walk performed by buildSessionContext during navigateTree.
 * Two tasks:
 *   - two walks: baseline (old behaviour — navigateTree + renderInitialMessages
 *     each called buildSessionContext, so two O(N) walks per navigation).
 *   - one walk:  optimized (new behaviour — renderInitialMessages reuses the
 *     context navigateTree already built).
 *
 * Setup (synthetic session tree + leaf id) stays outside the timed window.
 * Warmup and iteration counts are left to tinybench.
 */
import type { SessionEntry } from "../src/session/session-manager";
import { buildSessionContext } from "../src/session/session-context";
import { createBench } from "../../../bench/codspeed";

const MSG_COUNT = 100;
const CODE_BLOCKS_PER_MSG = 5;

function makeId(i: number): string {
	return `entry-${i.toString().padStart(6, "0")}`;
}

function makeCodeBlock(idx: number): string {
	return `\`\`\`typescript\nconst x${idx} = ${idx};\nconsole.log(x${idx});\n\`\`\``;
}

function buildEntries(): SessionEntry[] {
	const entries: SessionEntry[] = [];
	const now = new Date();

	for (let i = 0; i < MSG_COUNT; i++) {
		const id = makeId(i);
		const parentId = i === 0 ? null : makeId(i - 1);
		const timestamp = new Date(now.getTime() + i * 1000).toISOString();

		const codeBlocks = Array.from({ length: CODE_BLOCKS_PER_MSG }, (_, k) =>
			makeCodeBlock(i * CODE_BLOCKS_PER_MSG + k),
		).join("\n\n");

		if (i % 2 === 0) {
			// User message
			entries.push({
				type: "message",
				id,
				parentId,
				timestamp,
				message: {
					role: "user",
					content: `User message ${i}: please analyze this code.\n\n${codeBlocks}`,
				},
			} satisfies SessionEntry);
		} else {
			// Assistant message
			entries.push({
				type: "message",
				id,
				parentId,
				timestamp,
				message: {
					role: "assistant",
					content: [{ type: "text", text: `Assistant reply ${i}:\n\n${codeBlocks}` }],
				},
			} satisfies SessionEntry);
		}
	}

	return entries;
}

const entries = buildEntries();
const leafId = makeId(MSG_COUNT - 1);

const bench = createBench();

// Baseline: two O(N) walks (old behaviour — navigateTree + renderInitialMessages
// each called buildSessionContext).
bench.add("two walks [BEFORE]", () => {
	buildSessionContext(entries, leafId);
	buildSessionContext(entries, leafId);
});

// Optimized: one O(N) walk (new behaviour — navigateTree returns context,
// renderInitialMessages reuses it).
bench.add("one walk [AFTER]", () => {
	buildSessionContext(entries, leafId);
});

console.log(
	`\nCodSpeed bench: session-tree-nav (${MSG_COUNT} messages, ${CODE_BLOCKS_PER_MSG} code blocks each)\n`,
);
await bench.run();
console.table(bench.table());
