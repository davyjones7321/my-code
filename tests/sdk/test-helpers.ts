import type { Message, ToolDefinition } from "../../src/agent/types.ts";
import type { Provider, ProviderCallConfig, ProviderResponse } from "../../src/providers/base.ts";
import type { Tool, ToolResult } from "../../src/tools/registry.ts";

/**
 * Deterministic deferred promise helper
 */
export class Deferred<T = void> {
	public readonly promise: Promise<T>;
	public resolve!: (value: T | PromiseLike<T>) => void;
	public reject!: (reason?: any) => void;

	constructor() {
		this.promise = new Promise<T>((res, rej) => {
			this.resolve = res;
			this.reject = rej;
		});
	}
}

/**
 * Deterministic programmable mock provider for SDK testing
 */
export class MockSDKProvider implements Provider {
	public name: string;
	public callHistory: Array<{
		messages: Message[];
		tools?: ToolDefinition[];
		callConfig?: ProviderCallConfig;
	}> = [];
	private handlers: Array<
		(
			messages: Message[],
			tools?: ToolDefinition[],
			callConfig?: ProviderCallConfig,
		) => ProviderResponse | Promise<ProviderResponse>
	> = [];

	constructor(name = "mock-sdk-provider") {
		this.name = name;
	}

	public queueResponse(
		handlerOrResponse:
			| ProviderResponse
			| ((
					messages: Message[],
					tools?: ToolDefinition[],
					callConfig?: ProviderCallConfig,
			  ) => ProviderResponse | Promise<ProviderResponse>),
	): this {
		if (typeof handlerOrResponse === "function") {
			this.handlers.push(handlerOrResponse);
		} else {
			this.handlers.push(() => handlerOrResponse);
		}
		return this;
	}

	public queueTextResponse(
		text: string,
		usage = { inputTokens: 10, outputTokens: 5 },
	): this {
		return this.queueResponse({
			content: [{ type: "text", text }],
			usage,
		});
	}

	public queueToolCallResponse(
		toolName: string,
		toolInput: Record<string, any>,
		toolUseId = `call_${Math.random().toString(36).slice(2, 8)}`,
		usage = { inputTokens: 15, outputTokens: 8 },
	): this {
		return this.queueResponse({
			content: [
				{
					type: "tool_use",
					id: toolUseId,
					name: toolName,
					input: toolInput,
				},
			],
			usage,
		});
	}

	public queueThinkingAndResponse(
		thinking: string,
		text: string,
		usage = { inputTokens: 20, outputTokens: 15 },
	): this {
		return this.queueResponse({
			content: [
				{ type: "thinking" as any, thinking } as any,
				{ type: "text", text },
			],
			usage,
		});
	}

	public clear(): void {
		this.handlers = [];
		this.callHistory = [];
	}

	public getCallCount(): number {
		return this.callHistory.length;
	}

	public async chat(
		messages: Message[],
		tools?: ToolDefinition[],
		callConfig?: ProviderCallConfig,
	): Promise<ProviderResponse> {
		this.callHistory.push({
			messages: JSON.parse(JSON.stringify(messages)),
			tools: tools ? JSON.parse(JSON.stringify(tools)) : undefined,
			callConfig: callConfig ? { ...callConfig } : undefined,
		});

		if (this.handlers.length > 0) {
			const handler = this.handlers.shift()!;
			return await handler(messages, tools, callConfig);
		}

		return {
			content: [{ type: "text", text: `Default mock response #${this.callHistory.length}` }],
			usage: { inputTokens: 5, outputTokens: 5 },
		};
	}
}

/**
 * Creates a mock Tool with customizable execution and schema
 */
export function createMockTool(
	name: string,
	executeFn: (input: any) => Promise<ToolResult> | ToolResult = async (input) => ({
		result: `Result for ${name}: ${JSON.stringify(input)}`,
		isError: false,
	}),
	options: {
		description?: string;
		properties?: Record<string, any>;
		required?: string[];
	} = {},
): Tool {
	return {
		name,
		description: options.description || `Mock tool ${name}`,
		inputSchema: {
			type: "object",
			properties: options.properties || { query: { type: "string" } },
			required: options.required || [],
		},
		execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
			return await executeFn(input);
		},
	};
}
