import { describe, expect, it } from "bun:test";
import type { LoopEvent, Message } from "../../src/agent/types.ts";
import {
	DEFAULT_PRICING,
	FREE_PRICING,
	MODEL_PRICING,
	estimateCost,
	formatCost,
	getModelPricing,
} from "../../src/tui/cost.ts";
import { ReplSession } from "../../src/tui/session.ts";

describe("Empirical Challenger: Cost Estimation & Session Hardening", () => {
	// =========================================================================
	// 1. Cost & Pricing Adversarial Fuzzing
	// =========================================================================
	describe("1. Cost & Pricing Adversarial Fuzzing", () => {
		it("fuzz: 1,000,000 pseudo-random token pairs never produce NaN, Infinity, or negative cost", () => {
			const models = [
				{ provider: "anthropic", model: "claude-3-7-sonnet" },
				{ provider: "anthropic", model: "claude-3-5-sonnet" },
				{ provider: "anthropic", model: "claude-3-5-haiku" },
				{ provider: "anthropic", model: "claude-3-opus" },
				{ provider: "openai", model: "gpt-4o" },
				{ provider: "openai", model: "gpt-4o-mini" },
				{ provider: "openai", model: "o1" },
				{ provider: "openai", model: "o3-mini" },
				{ provider: "ollama", model: "llama3.3" },
				{ provider: "local", model: "qwen2.5-coder" },
				{ provider: "unknown_prov", model: "unknown_mod" },
				{ provider: "", model: "" },
			];

			// Run 1,000,000 iterations in fast batches
			const iterations = 1_000_000;
			let seed = 123456789;
			// Fast LCG PRNG for determinism and high speed
			const nextRandom = () => {
				seed = (seed * 1664525 + 1013904223) % 4294967296;
				return seed / 4294967296;
			};

			for (let i = 0; i < iterations; i++) {
				const m = models[i % models.length];
				const inTokens = Math.floor(nextRandom() * 2_000_000);
				const outTokens = Math.floor(nextRandom() * 500_000);

				const cost = estimateCost(m.provider, m.model, inTokens, outTokens);

				if (!Number.isFinite(cost) || Number.isNaN(cost) || cost < 0) {
					throw new Error(
						`Cost invariant violated at iter ${i}: cost=${cost}, in=${inTokens}, out=${outTokens}, model=${m.model}`,
					);
				}

				if (m.provider === "ollama" || m.provider === "local") {
					if (cost !== 0) {
						throw new Error(`Local model should be free, got ${cost}`);
					}
				}
			}

			expect(true).toBe(true);
		});

		it("should safely handle extreme and pathological token boundaries", () => {
			// Negative tokens
			expect(estimateCost("anthropic", "claude-3-7-sonnet", -1, -100)).toBe(0);
			expect(estimateCost("anthropic", "claude-3-7-sonnet", -1_000_000, 500)).toBeGreaterThan(0);
			expect(estimateCost("anthropic", "claude-3-7-sonnet", Number.MIN_SAFE_INTEGER, 0)).toBe(0);

			// Non-finite tokens
			expect(estimateCost("anthropic", "claude-3-7-sonnet", Number.NaN, Number.NaN)).toBe(0);
			expect(estimateCost("anthropic", "claude-3-7-sonnet", Number.POSITIVE_INFINITY, 0)).toBe(0);
			expect(estimateCost("anthropic", "claude-3-7-sonnet", 0, Number.NEGATIVE_INFINITY)).toBe(0);

			// Type coercion safety (if untyped JS passes bad types)
			expect(estimateCost("anthropic", "claude-3-7-sonnet", "1000" as any, "500" as any)).toBe(0);
			expect(estimateCost("anthropic", "claude-3-7-sonnet", null as any, undefined as any)).toBe(0);

			// Max safe integer tokens
			const maxCost = estimateCost(
				"openai",
				"o1",
				Number.MAX_SAFE_INTEGER,
				Number.MAX_SAFE_INTEGER,
			);
			expect(Number.isFinite(maxCost)).toBe(true);
			expect(maxCost).toBeGreaterThan(0);
		});

		it("should resolve model names with chaotic casing, whitespace, and path prefixes", () => {
			const chaoticInputs = [
				{ p: "ANTHROPIC", m: "  claude-3-7-SONNET-20250219  ", expected: "claude-3-7-sonnet" },
				{ p: "OpenAI", m: "OPENAI/GPT-4O-MINI", expected: "gpt-4o-mini" },
				{ p: "OPENAI", m: "O1-PREVIEW", expected: "o1" },
				{ p: "openai", m: "O3-MINI", expected: "o3-mini" },
				{ p: "Anthropic", m: "claude-3-5-Haiku-20241022", expected: "claude-3-5-haiku" },
				{ p: "Anthropic", m: "  CLAUDE-3-OPUS  ", expected: "claude-3-opus" },
				{ p: "ollama", m: "deepseek-r1:70b", expected: "ollama" },
				{ p: "custom", m: "ollama/qwen2.5", expected: "ollama" },
			];

			for (const item of chaoticInputs) {
				const pricing = getModelPricing(item.p, item.m);
				const expectedPricing =
					item.expected === "ollama" ? FREE_PRICING : MODEL_PRICING[item.expected];
				expect(pricing).toEqual(expectedPricing);
			}
		});

		it("formatCost handles all fractional, large, zero, and corrupt inputs", () => {
			expect(formatCost(0)).toBe("$0.00");
			expect(formatCost(-0.001)).toBe("$0.00");
			expect(formatCost(Number.NaN)).toBe("$0.00");
			expect(formatCost(Number.POSITIVE_INFINITY)).toBe("$0.00");
			expect(formatCost(0.00004)).toBe("$0.0000");
			expect(formatCost(0.0001)).toBe("$0.0001");
			expect(formatCost(0.00456)).toBe("$0.0046");
			expect(formatCost(0.00999)).toBe("$0.0100");
			expect(formatCost(0.01)).toBe("$0.01");
			expect(formatCost(1.5)).toBe("$1.50");
			expect(formatCost(1234.567)).toBe("$1234.57");
		});
	});

	// =========================================================================
	// 2. Session Round-Trip & Deep History Stress
	// =========================================================================
	describe("2. Session Serialization & Deep History Round-Trips", () => {
		it("should round-trip 100 turns with large token counts, tool activity, and unicode payloads", () => {
			const session = new ReplSession({
				id: "deep-history-stress-session",
				providerName: "anthropic",
				modelName: "claude-3-7-sonnet",
				mode: "build",
				approvalMode: "manual",
			});

			const specialStrings = [
				"Unicode: 🚀🔥 中文 日本語 한국어 العربية Русский 🤖",
				"ANSI: \u001b[31mRed Alert\u001b[0m \u001b[1mBold Text\u001b[0m",
				'JSON/Escape: {"key": "value with \\n newline and \\"quotes\\""}',
				"Code Block: ```typescript\nconst x = () => { return `<div id=\"root\"></div>`; };\n```",
				"Special Symbols: !@#$%^&*()_+-=[]{}|;':\",./<>?`~\\",
			];

			let totalIn = 0;
			let totalOut = 0;
			let expectedCost = 0;

			for (let turnIdx = 1; turnIdx <= 100; turnIdx++) {
				const userText = `Turn ${turnIdx} User Prompt: ${specialStrings[turnIdx % specialStrings.length]}`;
				const assistantText = `Turn ${turnIdx} Assistant Response: ${specialStrings[(turnIdx + 1) % specialStrings.length]}`;
				const inTokens = 1000 + turnIdx * 10;
				const outTokens = 200 + turnIdx * 5;

				totalIn += inTokens;
				totalOut += outTokens;
				const cost = estimateCost("anthropic", "claude-3-7-sonnet", inTokens, outTokens);
				expectedCost += cost;

				const toolEvents: LoopEvent[] =
					turnIdx % 5 === 0
						? [
								{
									type: "tool_call",
									toolName: "run_command",
									toolInput: { command: `echo "Turn ${turnIdx}"` },
									toolUseId: `call_${turnIdx}`,
								},
								{
									type: "tool_result",
									toolUseId: `call_${turnIdx}`,
									result: `Output for turn ${turnIdx} with special chars: 🚀 <xml>`,
									isError: turnIdx % 10 === 0,
								},
							]
						: [];

				session.addTurn(
					userText,
					assistantText,
					{ inputTokens: inTokens, outputTokens: outTokens },
					toolEvents,
					150,
				);
			}

			const state = session.getState();
			expect(state.turnCount).toBe(100);
			expect(state.inputTokens).toBe(totalIn);
			expect(state.outputTokens).toBe(totalOut);
			expect(state.totalTokens).toBe(totalIn + totalOut);
			expect(state.estimatedCost).toBeCloseTo(expectedCost, 5);
			expect(session.getTurns().length).toBe(100);
			expect(session.getMessages().length).toBe(200);

			// JSON Export
			const exportedJSON = session.exportTranscript("json");
			expect(typeof exportedJSON).toBe("string");
			expect(exportedJSON.length).toBeGreaterThan(10000);

			// Reconstruct via fromJSON
			const restored = ReplSession.fromJSON(exportedJSON);
			const restoredState = restored.getState();

			expect(restoredState.id).toBe("deep-history-stress-session");
			expect(restoredState.turnCount).toBe(100);
			expect(restoredState.inputTokens).toBe(totalIn);
			expect(restoredState.outputTokens).toBe(totalOut);
			expect(restoredState.totalTokens).toBe(totalIn + totalOut);
			expect(restoredState.estimatedCost).toBeCloseTo(expectedCost, 5);
			expect(restored.getTurns().length).toBe(100);
			expect(restored.getMessages().length).toBe(200);

			// Check exact preservation of first and last turn tool events and unicode content
			const firstTurn = restored.getTurns()[0];
			expect(firstTurn.userPrompt).toBe(session.getTurns()[0].userPrompt);

			const turn5 = restored.getTurns()[4];
			expect(turn5.toolEvents).toBeDefined();
			expect(turn5.toolEvents?.length).toBe(2);
			const firstToolEvent = turn5.toolEvents?.[0];
			expect(firstToolEvent?.type).toBe("tool_call");
			if (firstToolEvent && firstToolEvent.type === "tool_call") {
				expect(firstToolEvent.toolName).toBe("run_command");
			}

			// Markdown Export
			const exportedMarkdown = session.exportTranscript("markdown");
			expect(exportedMarkdown).toContain("# REPL Session Transcript");
			expect(exportedMarkdown).toContain("## Turn 1");
			expect(exportedMarkdown).toContain("## Turn 100");
			expect(exportedMarkdown).toContain("🛠️ Tool Activity");
			expect(exportedMarkdown).toContain("🚀");
		});

		it("should reject corrupted, malformed, or missing JSON payloads safely", () => {
			expect(() => ReplSession.fromJSON("")).toThrow();
			expect(() => ReplSession.fromJSON("{ invalid json }")).toThrow();
			expect(() => ReplSession.fromJSON("{}")).toThrow();
			expect(() => ReplSession.fromJSON(JSON.stringify({ session: {} }))).toThrow();
			expect(() => ReplSession.fromJSON(JSON.stringify({ session: { id: "" } }))).toThrow();

			const s = new ReplSession();
			expect(() => s.loadSession("not json")).toThrow();
			expect(() => s.loadSession("{}")).toThrow();
		});
	});

	// =========================================================================
	// 3. Dynamic Model Switching & Accumulator Invariants
	// =========================================================================
	describe("3. Dynamic Model Switching & Accumulator Invariants", () => {
		it("maintains strict mathematical token & cost consistency across multiple dynamic model switches", () => {
			const session = new ReplSession({
				providerName: "anthropic",
				modelName: "claude-3-7-sonnet",
			});

			let expectedCost = 0;
			let expectedIn = 0;
			let expectedOut = 0;

			// Step 1: Turn 1 on claude-3-7-sonnet ($3/M in, $15/M out)
			const t1In = 100_000;
			const t1Out = 50_000;
			session.addTurn("Turn 1 on Claude", "Claude response", {
				inputTokens: t1In,
				outputTokens: t1Out,
			});
			const cost1 = (t1In * 3.0 + t1Out * 15.0) / 1_000_000; // 0.30 + 0.75 = 1.05
			expectedCost += cost1;
			expectedIn += t1In;
			expectedOut += t1Out;

			expect(session.getState().estimatedCost).toBeCloseTo(expectedCost, 6);
			expect(session.getState().totalTokens).toBe(expectedIn + expectedOut);

			// Step 2: Switch to OpenAI gpt-4o-mini ($0.15/M in, $0.60/M out)
			session.setProvider("openai", "gpt-4o-mini");
			expect(session.getState().providerName).toBe("openai");
			expect(session.getState().modelName).toBe("gpt-4o-mini");

			const t2In = 200_000;
			const t2Out = 100_000;
			session.addTurn("Turn 2 on GPT-4o-mini", "Mini response", {
				inputTokens: t2In,
				outputTokens: t2Out,
			});
			const cost2 = (t2In * 0.15 + t2Out * 0.60) / 1_000_000; // 0.03 + 0.06 = 0.09
			expectedCost += cost2;
			expectedIn += t2In;
			expectedOut += t2Out;

			expect(session.getState().estimatedCost).toBeCloseTo(expectedCost, 6);
			expect(session.getState().totalTokens).toBe(expectedIn + expectedOut);

			// Step 3: Switch to Ollama Local model ($0.00 / free)
			session.setModel("llama3.3:70b", "ollama");
			expect(session.getState().providerName).toBe("ollama");
			expect(session.getState().modelName).toBe("llama3.3:70b");

			const t3In = 500_000;
			const t3Out = 300_000;
			session.addTurn("Turn 3 on Local Ollama", "Local response", {
				inputTokens: t3In,
				outputTokens: t3Out,
			});
			expectedCost += 0; // Free
			expectedIn += t3In;
			expectedOut += t3Out;

			expect(session.getState().estimatedCost).toBeCloseTo(expectedCost, 6);
			expect(session.getState().totalTokens).toBe(expectedIn + expectedOut);

			// Step 4: Switch to OpenAI o1 ($15.00/M in, $60.00/M out)
			session.setModel("o1", "openai");
			const t4In = 40_000;
			const t4Out = 10_000;
			session.addTurn("Turn 4 on o1", "o1 thinking response", {
				inputTokens: t4In,
				outputTokens: t4Out,
			});
			const cost4 = (t4In * 15.0 + t4Out * 60.0) / 1_000_000; // 0.60 + 0.60 = 1.20
			expectedCost += cost4;
			expectedIn += t4In;
			expectedOut += t4Out;

			expect(session.getState().estimatedCost).toBeCloseTo(expectedCost, 6);
			expect(session.getState().totalTokens).toBe(expectedIn + expectedOut);

			// Step 5: Direct updateTokens check
			session.updateTokens(20_000, 5_000);
			const directCost = (20_000 * 15.0 + 5_000 * 60.0) / 1_000_000; // 0.30 + 0.30 = 0.60
			expectedCost += directCost;
			expectedIn += 20_000;
			expectedOut += 5_000;

			const finalState = session.getState();
			expect(finalState.inputTokens).toBe(expectedIn);
			expect(finalState.outputTokens).toBe(expectedOut);
			expect(finalState.totalTokens).toBe(expectedIn + expectedOut);
			expect(finalState.estimatedCost).toBeCloseTo(expectedCost, 6);

			// Step 6: Verify individual turn costs match their respective model rates
			const turns = session.getTurns();
			expect(turns.length).toBe(4);
			expect(turns[0].cost).toBeCloseTo(cost1, 6);
			expect(turns[1].cost).toBeCloseTo(cost2, 6);
			expect(turns[2].cost).toBe(0);
			expect(turns[3].cost).toBeCloseTo(cost4, 6);
		});
	});

	// =========================================================================
	// 4. State Immutability & Contract Invariants
	// =========================================================================
	describe("4. State Immutability & Contract Invariants", () => {
		it("getState returns a shallow clone that protects internal state from tampering", () => {
			const session = new ReplSession();
			const state1 = session.getState();

			// Attempt to mutate the returned state object
			(state1 as any).turnCount = 999;
			(state1 as any).totalTokens = 1234567;
			(state1 as any).mode = "plan";

			// State inside session must remain unchanged
			const state2 = session.getState();
			expect(state2.turnCount).toBe(0);
			expect(state2.totalTokens).toBe(0);
			expect(state2.mode).toBe("build");
		});

		it("getMessages and getTurns return shallow copies preventing direct array tampering", () => {
			const session = new ReplSession();
			session.addTurn("User", "Assistant");

			const messages = session.getMessages();
			expect(messages.length).toBe(2);
			messages.pop();
			expect(session.getMessages().length).toBe(2);

			const turns = session.getTurns();
			expect(turns.length).toBe(1);
			turns.pop();
			expect(session.getTurns().length).toBe(1);
		});

		it("reset cleans all conversation history and tokens while preserving immutable identity", () => {
			const session = new ReplSession({
				id: "preserve-me-id",
				providerName: "anthropic",
				modelName: "claude-3-7-sonnet",
				mode: "plan",
				approvalMode: "yolo",
			});

			session.addTurn("P1", "R1", { inputTokens: 500, outputTokens: 250 });
			session.addTurn("P2", "R2", { inputTokens: 300, outputTokens: 150 });

			expect(session.getState().turnCount).toBe(2);
			expect(session.getState().totalTokens).toBe(1200);

			session.reset();

			const afterReset = session.getState();
			expect(afterReset.id).toBe("preserve-me-id");
			expect(afterReset.providerName).toBe("anthropic");
			expect(afterReset.modelName).toBe("claude-3-7-sonnet");
			expect(afterReset.mode).toBe("plan");
			expect(afterReset.approvalMode).toBe("yolo");
			expect(afterReset.turnCount).toBe(0);
			expect(afterReset.inputTokens).toBe(0);
			expect(afterReset.outputTokens).toBe(0);
			expect(afterReset.totalTokens).toBe(0);
			expect(afterReset.estimatedCost).toBe(0);
			expect(session.getMessages().length).toBe(0);
			expect(session.getTurns().length).toBe(0);
		});

		it("validates strict constraints on setters", () => {
			const session = new ReplSession();

			// setMode
			expect(() => session.setMode("plan")).not.toThrow();
			expect(() => session.setMode("build")).not.toThrow();
			expect(() => session.setMode("hack" as any)).toThrow();

			// setApprovalMode
			expect(() => session.setApprovalMode("auto")).not.toThrow();
			expect(() => session.setApprovalMode("manual")).not.toThrow();
			expect(() => session.setApprovalMode("yolo")).not.toThrow();
			expect(() => session.setApprovalMode("godmode" as any)).toThrow();

			// setModel
			expect(() => session.setModel("gpt-4o")).not.toThrow();
			expect(() => session.setModel("")).toThrow();
			expect(() => session.setModel(null as any)).toThrow();

			// setProvider
			expect(() => session.setProvider("openai", "gpt-4o")).not.toThrow();
			expect(() => session.setProvider("", "gpt-4o")).toThrow();
			expect(() => session.setProvider("openai", "")).toThrow();
		});
	});
});
