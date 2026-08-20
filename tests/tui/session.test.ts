import { describe, expect, it } from "bun:test";
import type { LoopEvent } from "../../src/agent/types.ts";
import { ReplSession } from "../../src/tui/session.ts";

describe("TUI ReplSession Subsystem", () => {
	describe("Initialization & Default State", () => {
		it("should initialize with sensible defaults and valid UUID", () => {
			const session = new ReplSession();
			const state = session.getState();

			expect(state.id).toBeDefined();
			expect(typeof state.id).toBe("string");
			expect(state.id.length).toBeGreaterThan(10);
			expect(state.mode).toBe("build");
			expect(state.approvalMode).toBe("manual");
			expect(state.turnCount).toBe(0);
			expect(state.inputTokens).toBe(0);
			expect(state.outputTokens).toBe(0);
			expect(state.totalTokens).toBe(0);
			expect(state.estimatedCost).toBe(0);
			expect(state.createdAt).toBeGreaterThan(0);
			expect(state.updatedAt).toBeGreaterThan(0);
			expect(state.startTime).toBeGreaterThan(0);
			expect(session.getMessages()).toEqual([]);
			expect(session.getTurns()).toEqual([]);
		});

		it("should accept custom initial configuration", () => {
			const session = new ReplSession({
				id: "custom-session-id",
				providerName: "anthropic",
				modelName: "claude-3-7-sonnet",
				mode: "plan",
				approvalMode: "yolo",
			});
			const state = session.getState();

			expect(state.id).toBe("custom-session-id");
			expect(state.providerName).toBe("anthropic");
			expect(state.modelName).toBe("claude-3-7-sonnet");
			expect(state.mode).toBe("plan");
			expect(state.approvalMode).toBe("yolo");
		});
	});

	describe("Turn Addition & History Recording", () => {
		it("should record a turn and update token counts and costs", () => {
			const session = new ReplSession({
				providerName: "anthropic",
				modelName: "claude-3-7-sonnet",
			});

			const turn = session.addTurn("Hello, assistant!", "Hello, human!", {
				inputTokens: 1000,
				outputTokens: 500,
			});

			expect(turn.turnIndex).toBe(1);
			expect(turn.userPrompt).toBe("Hello, assistant!");
			expect(turn.assistantResponse).toBe("Hello, human!");
			expect(turn.inputTokens).toBe(1000);
			expect(turn.outputTokens).toBe(500);
			expect(turn.totalTokens).toBe(1500);
			expect(turn.cost).toBeGreaterThan(0);

			const state = session.getState();
			expect(state.turnCount).toBe(1);
			expect(state.inputTokens).toBe(1000);
			expect(state.outputTokens).toBe(500);
			expect(state.totalTokens).toBe(1500);
			expect(state.estimatedCost).toBeCloseTo(turn.cost, 6);

			const messages = session.getMessages();
			expect(messages.length).toBe(2);
			expect(messages[0].role).toBe("user");
			expect(messages[1].role).toBe("assistant");
			expect(session.getHistory().length).toBe(2);
		});

		it("should accumulate tokens and costs linearly across multiple turns", () => {
			const session = new ReplSession({
				providerName: "openai",
				modelName: "gpt-4o",
			});

			session.addTurn("Turn 1", "Resp 1", { inputTokens: 100, outputTokens: 50 });
			session.addTurn("Turn 2", "Resp 2", { inputTokens: 200, outputTokens: 100 });
			session.addTurn("Turn 3", "Resp 3", { inputTokens: 300, outputTokens: 150 });

			const state = session.getState();
			expect(state.turnCount).toBe(3);
			expect(state.inputTokens).toBe(600);
			expect(state.outputTokens).toBe(300);
			expect(state.totalTokens).toBe(900);
			expect(session.getTurns().length).toBe(3);
			expect(session.getMessages().length).toBe(6);
		});

		it("should capture tool events within turn records", () => {
			const session = new ReplSession();
			const toolEvents: LoopEvent[] = [
				{
					type: "tool_call",
					toolName: "read_file",
					toolInput: { path: "test.txt" },
					toolUseId: "call_123",
				},
				{
					type: "tool_result",
					toolUseId: "call_123",
					result: "file contents",
					isError: false,
				},
			];

			const turn = session.addTurn("Read file", "Here is the file", undefined, toolEvents);
			expect(turn.toolEvents).toBeDefined();
			expect(turn.toolEvents?.length).toBe(2);
			expect(turn.toolEvents?.[0].type).toBe("tool_call");
		});

		it("should handle missing or empty usage gracefully", () => {
			const session = new ReplSession();
			const turn = session.addTurn("Prompt", "Response");

			expect(turn.inputTokens).toBe(0);
			expect(turn.outputTokens).toBe(0);
			expect(turn.totalTokens).toBe(0);
			expect(turn.cost).toBe(0);
		});
	});

	describe("State Getters & Setters", () => {
		it("should update mode and validate inputs", () => {
			const session = new ReplSession();
			expect(session.getState().mode).toBe("build");

			session.setMode("plan");
			expect(session.getState().mode).toBe("plan");

			session.setMode("build");
			expect(session.getState().mode).toBe("build");

			expect(() => session.setMode("invalid" as any)).toThrow();
		});

		it("should update model and provider", () => {
			const session = new ReplSession();
			session.setModel("gpt-4o", "openai");

			const state = session.getState();
			expect(state.modelName).toBe("gpt-4o");
			expect(state.providerName).toBe("openai");

			session.setProvider("anthropic", "claude-3-7-sonnet");
			const updated = session.getState();
			expect(updated.providerName).toBe("anthropic");
			expect(updated.modelName).toBe("claude-3-7-sonnet");

			expect(() => session.setModel("")).toThrow();
		});

		it("should update approval mode and validate inputs", () => {
			const session = new ReplSession();
			session.setApprovalMode("auto");
			expect(session.getState().approvalMode).toBe("auto");

			session.setApprovalMode("yolo");
			expect(session.getState().approvalMode).toBe("yolo");

			expect(() => session.setApprovalMode("invalid" as any)).toThrow();
		});

		it("should update tokens directly via updateTokens", () => {
			const session = new ReplSession({ providerName: "openai", modelName: "gpt-4o" });
			session.updateTokens(500, 250);

			const state = session.getState();
			expect(state.inputTokens).toBe(500);
			expect(state.outputTokens).toBe(250);
			expect(state.totalTokens).toBe(750);
			expect(state.estimatedCost).toBeGreaterThan(0);
		});
	});

	describe("ContextManager Synchronization", () => {
		it("should synchronize messages with ContextManager", async () => {
			const session = new ReplSession();
			session.addTurn("User msg 1", "Assistant msg 1");

			const context = await session.getContext();
			expect(context.length).toBeGreaterThanOrEqual(2);

			const usage = session.getTokenUsage();
			expect(usage.budget).toBeGreaterThan(0);
			expect(usage.percentage).toBeGreaterThanOrEqual(0);
		});

		it("should support direct message addition", async () => {
			const session = new ReplSession();
			session.addMessage({
				role: "user",
				content: [{ type: "text", text: "Direct message" }],
			});

			expect(session.getMessages().length).toBe(1);
			const context = await session.getContext();
			expect(context.length).toBeGreaterThanOrEqual(1);
		});
	});

	describe("Session Reset", () => {
		it("should reset all turns, messages, and token counters", () => {
			const session = new ReplSession({
				providerName: "anthropic",
				modelName: "claude-3-7-sonnet",
			});

			session.addTurn("Prompt", "Response", { inputTokens: 500, outputTokens: 200 });
			expect(session.getState().turnCount).toBe(1);
			expect(session.getTurns().length).toBe(1);
			expect(session.getMessages().length).toBe(2);

			session.reset();

			const state = session.getState();
			expect(state.turnCount).toBe(0);
			expect(state.inputTokens).toBe(0);
			expect(state.outputTokens).toBe(0);
			expect(state.totalTokens).toBe(0);
			expect(state.estimatedCost).toBe(0);
			expect(session.getTurns().length).toBe(0);
			expect(session.getMessages().length).toBe(0);
		});
	});

	describe("Transcript Exports & Serialization", () => {
		it("should export session as valid JSON and restore via fromJSON", () => {
			const session = new ReplSession({
				id: "test-session-uuid",
				providerName: "anthropic",
				modelName: "claude-3-7-sonnet",
				mode: "plan",
				approvalMode: "auto",
			});

			session.addTurn("Step 1", "Done step 1", { inputTokens: 100, outputTokens: 50 });
			session.addTurn("Step 2", "Done step 2", { inputTokens: 200, outputTokens: 100 });

			const jsonStr = session.exportTranscript("json");
			expect(session.exportSession()).toBe(jsonStr);

			const parsed = JSON.parse(jsonStr);
			expect(parsed.version).toBe("1.0");
			expect(parsed.session.id).toBe("test-session-uuid");
			expect(parsed.turns.length).toBe(2);
			expect(parsed.messages.length).toBe(4);

			// Reconstruct from JSON
			const restored = ReplSession.fromJSON(jsonStr);
			const restoredState = restored.getState();

			expect(restoredState.id).toBe("test-session-uuid");
			expect(restoredState.turnCount).toBe(2);
			expect(restoredState.inputTokens).toBe(300);
			expect(restoredState.outputTokens).toBe(150);
			expect(restoredState.totalTokens).toBe(450);
			expect(restored.getTurns().length).toBe(2);
			expect(restored.getMessages().length).toBe(4);
		});

		it("should load JSON into an existing session via loadSession", () => {
			const session1 = new ReplSession();
			session1.addTurn("User 1", "Assistant 1", { inputTokens: 50, outputTokens: 25 });
			const jsonStr = session1.exportTranscript("json");

			const session2 = new ReplSession();
			session2.loadSession(jsonStr);

			expect(session2.getState().turnCount).toBe(1);
			expect(session2.getTurns().length).toBe(1);
			expect(session2.getMessages().length).toBe(2);
		});

		it("should export formatted Markdown transcript", () => {
			const session = new ReplSession({
				providerName: "openai",
				modelName: "gpt-4o",
			});

			session.addTurn("Write a python script", "Here is your script:\n```python\nprint('hello')\n```", {
				inputTokens: 100,
				outputTokens: 50,
			});

			const md = session.exportTranscript("markdown");
			expect(md).toContain("# REPL Session Transcript");
			expect(md).toContain("| **Provider** | `openai` |");
			expect(md).toContain("| **Model** | `gpt-4o` |");
			expect(md).toContain("## Turn 1");
			expect(md).toContain("### 👤 User");
			expect(md).toContain("### 🤖 Assistant");
		});

		it("should throw for unsupported export format", () => {
			const session = new ReplSession();
			expect(() => session.exportTranscript("yaml" as any)).toThrow();
		});
	});
});
