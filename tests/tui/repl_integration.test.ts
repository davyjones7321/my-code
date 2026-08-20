import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough, Writable } from "node:stream";

import type { Message, ToolDefinition } from "../../src/agent/types.ts";
import type { Provider, ProviderCallConfig, ProviderResponse } from "../../src/providers/base.ts";
import { ReplEngine, startRepl } from "../../src/tui/repl.ts";
import { stripAnsi } from "../../src/tui/status-bar.ts";

/**
 * Memory output buffer capturing writes
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
 * Deterministic programmable mock provider
 */
class MockScriptedProvider implements Provider {
	public name = "mock-provider";
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
			content: [{ type: "text", text: "Default mock reply." }],
			usage: { inputTokens: 20, outputTokens: 10 },
		};
	}
}

describe("Phase 9 REPL Engine Integration Suite", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-repl-test-"));
	});

	afterEach(async () => {
		try {
			await fs.rm(tempDir, { recursive: true, force: true });
		} catch {}
	});

	it("should execute a multi-turn conversation and preserve context history across turns", async () => {
		const mockProvider = new MockScriptedProvider();

		// Turn 1 response
		mockProvider.queueResponse({
			content: [{ type: "text", text: "Paris is the capital of France." }],
			usage: { inputTokens: 12, outputTokens: 8 },
		});

		// Turn 2 response
		mockProvider.queueResponse({
			content: [{ type: "text", text: "The population of Paris is approximately 2.1 million." }],
			usage: { inputTokens: 28, outputTokens: 14 },
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

		// Inject mock provider
		(engine as any).currentProvider = mockProvider;
		(engine as any).session.setProvider(mockProvider.name, "mock-model");

		const startPromise = engine.start();

		input.write("What is the capital of France?\n");
		input.write("What is its population?\n");
		input.write("/exit\n");
		input.end();

		await startPromise;

		expect(mockProvider.calls.length).toBe(2);

		// Turn 1 inspection
		const call1 = mockProvider.calls[0];
		expect(call1.messages.length).toBe(1);
		expect(call1.messages[0].role).toBe("user");
		expect((call1.messages[0].content[0] as any).text).toBe("What is the capital of France?");

		// Turn 2 inspection (should retain full conversation context)
		const call2 = mockProvider.calls[1];
		expect(call2.messages.length).toBe(3);
		expect(call2.messages[0].role).toBe("user");
		expect((call2.messages[0].content[0] as any).text).toBe("What is the capital of France?");
		expect(call2.messages[1].role).toBe("assistant");
		expect((call2.messages[1].content[0] as any).text).toBe("Paris is the capital of France.");
		expect(call2.messages[2].role).toBe("user");
		expect((call2.messages[2].content[0] as any).text).toBe("What is its population?");

		// Session metrics inspection
		const sessionState = engine.getSession().getState();
		expect(sessionState.turnCount).toBe(2);
		expect(sessionState.inputTokens).toBe(40); // 12 + 28
		expect(sessionState.outputTokens).toBe(22); // 8 + 14
		expect(sessionState.totalTokens).toBe(62);
		expect(sessionState.estimatedCost).toBeGreaterThan(0);

		// Output verification
		const cleanOutput = output.getCleanOutput();
		expect(cleanOutput).toContain("Paris is the capital of France.");
		expect(cleanOutput).toContain("The population of Paris is approximately 2.1 million.");
		expect(cleanOutput).toContain("Exiting harness REPL");
	});

	it("should execute tools and render tool cards and results during a REPL turn", async () => {
		const testFilePath = path.join(tempDir, "sample.txt");
		await fs.writeFile(testFilePath, "Hello from harness tool test!", "utf8");

		const mockProvider = new MockScriptedProvider();

		// Iteration 1: call read_file
		mockProvider.queueResponse({
			content: [
				{
					type: "tool_use",
					id: "tool_1",
					name: "read_file",
					input: { path: "sample.txt" },
				},
			],
			usage: { inputTokens: 30, outputTokens: 10 },
		});

		// Iteration 2: assistant summary
		mockProvider.queueResponse({
			content: [
				{
					type: "text",
					text: "The sample.txt file contains: Hello from harness tool test!",
				},
			],
			usage: { inputTokens: 45, outputTokens: 15 },
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

		input.write("Inspect sample.txt\n");
		input.write("/exit\n");
		input.end();

		await startPromise;

		expect(mockProvider.calls.length).toBe(2);

		const cleanOutput = output.getCleanOutput();
		expect(cleanOutput).toContain("[Tool Call: read_file]");
		expect(cleanOutput).toContain("[Tool Result: read_file]");
		expect(cleanOutput).toContain("Hello from harness tool test!");
		expect(cleanOutput).toContain("The sample.txt file contains: Hello from harness tool test!");

		const turns = engine.getSession().getTurns();
		expect(turns.length).toBe(1);
		expect(turns[0].toolEvents).toBeDefined();
		expect(turns[0].toolEvents?.length).toBe(2);
	});

	it("should dynamically switch model and mode mid-session and apply to subsequent turns", async () => {
		const mockProvider = new MockScriptedProvider();

		mockProvider.queueResponse({
			content: [{ type: "text", text: "Turn 1 answer." }],
		});
		mockProvider.queueResponse({
			content: [{ type: "text", text: "Turn 2 answer with new settings." }],
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

		input.write("Turn 1 prompt\n");
		input.write("/model gpt-4o\n");
		input.write("/mode plan\n");
		input.write("Turn 2 prompt\n");
		input.write("/exit\n");
		input.end();

		await startPromise;

		expect(mockProvider.calls.length).toBe(2);
		expect(mockProvider.calls[0].config.model).toBe("default");
		expect(mockProvider.calls[1].config.model).toBe("gpt-4o");

		const sessionState = engine.getSession().getState();
		expect(sessionState.modelName).toBe("gpt-4o");
		expect(sessionState.mode).toBe("plan");
		expect(engine.getControlLayer().getModeController().getMode()).toBe("plan");

		const cleanOutput = output.getCleanOutput();
		expect(cleanOutput).toContain("Active model updated to: gpt-4o");
		expect(cleanOutput).toContain("Agent mode set to: [PLAN]");
	});

	it("should execute shell passthrough commands with safety approval checking", async () => {
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

		// Safe command
		input.write("!echo shell_passthrough_success\n");
		// Dangerous command in auto mode
		input.write("!rm -rf /\n");
		input.write("/exit\n");
		input.end();

		await startPromise;

		const cleanOutput = output.getCleanOutput();
		expect(cleanOutput).toContain("shell_passthrough_success");
		expect(cleanOutput).toContain("[Control Denied]");
	});

	it("should abort an active turn when requested without killing the session", async () => {
		let callCount = 0;
		const mockProvider: Provider = {
			name: "abortable-mock",
			async chat() {
				callCount++;
				if (callCount === 1) {
					// Simulate slow generation
					await new Promise((resolve) => setTimeout(resolve, 50));
				}
				return {
					content: [{ type: "text", text: "Completed response." }],
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

		// Execute turn and immediately abort
		const turnPromise = engine.executeTurn("Slow prompt");
		expect(engine.isTurnGenerating()).toBe(true);

		engine.abortCurrentTurn();
		await turnPromise;

		expect(engine.isTurnGenerating()).toBe(false);

		// Next turn should execute cleanly
		await engine.executeTurn("Second prompt");
		const cleanOutput = output.getCleanOutput();
		expect(cleanOutput).toContain("Completed response.");
		expect(engine.getSession().getState().turnCount).toBeGreaterThanOrEqual(1);
	});

	it("should handle multiline prompts with trailing backslash continuation", async () => {
		const mockProvider = new MockScriptedProvider();
		mockProvider.queueResponse({
			content: [{ type: "text", text: "Multiline handled." }],
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

		input.write("first line \\\nsecond line \\\nthird line\n");
		input.write("/exit\n");
		input.end();

		await startPromise;

		expect(mockProvider.calls.length).toBe(1);
		const promptText = (mockProvider.calls[0].messages[0].content[0] as any).text;
		expect(promptText).toBe("first line \nsecond line \nthird line");
	});

	it("should handle multiline prompts with triple quotes", async () => {
		const mockProvider = new MockScriptedProvider();
		mockProvider.queueResponse({
			content: [{ type: "text", text: "Triple quotes handled." }],
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

		input.write('"""\nconst a = 1;\nconst b = 2;\n"""\n');
		input.write("/exit\n");
		input.end();

		await startPromise;

		expect(mockProvider.calls.length).toBe(1);
		const promptText = (mockProvider.calls[0].messages[0].content[0] as any).text;
		expect(promptText).toContain("const a = 1;");
		expect(promptText).toContain("const b = 2;");
	});

	it("should export startRepl helper and run without exceptions", async () => {
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
