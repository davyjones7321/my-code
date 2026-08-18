import type { Provider } from './base.ts';
import { AnthropicProvider } from './anthropic.ts';
import { OpenAIProvider } from './openai.ts';
import { OllamaProvider } from './ollama.ts';
import type { HarnessConfig } from '../config/index.ts';

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

    if (!config.providers) {
      return registry;
    }

    for (const [name, providerConfig] of Object.entries(config.providers)) {
      let provider: Provider;
      
      const isOpenRouter = name.toLowerCase().includes('openrouter') || (providerConfig.baseUrl && providerConfig.baseUrl.includes('openrouter.ai'));
      const isOllama = name.toLowerCase().includes('ollama') || (providerConfig.baseUrl && providerConfig.baseUrl.includes('localhost:11434'));
      const isAnthropic = !isOpenRouter && (name.toLowerCase().includes('anthropic') || (providerConfig.model && providerConfig.model.startsWith('claude')));

      if (isOpenRouter) {
        provider = new OpenAIProvider(providerConfig.apiKey, providerConfig.baseUrl || 'https://openrouter.ai/api/v1');
        provider.name = name;
      } else if (isAnthropic) {
        provider = new AnthropicProvider(providerConfig.apiKey, providerConfig.baseUrl);
        provider.name = name;
      } else if (isOllama) {
        provider = new OllamaProvider(providerConfig.baseUrl, providerConfig.apiKey);
        provider.name = name;
      } else {
        provider = new OpenAIProvider(providerConfig.apiKey, providerConfig.baseUrl);
        provider.name = name;
      }

      registry.register(provider);
    }

    return registry;
  }
}
