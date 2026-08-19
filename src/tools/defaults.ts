import { createFileEditTool } from "./file-edit.ts";
import { createFileReadTool } from "./file-read.ts";
import { createFileWriteTool } from "./file-write.ts";
import { createGlobTool } from "./glob.ts";
import { createGrepTool } from "./grep.ts";
import type { ToolRegistry } from "./registry.ts";
import { createShellTool } from "./shell.ts";
import { registerSubagentTools } from "../subagents/tools.ts";
import { registerLSPTools } from "../lsp/tools.ts";
import type { SubagentManager } from "../subagents/manager.ts";
import type { SubagentTypeRegistry } from "../subagents/registry.ts";
import type { LSPDiagnosticsEngine } from "../lsp/engine.ts";

export function registerBuiltinTools(registry: ToolRegistry, projectRoot: string): void {
	registry.register(createFileReadTool(projectRoot));
	registry.register(createFileWriteTool(projectRoot));
	registry.register(createFileEditTool(projectRoot));
	registry.register(createGlobTool(projectRoot));
	registry.register(createGrepTool(projectRoot));
	registry.register(createShellTool(projectRoot));
}

/**
 * Register subagent tools into the ToolRegistry.
 * Call this after SubagentManager is initialized.
 */
export function registerSubagentToolsInDefaults(
	registry: ToolRegistry,
	manager: SubagentManager,
	typeRegistry?: SubagentTypeRegistry,
	agentId?: string,
): void {
	registerSubagentTools(registry, manager, typeRegistry, agentId);
}

/**
 * Register LSP tools into the ToolRegistry.
 * Call this after LSPDiagnosticsEngine is initialized.
 */
export function registerLSPToolsInDefaults(
	registry: ToolRegistry,
	engine: LSPDiagnosticsEngine,
): void {
	registerLSPTools(registry, engine);
}
