import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import type { LoopEvent, Message, ToolDefinition } from "../agent/types.ts";
import { ContextManager } from "../context/manager.ts";
import type { Provider } from "../providers/base.ts";
import { estimateCost } from "./cost.ts";
import type {
	ReplApprovalMode,
	ReplMode,
	ReplSessionState,
	ReplSession as IReplSession,
} from "./types.ts";

/**
 * Metadata record for an individual conversation turn
 */
export interface ReplTurn {
	turnIndex: number;
	timestamp: number;
	userPrompt: string;
	assistantResponse: string;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	cost: number;
	durationMs?: number;
	toolEvents?: LoopEvent[];
}

/**
 * Configuration options for initializing a ReplSession
 */
export interface ReplSessionConfig {
	id?: string;
	providerName?: string;
	modelName?: string;
	mode?: ReplMode;
	approvalMode?: ReplApprovalMode;
	projectRoot?: string;
	maxTokens?: number;
	contextManager?: ContextManager;
	createdAt?: number;
	updatedAt?: number;
	startTime?: number;
}

/**
 * Serialized representation of a full REPL session
 */
export interface SessionTranscriptJSON {
	version: "1.0";
	session: ReplSessionState;
	turns: ReplTurn[];
	messages: Message[];
	exportedAt: number;
}

/**
 * Multi-turn REPL Session Manager
 *
 * Tracks multi-turn conversation history, token & cost accumulation,
 * synchronizes with ContextManager for context tier assembly and compaction,
 * and provides transcript export functionality.
 */
export class ReplSession implements IReplSession {
	private state: ReplSessionState;
	private turns: ReplTurn[] = [];
	private messages: Message[] = [];
	private contextManager: ContextManager;
	private projectRoot: string;

	constructor(config: ReplSessionConfig = {}) {
		const now = Date.now();
		this.projectRoot = config.projectRoot || process.cwd();

		this.state = {
			id: config.id || crypto.randomUUID(),
			createdAt: config.createdAt || now,
			updatedAt: config.updatedAt || now,
			startTime: config.startTime || now,
			providerName: config.providerName || "default",
			modelName: config.modelName || "default",
			mode: config.mode || "build",
			approvalMode: config.approvalMode || "manual",
			turnCount: 0,
			inputTokens: 0,
			outputTokens: 0,
			totalTokens: 0,
			estimatedCost: 0,
		};

		this.contextManager =
			config.contextManager ||
			new ContextManager({
				projectRoot: this.projectRoot,
				maxTokens: config.maxTokens || 128000,
			});
	}

	/**
	 * Get current session state snapshot
	 */
	public getState(): Readonly<ReplSessionState> {
		return { ...this.state };
	}

	/**
	 * Get the session ID
	 */
	public getId(): string {
		return this.state.id;
	}

	/**
	 * Get all raw protocol messages in conversation history
	 */
	public getMessages(): Message[] {
		return [...this.messages];
	}

	/**
	 * Get all raw protocol messages (interface alias)
	 */
	public getHistory(): Message[] {
		return this.getMessages();
	}

	/**
	 * Get all recorded high-level turn records
	 */
	public getTurns(): ReplTurn[] {
		return [...this.turns];
	}

	/**
	 * Get the underlying ContextManager instance
	 */
	public getContextManager(): ContextManager {
		return this.contextManager;
	}

	/**
	 * Get elapsed session duration in milliseconds
	 */
	public getDurationMs(): number {
		return Math.max(0, Date.now() - this.state.startTime);
	}

	/**
	 * Record a completed conversation turn
	 */
	public addTurn(
		userPrompt = "",
		assistantResponse = "",
		usage?: { inputTokens?: number; outputTokens?: number },
		toolEvents?: LoopEvent[],
		durationMs?: number,
	): ReplTurn {
		const now = Date.now();
		const inTokens = Math.max(0, usage?.inputTokens || 0);
		const outTokens = Math.max(0, usage?.outputTokens || 0);
		const totTokens = inTokens + outTokens;

		const turnCost = estimateCost(
			this.state.providerName,
			this.state.modelName,
			inTokens,
			outTokens,
		);

		// 1. Update cumulative token & cost counters
		this.state.inputTokens += inTokens;
		this.state.outputTokens += outTokens;
		this.state.totalTokens += totTokens;
		this.state.estimatedCost += turnCost;
		this.state.turnCount += 1;
		this.state.updatedAt = now;

		// 2. Build protocol messages
		if (userPrompt) {
			const userMsg: Message = {
				role: "user",
				content: [{ type: "text", text: userPrompt }],
			};
			this.messages.push(userMsg);
			this.contextManager.addMessage(userMsg);
		}

		if (assistantResponse) {
			const assistantMsg: Message = {
				role: "assistant",
				content: [{ type: "text", text: assistantResponse }],
			};
			this.messages.push(assistantMsg);
			this.contextManager.addMessage(assistantMsg);
		}

		// 3. Construct turn record
		const turn: ReplTurn = {
			turnIndex: this.state.turnCount,
			timestamp: now,
			userPrompt,
			assistantResponse,
			inputTokens: inTokens,
			outputTokens: outTokens,
			totalTokens: totTokens,
			cost: turnCost,
			durationMs: durationMs || 0,
			toolEvents: toolEvents ? [...toolEvents] : undefined,
		};

		this.turns.push(turn);
		return turn;
	}

	/**
	 * Update token metrics directly
	 */
	public updateTokens(inputTokens: number, outputTokens: number): void {
		const safeIn = Math.max(0, typeof inputTokens === "number" && !Number.isNaN(inputTokens) ? inputTokens : 0);
		const safeOut = Math.max(0, typeof outputTokens === "number" && !Number.isNaN(outputTokens) ? outputTokens : 0);
		const additionalCost = estimateCost(this.state.providerName, this.state.modelName, safeIn, safeOut);

		this.state.inputTokens += safeIn;
		this.state.outputTokens += safeOut;
		this.state.totalTokens += safeIn + safeOut;
		this.state.estimatedCost += additionalCost;
		this.state.updatedAt = Date.now();
	}

	/**
	 * Append an explicit raw message to the session and context manager
	 */
	public addMessage(message: Message): void {
		this.messages.push(message);
		this.contextManager.addMessage(message);
		this.state.updatedAt = Date.now();
	}

	/**
	 * Switch the active execution mode (plan vs build)
	 */
	public setMode(mode: ReplMode): void {
		if (mode !== "plan" && mode !== "build") {
			throw new Error(`Invalid mode: "${mode}". Must be "plan" or "build".`);
		}
		this.state.mode = mode;
		this.state.updatedAt = Date.now();
	}

	/**
	 * Switch the active model and optionally provider
	 */
	public setModel(modelName: string, providerName?: string): void {
		if (!modelName || typeof modelName !== "string") {
			throw new Error("Model name must be a non-empty string.");
		}
		this.state.modelName = modelName.trim();
		if (providerName && typeof providerName === "string") {
			this.state.providerName = providerName.trim();
		}
		this.state.updatedAt = Date.now();
	}

	/**
	 * Switch the active provider and model
	 */
	public setProvider(providerName: string, modelName: string): void {
		if (!providerName || typeof providerName !== "string") {
			throw new Error("Provider name must be a non-empty string.");
		}
		if (!modelName || typeof modelName !== "string") {
			throw new Error("Model name must be a non-empty string.");
		}
		this.state.providerName = providerName.trim();
		this.state.modelName = modelName.trim();
		this.state.updatedAt = Date.now();
	}

	/**
	 * Switch the approval mode
	 */
	public setApprovalMode(approvalMode: ReplApprovalMode): void {
		if (!["auto", "manual", "yolo"].includes(approvalMode)) {
			throw new Error(`Invalid approval mode: "${approvalMode}". Must be "auto", "manual", or "yolo".`);
		}
		this.state.approvalMode = approvalMode;
		this.state.updatedAt = Date.now();
	}

	/**
	 * Reset session conversation, turns, and token accounting
	 */
	public reset(): void {
		const now = Date.now();
		this.messages = [];
		this.turns = [];
		this.state.turnCount = 0;
		this.state.inputTokens = 0;
		this.state.outputTokens = 0;
		this.state.totalTokens = 0;
		this.state.estimatedCost = 0;
		this.state.startTime = now;
		this.state.updatedAt = now;
		this.contextManager.reset();
	}

	/**
	 * Retrieve assembled context from ContextManager
	 */
	public async getContext(toolDefinitions?: ToolDefinition[]): Promise<Message[]> {
		return this.contextManager.getContext(toolDefinitions);
	}

	/**
	 * Compact conversation history when nearing token budget
	 */
	public async compact(summaryProvider?: Provider): Promise<void> {
		await this.contextManager.compact(summaryProvider);
	}

	/**
	 * Get current context token usage metrics
	 */
	public getTokenUsage(): { estimated: number; budget: number; percentage: number } {
		return this.contextManager.getTokenUsage();
	}

	/**
	 * Export session transcript formatted as JSON or Markdown
	 */
	public exportTranscript(format: "json" | "markdown" = "json"): string {
		if (format === "json") {
			const transcript: SessionTranscriptJSON = {
				version: "1.0",
				session: this.getState(),
				turns: this.getTurns(),
				messages: this.getMessages(),
				exportedAt: Date.now(),
			};
			return JSON.stringify(transcript, null, 2);
		}

		if (format === "markdown") {
			return this.formatMarkdownTranscript();
		}

		throw new Error(`Unsupported export format: "${format}". Must be "json" or "markdown".`);
	}

	/**
	 * Export session as JSON string (interface method)
	 */
	public exportSession(): string {
		return this.exportTranscript("json");
	}

	/**
	 * Load session from JSON string (interface method)
	 */
	public loadSession(json: string): void {
		const parsed: SessionTranscriptJSON = JSON.parse(json);
		if (!parsed.session || !parsed.session.id) {
			throw new Error("Invalid session JSON: missing session state.");
		}

		this.state = {
			...parsed.session,
		};
		this.turns = Array.isArray(parsed.turns) ? [...parsed.turns] : [];
		this.messages = Array.isArray(parsed.messages) ? [...parsed.messages] : [];

		this.contextManager.reset();
		for (const msg of this.messages) {
			this.contextManager.addMessage(msg);
		}
	}

	/**
	 * Save session transcript to a file on disk
	 */
	public async saveToFile(filePath: string, format: "json" | "markdown" = "json"): Promise<void> {
		const content = this.exportTranscript(format);
		await fs.writeFile(filePath, content, "utf8");
	}

	/**
	 * Format session as clean, readable Markdown
	 */
	private formatMarkdownTranscript(): string {
		const state = this.state;
		const dateStr = new Date(state.createdAt).toISOString();
		const durationSec = Math.round(this.getDurationMs() / 1000);
		const mins = Math.floor(durationSec / 60);
		const secs = durationSec % 60;
		const formattedTime = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

		let md = `# REPL Session Transcript\n\n`;
		md += `| Property | Value |\n`;
		md += `|---|---|\n`;
		md += `| **Session ID** | \`${state.id}\` |\n`;
		md += `| **Created** | ${dateStr} |\n`;
		md += `| **Provider** | \`${state.providerName}\` |\n`;
		md += `| **Model** | \`${state.modelName}\` |\n`;
		md += `| **Mode** | \`${state.mode.toUpperCase()}\` |\n`;
		md += `| **Approval** | \`${state.approvalMode}\` |\n`;
		md += `| **Total Turns** | ${state.turnCount} |\n`;
		md += `| **Total Tokens** | ${state.totalTokens.toLocaleString()} (In: ${state.inputTokens.toLocaleString()}, Out: ${state.outputTokens.toLocaleString()}) |\n`;
		md += `| **Estimated Cost** | $${state.estimatedCost.toFixed(4)} |\n`;
		md += `| **Duration** | ${formattedTime} |\n\n`;
		md += `---\n\n`;

		if (this.turns.length === 0) {
			md += `*No conversation turns recorded in this session.*\n`;
			return md;
		}

		for (const turn of this.turns) {
			const turnTime = new Date(turn.timestamp).toISOString();
			md += `## Turn ${turn.turnIndex}\n`;
			md += `*Time: ${turnTime} | Tokens: ${turn.totalTokens.toLocaleString()} | Cost: $${turn.cost.toFixed(4)}*\n\n`;

			if (turn.userPrompt) {
				md += `### 👤 User\n${turn.userPrompt}\n\n`;
			}

			if (turn.toolEvents && turn.toolEvents.length > 0) {
				md += `### 🛠️ Tool Activity\n`;
				for (const event of turn.toolEvents) {
					if (event.type === "tool_call") {
						md += `- **Tool Call**: \`${event.toolName}\`\n`;
						if (event.toolInput) {
							md += `  \`\`\`json\n  ${JSON.stringify(event.toolInput, null, 2).replace(/\n/g, "\n  ")}\n  \`\`\`\n`;
						}
					} else if (event.type === "tool_result") {
						const status = event.isError ? "❌ Error" : "✔️ Success";
						md += `- **Tool Result** (${status}):\n`;
						md += `  \`\`\`\n  ${event.result.replace(/\n/g, "\n  ")}\n  \`\`\`\n`;
					}
				}
				md += `\n`;
			}

			if (turn.assistantResponse) {
				md += `### 🤖 Assistant\n${turn.assistantResponse}\n\n`;
			}

			md += `---\n\n`;
		}

		return md;
	}

	/**
	 * Recreate a ReplSession instance from a JSON transcript string
	 */
	public static fromJSON(jsonStr: string, projectRoot?: string): ReplSession {
		const parsed: SessionTranscriptJSON = JSON.parse(jsonStr);
		if (!parsed.session || !parsed.session.id) {
			throw new Error("Invalid session JSON: missing session state.");
		}

		const session = new ReplSession({
			id: parsed.session.id,
			providerName: parsed.session.providerName,
			modelName: parsed.session.modelName,
			mode: parsed.session.mode,
			approvalMode: parsed.session.approvalMode,
			createdAt: parsed.session.createdAt,
			updatedAt: parsed.session.updatedAt,
			startTime: parsed.session.startTime,
			projectRoot: projectRoot || process.cwd(),
		});

		// Restore accumulated metrics
		session.state.turnCount = parsed.session.turnCount || 0;
		session.state.inputTokens = parsed.session.inputTokens || 0;
		session.state.outputTokens = parsed.session.outputTokens || 0;
		session.state.totalTokens = parsed.session.totalTokens || 0;
		session.state.estimatedCost = parsed.session.estimatedCost || 0;

		// Restore turns and messages
		if (Array.isArray(parsed.turns)) {
			session.turns = [...parsed.turns];
		}
		if (Array.isArray(parsed.messages)) {
			session.messages = [...parsed.messages];
			for (const msg of session.messages) {
				session.contextManager.addMessage(msg);
			}
		}

		return session;
	}
}
