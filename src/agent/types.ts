/** Role in a conversation */
export type MessageRole = "system" | "user" | "assistant" | "tool";

/** A content block (text or tool use) */
export interface TextContent {
	type: "text";
	text: string;
}

export interface ToolUseContent {
	type: "tool_use";
	id: string;
	name: string;
	input: Record<string, unknown>;
}

export interface ToolResultContent {
	type: "tool_result";
	toolUseId: string;
	content: string;
	isError?: boolean;
}

export type ContentBlock = TextContent | ToolUseContent | ToolResultContent;

/** A message in the conversation */
export interface Message {
	role: MessageRole;
	content: ContentBlock[];
}

/** Tool definition for LLM */
export interface ToolDefinition {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>; // JSON Schema
}

/** Events emitted by the agent loop */
export type LoopEvent =
	| { type: "thinking"; message: string }
	| { type: "tool_call"; toolName: string; toolInput: Record<string, unknown>; toolUseId: string }
	| { type: "tool_result"; toolUseId: string; result: string; isError: boolean }
	| { type: "response"; text: string }
	| { type: "error"; error: Error }
	| { type: "done"; totalIterations: number };

/** A stream chunk from a provider */
export interface StreamChunk {
	type: "text_delta" | "tool_use_start" | "tool_use_delta" | "tool_use_end" | "done";
	text?: string;
	toolUseId?: string;
	toolName?: string;
	inputDelta?: string;
}

/** Agent loop configuration */
export interface AgentLoopConfig {
	maxIterations: number;
	systemPrompt: string;
	tools: ToolDefinition[];
}
