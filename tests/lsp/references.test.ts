import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	LSPDiagnosticsEngine,
	createFindReferencesTool,
	registerLSPTools,
} from "../../src/lsp/index.ts";
import { ToolRegistry } from "../../src/tools/registry.ts";

describe("LSP References Engine (references.test.ts)", () => {
	let tmpDir: string;
	let engine: LSPDiagnosticsEngine;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "harness-lsp-references-test-"),
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

	it("finds all local references and declaration in a single file", async () => {
		const filePath = "src/local_refs.ts";
		const code = `const baseRate = 0.05;

function calcInterest(principal: number): number {
  return principal * baseRate;
}

function calcTotal(principal: number): number {
  return principal + (principal * baseRate);
}
`;
		engine.updateFile(filePath, code);

		// baseRate on line 1, col 7
		const refs = await engine.findReferences(filePath, 1, 9);
		expect(refs.length).toBe(3); // 1 definition + 2 usages

		const defRef = refs.find((r) => r.isDefinition);
		expect(defRef).toBeDefined();
		expect(defRef?.line).toBe(1);

		const usageRefs = refs.filter((r) => !r.isDefinition);
		expect(usageRefs.length).toBe(2);
		expect(usageRefs[0].line).toBe(4);
		expect(usageRefs[1].line).toBe(8);
	});

	it("finds references across multiple importing files", async () => {
		const loggerPath = "src/logger.ts";
		const authPath = "src/auth.ts";
		const dbPath = "src/db.ts";

		engine.updateFile(
			loggerPath,
			"export function logMessage(msg: string): void {\n  console.log(msg);\n}\n",
		);
		engine.updateFile(
			authPath,
			'import { logMessage } from "./logger.ts";\n\nlogMessage("auth init");\nlogMessage("auth success");\n',
		);
		engine.updateFile(
			dbPath,
			'import { logMessage } from "./logger.ts";\n\nlogMessage("db connected");\n',
		);

		// Find references of logMessage in logger.ts
		const refsFromLogger = await engine.findReferences(loggerPath, 1, 18);
		expect(refsFromLogger.length).toBe(6); // 1 def + 2 imports + 3 call sites

		// Find references of logMessage from auth.ts invocation site
		const refsFromAuth = await engine.findReferences(authPath, 3, 3);
		expect(refsFromAuth.length).toBe(6);
	});

	it("distinguishes write access vs read access", async () => {
		const filePath = "src/mutation.ts";
		const code = `let counter = 0;

counter = counter + 1;
counter += 5;
console.log(counter);
`;
		engine.updateFile(filePath, code);

		const refs = await engine.findReferences(filePath, 1, 5);
		expect(refs.length).toBeGreaterThan(0);

		// counter = ... on line 3 is write access
		const writes = refs.filter((r) => r.isWriteAccess);
		expect(writes.length).toBeGreaterThan(0);
	});

	it("returns only declaration when symbol has 0 other references", async () => {
		const filePath = "src/unused.ts";
		const code = 'export const UNUSED_TOKEN = "secret_value";\n';
		engine.updateFile(filePath, code);

		const refs = await engine.findReferences(filePath, 1, 15);
		expect(refs.length).toBe(1);
		expect(refs[0].isDefinition).toBe(true);
	});

	it("returns empty array for non-symbol positions", async () => {
		const filePath = "src/empty_refs.ts";
		engine.updateFile(filePath, 'const x = 1;\n\n// comment\nconst y = "string";\n');

		// Whitespace
		const wsRefs = await engine.findReferences(filePath, 2, 1);
		expect(wsRefs).toEqual([]);

		// Invalid coordinates
		const outOfBounds = await engine.findReferences(filePath, 100, 100);
		expect(outOfBounds).toEqual([]);
	});

	it("formats reference output with tags ([definition], [write], [reference])", async () => {
		engine.updateFile(
			"src/format_refs.ts",
			"let value = 10;\nvalue = 20;\nconsole.log(value);\n",
		);

		const formatted = await engine.findReferencesFormatted(
			"src/format_refs.ts",
			1,
			5,
		);
		expect(formatted).toContain("Found");
		expect(formatted).toContain("[definition]");
		expect(formatted).toContain("src/format_refs.ts:1");
		expect(formatted).toContain("src/format_refs.ts:2");
	});

	it("executes find_references tool via ToolRegistry with validation", async () => {
		engine.updateFile(
			"src/tool_refs.ts",
			"export const API_URL = 'https://api.example.com';\nconst u1 = API_URL;\nconst u2 = API_URL;\n",
		);

		const registry = new ToolRegistry();
		registerLSPTools(registry, engine);

		const tool = registry.get("find_references");
		expect(tool).toBeDefined();

		const result = await tool!.execute({
			path: "src/tool_refs.ts",
			line: 1,
			column: 16,
		});
		expect(result.isError).toBe(false);
		expect(result.result).toContain("Found 3 reference(s)");
		expect(result.result).toContain("[definition]");
		expect(result.result).toContain("API_URL");

		// Validation errors
		const missingPath = await tool!.execute({ line: 1, column: 1 });
		expect(missingPath.isError).toBe(true);

		const invalidLine = await tool!.execute({
			path: "src/tool_refs.ts",
			line: 0,
			column: 5,
		});
		expect(invalidLine.isError).toBe(true);
	});
});
