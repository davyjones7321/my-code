import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough, Writable } from "node:stream";

import type { LoopEvent, Message, ToolDefinition } from "../../src/agent/types.ts";
import { ContextCompactor } from "../../src/context/compactor.ts";
import { ContextManager } from "../../src/context/manager.ts";
import type { Provider, ProviderCallConfig, ProviderResponse } from "../../src/providers/base.ts";
import { estimateCost, formatCost } from "../../src/tui/cost.ts";
import { ReplEngine, startRepl } from "../../src/tui/repl.ts";
import { ReplSession } from "../../src/tui/session.ts";
import { Spinner } from "../../src/tui/spinner.ts";
import {
	StatusBar,
	compactModelName,
	formatDuration,
	formatTokens,
	renderStatusBar,
	stripAnsi,
} from "../../src/tui/status-bar.ts";
import {
	StreamRenderer,
	computeLineDiff,
	formatDiff,
	formatMarkdown,
	formatThinking,
	formatToolCall,
	formatToolResult,
} from "../../src/tui/stream-renderer.ts";
import type { ReplSessionState, StreamEvent } from "../../src/tui/types.ts";

/**
 * Memory output buffer capturing all stream writes
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
 * Deterministic scripted mock provider for stress testing
 */
class MockScriptedProvider implements Provider {
	public name = "stress-mock-provider";
	public calls: Array<{
		messages: Message[];
		tools: ToolDefinition[];
		config: ProviderCallConfig;
	}> = [];
	private handlers: Array<
		(
			messages: Message[],
			tools: ToolDefinition[],
			config: ProviderCallConfig,
		) => ProviderResponse | Promise<ProviderResponse>
	> = [];

	public queueResponse(
		fnOrResp:
			| ProviderResponse
			| ((
					messages: Message[],
					tools: ToolDefinition[],
					config: ProviderCallConfig,
			  ) => ProviderResponse | Promise<ProviderResponse>),
	): this {
		if (typeof fnOrResp === "function") {
			this.handlers.push(fnOrResp);
		} else {
			this.handlers.push(() => fnOrResp);
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

		if (this.handlers.length > 0) {
			const nextHandler = this.handlers.shift()!;
			return await nextHandler(messages, tools, config);
		}

		return {
			content: [{ type: "text", text: `Mock response turn ${this.calls.length}` }],
			usage: { inputTokens: 50, outputTokens: 25 },
		};
	}
}

describe("Milestone M5: Interactive TUI & REPL Stress & Adversarial Hardening Suite", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-stress-test-"));
	});

	afterEach(async () => {
		try {
			await fs.rm(tempDir, { recursive: true, force: true });
		} catch {}
	});

	// =========================================================================
	// 1. 10,000 Token Fast Streaming Burst Without Memory Leaks or Dropped Chunks
	// =========================================================================
	describe("1. 10,000 Token Fast Streaming Burst", () => {
		it("should stream 10,000 token chunks rapidly with 100% byte fidelity and 0 dropped chunks", () => {
			const output = new MemoryWritable();
			const renderer = new StreamRenderer({
				output,
				isTTY: false,
				chalkEnabled: false,
			});

			const tokenCorpus = [
				"const ", "calculateMetrics ", "= ", "async ", "(payload: ", "Record<string, ", "unknown>", ") => ", "{\n",
				"  const start = ", "performance.now();\n",
				"  // Process chunk: 🚀 🔥 ✨ 💻 🦀\n",
				"  const result = ", "await executeTask(payload);\n",
				"  if (!result.success) {\n",
				"    throw new Error(`Failed with code: ${result.code}`);\n",
				"  }\n",
				"  return { duration: performance.now() - start, result };\n",
				"};\n",
				"/* End of burst block */\n",
			];

			const tokens: string[] = [];
			const tokenCount = 10000;

			for (let i = 0; i < tokenCount; i++) {
				const baseToken = tokenCorpus[i % tokenCorpus.length];
				const tokenWithId = i % 100 === 0 ? `${baseToken}/*tok_${i}*/` : baseToken;
				tokens.push(tokenWithId);
			}

			const startTime = performance.now();
			for (let i = 0; i < tokenCount; i++) {
				renderer.renderToken(tokens[i]);
			}
			const durationMs = performance.now() - startTime;

			const expectedFullText = tokens.join("");
			const actualOutput = output.getOutput();

			expect(actualOutput.length).toBe(expectedFullText.length);
			expect(actualOutput).toBe(expectedFullText);
			expect(durationMs).toBeLessThan(2000); // 10,000 tokens streamed within 2 seconds
		});

		it("should maintain stable memory footprint without unbounded buffer accumulation during 10k token stream", () => {
			const output = new MemoryWritable();
			const renderer = new StreamRenderer({
				output,
				isTTY: false,
			});

			const token = "function testBurstStreamChunk() { return 42; }\n";
			const count = 10000;

			const memBefore = process.memoryUsage().heapUsed;

			for (let i = 0; i < count; i++) {
				renderer.renderToken(token);
			}

			const memAfter = process.memoryUsage().heapUsed;
			const memDiffMB = (memAfter - memBefore) / (1024 * 1024);

			// Memory difference should be bounded and reasonable (< 50MB for 10k chunks in JS)
			expect(memDiffMB).toBeLessThan(50);
			expect(output.chunks.length).toBe(10000);
		});

		it("should stream 10,000 mixed StreamEvents through writeEvent() without error or dropped events", () => {
			const output = new MemoryWritable();
			const renderer = new StreamRenderer({
				output,
				isTTY: false,
				chalkEnabled: false,
			});

			const eventCount = 10000;
			for (let i = 0; i < eventCount; i++) {
				const mod = i % 5;
				let event: StreamEvent;

				if (mod === 0) {
					event = { type: "token", chunk: `t_${i} ` };
				} else if (mod === 1) {
					event = { type: "thinking", message: `Analyzing step ${i}` };
				} else if (mod === 2) {
					event = {
						type: "tool_call",
						toolName: "inspect_code",
						toolInput: { step: i, flag: true },
					};
				} else if (mod === 3) {
					event = {
						type: "tool_result",
						toolName: "inspect_code",
						result: `Success result for ${i}`,
						isError: false,
					};
				} else {
					event = { type: "response", text: `Completed step ${i}.` };
				}

				renderer.writeEvent(event);
			}

			const cleanOutput = output.getCleanOutput();
			expect(cleanOutput).toContain("t_0");
			expect(cleanOutput).toContain("t_9995");
			expect(cleanOutput).toContain("Analyzing step 1");
			expect(cleanOutput).toContain("[Tool Call: inspect_code]");
			expect(cleanOutput).toContain("[Tool Result: inspect_code]");
			expect(cleanOutput).toContain("Completed step 4.");
		});

		it("should execute a full ReplEngine turn with 10,000 generated tokens without hanging", async () => {
			const largeResponseText = "Word ".repeat(10000); // 10,000 words (~50KB)
			const mockProvider = new MockScriptedProvider();
			mockProvider.queueResponse({
				content: [{ type: "text", text: largeResponseText }],
				usage: { inputTokens: 50, outputTokens: 10000 },
			});

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

			const startPromise = engine.start();

			input.write("Generate large text\n");
			input.write("/exit\n");
			input.end();

			await startPromise;

			expect(mockProvider.calls.length).toBe(1);
			const sessionState = engine.getSession().getState();
			expect(sessionState.turnCount).toBe(1);
			expect(sessionState.outputTokens).toBe(10000);
			expect(sessionState.estimatedCost).toBeGreaterThan(0);

			const cleanOutput = output.getCleanOutput();
			expect(cleanOutput).toContain("Word Word Word");
			expect(cleanOutput).toContain("Exiting harness REPL");
		});

		it("should execute startRepl helper under rapid start and immediate exit", async () => {
			const input = new PassThrough();
			const output = new MemoryWritable();

			input.write("/help\n");
			input.write("/exit\n");
			input.end();

			await startRepl({
				input,
				output,
				isTTY: false,
				welcomeMessage: false,
				projectRoot: tempDir,
			});

			const cleanOutput = output.getCleanOutput();
			expect(cleanOutput).toContain("Available Commands");
			expect(cleanOutput).toContain("/help");
		});
	});

	// =========================================================================
	// 2. Rapid Keystroke and Newline Bursts
	// =========================================================================
	describe("2. Rapid Keystroke and Newline Bursts", () => {
		it("should handle 100 rapid newline bursts without creating empty turns or crashing", async () => {
			const mockProvider = new MockScriptedProvider();
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

			const startPromise = engine.start();

			// Burst 100 rapid newlines
			input.write("\n".repeat(100));
			input.write("Actual user prompt after newlines\n");
			input.write("\n".repeat(20));
			input.write("/exit\n");
			input.end();

			await startPromise;

			// Provider should only have been called ONCE for the actual prompt
			expect(mockProvider.calls.length).toBe(1);
			expect(
				(mockProvider.calls[0].messages[0].content[0] as any).text,
			).toBe("Actual user prompt after newlines");

			const state = engine.getSession().getState();
			expect(state.turnCount).toBe(1);
		});

		it("should handle rapid bursts of slash commands and mode/model switches without state desync", async () => {
			const mockProvider = new MockScriptedProvider();
			mockProvider.queueResponse({
				content: [{ type: "text", text: "Response in plan mode with gpt-4o." }],
				usage: { inputTokens: 40, outputTokens: 20 },
			});

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

			const startPromise = engine.start();

			// Rapid sequence of slash commands interleaved with extra spaces and newlines
			input.write("  /help  \n");
			input.write("/history\n");
			input.write("\n");
			input.write("/mode plan\n");
			input.write("/mode build\n");
			input.write("/mode plan\n");
			input.write("/model gpt-4o\n");
			input.write("/usage\n");
			input.write("/skills\n");
			input.write("Execute planned prompt\n");
			input.write("/exit\n");
			input.end();

			await startPromise;

			expect(mockProvider.calls.length).toBe(1);
			expect(mockProvider.calls[0].config.model).toBe("gpt-4o");

			const sessionState = engine.getSession().getState();
			expect(sessionState.mode).toBe("plan");
			expect(sessionState.modelName).toBe("gpt-4o");
			expect(sessionState.turnCount).toBe(1);

			const cleanOutput = output.getCleanOutput();
			expect(cleanOutput).toContain("Available Commands");
			expect(cleanOutput).toContain("Agent mode set to: [PLAN]");
			expect(cleanOutput).toContain("Active model updated to: gpt-4o");
			expect(cleanOutput).toContain("Response in plan mode with gpt-4o.");
		});

		it("should handle rapid interleaved multiline prompts with triple quotes and backslashes", async () => {
			const mockProvider = new MockScriptedProvider();
			mockProvider.queueResponse({
				content: [{ type: "text", text: "Multiline burst 1 processed." }],
			});
			mockProvider.queueResponse({
				content: [{ type: "text", text: "Multiline burst 2 processed." }],
			});
			mockProvider.queueResponse({
				content: [{ type: "text", text: "Multiline burst 3 processed." }],
			});

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

			const startPromise = engine.start();

			// 1. Triple double quotes
			input.write('"""\nline A1\nline A2\nline A3\n"""\n');
			// 2. Trailing backslashes
			input.write("line B1 \\\nline B2 \\\nline B3\n");
			// 3. Triple single quotes
			input.write("'''\nline C1\nline C2\n'''\n");
			input.write("/exit\n");
			input.end();

			await startPromise;

			expect(mockProvider.calls.length).toBe(3);

			const prompt1 = (mockProvider.calls[0].messages[0].content[0] as any).text;
			expect(prompt1).toContain("line A1");
			expect(prompt1).toContain("line A2");
			expect(prompt1).toContain("line A3");

			const prompt2 = (mockProvider.calls[1].messages[2].content[0] as any).text;
			expect(prompt2).toBe("line B1 \nline B2 \nline B3");

			const prompt3 = (mockProvider.calls[2].messages[4].content[0] as any).text;
			expect(prompt3).toContain("line C1");
			expect(prompt3).toContain("line C2");

			expect(engine.getSession().getState().turnCount).toBe(3);
		});

		it("should handle rapid SIGINT signals without crash or unhandled rejections", async () => {
			const input = new PassThrough();
			const output = new MemoryWritable();

			const engine = new ReplEngine({
				input,
				output,
				isTTY: false,
				welcomeMessage: false,
				projectRoot: tempDir,
			});

			const startPromise = engine.start();

			const rl = (engine as any).rl;
			expect(rl).toBeDefined();

			// Rapidly fire SIGINT twice to trigger exit
			rl.emit("SIGINT");
			rl.emit("SIGINT");

			await startPromise;

			const cleanOutput = output.getCleanOutput();
			expect(cleanOutput).toContain("Exiting harness REPL");
		});
	});

	// =========================================================================
	// 3. Large Payloads (100KB Markdown Stream, 2,000-Line Tool Outputs)
	// =========================================================================
	describe("3. Large Payloads", () => {
		it("should render a 100KB complex Markdown document without stack overflow or catastrophic regex backtracking", () => {
			let md = `# Comprehensive Architecture & Benchmark Specification\n\n`;
			md += `> This is an intensive benchmark document exceeding 100 Kilobytes of markdown content.\n\n`;

			for (let i = 1; i <= 200; i++) {
				md += `## Section ${i}: Subsystem Analysis and Performance Profile\n\n`;
				md += `Here is a detailed breakdown of **subsystem ${i}** with *italics*, ~~strikethrough~~, and \`inline_code_${i}\`.\n\n`;
				md += `* Bullet point ${i}.1 with **bold emphasis** and __alternative bold__\n`;
				md += `* Bullet point ${i}.2 with _nested italic_ and \`code snippet\`\n`;
				md += `1. Numbered item 1: initialize subsystem\n`;
				md += `2. Numbered item 2: benchmark throughput under 10k load\n\n`;
				md += `\`\`\`typescript\n`;
				md += `export class SubsystemModule${i} {\n`;
				md += `  private id = "${i}";\n`;
				md += `  public async executeTask(input: Record<string, unknown>): Promise<boolean> {\n`;
				md += `    console.log("Executing subsystem " + this.id, input);\n`;
				md += `    return true;\n`;
				md += `  }\n`;
				md += `}\n`;
				md += `\`\`\`\n\n`;
			}

			expect(md.length).toBeGreaterThan(100000); // Verify payload is > 100KB

			const startTime = performance.now();
			const renderedTTY = formatMarkdown(md, { isTTY: true, chalkEnabled: true });
			const renderedPlain = formatMarkdown(md, { isTTY: false, chalkEnabled: false });
			const durationMs = performance.now() - startTime;

			expect(renderedTTY.length).toBeGreaterThan(50000);
			expect(renderedPlain.length).toBeGreaterThan(50000);
			expect(durationMs).toBeLessThan(1000); // Must render 100KB within 1 second

			expect(renderedPlain).toContain("# Comprehensive Architecture & Benchmark Specification");
			expect(renderedPlain).toContain("## Section 200:");
			expect(renderedPlain).toContain("--- [typescript] ---");
			expect(renderedPlain).toContain("export class SubsystemModule200");
		});

		it("should format and truncate 2,000-line tool outputs cleanly to prevent terminal flood", () => {
			const lines: string[] = [];
			for (let i = 1; i <= 2000; i++) {
				lines.push(`[LOG_ENTRY_${i.toString().padStart(4, "0")}] Processed event ID ${i} timestamp=${Date.now()}`);
			}
			const hugeToolOutput = lines.join("\n");

			expect(lines.length).toBe(2000);
			expect(hugeToolOutput.length).toBeGreaterThan(100000);

			// Test TTY color format
			const cardTTY = formatToolResult("query_database", hugeToolOutput, false, {
				isTTY: true,
				chalkEnabled: true,
			});
			expect(stripAnsi(cardTTY)).toContain("Tool Result: query_database");
			expect(cardTTY).toContain("[LOG_ENTRY_0001]");
			expect(cardTTY).toContain("[LOG_ENTRY_0008]");
			expect(cardTTY).not.toContain("[LOG_ENTRY_0100]");
			expect(cardTTY).toContain("... [truncated 1992 lines,");

			// Test Non-TTY plain text format
			const cardPlain = formatToolResult("read_large_log", hugeToolOutput, true, {
				isTTY: false,
				chalkEnabled: false,
			});
			expect(cardPlain).toContain("[Tool Error: read_large_log]");
			expect(cardPlain).toContain("[LOG_ENTRY_0001]");
			expect(cardPlain).toContain("... [truncated 1992 lines,");
			expect(cardPlain).not.toContain("[LOG_ENTRY_1000]");
		});

		it("should execute a full REPL turn with a 2,000-line tool execution output seamlessly", async () => {
			const lines: string[] = [];
			for (let i = 1; i <= 2000; i++) {
				lines.push(`System diagnostic record #${i}: status=OK, latency=${(i % 20)}ms`);
			}
			const logOutput = lines.join("\n");

			const testFilePath = path.join(tempDir, "huge.log");
			await fs.writeFile(testFilePath, logOutput, "utf8");

			const mockProvider = new MockScriptedProvider();
			// Step 1: Call read_file tool
			mockProvider.queueResponse({
				content: [
					{
						type: "tool_use",
						id: "tool_huge_1",
						name: "read_file",
						input: { path: "huge.log" },
					},
				],
				usage: { inputTokens: 50, outputTokens: 20 },
			});
			// Step 2: Assistant summary response
			mockProvider.queueResponse({
				content: [
					{
						type: "text",
						text: "Inspected huge.log successfully containing 2000 diagnostic records.",
					},
				],
				usage: { inputTokens: 500, outputTokens: 25 },
			});

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

			const startPromise = engine.start();

			input.write("Inspect huge.log\n");
			input.write("/exit\n");
			input.end();

			await startPromise;

			expect(mockProvider.calls.length).toBe(2);
			const cleanOutput = output.getCleanOutput();
			expect(cleanOutput).toContain("[Tool Call: read_file]");
			expect(cleanOutput).toContain("[Tool Result: read_file]");
			expect(cleanOutput).toContain("... [truncated 1992 lines,");
			expect(cleanOutput).toContain("Inspected huge.log successfully containing 2000 diagnostic records.");

			const turns = engine.getSession().getTurns();
			expect(turns.length).toBe(1);
			expect(turns[0].toolEvents?.length).toBe(2);
		});

		it("should handle pathological formatting inputs (50,000 asterisks, unclosed fences, huge single line)", () => {
			// 50,000 asterisks
			const asterisks = "*".repeat(50000);
			const formattedAsterisks = formatMarkdown(asterisks, { isTTY: false });
			expect(typeof formattedAsterisks).toBe("string");

			// Unclosed code fence with 10,000 chars
			const unclosedFence = "```typescript\nconst x = 1;\n" + "console.log(x);\n".repeat(500);
			const formattedFence = formatMarkdown(unclosedFence, { isTTY: false });
			expect(typeof formattedFence).toBe("string");
			expect(formattedFence).toContain("const x = 1;");

			// 200,000 characters single-line string with inline formatting
			const hugeLine = "Word **bold** _italic_ `code` ".repeat(5000);
			const formattedHuge = formatMarkdown(hugeLine, { isTTY: false });
			expect(formattedHuge.length).toBeGreaterThan(100000);

			// Large line diff
			const oldDoc = "Line\n".repeat(500);
			const newDoc = "Line\nModified\n".repeat(500);
			const diff = formatDiff(oldDoc, newDoc, { isTTY: false });
			expect(diff).toContain("+ Modified");

			// computeLineDiff direct check
			const diffEntries = computeLineDiff("A\nB\nC", "A\nB_MOD\nC\nD");
			expect(diffEntries.length).toBeGreaterThan(0);

			// formatThinking on large thinking content
			const bigThinking = "Analyzing hypothesis...\n".repeat(200);
			const formattedThinking = formatThinking(bigThinking, { isTTY: false });
			expect(formattedThinking).toContain("[Thinking]");
		});
	});

	// =========================================================================
	// 4. Deep Conversational Sessions (50+ Turns with Context Compactor Integration)
	// =========================================================================
	describe("4. Deep Conversational Sessions & Context Compaction", () => {
		it("should accurately maintain state, turns, and cost across a 60-turn continuous session", () => {
			const session = new ReplSession({
				providerName: "anthropic",
				modelName: "claude-3-7-sonnet",
				projectRoot: tempDir,
			});

			const totalTurns = 60;
			let expectedInputTokens = 0;
			let expectedOutputTokens = 0;
			let expectedCost = 0;

			for (let i = 1; i <= totalTurns; i++) {
				const inTokens = 400 + i * 10;
				const outTokens = 150 + i * 5;
				expectedInputTokens += inTokens;
				expectedOutputTokens += outTokens;
				expectedCost += estimateCost("anthropic", "claude-3-7-sonnet", inTokens, outTokens);

				const userPrompt = `User question for turn ${i}: explain concept ${i}`;
				const assistantResp = `Assistant explanation for turn ${i}: concept ${i} works as follows...`;

				const turn = session.addTurn(
					userPrompt,
					assistantResp,
					{ inputTokens: inTokens, outputTokens: outTokens },
					undefined,
					120,
				);

				expect(turn.turnIndex).toBe(i);
				expect(turn.inputTokens).toBe(inTokens);
				expect(turn.outputTokens).toBe(outTokens);
				expect(turn.cost).toBeGreaterThan(0);
			}

			const state = session.getState();
			expect(state.turnCount).toBe(60);
			expect(state.inputTokens).toBe(expectedInputTokens);
			expect(state.outputTokens).toBe(expectedOutputTokens);
			expect(state.totalTokens).toBe(expectedInputTokens + expectedOutputTokens);
			expect(state.estimatedCost).toBeCloseTo(expectedCost, 4);

			expect(session.getTurns().length).toBe(60);
			expect(session.getMessages().length).toBe(120); // 60 user + 60 assistant messages
		});

		it("should directly stress-test ContextCompactor on 500 synthetic messages", async () => {
			const compactor = new ContextCompactor({
				maxTokens: 20000,
				warningThreshold: 0.5,
				criticalThreshold: 0.85,
				protectedHeadCount: 4,
				protectedTailCount: 4,
			});

			const messages: Message[] = [];
			for (let i = 0; i < 250; i++) {
				messages.push({
					role: "user",
					content: [{ type: "text", text: `User request message number ${i} with extra details.` }],
				});
				messages.push({
					role: "assistant",
					content: [
						{ type: "text", text: `Assistant answer for item ${i}.` },
						{ type: "tool_use", id: `call_${i}`, name: "fetch_data", input: { index: i } },
					],
				});
			}

			expect(messages.length).toBe(500);

			const tokens = compactor.estimateTokens(messages);
			expect(tokens).toBeGreaterThan(5000);

			const compacted = await compactor.compact(messages);
			// 4 head + 1 summary + 4 tail = 9 messages
			expect(compacted.length).toBe(9);

			expect((compacted[0].content[0] as any).text).toContain("User request message number 0");
			expect((compacted[compacted.length - 1].content[0] as any).text).toContain("Assistant answer for item 249");

			const summary = compacted.find((m) => m.role === "system");
			expect(summary).toBeDefined();
			expect((summary!.content[0] as any).text).toContain("[COMPACTED HISTORY SUMMARY]");
		});

		it("should seamlessly integrate with ContextManager and ContextCompactor during deep 60-turn session", async () => {
			const contextManager = new ContextManager({
				projectRoot: tempDir,
				maxTokens: 50000,
			});

			const session = new ReplSession({
				providerName: "openai",
				modelName: "gpt-4o",
				projectRoot: tempDir,
				contextManager,
			});

			// Populate 60 turns (120 messages)
			for (let i = 1; i <= 60; i++) {
				session.addTurn(
					`Prompt ${i}: solve task ${i}`,
					`Response ${i}: task ${i} solved completely.`,
					{ inputTokens: 500, outputTokens: 200 },
				);
			}

			expect(session.getMessages().length).toBe(120);

			const usageBefore = session.getTokenUsage();
			expect(usageBefore.estimated).toBeGreaterThan(0);
			expect(usageBefore.budget).toBe(50000);

			// Perform context compaction
			await session.compact();

			const messagesAfter = await session.getContext();
			// Tier 1 System Prompt (1) + Protected head (3) + Summary message (1) + Protected tail (3) = 8
			expect(messagesAfter.length).toBe(8);

			// Tier 1 System Prompt check
			expect(messagesAfter[0].role).toBe("system");

			// Head check
			expect(messagesAfter[1].role).toBe("user");
			expect((messagesAfter[1].content[0] as any).text).toContain("Prompt 1");

			// Summary message check
			const summaryMsg = messagesAfter.find(
				(m) => (m.content[0] as any).text?.includes("[COMPACTED HISTORY SUMMARY]"),
			);
			expect(summaryMsg).toBeDefined();

			// Tail check
			const lastMsg = messagesAfter[messagesAfter.length - 1];
			expect(lastMsg.role).toBe("assistant");
			expect((lastMsg.content[0] as any).text).toContain("Response 60");
		});

		it("should export and reload transcripts of deep 60-turn sessions with 100% structural preservation", () => {
			const session = new ReplSession({
				providerName: "anthropic",
				modelName: "claude-3-7-sonnet",
				projectRoot: tempDir,
			});

			for (let i = 1; i <= 60; i++) {
				session.addTurn(
					`User turn ${i}`,
					`Assistant turn ${i}`,
					{ inputTokens: 300, outputTokens: 100 },
				);
			}

			// Export to JSON
			const jsonTranscript = session.exportTranscript("json");
			expect(jsonTranscript.length).toBeGreaterThan(10000);
			const parsed = JSON.parse(jsonTranscript);
			expect(parsed.turns.length).toBe(60);
			expect(parsed.messages.length).toBe(120);
			expect(parsed.session.turnCount).toBe(60);

			// Export to Markdown
			const mdTranscript = session.exportTranscript("markdown");
			expect(mdTranscript).toContain("# REPL Session Transcript");
			expect(mdTranscript).toContain("## Turn 1");
			expect(mdTranscript).toContain("## Turn 60");
			expect(mdTranscript).toContain("User turn 60");
			expect(mdTranscript).toContain("Assistant turn 60");

			// Reload into new session
			const restoredSession = new ReplSession({ projectRoot: tempDir });
			restoredSession.loadSession(jsonTranscript);

			expect(restoredSession.getState().turnCount).toBe(60);
			expect(restoredSession.getState().modelName).toBe("claude-3-7-sonnet");
			expect(restoredSession.getTurns().length).toBe(60);
			expect(restoredSession.getMessages().length).toBe(120);
			expect(restoredSession.getTurns()[59].userPrompt).toBe("User turn 60");
		});

		it("should completely reset deep sessions back to pristine baseline state", () => {
			const session = new ReplSession({
				providerName: "anthropic",
				modelName: "claude-3-5-haiku",
				projectRoot: tempDir,
			});

			for (let i = 1; i <= 55; i++) {
				session.addTurn(`P${i}`, `R${i}`, { inputTokens: 100, outputTokens: 50 });
			}

			expect(session.getState().turnCount).toBe(55);
			expect(session.getState().totalTokens).toBe(55 * 150);
			expect(session.getTurns().length).toBe(55);
			expect(session.getMessages().length).toBe(110);

			session.reset();

			const cleanState = session.getState();
			expect(cleanState.turnCount).toBe(0);
			expect(cleanState.inputTokens).toBe(0);
			expect(cleanState.outputTokens).toBe(0);
			expect(cleanState.totalTokens).toBe(0);
			expect(cleanState.estimatedCost).toBe(0);
			expect(session.getTurns()).toEqual([]);
			expect(session.getMessages()).toEqual([]);
			expect(session.getTokenUsage().estimated).toBe(0);
		});
	});

	// =========================================================================
	// 5. Rapid Terminal Resize Event Storm (100 Resize Events During Streaming)
	// =========================================================================
	describe("5. Rapid Terminal Resize Event Storm", () => {
		it("should survive 100 rapid resize events during active streaming without crashing or leaking listeners", () => {
			const output = new MemoryWritable();
			const statusBar = new StatusBar({
				stream: output,
				isTTY: false,
			});

			const renderer = new StreamRenderer({
				output,
				isTTY: false,
				chalkEnabled: false,
			});

			statusBar.start();
			expect(statusBar.isActive()).toBe(true);

			const simulatedColumns = [20, 35, 59, 60, 75, 80, 99, 100, 120, 160, 220];

			for (let i = 0; i < 100; i++) {
				const cols = simulatedColumns[i % simulatedColumns.length];

				// Concurrently push streaming tokens
				renderer.renderToken(`tok_${i} `);

				// Update status bar state and trigger resize formatting
				statusBar.update(
					{
						turnCount: i + 1,
						inputTokens: (i + 1) * 100,
						outputTokens: (i + 1) * 50,
						totalTokens: (i + 1) * 150,
						estimatedCost: (i + 1) * 0.001,
					},
					{ columns: cols },
				);

				// Emit resize event
				if (typeof process !== "undefined" && process.stdout) {
					process.stdout.emit("resize");
				}

				statusBar.render();
			}

			statusBar.stop();
			expect(statusBar.isActive()).toBe(false);

			const cleanOutput = output.getCleanOutput();
			expect(cleanOutput).toContain("tok_0");
			expect(cleanOutput).toContain("tok_99");
		});

		it("should fuzz test renderStatusBar across 1,000 random column widths & edge session states", () => {
			const iterations = 1000;
			let seed = 987654321;
			const nextRandom = () => {
				seed = (seed * 1664525 + 1013904223) % 4294967296;
				return seed / 4294967296;
			};

			for (let i = 0; i < iterations; i++) {
				const col = Math.floor(nextRandom() * 300) - 10; // -10 to 290
				const turns = Math.floor(nextRandom() * 200);
				const inTokens = Math.floor(nextRandom() * 2_000_000);
				const outTokens = Math.floor(nextRandom() * 500_000);
				const cost = nextRandom() * 10;
				const duration = Math.floor(nextRandom() * 3600000);

				const state: Partial<ReplSessionState> = {
					providerName: i % 2 === 0 ? "anthropic" : "openai",
					modelName: i % 3 === 0 ? "claude-3-7-sonnet" : "gpt-4o",
					mode: i % 2 === 0 ? "plan" : "build",
					turnCount: turns,
					inputTokens: inTokens,
					outputTokens: outTokens,
					totalTokens: inTokens + outTokens,
					estimatedCost: cost,
					startTime: Date.now() - duration,
				};

				const res = renderStatusBar(state, {
					columns: col,
					chalkEnabled: false,
					lastCommandDurationMs: duration,
				});

				expect(typeof res).toBe("string");
				expect(res.length).toBeGreaterThan(0);
				expect(res.includes("NaN")).toBe(false);
				expect(res.includes("undefined")).toBe(false);
			}
		});

		it("should fuzz test utility functions (compactModelName, formatTokens, formatDuration, formatCost)", () => {
			// compactModelName
			expect(compactModelName("anthropic/claude-3-7-sonnet-20250219")).toBe("claude-3-7-sonnet");
			expect(compactModelName("openai/gpt-4o-20240806")).toBe("gpt-4o");
			expect(compactModelName("")).toBe("default");
			expect(compactModelName(null as any)).toBe("default");

			// formatTokens
			expect(formatTokens(0)).toBe("0");
			expect(formatTokens(-50)).toBe("0");
			expect(formatTokens(NaN)).toBe("0");
			expect(formatTokens(500)).toBe("500");
			expect(formatTokens(1500)).toBe("1.5k");
			expect(formatTokens(2000000)).toBe("2M");

			// formatDuration
			expect(formatDuration(0)).toBe("00:00");
			expect(formatDuration(-1000)).toBe("00:00");
			expect(formatDuration(NaN)).toBe("00:00");
			expect(formatDuration(65000)).toBe("01:05");
			expect(formatDuration(3665000)).toBe("01:01:05");

			// formatCost
			expect(formatCost(0)).toBe("$0.00");
			expect(formatCost(-1)).toBe("$0.00");
			expect(formatCost(NaN)).toBe("$0.00");
			expect(formatCost(0.0025)).toBe("$0.0025");
			expect(formatCost(1.5)).toBe("$1.50");
		});

		it("should handle spinner lifecycle safely during terminal resizes and rapid start/stop bursts", () => {
			const output = new MemoryWritable();
			const spinner = new Spinner({
				stream: output,
				isTTY: true,
			});

			for (let i = 0; i < 50; i++) {
				spinner.start(`Loading task ${i}...`);
				expect(spinner.isActive()).toBe(true);

				spinner.setText(`Executing step ${i}...`);

				if (i % 2 === 0) {
					if (typeof process !== "undefined" && process.stdout) {
						process.stdout.emit("resize");
					}
				}

				spinner.stop();
				expect(spinner.isActive()).toBe(false);
			}

			// Calling stop multiple times on inactive spinner must be a no-op
			spinner.stop();
			spinner.stop();
			expect(spinner.isActive()).toBe(false);
		});
	});
});
