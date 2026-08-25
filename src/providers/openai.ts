import type { ContentBlock, Message, ToolDefinition } from "../agent/types.ts";
import type { Provider, ProviderCallConfig, ProviderResponse } from "./base.ts";

export class OpenAIProvider implements Provider {
	public name = "openai";

	constructor(
		private apiKey: string,
		private baseUrl = "https://api.openai.com/v1",
	) {}

	async chat(
		messages: Message[],
		tools: ToolDefinition[],
		config: ProviderCallConfig,
	): Promise<ProviderResponse> {
		const openaiMessages = this.convertMessages(messages);

		const body: any = {
			model: config.model,
			messages: openaiMessages,
			max_tokens: config.maxTokens ?? 4096,
		};

		if (config.temperature !== undefined) {
			body.temperature = config.temperature;
		}

		if (tools.length > 0) {
			body.tools = tools.map((tool) => ({
				type: "function",
				function: {
					name: tool.name,
					description: tool.description,
					parameters: tool.inputSchema,
				},
			}));
		}

		if (config.systemPrompt) {
			body.messages.unshift({
				role: "system",
				content: config.systemPrompt,
			});
		}

		if (!this.apiKey || this.apiKey.trim() === "" || this.apiKey.includes("YOUR_")) {
			const envVarName = this.name.toUpperCase().includes("OPENROUTER") ? "OPENROUTER_API_KEY" : "OPENAI_API_KEY";
			throw new Error(
				`No API key configured for provider "${this.name}". Please run 'my-code setup' or set the ${envVarName} environment variable.`,
			);
		}

		const response = await fetch(`${this.baseUrl}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${text}`);
		}

		const data = await response.json();
		return this.parseResponse(data);
	}

	private convertMessages(messages: Message[]): any[] {
		const result: any[] = [];

		for (const msg of messages) {
			if (msg.role === "system" || msg.role === "user") {
				const textContent = msg.content
					.filter((c) => c.type === "text")
					.map((c) => c.text)
					.join("\n");

				result.push({
					role: msg.role,
					content: textContent,
				});
			} else if (msg.role === "assistant") {
				const textContent = msg.content
					.filter((c) => c.type === "text")
					.map((c) => c.text)
					.join("\n");

				const toolCalls = msg.content
					.filter((c) => c.type === "tool_use")
					.map((c) => {
						if (c.type !== "tool_use") return null;
						return {
							id: c.id,
							type: "function",
							function: {
								name: c.name,
								arguments: JSON.stringify(c.input),
							},
						};
					})
					.filter(Boolean);

				const assistantMsg: any = { role: "assistant" };
				if (textContent) {
					assistantMsg.content = textContent;
				}
				if (toolCalls.length > 0) {
					assistantMsg.tool_calls = toolCalls;
				}

				result.push(assistantMsg);
			} else if (msg.role === "tool") {
				for (const block of msg.content) {
					if (block.type === "tool_result") {
						result.push({
							role: "tool",
							tool_call_id: block.toolUseId,
							content: block.content,
						});
					}
				}
			}
		}

		return result;
	}

	private parseResponse(data: any): ProviderResponse {
		const message = data.choices[0]?.message;
		const contentBlocks: ContentBlock[] = [];

		if (message?.content) {
			contentBlocks.push({
				type: "text",
				text: message.content,
			});
		}

		if (message?.tool_calls) {
			for (const call of message.tool_calls) {
				if (call.type === "function") {
					let input = {};
					try {
						input = JSON.parse(call.function.arguments || "{}");
					} catch (e) {
						// fallback for invalid json
					}

					contentBlocks.push({
						type: "tool_use",
						id: call.id,
						name: call.function.name,
						input,
					});
				}
			}
		}

		return {
			content: contentBlocks,
			usage: data.usage
				? {
						inputTokens: data.usage.prompt_tokens,
						outputTokens: data.usage.completion_tokens,
					}
				: undefined,
			stopReason: data.choices[0]?.finish_reason,
		};
	}
}
