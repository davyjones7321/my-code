import type { Message, ToolDefinition } from "../../src/agent/types.ts";
import type { Provider, ProviderCallConfig, ProviderResponse } from "../../src/providers/base.ts";
import { SubagentManager } from "../../src/subagents/manager.ts";
import { SubagentTypeRegistry } from "../../src/subagents/registry.ts";
import { ToolRegistry } from "../../src/tools/registry.ts";

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
 * Programmable mock provider for multi-turn and tool-calling agent flows
 */
export class MockMultiTurnProvider implements Provider {
	public name = "mock-multi-turn";
	private responses: Array<
		| ProviderResponse
		| ((
				messages: Message[],
				tools?: ToolDefinition[],
				callConfig?: ProviderCallConfig,
		  ) => ProviderResponse | Promise<ProviderResponse>)
	>;
	private callIndex = 0;
	public callHistory: Array<{
		messages: Message[];
		tools?: ToolDefinition[];
		callConfig?: ProviderCallConfig;
	}> = [];

	constructor(
		responses: Array<
			| ProviderResponse
			| ((
					messages: Message[],
					tools?: ToolDefinition[],
					callConfig?: ProviderCallConfig,
			  ) => ProviderResponse | Promise<ProviderResponse>)
		> = [],
	) {
		this.responses = [...responses];
	}

	public queueResponse(
		response:
			| ProviderResponse
			| ((
					messages: Message[],
					tools?: ToolDefinition[],
					callConfig?: ProviderCallConfig,
			  ) => ProviderResponse | Promise<ProviderResponse>),
	): void {
		this.responses.push(response);
	}

	public clear(): void {
		this.responses = [];
		this.callIndex = 0;
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

		if (this.callIndex >= this.responses.length) {
			return {
				content: [
					{
						type: "text",
						text: `Default mock fallback response (turn ${this.callIndex + 1})`,
					},
				],
			};
		}

		const handler = this.responses[this.callIndex++];
		if (typeof handler === "function") {
			return await handler(messages, tools, callConfig);
		}
		return handler;
	}
}

/**
 * Creates a configured SubagentManager for testing with mock tools and provider
 */
export function createTestManager(
	options: {
		provider?: Provider;
		projectRoot?: string;
		maxConcurrentSubagents?: number;
	} = {},
): {
	manager: SubagentManager;
	provider: MockMultiTurnProvider;
	toolRegistry: ToolRegistry;
	typeRegistry: SubagentTypeRegistry;
} {
	const provider =
		(options.provider as MockMultiTurnProvider) || new MockMultiTurnProvider();
	const toolRegistry = new ToolRegistry();
	const typeRegistry = new SubagentTypeRegistry();
	const projectRoot = options.projectRoot || "D:/test/project/root";

	// Register basic mock tools
	toolRegistry.register({
		name: "read_file",
		description: "Read file mock",
		inputSchema: {
			type: "object",
			properties: { path: { type: "string" } },
			required: ["path"],
		},
		execute: async (input) => ({
			result: `Content of ${input.path}`,
			isError: false,
		}),
	});

	toolRegistry.register({
		name: "glob_files",
		description: "Glob files mock",
		inputSchema: {
			type: "object",
			properties: { pattern: { type: "string" } },
			required: ["pattern"],
		},
		execute: async (input) => ({
			result: `Matched files for ${input.pattern}`,
			isError: false,
		}),
	});

	toolRegistry.register({
		name: "grep_search",
		description: "Grep search mock",
		inputSchema: {
			type: "object",
			properties: { query: { type: "string" } },
			required: ["query"],
		},
		execute: async (input) => ({
			result: `Matches for ${input.query}`,
			isError: false,
		}),
	});

	toolRegistry.register({
		name: "write_file",
		description: "Write file mock",
		inputSchema: {
			type: "object",
			properties: { path: { type: "string" }, content: { type: "string" } },
			required: ["path", "content"],
		},
		execute: async (input) => ({
			result: `Wrote ${input.content} to ${input.path}`,
			isError: false,
		}),
	});

	toolRegistry.register({
		name: "edit_file",
		description: "Edit file mock",
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string" },
				oldText: { type: "string" },
				newText: { type: "string" },
			},
			required: ["path", "oldText", "newText"],
		},
		execute: async (input) => ({
			result: `Replaced in ${input.path}`,
			isError: false,
		}),
	});

	toolRegistry.register({
		name: "run_command",
		description: "Run command mock",
		inputSchema: {
			type: "object",
			properties: { command: { type: "string" } },
			required: ["command"],
		},
		execute: async (input) => ({
			result: `Executed: ${input.command}`,
			isError: false,
		}),
	});

	toolRegistry.register({
		name: "recall_facts",
		description: "Recall facts mock",
		inputSchema: {
			type: "object",
			properties: { query: { type: "string" } },
			required: ["query"],
		},
		execute: async (input) => ({
			result: `Facts matching ${input.query}`,
			isError: false,
		}),
	});

	toolRegistry.register({
		name: "remember_fact",
		description: "Remember fact mock",
		inputSchema: {
			type: "object",
			properties: { fact: { type: "string" } },
			required: ["fact"],
		},
		execute: async (input) => ({
			result: `Remembered: ${input.fact}`,
			isError: false,
		}),
	});

	toolRegistry.register({
		name: "get_diagnostics",
		description: "Get diagnostics mock",
		inputSchema: {
			type: "object",
			properties: { filePath: { type: "string" } },
		},
		execute: async (input) => ({
			result: `Diagnostics for ${input.filePath || "project"}`,
			isError: false,
		}),
	});

	toolRegistry.register({
		name: "get_definition",
		description: "Get definition mock",
		inputSchema: {
			type: "object",
			properties: {
				filePath: { type: "string" },
				line: { type: "number" },
				column: { type: "number" },
			},
			required: ["filePath", "line", "column"],
		},
		execute: async (input) => ({
			result: `Definition at ${input.filePath}:${input.line}:${input.column}`,
			isError: false,
		}),
	});

	toolRegistry.register({
		name: "find_references",
		description: "Find references mock",
		inputSchema: {
			type: "object",
			properties: {
				filePath: { type: "string" },
				line: { type: "number" },
				column: { type: "number" },
			},
			required: ["filePath", "line", "column"],
		},
		execute: async (input) => ({
			result: `References for ${input.filePath}:${input.line}:${input.column}`,
			isError: false,
		}),
	});

	const manager = new SubagentManager({
		provider,
		toolRegistry,
		typeRegistry,
		projectRoot,
		maxConcurrentSubagents: options.maxConcurrentSubagents || 50,
	});

	return { manager, provider, toolRegistry, typeRegistry };
}
