/**
 * CodSpeed/tinybench variant of `llm-assembly.bench.ts`.
 *
 * Measures the same LLM-assembly recompute regimes over settled history:
 *   - convert cold:   fresh-identity history per iteration → cache miss.
 *   - convert steady: re-convert the same (warmed) array.
 *   - convert grow:   append one turn then reconvert (slice-on-growth reuse).
 *   - estimate first:  cold token count of a never-before-seen history.
 *   - estimate second: repeat count of the identical warmed history.
 *
 * Each regime becomes one tinybench task. For the cold regimes the per-iteration
 * `fn` builds a fresh-identity history inside the timed window (as the original's
 * `makeWorkload` + `run` did), so every iteration is a genuine cache miss; the
 * warm regimes reuse a single primed array, matching the original's shared
 * workload. Warmup and iteration counts are left to tinybench.
 */
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { estimateTokens } from "@oh-my-pi/pi-agent-core/compaction";
import type { AssistantMessage, ToolResultMessage, Usage } from "@oh-my-pi/pi-ai";
import { convertToLlm } from "../src/session/messages";
import { createBench } from "../../../bench/codspeed";

const N = Number(Bun.env.LLM_ASSEMBLY_N ?? 5000);

function settledUsage(total: number): Usage {
	return {
		input: total,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: total,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function codeBlob(seed: number): string {
	return `\`\`\`typescript\nexport function f${seed}(a: number, b: number): number {\n\treturn a + b + ${seed};\n}\n\`\`\``;
}

/** Build a settled, mixed history: user / assistant (settled usage + tool call) / tool-result triples.
 *  Every call mints fresh object identities so it reads as a cold (uncached) workload. */
function buildHistory(count: number): AgentMessage[] {
	const messages: AgentMessage[] = [];
	for (let i = 0; i < count; i++) {
		const turn = Math.floor(i / 3);
		const role = i % 3;
		if (role === 0) {
			messages.push({
				role: "user",
				content: `User turn ${turn}: please review.\n\n${codeBlob(i)}`,
				timestamp: 1_700_000_000_000 + i * 1000,
			} as AgentMessage);
		} else if (role === 1) {
			const usage = settledUsage(120 + (i % 50));
			messages.push({
				role: "assistant",
				content: [
					{ type: "text", text: `Assistant turn ${turn}:\n\n${codeBlob(i)}` },
					{
						type: "tool_use",
						id: `toolu_${i}`,
						name: "Read",
						input: { path: `/tmp/file_${i}.ts` },
					},
				],
				usage,
				model: "bench-model",
				stopReason: "tool_use",
				timestamp: 1_700_000_000_000 + i * 1000,
			} as AssistantMessage as AgentMessage);
		} else {
			messages.push({
				role: "tool",
				toolUseId: `toolu_${i - 1}`,
				content: [
					{ type: "tool_result", toolUseId: `toolu_${i - 1}`, content: `1\tfile://${i}` },
				],
				timestamp: 1_700_000_000_000 + i * 1000,
			} as ToolResultMessage as AgentMessage);
		}
	}
	return messages;
}

function estimateAll(messages: AgentMessage[]): number {
	let total = 0;
	for (const m of messages) total += estimateTokens(m);
	return total;
}

const bench = createBench();

// ─── convertToLlm ─────────────────────────────────────────────────────────────
// Cold: a fresh-identity history per iteration → every message is a cache miss.
bench.add("convert cold", () => {
	const history = buildHistory(N);
	convertToLlm(history);
});

// Steady: re-convert the same (warmed) array. transformContext re-converts the
// same live array multiple times per turn; the exact-repeat shortcut hands back
// the same outer array. Priming twice warms both the per-message memo and the
// shortcut.
const warmConvert = buildHistory(N);
convertToLlm(warmConvert);
convertToLlm(warmConvert);
bench.add("convert steady", () => {
	convertToLlm(warmConvert);
});

// Append-growth: push one settled turn onto the same array identity per
// iteration, then reconvert. Slice-on-growth reuses the unchanged prefix
// output and reconverts only the boundary message plus the new suffix, so the
// per-turn cost is O(suffix), not O(history).
const growConvert = buildHistory(N);
convertToLlm(growConvert);
let growSeed = N;
bench.add("convert grow", () => {
	growConvert.push({
		role: "user",
		content: `User turn ${growSeed}: one more.\n\n${codeBlob(growSeed)}`,
		timestamp: 1_700_000_000_000 + growSeed * 1000,
	} as AgentMessage);
	growSeed++;
	convertToLlm(growConvert);
});

// ─── estimateTokens ───────────────────────────────────────────────────────────
// Cold: fresh-identity history per iteration → every estimate is a cache miss.
bench.add("estimate tokens", () => {
	const history = buildHistory(N);
	estimateAll(history);
});

// Warm: one history, primed once, re-counted every iteration from the cache.
const warmEstimate = buildHistory(N);
estimateAll(warmEstimate);
bench.add("estimate tokens (warm)", () => {
	estimateAll(warmEstimate);
});

console.log(`\nCodSpeed bench: llm-assembly (N=${N})\n`);
await bench.run();
console.table(bench.table());
