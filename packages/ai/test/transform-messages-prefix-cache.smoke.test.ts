// Smoke test for the transformMessages prefix cache: verifies that a cached
// transform of a GROWN array (same reference, agent-loop push) is byte-identical
// to a full re-transform of the same content from a fresh array.
import { describe, expect, it } from "bun:test";
import { transformMessages } from "@oh-my-pi/pi-ai/providers/transform-messages";
import type { AssistantMessage, Message, Model } from "@oh-my-pi/pi-ai/types";
import { buildModel } from "@oh-my-pi/pi-catalog/build";

const model: Model<"anthropic-messages"> = buildModel({
	api: "anthropic-messages",
	provider: "anthropic",
	id: "claude-sonnet-4-5",
	name: "Claude Sonnet 4.5",
	baseUrl: "https://api.anthropic.com",
	input: ["text"],
	cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
	maxTokens: 8192,
	contextWindow: 200000,
	reasoning: true,
});

const otherModel: Model<"anthropic-messages"> = buildModel({
	api: "anthropic-messages",
	provider: "anthropic",
	id: "claude-opus-4-1",
	name: "Claude Opus 4.1",
	baseUrl: "https://api.anthropic.com",
	input: ["text"],
	cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
	maxTokens: 8192,
	contextWindow: 200000,
	reasoning: true,
});

function assistant(
	content: AssistantMessage["content"],
	timestamp: number,
	stopReason: AssistantMessage["stopReason"] = "toolUse",
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp,
	};
}
function toolResult(toolCallId: string, text: string, timestamp: number, toolName = "read"): Message {
	return { role: "toolResult", toolCallId, toolName, content: [{ type: "text", text }], isError: false, timestamp };
}

const json = (m: unknown) => JSON.stringify(m);

describe("transformMessages prefix cache", () => {
	it("cached grown-array transform equals a full re-transform (latest-assistant invariant)", () => {
		// assistant1 carries a thinking block w/ signature. When it is the latest
		// surviving assistant its thinking is preserved; once assistant2 is
		// appended it is no longer latest and must be re-transformed (NOT served
		// from the cached prefix, which excludes the latest assistant).
		const grown: Message[] = [
			{ role: "user", content: "Help me", timestamp: 1 },
			assistant(
				[
					{ type: "thinking", thinking: "reasoning one", thinkingSignature: "sig_aaa" },
					{ type: "text", text: "ok" },
					{ type: "toolCall", id: "call_1", name: "read", arguments: { path: "a" } },
				],
				2,
			),
			toolResult("call_1", "file a contents", 3),
		];
		transformMessages(grown, model); // prime cache
		grown.push(
			assistant(
				[
					{ type: "thinking", thinking: "reasoning two", thinkingSignature: "sig_bbb" },
					{ type: "text", text: "done" },
				],
				4,
				"stop",
			),
		);
		const cached = transformMessages(grown, model); // reuse prefix, re-transform tail

		const fresh: Message[] = [
			{ role: "user", content: "Help me", timestamp: 1 },
			assistant(
				[
					{ type: "thinking", thinking: "reasoning one", thinkingSignature: "sig_aaa" },
					{ type: "text", text: "ok" },
					{ type: "toolCall", id: "call_1", name: "read", arguments: { path: "a" } },
				],
				2,
			),
			toolResult("call_1", "file a contents", 3),
			assistant(
				[
					{ type: "thinking", thinking: "reasoning two", thinkingSignature: "sig_bbb" },
					{ type: "text", text: "done" },
				],
				4,
				"stop",
			),
		];
		const recomputed = transformMessages(fresh, model);

		expect(json(cached)).toEqual(json(recomputed));
		expect(cached.filter(m => m.role === "assistant").length).toBe(2);
	});

	it("cached multi-step growth equals full re-transform (cross-model target)", () => {
		const grown: Message[] = [
			{ role: "user", content: "start", timestamp: 1 },
			assistant(
				[
					{ type: "text", text: "first" },
					{ type: "toolCall", id: "c1", name: "run", arguments: {} },
				],
				2,
			),
			toolResult("c1", "out1", 3),
		];
		transformMessages(grown, otherModel); // prime
		grown.push(
			assistant(
				[
					{ type: "thinking", thinking: "t1", thinkingSignature: "s1" },
					{ type: "toolCall", id: "c2", name: "run", arguments: {} },
				],
				4,
			),
		);
		transformMessages(grown, otherModel);
		grown.push(toolResult("c2", "out2", 5));
		const cached = transformMessages(grown, otherModel);

		const fresh: Message[] = [
			{ role: "user", content: "start", timestamp: 1 },
			assistant(
				[
					{ type: "text", text: "first" },
					{ type: "toolCall", id: "c1", name: "run", arguments: {} },
				],
				2,
			),
			toolResult("c1", "out1", 3),
			assistant(
				[
					{ type: "thinking", thinking: "t1", thinkingSignature: "s1" },
					{ type: "toolCall", id: "c2", name: "run", arguments: {} },
				],
				4,
			),
			toolResult("c2", "out2", 5),
		];
		expect(json(cached)).toEqual(json(transformMessages(fresh, otherModel)));
	});

	it("per-message redact memo does not serve a stale unredacted early message after growth", () => {
		const token = `ghp_${"BcDe1234567890".repeat(3)}`;
		const grown: Message[] = [
			{ role: "user", content: `here is a token ${token} ok?`, timestamp: 1 },
			assistant([{ type: "text", text: "noted" }], 2, "stop"),
		];
		transformMessages(grown, model); // prime (redacts + memoizes the user msg)
		grown.push({ role: "user", content: "more", timestamp: 3 });
		const out = transformMessages(grown, model);
		const firstUser = out.find(m => m.role === "user");
		expect(typeof firstUser?.content === "string" && !firstUser.content.includes(token)).toBe(true);
	});

	it("config change (different model) invalidates the cache", () => {
		const arr: Message[] = [
			{ role: "user", content: "hi", timestamp: 1 },
			assistant(
				[
					{ type: "thinking", thinking: "th", thinkingSignature: "sx" },
					{ type: "text", text: "hey" },
				],
				2,
				"stop",
			),
		];
		transformMessages(arr, model); // prime with `model`
		const withOtherModel = transformMessages(arr, otherModel); // different configKey -> must recompute
		const freshOther: Message[] = [
			{ role: "user", content: "hi", timestamp: 1 },
			assistant(
				[
					{ type: "thinking", thinking: "th", thinkingSignature: "sx" },
					{ type: "text", text: "hey" },
				],
				2,
				"stop",
			),
		];
		expect(json(withOtherModel)).toEqual(json(transformMessages(freshOther, otherModel)));
	});

	it("same-config repeat transform is stable", () => {
		const arr: Message[] = [
			{ role: "user", content: "hi", timestamp: 1 },
			assistant([{ type: "text", text: "hey" }], 2, "stop"),
		];
		const a = transformMessages(arr, model);
		const b = transformMessages(arr, model);
		expect(json(a)).toEqual(json(b));
	});
});
