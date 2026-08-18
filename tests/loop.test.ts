import { describe, expect, it } from "bun:test";
import { type ToolExecutor, runAgentLoop } from "../src/agent/loop.ts";
import type { AgentLoopConfig } from "../src/agent/types.ts";
import type { Provider, ProviderResponse } from "../src/providers/base.ts";

class MockProvider implements Provider {
	name = "mock";
	private responses: ProviderResponse[];
	private callIndex = 0;

	constructor(responses: ProviderResponse[]) {
		this.responses = responses;
	}

	async chat(): Promise<ProviderResponse> {
		return this.responses[this.callIndex++];
	}
}

describe("runAgentLoop", () => {
	const tools: ToolExecutor[] = [
		{
			name: "echo",
			async execute(input: any) {
				if (input.message === "error_me") {
					return { result: "an error occurred", isError: true };
				}
				return { result: `echoed: ${input.message}`, isError: false };
			},
		},
	];

	const config: AgentLoopConfig = {
		maxIterations: 3,
		systemPrompt: "sys",
		tools: [
			{
				name: "echo",
				description: "echo",
				inputSchema: {},
			},
		],
	};

	it("Simple response: yields response and done", async () => {
		const provider = new MockProvider([
			{
				content: [{ type: "text", text: "Hello" }],
			},
		]);

		const events = [];
		for await (const event of runAgentLoop(provider, "Hi", tools, config)) {
			events.push(event);
		}

		expect(events.length).toBe(2);
		expect(events[0]).toEqual({ type: "response", text: "Hello" });
		expect(events[1]).toEqual({ type: "done", totalIterations: 1 });
	});

	it("Tool use cycle: tool_use -> tool executes -> response", async () => {
		const provider = new MockProvider([
			{
				content: [{ type: "tool_use", id: "1", name: "echo", input: { message: "hi" } }],
			},
			{
				content: [{ type: "text", text: "Final answer" }],
			},
		]);

		const events = [];
		for await (const event of runAgentLoop(provider, "Hi", tools, config)) {
			events.push(event);
		}

		expect(events.length).toBe(4);
		expect(events[0]).toEqual({
			type: "tool_call",
			toolName: "echo",
			toolInput: { message: "hi" },
			toolUseId: "1",
		});
		expect(events[1]).toEqual({
			type: "tool_result",
			toolUseId: "1",
			result: "echoed: hi",
			isError: false,
		});
		expect(events[2]).toEqual({ type: "response", text: "Final answer" });
		expect(events[3]).toEqual({ type: "done", totalIterations: 2 });
	});

	it("Multi-turn tool use", async () => {
		const provider = new MockProvider([
			{ content: [{ type: "tool_use", id: "1", name: "echo", input: { message: "1" } }] },
			{ content: [{ type: "tool_use", id: "2", name: "echo", input: { message: "2" } }] },
			{ content: [{ type: "tool_use", id: "3", name: "echo", input: { message: "3" } }] },
			{ content: [{ type: "text", text: "Final" }] },
		]);

		const configMax4 = { ...config, maxIterations: 4 };

		const events = [];
		for await (const event of runAgentLoop(provider, "Hi", tools, configMax4)) {
			events.push(event);
		}

		expect(events.filter((e) => e.type === "tool_call").length).toBe(3);
		expect(events.filter((e) => e.type === "tool_result").length).toBe(3);
		expect(events[events.length - 2]).toEqual({ type: "response", text: "Final" });
		expect(events[events.length - 1]).toEqual({ type: "done", totalIterations: 4 });
	});

	it("Max iteration guard", async () => {
		const provider = new MockProvider([
			{ content: [{ type: "tool_use", id: "1", name: "echo", input: { message: "1" } }] },
			{ content: [{ type: "tool_use", id: "2", name: "echo", input: { message: "2" } }] },
			{ content: [{ type: "tool_use", id: "3", name: "echo", input: { message: "3" } }] },
			{ content: [{ type: "tool_use", id: "4", name: "echo", input: { message: "4" } }] },
		]);

		const events = [];
		for await (const event of runAgentLoop(provider, "Hi", tools, config)) {
			events.push(event);
		}

		// maxIterations is 3
		// It should yield 3 calls and results, and then an error
		expect(events[events.length - 1].type).toBe("error");
		// @ts-ignore
		expect(events[events.length - 1].error.message).toBe("Max iterations (3) reached");
	});

	it("Tool error handling", async () => {
		const provider = new MockProvider([
			{
				content: [{ type: "tool_use", id: "1", name: "echo", input: { message: "error_me" } }],
			},
			{
				content: [{ type: "text", text: "Okay it errored" }],
			},
		]);

		const events = [];
		for await (const event of runAgentLoop(provider, "Hi", tools, config)) {
			events.push(event);
		}

		expect(events[1]).toEqual({
			type: "tool_result",
			toolUseId: "1",
			result: "an error occurred",
			isError: true,
		});
		expect(events[2]).toEqual({ type: "response", text: "Okay it errored" });
	});
});
