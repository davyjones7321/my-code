import type { Message, ToolDefinition, ContentBlock } from '../agent/types.ts';

/** Configuration for a provider call */
export interface ProviderCallConfig {
  model: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

/** Response from a provider (non-streaming) */
export interface ProviderResponse {
  content: ContentBlock[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  stopReason?: string;
}

/** Base provider interface that all adapters must implement */
export interface Provider {
  name: string;
  
  /** Send messages to the model and get a response */
  chat(
    messages: Message[],
    tools: ToolDefinition[],
    config: ProviderCallConfig
  ): Promise<ProviderResponse>;
}
