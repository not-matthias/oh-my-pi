/**
 * Recovery hot-path CodSpeed benchmark.
 *
 * CodSpeed/tinybench variant of `recovery-session-chain.ts`. Mirrors the same
 * accept/reject regimes and 50/500/5000-line × 1/8-anchor matrix so CodSpeed
 * CI tracks the session-chain replay path. Each case is a tinybench task;
 * warmup and iteration counts are left to tinybench.
 *
 * Two regimes:
 *   - `accept` — anchor lands on a line unchanged across the prior in-session
 *     edit. All anchors remap at offset 0 from the tagged (non-head) snapshot,
 *     `replayRemappedAnchorsOnCurrent` applies the edits on current text, and
 *     `tryRecover` returns a non-null result carrying
 *     `RECOVERY_SESSION_CHAIN_WARNING`. End-to-end this exercises diff
 *     (buildLineMap) + remapEditsToCurrent + applyEdits.
 *   - `reject` — anchor lands on the line the prior edit rewrote. That line is
 *     absent from the unchanged-line map, `validateRemappedAnchorContext`
 *     refuses, and `tryRecover` returns null without applying anything. This
 *     is the corruption window the recovery gate closes.
 *
 * Sizes (50/500/5000 lines) × edit batch (1/8 anchors) so the O(N) diff cost
 * in `buildLineMap` and the O(K) anchor walk both surface.
 *
 * NOTE: the sibling `.ts` bench imports `RECOVERY_SESSION_REPLAY_WARNING`,
 * a constant that no longer exists in `src/messages.ts` (the verifyAnchorContent
 * / replaySessionChainOnCurrent architecture it described was refactored into
 * remapEditsToCurrent + replayRemappedAnchorsOnCurrent). This CodSpeed variant
 * asserts on the actually-emitted `RECOVERY_SESSION_CHAIN_WARNING`, which is
 * the only warning the non-head, offset-0 replay path emits — so its presence
 * still proves the replay path executed.
 */
import { InMemorySnapshotStore, parsePatch, RECOVERY_SESSION_CHAIN_WARNING, Recovery } from "../src";
import { createBench } from "../../../bench/codspeed";

const PATH = "/tmp/__hashline-recovery-bench__.ts";

interface Fixture {
	store: InMemorySnapshotStore;
	v1Text: string;
	h0: string;
}

/**
 * Seed two snapshots: v0 → v1 where v1 differs only at `rewrittenLine`. The
 * recovery driver will fetch v0 by hash and replay onto v1.
 */
function seed(lines: number, rewrittenLine: number): Fixture {
	const v0Lines = Array.from({ length: lines }, (_, i) => `line ${i + 1} content`);
	const v1Lines = [...v0Lines];
	v1Lines[rewrittenLine - 1] = `line ${rewrittenLine} REWRITTEN`;
	const v0Text = `${v0Lines.join("\n")}\n`;
	const v1Text = `${v1Lines.join("\n")}\n`;
	const store = new InMemorySnapshotStore();
	const h0 = store.record(PATH, v0Text);
	store.record(PATH, v1Text);
	return { store, v1Text, h0 };
}

/** Build an N-anchor edit batch whose anchor lines are distinct rows. */
function batchPatch(anchors: readonly number[]): string {
	return anchors.map(line => `SWAP ${line}.=${line}:\n+line ${line} MODEL`).join("\n");
}

interface Case {
	name: string;
	lines: number;
	anchors: number[];
	rewrittenLine: number;
}

const cases: Case[] = [];
for (const size of [50, 500, 5000] as const) {
	const rewritten = Math.floor(size / 2);
	// Anchors spread across the file so the remap walk must walk real
	// distances, not just hammer the same cache line.
	const sparse = [Math.max(1, Math.floor(size / 8))];
	const dense = [
		Math.max(1, Math.floor(size / 9)),
		Math.max(1, Math.floor(size / 8)),
		Math.max(1, Math.floor(size / 7)),
		Math.max(1, Math.floor(size / 6)),
		Math.max(1, Math.floor(size / 5)),
		Math.max(1, Math.floor(size / 4)),
		Math.max(1, Math.floor(size / 3)),
		Math.max(2, Math.floor((size * 2) / 3)),
	];
	// Accept regime: the rewrite is the immediate neighbour of the first
	// anchor (≤3 lines), so the anchor lines themselves are unchanged and
	// remap at offset 0 — forcing the replay path. Reject regime: the
	// rewrite IS the anchor, so validateRemappedAnchorContext refuses.
	const acceptRewrite = sparse[0] - 1;
	const acceptRewriteDense = dense[0] - 1;
	cases.push(
		{ name: `accept ${size}L ×1 anchor`, lines: size, anchors: sparse, rewrittenLine: acceptRewrite },
		{ name: `accept ${size}L ×8 anchors`, lines: size, anchors: dense, rewrittenLine: acceptRewriteDense },
		{ name: `reject ${size}L ×1 anchor`, lines: size, anchors: [rewritten], rewrittenLine: rewritten },
	);
}

const bench = createBench();

let expectedNonNullVerified = 0;
let expectedNullVerified = 0;

// Sanity: every iteration must hit the expected branch. Otherwise the
// numbers measure the wrong path. Accept cases additionally must surface
// RECOVERY_SESSION_CHAIN_WARNING — the only warning the non-head, offset-0
// replay path emits, so its presence proves the replay path actually ran.
for (const c of cases) {
	const isReject = c.name.startsWith("reject");
	const { store, v1Text, h0 } = seed(c.lines, c.rewrittenLine);
	const recovery = new Recovery(store);
	const { edits } = parsePatch(batchPatch(c.anchors));
	const args = { path: PATH, currentText: v1Text, fileHash: h0, edits };

	const probe = recovery.tryRecover(args);
	if (isReject) {
		if (probe !== null) throw new Error(`expected null for ${c.name}, got recovery`);
		expectedNullVerified++;
	} else {
		if (probe === null) throw new Error(`expected recovery for ${c.name}, got null`);
		if (!probe.warnings.includes(RECOVERY_SESSION_CHAIN_WARNING)) {
			throw new Error(
				`expected ${c.name} to surface RECOVERY_SESSION_CHAIN_WARNING (the only signal that the replay path executed); got warnings=${JSON.stringify(probe.warnings)}`,
			);
		}
		expectedNonNullVerified++;
	}

	bench.add(c.name, () => {
		recovery.tryRecover(args);
	});
}

console.log(
	`Sanity: ${expectedNonNullVerified} accept-path + ${expectedNullVerified} reject-path branches verified before timing.`,
);

await bench.run();
console.table(bench.table());
