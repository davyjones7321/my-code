import { spawn } from "bun";
import type { VerificationCheck, VerificationDiagnostic, VerificationResult } from "../types.ts";

export function createTestCheck(customTestCmd?: string): VerificationCheck {
	return {
		name: "test",
		description: "Unit & integration test suite runner (bun test)",
		async run(projectRoot: string): Promise<VerificationResult> {
			const startTime = Date.now();
			try {
				const isWindows = process.platform === "win32";
				const cmd = customTestCmd || (isWindows ? "bun.exe test" : "bun test");

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
					const lines = output.split("\n");
					for (const line of lines) {
						if (line.includes("(fail)") || line.includes("error:") || line.includes("FAIL")) {
							diagnostics.push({
								message: line.trim(),
								severity: "error",
							});
						}
					}
					if (diagnostics.length === 0) {
						diagnostics.push({
							message: output.trim() || "Test runner failed with exit code " + exitCode,
							severity: "error",
						});
					}
				}

				return {
					name: "test",
					passed: exitCode === 0,
					durationMs,
					diagnostics,
					output,
				};
			} catch (err: any) {
				return {
					name: "test",
					passed: false,
					durationMs: Date.now() - startTime,
					diagnostics: [{ message: err.message, severity: "error" }],
				};
			}
		},
	};
}
