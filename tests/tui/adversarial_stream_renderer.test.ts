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

describe("Adversarial & Stress Verification: StreamRenderer", () => {
	// =========================================================================
	// 1. Rapid 10,000 Token Chunks Streaming Integrity
	// =========================================================================
	describe("10,000 Rapid Token Stream Chunks", () => {
		it("should stream 10,000 token chunks rapidly with 100% byte & character fidelity", () => {
			let accumulatedOutput = "";
			const mockStream = {
				isTTY: false,
				write: (chunk: string) => {
					accumulatedOutput += chunk;
					return true;
				},
			};

			const renderer = new StreamRenderer({
				output: mockStream as any,
				isTTY: false,
				chalkEnabled: false,
			});

			const tokenList: string[] = [];
			const vocabulary = [
				"function ", "async ", "execute(", "param1, ", "param2) ", "{\n",
				"  const result = ", "await fetch(", "'https://api.example.com/v1/data'", ");\n",
				"  if (!result.ok) ", "throw new Error('Failed');\n",
				"  return await result.json();\n", "}\n",
				"// Unicode: 🚀 ✨ 💻 🦀 👨‍👩‍👧‍👦 \n",
				"const value = 42;\n", "/* Multi-token comment block */\n"
			];

			// Generate 10,000 token chunks
			for (let i = 0; i < 10000; i++) {
				const chunk = vocabulary[i % vocabulary.length] + (i % 50 === 0 ? `/*chunk_${i}*/` : "");
				tokenList.push(chunk);
			}

			const startTime = performance.now();
			for (let i = 0; i < 10000; i++) {
				renderer.renderToken(tokenList[i]);
			}
			const durationMs = performance.now() - startTime;

			// Expected text is the exact joined tokens
			const expectedOutput = tokenList.join("");
			expect(accumulatedOutput).toBe(expectedOutput);
			expect(accumulatedOutput.length).toBe(expectedOutput.length);
			// Verify performance: 10,000 chunks streamed in less than 500ms
			expect(durationMs).toBeLessThan(1000);
		});

		it("should gracefully handle empty chunks and special whitespace in token stream", () => {
			let accumulated = "";
			const mockStream = {
				isTTY: false,
				write: (chunk: string) => {
					accumulated += chunk;
					return true;
				},
			};

			const renderer = new StreamRenderer({
				output: mockStream as any,
				isTTY: false,
			});

			renderer.renderToken("");
			renderer.renderToken("hello");
			renderer.renderToken("");
			renderer.renderToken(" ");
			renderer.renderToken("\t");
			renderer.renderToken("\n");
			renderer.renderToken("world");
			renderer.renderToken("");

			expect(accumulated).toBe("hello \t\nworld");
		});

		it("should stream 10,000 StreamEvents through writeEvent safely", () => {
			let writeCount = 0;
			let totalBytes = 0;
			const mockStream = {
				isTTY: false,
				write: (chunk: string) => {
					writeCount++;
					totalBytes += chunk.length;
					return true;
				},
			};

			const renderer = new StreamRenderer({
				output: mockStream as any,
				isTTY: false,
				chalkEnabled: false,
			});

			for (let i = 0; i < 10000; i++) {
				const event: StreamEvent = i % 2 === 0
					? { type: "token", chunk: `token_${i} ` }
					: { type: "thinking", message: `step_${i}` };
				renderer.writeEvent(event);
			}

			expect(writeCount).toBe(10000);
			expect(totalBytes).toBeGreaterThan(10000);
		});
	});

	// =========================================================================
	// 2. Complex Markdown Rendering & Edge Cases
	// =========================================================================
	describe("Complex Markdown Rendering", () => {
		it("should format deeply nested unordered and numbered lists without corruption", () => {
			const nestedListMd = [
				"* Top level item 1",
				"  * Nested item 1.1",
				"    * Nested item 1.1.1",
				"      * Deep item 1.1.1.1",
				"        - Deeper item with dash",
				"          + Deepest item with plus",
				"1. Numbered top 1",
				"  1. Numbered sub 1.1",
				"    2. Numbered sub 1.2",
				"      1. Deep numbered 1.2.1",
			].join("\n");

			const plain = formatMarkdown(nestedListMd, { chalkEnabled: false });
			expect(plain).toContain("* Top level item 1");
			expect(plain).toContain("  * Nested item 1.1");
			expect(plain).toContain("    * Nested item 1.1.1");
			expect(plain).toContain("        * Deeper item with dash");
			expect(plain).toContain("          * Deepest item with plus");
			expect(plain).toContain("1. Numbered top 1");
			expect(plain).toContain("  1. Numbered sub 1.1");
			expect(plain).toContain("    2. Numbered sub 1.2");

			const colored = formatMarkdown(nestedListMd, { chalkEnabled: true, isTTY: true });
			expect(colored).toContain("•");
			expect(colored).toContain("Top level item 1");
			expect(stripAnsi(colored)).toContain("Top level item 1");
		});

		it("should safely handle unclosed fenced code blocks without throwing or dropping content", () => {
			const unclosedCodeMd = "Here is an unclosed code block:\n```typescript\nconst message: string = 'Hello World';\nconsole.log(message);\n// Notice there is no closing triple backtick";

			const plain = formatMarkdown(unclosedCodeMd, { chalkEnabled: false });
			expect(plain).toContain("Here is an unclosed code block:");
			expect(plain).toContain("const message: string = 'Hello World';");
			expect(plain).toContain("console.log(message);");

			const colored = formatMarkdown(unclosedCodeMd, { chalkEnabled: true, isTTY: true });
			expect(stripAnsi(colored)).toContain("const message: string = 'Hello World';");
		});

		it("should safely handle unclosed inline styles (backticks, asterisks, tildes)", () => {
			const unclosedInline = [
				"This has an unclosed `inline code snippet without closing backtick",
				"This has unclosed **bold text without second pair",
				"This has unclosed *italic text without matching asterisk",
				"This has unclosed ~~strikethrough without closing tildes",
			].join("\n");

			const plain = formatMarkdown(unclosedInline, { chalkEnabled: false });
			expect(plain).toContain("unclosed `inline code snippet");
			expect(plain).toContain("unclosed **bold text");
			expect(plain).toContain("unclosed *italic text");
			expect(plain).toContain("unclosed ~~strikethrough");

			// Ensure it doesn't throw under colored mode
			const colored = formatMarkdown(unclosedInline, { chalkEnabled: true, isTTY: true });
			expect(typeof colored).toBe("string");
		});

		it("should render complex Unicode, multi-byte emojis, ZWJ sequences, and international characters", () => {
			const unicodeMd = [
				"# Unicode Header: 🚀 🌟 💻 🦀 🌍",
				"Family emoji ZWJ: 👨‍👩‍👧‍👦",
				"Complex flags & symbols: 🏁 🏳️‍🌈 ⚠️ ⚡ ⏳ 🧪",
				"CJK text: 你好，世界！ 日本語テスト 한국어 테스트",
				"Arabic / Hebrew: مرحبا بالعالم / שלום עולם",
				"Mathematical symbols: ∑(x_i) = ∫ f(x)dx ≈ ∞ ± √π",
				"**Bold emoji: 🎯 Bullseye** and `code: ⚡ fast`",
			].join("\n");

			const plain = formatMarkdown(unicodeMd, { chalkEnabled: false });
			expect(plain).toContain("👨‍👩‍👧‍👦");
			expect(plain).toContain("你好，世界！");
			expect(plain).toContain("∑(x_i) = ∫ f(x)dx");

			const colored = formatMarkdown(unicodeMd, { chalkEnabled: true, isTTY: true });
			expect(colored).toContain("👨‍👩‍👧‍👦");
			expect(colored).toContain("你好，世界！");
		});

		it("should handle deep multi-level blockquotes", () => {
			const deepQuotes = [
				"> Level 1 quote",
				">> Level 2 nested quote",
				">>> Level 3 deeper quote",
				">>>> Level 4 deepest quote",
			].join("\n");

			const plain = formatMarkdown(deepQuotes, { chalkEnabled: false });
			expect(plain).toContain("> Level 1 quote");
			expect(plain).toContain(">> Level 2 nested quote");

			const colored = formatMarkdown(deepQuotes, { chalkEnabled: true, isTTY: true });
			expect(colored).toContain("│");
			expect(stripAnsi(colored)).toContain("Level 1 quote");
		});

		it("should handle multiple consecutive fenced code blocks", () => {
			const multiBlocks = [
				"First block:",
				"```json",
				'{"key": "value1"}',
				"```",
				"Intermediate text with **bold**",
				"```python",
				'def hello():',
				'    return "world"',
				"```",
				"Trailing text.",
			].join("\n");

			const plain = formatMarkdown(multiBlocks, { chalkEnabled: false });
			expect(plain).toContain("--- [json] ---");
			expect(plain).toContain('{"key": "value1"}');
			expect(plain).toContain("--- [python] ---");
			expect(plain).toContain('def hello():');
			expect(plain).toContain("Intermediate text with bold");
			expect(plain).toContain("Trailing text.");
		});
	});

	// =========================================================================
	// 3. Massive Tool Outputs (2000-Line Strings) & Truncation
	// =========================================================================
	describe("Massive Tool Outputs & Truncation Behavior", () => {
		it("should truncate massive 2000-line tool result keeping exactly 8 lines and accurate summary", () => {
			const lines = Array.from({ length: 2000 }, (_, i) => `log line ${i + 1}: processing request id 0x${i.toString(16)}`);
			const massive2000Lines = lines.join("\n");

			const plain = formatToolResult("run_command", massive2000Lines, false, { chalkEnabled: false });

			expect(plain).toContain("[Tool Result: run_command]");
			expect(plain).toContain("log line 1:");
			expect(plain).toContain("log line 8:");
			// Line 9 and line 2000 should NOT be in the output body
			expect(plain).not.toContain("log line 9:");
			expect(plain).not.toContain("log line 2000:");
			// Truncation summary must accurately state 1992 truncated lines
			expect(plain).toContain("... [truncated 1992 lines,");
			expect(plain).toContain(`${massive2000Lines.length} characters total]`);
		});

		it("should format massive 2000-line tool error with colored visual border without performance degradation", () => {
			const errorLines = Array.from({ length: 2000 }, (_, i) => `at /app/src/module_${i}.ts:${i}:42`);
			const massiveError = "Error: Maximum call stack size exceeded\n" + errorLines.join("\n");

			const startTime = performance.now();
			const colored = formatToolResult("run_command", massiveError, true, { chalkEnabled: true, isTTY: true });
			const elapsedMs = performance.now() - startTime;

			expect(elapsedMs).toBeLessThan(100);
			expect(colored).toContain("❌");
			expect(colored).toContain("Tool Error");
			expect(colored).toContain("run_command");
			expect(colored).toContain("Error: Maximum call stack size exceeded");
			expect(colored).toContain("... [truncated 1993 lines,");
		});

		it("should truncate massive single-line string of 50,000 characters", () => {
			const massiveSingleLine = "DATA_CHUNK_".repeat(5000); // 55,000 chars

			const plain = formatToolResult("query_db", massiveSingleLine, false, { chalkEnabled: false });

			expect(plain).toContain("[Tool Result: query_db]");
			expect(plain).toContain("... (truncated: 55000 chars total)");
			// Total length should be capped around ~400 characters
			expect(plain.length).toBeLessThan(500);
			expect(plain).toContain(massiveSingleLine.slice(0, 50));
		});

		it("should not truncate outputs within limits (<= 10 lines and <= 300 chars)", () => {
			const shortResult = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5";
			const plain = formatToolResult("read_file", shortResult, false, { chalkEnabled: false });

			expect(plain).not.toContain("truncated");
			expect(plain).toContain("Line 1");
			expect(plain).toContain("Line 5");
		});

		it("should handle empty or whitespace-only tool results gracefully", () => {
			const emptyResult = formatToolResult("empty_tool", "", false, { chalkEnabled: false });
			expect(emptyResult).toContain("[Tool Result: empty_tool]");

			const nullResult = formatToolResult("null_tool", null as any, false, { chalkEnabled: false });
			expect(nullResult).toContain("[Tool Result: null_tool]");
		});

		it("should handle CRLF (Windows) newlines properly in line counting", () => {
			const crlfLines = Array.from({ length: 20 }, (_, i) => `CRLF Line ${i + 1}`).join("\r\n");
			const plain = formatToolResult("windows_tool", crlfLines, false, { chalkEnabled: false });

			expect(plain).toContain("CRLF Line 1");
			expect(plain).toContain("CRLF Line 8");
			expect(plain).toContain("... [truncated 12 lines,");
		});
	});

	// =========================================================================
	// 4. LCS Line Diff Edge Cases
	// =========================================================================
	describe("computeLineDiff & formatDiff Stress Cases", () => {
		it("should handle identical 500-line documents efficiently", () => {
			const lines = Array.from({ length: 500 }, (_, i) => `const x_${i} = ${i};`).join("\n");

			const diffs = computeLineDiff(lines, lines);
			expect(diffs.length).toBe(500);
			expect(diffs.every(d => d.type === "same")).toBe(true);

			const formatted = formatDiff(lines, lines, { chalkEnabled: false });
			expect(formatted).not.toContain("+");
			expect(formatted).not.toContain("-");
		});

		it("should handle completely disjoint 200-line documents", () => {
			const docA = Array.from({ length: 200 }, (_, i) => `A_${i}`).join("\n");
			const docB = Array.from({ length: 200 }, (_, i) => `B_${i}`).join("\n");

			const diffs = computeLineDiff(docA, docB);
			expect(diffs.length).toBe(400);

			const formatted = formatDiff(docA, docB, { chalkEnabled: false });
			expect(formatted).toContain("- A_0");
			expect(formatted).toContain("+ B_0");
		});

		it("should handle diffs containing Unicode and special characters", () => {
			const oldText = "Hello 🌍\nfunction test() { return 1; }\nOld line ❌";
			const newText = "Hello 🌍\nfunction test() { return 2; }\nNew line ✔️\nAdded 🚀";

			const formatted = formatDiff(oldText, newText, { chalkEnabled: false });
			expect(formatted).toContain("  Hello 🌍");
			expect(formatted).toContain("- function test() { return 1; }");
			expect(formatted).toContain("+ function test() { return 2; }");
			expect(formatted).toContain("- Old line ❌");
			expect(formatted).toContain("+ New line ✔️");
			expect(formatted).toContain("+ Added 🚀");
		});
	});

	// =========================================================================
	// 5. Tool Call Cards & StreamEvent Edge Cases
	// =========================================================================
	describe("Tool Call Cards & StreamEvent Rendering", () => {
		it("should format tool calls with deeply nested JSON arguments", () => {
			const complexInput = {
				command: "execute_query",
				options: {
					retries: 3,
					timeout: 5000,
					nested: {
						tags: ["production", "v2", "critical"],
						meta: { id: 12345, active: true },
					},
				},
			};

			const plain = formatToolCall("database_query", complexInput, { chalkEnabled: false });
			expect(plain).toContain("[Tool Call: database_query]");
			expect(plain).toContain('"retries": 3');
			expect(plain).toContain('"production"');

			const colored = formatToolCall("database_query", complexInput, { chalkEnabled: true, isTTY: true });
			expect(colored).toContain("Tool Call");
			expect(colored).toContain("database_query");
		});

		it("should render error events with both Error instances and string objects", () => {
			const renderer = new StreamRenderer({ chalkEnabled: false, isTTY: false });

			const errFromInstance = renderer.renderEvent({
				type: "error",
				error: new Error("Network timeout after 30000ms"),
			});
			expect(errFromInstance).toContain("[Error] Network timeout after 30000ms");

			const errFromString = renderer.renderEvent({
				type: "error",
				error: "Fatal exception in runtime" as any,
			});
			expect(errFromString).toContain("[Error] Fatal exception in runtime");
		});

		it("should render done events with and without totalIterations", () => {
			const renderer = new StreamRenderer({ chalkEnabled: false, isTTY: false });

			const doneWithIter = renderer.renderEvent({
				type: "done",
				totalIterations: 5,
			});
			expect(doneWithIter).toContain("[Done] Completed in 5 iteration(s).");

			const doneWithoutIter = renderer.renderEvent({
				type: "done",
			});
			expect(doneWithoutIter).toContain("[Done] Done.");
		});
	});
});
