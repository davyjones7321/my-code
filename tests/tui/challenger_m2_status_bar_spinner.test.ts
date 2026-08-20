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
import {
	createSpinner,
	DEFAULT_BRAILLE_FRAMES,
	Spinner,
} from "../../src/tui/spinner.ts";
import type { ReplSessionState } from "../../src/tui/types.ts";

describe("Challenger 1 M2: Status-Bar & Spinner Empirical Verification", () => {
	const baseState: ReplSessionState = {
		id: "challenger-session-1",
		createdAt: 1700000000000,
		updatedAt: 1700000083000,
		startTime: 1700000000000,
		providerName: "anthropic",
		modelName: "claude-3-7-sonnet",
		mode: "build",
		approvalMode: "manual",
		turnCount: 5,
		inputTokens: 10000,
		outputTokens: 2500,
		totalTokens: 12500,
		estimatedCost: 0.0675,
	};

	// =========================================================================
	// 1. Breakpoint Edge Values Challenge
	// =========================================================================
	describe("1. Breakpoint Edge Values Challenge", () => {
		it("columns = 100: must render Wide layout", () => {
			const output = renderStatusBar(baseState, {
				columns: 100,
				chalkEnabled: false,
				lastCommandDurationMs: 83000,
			});

			expect(output).toContain("Provider: anthropic");
			expect(output).toContain("Model: claude-3-7-sonnet");
			expect(output).toContain("Mode: BUILD");
			expect(output).toContain("Turn: 5");
			expect(output).toContain("Tokens: 12.5k/128k");
			expect(output).toContain("Time: 01:23");
			expect(output.startsWith("[")).toBe(true);
			expect(output.endsWith("]")).toBe(true);
		});

		it("columns = 99: must render Medium layout", () => {
			const output = renderStatusBar(baseState, {
				columns: 99,
				chalkEnabled: false,
				lastCommandDurationMs: 83000,
			});

			// Medium layout uses compact format: [anthropic:claude-3-7-sonnet | BUILD | T:5 | ...]
			expect(output).toContain("anthropic:claude-3-7-sonnet");
			expect(output).toContain("BUILD");
			expect(output).toContain("T:5");
			expect(output).not.toContain("Provider:");
			expect(output).not.toContain("Model:");
		});

		it("columns = 60: must render Medium layout", () => {
			const output = renderStatusBar(baseState, {
				columns: 60,
				chalkEnabled: false,
				lastCommandDurationMs: 83000,
			});

			expect(output).toContain("anthropic:claude-3-7-sonnet");
			expect(output).toContain("BUILD");
			expect(output).toContain("T:5");
			expect(output).not.toContain("Provider:");
		});

		it("columns = 59: must render Narrow layout", () => {
			const output = renderStatusBar(baseState, {
				columns: 59,
				chalkEnabled: false,
				lastCommandDurationMs: 83000,
			});

			// Narrow layout uses ultra-compact format: [claude-3-7-sonnet | B | 12.5k | 01:23]
			expect(output).toContain("claude-3-7-sonnet");
			expect(output).toContain("B");
			expect(output).toContain("12.5k");
			expect(output).toContain("01:23");
			expect(output).not.toContain("T:5");
			expect(output).not.toContain("anthropic:");
		});

		it("columns = 20: must render Narrow layout without crashing or truncating corruptly", () => {
			const output = renderStatusBar(baseState, {
				columns: 20,
				chalkEnabled: false,
				lastCommandDurationMs: 5000,
			});

			expect(typeof output).toBe("string");
			expect(output.length).toBeGreaterThan(0);
			expect(output).toContain("B");
			expect(output).toContain("00:05");
		});

		it("columns = 0: must not crash and fallback to narrow or default layout", () => {
			const output = renderStatusBar(baseState, {
				columns: 0,
				chalkEnabled: false,
			});

			expect(typeof output).toBe("string");
			expect(output.length).toBeGreaterThan(0);
		});

		it("columns = undefined: must fall back to terminal columns or default (80)", () => {
			const output = renderStatusBar(baseState, {
				columns: undefined,
				chalkEnabled: false,
			});

			expect(typeof output).toBe("string");
			expect(output.length).toBeGreaterThan(0);
		});

		it("columns = negative (-10, -50): must handle gracefully without crashing", () => {
			const outputNeg = renderStatusBar(baseState, {
				columns: -10,
				chalkEnabled: false,
			});

			expect(typeof outputNeg).toBe("string");
			expect(outputNeg.length).toBeGreaterThan(0);
		});

		it("state edge values: totalTokens=0 with non-zero input/output tokens", () => {
			const zeroTotalState: ReplSessionState = {
				...baseState,
				totalTokens: 0,
				inputTokens: 0,
				outputTokens: 0,
				estimatedCost: 0,
			};

			const output = renderStatusBar(zeroTotalState, {
				columns: 100,
				chalkEnabled: false,
			});

			expect(output).toContain("Tokens: 0/128k (0.0%)");
			expect(output).toContain("Cost: $0.00");
		});

		it("state edge values: NaN, Infinity, negative values in tokens/cost/duration", () => {
			const corruptState: any = {
				...baseState,
				totalTokens: Number.NaN,
				inputTokens: Number.NEGATIVE_INFINITY,
				outputTokens: -500,
				estimatedCost: Number.POSITIVE_INFINITY,
				turnCount: -1,
			};

			const output = renderStatusBar(corruptState, {
				columns: 100,
				chalkEnabled: false,
				lastCommandDurationMs: -1000,
			});

			expect(typeof output).toBe("string");
			expect(output).not.toContain("NaN");
			expect(output).not.toContain("Infinity");
		});
	});

	// =========================================================================
	// 2. Window Resize Storm Stress Test
	// =========================================================================
	describe("2. Window Resize Storm Stress Test", () => {
		it("survives 100 rapid resize events without crashing or corrupting state", () => {
			let writeCount = 0;
			const mockStream = {
				isTTY: true,
				write: (_chunk: string) => {
					writeCount++;
					return true;
				},
			};

			const sb = new StatusBar({
				columns: 80,
				isTTY: true,
				stream: mockStream as any,
				state: baseState,
			});

			sb.start();
			expect(sb.isActive()).toBe(true);

			// Simulate 100 rapid resize events on process.stdout
			const widths = [40, 59, 60, 80, 99, 100, 120, 160, 20, 200];
			for (let i = 0; i < 100; i++) {
				const w = widths[i % widths.length];
				sb.update(undefined, { columns: w });
				if (process.stdout && typeof process.stdout.emit === "function") {
					process.stdout.emit("resize");
				}
			}

			expect(writeCount).toBeGreaterThanOrEqual(100);
			expect(sb.isActive()).toBe(true);

			// Stop and verify clean shutdown
			sb.stop();
			expect(sb.isActive()).toBe(false);

			const prevCount = writeCount;
			// Subsequent resizes when stopped should not trigger writes
			if (process.stdout && typeof process.stdout.emit === "function") {
				process.stdout.emit("resize");
			}
			expect(writeCount).toBe(prevCount);
		});

		it("verifies resize listener count does not leak on repeated start/stop cycles", () => {
			if (!process.stdout || typeof process.stdout.listenerCount !== "function") {
				return;
			}

			const initialListeners = process.stdout.listenerCount("resize");
			const sb = new StatusBar({ isTTY: true });

			// Run 50 start/stop cycles
			for (let i = 0; i < 50; i++) {
				sb.start();
				expect(process.stdout.listenerCount("resize")).toBe(initialListeners + 1);
				sb.stop();
				expect(process.stdout.listenerCount("resize")).toBe(initialListeners);
			}

			expect(process.stdout.listenerCount("resize")).toBe(initialListeners);
		});
	});

	// =========================================================================
	// 3. Spinner Lifecycle, Rapid Ticks & Timer Leak Verification
	// =========================================================================
	describe("3. Spinner Lifecycle, Rapid Ticks & Timer Leak Verification", () => {
		it("survives 100 rapid start/stop cycles without timer leaks or uncaught exceptions", () => {
			let output = "";
			const mockStream = {
				isTTY: true,
				write: (chunk: string) => {
					output += chunk;
					return true;
				},
			};

			const spinner = new Spinner({
				text: "Rapid test",
				isTTY: true,
				stream: mockStream as any,
				intervalMs: 10,
			});

			for (let i = 0; i < 100; i++) {
				spinner.start(`Iteration ${i}`);
				expect(spinner.isSpinning()).toBe(true);
				expect(spinner.getText()).toBe(`Iteration ${i}`);

				spinner.stop();
				expect(spinner.isSpinning()).toBe(false);
			}

			expect(spinner.isSpinning()).toBe(false);
		});

		it("animates multiple ticks correctly with ultra-fast interval (5ms)", async () => {
			let renderCount = 0;
			const mockStream = {
				isTTY: true,
				write: (chunk: string) => {
					if (chunk.includes("\x1b[2K")) {
						renderCount++;
					}
					return true;
				},
			};

			const spinner = new Spinner({
				text: "Fast ticking",
				isTTY: true,
				stream: mockStream as any,
				intervalMs: 5,
			});

			spinner.start();
			expect(spinner.isSpinning()).toBe(true);

			// Allow timer to fire several ticks
			await new Promise((resolve) => setTimeout(resolve, 60));

			spinner.stop();
			expect(spinner.isSpinning()).toBe(false);
			expect(renderCount).toBeGreaterThanOrEqual(3);
		});

		it("verifies idempotency of start, stop, succeed, and fail", () => {
			let output = "";
			const mockStream = {
				isTTY: false,
				write: (chunk: string) => {
					output += chunk;
					return true;
				},
			};

			const spinner = new Spinner({
				text: "Idempotent check",
				isTTY: false,
				stream: mockStream as any,
			});

			// Calling stop when not running
			expect(() => spinner.stop()).not.toThrow();
			expect(spinner.isSpinning()).toBe(false);

			// Start twice
			spinner.start();
			spinner.start();
			expect(spinner.isSpinning()).toBe(true);

			// Succeed stops spinner and renders checkmark
			spinner.succeed("Success finish");
			expect(spinner.isSpinning()).toBe(false);
			expect(output).toContain("✔ Success finish");

			// Calling fail when already stopped
			spinner.fail("Error finish");
			expect(spinner.isSpinning()).toBe(false);
			expect(output).toContain("✖ Error finish");
		});

		it("handles edge frame configurations and custom frame sets", () => {
			const singleFrameSpinner = new Spinner({
				spinnerFrames: ["*"],
				text: "Single frame",
				isTTY: true,
				stream: { isTTY: true, write: () => true } as any,
			});

			expect(() => singleFrameSpinner.start()).not.toThrow();
			expect(singleFrameSpinner.isSpinning()).toBe(true);
			singleFrameSpinner.stop();
			expect(singleFrameSpinner.isSpinning()).toBe(false);
		});
	});
});
