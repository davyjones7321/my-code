import type { ContentBlock, Message, ToolDefinition } from "../agent/types.ts";
import type { Provider, ProviderCallConfig, ProviderResponse } from "./base.ts";

export class AnthropicProvider implements Provider {
	name = "anthropic";

	constructor(
		private apiKey: string,
		private baseUrl = "https://api.anthropic.com/v1/messages",
	) {}

	async chat(
		messages: Message[],
		tools: ToolDefinition[],
		config: ProviderCallConfig,
	): Promise<ProviderResponse> {
		const systemPrompt = config.systemPrompt;

		// Convert our messages to Anthropic format
		const anthropicMessages = messages
			.filter((m) => m.role !== "system")
			.map((msg) => {
				let role = msg.role;
				if (role === "tool") {
					role = "user"; // Anthropic expects tool results as user messages
				}

				const content = msg.content.map((block) => {
					if (block.type === "text") {
						return { type: "text", text: block.text };
					} else if (block.type === "tool_use") {
						return {
							type: "tool_use",
							id: block.id,
							name: block.name,
							input: block.input,
						};
					} else if (block.type === "tool_result") {
						return {
							type: "tool_result",
							tool_use_id: block.toolUseId,
							content: block.content,
							is_error: block.isError,
						};
					}
					return block;
				});

				return {
					role,
					content,
				};
			});

		const anthropicTools = tools.map((tool) => ({
			name: tool.name,
			description: tool.description,
			input_schema: tool.inputSchema,
		}));

		const body: Record<string, unknown> = {
			model: config.model,
			max_tokens: config.maxTokens ?? 4096,
			messages: anthropicMessages,
		};

		if (systemPrompt) {
			body.system = systemPrompt;
		}

		if (anthropicTools.length > 0) {
			body.tools = anthropicTools;
		}

		if (config.temperature !== undefined) {
			body.temperature = config.temperature;
		}

		const response = await fetch(this.baseUrl, {
			method: "POST",
			headers: {
				"x-api-key": this.apiKey,
				"anthropic-version": "2023-06-01",
				"content-type": "application/json",
			},
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(
				`Anthropic API error: ${response.status} ${response.statusText} - ${errorText}`,
			);
		}

		const data = await response.json();

		const resultBlocks: ContentBlock[] = data.content.map((block: any) => {
			if (block.type === "text") {
				return { type: "text", text: block.text };
			} else if (block.type === "tool_use") {
				return {
					type: "tool_use",
					id: block.id,
					name: block.name,
					input: block.input,
				};
			}
			// other blocks?
			return { type: "text", text: JSON.stringify(block) };
		});

		return {
			content: resultBlocks,
			usage: {
				inputTokens: data.usage?.input_tokens ?? 0,
				outputTokens: data.usage?.output_tokens ?? 0,
			},
			stopReason: data.stop_reason,
		};
	}
}
