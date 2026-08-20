import { describe, expect, it } from "bun:test";
import {
	createSpinner,
	DEFAULT_BRAILLE_FRAMES,
	Spinner,
} from "../../src/tui/spinner.ts";

describe("TUI Animated Spinner Subsystem", () => {
	describe("Initialization & Default State", () => {
		it("should initialize with default braille frames and not spinning", () => {
			const spinner = new Spinner({ isTTY: false });
			expect(spinner.isSpinning()).toBe(false);
			expect(spinner.getText()).toBe("");
		});

		it("should accept initial text as a string constructor argument", () => {
			const spinner = new Spinner("Initial task");
			expect(spinner.getText()).toBe("Initial task");
			expect(spinner.isSpinning()).toBe(false);
		});

		it("should have 10 standard Braille frames in DEFAULT_BRAILLE_FRAMES", () => {
			expect(DEFAULT_BRAILLE_FRAMES.length).toBe(10);
			expect(DEFAULT_BRAILLE_FRAMES[0]).toBe("⠋");
			expect(DEFAULT_BRAILLE_FRAMES[9]).toBe("⠏");
		});
	});

	describe("Message Updating", () => {
		it("should update text via setText() and update()", () => {
			const spinner = new Spinner({ isTTY: false, text: "Initial" });
			expect(spinner.getText()).toBe("Initial");

			spinner.setText("Step 1");
			expect(spinner.getText()).toBe("Step 1");

			spinner.update("Step 2");
			expect(spinner.getText()).toBe("Step 2");
		});
	});

	describe("Start / Stop Lifecycle (TTY Mode)", () => {
		it("should start and stop spinning, writing cursor control codes in TTY mode", () => {
			let output = "";
			const mockStream = {
				isTTY: true,
				write: (chunk: string) => {
					output += chunk;
					return true;
				},
			};

			const spinner = new Spinner({
				text: "Processing data",
				isTTY: true,
				stream: mockStream as any,
				intervalMs: 50,
			});

			spinner.start();
			expect(spinner.isSpinning()).toBe(true);
			// Should hide cursor (\x1b[?25l)
			expect(output).toContain("\x1b[?25l");
			expect(output).toContain("Processing data");

			// Idempotent start
			spinner.start();
			expect(spinner.isSpinning()).toBe(true);

			spinner.stop();
			expect(spinner.isSpinning()).toBe(false);
			// Should restore cursor (\x1b[?25h)
			expect(output).toContain("\x1b[?25h");

			// Idempotent stop
			spinner.stop();
			expect(spinner.isSpinning()).toBe(false);
		});
	});

	describe("Success & Failure Handlers", () => {
		it("should stop spinner and output success symbol on succeed()", () => {
			let output = "";
			const mockStream = {
				isTTY: false,
				write: (chunk: string) => {
					output += chunk;
					return true;
				},
			};

			const spinner = new Spinner({
				text: "Downloading file",
				isTTY: false,
				stream: mockStream as any,
			});

			spinner.start();
			expect(spinner.isSpinning()).toBe(true);

			spinner.succeed("Downloaded successfully");
			expect(spinner.isSpinning()).toBe(false);
			expect(output).toContain("✔");
			expect(output).toContain("Downloaded successfully");
		});

		it("should stop spinner and output error symbol on fail()", () => {
			let output = "";
			const mockStream = {
				isTTY: false,
				write: (chunk: string) => {
					output += chunk;
					return true;
				},
			};

			const spinner = new Spinner({
				text: "Validating token",
				isTTY: false,
				stream: mockStream as any,
			});

			spinner.start();
			expect(spinner.isSpinning()).toBe(true);

			spinner.fail("Token expired");
			expect(spinner.isSpinning()).toBe(false);
			expect(output).toContain("✖");
			expect(output).toContain("Token expired");
		});
	});

	describe("Non-TTY Fallback Mode", () => {
		it("should emit plain text and suppress escape codes in non-TTY mode", () => {
			let output = "";
			const mockStream = {
				isTTY: false,
				write: (chunk: string) => {
					output += chunk;
					return true;
				},
			};

			const spinner = new Spinner({
				text: "Compiling code",
				isTTY: false,
				stream: mockStream as any,
			});

			spinner.start();
			expect(output).toBe("... Compiling code\n");
			expect(output).not.toContain("\x1b[?25l");
			expect(output).not.toContain("\r\x1b[2K");

			spinner.stop();
			expect(spinner.isSpinning()).toBe(false);
		});
	});

	describe("createSpinner Factory", () => {
		it("should create and automatically start the spinner", () => {
			let output = "";
			const mockStream = {
				isTTY: false,
				write: (chunk: string) => {
					output += chunk;
					return true;
				},
			};

			const spinner = createSpinner({
				text: "Auto task",
				isTTY: false,
				stream: mockStream as any,
			});

			expect(spinner.isSpinning()).toBe(true);
			expect(spinner.getText()).toBe("Auto task");
			expect(output).toContain("... Auto task\n");

			spinner.stop();
			expect(spinner.isSpinning()).toBe(false);
		});
	});
});
