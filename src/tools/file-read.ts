import fs from "node:fs";
import path from "node:path";
import type { Tool, ToolResult } from "./registry.ts";

export function createFileReadTool(projectRoot: string): Tool {
	return {
		name: "read_file",
		description: "Read contents of a file",
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string" },
				startLine: { type: "number" },
				endLine: { type: "number" },
			},
			required: ["path"],
		},
		async execute(input: Record<string, unknown>): Promise<ToolResult> {
			try {
				const relativePath = input.path as string;
				const startLine = input.startLine as number | undefined;
				const endLine = input.endLine as number | undefined;

				const absolutePath = path.resolve(projectRoot, relativePath);

				if (!absolutePath.startsWith(projectRoot)) {
					return { result: "Error: Permission denied", isError: true };
				}

				if (!fs.existsSync(absolutePath)) {
					return { result: `Error: File not found: ${relativePath}`, isError: true };
				}

				const content = fs.readFileSync(absolutePath, "utf-8");
				const lines = content.split("\n");

				let outputLines = lines;
				let start = 1;

				if (startLine !== undefined || endLine !== undefined) {
					start = startLine !== undefined ? Math.max(1, startLine) : 1;
					const end = endLine !== undefined ? Math.min(lines.length, endLine) : lines.length;
					outputLines = lines.slice(start - 1, end);
				}

				const formattedOutput = outputLines.map((line, i) => `${start + i}: ${line}`).join("\n");

				return { result: formattedOutput, isError: false };
			} catch (err: any) {
				return { result: `Error: ${err.message}`, isError: true };
			}
		},
	};
}
