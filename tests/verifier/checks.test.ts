import { describe, expect, it } from "bun:test";
import { createCustomCheck } from "../../src/verifier/checks/custom.ts";
import { createLintCheck } from "../../src/verifier/checks/lint.ts";
import { createTestCheck } from "../../src/verifier/checks/test.ts";
import { createTypecheckCheck } from "../../src/verifier/checks/typecheck.ts";

describe("Verifier Checks Suite", () => {
	const projectRoot = process.cwd();

	it("should execute typecheck check runner and return result", async () => {
		const check = createTypecheckCheck("echo typecheck ok");
		expect(check.name).toBe("typecheck");
		const res = await check.run(projectRoot);
		expect(res.name).toBe("typecheck");
		expect(res.passed).toBe(true);
		expect(res.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("should execute lint check runner with custom command", async () => {
		const check = createLintCheck("echo lint ok");
		expect(check.name).toBe("lint");
		const res = await check.run(projectRoot);
		expect(res.passed).toBe(true);
	});

	it("should execute test check runner with pattern", async () => {
		const check = createTestCheck("echo test ok");
		expect(check.name).toBe("test");
		const res = await check.run(projectRoot);
		expect(res.passed).toBe(true);
	});

	it("should execute custom check runner with success and failure commands", async () => {
		const successCheck = createCustomCheck("custom-pass", "echo hello");
		const passRes = await successCheck.run(projectRoot);
		expect(passRes.passed).toBe(true);

		const failCheck = createCustomCheck("custom-fail", "exit 1");
		const failRes = await failCheck.run(projectRoot);
		expect(failRes.passed).toBe(false);
		expect(failRes.diagnostics.length).toBeGreaterThan(0);
	});
});
