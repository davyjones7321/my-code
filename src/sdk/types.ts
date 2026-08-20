import type {
	ContentBlock,
	Message,
	MessageRole,
	TextContent,
	ToolDefinition,
	ToolResultContent,
	ToolUseContent,
} from "../agent/types.ts";
import type { HarnessConfig, ProviderConfig } from "../config/index.ts";
import type { Provider, ProviderCallConfig, ProviderResponse } from "../providers/base.ts";
import type { ToolResult as CoreToolResult } from "../tools/registry.ts";
import type { ReplTurn } from "../tui/session.ts";

declare module "../tools/registry.ts" {
	interface Tool {
		execute(input: Record<string, unknown>): Promise<CoreToolResult> | CoreToolResult;
	}
}

/**
 * Result returned by a Tool execution.
 */
export interface ToolResult {
	result: string;
	isError: boolean;
}

/**
 * A Tool that can be registered and executed in Harness and HarnessSession.
 */
export interface Tool {
	/** Unique name */
	name: string;
	/** Human-readable description */
	description: string;
	/** JSON Schema for input validation */
	inputSchema: Record<string, unknown>;
	/** Execute the tool with validated input (supports async or sync return) */
	execute(input: Record<string, unknown>): Promise<ToolResult> | ToolResult;
}

/**
 * Configuration options for instantiating a Harness instance.
 */
export interface HarnessOptions {
	/**
	 * Whether to load configuration from ~/.harness/config.toml and .harness/config.toml.
	 * Set to false for 100% isolated in-memory test harnesses.
	 * Default: true
	 */
	loadDiskConfig?: boolean;

	/** Provider instance or default provider name */
	provider?: string | Provider;

	/** Default provider name to use */
	defaultProvider?: string;

	/** Model name to use */
	model?: string;

	/** Execution mode: "plan" (read-only) or "build" (mutating) */
	mode?: "plan" | "build";

	/** Approval mode: "auto", "manual", or "yolo" */
	approvalMode?: "auto" | "manual" | "yolo";

	/** Custom system prompt override */
	systemPrompt?: string;

	/** Project root directory path. Default: process.cwd() */
	projectRoot?: string;

	/** Maximum tool calling loop iterations per turn. Default: 50 */
	maxIterations?: number;

	/** Context token budget before compaction. Default: 128000 */
	maxTokens?: number;

	/** Provider configurations or pre-instantiated Provider instances */
	providers?: Record<string, ProviderConfig | Provider>;

	/** Custom Provider instances to register */
	customProviders?: Provider[];

	/** Custom tools to register */
	tools?: Tool[];
}

/**
 * Configuration options for creating an isolated HarnessSession.
 */
export interface SDKSessionOptions {
	/** Unique session identifier */
	id?: string;

	/** Provider instance or provider name to use for this session */
	provider?: string | Provider;

	/** Provider name to use for this session */
	providerName?: string;

	/** Model name to use for this session */
	modelName?: string;

	/** Execution mode: "plan" or "build" */
	mode?: "plan" | "build";

	/** Approval mode: "auto", "manual", or "yolo" */
	approvalMode?: "auto" | "manual" | "yolo";

	/** Custom system prompt override for this session */
	systemPrompt?: string;

	/** Project root directory path */
	projectRoot?: string;

	/** Maximum loop iterations per turn */
	maxIterations?: number;

	/** Context token budget */
	maxTokens?: number;

	/** Session-specific additional tools */
	tools?: Tool[];
}

/**
 * Options for sending prompts in a session.
 */
export interface SDKSendOptions {
	/** AbortSignal for turn cancellation */
	signal?: AbortSignal;
}

/**
 * Event emitted when the agent loop enters a thinking state.
 */
export interface ThinkingEvent {
	type: "thinking";
	message: string;
}

/**
 * Event emitted when a tool call is initiated by the model.
 */
export interface ToolCallEvent {
	type: "tool_call";
	toolName: string;
	toolInput: Record<string, unknown>;
	toolUseId: string;
}

/**
 * Event emitted when a tool execution completes.
 */
export interface ToolResultEvent {
	type: "tool_result";
	toolUseId: string;
	toolName?: string;
	result: string;
	isError: boolean;
}

/**
 * Event emitted when a textual assistant response is generated.
 */
export interface ResponseEvent {
	type: "response";
	text: string;
}

/**
 * Event emitted when an error occurs during execution.
 */
export interface ErrorEvent {
	type: "error";
	error: Error;
}

/**
 * Event emitted when an execution turn completes.
 */
export interface DoneEvent {
	type: "done";
	totalIterations: number;
}

/**
 * Union of all real-time events emitted during session execution.
 */
export type SDKEvent =
	| ThinkingEvent
	| ToolCallEvent
	| ToolResultEvent
	| ResponseEvent
	| ErrorEvent
	| DoneEvent;

/**
 * Result returned upon completion of an SDK turn.
 */
export interface SDKTurnResult {
	/** Final textual response from the assistant */
	response: string;

	/** All events emitted during the turn in chronological order */
	events: SDKEvent[];

	/** Token usage metrics for the turn */
	usage: {
		inputTokens: number;
		outputTokens: number;
		totalTokens: number;
	};

	/** Estimated monetary cost of the turn */
	cost: number;

	/** Elapsed duration of the turn in milliseconds */
	durationMs: number;

	/** Underlying turn record */
	turn: ReplTurn;
}

/**
 * Snapshot of the current session state and accumulated metrics.
 */
export interface SDKSessionState {
	/** Unique session ID */
	id: string;

	/** Total completed conversation turns */
	turnCount: number;

	/** Total input tokens consumed */
	inputTokens: number;

	/** Total output tokens consumed */
	outputTokens: number;

	/** Total tokens consumed */
	totalTokens: number;

	/** Total estimated cost across all turns */
	estimatedCost: number;

	/** Active provider name */
	providerName: string;

	/** Active model name */
	modelName: string;

	/** Active execution mode ("plan" | "build") */
	mode: "plan" | "build";

	/** Active approval mode ("auto" | "manual" | "yolo") */
	approvalMode: "auto" | "manual" | "yolo";

	/** Session start timestamp in milliseconds */
	startTime: number;

	/** Session creation timestamp in milliseconds */
	createdAt: number;

	/** Last update timestamp in milliseconds */
	updatedAt: number;
}

/**
 * Request object passed to approval interceptor callback.
 */
export interface ApprovalRequest {
	/** Name of the tool requested */
	toolName: string;

	/** Parameters provided to the tool */
	toolInput: Record<string, unknown>;

	/** Optional reason or description for approval review */
	reason?: string;
}

/**
 * Decision returned by approval gate.
 */
export type ApprovalDecision = "approve" | "deny" | "ask_user";

/**
 * Structured approval response.
 */
export interface ApprovalResult {
	approved: boolean;
	reason?: string;
}

/**
 * Programmatic approval interceptor callback function.
 */
export type ApprovalCallback = (
	request: ApprovalRequest,
) => Promise<boolean | "approve" | "deny" | ApprovalResult> | boolean | "approve" | "deny" | ApprovalResult;

/**
 * Event listener types.
 */
export type SDKEventListener = (event: SDKEvent) => void;
export type ToolCallListener = (event: ToolCallEvent) => void;
export type ToolResultListener = (event: ToolResultEvent) => void;
export type ResponseListener = (text: string) => void;
export type ErrorListener = (error: Error) => void;
export type DoneListener = (event: DoneEvent) => void;
export type Unsubscribe = () => void;

// Re-export underlying runtime types
export type {
	ContentBlock,
	HarnessConfig,
	Message,
	MessageRole,
	Provider,
	ProviderCallConfig,
	ProviderConfig,
	ProviderResponse,
	ReplTurn,
	TextContent,
	ToolDefinition,
	ToolResultContent,
	ToolUseContent,
};
