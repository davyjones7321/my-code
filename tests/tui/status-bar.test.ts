import { describe, expect, it } from "bun:test";
import {
	compactModelName,
	createDefaultSessionState,
	formatDuration,
	formatTokens,
	renderStatusBar,
	StatusBar,
	stripAnsi,
} from "../../src/tui/status-bar.ts";
import type { ReplSessionState } from "../../src/tui/types.ts";

describe("TUI Adaptive StatusBar Subsystem", () => {
	describe("Helper Utilities", () => {
		describe("formatTokens", () => {
			it("should format 0 or negative tokens as '0'", () => {
				expect(formatTokens(0)).toBe("0");
				expect(formatTokens(-50)).toBe("0");
				expect(formatTokens(Number.NaN)).toBe("0");
			});

			it("should format sub-1000 tokens as plain numbers", () => {
				expect(formatTokens(1)).toBe("1");
				expect(formatTokens(450)).toBe("450");
				expect(formatTokens(999)).toBe("999");
			});

			it("should format thousands as 'k' with single decimal if needed", () => {
				expect(formatTokens(1000)).toBe("1k");
				expect(formatTokens(4200)).toBe("4.2k");
				expect(formatTokens(128000)).toBe("128k");
				expect(formatTokens(150400)).toBe("150.4k");
			});

			it("should format millions as 'M'", () => {
				expect(formatTokens(1_000_000)).toBe("1M");
				expect(formatTokens(1_500_000)).toBe("1.5M");
				expect(formatTokens(10_250_000)).toBe("10.25M");
			});
		});

		describe("formatDuration", () => {
			it("should format 0ms and negative ms as 00:00", () => {
				expect(formatDuration(0)).toBe("00:00");
				expect(formatDuration(-1000)).toBe("00:00");
				expect(formatDuration(Number.NaN)).toBe("00:00");
			});

			it("should format seconds into MM:SS", () => {
				expect(formatDuration(5000)).toBe("00:05");
				expect(formatDuration(45000)).toBe("00:45");
				expect(formatDuration(83000)).toBe("01:23");
				expect(formatDuration(3599000)).toBe("59:59");
			});

			it("should format hours into HH:MM:SS", () => {
				expect(formatDuration(3600000)).toBe("01:00:00");
				expect(formatDuration(3665000)).toBe("01:01:05");
				expect(formatDuration(86400000)).toBe("24:00:00");
			});
		});

		describe("compactModelName", () => {
			it("should compact namespace prefixes and date tags", () => {
				expect(compactModelName("anthropic/claude-3-7-sonnet-20250219")).toBe("claude-3-7-sonnet");
				expect(compactModelName("openai/gpt-4o")).toBe("gpt-4o");
				expect(compactModelName("claude-3-5-haiku-20241022")).toBe("claude-3-5-haiku");
				expect(compactModelName("")).toBe("default");
			});
		});

		describe("stripAnsi", () => {
			it("should strip ANSI color and control codes", () => {
				const colored = "\u001b[32mBUILD\u001b[39m \u001b[1mBold\u001b[22m";
				expect(stripAnsi(colored)).toBe("BUILD Bold");
				expect(stripAnsi("plain text")).toBe("plain text");
				expect(stripAnsi("")).toBe("");
			});
		});
	});

	describe("renderStatusBar Breakpoints", () => {
		const sampleState: ReplSessionState = {
			id: "test-session",
			createdAt: Date.now() - 83000,
			updatedAt: Date.now(),
			startTime: Date.now() - 83000,
			providerName: "anthropic",
			modelName: "claude-3-7-sonnet",
			mode: "build",
			approvalMode: "manual",
			turnCount: 3,
			inputTokens: 3000,
			outputTokens: 1200,
			totalTokens: 4200,
			estimatedCost: 0.0125,
		};

		describe("Wide Breakpoint (>= 100 columns)", () => {
			it("should render full detailed layout at 100 columns", () => {
				const raw = renderStatusBar(sampleState, {
					columns: 100,
					chalkEnabled: false,
					lastCommandDurationMs: 83000,
				});

				expect(raw).toContain("Repo:");
				expect(raw).toContain("Provider: anthropic");
				expect(raw).toContain("Model: claude-3-7-sonnet");
				expect(raw).toContain("Mode: BUILD");
				expect(raw).toContain("Turn: 3");
				expect(raw).toContain("Tokens: 4.2k/128k (3.3%)");
				expect(raw).toContain("Cost: $0.01");
				expect(raw).toContain("Time: 01:23");
			});

			it("should display PLAN mode in wide layout", () => {
				const planState = { ...sampleState, mode: "plan" as const };
				const raw = renderStatusBar(planState, {
					columns: 120,
					chalkEnabled: false,
					lastCommandDurationMs: 10000,
				});

				expect(raw).toContain("Mode: PLAN");
				expect(raw).toContain("Time: 00:10");
			});

			it("should format colored wide layout when chalk is enabled", () => {
				const colored = renderStatusBar(sampleState, {
					columns: 110,
					chalkEnabled: true,
					isTTY: true,
					lastCommandDurationMs: 83000,
				});

				const clean = stripAnsi(colored);
				expect(clean).toContain("Repo:");
				expect(clean).toContain("Provider: anthropic");
				expect(clean).toContain("Model: claude-3-7-sonnet");
				expect(clean).toContain("Mode: BUILD");
				expect(clean).toContain("Cost: $0.01");
			});
		});

		describe("Medium Breakpoint (60–99 columns)", () => {
			it("should render condensed layout at 80 columns", () => {
				const raw = renderStatusBar(sampleState, {
					columns: 80,
					chalkEnabled: false,
					lastCommandDurationMs: 83000,
				});

				expect(raw).toContain("[anthropic:claude-3-7-sonnet");
				expect(raw).toContain("BUILD");
				expect(raw).toContain("T:3");
				expect(raw).toContain("4.2k (3.3%)");
				expect(raw).toContain("$0.01");
				expect(raw).toContain("01:23");
			});

			it("should render condensed layout at boundaries (60 and 99 columns)", () => {
				const raw60 = renderStatusBar(sampleState, {
					columns: 60,
					chalkEnabled: false,
					lastCommandDurationMs: 60000,
				});
				expect(raw60).toContain("BUILD");
				expect(raw60).toContain("T:3");

				const raw99 = renderStatusBar(sampleState, {
					columns: 99,
					chalkEnabled: false,
					lastCommandDurationMs: 60000,
				});
				expect(raw99).toContain("BUILD");
				expect(raw99).toContain("T:3");
			});
		});

		describe("Narrow Breakpoint (< 60 columns)", () => {
			it("should render minimal compact layout at 50 columns", () => {
				const raw = renderStatusBar(sampleState, {
					columns: 50,
					chalkEnabled: false,
					lastCommandDurationMs: 83000,
				});

				expect(raw).toContain("claude-3-7-sonnet");
				expect(raw).toContain("B");
				expect(raw).toContain("4.2k");
				expect(raw).toContain("01:23");
				expect(raw).not.toContain("Provider:");
			});

			it("should display 'P' for plan mode in narrow layout", () => {
				const planState = { ...sampleState, mode: "plan" as const };
				const raw = renderStatusBar(planState, {
					columns: 40,
					chalkEnabled: false,
					lastCommandDurationMs: 15000,
				});

				expect(raw).toContain("P");
				expect(raw).toContain("00:15");
			});
		});

		describe("Zero and Extreme Token Metrics", () => {
			it("should format 0 tokens cleanly", () => {
				const zeroState = { ...sampleState, totalTokens: 0, estimatedCost: 0 };
				const raw = renderStatusBar(zeroState, {
					columns: 100,
					chalkEnabled: false,
					lastCommandDurationMs: 0,
				});

				expect(raw).toContain("Tokens: 0/128k (0.0%)");
				expect(raw).toContain("Cost: $0.00");
				expect(raw).toContain("Time: 00:00");
			});

			it("should format large token counts (500k+)", () => {
				const bigState = { ...sampleState, totalTokens: 500000, estimatedCost: 7.5 };
				const raw = renderStatusBar(bigState, {
					columns: 100,
					chalkEnabled: false,
					lastCommandDurationMs: 120000,
				});

				expect(raw).toContain("Tokens: 500k/128k (390.6%)");
				expect(raw).toContain("Cost: $7.50");
			});
		});

		describe("Non-TTY Fallback Safety", () => {
			it("should omit ANSI sequences when isTTY is false", () => {
				const raw = renderStatusBar(sampleState, {
					columns: 100,
					isTTY: false,
					lastCommandDurationMs: 83000,
				});

				expect(raw).not.toContain("\u001b");
				expect(raw).toBe(stripAnsi(raw));
			});
		});
	});

	describe("StatusBar Class", () => {
		it("should initialize with default state and provide getters", () => {
			const sb = new StatusBar({ columns: 80 });
			const state = sb.getState();

			expect(state).toBeDefined();
			expect(state.mode).toBe("build");
			expect(sb.getColumns()).toBe(80);
			expect(sb.isActive()).toBe(false);
		});

		it("should update state and options via update()", () => {
			const sb = new StatusBar({ columns: 80 });
			sb.update({ mode: "plan", turnCount: 5 }, { columns: 120 });

			const state = sb.getState();
			expect(state.mode).toBe("plan");
			expect(state.turnCount).toBe(5);
			expect(sb.getColumns()).toBe(120);
		});

		it("should format and render to a custom writable stream", () => {
			let output = "";
			const mockStream = {
				isTTY: false,
				write: (chunk: string) => {
					output += chunk;
					return true;
				},
			};

			const sb = new StatusBar({
				columns: 100,
				isTTY: false,
				stream: mockStream as any,
			});

			const rendered = sb.render({ providerName: "test-provider" });
			expect(rendered).toContain("test-provider");
			expect(output).toContain("test-provider");
			expect(output.endsWith("\n")).toBe(true);
		});

		it("should format with TTY escape codes when isTTY is true", () => {
			let output = "";
			const mockStream = {
				isTTY: true,
				write: (chunk: string) => {
					output += chunk;
					return true;
				},
			};

			const sb = new StatusBar({
				columns: 80,
				isTTY: true,
				stream: mockStream as any,
			});

			sb.render();
			expect(output).toContain("\r\x1b[2K");

			output = "";
			sb.clear();
			expect(output).toBe("\r\x1b[2K");
		});

		it("should safely handle start and stop lifecycle without error", () => {
			const sb = new StatusBar();
			expect(sb.isActive()).toBe(false);

			sb.start();
			expect(sb.isActive()).toBe(true);

			// Idempotent start
			sb.start();
			expect(sb.isActive()).toBe(true);

			sb.stop();
			expect(sb.isActive()).toBe(false);

			// Idempotent stop
			sb.stop();
			expect(sb.isActive()).toBe(false);
		});
	});
});
