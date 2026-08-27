import * as path from "node:path";
import chalk, { Chalk } from "chalk";
import { formatCost } from "./cost.ts";
import type { ReplSessionState, StatusBarOptions } from "./types.ts";

const color = new Chalk({ level: 3 });

/** ANSI Escape Code matching pattern */
export const ANSI_REGEX =
	/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

/**
 * Strips ANSI escape sequences from a string.
 */
export function stripAnsi(str: string): string {
	if (!str || typeof str !== "string") return "";
	return str.replace(ANSI_REGEX, "");
}

/**
 * Formats a raw token number into human-readable compact notation (e.g. 4.2k, 1.5M).
 */
export function formatTokens(tokens: number): string {
	const safe = typeof tokens === "number" && !Number.isNaN(tokens) && Number.isFinite(tokens) ? tokens : 0;
	if (safe <= 0) return "0";
	if (safe < 1000) return String(Math.round(safe));
	if (safe < 1_000_000) {
		const val = (safe / 1000).toFixed(1).replace(/\.0$/, "");
		return `${val}k`;
	}
	const val = (safe / 1_000_000).toFixed(2).replace(/\.00$/, "").replace(/(\.[1-9])0$/, "$1");
	return `${val}M`;
}

/**
 * Formats a duration in milliseconds into MM:SS or HH:MM:SS format.
 */
export function formatDuration(durationMs: number): string {
	const safeMs = typeof durationMs === "number" && !Number.isNaN(durationMs) && Number.isFinite(durationMs)
		? Math.max(0, durationMs)
		: 0;

	const totalSeconds = Math.floor(safeMs / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	const pad = (n: number) => String(n).padStart(2, "0");

	if (hours > 0) {
		return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
	}
	return `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Shortens a model name for narrower displays.
 */
export function compactModelName(modelName: string): string {
	if (!modelName) return "default";
	let clean = modelName.trim();
	if (clean.includes("/")) {
		const parts = clean.split("/");
		clean = parts[parts.length - 1];
	}
	// Strip trailing date suffixes like -20250219
	clean = clean.replace(/-\d{8}$/, "");
	return clean;
}

/**
 * Creates a default dummy ReplSessionState if none is provided.
 */
export function createDefaultSessionState(): ReplSessionState {
	const now = Date.now();
	return {
		id: "default-session",
		createdAt: now,
		updatedAt: now,
		providerName: "default",
		modelName: "default",
		mode: "build",
		approvalMode: "manual",
		turnCount: 0,
		inputTokens: 0,
		outputTokens: 0,
		totalTokens: 0,
		estimatedCost: 0,
		startTime: now,
	};
}

/**
 * Pure function rendering the status bar string according to terminal width breakpoints.
 *
 * Breakpoints:
 * - Wide (>= 100 columns): Full labels, provider, model, mode, turns, tokens, %, cost, duration.
 * - Medium (60–99 columns): Condensed view with badges.
 * - Narrow (< 60 columns): Compact minimal layout.
 */
export function renderStatusBar(
	state?: Partial<ReplSessionState>,
	options?: StatusBarOptions,
): string {
	const s: ReplSessionState = {
		...createDefaultSessionState(),
		...(state || {}),
	};

	const columns = options?.columns ?? (process.stdout?.columns || 80);
	const isTTY = options?.isTTY ?? true;
	const noColorEnv = typeof process !== "undefined" && Boolean(process.env?.NO_COLOR);
	const useColor = options?.chalkEnabled !== false && isTTY && !noColorEnv;

	// Calculate metrics
	const safeTotalTokens = Math.max(
		0,
		typeof s.totalTokens === "number" && Number.isFinite(s.totalTokens)
			? s.totalTokens
			: ((typeof s.inputTokens === "number" && Number.isFinite(s.inputTokens) ? s.inputTokens : 0) +
					(typeof s.outputTokens === "number" && Number.isFinite(s.outputTokens) ? s.outputTokens : 0)),
	);
	const contextBudget = 128000;
	const contextPercentage = ((safeTotalTokens / contextBudget) * 100).toFixed(1);
	const tokensFormatted = formatTokens(safeTotalTokens);
	const costFormatted = formatCost(
		typeof s.estimatedCost === "number" && Number.isFinite(s.estimatedCost) ? Math.max(0, s.estimatedCost) : 0,
	);
	const safeTurnCount = Math.max(0, typeof s.turnCount === "number" && Number.isFinite(s.turnCount) ? s.turnCount : 0);

	const elapsedMs =
		options?.lastCommandDurationMs !== undefined
			? (typeof options.lastCommandDurationMs === "number" && Number.isFinite(options.lastCommandDurationMs) ? Math.max(0, options.lastCommandDurationMs) : 0)
			: Math.max(0, Date.now() - (typeof s.startTime === "number" && Number.isFinite(s.startTime) ? s.startTime : typeof s.createdAt === "number" && Number.isFinite(s.createdAt) ? s.createdAt : Date.now()));
	const durationFormatted = formatDuration(elapsedMs);

	const isPlan = s.mode === "plan";
	const modeLabel = isPlan ? "PLAN" : "BUILD";
	const modeShort = isPlan ? "P" : "B";

	let statusLine = "";

	const repoName = s.repoName || (s.projectRoot ? path.basename(s.projectRoot) : "default");

	if (columns >= 100) {
		// === Wide Layout (>= 100 cols) ===
		// [Repo: my-harness | Provider: anthropic | Model: claude-3-7-sonnet | Mode: BUILD | Turn: 3 ...]
		if (useColor) {
			const modeBadge = isPlan ? color.bold.cyan(modeLabel) : color.bold.green(modeLabel);
			const costBadge = color.yellow(costFormatted);
			const pctNum = Number.parseFloat(contextPercentage);
			const pctColor = pctNum > 80 ? color.red : pctNum > 50 ? color.yellow : color.cyan;
			const tokensBadge = `${tokensFormatted}/${formatTokens(contextBudget)} (${pctColor(`${contextPercentage}%`)})`;

			statusLine =
				color.gray("[") +
				`Repo: ${color.bold.cyan(repoName)}` +
				color.gray(" | ") +
				`Provider: ${color.white(s.providerName)}` +
				color.gray(" | ") +
				`Model: ${color.white(s.modelName)}` +
				color.gray(" | ") +
				`Mode: ${modeBadge}` +
				color.gray(" | ") +
				`Turn: ${color.white(safeTurnCount)}` +
				color.gray(" | ") +
				`Tokens: ${tokensBadge}` +
				color.gray(" | ") +
				`Cost: ${costBadge}` +
				color.gray(" | ") +
				`Time: ${color.white(durationFormatted)}` +
				color.gray("]");
		} else {
			statusLine = `[Repo: ${repoName} | Provider: ${s.providerName} | Model: ${s.modelName} | Mode: ${modeLabel} | Turn: ${safeTurnCount} | Tokens: ${tokensFormatted}/${formatTokens(contextBudget)} (${contextPercentage}%) | Cost: ${costFormatted} | Time: ${durationFormatted}]`;
		}
	} else if (columns >= 60) {
		// === Medium Layout (60–99 cols) ===
		// [anthropic:claude-3-7-sonnet | BUILD | T:3 | 4.2k (3.3%) | $0.01 | 01:23]
		const modelCompacted = compactModelName(s.modelName);
		const providerModel = s.providerName && s.providerName !== "default"
			? `${s.providerName}:${modelCompacted}`
			: modelCompacted;

		if (useColor) {
			const modeBadge = isPlan ? color.bold.cyan(modeLabel) : color.bold.green(modeLabel);
			const costBadge = color.yellow(costFormatted);
			const pctNum = Number.parseFloat(contextPercentage);
			const pctColor = pctNum > 80 ? color.red : pctNum > 50 ? color.yellow : color.cyan;
			const tokenBadge = `${tokensFormatted} (${pctColor(`${contextPercentage}%`)})`;

			statusLine =
				color.gray("[") +
				color.white(providerModel) +
				color.gray(" | ") +
				modeBadge +
				color.gray(" | ") +
				`T:${safeTurnCount}` +
				color.gray(" | ") +
				tokenBadge +
				color.gray(" | ") +
				costBadge +
				color.gray(" | ") +
				color.white(durationFormatted) +
				color.gray("]");
		} else {
			statusLine = `[${providerModel} | ${modeLabel} | T:${safeTurnCount} | ${tokensFormatted} (${contextPercentage}%) | ${costFormatted} | ${durationFormatted}]`;
		}
	} else {
		// === Narrow Layout (< 60 cols) ===
		// [claude-3-7 | B | 4.2k | 01:23]
		const modelCompacted = compactModelName(s.modelName);

		if (useColor) {
			const modeBadge = isPlan ? color.bold.cyan(modeShort) : color.bold.green(modeShort);

			statusLine =
				color.gray("[") +
				color.white(modelCompacted) +
				color.gray(" | ") +
				modeBadge +
				color.gray(" | ") +
				color.cyan(tokensFormatted) +
				color.gray(" | ") +
				color.white(durationFormatted) +
				color.gray("]");
		} else {
			statusLine = `[${modelCompacted} | ${modeShort} | ${tokensFormatted} | ${durationFormatted}]`;
		}
	}

	return statusLine;
}

/**
 * StatusBar Class
 *
 * Manages live terminal status bar updates, viewport resizing, and stream output.
 */
export class StatusBar {
	private state: ReplSessionState;
	private options: StatusBarOptions;
	private outputStream: NodeJS.WritableStream;
	private isTTY: boolean;
	private resizeListener?: () => void;
	private active = false;

	constructor(
		options?: StatusBarOptions & {
			stream?: NodeJS.WritableStream;
			state?: ReplSessionState;
		},
	) {
		this.options = options || {};
		this.outputStream = options?.stream || process.stdout;
		this.isTTY = options?.isTTY ?? Boolean((this.outputStream as any)?.isTTY);
		this.state = options?.state || createDefaultSessionState();
	}

	/**
	 * Get current session state snapshot
	 */
	public getState(): ReplSessionState {
		return { ...this.state };
	}

	/**
	 * Get the effective terminal width in columns
	 */
	public getColumns(): number {
		if (typeof this.options.columns === "number" && this.options.columns > 0) {
			return this.options.columns;
		}
		if (process.stdout?.columns && process.stdout.columns > 0) {
			return process.stdout.columns;
		}
		return 80;
	}

	/**
	 * Update internal session state or status bar options
	 */
	public update(
		partialState?: Partial<ReplSessionState>,
		partialOptions?: Partial<StatusBarOptions>,
	): void {
		if (partialState) {
			this.state = {
				...this.state,
				...partialState,
				updatedAt: Date.now(),
			};
		}
		if (partialOptions) {
			this.options = {
				...this.options,
				...partialOptions,
			};
			if (typeof partialOptions.isTTY === "boolean") {
				this.isTTY = partialOptions.isTTY;
			}
		}
	}

	/**
	 * Formats the status line without writing to stdout
	 */
	public format(state?: Partial<ReplSessionState>, options?: StatusBarOptions): string {
		const s = state ? { ...this.state, ...state } : this.state;
		const o: StatusBarOptions = {
			columns: this.getColumns(),
			isTTY: this.isTTY,
			...this.options,
			...options,
		};
		return renderStatusBar(s, o);
	}

	/**
	 * Renders and writes the status bar to the output stream
	 */
	public render(state?: Partial<ReplSessionState>): string {
		const formatted = this.format(state);
		if (this.isTTY) {
			this.outputStream.write(`\r\x1b[2K${formatted}`);
		} else {
			this.outputStream.write(`${stripAnsi(formatted)}\n`);
		}
		return formatted;
	}

	/**
	 * Clears the status bar from the terminal line
	 */
	public clear(): void {
		if (this.isTTY) {
			this.outputStream.write("\r\x1b[2K");
		}
	}

	/**
	 * Attaches resize listener to process.stdout
	 */
	public start(): void {
		if (this.active) return;
		this.active = true;

		if (
			typeof process !== "undefined" &&
			process.stdout &&
			typeof process.stdout.on === "function"
		) {
			this.resizeListener = () => {
				if (this.active) {
					this.render();
				}
			};
			process.stdout.on("resize", this.resizeListener);
		}
	}

	/**
	 * Removes resize listener and cleans up resources
	 */
	public stop(): void {
		if (!this.active) return;
		this.active = false;

		if (
			this.resizeListener &&
			typeof process !== "undefined" &&
			process.stdout &&
			typeof process.stdout.removeListener === "function"
		) {
			process.stdout.removeListener("resize", this.resizeListener);
			this.resizeListener = undefined;
		}
	}

	/**
	 * Check if status bar is currently active
	 */
	public isActive(): boolean {
		return this.active;
	}
}
