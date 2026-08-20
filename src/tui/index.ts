/**
 * TUI Subsystem Barrel Exports
 */

// Types & Contracts
export type {
	ReplMode,
	ReplApprovalMode,
	ReplSessionState,
	CommandContext,
	CommandResult,
	SlashCommand,
	StreamEvent,
	StatusBarOptions,
	ModelPricing,
	ReplOptions,
	ReplSession as IReplSession,
	SpinnerOptions,
	StreamRendererOptions,
} from "./types.ts";

// Cost & Pricing
export {
	DEFAULT_PRICING,
	FREE_PRICING,
	MODEL_PRICING,
	getModelPricing,
	estimateCost,
	formatCost,
} from "./cost.ts";

// Multi-Turn Session
export {
	ReplSession,
	type ReplTurn,
	type ReplSessionConfig,
	type SessionTranscriptJSON,
} from "./session.ts";

// Slash Commands & Shell Passthrough
export {
	executeShellPassthrough,
	helpCommand,
	clearCommand,
	exitCommand,
	historyCommand,
	resetCommand,
	modelCommand,
	usageCommand,
	skillsCommand,
	modeCommand,
	BUILTIN_COMMANDS,
	SlashCommandRegistry,
	createDefaultRegistry,
} from "./commands.ts";

// Adaptive Status Bar
export {
	ANSI_REGEX,
	stripAnsi,
	formatTokens,
	formatDuration,
	compactModelName,
	createDefaultSessionState,
	renderStatusBar,
	StatusBar,
} from "./status-bar.ts";

// Braille Spinner
export {
	DEFAULT_BRAILLE_FRAMES,
	Spinner,
	createSpinner,
} from "./spinner.ts";

// Stream & Event Renderer
export {
	computeLineDiff,
	formatMarkdown,
	formatToolCall,
	formatToolResult,
	formatThinking,
	formatDiff,
	StreamRenderer,
} from "./stream-renderer.ts";

// Interactive REPL Engine
export {
	ReplEngine,
	startRepl,
} from "./repl.ts";
