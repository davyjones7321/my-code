import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawn } from "bun";
import * as fs from "node:fs";
import * as path from "node:path";
import { compileBinary } from "../../scripts/compile.ts";

describe("Phase 14: Standalone Binary Executable Execution Suite", () => {
	let binaryPath: string;
	let testDistDir: string;

	beforeAll(async () => {
		testDistDir = path.resolve(process.cwd(), "dist-exec-test");
		const res = await compileBinary({ outDir: "dist-exec-test" });
		expect(res.success).toBe(true);
		binaryPath = res.outFiles[0];
	}, 60000);

	afterAll(() => {
		if (fs.existsSync(testDistDir)) {
			fs.rmSync(testDistDir, { recursive: true, force: true });
		}
	});

	it("should execute compiled binary with --version", async () => {
		const proc = spawn([binaryPath, "--version"], {
			stdout: "pipe",
			stderr: "pipe",
		});

		const stdout = await new Response(proc.stdout).text();
		const exitCode = await proc.exited;

		expect(exitCode).toBe(0);
		expect(stdout).toContain("0.1.0");
	});

	it("should execute compiled binary with --build-info", async () => {
		const proc = spawn([binaryPath, "--build-info"], {
			stdout: "pipe",
			stderr: "pipe",
		});

		const stdout = await new Response(proc.stdout).text();
		const exitCode = await proc.exited;

		expect(exitCode).toBe(0);
		expect(stdout).toContain("my-harness v0.1.0");
		expect(stdout).toContain("Integrated Features");
	});

	it("should execute compiled binary with --help", async () => {
		const proc = spawn([binaryPath, "--help"], {
			stdout: "pipe",
			stderr: "pipe",
		});

		const stdout = await new Response(proc.stdout).text();
		const exitCode = await proc.exited;

		expect(exitCode).toBe(0);
		expect(stdout).toContain("Usage: harness");
		expect(stdout).toContain("serve");
		expect(stdout).toContain("cron");
	});
});
