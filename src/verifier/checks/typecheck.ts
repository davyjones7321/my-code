import { spawn } from "bun";
import type { VerificationCheck, VerificationDiagnostic, VerificationResult } from "../types.ts";

export function createTypecheckCheck(customTscCmd?: string): VerificationCheck {
	return {
		name: "typecheck",
		description: "TypeScript compiler type checking (tsc --noEmit)",
		async run(projectRoot: string): Promise<VerificationResult> {
			const startTime = Date.now();
			try {
				const isWindows = process.platform === "win32";
				const cmd = customTscCmd || (isWindows ? "bun.exe x tsc --noEmit" : "bun x tsc --noEmit");
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
					// Parse tsc error output format (file(line,col): error TS1234: message)
					const lines = output.split("\n");
					for (const line of lines) {
						const match = line.match(/^(.+?)\((\d+),(\d+)\):\s+(error\s+TS\d+):\s+(.+)$/);
						if (match) {
							diagnostics.push({
								file: match[1].trim(),
								line: parseInt(match[2], 10),
								column: parseInt(match[3], 10),
								code: match[4],
								message: match[5],
								severity: "error",
							});
						} else if (line.trim().startsWith("error TS")) {
							diagnostics.push({
								message: line.trim(),
								severity: "error",
							});
						}
					}

					if (diagnostics.length === 0) {
						diagnostics.push({
							message: output.trim() || "Typecheck failed with exit code " + exitCode,
							severity: "error",
						});
					}
				}

				return {
					name: "typecheck",
					passed: exitCode === 0,
					durationMs,
					diagnostics,
					output,
				};
			} catch (err: any) {
				return {
					name: "typecheck",
					passed: false,
					durationMs: Date.now() - startTime,
					diagnostics: [{ message: err.message, severity: "error" }],
				};
			}
		},
	};
}
