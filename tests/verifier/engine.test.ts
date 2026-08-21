import { describe, expect, it } from "bun:test";
import { createCustomCheck } from "../../src/verifier/checks/custom.ts";
import { VerificationEngine } from "../../src/verifier/engine.ts";

describe("VerificationEngine Suite", () => {
	const projectRoot = process.cwd();

	it("should initialize with default checks and allow registering/unregistering checks", () => {
		const engine = new VerificationEngine(projectRoot);
		expect(engine.listChecks().length).toBeGreaterThan(0);

		const custom = createCustomCheck("my-check", "echo ok");
		engine.registerCheck(custom);
		expect(engine.getCheck("my-check")).toBeDefined();

		engine.unregisterCheck("my-check");
		expect(engine.getCheck("my-check")).toBeUndefined();
	});

	it("should execute verification checks and produce summary report", async () => {
		const passCheck = createCustomCheck("check-1", "echo pass");
		const engine = new VerificationEngine(projectRoot, [passCheck]);

		const report = await engine.verify();
		expect(report.allPassed).toBe(true);
		expect(report.passedCount).toBe(1);
		expect(report.failedCount).toBe(0);
		expect(report.summary).toContain("Verification Passed");
	});

	it("should execute checks in parallel when parallel option is true", async () => {
		const check1 = createCustomCheck("c1", "echo 1");
		const check2 = createCustomCheck("c2", "echo 2");
		const engine = new VerificationEngine(projectRoot, [check1, check2]);

		const report = await engine.verify({ parallel: true });
		expect(report.allPassed).toBe(true);
		expect(report.results.length).toBe(2);
	});
});
