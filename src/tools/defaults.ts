import { createFileEditTool } from "./file-edit.ts";
import { createFileReadTool } from "./file-read.ts";
import { createFileWriteTool } from "./file-write.ts";
import { createGlobTool } from "./glob.ts";
import { createGrepTool } from "./grep.ts";
import type { ToolRegistry } from "./registry.ts";
import { createShellTool } from "./shell.ts";

export function registerBuiltinTools(registry: ToolRegistry, projectRoot: string): void {
	registry.register(createFileReadTool(projectRoot));
	registry.register(createFileWriteTool(projectRoot));
	registry.register(createFileEditTool(projectRoot));
	registry.register(createGlobTool(projectRoot));
	registry.register(createGrepTool(projectRoot));
	registry.register(createShellTool(projectRoot));
}
