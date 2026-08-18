import type { Message, ToolDefinition } from "../agent/types.ts";
import type { Provider, ProviderCallConfig, ProviderResponse } from "./base.ts";
import { OpenAIProvider } from "./openai.ts";

export class OllamaProvider implements Provider {
	public name = "ollama";
	private adapter: OpenAIProvider;

	constructor(
		private baseUrl = "http://localhost:11434/v1",
		apiKey = "ollama",
	) {
		this.adapter = new OpenAIProvider(apiKey, baseUrl);
	}

	async chat(
		messages: Message[],
		tools: ToolDefinition[],
		config: ProviderCallConfig,
	): Promise<ProviderResponse> {
		return this.adapter.chat(messages, tools, config);
	}
}
