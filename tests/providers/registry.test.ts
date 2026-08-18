import { describe, expect, it } from "bun:test";
import type { HarnessConfig } from "../../src/config/index.ts";
import { AnthropicProvider } from "../../src/providers/anthropic.ts";
import { OllamaProvider } from "../../src/providers/ollama.ts";
import { OpenAIProvider } from "../../src/providers/openai.ts";
import { ProviderRegistry } from "../../src/providers/registry.ts";

describe("ProviderRegistry", () => {
	it("registers, gets, and lists providers", () => {
		const registry = new ProviderRegistry();
		const provider = new OpenAIProvider("test-key");
		provider.name = "my-openai";

		registry.register(provider);

		expect(registry.get("my-openai")).toBe(provider);
		expect(registry.list()).toEqual(["my-openai"]);
		expect(registry.get("nonexistent")).toBeUndefined();
	});

	it("creates providers from config", () => {
		const config: HarnessConfig = {
			defaultProvider: "openai",
			approvalMode: "manual",
			maxIterations: 5,
			projectRoot: ".",
			providers: {
				"anthropic-prod": {
					apiKey: "key",
					model: "claude-3",
				},
				openai: {
					apiKey: "key",
					model: "gpt-4",
				},
				"ollama-local": {
					apiKey: "test",
					model: "llama3",
					baseUrl: "http://localhost:11434/v1",
				},
				"some-anthropic": {
					apiKey: "key",
					model: "claude-3-opus-20240229",
				},
			},
		};

		const registry = ProviderRegistry.fromConfig(config);

		expect(registry.list().length).toBe(4);

		const anthropicProd = registry.get("anthropic-prod");
		expect(anthropicProd).toBeInstanceOf(AnthropicProvider);
		expect(anthropicProd?.name).toBe("anthropic-prod");

		const openai = registry.get("openai");
		expect(openai).toBeInstanceOf(OpenAIProvider);
		expect(openai?.name).toBe("openai");

		const ollama = registry.get("ollama-local");
		expect(ollama).toBeInstanceOf(OllamaProvider);
		expect(ollama?.name).toBe("ollama-local");

		const someAnthropic = registry.get("some-anthropic");
		expect(someAnthropic).toBeInstanceOf(AnthropicProvider);
		expect(someAnthropic?.name).toBe("some-anthropic");
	});
});
