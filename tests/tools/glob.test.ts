import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGlobTool } from "../../src/tools/glob.ts";

describe("Glob Tool", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-test-glob-"));
		fs.writeFileSync(path.join(tmpDir, "a.ts"), "a");
		fs.writeFileSync(path.join(tmpDir, "b.js"), "b");
		fs.mkdirSync(path.join(tmpDir, "src"));
		fs.writeFileSync(path.join(tmpDir, "src", "c.ts"), "c");
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("finds matching files", async () => {
		const tool = createGlobTool(tmpDir);
		const res = await tool.execute({ pattern: "**/*.ts" });
		expect(res.isError).toBe(false);
		expect(res.result).toContain("a.ts");

		// Normalize path separators for the assertion, or just check inclusion
		const parts = res.result.split("\n");
		expect(parts.some((p) => p.includes("c.ts"))).toBe(true);
		expect(parts.some((p) => p.includes("b.js"))).toBe(false);
	});
});
