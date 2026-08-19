import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	LSPDiagnosticsEngine,
	createGetDefinitionTool,
	registerLSPTools,
} from "../../src/lsp/index.ts";
import { ToolRegistry } from "../../src/tools/registry.ts";

describe("LSP Definition Resolution (definition.test.ts)", () => {
	let tmpDir: string;
	let engine: LSPDiagnosticsEngine;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "harness-lsp-definition-test-"),
		);
		engine = new LSPDiagnosticsEngine({ projectRoot: tmpDir });
	});

	afterEach(() => {
		engine.dispose();
		try {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		} catch {
			// ignore cleanup errors
		}
	});

	it("resolves local function definition from invocation site", async () => {
		const filePath = "src/functions.ts";
		const code = `function calculateSum(a: number, b: number): number {
  return a + b;
}

const total = calculateSum(5, 10);
`;
		engine.updateFile(filePath, code);

		// calculateSum is invoked on line 5 at column 15
		const defs = await engine.getDefinition(filePath, 5, 16);
		expect(defs.length).toBeGreaterThan(0);

		const def = defs[0];
		expect(def.name).toBe("calculateSum");
		expect(def.line).toBe(1);
		expect(def.column).toBe(10);
		expect(def.kind).toBe("function");
		expect(def.preview).toBeDefined();
		expect(def.preview).toContain("function calculateSum");
	});

	it("resolves variable and constant definitions", async () => {
		const filePath = "src/constants.ts";
		const code = `const MAX_RETRIES = 5;

function retryOperation() {
  for (let i = 0; i < MAX_RETRIES; i++) {
    // retry
  }
}
`;
		engine.updateFile(filePath, code);

		// MAX_RETRIES on line 4, col 24
		const defs = await engine.getDefinition(filePath, 4, 25);
		expect(defs.length).toBe(1);

		const def = defs[0];
		expect(def.name).toBe("MAX_RETRIES");
		expect(def.line).toBe(1);
		expect(def.column).toBe(7);
	});

	it("resolves class, method, and property definitions", async () => {
		const filePath = "src/classes.ts";
		const code = `export class UserService {
  private prefix: string = "usr_";

  public getUserId(id: number): string {
    return this.prefix + id;
  }
}

const service = new UserService();
const uid = service.getUserId(42);
`;
		engine.updateFile(filePath, code);

		// Resolves new UserService() on line 9, col 23
		const classDefs = await engine.getDefinition(filePath, 9, 23);
		expect(classDefs.length).toBeGreaterThan(0);
		expect(classDefs[0].name).toBe("UserService");
		expect(classDefs[0].line).toBe(1);

		// Resolves service.getUserId on line 10, col 23
		const methodDefs = await engine.getDefinition(filePath, 10, 23);
		expect(methodDefs.length).toBe(1);
		expect(methodDefs[0].name).toBe("getUserId");
		expect(methodDefs[0].line).toBe(4);
	});

	it("resolves interface and type alias definitions", async () => {
		const filePath = "src/types.ts";
		const code = `export interface UserProfile {
  id: string;
  name: string;
}

export function displayProfile(profile: UserProfile): void {
  console.log(profile.name);
}
`;
		engine.updateFile(filePath, code);

		// UserProfile on line 6, col 42
		const defs = await engine.getDefinition(filePath, 6, 42);
		expect(defs.length).toBe(1);
		expect(defs[0].name).toBe("UserProfile");
		expect(defs[0].line).toBe(1);
	});

	it("resolves cross-file module imports", async () => {
		const mathPath = "src/math.ts";
		const appPath = "src/app.ts";

		engine.updateFile(
			mathPath,
			"export function multiply(a: number, b: number): number {\n  return a * b;\n}\n",
		);
		engine.updateFile(
			appPath,
			'import { multiply } from "./math.ts";\n\nconst result = multiply(6, 7);\n',
		);

		// multiply(6, 7) on line 3, col 17
		const defs = await engine.getDefinition(appPath, 3, 17);
		expect(defs.length).toBe(1);

		const def = defs[0];
		expect(def.name).toBe("multiply");
		expect(def.filePath).toContain("math.ts");
		expect(def.line).toBe(1);
		expect(def.preview).toContain("function multiply");
	});

	it("resolves re-exported symbols through index/barrel files", async () => {
		engine.updateFile(
			"src/models/user.ts",
			"export interface User {\n  id: string;\n  name: string;\n}\n",
		);
		engine.updateFile(
			"src/models/index.ts",
			'export { User } from "./user.ts";\n',
		);
		engine.updateFile(
			"src/main.ts",
			'import { User } from "./models/index.ts";\n\nconst u: User = { id: "1", name: "Bob" };\n',
		);

		const defs = await engine.getDefinition("src/main.ts", 3, 11);
		expect(defs.length).toBeGreaterThan(0);
		expect(defs[0].name).toBe("User");
		expect(defs[0].filePath).toContain("user.ts");
	});

	it("handles invalid or non-symbol positions gracefully", async () => {
		const filePath = "src/test.ts";
		engine.updateFile(filePath, "const x = 1;\n\n// comment line\n");

		// Empty line / whitespace
		const emptyDefs = await engine.getDefinition(filePath, 2, 1);
		expect(emptyDefs).toEqual([]);

		// Out of bounds coordinates
		const outOfBoundsDefs = await engine.getDefinition(filePath, 999, 999);
		expect(outOfBoundsDefs).toEqual([]);

		// Invalid 0/negative coordinates
		const invalidDefs = await engine.getDefinition(filePath, 0, -5);
		expect(invalidDefs).toEqual([]);
	});

	it("formats definition results with context preview snippets", async () => {
		engine.updateFile(
			"src/format_def.ts",
			"export function helper() {\n  return 'ready';\n}\n\nhelper();\n",
		);

		const formatted = await engine.getDefinitionFormatted(
			"src/format_def.ts",
			5,
			3,
		);
		expect(formatted).toContain("Found 1 definition(s)");
		expect(formatted).toContain("Symbol: helper (function");
		expect(formatted).toContain("Preview:");
		expect(formatted).toContain("function helper()");
	});

	it("executes get_definition tool via ToolRegistry with validation", async () => {
		engine.updateFile(
			"src/tool_def.ts",
			"export const GREETING = 'Hello World';\nconsole.log(GREETING);\n",
		);

		const registry = new ToolRegistry();
		registerLSPTools(registry, engine);

		const tool = registry.get("get_definition");
		expect(tool).toBeDefined();

		// Successful execution
		const result = await tool!.execute({
			path: "src/tool_def.ts",
			line: 2,
			column: 14,
		});
		expect(result.isError).toBe(false);
		expect(result.result).toContain("Symbol: GREETING");
		expect(result.result).toContain("Location: src/tool_def.ts:1");

		// Missing path validation
		const noPathResult = await tool!.execute({ line: 1, column: 1 });
		expect(noPathResult.isError).toBe(true);
		expect(noPathResult.result).toContain("'path' parameter is required");

		// Invalid line/col validation
		const invalidCoordResult = await tool!.execute({
			path: "src/tool_def.ts",
			line: -1,
			column: 0,
		});
		expect(invalidCoordResult.isError).toBe(true);
		expect(invalidCoordResult.result).toContain("positive integers");
	});
});
