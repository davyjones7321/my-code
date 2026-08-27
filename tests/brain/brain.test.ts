import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getSystemEnvironmentPrompt } from "../../src/agent/loop.ts";
import { BrainManager } from "../../src/brain/manager.ts";
import { loadBrainLearnings } from "../../src/config/index.ts";

describe("Hermes Agentic Brain Suite", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "harness-brain-test-"));
	});

	afterEach(async () => {
		await fs.promises.rm(tempDir, { recursive: true, force: true });
	});

	it("should initialize BrainManager and write learnings.md", () => {
		const brain = new BrainManager(tempDir);
		const rule = brain.addLearning("Always use bun test on this repo", "testing", true);

		expect(rule.id).toContain("rule-");
		expect(rule.rule).toBe("Always use bun test on this repo");

		const rules = brain.getLearnings();
		expect(rules).toContain("[testing] Always use bun test on this repo");
	});

	it("should format prompt section with active learned rules", () => {
		const brain = new BrainManager(tempDir);
		brain.addLearning("Prefer Tailwind CSS for styling components", "ui", true);

		const promptSection = brain.getPromptSection();
		expect(promptSection).toContain("HERMES AGENTIC BRAIN - LEARNED RULES & EXPERIENCE");
		expect(promptSection).toContain("Prefer Tailwind CSS for styling components");
	});

	it("should inject brain learnings into getSystemEnvironmentPrompt", () => {
		const brain = new BrainManager(tempDir);
		brain.addLearning("Never use deprecated APIs", "coding", true);

		const sysPrompt = getSystemEnvironmentPrompt(tempDir);
		expect(sysPrompt).toContain("HERMES AGENTIC BRAIN - LEARNED RULES & EXPERIENCE");
		expect(sysPrompt).toContain("Never use deprecated APIs");
	});
});
