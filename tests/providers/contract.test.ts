import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { Message, ToolDefinition } from "../../src/agent/types.ts";
import { AnthropicProvider } from "../../src/providers/anthropic.ts";
import { OllamaProvider } from "../../src/providers/ollama.ts";
import { OpenAIProvider } from "../../src/providers/openai.ts";

const originalFetch = globalThis.fetch;

describe("Provider Contract", () => {
	let mockFetch: ReturnType<typeof mock>;

	beforeEach(() => {
		mockFetch = mock();
		globalThis.fetch = mockFetch as any;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	const providers = [
		{ name: "anthropic", instance: new AnthropicProvider("test-key") },
		{ name: "openai", instance: new OpenAIProvider("test-key") },
		{ name: "ollama", instance: new OllamaProvider() },
	];

	const messages: Message[] = [{ role: "user", content: [{ type: "text", text: "Hello" }] }];
	const tools: ToolDefinition[] = [
		{ name: "get_weather", description: "Get weather", inputSchema: {} },
	];
	const config = { model: "test-model" };

	for (const providerInfo of providers) {
		describe(`${providerInfo.name} normalizes responses identically`, () => {
			it("handles text-only response", async () => {
				if (providerInfo.name === "anthropic") {
					mockFetch.mockResolvedValue(
						new Response(
							JSON.stringify({
								content: [{ type: "text", text: "Hi there!" }],
								usage: { input_tokens: 10, output_tokens: 5 },
								stop_reason: "end_turn",
							}),
						),
					);
				} else {
					mockFetch.mockResolvedValue(
						new Response(
							JSON.stringify({
								choices: [{ message: { content: "Hi there!" }, finish_reason: "stop" }],
								usage: { prompt_tokens: 10, completion_tokens: 5 },
							}),
						),
					);
				}

				const response = await providerInfo.instance.chat(messages, tools, config);

				expect(response.content.length).toBe(1);
				expect(response.content[0]).toEqual({ type: "text", text: "Hi there!" });
			});

			it("handles tool use response", async () => {
				if (providerInfo.name === "anthropic") {
					mockFetch.mockResolvedValue(
						new Response(
							JSON.stringify({
								content: [
									{ type: "tool_use", id: "tool-1", name: "get_weather", input: { loc: "NY" } },
								],
								usage: { input_tokens: 10, output_tokens: 5 },
								stop_reason: "tool_use",
							}),
						),
					);
				} else {
					mockFetch.mockResolvedValue(
						new Response(
							JSON.stringify({
								choices: [
									{
										message: {
											tool_calls: [
												{
													id: "tool-1",
													type: "function",
													function: { name: "get_weather", arguments: '{"loc":"NY"}' },
												},
											],
										},
										finish_reason: "tool_calls",
									},
								],
								usage: { prompt_tokens: 10, completion_tokens: 5 },
							}),
						),
					);
				}

				const response = await providerInfo.instance.chat(messages, tools, config);

				expect(response.content.length).toBe(1);
				expect(response.content[0]).toEqual({
					type: "tool_use",
					id: "tool-1",
					name: "get_weather",
					input: { loc: "NY" },
				});
			});

			it("handles mixed response", async () => {
				if (providerInfo.name === "anthropic") {
					mockFetch.mockResolvedValue(
						new Response(
							JSON.stringify({
								content: [
									{ type: "text", text: "Let me check." },
									{ type: "tool_use", id: "tool-1", name: "get_weather", input: { loc: "NY" } },
								],
								usage: { input_tokens: 10, output_tokens: 5 },
								stop_reason: "tool_use",
							}),
						),
					);
				} else {
					mockFetch.mockResolvedValue(
						new Response(
							JSON.stringify({
								choices: [
									{
										message: {
											content: "Let me check.",
											tool_calls: [
												{
													id: "tool-1",
													type: "function",
													function: { name: "get_weather", arguments: '{"loc":"NY"}' },
												},
											],
										},
										finish_reason: "tool_calls",
									},
								],
								usage: { prompt_tokens: 10, completion_tokens: 5 },
							}),
						),
					);
				}

				const response = await providerInfo.instance.chat(messages, tools, config);

				expect(response.content.length).toBe(2);
				expect(response.content[0]).toEqual({ type: "text", text: "Let me check." });
				expect(response.content[1]).toEqual({
					type: "tool_use",
					id: "tool-1",
					name: "get_weather",
					input: { loc: "NY" },
				});
			});
		});
	}
});
