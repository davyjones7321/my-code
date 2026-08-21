import { spawn } from "bun";
import type { VerificationCheck, VerificationDiagnostic, VerificationResult } from "../types.ts";

export function createCustomCheck(name: string, command: string, description?: string): VerificationCheck {
	return {
		name,
		description: description || `Custom shell check: ${command}`,
		async run(projectRoot: string): Promise<VerificationResult> {
			const startTime = Date.now();
			try {
				const isWindows = process.platform === "win32";
				const shell = isWindows ? "cmd" : "sh";
				const shellArgs = isWindows ? ["/c", command] : ["-c", command];

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
						message: output.trim() || `Custom check "${name}" failed with exit code ${exitCode}`,
						severity: "error",
					});
				}

				return {
					name,
					passed: exitCode === 0,
					durationMs,
					diagnostics,
					output,
				};
			} catch (err: any) {
				return {
					name,
					passed: false,
					durationMs: Date.now() - startTime,
					diagnostics: [{ message: err.message, severity: "error" }],
				};
			}
		},
	};
}
