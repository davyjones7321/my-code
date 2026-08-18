import type { ToolExecutor } from "../agent/loop.ts";
import type { ToolDefinition } from "../agent/types.ts";

export interface ToolResult {
	result: string;
	isError: boolean;
}

/** A tool that can be registered and executed */
export interface Tool {
	/** Unique name */
	name: string;
	/** Human-readable description */
	description: string;
	/** JSON Schema for input validation */
	inputSchema: Record<string, unknown>;
	/** Execute the tool with validated input */
	execute(input: Record<string, unknown>): Promise<ToolResult>;
}

export class ToolRegistry {
	private tools: Map<string, Tool> = new Map();

	/** Register a tool */
	register(tool: Tool): void {
		this.tools.set(tool.name, tool);
	}

	/** Get a tool by name */
	get(name: string): Tool | undefined {
		return this.tools.get(name);
	}

	/** Get all tool definitions (for sending to LLM) */
	getDefinitions(): ToolDefinition[] {
		return Array.from(this.tools.values()).map((tool) => ({
			name: tool.name,
			description: tool.description,
			inputSchema: tool.inputSchema,
		}));
	}

	/** Get all tools as ToolExecutors (for the agent loop) */
	getExecutors(): ToolExecutor[] {
		return Array.from(this.tools.values()).map((tool) => ({
			name: tool.name,
			execute: tool.execute.bind(tool),
		}));
	}

	/** List registered tool names */
	list(): string[] {
		return Array.from(this.tools.keys());
	}
}
