import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	LSPDiagnosticsEngine,
	createGetDiagnosticsTool,
	registerLSPTools,
} from "../../src/lsp/index.ts";
import { ToolRegistry } from "../../src/tools/registry.ts";

describe("LSP Diagnostics Engine (diagnostics.test.ts)", () => {
	let tmpDir: string;
	let engine: LSPDiagnosticsEngine;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "harness-lsp-diagnostics-test-"),
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

	it("returns empty array for clean TypeScript files", async () => {
		const filePath = "src/clean.ts";
		const code = `
export interface User {
  id: string;
  name: string;
  age: number;
}

export function formatUser(user: User): string {
  return \`\${user.name} (\${user.age})\`;
}

export const activeUser: User = {
  id: "u1",
  name: "Alice",
  age: 30,
};
`;
		engine.updateFile(filePath, code);

		const diags = await engine.getDiagnostics(filePath);
		expect(diags).toEqual([]);

		const formatted = await engine.getDiagnosticsFormatted(filePath);
		expect(formatted).toContain("No diagnostic errors found");
	});

	it("detects syntax/parse errors (TS1000..1999) with exact coordinates", async () => {
		const filePath = "src/syntax_error.ts";
		const code = "function broken( { return 123; }"; // missing closing parenthesis
		engine.updateFile(filePath, code);

		const diags = await engine.getDiagnostics(filePath);
		expect(diags.length).toBeGreaterThan(0);

		const syntaxDiag = diags.find((d) => d.code >= 1000 && d.code < 2000);
		expect(syntaxDiag).toBeDefined();
		expect(syntaxDiag?.category).toBe("error");
		expect(syntaxDiag?.line).toBe(1);
		expect(syntaxDiag?.preview).toBeDefined();
		expect(syntaxDiag?.preview).toContain("^");
	});

	it("detects type assignment mismatches (TS2322)", async () => {
		const filePath = "src/type_mismatch.ts";
		const code = 'const count: number = "not-a-number";';
		engine.updateFile(filePath, code);

		const diags = await engine.getDiagnostics(filePath);
		expect(diags.length).toBe(1);

		const diag = diags[0];
		expect(diag.code).toBe(2322);
		expect(diag.category).toBe("error");
		expect(diag.message).toContain("Type 'string' is not assignable to type 'number'");
		expect(diag.line).toBe(1);
		expect(diag.preview).toContain("const count: number");
		expect(diag.preview).toContain("^");
	});

	it("detects invalid function arguments (TS2345)", async () => {
		const filePath = "src/arg_mismatch.ts";
		const code = `
function greet(name: string): string {
  return "Hello " + name;
}

greet(42);
`;
		engine.updateFile(filePath, code);

		const diags = await engine.getDiagnostics(filePath);
		expect(diags.length).toBe(1);

		const diag = diags[0];
		expect(diag.code).toBe(2345);
		expect(diag.line).toBe(6);
		expect(diag.message).toContain("Argument of type 'number' is not assignable to parameter of type 'string'");
	});

	it("detects undeclared variables / missing names (TS2304)", async () => {
		const filePath = "src/missing_name.ts";
		const code = "console.log(undeclaredSymbol);";
		engine.updateFile(filePath, code);

		const diags = await engine.getDiagnostics(filePath);
		expect(diags.length).toBe(1);

		const diag = diags[0];
		expect(diag.code).toBe(2304);
		expect(diag.message).toContain("Cannot find name 'undeclaredSymbol'");
	});

	it("detects missing module imports (TS2307)", async () => {
		const filePath = "src/missing_import.ts";
		const code = 'import { nonExistent } from "./non-existent-module";';
		engine.updateFile(filePath, code);

		const diags = await engine.getDiagnostics(filePath);
		expect(diags.length).toBe(1);

		const diag = diags[0];
		expect(diag.code).toBe(2307);
		expect(diag.message).toContain("Cannot find module './non-existent-module'");
	});

	it("filters diagnostics for a single file vs project-wide aggregation", async () => {
		engine.updateFile("src/file1.ts", 'const a: number = "str";');
		engine.updateFile("src/file2.ts", 'const b: boolean = 123; const c: number = "str";');

		const file1Diags = await engine.getDiagnostics("src/file1.ts");
		expect(file1Diags.length).toBe(1);
		expect(file1Diags[0].filePath).toContain("file1.ts");

		const file2Diags = await engine.getDiagnostics("src/file2.ts");
		expect(file2Diags.length).toBe(2);

		const allDiags = await engine.getDiagnostics();
		expect(allDiags.length).toBe(3);
	});

	it("formats diagnostics with line numbers, caret snippets, and TS codes", async () => {
		engine.updateFile("src/format_test.ts", 'const x: number = "hello";');
		const formatted = await engine.getDiagnosticsFormatted("src/format_test.ts");

		expect(formatted).toContain("Found 1 diagnostic(s)");
		expect(formatted).toContain("[Error TS2322]");
		expect(formatted).toContain("Type 'string' is not assignable to type 'number'");
		expect(formatted).toContain("const x: number = \"hello\";");
		expect(formatted).toContain("^");
	});

	it("executes get_diagnostics tool via ToolRegistry with structured output", async () => {
		engine.updateFile("src/tool_test.ts", 'const str: string = 999;');

		const registry = new ToolRegistry();
		registerLSPTools(registry, engine);

		const tool = registry.get("get_diagnostics");
		expect(tool).toBeDefined();

		// Check specific file
		const result = await tool!.execute({ path: "src/tool_test.ts" });
		expect(result.isError).toBe(false);
		expect(result.result).toContain("[Error TS2322]");
		expect(result.result).toContain("Type 'number' is not assignable to type 'string'");

		// Check whole project
		const projectResult = await tool!.execute({});
		expect(projectResult.isError).toBe(false);
		expect(projectResult.result).toContain("Found 1 diagnostic(s)");
	});

	it("handles clean project in get_diagnostics tool cleanly", async () => {
		engine.updateFile("src/clean.ts", "export const value: number = 42;");

		const tool = createGetDiagnosticsTool(engine);
		const result = await tool.execute({ path: "src/clean.ts" });

		expect(result.isError).toBe(false);
		expect(result.result).toContain("No diagnostic errors found");
	});
});
