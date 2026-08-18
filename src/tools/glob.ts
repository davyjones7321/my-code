import path from "node:path";
import { Glob } from "bun";
import type { Tool, ToolResult } from "./registry.ts";

export function createGlobTool(projectRoot: string): Tool {
	return {
		name: "glob_files",
		description: "Find files matching a glob pattern",
		inputSchema: {
			type: "object",
			properties: {
				pattern: { type: "string" },
				cwd: { type: "string" },
			},
			required: ["pattern"],
		},
		async execute(input: Record<string, unknown>): Promise<ToolResult> {
			try {
				const pattern = input.pattern as string;
				const inputCwd = input.cwd as string | undefined;

				const searchDir = inputCwd ? path.resolve(projectRoot, inputCwd) : projectRoot;

				if (!searchDir.startsWith(projectRoot)) {
					return { result: "Error: Permission denied", isError: true };
				}

				const glob = new Glob(pattern);
				const matches: string[] = [];

				for await (const match of glob.scan({ cwd: searchDir, dot: false })) {
					matches.push(match);
					if (matches.length >= 100) {
						matches.push("... (results truncated to 100 entries)");
						break;
					}
				}

				if (matches.length === 0) {
					return { result: "No matches found", isError: false };
				}

				return { result: matches.join("\n"), isError: false };
			} catch (err: any) {
				return { result: `Error: ${err.message}`, isError: true };
			}
		},
	};
}
