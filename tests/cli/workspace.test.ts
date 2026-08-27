import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { cdCommand, pwdCommand } from "../../src/tui/commands.ts";
import { renderStatusBar } from "../../src/tui/status-bar.ts";

describe("Dynamic Repository & Workspace Switching Suite", () => {
	let tempRepoA: string;
	let tempRepoB: string;

	beforeEach(async () => {
		tempRepoA = await fs.promises.mkdtemp(path.join(os.tmpdir(), "harness-repo-a-"));
		tempRepoB = await fs.promises.mkdtemp(path.join(os.tmpdir(), "harness-repo-b-"));
	});

	afterEach(async () => {
		await fs.promises.rm(tempRepoA, { recursive: true, force: true });
		await fs.promises.rm(tempRepoB, { recursive: true, force: true });
	});

	it("should display active repo in status bar", () => {
		const status = renderStatusBar(
			{
				providerName: "openrouter",
				modelName: "gpt-4o",
				projectRoot: tempRepoA,
				repoName: path.basename(tempRepoA),
			},
			{ columns: 120, isTTY: false },
		);

		expect(status).toContain(`Repo: ${path.basename(tempRepoA)}`);
	});

	it("should execute /pwd command and output repository details", async () => {
		let outputText = "";
		const context: any = {
			session: {
				getState: () => ({ projectRoot: tempRepoA }),
			},
			output: (text: string) => {
				outputText += text;
			},
		};

		const res = await pwdCommand.execute([], context);
		expect(res.handled).toBe(true);
		expect(outputText).toContain(`Active Repository: ${path.basename(tempRepoA)}`);
	});

	it("should execute /cd command and trigger setProjectRoot", async () => {
		let outputText = "";
		let switchedRoot = "";

		const context: any = {
			session: {
				getState: () => ({ projectRoot: tempRepoA }),
			},
			setProjectRoot: (root: string) => {
				switchedRoot = root;
			},
			output: (text: string) => {
				outputText += text;
			},
		};

		const res = await cdCommand.execute([tempRepoB], context);
		expect(res.handled).toBe(true);
		expect(switchedRoot).toBe(path.resolve(tempRepoB));
		expect(outputText).toContain("Switched active repository to");
	});
});
