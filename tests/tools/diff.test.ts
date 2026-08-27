import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DiffEngine } from "../../src/tools/diff.ts";
import { crawlSiteTool } from "../../src/tools/web.ts";
import { checkCommand } from "../../src/tui/commands.ts";

describe("Diffs, Rollback & Crawler Suite", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "harness-diff-test-"));
	});

	afterEach(async () => {
		try {
			await fs.promises.rm(tempDir, { recursive: true, force: true });
		} catch {
			// ignore cleanup locks
		}
	});

	it("should generate unified colorized diff preview", () => {
		const engine = new DiffEngine();
		const diff = engine.generateDiff("test.ts", "const x = 1;", "const x = 2;");
		expect(diff).toContain("--- a/test.ts");
		expect(diff).toContain("+++ b/test.ts");
	});

	it("should backup and restore file via DiffEngine rollback", async () => {
		const engine = new DiffEngine();
		const testFile = path.join(tempDir, "sample.txt");
		await fs.promises.writeFile(testFile, "Original Content", "utf8");

		engine.backupFile(testFile, "Original Content");
		await fs.promises.writeFile(testFile, "Modified Content", "utf8");

		const res = engine.rollbackLast();
		expect(res.restoredCount).toBe(1);
		const restored = await fs.promises.readFile(testFile, "utf8");
		expect(restored).toBe("Original Content");
	});

	it("should have crawl_site tool registered", () => {
		expect(crawlSiteTool.name).toBe("crawl_site");
	});

	it("should execute /check slash command", async () => {
		let outputText = "";
		const context: any = {
			session: { getState: () => ({ projectRoot: tempDir }) },
			output: (text: string) => {
				outputText += text;
			},
		};

		const res = await checkCommand.execute([], context);
		expect(res.handled).toBe(true);
		expect(outputText).toContain("Typecheck");
	});
});
