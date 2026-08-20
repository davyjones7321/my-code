import { describe, expect, it } from "bun:test";
import { stripAnsi } from "../../src/tui/status-bar.ts";
import {
	computeLineDiff,
	formatDiff,
	formatMarkdown,
	formatThinking,
	formatToolCall,
	formatToolResult,
	StreamRenderer,
} from "../../src/tui/stream-renderer.ts";
import type { StreamEvent } from "../../src/tui/types.ts";

describe("TUI StreamRenderer Subsystem", () => {
	describe("computeLineDiff & formatDiff", () => {
		it("should compute line diffs correctly for additions, deletions, and unchanged lines", () => {
			const oldText = "line 1\nline 2\nline 3";
			const newText = "line 1\nline 2 modified\nline 3\nline 4";

			const diffs = computeLineDiff(oldText, newText);
			expect(diffs.length).toBeGreaterThanOrEqual(4);

			const formatted = formatDiff(oldText, newText, { chalkEnabled: false });
			expect(formatted).toContain("  line 1");
			expect(formatted).toContain("- line 2");
			expect(formatted).toContain("+ line 2 modified");
			expect(formatted).toContain("  line 3");
			expect(formatted).toContain("+ line 4");
		});

		it("should handle empty old or new text", () => {
			const addDiff = formatDiff("", "new line 1\nnew line 2", { chalkEnabled: false });
			expect(addDiff).toContain("+ new line 1");
			expect(addDiff).toContain("+ new line 2");

			const delDiff = formatDiff("old line", "", { chalkEnabled: false });
			expect(delDiff).toContain("- old line");
		});
	});

	describe("formatMarkdown", () => {
		it("should format headers properly", () => {
			const md = "# Heading 1\n## Heading 2\n### Heading 3";
			const plain = formatMarkdown(md, { chalkEnabled: false });

			expect(plain).toContain("# Heading 1");
			expect(plain).toContain("## Heading 2");
			expect(plain).toContain("### Heading 3");

			const colored = formatMarkdown(md, { chalkEnabled: true, isTTY: true });
			expect(stripAnsi(colored)).toBe(plain);
		});

		it("should format inline bold, italic, and inline code", () => {
			const md = "This is **bold** text and `inline_code()` with *italic* style.";
			const plain = formatMarkdown(md, { chalkEnabled: false });

			expect(plain).toContain("bold");
			expect(plain).toContain("`inline_code()`");
			expect(plain).toContain("italic");

			const colored = formatMarkdown(md, { chalkEnabled: true, isTTY: true });
			expect(colored).toContain("\u001b[");
			expect(stripAnsi(colored)).toContain("bold");
		});

		it("should format bullet lists, numbered lists, and blockquotes", () => {
			const md = "* Item 1\n- Item 2\n+ Item 3\n1. First\n2. Second\n> This is a quote";
			const plain = formatMarkdown(md, { chalkEnabled: false });

			expect(plain).toContain("* Item 1");
			expect(plain).toContain("* Item 2");
			expect(plain).toContain("* Item 3");
			expect(plain).toContain("1. First");
			expect(plain).toContain("2. Second");
			expect(plain).toContain("> This is a quote");

			const colored = formatMarkdown(md, { chalkEnabled: true, isTTY: true });
			expect(colored).toContain("•");
			expect(colored).toContain("│");
		});

		it("should format fenced code blocks and preserve code integrity", () => {
			const md = "Here is code:\n```typescript\nconst x: number = 42;\nconst y = x * 2;\n```\nEnd of code.";
			const plain = formatMarkdown(md, { chalkEnabled: false });

			expect(plain).toContain("--- [typescript] ---");
			expect(plain).toContain("const x: number = 42;");
			expect(plain).toContain("const y = x * 2;");
			expect(plain).toContain("End of code.");

			const colored = formatMarkdown(md, { chalkEnabled: true, isTTY: true });
			expect(colored).toContain("[typescript]");
			expect(colored).toContain("┌─");
			expect(colored).toContain("│");
			expect(colored).toContain("└");
		});

		it("should handle empty or null text safely", () => {
			expect(formatMarkdown("")).toBe("");
			expect(formatMarkdown(null as any)).toBe("");
		});
	});

	describe("formatToolCall", () => {
		it("should format a visual tool call card with JSON input", () => {
			const plain = formatToolCall("read_file", { path: "src/tui/index.ts", line: 10 }, { chalkEnabled: false });

			expect(plain).toContain("[Tool Call: read_file]");
			expect(plain).toContain('"path": "src/tui/index.ts"');
			expect(plain).toContain('"line": 10');

			const colored = formatToolCall("read_file", { path: "src/tui/index.ts" }, { chalkEnabled: true, isTTY: true });
			expect(colored).toContain("Tool Call");
			expect(colored).toContain("read_file");
			expect(colored).toContain("┌──");
			expect(colored).toContain("│");
		});

		it("should handle empty tool input gracefully", () => {
			const plain = formatToolCall("list_files", {}, { chalkEnabled: false });
			expect(plain).toContain("[Tool Call: list_files]");
			expect(plain).toContain("{}");
		});
	});

	describe("formatToolResult & Truncation", () => {
		it("should format success and error tool results", () => {
			const successPlain = formatToolResult("read_file", "File contents here", false, { chalkEnabled: false });
			expect(successPlain).toContain("[Tool Result: read_file]");
			expect(successPlain).toContain("File contents here");

			const errorPlain = formatToolResult("read_file", "File not found", true, { chalkEnabled: false });
			expect(errorPlain).toContain("[Tool Error: read_file]");
			expect(errorPlain).toContain("File not found");

			const coloredSuccess = formatToolResult("read_file", "Success output", false, { chalkEnabled: true, isTTY: true });
			expect(coloredSuccess).toContain("✔️");
			expect(coloredSuccess).toContain("Tool Result");

			const coloredError = formatToolResult("read_file", "Error output", true, { chalkEnabled: true, isTTY: true });
			expect(coloredError).toContain("❌");
			expect(coloredError).toContain("Tool Error");
		});

		it("should truncate long single-line outputs exceeding 300 characters", () => {
			const longText = "A".repeat(500);
			const plain = formatToolResult("execute", longText, false, { chalkEnabled: false });

			expect(plain).toContain("... (truncated: 500 chars total)");
			expect(plain.length).toBeLessThan(450);
		});

		it("should truncate multi-line outputs exceeding 10 lines", () => {
			const multiLines = Array.from({ length: 25 }, (_, i) => `Line ${i + 1}`).join("\n");
			const plain = formatToolResult("log_viewer", multiLines, false, { chalkEnabled: false });

			expect(plain).toContain("Line 1");
			expect(plain).toContain("Line 8");
			expect(plain).toContain("... [truncated 17 lines,");
			expect(plain).not.toContain("Line 25");
		});
	});

	describe("formatThinking", () => {
		it("should format thinking text in plain and styled modes", () => {
			const plain = formatThinking("Analyzing project structure...", { chalkEnabled: false });
			expect(plain).toBe("[Thinking] Analyzing project structure...");

			const colored = formatThinking("Analyzing...", { chalkEnabled: true, isTTY: true });
			expect(colored).toContain("🧠 [Thinking]");
			expect(colored).toContain("Analyzing...");
		});

		it("should handle empty thinking text", () => {
			expect(formatThinking("")).toBe("");
		});
	});

	describe("StreamRenderer Class", () => {
		it("should stream tokens directly to output stream", () => {
			let output = "";
			const mockStream = {
				isTTY: false,
				write: (chunk: string) => {
					output += chunk;
					return true;
				},
			};

			const renderer = new StreamRenderer({
				output: mockStream as any,
				isTTY: false,
				chalkEnabled: false,
			});

			renderer.renderToken("Hello ");
			renderer.renderToken("world!");

			expect(output).toBe("Hello world!");
		});

		it("should format and render high-level StreamEvents via renderEvent and writeEvent", () => {
			let output = "";
			const mockStream = {
				isTTY: false,
				write: (chunk: string) => {
					output += chunk;
					return true;
				},
			};

			const renderer = new StreamRenderer({
				output: mockStream as any,
				isTTY: false,
				chalkEnabled: false,
			});

			const events: StreamEvent[] = [
				{ type: "thinking", message: "Planning changes" },
				{ type: "tool_call", toolName: "read_file", toolInput: { file: "test.ts" } },
				{ type: "tool_result", toolName: "read_file", result: "file content" },
				{ type: "response", text: "**Done!**" },
				{ type: "error", error: new Error("Test failure") },
				{ type: "done", totalIterations: 2 },
			];

			for (const ev of events) {
				const rendered = renderer.renderEvent(ev);
				expect(typeof rendered).toBe("string");
				renderer.writeEvent(ev);
			}

			expect(output).toContain("[Thinking] Planning changes");
			expect(output).toContain("[Tool Call: read_file]");
			expect(output).toContain("[Tool Result: read_file]");
			expect(output).toContain("Done!");
			expect(output).toContain("[Error] Test failure");
			expect(output).toContain("[Done] Completed in 2 iteration(s).");
		});

		it("should expose renderDiff and renderMarkdown on renderer instance", () => {
			const renderer = new StreamRenderer({ chalkEnabled: false, isTTY: false });

			const diff = renderer.renderDiff("a\nb", "a\nc");
			expect(diff).toContain("+ c");
			expect(diff).toContain("- b");

			const md = renderer.renderMarkdown("# Title");
			expect(md).toContain("# Title");
		});
	});
});
