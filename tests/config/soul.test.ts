import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getSystemEnvironmentPrompt } from "../../src/agent/loop.ts";
import { loadCustomSystemPrompt } from "../../src/config/index.ts";

describe("Exclusive SOUL.md System Prompt File Suite", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "harness-soul-test-"));
	});

	afterEach(async () => {
		await fs.promises.rm(tempDir, { recursive: true, force: true });
	});

	it("should detect and load SOUL.md from project root", () => {
		const soulMd = path.join(tempDir, "SOUL.md");
		fs.writeFileSync(soulMd, "# Custom Persona\nBe extra polite and write clean TypeScript code.");

		const res = loadCustomSystemPrompt(tempDir);
		expect(res.sourceFile).toBe("SOUL.md");
		expect(res.content).toContain("Be extra polite and write clean TypeScript code.");
	});

	it("should detect and load SOUL.md from project root", () => {
		const soulMd = path.join(tempDir, "SOUL.md");
		fs.writeFileSync(soulMd, "# Soul Guidelines\nNever use deprecated APIs.");

		const res = loadCustomSystemPrompt(tempDir);
		expect(res.sourceFile).toBe("SOUL.md");
		expect(res.content).toContain("Never use deprecated APIs.");
	});

	it("should inject custom prompt into system environment prompt", () => {
		const soulMd = path.join(tempDir, "SOUL.md");
		fs.writeFileSync(soulMd, "# Persona\nRole: Senior Architect.");

		const sysPrompt = getSystemEnvironmentPrompt(tempDir);
		expect(sysPrompt).toContain("CUSTOM AGENT INSTRUCTIONS (SOUL.md)");
		expect(sysPrompt).toContain("Role: Senior Architect.");
	});
});
