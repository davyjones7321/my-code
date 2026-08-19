import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	LSPDiagnosticsEngine,
	SelfHealingCoordinator,
} from "../../src/lsp/index.ts";

describe("LSP Self-Healing Coordinator (self_healing.test.ts)", () => {
	let tmpDir: string;
	let engine: LSPDiagnosticsEngine;
	let coordinator: SelfHealingCoordinator;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "harness-lsp-selfhealing-test-"),
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

	it("classifies diverse compiler diagnostic errors accurately", () => {
		// Syntax error TS1005
		const syntaxDiag = coordinator.classifyDiagnostic({
			filePath: "parser.ts",
			category: "error",
			code: 1005,
			message: "';' expected.",
			line: 1,
			column: 10,
			length: 1,
		});
		expect(syntaxDiag.category).toBe("syntax");
		expect(syntaxDiag.severity).toBe("critical");

		// Missing import TS2304
		const missingNameDiag = coordinator.classifyDiagnostic({
			filePath: "app.ts",
			category: "error",
			code: 2304,
			message: "Cannot find name 'ConfigManager'",
			line: 5,
			column: 12,
			length: 13,
		});
		expect(missingNameDiag.category).toBe("missing_import");
		expect(missingNameDiag.targetSymbol).toBe("ConfigManager");
		expect(missingNameDiag.severity).toBe("high");

		// Type mismatch TS2322
		const typeMismatchDiag = coordinator.classifyDiagnostic({
			filePath: "service.ts",
			category: "error",
			code: 2322,
			message: "Type 'string' is not assignable to type 'number'.",
			line: 10,
			column: 5,
			length: 4,
		});
		expect(typeMismatchDiag.category).toBe("type_mismatch");
		expect(typeMismatchDiag.severity).toBe("high");

		// Property missing TS2339
		const propMissingDiag = coordinator.classifyDiagnostic({
			filePath: "user.ts",
			category: "error",
			code: 2339,
			message: "Property 'age' does not exist on type 'UserProfile'.",
			line: 12,
			column: 15,
			length: 3,
		});
		expect(propMissingDiag.category).toBe("missing_property");
		expect(propMissingDiag.targetSymbol).toBe("age");
		expect(propMissingDiag.severity).toBe("medium");

		// Argument count mismatch TS2554
		const argCountDiag = coordinator.classifyDiagnostic({
			filePath: "calc.ts",
			category: "error",
			code: 2554,
			message: "Expected 2 arguments, but got 1.",
			line: 8,
			column: 1,
			length: 10,
		});
		expect(argCountDiag.category).toBe("argument_count");
		expect(argCountDiag.severity).toBe("medium");

		// Interface incomplete TS2420
		const interfaceDiag = coordinator.classifyDiagnostic({
			filePath: "class.ts",
			category: "error",
			code: 2420,
			message: "Class 'MyService' incorrectly implements interface 'IService'.",
			line: 3,
			column: 7,
			length: 9,
		});
		expect(interfaceDiag.category).toBe("interface_incomplete");
		expect(interfaceDiag.severity).toBe("high");
	});

	it("sorts remediation suggestions by priority (syntax errors first)", () => {
		const diags = [
			{
				filePath: "b_types.ts",
				category: "error" as const,
				code: 2322,
				message: "Type mismatch",
				line: 10,
				column: 5,
				length: 2,
			},
			{
				filePath: "a_syntax.ts",
				category: "error" as const,
				code: 1005,
				message: "Syntax error",
				line: 2,
				column: 1,
				length: 1,
			},
			{
				filePath: "c_prop.ts",
				category: "error" as const,
				code: 2339,
				message: "Property missing",
				line: 15,
				column: 8,
				length: 4,
			},
		];

		const remediations = coordinator.generateRemediations(diags);
		expect(remediations.length).toBe(3);
		// Critical syntax error must be first
		expect(remediations[0].category).toBe("syntax");
		expect(remediations[0].severity).toBe("critical");
		// High type mismatch must be second
		expect(remediations[1].category).toBe("type_mismatch");
		expect(remediations[1].severity).toBe("high");
		// Medium property missing must be third
		expect(remediations[2].category).toBe("missing_property");
		expect(remediations[2].severity).toBe("medium");
	});

	it("generates structured Markdown diagnosis prompts for LLM consumption", () => {
		const diags = [
			{
				filePath: "src/server.ts",
				category: "error" as const,
				code: 2322,
				message: "Type 'string' is not assignable to type 'number'.",
				line: 14,
				column: 7,
				length: 4,
				preview: "  14 | const port: number = '8080';\n     |       ^^^^",
			},
		];

		const prompt = coordinator.generateDiagnosisPrompt(diags);
		expect(prompt).toContain("TypeScript Compiler Diagnostics Found");
		expect(prompt).toContain("src/server.ts");
		expect(prompt).toContain("Line 14, Column 7");
		expect(prompt).toContain("TS2322");
		expect(prompt).toContain("const port: number");
		expect(prompt).toContain("Suggested Fix");
	});

	it("calculates verification deltas accurately", () => {
		const preDiags = [
			{
				filePath: "file1.ts",
				category: "error" as const,
				code: 2322,
				message: "Error 1",
				line: 1,
				column: 1,
				length: 1,
			},
			{
				filePath: "file2.ts",
				category: "error" as const,
				code: 2304,
				message: "Error 2",
				line: 2,
				column: 2,
				length: 1,
			},
		];

		// Case 1: All resolved -> clean
		const outcome1 = coordinator.verifyRemediation(preDiags, []);
		expect(outcome1.status).toBe("clean");
		expect(outcome1.isClean).toBe(true);
		expect(outcome1.resolvedErrors.length).toBe(2);
		expect(outcome1.remainingErrors.length).toBe(0);
		expect(outcome1.newErrors.length).toBe(0);

		// Case 2: 1 resolved, 1 remaining -> improved
		const outcome2 = coordinator.verifyRemediation(preDiags, [preDiags[1]]);
		expect(outcome2.status).toBe("improved");
		expect(outcome2.isClean).toBe(false);
		expect(outcome2.resolvedErrors.length).toBe(1);
		expect(outcome2.remainingErrors.length).toBe(1);

		// Case 3: 1 resolved, but new error introduced -> regressed
		const newDiag = {
			filePath: "file3.ts",
			category: "error" as const,
			code: 1005,
			message: "Syntax error",
			line: 5,
			column: 1,
			length: 1,
		};
		const outcome3 = coordinator.verifyRemediation(preDiags, [newDiag]);
		expect(outcome3.status).toBe("regressed");
		expect(outcome3.newErrors.length).toBe(1);
	});

	it("executes single-round healing and returns clean report", async () => {
		const filePath = "src/app.ts";
		engine.updateFile(filePath, 'export const port: number = "8080";\n');

		const report = await coordinator.checkAndRemediate(
			[filePath],
			async (_prompt, _suggestions) => {
				// Simulated fix: update port to number
				engine.updateFile(filePath, "export const port: number = 8080;\n");
			},
			3,
		);

		expect(report.success).toBe(true);
		expect(report.roundsExecuted).toBe(1);
		expect(report.initialErrorCount).toBe(1);
		expect(report.finalErrorCount).toBe(0);
		expect(report.resolvedErrors?.length).toBe(1);
		expect(report.fixedFiles).toContain(filePath);
	});

	it("executes multi-round cascading healing sequence (Syntax -> Type -> Clean)", async () => {
		const filePath = "src/multi_round.ts";
		// Initial code has a syntax error hiding a type error
		engine.updateFile(filePath, 'function calc(a: number {\n  const x: number = "str";\n  return x;\n}\n');

		let roundCount = 0;
		const report = await coordinator.checkAndRemediate(
			[filePath],
			async (_prompt, suggestions) => {
				roundCount++;
				if (suggestions.some((s) => s.category === "syntax")) {
					// Round 1 fix: fix syntax
					engine.updateFile(
						filePath,
						'function calc(a: number) {\n  const x: number = "str";\n  return x;\n}\n',
					);
				} else if (suggestions.some((s) => s.category === "type_mismatch")) {
					// Round 2 fix: fix type error
					engine.updateFile(
						filePath,
						"function calc(a: number) {\n  const x: number = 42;\n  return x;\n}\n",
					);
				}
			},
			3,
		);

		expect(report.success).toBe(true);
		expect(report.roundsExecuted).toBe(2);
		expect(roundCount).toBe(2);
		expect(report.finalErrorCount).toBe(0);
	});

	it("halts when maxRounds limit is exceeded and reports remaining errors", async () => {
		const filePath = "src/unfixable.ts";
		engine.updateFile(filePath, 'const impossible: number = "not_fixed";\n');

		const report = await coordinator.checkAndRemediate(
			[filePath],
			async () => {
				// No-op fix (fails to fix error)
			},
			2,
		);

		expect(report.success).toBe(false);
		expect(report.roundsExecuted).toBe(2);
		expect(report.finalErrorCount).toBe(1);
		expect(report.remainingErrors?.length).toBe(1);
	});

	it("short-circuits immediately on already clean code", async () => {
		const filePath = "src/clean.ts";
		engine.updateFile(filePath, "export const ready = true;\n");

		let callbackCalled = false;
		const report = await coordinator.checkAndRemediate(
			[filePath],
			async () => {
				callbackCalled = true;
			},
			3,
		);

		expect(report.success).toBe(true);
		expect(report.roundsExecuted).toBe(0);
		expect(callbackCalled).toBe(false);
	});

	it("performs quickScan and returns quick diagnostic summary", async () => {
		engine.updateFile("src/ok.ts", "export const ok = true;\n");
		const cleanScan = await coordinator.quickScan(["src/ok.ts"]);
		expect(cleanScan.isClean).toBe(true);
		expect(cleanScan.errorCount).toBe(0);

		engine.updateFile("src/bad.ts", 'const err: number = "bad";\n');
		const badScan = await coordinator.quickScan(["src/bad.ts"]);
		expect(badScan.isClean).toBe(false);
		expect(badScan.errorCount).toBe(1);
	});
});
