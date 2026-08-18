import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFileEditTool } from "../../src/tools/file-edit.ts";
import { createFileReadTool } from "../../src/tools/file-read.ts";
import { createFileWriteTool } from "../../src/tools/file-write.ts";

describe("File Operations Tools", () => {
	let tmpDir: string;
	let testFile: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-test-"));
		testFile = path.join(tmpDir, "test.txt");
		fs.writeFileSync(testFile, "line 1\nline 2\nline 3\nline 4\nline 5");
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("read_file", () => {
		it("reads existing file, returns content with line numbers", async () => {
			const tool = createFileReadTool(tmpDir);
			const res = await tool.execute({ path: "test.txt" });
			expect(res.isError).toBe(false);
			expect(res.result).toBe("1: line 1\n2: line 2\n3: line 3\n4: line 4\n5: line 5");
		});

		it("returns error for missing file", async () => {
			const tool = createFileReadTool(tmpDir);
			const res = await tool.execute({ path: "missing.txt" });
			expect(res.isError).toBe(true);
			expect(res.result).toContain("File not found");
		});

		it("line range slicing works", async () => {
			const tool = createFileReadTool(tmpDir);
			const res = await tool.execute({ path: "test.txt", startLine: 2, endLine: 4 });
			expect(res.isError).toBe(false);
			expect(res.result).toBe("2: line 2\n3: line 3\n4: line 4");
		});
	});

	describe("write_file", () => {
		it("creates file, creates parent dirs", async () => {
			const tool = createFileWriteTool(tmpDir);
			const res = await tool.execute({ path: "nested/dir/new.txt", content: "hello" });
			expect(res.isError).toBe(false);

			const content = fs.readFileSync(path.join(tmpDir, "nested/dir/new.txt"), "utf-8");
			expect(content).toBe("hello");
		});
	});

	describe("edit_file", () => {
		it("replaces text correctly, returns diff", async () => {
			const tool = createFileEditTool(tmpDir);
			const res = await tool.execute({
				path: "test.txt",
				oldText: "line 3",
				newText: "line THREE",
			});
			expect(res.isError).toBe(false);

			const content = fs.readFileSync(testFile, "utf-8");
			expect(content).toBe("line 1\nline 2\nline THREE\nline 4\nline 5");

			expect(res.result).toContain("- line 3");
			expect(res.result).toContain("+ line THREE");
		});

		it("returns error when old text not found", async () => {
			const tool = createFileEditTool(tmpDir);
			const res = await tool.execute({
				path: "test.txt",
				oldText: "missing text",
				newText: "new text",
			});
			expect(res.isError).toBe(true);
			expect(res.result).toContain("oldText not found");
		});
	});
});
