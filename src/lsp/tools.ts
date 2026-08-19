import type { Tool, ToolRegistry, ToolResult } from "../tools/registry.ts";
import type { LSPDiagnosticsEngine } from "./engine.ts";

/**
 * Creates the get_diagnostics tool for compiler syntax/type diagnostics.
 */
export function createGetDiagnosticsTool(engine: LSPDiagnosticsEngine): Tool {
	return {
		name: "get_diagnostics",
		description:
			"Retrieve TypeScript compiler diagnostics (syntax, semantic, and type errors) for a specific file or the entire project. Returns formatted error messages, line:column locations, and code snippets with caret indicators.",
		inputSchema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description:
						"Optional relative path to a TypeScript/JavaScript file. If omitted, checks all project files.",
				},
				filePath: {
					type: "string",
					description: "Alternative parameter name for path.",
				},
			},
		},
		async execute(input: Record<string, unknown>): Promise<ToolResult> {
			try {
				const rawPath = input.path ?? input.filePath ?? input.file;
				const filePath = rawPath ? String(rawPath) : undefined;
				const formatted = await engine.getDiagnosticsFormatted(filePath);
				return {
					result: formatted,
					isError: false,
				};
			} catch (err: any) {
				return {
					result: `Error retrieving diagnostics: ${err?.message || String(err)}`,
					isError: true,
				};
			}
		},
	};
}

/**
 * Creates the get_definition tool for symbol definition resolution.
 */
export function createGetDefinitionTool(engine: LSPDiagnosticsEngine): Tool {
	return {
		name: "get_definition",
		description:
			"Resolve symbol definition location (file path, line, column, symbol kind, container, and preview snippet) for a symbol at a given 1-based line and column in a file.",
		inputSchema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description:
						"Relative path to the source file containing the symbol.",
				},
				filePath: {
					type: "string",
					description: "Alternative parameter name for path.",
				},
				line: {
					type: "number",
					description: "1-based line number of the symbol.",
				},
				column: {
					type: "number",
					description: "1-based column number of the symbol.",
				},
			},
			required: ["path", "line", "column"],
		},
		async execute(input: Record<string, unknown>): Promise<ToolResult> {
			try {
				const rawPath = input.path ?? input.filePath ?? input.file;
				if (!rawPath || typeof rawPath !== "string") {
					return {
						result: "Error: 'path' parameter is required and must be a string.",
						isError: true,
					};
				}

				const line = Number(input.line);
				const column = Number(input.column);

				if (
					Number.isNaN(line) ||
					line < 1 ||
					Number.isNaN(column) ||
					column < 1
				) {
					return {
						result:
							"Error: 'line' and 'column' must be positive integers (1-based).",
						isError: true,
					};
				}

				const formatted = await engine.getDefinitionFormatted(
					rawPath,
					line,
					column,
				);
				return {
					result: formatted,
					isError: false,
				};
			} catch (err: any) {
				return {
					result: `Error resolving definition: ${err?.message || String(err)}`,
					isError: true,
				};
			}
		},
	};
}

/**
 * Creates the find_references tool for cross-file symbol reference resolution.
 */
export function createFindReferencesTool(engine: LSPDiagnosticsEngine): Tool {
	return {
		name: "find_references",
		description:
			"Find all usages and references of a symbol across the entire project given a file path and 1-based line and column.",
		inputSchema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description:
						"Relative path to the source file containing the symbol.",
				},
				filePath: {
					type: "string",
					description: "Alternative parameter name for path.",
				},
				line: {
					type: "number",
					description: "1-based line number of the symbol.",
				},
				column: {
					type: "number",
					description: "1-based column number of the symbol.",
				},
			},
			required: ["path", "line", "column"],
		},
		async execute(input: Record<string, unknown>): Promise<ToolResult> {
			try {
				const rawPath = input.path ?? input.filePath ?? input.file;
				if (!rawPath || typeof rawPath !== "string") {
					return {
						result: "Error: 'path' parameter is required and must be a string.",
						isError: true,
					};
				}

				const line = Number(input.line);
				const column = Number(input.column);

				if (
					Number.isNaN(line) ||
					line < 1 ||
					Number.isNaN(column) ||
					column < 1
				) {
					return {
						result:
							"Error: 'line' and 'column' must be positive integers (1-based).",
						isError: true,
					};
				}

				const formatted = await engine.findReferencesFormatted(
					rawPath,
					line,
					column,
				);
				return {
					result: formatted,
					isError: false,
				};
			} catch (err: any) {
				return {
					result: `Error finding references: ${err?.message || String(err)}`,
					isError: true,
				};
			}
		},
	};
}

/**
 * Create all LSP tools as an array.
 */
export function createLSPTools(engine: LSPDiagnosticsEngine): Tool[] {
	return [
		createGetDiagnosticsTool(engine),
		createGetDefinitionTool(engine),
		createFindReferencesTool(engine),
	];
}

/**
 * Register all LSP tools into the harness ToolRegistry.
 */
export function registerLSPTools(
	registry: ToolRegistry,
	engine: LSPDiagnosticsEngine,
): void {
	for (const tool of createLSPTools(engine)) {
		registry.register(tool);
	}
}
