import { spawn } from "bun";
import * as path from "node:path";

export interface TypecheckResult {
	hasErrors: boolean;
	errorCount: number;
	output: string;
}

export class LSPChecker {
	public async runTypecheck(projectRoot: string = process.cwd()): Promise<TypecheckResult> {
		try {
			const isWindows = process.platform === "win32";
			const bunCmd = isWindows ? "bun.exe" : "bun";

			const proc = spawn([bunCmd, "x", "tsc", "--noEmit"], {
				cwd: projectRoot,
				stdout: "pipe",
				stderr: "pipe",
			});

			const stdout = await new Response(proc.stdout).text();
			const stderr = await new Response(proc.stderr).text();
			const exitCode = await proc.exited;

			const fullOutput = (stdout + "\n" + stderr).trim();

			if (exitCode === 0) {
				return {
					hasErrors: false,
					errorCount: 0,
					output: "✅ [Typecheck Passed]: No TypeScript or syntax errors found.",
				};
			}

			const errorMatches = fullOutput.match(/error TS\d+/g) || [];
			return {
				hasErrors: true,
				errorCount: errorMatches.length || 1,
				output: `❌ [Typecheck Errors Found (${errorMatches.length || 1})]:\n${fullOutput}`,
			};
		} catch (error: any) {
			return {
				hasErrors: true,
				errorCount: 1,
				output: `Typecheck execution error: ${error.message}`,
			};
		}
	}
}

export const globalLSPChecker = new LSPChecker();
