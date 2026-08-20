import chalk, { Chalk } from "chalk";
import { stripAnsi } from "./status-bar.ts";
import type { StreamEvent, StreamRendererOptions } from "./types.ts";

const color = new Chalk({ level: 3 });

/**
 * Computes exact line-by-line LCS diff between two text strings.
 */
export function computeLineDiff(
	oldText: string,
	newText: string,
): Array<{ type: "add" | "del" | "same"; line: string }> {
	const oldLines = oldText ? oldText.split(/\r?\n/) : [];
	const newLines = newText ? newText.split(/\r?\n/) : [];

	const m = oldLines.length;
	const n = newLines.length;
	const dp: number[][] = Array.from({ length: m + 1 }, () =>
		new Array(n + 1).fill(0),
	);

	for (let i = 0; i < m; i++) {
		for (let j = 0; j < n; j++) {
			if (oldLines[i] === newLines[j]) {
				dp[i + 1][j + 1] = dp[i][j] + 1;
			} else {
				dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
			}
		}
	}

	const stack: Array<{ type: "add" | "del" | "same"; line: string }> = [];
	let i = m;
	let j = n;

	while (i > 0 || j > 0) {
		if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
			stack.push({ type: "same", line: oldLines[i - 1] });
			i--;
			j--;
		} else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
			stack.push({ type: "add", line: newLines[j - 1] });
			j--;
		} else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
			stack.push({ type: "del", line: oldLines[i - 1] });
			i--;
		}
	}

	return stack.reverse();
}

/**
 * Formats Markdown text into ANSI-styled terminal output with non-TTY plain text fallback.
 */
export function formatMarkdown(
	text: string,
	options?: StreamRendererOptions,
): string {
	if (!text || typeof text !== "string") return "";

	const isTTY = options?.isTTY ?? true;
	const noColorEnv =
		typeof process !== "undefined" && Boolean(process.env?.NO_COLOR);
	const useColor = options?.chalkEnabled !== false && isTTY && !noColorEnv;

	// Split by fenced code blocks to prevent accidental formatting inside code
	const codeBlockRegex = /```([a-zA-Z0-9_-]*)\r?\n([\s\S]*?)```/g;
	let lastIndex = 0;
	let result = "";
	let match: RegExpExecArray | null;

	while ((match = codeBlockRegex.exec(text)) !== null) {
		// Format regular markdown before the code block
		const before = text.slice(lastIndex, match.index);
		result += formatMarkdownSnippet(before, useColor);

		// Format the code block
		const lang = match[1] || "text";
		const codeContent = match[2] || "";
		result += formatCodeBlock(lang, codeContent, useColor);

		lastIndex = match.index + match[0].length;
	}

	// Format remaining text after the last code block
	const remaining = text.slice(lastIndex);
	result += formatMarkdownSnippet(remaining, useColor);

	return useColor ? result : stripAnsi(result);
}

/**
 * Formats a fenced code block with borders and language header.
 */
function formatCodeBlock(
	lang: string,
	code: string,
	useColor: boolean,
): string {
	const lines = code.split(/\r?\n/);
	// Remove trailing empty line if present
	if (lines.length > 0 && lines[lines.length - 1] === "") {
		lines.pop();
	}

	if (useColor) {
		const border = color.gray;
		const langBadge = color.cyan(`[${lang}]`);
		let out = `\n${border("┌─")} ${langBadge} ${border("─".repeat(Math.max(10, 40 - lang.length)))}\n`;
		for (const line of lines) {
			out += `${border("│")} ${line}\n`;
		}
		out += `${border("└" + "─".repeat(45))}\n\n`;
		return out;
	}

	let out = `\n--- [${lang}] ---\n`;
	for (const line of lines) {
		out += `  ${line}\n`;
	}
	out += `-----------------\n\n`;
	return out;
}

/**
 * Formats inline Markdown elements (headers, lists, bold, italic, inline code, quotes).
 */
function formatMarkdownSnippet(snippet: string, useColor: boolean): string {
	if (!snippet) return "";

	const lines = snippet.split(/\r?\n/);
	const formattedLines: string[] = [];

	for (const line of lines) {
		let l = line;

		// Headers
		if (/^###\s+(.*)$/.test(l)) {
			const content = l.replace(/^###\s+/, "");
			l = useColor
				? color.bold.magenta(`### ${content}`)
				: `### ${content}`;
		} else if (/^##\s+(.*)$/.test(l)) {
			const content = l.replace(/^##\s+/, "");
			l = useColor ? color.bold.blue(`## ${content}`) : `## ${content}`;
		} else if (/^#\s+(.*)$/.test(l)) {
			const content = l.replace(/^#\s+/, "");
			l = useColor
				? color.bold.cyan.underline(`# ${content}`)
				: `# ${content}`;
		}
		// Blockquotes
		else if (/^>\s*(.*)$/.test(l)) {
			const content = l.replace(/^>\s*/, "");
			l = useColor
				? `${color.gray("│")} ${color.italic(content)}`
				: l;
		}
		// Bullet lists (* item, - item, + item)
		else if (/^(\s*)[*+-]\s+(.*)$/.test(l)) {
			const match = l.match(/^(\s*)[*+-]\s+(.*)$/);
			if (match) {
				const indent = match[1];
				const content = match[2];
				l = useColor
					? `${indent}${color.cyan("•")} ${formatInlineElements(content, useColor)}`
					: `${indent}* ${formatInlineElements(content, useColor)}`;
			}
		}
		// Numbered lists (1. item)
		else if (/^(\s*)(\d+\.)\s+(.*)$/.test(l)) {
			const match = l.match(/^(\s*)(\d+\.)\s+(.*)$/);
			if (match) {
				const indent = match[1];
				const num = match[2];
				const content = match[3];
				l = useColor
					? `${indent}${color.cyan(num)} ${formatInlineElements(content, useColor)}`
					: `${indent}${num} ${formatInlineElements(content, useColor)}`;
			}
		} else {
			// Regular paragraph line
			l = formatInlineElements(l, useColor);
		}

		formattedLines.push(l);
	}

	return formattedLines.join("\n");
}

/**
 * Formats inline bold, italic, strikethrough, and inline code.
 */
function formatInlineElements(text: string, useColor: boolean): string {
	if (!text) return "";
	if (!useColor) {
		let out = text;
		out = out.replace(/\*\*([^*]+)\*\*/g, "$1");
		out = out.replace(/__([^_]+)__/g, "$1");
		out = out.replace(/(?<=^|\s)\*([^*]+)\*(?=\s|$|[.,!?;:])/g, "$1");
		out = out.replace(/(?<=^|\s)_([^_]+)_(?=\s|$|[.,!?;:])/g, "$1");
		out = out.replace(/~~([^~]+)~~/g, "$1");
		return out;
	}

	// Inline code: `code`
	let out = text.replace(/`([^`]+)`/g, (_match, code) => {
		return color.yellow(`\`${code}\``);
	});

	// Bold: **text** or __text__
	out = out.replace(/\*\*([^*]+)\*\*/g, (_match, b) => color.bold(b));
	out = out.replace(/__([^_]+)__/g, (_match, b) => color.bold(b));

	// Italic: *text* (word boundary aware to not conflict with symbols)
	out = out.replace(/(?<=^|\s)\*([^*]+)\*(?=\s|$|[.,!?;:])/g, (_match, it) =>
		color.italic(it),
	);
	out = out.replace(/(?<=^|\s)_([^_]+)_(?=\s|$|[.,!?;:])/g, (_match, it) =>
		color.italic(it),
	);

	// Strikethrough: ~~text~~
	out = out.replace(/~~([^~]+)~~/g, (_match, st) => color.strikethrough(st));

	return out;
}

/**
 * Formats a visual Tool Call card.
 */
export function formatToolCall(
	toolName: string,
	input?: Record<string, unknown>,
	options?: StreamRendererOptions,
): string {
	const isTTY = options?.isTTY ?? true;
	const noColorEnv =
		typeof process !== "undefined" && Boolean(process.env?.NO_COLOR);
	const useColor = options?.chalkEnabled !== false && isTTY && !noColorEnv;

	const jsonStr = input && Object.keys(input).length > 0
		? JSON.stringify(input, null, 2)
		: "{}";

	if (useColor) {
		const border = color.yellow;
		const nameFormatted = color.bold.cyan(toolName);
		let card = `\n${border("┌──")} 🛠️  Tool Call: ${nameFormatted} ${border("─".repeat(Math.max(5, 35 - toolName.length)))}\n`;
		for (const line of jsonStr.split("\n")) {
			card += `${border("│")}  ${color.gray(line)}\n`;
		}
		card += `${border("└" + "─".repeat(48))}\n`;
		return card;
	}

	return `\n[Tool Call: ${toolName}]\n${jsonStr}\n`;
}

/**
 * Formats a visual Tool Result card with error status and truncation for long outputs (>300 chars or >10 lines).
 */
export function formatToolResult(
	toolName: string,
	result: string,
	isError = false,
	options?: StreamRendererOptions,
): string {
	const isTTY = options?.isTTY ?? true;
	const noColorEnv =
		typeof process !== "undefined" && Boolean(process.env?.NO_COLOR);
	const useColor = options?.chalkEnabled !== false && isTTY && !noColorEnv;

	const rawResult = result || "";
	const lines = rawResult.split(/\r?\n/);
	let truncated = false;
	let displayResult = rawResult;
	let truncateNote = "";

	if (lines.length > 10) {
		truncated = true;
		const keptLines = lines.slice(0, 8);
		truncateNote = `... [truncated ${lines.length - 8} lines, ${rawResult.length} characters total]`;
		displayResult = `${keptLines.join("\n")}\n${truncateNote}`;
	} else if (rawResult.length > 300) {
		truncated = true;
		truncateNote = `... (truncated: ${rawResult.length} chars total)`;
		displayResult = `${rawResult.slice(0, 300)}${truncateNote}`;
	}

	if (useColor) {
		const borderColor = isError ? color.red : color.green;
		const icon = isError ? "❌" : "✔️ ";
		const statusText = isError ? "Tool Error" : "Tool Result";
		const nameFormatted = isError ? color.bold.red(toolName) : color.bold.green(toolName);

		let card = `\n${borderColor("┌──")} ${icon} ${statusText}: ${nameFormatted} ${borderColor("─".repeat(Math.max(5, 33 - toolName.length)))}\n`;
		for (const line of displayResult.split("\n")) {
			if (truncated && line.startsWith("... [truncated") || line.startsWith("... (truncated")) {
				card += `${borderColor("│")}  ${color.yellow.italic(line)}\n`;
			} else {
				card += `${borderColor("│")}  ${line}\n`;
			}
		}
		card += `${borderColor("└" + "─".repeat(48))}\n`;
		return card;
	}

	const tag = isError ? `[Tool Error: ${toolName}]` : `[Tool Result: ${toolName}]`;
	return `\n${tag}\n${displayResult}\n`;
}

/**
 * Formats dimmed/italicized thinking text.
 */
export function formatThinking(
	text: string,
	options?: StreamRendererOptions,
): string {
	if (!text) return "";
	const isTTY = options?.isTTY ?? true;
	const noColorEnv =
		typeof process !== "undefined" && Boolean(process.env?.NO_COLOR);
	const useColor = options?.chalkEnabled !== false && isTTY && !noColorEnv;

	if (useColor) {
		return color.gray(`🧠 [Thinking] ${color.italic(text)}`);
	}
	return `[Thinking] ${text}`;
}

/**
 * Formats line diffs with colored additions and deletions.
 */
export function formatDiff(
	oldContent: string,
	newContent: string,
	options?: StreamRendererOptions,
): string {
	const isTTY = options?.isTTY ?? true;
	const noColorEnv =
		typeof process !== "undefined" && Boolean(process.env?.NO_COLOR);
	const useColor = options?.chalkEnabled !== false && isTTY && !noColorEnv;

	const diffs = computeLineDiff(oldContent, newContent);
	let output = "";

	for (const item of diffs) {
		if (item.type === "add") {
			output += useColor ? color.green(`+ ${item.line}\n`) : `+ ${item.line}\n`;
		} else if (item.type === "del") {
			output += useColor ? color.red(`- ${item.line}\n`) : `- ${item.line}\n`;
		} else {
			output += useColor ? color.gray(`  ${item.line}\n`) : `  ${item.line}\n`;
		}
	}

	return output;
}

/**
 * StreamRenderer Class
 *
 * Manages token streaming, markdown rendering, tool call/result visual cards,
 * diff views, thinking blocks, and non-TTY plain-text fallback.
 */
export class StreamRenderer {
	private output: NodeJS.WritableStream;
	private isTTY: boolean;
	private chalkEnabled: boolean;
	private wordWrap: boolean;

	constructor(options?: StreamRendererOptions) {
		this.output = options?.output || process.stdout;
		this.isTTY = options?.isTTY ?? Boolean((this.output as any)?.isTTY);
		this.chalkEnabled = options?.chalkEnabled ?? true;
		this.wordWrap = options?.wordWrap ?? false;
	}

	/**
	 * Writes a real-time token chunk directly to the output stream
	 */
	public renderToken(chunk: string): void {
		if (!chunk) return;
		this.output.write(chunk);
	}

	/**
	 * Formats and returns rendered Markdown
	 */
	public renderMarkdown(text: string): string {
		return formatMarkdown(text, {
			isTTY: this.isTTY,
			chalkEnabled: this.chalkEnabled,
			wordWrap: this.wordWrap,
		});
	}

	/**
	 * Formats and returns a Tool Call card
	 */
	public renderToolCall(
		toolName: string,
		input: Record<string, unknown> = {},
	): string {
		return formatToolCall(toolName, input, {
			isTTY: this.isTTY,
			chalkEnabled: this.chalkEnabled,
		});
	}

	/**
	 * Formats and returns a Tool Result card
	 */
	public renderToolResult(
		toolName: string,
		result: string,
		isError = false,
	): string {
		return formatToolResult(toolName, result, isError, {
			isTTY: this.isTTY,
			chalkEnabled: this.chalkEnabled,
		});
	}

	/**
	 * Formats and returns thinking text
	 */
	public renderThinking(text: string): string {
		return formatThinking(text, {
			isTTY: this.isTTY,
			chalkEnabled: this.chalkEnabled,
		});
	}

	/**
	 * Formats and returns line diffs
	 */
	public renderDiff(oldContent: string, newContent: string): string {
		return formatDiff(oldContent, newContent, {
			isTTY: this.isTTY,
			chalkEnabled: this.chalkEnabled,
		});
	}

	/**
	 * Renders a high-level StreamEvent to string
	 */
	public renderEvent(event: StreamEvent): string {
		switch (event.type) {
			case "token":
				return event.chunk;
			case "thinking":
				return this.renderThinking(event.message);
			case "tool_call":
				return this.renderToolCall(event.toolName, event.toolInput || {});
			case "tool_result":
				return this.renderToolResult(
					event.toolName || "tool",
					event.result,
					event.isError || false,
				);
			case "response":
				return this.renderMarkdown(event.text);
			case "error": {
				const errMsg =
					event.error && typeof event.error === "object" && "message" in event.error
						? String((event.error as any).message)
						: String(event.error);
				return this.chalkEnabled && this.isTTY
					? color.red(`\n💥 [Error] ${errMsg}\n`)
					: `\n[Error] ${errMsg}\n`;
			}
			case "done": {
				const iterText = event.totalIterations !== undefined
					? `Completed in ${event.totalIterations} iteration(s).`
					: "Done.";
				return this.chalkEnabled && this.isTTY
					? color.magenta(`\n🏁 [Done] ${iterText}\n`)
					: `\n[Done] ${iterText}\n`;
			}
			default:
				return "";
		}
	}

	/**
	 * Formats and writes a StreamEvent directly to the output stream
	 */
	public writeEvent(event: StreamEvent): void {
		if (event.type === "token") {
			this.renderToken(event.chunk);
		} else {
			const formatted = this.renderEvent(event);
			if (formatted) {
				this.output.write(formatted.endsWith("\n") ? formatted : `${formatted}\n`);
			}
		}
	}
}
