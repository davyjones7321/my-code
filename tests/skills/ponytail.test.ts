import { describe, expect, it } from "bun:test";
import { ponytailCommand } from "../../src/tui/commands.ts";
import { PonytailEngine } from "../../src/skills/ponytail.ts";

describe("Ponytail Anti-Overengineering Suite", () => {
	it("should initialize with full intensity enabled", () => {
		const engine = new PonytailEngine();
		const state = engine.getState();
		expect(state.enabled).toBe(true);
		expect(state.intensity).toBe("full");
		expect(engine.getSystemPromptDirective()).toContain("PONYTAIL MODE (FULL)");
	});

	it("should support changing intensity to ultra or lite", () => {
		const engine = new PonytailEngine();
		engine.setIntensity("ultra");
		expect(engine.getSystemPromptDirective()).toContain("EXTREME PONYTAIL MODE (ULTRA)");

		engine.setIntensity("lite");
		expect(engine.getSystemPromptDirective()).toContain("PONYTAIL MODE (LITE)");
	});

	it("should execute /ponytail command and change intensity", async () => {
		let outputText = "";
		const context: any = {
			output: (text: string) => {
				outputText += text;
			},
		};

		const res = await ponytailCommand.execute(["ultra"], context);
		expect(res.handled).toBe(true);
		expect(outputText).toContain("ULTRA");
	});
});
