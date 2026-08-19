import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	LSPDiagnosticsEngine,
	SelfHealingCoordinator,
	createFindReferencesTool,
	createGetDefinitionTool,
	createGetDiagnosticsTool,
	registerLSPTools,
} from "../../src/lsp/index.ts";
import { ToolRegistry } from "../../src/tools/registry.ts";

describe("LSP Challenger Empirical Stress Tests (challenger_stress.test.ts)", () => {
	let tmpDir: string;
	let engine: LSPDiagnosticsEngine;
	let coordinator: SelfHealingCoordinator;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "harness-lsp-challenger-stress-"),
		);
		engine = new LSPDiagnosticsEngine({ projectRoot: tmpDir });
		coordinator = new SelfHealingCoordinator(engine);
	});

	afterEach(() => {
		engine.dispose();
		try {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		} catch {
			// ignore cleanup errors
		}
	});

	describe("1. Complex TypeScript Type Systems", () => {
		it("correctly validates generic constraints, conditional types, and key remapping", async () => {
			const filePath = "src/generics_advanced.ts";
			const validCode = `
export interface Entity {
	id: string;
	version: number;
}

export type Getters<T> = {
	[K in keyof T as \`get\${Capitalize<string & K>}\`]: () => T[K];
};

export type UnpackPromise<T> = T extends Promise<infer U> ? U : T;

export class EntityStore<T extends Entity> {
	private items: Map<string, T> = new Map();

	public save(item: T): void {
		this.items.set(item.id, item);
	}

	public get(id: string): T | undefined {
		return this.items.get(id);
	}
}

interface User extends Entity {
	id: string;
	version: number;
	name: string;
}

const store = new EntityStore<User>();
store.save({ id: "u1", version: 1, name: "Alice" });
`;
			engine.updateFile(filePath, validCode);
			const cleanDiags = await engine.getDiagnostics(filePath);
			expect(cleanDiags).toEqual([]);

			// Now test invalid generic constraint violation
			const invalidCode = validCode + `\nconst invalidStore = new EntityStore<string>();\n`;
			engine.updateFile(filePath, invalidCode);
			const diags = await engine.getDiagnostics(filePath);
			expect(diags.length).toBeGreaterThan(0);
			const constraintErr = diags.find((d) => d.code === 2344);
			expect(constraintErr).toBeDefined();
			expect(constraintErr?.message).toContain("does not satisfy the constraint 'Entity'");
		});

		it("enforces discriminated union exhaustiveness and invalid discriminant checks", async () => {
			const filePath = "src/discriminated_unions.ts";
			const code = `
export type AppEvent =
	| { type: "LOGIN"; userId: string; timestamp: number }
	| { type: "LOGOUT"; userId: string }
	| { type: "NAVIGATE"; destination: string; from: string };

export function handleEvent(event: AppEvent): string {
	switch (event.type) {
		case "LOGIN":
			return \`User \${event.userId} logged in at \${event.timestamp}\`;
		case "LOGOUT":
			return \`User \${event.userId} logged out\`;
		case "NAVIGATE":
			return \`Navigated to \${event.destination} from \${event.from}\`;
		default: {
			const _exhaustiveCheck: never = event;
			return _exhaustiveCheck;
		}
	}
}
`;
			engine.updateFile(filePath, code);
			let diags = await engine.getDiagnostics(filePath);
			expect(diags).toEqual([]);

			// Add non-exhaustive variant to AppEvent without handling it in switch
			const codeWithNewVariant = `
export type AppEvent =
	| { type: "LOGIN"; userId: string; timestamp: number }
	| { type: "LOGOUT"; userId: string }
	| { type: "NAVIGATE"; destination: string; from: string }
	| { type: "ERROR"; message: string };

export function handleEvent(event: AppEvent): string {
	switch (event.type) {
		case "LOGIN":
			return \`User \${event.userId} logged in\`;
		case "LOGOUT":
			return \`User \${event.userId} logged out\`;
		case "NAVIGATE":
			return \`Navigated to \${event.destination}\`;
		default: {
			const _exhaustiveCheck: never = event;
			return String(_exhaustiveCheck);
		}
	}
}
`;
			engine.updateFile(filePath, codeWithNewVariant);
			diags = await engine.getDiagnostics(filePath);
			expect(diags.length).toBeGreaterThan(0);
			const exhaustiveErr = diags.find((d) => d.code === 2322);
			expect(exhaustiveErr).toBeDefined();
			expect(exhaustiveErr?.message).toContain("not assignable to type 'never'");
		});

		it("handles recursive type definitions and deeply nested tree structures without cycle errors", async () => {
			const filePath = "src/recursive_types.ts";
			const code = `
export type JSONPrimitive = string | number | boolean | null;
export type JSONValue = JSONPrimitive | JSONObject | JSONArray;
export interface JSONObject {
	[key: string]: JSONValue;
}
export type JSONArray = JSONValue[];

export interface TreeNode<T> {
	value: T;
	left?: TreeNode<T>;
	right?: TreeNode<T>;
	children?: TreeNode<T>[];
}

export function depth<T>(node?: TreeNode<T>): number {
	if (!node) return 0;
	const leftDepth = depth(node.left);
	const rightDepth = depth(node.right);
	return 1 + Math.max(leftDepth, rightDepth);
}

const root: TreeNode<JSONValue> = {
	value: {
		nested: {
			array: [1, 2, "three", { deep: true }],
		},
	},
	left: {
		value: "leaf-left",
	},
	right: {
		value: null,
	},
};

export const treeDepth = depth(root);
`;
			engine.updateFile(filePath, code);
			const diags = await engine.getDiagnostics(filePath);
			expect(diags).toEqual([]);

			const defs = await engine.getDefinition(filePath, 23, 15);
			expect(defs.length).toBeGreaterThan(0);
			expect(defs[0].name).toBe("TreeNode");

			const jsonDefs = await engine.getDefinition(filePath, 23, 24);
			expect(jsonDefs.length).toBeGreaterThan(0);
			expect(jsonDefs[0].name).toBe("JSONValue");
		});

		it("supports declaration merging across statements and resolves multi-site definitions", async () => {
			const filePath = "src/declaration_merging.ts";
			const code = `
export interface MergedConfig {
	apiHost: string;
	port: number;
}

export interface MergedConfig {
	timeoutMs: number;
	retries: number;
}

export const serverConfig: MergedConfig = {
	apiHost: "localhost",
	port: 8080,
	timeoutMs: 5000,
	retries: 3,
};
`;
			engine.updateFile(filePath, code);
			const diags = await engine.getDiagnostics(filePath);
			expect(diags).toEqual([]);

			const defs = await engine.getDefinition(filePath, 12, 28);
			expect(defs.length).toBeGreaterThanOrEqual(1);
			expect(defs[0].name).toBe("MergedConfig");

			engine.updateFile(
				filePath,
				`
export interface MergedConfig {
	apiHost: string;
	port: number;
}
export interface MergedConfig {
	timeoutMs: number;
	retries: number;
}
export const incompleteConfig: MergedConfig = {
	apiHost: "localhost",
	port: 8080,
};
`,
			);
			const errorDiags = await engine.getDiagnostics(filePath);
			expect(errorDiags.length).toBeGreaterThan(0);
			expect(errorDiags.some((d) => d.code === 2739 || d.code === 2741)).toBe(true);
		});

		it("detects interface inheritance mismatches and invalid method overrides", async () => {
			const filePath = "src/inheritance_mismatch.ts";
			const code = `
export interface BaseService {
	id: string;
	process(input: string): Promise<string>;
}

export interface IncompatibleService extends BaseService {
	id: number;
	process(input: number): Promise<number>;
}
`;
			engine.updateFile(filePath, code);
			const diags = await engine.getDiagnostics(filePath);
			expect(diags.length).toBeGreaterThan(0);

			const overrideErr = diags.find((d) => d.code === 2430);
			expect(overrideErr).toBeDefined();
			expect(overrideErr?.message).toContain("incorrectly extends interface 'BaseService'");
		});
	});

	describe("2. Self-Healing Multi-Round Cascading Errors", () => {
		it("executes a 4-round cascading error remediation loop cleanly", async () => {
			const filePath = "src/cascade_4round.ts";
			const helperPath = "src/helper_service.ts";

			engine.updateFile(
				filePath,
				`function runWorkflow() {\n  const result = HelperService.executeTask("test"\n  return result;\n}\n`,
			);
			engine.updateFile(
				helperPath,
				`export class HelperService {\n  public static executeTask(task: string): { status: string } {\n    return { status: task };\n  }\n}\n`,
			);

			let roundCount = 0;
			const report = await coordinator.checkAndRemediate(
				[filePath, helperPath],
				async (_prompt, suggestions) => {
					roundCount++;
					if (suggestions.some((s) => s.category === "syntax")) {
						engine.updateFile(
							filePath,
							`function runWorkflow() {\n  const result = HelperService.executeTask("test");\n  return result;\n}\n`,
						);
					} else if (
						suggestions.some((s) => s.category === "missing_import")
					) {
						engine.updateFile(
							filePath,
							`import { HelperService } from "./helper_service.ts";\nfunction runWorkflow(): number {\n  const result: number = HelperService.executeTask("test");\n  return result;\n}\n`,
						);
					} else if (
						suggestions.some((s) => s.category === "type_mismatch")
					) {
						engine.updateFile(
							filePath,
							`import { HelperService } from "./helper_service.ts";\nexport function runWorkflow(): { status: string } {\n  const result = HelperService.executeTask("test");\n  return result;\n}\n`,
						);
					}
				},
				4,
			);

			expect(report.success).toBe(true);
			expect(report.roundsExecuted).toBe(3);
			expect(roundCount).toBe(3);
			expect(report.finalErrorCount).toBe(0);
			expect(report.remainingErrors?.length).toBe(0);
		});

		it("detects regression when a remediation step introduces new compiler errors", async () => {
			const preDiags = [
				{
					filePath: "src/file1.ts",
					category: "error" as const,
					code: 2322,
					message: "Type mismatch",
					line: 10,
					column: 5,
					length: 4,
				},
			];

			const postDiags = [
				{
					filePath: "src/file1.ts",
					category: "error" as const,
					code: 1005,
					message: "';' expected",
					line: 2,
					column: 1,
					length: 1,
				},
				{
					filePath: "src/file2.ts",
					category: "error" as const,
					code: 2304,
					message: "Cannot find name 'missingVar'",
					line: 5,
					column: 10,
					length: 10,
				},
			];

			const outcome = coordinator.verifyRemediation(preDiags, postDiags);
			expect(outcome.status).toBe("regressed");
			expect(outcome.isClean).toBe(false);
			expect(outcome.previousErrorCount).toBe(1);
			expect(outcome.currentErrorCount).toBe(2);
			expect(outcome.resolvedErrors.length).toBe(1);
			expect(outcome.newErrors.length).toBe(2);
		});

		it("resolves cascading dependency errors across 3 inter-connected files", async () => {
			const configPath = "src/project/config.ts";
			const corePath = "src/project/core.ts";
			const appPath = "src/project/app.ts";

			engine.updateFile(configPath, `export interface AppConfig { port: number; host: string; }\n`);
			engine.updateFile(corePath, `import type { AppConfig } from "./config.ts";\nexport function createServer(cfg: AppConfig) { return \`\${cfg.host}:\${cfg.port}\`; }\n`);
			engine.updateFile(appPath, `import { createServer } from "./core.ts";\nexport const url = createServer({ host: "localhost", port: 8080 });\n`);

			let diags = await engine.getDiagnostics();
			expect(diags).toEqual([]);

			engine.updateFile(configPath, `export interface AppConfig { port: number; host: string; ssl: boolean; }\n`);

			diags = await engine.getDiagnostics();
			expect(diags.length).toBeGreaterThan(0);

			engine.updateFile(appPath, `import { createServer } from "./core.ts";\nexport const url = createServer({ host: "localhost", port: 8080, ssl: true });\n`);

			diags = await engine.getDiagnostics();
			expect(diags).toEqual([]);
		});
	});

	describe("3. Delta Calculation & Edge Case Analysis", () => {
		it("evaluates delta calculation behavior with identical error codes on the same line", () => {
			const preDiags = [
				{
					filePath: "src/same_line.ts",
					category: "error" as const,
					code: 2322,
					message: "Type mismatch 1",
					line: 1,
					column: 5,
					length: 4,
				},
				{
					filePath: "src/same_line.ts",
					category: "error" as const,
					code: 2322,
					message: "Type mismatch 2",
					line: 1,
					column: 25,
					length: 4,
				},
			];

			const postDiags = [
				{
					filePath: "src/same_line.ts",
					category: "error" as const,
					code: 2322,
					message: "Type mismatch 2",
					line: 1,
					column: 25,
					length: 4,
				},
			];

			const outcome = coordinator.verifyRemediation(preDiags, postDiags);
			expect(outcome.previousErrorCount).toBe(2);
			expect(outcome.currentErrorCount).toBe(1);
			expect(outcome.isClean).toBe(false);
		});

		it("evaluates empty pre and post diagnostics", () => {
			const outcome = coordinator.verifyRemediation([], []);
			expect(outcome.status).toBe("clean");
			expect(outcome.isClean).toBe(true);
			expect(outcome.previousErrorCount).toBe(0);
			expect(outcome.currentErrorCount).toBe(0);
			expect(outcome.resolvedErrors).toEqual([]);
			expect(outcome.remainingErrors).toEqual([]);
			expect(outcome.newErrors).toEqual([]);
		});

		it("evaluates partial improvement status correctly", () => {
			const preDiags = [
				{ filePath: "a.ts", category: "error" as const, code: 1, message: "m1", line: 1, column: 1, length: 1 },
				{ filePath: "b.ts", category: "error" as const, code: 2, message: "m2", line: 2, column: 1, length: 1 },
				{ filePath: "c.ts", category: "error" as const, code: 3, message: "m3", line: 3, column: 1, length: 1 },
			];

			const postDiags = [
				{ filePath: "b.ts", category: "error" as const, code: 2, message: "m2", line: 2, column: 1, length: 1 },
			];

			const outcome = coordinator.verifyRemediation(preDiags, postDiags);
			expect(outcome.status).toBe("improved");
			expect(outcome.isClean).toBe(false);
			expect(outcome.resolvedErrors.length).toBe(2);
			expect(outcome.remainingErrors.length).toBe(1);
			expect(outcome.newErrors.length).toBe(0);
		});
	});

	describe("4. LSP Tools Integration & Edge Cases", () => {
		it("handles definition and references on overloaded function signatures", async () => {
			const filePath = "src/overloads.ts";
			const code = `
export function processItem(x: string): string;
export function processItem(x: number): number;
export function processItem(x: string | number): string | number {
	if (typeof x === "string") return x.toUpperCase();
	return x * 2;
}

const s = processItem("hello");
const n = processItem(42);
`;
			engine.updateFile(filePath, code);

			const diags = await engine.getDiagnostics(filePath);
			expect(diags).toEqual([]);

			const defs = await engine.getDefinition(filePath, 9, 11);
			expect(defs.length).toBeGreaterThan(0);
			expect(defs[0].name).toBe("processItem");

			const refs = await engine.findReferences(filePath, 2, 17);
			expect(refs.length).toBeGreaterThanOrEqual(4);
		});

		it("integrates LSP tools into ToolRegistry and executes seamlessly", async () => {
			const registry = new ToolRegistry();
			registerLSPTools(registry, engine);

			expect(registry.get("get_diagnostics")).toBeDefined();
			expect(registry.get("get_definition")).toBeDefined();
			expect(registry.get("find_references")).toBeDefined();

			engine.updateFile("src/test_tools.ts", "export const TEST_VAR: string = 'ok';\n");

			const diagRes = await registry.get("get_diagnostics")!.execute({ path: "src/test_tools.ts" });
			expect(diagRes.isError).toBe(false);
			expect(diagRes.result).toContain("No diagnostic errors found");

			const defRes = await registry.get("get_definition")!.execute({
				path: "src/test_tools.ts",
				line: 1,
				column: 14,
			});
			expect(defRes.isError).toBe(false);
			expect(defRes.result).toContain("TEST_VAR");

			const refRes = await registry.get("find_references")!.execute({
				path: "src/test_tools.ts",
				line: 1,
				column: 14,
			});
			expect(refRes.isError).toBe(false);
			expect(refRes.result).toContain("TEST_VAR");
		});
	});
});