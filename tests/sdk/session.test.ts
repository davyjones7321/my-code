import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { Harness } from "../../src/sdk/harness.ts";
import type { SDKEvent } from "../../src/sdk/types.ts";
import { MockSDKProvider, createMockTool } from "./test-helpers.ts";

describe("SDK Tier 1-4: HarnessSession Execution & Streaming Suite", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-session-test-"));
	});

	afterEach(async () => {
		try {
			await fs.rm(tempDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors on Windows
		}
	});

	// ==========================================
	// TIER 1: FEATURE COVERAGE
	// ==========================================

	it("S-01: sendStream() should yield full sequence of SDK events", async () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const provider = new MockSDKProvider("stream-provider");

		provider.queueResponse({
			content: [
				{
					type: "tool_use",
					id: "call_w1",
					name: "mock_weather",
					input: { location: "San Francisco" },
				},
			],
			usage: { inputTokens: 10, outputTokens: 5 },
		});
		provider.queueResponse({
			content: [{ type: "text", text: "The weather in San Francisco is 65°F and sunny." }],
			usage: { inputTokens: 15, outputTokens: 10 },
		});

		const weatherTool = createMockTool("mock_weather", async () => ({
			result: "65°F sunny",
			isError: false,
		}));

		harness.registerProvider(provider);
		harness.registerTool(weatherTool);

		const session = harness.createSession({
			providerName: "stream-provider",
			approvalMode: "yolo",
		});

		const events: SDKEvent[] = [];
		for await (const event of session.sendStream("What is the weather in SF?")) {
			events.push(event);
		}

		expect(events.length).toBeGreaterThanOrEqual(4);

		const thinkingEv = events.find((e) => e.type === "thinking");
		expect(thinkingEv).toBeDefined();
		if (thinkingEv && thinkingEv.type === "thinking") {
			expect(thinkingEv.message).toBeDefined();
			expect(thinkingEv.message.length).toBeGreaterThan(0);
		}

		const toolCallEv = events.find((e) => e.type === "tool_call");
		expect(toolCallEv).toBeDefined();
		if (toolCallEv && toolCallEv.type === "tool_call") {
			expect(toolCallEv.toolName).toBe("mock_weather");
			expect(toolCallEv.toolInput.location).toBe("San Francisco");
		}

		const toolResultEv = events.find((e) => e.type === "tool_result");
		expect(toolResultEv).toBeDefined();
		if (toolResultEv && toolResultEv.type === "tool_result") {
			expect(toolResultEv.result).toBe("65°F sunny");
		}

		const responseEv = events.find((e) => e.type === "response");
		expect(responseEv).toBeDefined();
		if (responseEv && responseEv.type === "response") {
			expect(responseEv.text).toContain("65°F and sunny");
		}

		const doneEv = events.find((e) => e.type === "done");
		expect(doneEv).toBeDefined();
	});

	it("S-02: send() convenience wrapper should return SDKTurnResult with aggregated data", async () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const provider = new MockSDKProvider("send-provider");
		provider.queueTextResponse("Hello from send() convenience method!", {
			inputTokens: 12,
			outputTokens: 8,
		});

		harness.registerProvider(provider);
		const session = harness.createSession({ providerName: "send-provider" });

		const result = await session.send("Say hello");
		expect(result).toBeDefined();
		expect(result.response).toBe("Hello from send() convenience method!");
		expect(result.events.length).toBeGreaterThan(0);
		expect(result.usage.inputTokens).toBe(12);
		expect(result.usage.outputTokens).toBe(8);
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("S-03: should maintain multi-turn conversational history continuity", async () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const provider = new MockSDKProvider("multi-turn-provider");

		provider.queueTextResponse("Nice to meet you, Alice!");
		provider.queueResponse((messages) => {
			const hasAlice = messages.some((m) =>
				m.content.some((c) => c.type === "text" && c.text.includes("Alice")),
			);
			return {
				content: [
					{
						type: "text",
						text: hasAlice
							? "Your name is Alice!"
							: "I do not know your name.",
					},
				],
				usage: { inputTokens: 25, outputTokens: 6 },
			};
		});

		harness.registerProvider(provider);
		const session = harness.createSession({ providerName: "multi-turn-provider" });

		const turn1 = await session.send("My name is Alice");
		expect(turn1.response).toBe("Nice to meet you, Alice!");

		const turn2 = await session.send("What is my name?");
		expect(turn2.response).toBe("Your name is Alice!");

		const history = session.getHistory();
		expect(history.length).toBeGreaterThanOrEqual(4); // 2 user + 2 assistant messages
		expect(session.getTurns().length).toBe(2);
	});

	it("S-04: should support dynamic mode switching between plan and build", () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const session = harness.createSession();

		expect(session.getState().mode).toBeDefined();
		session.setMode("plan");
		expect(session.getState().mode).toBe("plan");
		session.setMode("build");
		expect(session.getState().mode).toBe("build");
	});

	it("S-05: should support dynamic approval mode switching", () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const session = harness.createSession({ approvalMode: "auto" });

		expect(session.getState().approvalMode).toBe("auto");
		session.setApprovalMode("manual");
		expect(session.getState().approvalMode).toBe("manual");
		session.setApprovalMode("yolo");
		expect(session.getState().approvalMode).toBe("yolo");
	});

	it("S-06: should support dynamic provider and model switching", () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const provider1 = new MockSDKProvider("provider-a");
		const provider2 = new MockSDKProvider("provider-b");
		harness.registerProvider(provider1);
		harness.registerProvider(provider2);

		const session = harness.createSession({
			providerName: "provider-a",
			modelName: "model-v1",
		});

		expect(session.getState().providerName).toBe("provider-a");
		expect(session.getState().modelName).toBe("model-v1");

		session.setProvider("provider-b", "model-v2");
		expect(session.getState().providerName).toBe("provider-b");
		expect(session.getState().modelName).toBe("model-v2");

		session.setModel("model-v2-turbo");
		expect(session.getState().modelName).toBe("model-v2-turbo");
	});

	it("S-07: reset() should clear conversation history, turns, and reset state", async () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const provider = new MockSDKProvider("reset-provider");
		provider.queueTextResponse("First response");
		harness.registerProvider(provider);

		const session = harness.createSession({ providerName: "reset-provider" });
		await session.send("Hello 1");

		expect(session.getHistory().length).toBeGreaterThan(0);
		expect(session.getTurns().length).toBe(1);

		session.reset();

		expect(session.getHistory().length).toBe(0);
		expect(session.getTurns().length).toBe(0);
		expect(session.getState().turnCount).toBe(0);
	});

	it("S-08: should trigger event listeners for tool_call, tool_result, response, and done", async () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const provider = new MockSDKProvider("listener-provider");

		provider.queueToolCallResponse("calc_tool", { a: 5, b: 3 }, "call_calc_1");
		provider.queueTextResponse("5 + 3 is 8");

		const calcTool = createMockTool("calc_tool", async (input) => ({
			result: String(input.a + input.b),
			isError: false,
		}));

		harness.registerProvider(provider);
		harness.registerTool(calcTool);

		const session = harness.createSession({
			providerName: "listener-provider",
			approvalMode: "yolo",
		});

		const toolCallsReceived: any[] = [];
		const toolResultsReceived: any[] = [];
		const responsesReceived: string[] = [];

		const unsubToolCall = session.onToolCall((e) => toolCallsReceived.push(e));
		const unsubToolResult = session.onToolResult((e) => toolResultsReceived.push(e));
		const unsubResponse = session.onResponse((text) => responsesReceived.push(text));

		await session.send("Add 5 and 3");

		expect(toolCallsReceived.length).toBe(1);
		expect(toolCallsReceived[0].toolName).toBe("calc_tool");
		expect(toolResultsReceived.length).toBe(1);
		expect(toolResultsReceived[0].result).toBe("8");
		expect(responsesReceived.length).toBe(1);
		expect(responsesReceived[0]).toContain("8");

		// Test unsubscribe
		unsubToolCall();
		unsubToolResult();
		unsubResponse();

		provider.queueTextResponse("Second message");
		await session.send("Another message");

		expect(responsesReceived.length).toBe(1); // Unsubscribed, did not increment
	});

	// ==========================================
	// TIER 2: BOUNDARY & ERROR CONDITIONS
	// ==========================================

	it("S-09: should handle provider error and propagate error event", async () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const provider = new MockSDKProvider("erroring-provider");
		provider.queueResponse(() => {
			throw new Error("Provider rate limit reached (429)");
		});

		harness.registerProvider(provider);
		const session = harness.createSession({ providerName: "erroring-provider" });

		let errorEventCaught = false;
		session.onError(() => {
			errorEventCaught = true;
		});

		await expect(session.send("Should fail")).rejects.toThrow("Provider rate limit reached");
		expect(errorEventCaught).toBe(true);
	});

	it("S-10: should terminate agent loop when maxIterations is reached", async () => {
		const harness = new Harness({
			loadDiskConfig: false,
			projectRoot: tempDir,
			maxIterations: 2,
		});
		const provider = new MockSDKProvider("looping-provider");

		// Repeatedly request tool calls without generating text
		provider.queueToolCallResponse("noop_tool", {}, "call_1");
		provider.queueToolCallResponse("noop_tool", {}, "call_2");
		provider.queueToolCallResponse("noop_tool", {}, "call_3");

		const noopTool = createMockTool("noop_tool", async () => ({
			result: "ok",
			isError: false,
		}));

		harness.registerProvider(provider);
		harness.registerTool(noopTool);

		const session = harness.createSession({
			providerName: "looping-provider",
			approvalMode: "yolo",
			maxIterations: 2,
		});

		const result = await session.send("Loop forever");
		expect(result).toBeDefined();
		const doneEvent = result.events.find((e) => e.type === "done");
		expect(doneEvent).toBeDefined();
	});

	it("S-11: should handle empty prompt gracefully", async () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const provider = new MockSDKProvider("empty-prompt-provider");
		provider.queueTextResponse("Handled empty prompt");
		harness.registerProvider(provider);

		const session = harness.createSession({ providerName: "empty-prompt-provider" });
		const result = await session.send("");
		expect(result.response).toBe("Handled empty prompt");
	});

	it("S-12: should accumulate token usage and update session state accurately", async () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const provider = new MockSDKProvider("tokens-provider");
		provider.queueTextResponse("Resp 1", { inputTokens: 50, outputTokens: 20 });
		provider.queueTextResponse("Resp 2", { inputTokens: 80, outputTokens: 40 });

		harness.registerProvider(provider);
		const session = harness.createSession({ providerName: "tokens-provider" });

		await session.send("Turn 1");
		const state1 = session.getState();
		expect(state1.inputTokens).toBe(50);
		expect(state1.outputTokens).toBe(20);
		expect(state1.totalTokens).toBe(70);

		await session.send("Turn 2");
		const state2 = session.getState();
		expect(state2.inputTokens).toBe(130);
		expect(state2.outputTokens).toBe(60);
		expect(state2.totalTokens).toBe(190);
	});

	// ==========================================
	// TIER 3: CROSS-FEATURE COMBINATIONS
	// ==========================================

	it("S-13: should enforce mode tool restrictions when switching modes mid-session", async () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const provider = new MockSDKProvider("mode-switch-provider");

		// In plan mode: attempting write tool should be blocked
		provider.queueToolCallResponse("write_file", { path: "test.txt", content: "data" }, "call_w1");
		provider.queueTextResponse("Plan mode blocked the write.");

		// In build mode: write tool should succeed
		provider.queueToolCallResponse("write_file", { path: "test.txt", content: "data" }, "call_w2");
		provider.queueTextResponse("File written in build mode.");

		harness.registerProvider(provider);

		const session = harness.createSession({
			providerName: "mode-switch-provider",
			mode: "plan",
			approvalMode: "yolo",
		});

		// First turn in plan mode
		const resPlan = await session.send("Write a file please");
		expect(resPlan.events.some((e) => e.type === "tool_result" && (e as any).isError)).toBe(true);

		// Switch to build mode
		session.setMode("build");
		expect(session.getState().mode).toBe("build");

		const resBuild = await session.send("Try writing the file again");
		expect(resBuild.response).toContain("File written in build mode");
	});

	it("S-14: dynamic provider switching mid-conversation retains history and continues dialogue", async () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const providerAlpha = new MockSDKProvider("alpha-provider");
		const providerBeta = new MockSDKProvider("beta-provider");

		providerAlpha.queueTextResponse("Alpha: remembered fact X");
		providerBeta.queueResponse((messages) => {
			const hasHistory = messages.length > 2;
			return {
				content: [{ type: "text", text: `Beta: history length is ${messages.length}, hasHistory=${hasHistory}` }],
				usage: { inputTokens: 30, outputTokens: 10 },
			};
		});

		harness.registerProvider(providerAlpha);
		harness.registerProvider(providerBeta);

		const session = harness.createSession({ providerName: "alpha-provider" });

		await session.send("Fact X: The sky is blue");
		expect(session.getState().providerName).toBe("alpha-provider");

		// Switch to Beta provider
		session.setProvider("beta-provider");
		expect(session.getState().providerName).toBe("beta-provider");

		const res = await session.send("What history do you have?");
		expect(res.response).toContain("hasHistory=true");
	});

	// ==========================================
	// TIER 4: REAL-WORLD SCENARIOS
	// ==========================================

	it("S-15: should complete full realistic software engineering session workflow", async () => {
		const harness = new Harness({
			loadDiskConfig: false,
			projectRoot: tempDir,
		});

		const mockLLM = new MockSDKProvider("swe-provider");

		// Phase 1: Planning phase (read file & analyze)
		mockLLM.queueToolCallResponse("read_file", { path: "package.json" }, "c1");
		mockLLM.queueTextResponse("Plan: We need to upgrade package version to 1.0.0");

		// Phase 2: Build phase (modify file & verify)
		mockLLM.queueToolCallResponse("edit_file", { path: "package.json", oldText: "0.1.0", newText: "1.0.0" }, "c2");
		mockLLM.queueTextResponse("Version successfully upgraded to 1.0.0");

		harness.registerProvider(mockLLM);

		const session = harness.createSession({
			providerName: "swe-provider",
			mode: "plan",
			approvalMode: "yolo",
		});

		// Step 1: In plan mode, analyze codebase
		const planResult = await session.send("Analyze package.json and create upgrade plan");
		expect(planResult.response).toContain("Plan:");
		expect(session.getState().mode).toBe("plan");

		// Step 2: Switch to build mode and execute upgrade
		session.setMode("build");
		const buildResult = await session.send("Execute the upgrade now");
		expect(buildResult.response).toContain("Version successfully upgraded");
		expect(session.getTurns().length).toBe(2);
		expect(session.getState().totalTokens).toBeGreaterThan(0);
	});
});
