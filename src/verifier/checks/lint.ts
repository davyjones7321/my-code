import { spawn } from "bun";
import type { VerificationCheck, VerificationDiagnostic, VerificationResult } from "../types.ts";

export function createLintCheck(customLintCmd?: string): VerificationCheck {
	return {
		name: "lint",
		description: "Linter check (Biome / ESLint)",
		async run(projectRoot: string): Promise<VerificationResult> {
			const startTime = Date.now();
			try {
				const isWindows = process.platform === "win32";
				const cmd = customLintCmd || (isWindows ? "bun.exe x biome check ." : "bun x biome check .");
				const shell = isWindows ? "cmd" : "sh";
				const shellArgs = isWindows ? ["/c", cmd] : ["-c", cmd];

				const proc = spawn([shell, ...shellArgs], {
					cwd: projectRoot,
					stdout: "pipe",
					stderr: "pipe",
				});

				const stdout = await new Response(proc.stdout).text();
				const stderr = await new Response(proc.stderr).text();
				const exitCode = await proc.exited;

				const durationMs = Date.now() - startTime;
				const output = [stdout, stderr].filter(Boolean).join("\n");
				const diagnostics: VerificationDiagnostic[] = [];

				if (exitCode !== 0) {
					diagnostics.push({
						message: output.trim() || "Lint check failed with exit code " + exitCode,
						severity: "error",
					});
				}

				return {
					name: "lint",
					passed: exitCode === 0,
					durationMs,
					diagnostics,
					output,
				};
			} catch (err: any) {
				return {
					name: "lint",
					passed: false,
					durationMs: Date.now() - startTime,
					diagnostics: [{ message: err.message, severity: "error" }],
				};
			}
		},
	};
}
