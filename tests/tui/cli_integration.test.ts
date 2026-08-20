import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";

import { buildCli, readAllStdin } from "../../src/cli/index.ts";
import * as tuiModule from "../../src/tui/repl.ts";
import { stripAnsi } from "../../src/tui/status-bar.ts";

describe("Phase 9 CLI Integration Suite", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-cli-test-"));
	});

	afterEach(async () => {
		try {
			await fs.rm(tempDir, { recursive: true, force: true });
		} catch {}
	});

	describe("CLI Command Structure & Option Parsing", () => {
		it("should configure root harness command with all flags", () => {
			const cli = buildCli();
			expect(cli.name()).toBe("harness");
			expect(cli.description()).toBe("A model-agnostic AI agent harness");

			const options = cli.options.map((o) => o.long);
			expect(options).toContain("--provider");
			expect(options).toContain("--model");
			expect(options).toContain("--plan");
			expect(options).toContain("--approval");
			expect(options).toContain("--interactive");
		});

		it("should configure init and run subcommands", () => {
			const cli = buildCli();
			const commands = cli.commands.map((c) => c.name());

			expect(commands).toContain("init");
			expect(commands).toContain("run");
			expect(commands).toContain("skills");

			const runCmd = cli.commands.find((c) => c.name() === "run");
			expect(runCmd).toBeDefined();

			const runOptions = runCmd!.options.map((o) => o.long);
			expect(runOptions).toContain("--provider");
			expect(runOptions).toContain("--model");
			expect(runOptions).toContain("--plan");
			expect(runOptions).toContain("--approval");
			expect(runOptions).toContain("--interactive");
		});
	});

	describe("CLI Routing Logic", () => {
		it("should route bare command to startRepl", async () => {
			let replLaunched = false;
			let passedOptions: any = null;

			const startReplSpy = spyOn(tuiModule, "startRepl").mockImplementation(async (opts) => {
				replLaunched = true;
				passedOptions = opts;
			});

			const cli = buildCli();
			cli.exitOverride(); // Prevent process.exit in tests

			await cli.parseAsync(["node", "harness", "-p", "anthropic", "-m", "claude-3-7-sonnet", "--plan"]);

			expect(replLaunched).toBe(true);
			expect(passedOptions.providerName).toBe("anthropic");
			expect(passedOptions.modelName).toBe("claude-3-7-sonnet");
			expect(passedOptions.planMode).toBe(true);

			startReplSpy.mockRestore();
		});

		it("should route 'run' with -i or --interactive to startRepl", async () => {
			let replLaunched = false;
			let passedOptions: any = null;

			const startReplSpy = spyOn(tuiModule, "startRepl").mockImplementation(async (opts) => {
				replLaunched = true;
				passedOptions = opts;
			});

			const cli = buildCli();
			cli.exitOverride();

			await cli.parseAsync(["node", "harness", "run", "--interactive", "-p", "openai", "--approval", "yolo"]);

			expect(replLaunched).toBe(true);
			expect(passedOptions.providerName).toBe("openai");
			expect(passedOptions.approvalMode).toBe("yolo");

			startReplSpy.mockRestore();
		});

		it("should route 'run' without prompt to startRepl", async () => {
			let replLaunched = false;

			const startReplSpy = spyOn(tuiModule, "startRepl").mockImplementation(async () => {
				replLaunched = true;
			});

			const cli = buildCli();
			cli.exitOverride();

			await cli.parseAsync(["node", "harness", "run"]);

			expect(replLaunched).toBe(true);

			startReplSpy.mockRestore();
		});
	});

	describe("Piped Stdin & Non-TTY Handling", () => {
		it("should return empty string immediately when stdin is a TTY", async () => {
			const originalIsTTY = process.stdin.isTTY;
			(process.stdin as any).isTTY = true;

			try {
				const result = await readAllStdin();
				expect(result).toBe("");
			} finally {
				(process.stdin as any).isTTY = originalIsTTY;
			}
		});

		it("should read piped data to EOF when stdin is not a TTY", async () => {
			const mockStdin = new PassThrough();
			(mockStdin as any).isTTY = false;

			const originalStdin = process.stdin;
			Object.defineProperty(process, "stdin", {
				value: mockStdin,
				configurable: true,
			});

			try {
				const readPromise = readAllStdin();
				mockStdin.write("hello from piped stdin stream\n");
				mockStdin.end();

				const result = await readPromise;
				expect(result.trim()).toBe("hello from piped stdin stream");
			} finally {
				Object.defineProperty(process, "stdin", {
					value: originalStdin,
					configurable: true,
				});
			}
		});

		it("should format non-TTY output with clean text tags", () => {
			const originalIsTTY = process.stdout.isTTY;
			(process.stdout as any).isTTY = false;

			try {
				const sampleText = "Harness active: [Provider: anthropic | Model: claude-3-7 | Mode: build]";
				const stripped = stripAnsi(sampleText);
				expect(stripped).toBe(sampleText);
			} finally {
				(process.stdout as any).isTTY = originalIsTTY;
			}
		});
	});
});
