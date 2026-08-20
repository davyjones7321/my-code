import type { Message, ToolDefinition } from "../agent/types.ts";
import type { ContextManager } from "../context/manager.ts";
import type { ControlLayer } from "../control/index.ts";
import type { Provider } from "../providers/base.ts";
import type { ProviderRegistry } from "../providers/registry.ts";
import type { SkillRegistry } from "../skills/registry.ts";

/** REPL execution modes */
export type ReplMode = "plan" | "build";

/** Tool approval modes */
export type ReplApprovalMode = "auto" | "manual" | "yolo";

/** Immutable snapshot of REPL session state */
export interface ReplSessionState {
	id: string;
	createdAt: number;
	updatedAt: number;
	providerName: string;
	modelName: string;
	mode: ReplMode;
	approvalMode: ReplApprovalMode;
	turnCount: number;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	estimatedCost: number;
	startTime: number;
}

/** Execution context provided to slash command handlers */
export interface CommandContext {
	session: ReplSession;
	controlLayer?: ControlLayer;
	contextManager?: ContextManager;
	providerRegistry?: ProviderRegistry;
	skillRegistry?: SkillRegistry;
	currentProvider?: Provider;
	currentModel?: string;
	output: (text: string) => void;
	setProvider?: (provider: Provider, model: string) => void;
	setMode?: (mode: ReplMode) => void;
	setApprovalMode?: (mode: ReplApprovalMode) => void;
	clearScreen?: () => void;
}

/** Result returned by slash commands */
export interface CommandResult {
	handled: boolean;
	shouldExit?: boolean;
	message?: string;
}

/** Definition for slash commands (/help, /clear, /model, etc.) */
export interface SlashCommand {
	name: string;
	aliases?: string[];
	description: string;
	usage?: string;
	execute: (args: string[], context: CommandContext) => Promise<CommandResult> | CommandResult;
}

/** Events emitted during token streaming and agent execution */
export type StreamEvent =
	| { type: "token"; chunk: string }
	| { type: "thinking"; message: string }
	| { type: "tool_call"; toolName: string; toolInput?: Record<string, unknown>; toolUseId?: string }
	| { type: "tool_result"; toolUseId?: string; result: string; isError?: boolean; toolName?: string }
	| { type: "response"; text: string }
	| { type: "error"; error: Error | { message: string } }
	| { type: "done"; totalIterations?: number; totalTokens?: number };

/** Options for rendering the live adaptive status bar */
export interface StatusBarOptions {
	columns?: number;
	isTTY?: boolean;
	chalkEnabled?: boolean;
	lastCommandDurationMs?: number;
}

/** Pricing configuration per 1 million tokens */
export interface ModelPricing {
	inputPerMillion: number;
	outputPerMillion: number;
}

/** Configuration options for starting the REPL */
export interface ReplOptions {
	providerName?: string;
	modelName?: string;
	planMode?: boolean;
	approvalMode?: ReplApprovalMode;
	input?: NodeJS.ReadableStream;
	output?: NodeJS.WritableStream;
	isTTY?: boolean;
	projectRoot?: string;
	historyFile?: string;
	maxHistorySize?: number;
	welcomeMessage?: boolean;
}

/** Multi-turn session contract */
export interface ReplSession {
	getState(): ReplSessionState;
	addTurn(
		userPrompt?: string,
		assistantResponse?: string,
		usage?: { inputTokens?: number; outputTokens?: number },
	): any;
	updateTokens(inputTokens: number, outputTokens: number): void;
	setProvider(providerName: string, modelName: string): void;
	setMode(mode: ReplMode): void;
	setApprovalMode(mode: ReplApprovalMode): void;
	reset(): void;
	getHistory(): Message[];
	addMessage(message: Message): void;
	exportSession(): string;
	loadSession(json: string): void;
}

/** Options for braille spinner controller */
export interface SpinnerOptions {
	text?: string;
	stream?: NodeJS.WritableStream;
	isTTY?: boolean;
	intervalMs?: number;
	spinnerFrames?: string[];
}

/** Options for terminal stream renderer */
export interface StreamRendererOptions {
	isTTY?: boolean;
	output?: NodeJS.WritableStream;
	chalkEnabled?: boolean;
	wordWrap?: boolean;
}
