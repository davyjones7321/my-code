import path from "node:path";
import { spawn } from "bun";
import type { Tool, ToolResult } from "./registry.ts";

export function createShellTool(projectRoot: string): Tool {
	return {
		name: "run_command",
		description: "Run a shell command",
		inputSchema: {
			type: "object",
			properties: {
				command: { type: "string" },
				cwd: { type: "string" },
				timeout: { type: "number" },
			},
			required: ["command"],
		},
		async execute(input: Record<string, unknown>): Promise<ToolResult> {
			try {
				const command = input.command as string;
				const cwd = input.cwd as string | undefined;
				const timeoutMs = (input.timeout as number) || 30000;

				const runDir = cwd ? path.resolve(projectRoot, cwd) : projectRoot;

				if (!runDir.startsWith(projectRoot)) {
					return { result: "Error: Permission denied", isError: true };
				}

				const isWindows = process.platform === "win32";
				const shell = isWindows ? "cmd" : "sh";
				const shellArgs = isWindows ? ["/c", command] : ["-c", command];

				const proc = spawn([shell, ...shellArgs], {
					cwd: runDir,
					stdout: "pipe",
					stderr: "pipe",
				});

				return new Promise<ToolResult>(async (resolve) => {
					let isTimeout = false;
					const timer = setTimeout(() => {
						isTimeout = true;
						proc.kill();
						resolve({ result: `Command timed out after ${timeoutMs}ms.`, isError: true });
					}, timeoutMs);

					try {
						const stdout = await new Response(proc.stdout).text();
						const stderr = await new Response(proc.stderr).text();
						const exitCode = await proc.exited;

						clearTimeout(timer);

						if (isTimeout) return;

						const output = [];
						if (stdout) output.push(`Stdout:\n${stdout}`);
						if (stderr) output.push(`Stderr:\n${stderr}`);
						output.push(`Exit Code: ${exitCode}`);

						resolve({ result: output.join("\n\n"), isError: exitCode !== 0 });
					} catch (e: any) {
						clearTimeout(timer);
						if (!isTimeout) {
							resolve({ result: `Error: ${e.message}`, isError: true });
						}
					}
				});
			} catch (err: any) {
				return { result: `Error: ${err.message}`, isError: true };
			}
		},
	};
}
