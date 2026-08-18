import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	assembleContext,
	buildProjectTier,
	buildStableTier,
	buildVolatileTier,
} from "../../src/context/tiers.ts";

describe("Tiers Builder", () => {
	it("buildStableTier returns system messages with identity and timestamp", () => {
		const msgs = buildStableTier({ systemPrompt: "Custom prompt" });
		expect(msgs.length).toBe(1);
		expect(msgs[0].role).toBe("system");
		const content = msgs[0].content[0];
		if (content.type === "text") {
			expect(content.text).toContain("You are an AI coding assistant");
			expect(content.text).toContain("Custom prompt");
			expect(content.text).toContain("Current time:");
		} else {
			throw new Error("Expected text content");
		}
	});

	it("buildProjectTier finds and loads AGENTS.md from a temp project dir", async () => {
		const tempDir = join(tmpdir(), `harness-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });

		try {
			writeFileSync(join(tempDir, "AGENTS.md"), "Agents rule");
			const msgs = await buildProjectTier(tempDir);
			expect(msgs.length).toBeGreaterThanOrEqual(1); // At least the AGENTS.md
			expect(msgs[0].role).toBe("system");
			const text = msgs[0].content[0].type === "text" ? (msgs[0].content[0] as any).text : "";
			expect(text).toContain("Agents rule");
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("buildProjectTier skips missing instruction files gracefully", async () => {
		const tempDir = join(tmpdir(), `harness-test-empty-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });

		try {
			const msgs = await buildProjectTier(tempDir);
			// git status might fail or not be included
			const hasInstructions = msgs.some((m) => {
				const c = m.content[0];
				return c.type === "text" && c.text.includes("Instructions from");
			});
			expect(hasInstructions).toBe(false);
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("buildVolatileTier includes memory facts when provided", () => {
		const history = [{ role: "user", content: [{ type: "text", text: "hello" }] }] as any;
		const msgs = buildVolatileTier({ conversationHistory: history, memoryFacts: ["likes apples"] });
		expect(msgs.length).toBe(2);
		expect(msgs[0].role).toBe("system");
		expect((msgs[0].content[0] as any).text).toContain("likes apples");
		expect(msgs[1].role).toBe("user");
	});

	it("assembleContext returns tiers in correct order", async () => {
		const tempDir = join(tmpdir(), `harness-test-assemble-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });

		try {
			writeFileSync(join(tempDir, "AGENTS.md"), "Agents rule");

			const history = [{ role: "user", content: [{ type: "text", text: "hello" }] }] as any;

			const msgs = await assembleContext({
				stableConfig: { systemPrompt: "Stable" },
				projectRoot: tempDir,
				conversationHistory: history,
				memoryFacts: ["Fact"],
			});

			expect(msgs.length).toBeGreaterThanOrEqual(4); // stable + agents + memory + history

			// Order check: stable is first
			expect((msgs[0].content[0] as any).text).toContain("Stable");
			// Then project
			expect((msgs[1].content[0] as any).text).toContain("Agents rule");
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
