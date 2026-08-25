import type { HarnessConfig } from "../config/index.ts";
import { AnthropicProvider } from "./anthropic.ts";
import type { Provider } from "./base.ts";
import { OllamaProvider } from "./ollama.ts";
import { OpenAIProvider } from "./openai.ts";

export class ProviderRegistry {
	private providers: Map<string, Provider> = new Map();

	/** Register a provider */
	register(provider: Provider): void {
		this.providers.set(provider.name, provider);
	}

	/** Get a provider by name */
	get(name: string): Provider | undefined {
		return this.providers.get(name);
	}

	/** List all registered provider names */
	list(): string[] {
		return Array.from(this.providers.keys());
	}

	/** Create and register providers from config */
	static fromConfig(config: HarnessConfig): ProviderRegistry {
		const registry = new ProviderRegistry();
		const rawProviders = config.providers || {};

		// Auto-detect environment variables for zero-config CLI usage
		const envOpenRouter = process.env.OPENROUTER_API_KEY;
		const envAnthropic = process.env.ANTHROPIC_API_KEY;
		const envOpenAI = process.env.OPENAI_API_KEY;

		if (envOpenRouter) {
			const p = new OpenAIProvider(envOpenRouter, "https://openrouter.ai/api/v1");
			p.name = "openrouter";
			registry.register(p);
		}

		if (envAnthropic) {
			const p = new AnthropicProvider(envAnthropic);
			p.name = "anthropic";
			registry.register(p);
		}

		if (envOpenAI) {
			const p = new OpenAIProvider(envOpenAI);
			p.name = "openai";
			registry.register(p);
		}

		for (const [name, providerConfig] of Object.entries(rawProviders)) {
			let provider: Provider;

			let apiKey = providerConfig.apiKey;
			if (!apiKey || apiKey.includes("YOUR_")) {
				if (name.toLowerCase().includes("openrouter") && envOpenRouter) {
					apiKey = envOpenRouter;
				} else if (name.toLowerCase().includes("anthropic") && envAnthropic) {
					apiKey = envAnthropic;
				} else if (name.toLowerCase().includes("openai") && envOpenAI) {
					apiKey = envOpenAI;
				} else {
					apiKey = envOpenRouter || envAnthropic || envOpenAI || "";
				}
			}

			const isOpenRouter =
				name.toLowerCase().includes("openrouter") ||
				(providerConfig.baseUrl && providerConfig.baseUrl.includes("openrouter.ai"));
			const isOllama =
				name.toLowerCase().includes("ollama") ||
				(providerConfig.baseUrl && providerConfig.baseUrl.includes("localhost:11434"));
			const isAnthropic =
				!isOpenRouter &&
				(name.toLowerCase().includes("anthropic") ||
					(providerConfig.model && providerConfig.model.startsWith("claude")));

			if (!apiKey && !isOllama) {
				continue; // Skip registering unauthenticated provider if no key is present
			}

			if (isOpenRouter) {
				provider = new OpenAIProvider(
					apiKey || envOpenRouter || "",
					providerConfig.baseUrl || "https://openrouter.ai/api/v1",
				);
				provider.name = name;
			} else if (isAnthropic) {
				provider = new AnthropicProvider(apiKey || envAnthropic || "", providerConfig.baseUrl);
				provider.name = name;
			} else if (isOllama) {
				provider = new OllamaProvider(providerConfig.baseUrl, providerConfig.apiKey);
				provider.name = name;
			} else {
				provider = new OpenAIProvider(apiKey || envOpenAI || "", providerConfig.baseUrl);
				provider.name = name;
			}

			registry.register(provider);
		}

		return registry;
	}
}
