import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough, Writable } from "node:stream";

import type { ContentBlock, LoopEvent, Message, ToolDefinition } from "../../src/agent/types.ts";
import type { Provider, ProviderCallConfig, ProviderResponse } from "../../src/providers/base.ts";
import { ReplEngine } from "../../src/tui/repl.ts";
import { ReplSession } from "../../src/tui/session.ts";
import { stripAnsi } from "../../src/tui/status-bar.ts";

/**
 * Memory Writable capture stream
 */
class MemoryWritable extends Writable {
	public chunks: string[] = [];

	_write(chunk: any, _encoding: string, callback: (error?: Error | null) => void) {
		this.chunks.push(chunk.toString());
		callback();
	}

	public getOutput(): string {
		return this.chunks.join("");
	}

	public getCleanOutput(): string {
		return stripAnsi(this.getOutput());
	}

	public clear(): void {
		this.chunks = [];
	}
}

/**
 * Controllable Mock Provider for Stress & Adversarial Testing
 */
class ScriptableMockProvider implements Provider {
	public name: string;
	public calls: Array<{
		messages: Message[];
		tools: ToolDefinition[];
		config: ProviderCallConfig;
	}> = [];

	private responseGenerators: Array<
		(messages: Message[], tools: ToolDefinition[], config: ProviderCallConfig) => Promise<ProviderResponse> | ProviderResponse
	> = [];

	constructor(name = "mock-scriptable-provider") {
		this.name = name;
	}

	public queueResponse(
		generatorOrResponse:
			| ProviderResponse
			| ((messages: Message[], tools: ToolDefinition[], config: ProviderCallConfig) => Promise<ProviderResponse> | ProviderResponse),
	): this {
		if (typeof generatorOrResponse === "function") {
			this.responseGenerators.push(generatorOrResponse);
		} else {
			this.responseGenerators.push(() => generatorOrResponse);
		}
		return this;
	}

	public async chat(
		messages: Message[],
		tools: ToolDefinition[],
		config: ProviderCallConfig,
	): Promise<ProviderResponse> {
		this.calls.push({
			messages: JSON.parse(JSON.stringify(messages)),
			tools: [...tools],
			config: { ...config },
		});

		if (this.responseGenerators.length > 0) {
			const gen = this.responseGenerators.shift()!;
			return await gen(messages, tools, config);
		}

		return {
			content: [{ type: "text", text: `Mock response for turn with ${messages.length} messages.` }],
			usage: { inputTokens: 50, outputTokens: 25 },
		};
	}
}

describe("Empirical Challenger M3 & M4: REPL Engine Stress & Adversarial Test Suite", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-challenger-m3-"));
	});

	afterEach(async () => {
		try {
			await fs.rm(tempDir, { recursive: true, force: true });
		} catch {}
	});

	describe("1. 20-Turn Consecutive Multi-Turn Session Stress & Retention", () => {
		it("should accurately maintain unbroken conversational history, token accumulation, and cost across 20 consecutive turns", async () => {
			const mockProvider = new ScriptableMockProvider("multi-turn-stress-provider");
			const input = new PassThrough();
			const output = new MemoryWritable();

			const engine = new ReplEngine({
				input,
				output,
				isTTY: false,
				welcomeMessage: false,
				projectRoot: tempDir,
			});

			(engine as any).currentProvider = mockProvider;
			(engine as any).session.setProvider(mockProvider.name, "gpt-4o");

			// Queue 20 distinct responses
			const turnFacts: string[] = [];
			for (let i = 1; i <= 20; i++) {
				const fact = `Fact #${i}: key_${i} is value_${i}`;
				turnFacts.push(fact);
				mockProvider.queueResponse({
					content: [{ type: "text", text: `Understood and recorded ${fact}.` }],
					usage: { inputTokens: 10 * i, outputTokens: 5 * i },
				});
			}

			const startPromise = engine.start();

			// Send 20 consecutive turns
			for (let i = 1; i <= 20; i++) {
				input.write(`User prompt ${i}: remember ${turnFacts[i - 1]}\n`);
			}
			input.write("/exit\n");
			input.end();

			await startPromise;

			// Verify 20 provider calls occurred
			expect(mockProvider.calls.length).toBe(20);

			// Inspect message history growth across all 20 turns
			for (let i = 0; i < 20; i++) {
				const call = mockProvider.calls[i];
				// On turn i (0-indexed), there should be (2 * i) previous messages + 1 new user message = 2 * i + 1
				const expectedMessageCount = 2 * i + 1;
				expect(call.messages.length).toBe(expectedMessageCount);

				// Verify the latest message is the current turn's prompt
				const lastMsg = call.messages[call.messages.length - 1];
				expect(lastMsg.role).toBe("user");
				expect((lastMsg.content[0] as any).text).toBe(`User prompt ${i + 1}: remember ${turnFacts[i]}`);

				// Verify all prior facts are preserved in order
				for (let prior = 0; prior < i; prior++) {
					const priorUserMsg = call.messages[prior * 2];
					const priorAssistantMsg = call.messages[prior * 2 + 1];

					expect(priorUserMsg.role).toBe("user");
					expect((priorUserMsg.content[0] as any).text).toContain(`Fact #${prior + 1}`);

					expect(priorAssistantMsg.role).toBe("assistant");
					expect((priorAssistantMsg.content[0] as any).text).toContain(`Understood and recorded Fact #${prior + 1}`);
				}
			}

			// Verify Session State and Cumulative Accounting
			const session = engine.getSession();
			const state = session.getState();
			expect(state.turnCount).toBe(20);

			// Cumulative input tokens: sum(10 * i for i=1..20) = 10 * (20 * 21 / 2) = 2100
			const expectedInputTokens = 10 * ((20 * 21) / 2);
			// Cumulative output tokens: sum(5 * i for i=1..20) = 5 * (20 * 21 / 2) = 1050
			const expectedOutputTokens = 5 * ((20 * 21) / 2);

			expect(state.inputTokens).toBe(expectedInputTokens);
			expect(state.outputTokens).toBe(expectedOutputTokens);
			expect(state.totalTokens).toBe(expectedInputTokens + expectedOutputTokens);
			expect(state.estimatedCost).toBeGreaterThan(0);

			// Verify recorded turns list
			const turns = session.getTurns();
			expect(turns.length).toBe(20);
			for (let i = 0; i < 20; i++) {
				expect(turns[i].turnIndex).toBe(i + 1);
				expect(turns[i].userPrompt).toContain(`Fact #${i + 1}`);
				expect(turns[i].assistantResponse).toContain(`Fact #${i + 1}`);
				expect(turns[i].inputTokens).toBe(10 * (i + 1));
				expect(turns[i].outputTokens).toBe(5 * (i + 1));
				expect(turns[i].totalTokens).toBe(15 * (i + 1));
			}

			// Verify transcript export serialization and deserialization
			const jsonTranscript = session.exportTranscript("json");
			const restoredSession = ReplSession.fromJSON(jsonTranscript, tempDir);
			expect(restoredSession.getState().turnCount).toBe(20);
			expect(restoredSession.getState().totalTokens).toBe(state.totalTokens);
			expect(restoredSession.getMessages().length).toBe(40);

			const mdTranscript = session.exportTranscript("markdown");
			expect(mdTranscript).toContain("## Turn 20");
			expect(mdTranscript).toContain("Fact #20");
		});

		it("should support reset mid-session during a 20-turn workload and cleanly continue fresh turns", async () => {
			const mockProvider = new ScriptableMockProvider("reset-stress-provider");
			const input = new PassThrough();
			const output = new MemoryWritable();

			const engine = new ReplEngine({
				input,
				output,
				isTTY: false,
				welcomeMessage: false,
				projectRoot: tempDir,
			});

			(engine as any).currentProvider = mockProvider;

			// Run 10 turns, then reset, then run 10 turns
			for (let i = 1; i <= 20; i++) {
				mockProvider.queueResponse({
					content: [{ type: "text", text: `Answer ${i}` }],
					usage: { inputTokens: 50, outputTokens: 25 },
				});
			}

			const startPromise = engine.start();

			// First 10 turns
			for (let i = 1; i <= 10; i++) {
				input.write(`Phase 1 Turn ${i}\n`);
			}

			// Issue slash reset
			input.write("/reset\n");

			// Next 10 turns
			for (let i = 1; i <= 10; i++) {
				input.write(`Phase 2 Turn ${i}\n`);
			}

			input.write("/exit\n");
			input.end();

			await startPromise;

			// Total provider calls should be 20
			expect(mockProvider.calls.length).toBe(20);

			// Call 10 (last turn of Phase 1) should have 19 messages (9*2 + 1)
			expect(mockProvider.calls[9].messages.length).toBe(19);

			// Call 11 (first turn after /reset) should have only 1 message (fresh start)
			expect(mockProvider.calls[10].messages.length).toBe(1);
			expect((mockProvider.calls[10].messages[0].content[0] as any).text).toBe("Phase 2 Turn 1");

			// Call 20 (10th turn after reset) should have 19 messages
			expect(mockProvider.calls[19].messages.length).toBe(19);

			// Final session state should reflect only post-reset metrics
			const state = engine.getSession().getState();
			expect(state.turnCount).toBe(10);
			expect(state.inputTokens).toBe(500); // 10 * 50
			expect(state.outputTokens).toBe(250); // 10 * 25
		});
	});

	describe("2. Mid-Stream Turn Aborts & State Cleanliness", () => {
		it("should abort generation mid-stream without crashing and immediately accept subsequent valid turns", async () => {
			let callIndex = 0;
			let turn2Started = false;

			const mockProvider: Provider = {
				name: "abort-midstream-provider",
				async chat(messages, tools, config) {
					callIndex++;
					if (callIndex === 2) {
						turn2Started = true;
						// Simulate an active long-running call
						await new Promise((resolve) => setTimeout(resolve, 80));
					}
					return {
						content: [{ type: "text", text: `Success on call #${callIndex}` }],
						usage: { inputTokens: 40, outputTokens: 20 },
					};
				},
			};

			const output = new MemoryWritable();
			const engine = new ReplEngine({
				output,
				isTTY: false,
				welcomeMessage: false,
				projectRoot: tempDir,
			});

			(engine as any).currentProvider = mockProvider;

			// Turn 1: Normal execution
			await engine.executeTurn("Turn 1 prompt");
			expect(engine.isTurnGenerating()).toBe(false);
			expect(engine.getSession().getState().turnCount).toBe(1);

			// Turn 2: Abort while generating
			const turn2Promise = engine.executeTurn("Turn 2 prompt to abort");
			expect(engine.isTurnGenerating()).toBe(true);

			// Trigger abort while running
			engine.abortCurrentTurn();
			await turn2Promise;

			expect(engine.isTurnGenerating()).toBe(false);

			// Turn 3: Subsequent normal execution
			await engine.executeTurn("Turn 3 prompt after abort");
			expect(engine.isTurnGenerating()).toBe(false);

			const session = engine.getSession();
			expect(session.getState().turnCount).toBeGreaterThanOrEqual(2);

			const cleanOutput = output.getCleanOutput();
			expect(cleanOutput).toContain("Success on call #1");
			expect(cleanOutput).toContain("Turn interrupted by user");
			expect(cleanOutput).toContain("Success on call #3");
		});

		it("should safely handle consecutive rapid aborts and recover gracefully", async () => {
			const mockProvider: Provider = {
				name: "rapid-abort-provider",
				async chat() {
					await new Promise((resolve) => setTimeout(resolve, 60));
					return {
						content: [{ type: "text", text: "Finished chat." }],
					};
				},
			};

			const output = new MemoryWritable();
			const engine = new ReplEngine({
				output,
				isTTY: false,
				welcomeMessage: false,
				projectRoot: tempDir,
			});

			(engine as any).currentProvider = mockProvider;

			// Abort 3 times in a row
			for (let i = 1; i <= 3; i++) {
				const p = engine.executeTurn(`Prompt abort attempt ${i}`);
				expect(engine.isTurnGenerating()).toBe(true);
				engine.abortCurrentTurn();
				await p;
				expect(engine.isTurnGenerating()).toBe(false);
			}

			// Calling abort when not generating should be a safe no-op
			expect(() => engine.abortCurrentTurn()).not.toThrow();

			// Normal turn after 3 consecutive aborts
			const normalMock: Provider = {
				name: "recovered-provider",
				async chat() {
					return {
						content: [{ type: "text", text: "Recovered successfully." }],
						usage: { inputTokens: 30, outputTokens: 15 },
					};
				},
			};
			(engine as any).currentProvider = normalMock;

			await engine.executeTurn("Recovered turn prompt");
			expect(engine.isTurnGenerating()).toBe(false);

			const cleanOutput = output.getCleanOutput();
			expect(cleanOutput).toContain("Recovered successfully.");
		});

		it("should handle aborts during multi-step tool execution loops cleanly", async () => {
			let toolCallCount = 0;
			const mockProvider: Provider = {
				name: "tool-loop-abort-provider",
				async chat(messages) {
					toolCallCount++;
					if (toolCallCount === 1) {
						return {
							content: [
								{
									type: "tool_use",
									id: "step_1",
									name: "read_file",
									input: { path: "nonexistent.txt" },
								},
							],
						};
					}
					// Step 2 simulates delay
					await new Promise((resolve) => setTimeout(resolve, 80));
					return {
						content: [{ type: "text", text: "Step 2 done." }],
					};
				},
			};

			const output = new MemoryWritable();
			const engine = new ReplEngine({
				output,
				isTTY: false,
				welcomeMessage: false,
				projectRoot: tempDir,
			});

			(engine as any).currentProvider = mockProvider;

			const turnPromise = engine.executeTurn("Execute tools and abort");
			// Wait slightly to let tool 1 run
			await new Promise((resolve) => setTimeout(resolve, 20));
			engine.abortCurrentTurn();
			await turnPromise;

			expect(engine.isTurnGenerating()).toBe(false);
		});
	});

	describe("3. Dynamic Model, Mode, and Provider Switching Mid-Session", () => {
		it("should dynamically switch models, providers, modes, and approval gates throughout a multi-turn conversation", async () => {
			const mockProvider1 = new ScriptableMockProvider("provider-one");
			const mockProvider2 = new ScriptableMockProvider("provider-two");

			const input = new PassThrough();
			const output = new MemoryWritable();

			const engine = new ReplEngine({
				input,
				output,
				isTTY: false,
				welcomeMessage: false,
				projectRoot: tempDir,
			});

			// Register both providers in the registry
			engine.getProviderRegistry().register(mockProvider1);
			engine.getProviderRegistry().register(mockProvider2);

			(engine as any).currentProvider = mockProvider1;
			(engine as any).currentModel = "model-alpha";
			(engine as any).session.setProvider(mockProvider1.name, "model-alpha");

			mockProvider1.queueResponse({
				content: [{ type: "text", text: "Response from Provider 1 (Alpha)." }],
				usage: { inputTokens: 20, outputTokens: 10 },
			});

			mockProvider1.queueResponse({
				content: [{ type: "text", text: "Response from Provider 1 (Beta)." }],
				usage: { inputTokens: 30, outputTokens: 15 },
			});

			mockProvider2.queueResponse({
				content: [{ type: "text", text: "Response from Provider 2 (Gamma)." }],
				usage: { inputTokens: 40, outputTokens: 20 },
			});

			const startPromise = engine.start();

			// Turn 1: Uses provider-one, model-alpha in default BUILD mode
			input.write("Turn 1: hello\n");

			// Switch model to model-beta on provider-one
			input.write("/model model-beta\n");

			// Turn 2: Uses provider-one, model-beta
			input.write("Turn 2: query with model beta\n");

			// Switch mode to PLAN mode
			input.write("/mode plan\n");

			// Switch provider to provider-two, model-gamma
			input.write("/model model-gamma provider-two\n");

			// Turn 3: Uses provider-two, model-gamma in PLAN mode
			input.write("Turn 3: query with provider two\n");

			// Toggle mode back to BUILD
			input.write("/mode\n");

			input.write("/exit\n");
			input.end();

			await startPromise;

			// Verify mock provider calls
			expect(mockProvider1.calls.length).toBe(2);
			expect(mockProvider1.calls[0].config.model).toBe("model-alpha");
			expect(mockProvider1.calls[1].config.model).toBe("model-beta");

			expect(mockProvider2.calls.length).toBe(1);
			expect(mockProvider2.calls[0].config.model).toBe("model-gamma");

			// Verify Turn 3 included history from Turns 1 and 2 even across provider switch
			const turn3Messages = mockProvider2.calls[0].messages;
			expect(turn3Messages.length).toBe(5); // Turn 1 (2) + Turn 2 (2) + Turn 3 User (1) = 5
			expect((turn3Messages[0].content[0] as any).text).toBe("Turn 1: hello");
			expect((turn3Messages[2].content[0] as any).text).toBe("Turn 2: query with model beta");
			expect((turn3Messages[4].content[0] as any).text).toBe("Turn 3: query with provider two");

			// Verify final state
			const sessionState = engine.getSession().getState();
			expect(sessionState.providerName).toBe("provider-two");
			expect(sessionState.modelName).toBe("model-gamma");
			expect(sessionState.mode).toBe("build"); // Toggled from plan -> build
			expect(engine.getControlLayer().getModeController().getMode()).toBe("build");

			const cleanOutput = output.getCleanOutput();
			expect(cleanOutput).toContain("Active model updated to: model-beta");
			expect(cleanOutput).toContain("Agent mode set to: [PLAN]");
			expect(cleanOutput).toContain("Active model updated to: model-gamma (Provider: provider-two)");
			expect(cleanOutput).toContain("Agent mode set to: [BUILD]");
		});

		it("should enforce read-only tool gating when switched to plan mode and allow when switched to build mode", async () => {
			const output = new MemoryWritable();
			const engine = new ReplEngine({
				output,
				isTTY: false,
				welcomeMessage: false,
				projectRoot: tempDir,
			});

			const controlLayer = engine.getControlLayer();

			// Initially BUILD mode: write_file is permitted
			const checkBuild = await controlLayer.checkToolCall("write_file", { path: "test.txt", content: "data" });
			expect(checkBuild.permitted).toBe(true);

			// Switch to PLAN mode via setMode
			engine.setMode("plan");
			expect(controlLayer.getModeController().getMode()).toBe("plan");

			// In PLAN mode, modifying tools are blocked
			const checkPlan = await controlLayer.checkToolCall("write_file", { path: "test.txt", content: "data" });
			expect(checkPlan.permitted).toBe(false);
			expect(checkPlan.reason?.toLowerCase()).toContain("plan mode");

			// Read-only tools remain permitted in PLAN mode
			const checkRead = await controlLayer.checkToolCall("read_file", { path: "test.txt" });
			expect(checkRead.permitted).toBe(true);

			// Switch back to BUILD mode
			engine.setMode("build");
			const checkBuildAgain = await controlLayer.checkToolCall("write_file", { path: "test.txt", content: "data" });
			expect(checkBuildAgain.permitted).toBe(true);
		});
	});
});
