import fs from "node:fs";
import path from "node:path";
import type { Tool, ToolResult } from "./registry.ts";

export function createFileEditTool(projectRoot: string): Tool {
	return {
		name: "edit_file",
		description: "Replace exact text in a file (first occurrence only)",
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string" },
				oldText: { type: "string" },
				newText: { type: "string" },
			},
			required: ["path", "oldText", "newText"],
		},
		async execute(input: Record<string, unknown>): Promise<ToolResult> {
			try {
				const relativePath = input.path as string;
				const oldText = input.oldText as string;
				const newText = input.newText as string;

				const absolutePath = path.resolve(projectRoot, relativePath);

				if (!absolutePath.startsWith(projectRoot)) {
					return { result: "Error: Permission denied", isError: true };
				}

				if (!fs.existsSync(absolutePath)) {
					return { result: `Error: File not found: ${relativePath}`, isError: true };
				}

				const content = fs.readFileSync(absolutePath, "utf-8");
				const index = content.indexOf(oldText);

				if (index === -1) {
					return { result: "Error: oldText not found in file", isError: true };
				}

				const before = content.substring(0, index);
				const after = content.substring(index + oldText.length);
				const newContent = before + newText + after;

				const { globalDiffEngine } = await import("./diff.ts");
				globalDiffEngine.backupFile(absolutePath, content);

				fs.writeFileSync(absolutePath, newContent, "utf-8");

				// Unified colorized diff for output
				const diffPreview = globalDiffEngine.generateDiff(relativePath, content, newContent);
				return { result: `Successfully edited ${relativePath}${diffPreview}`, isError: false };
			} catch (err: any) {
				return { result: `Error: ${err.message}`, isError: true };
			}
		},
	};
}
