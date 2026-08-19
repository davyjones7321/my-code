import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import ts from "typescript";
import {
	InMemoryLanguageServiceHost,
	LSPDiagnosticsEngine,
	normalizeFilePath,
} from "../../src/lsp/index.ts";

describe("LSP Client & LanguageServiceHost (client.test.ts)", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-lsp-client-test-"));
	});

	afterEach(() => {
		try {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		} catch {
			// ignore cleanup errors
		}
	});

	it("initializes with correct default compiler options", () => {
		const host = new InMemoryLanguageServiceHost({ projectRoot: tmpDir });
		const opts = host.getCompilationSettings();

		expect(opts.target).toBe(ts.ScriptTarget.ESNext);
		expect(opts.module).toBe(ts.ModuleKind.ESNext);
		expect(opts.moduleResolution).toBe(ts.ModuleResolutionKind.Bundler);
		expect(opts.strict).toBe(true);
		expect(host.getCurrentDirectory()).toBe(normalizeFilePath(tmpDir));

		const libFileName = host.getDefaultLibFileName(opts);
		expect(libFileName).toBeDefined();
		expect(typeof libFileName).toBe("string");

		host.dispose();
	});

	it("registers new files and creates initial snapshots with version 1", () => {
		const host = new InMemoryLanguageServiceHost({ projectRoot: tmpDir });
		const filePath = path.join(tmpDir, "src/index.ts");
		const content = "const x: number = 42;";

		host.addOrUpdateFile(filePath, content);

		const norm = normalizeFilePath(filePath);
		expect(host.getFileNames()).toContain(norm);
		expect(host.getScriptVersion(filePath)).toBe("1");

		const snapshot = host.getScriptSnapshot(filePath);
		expect(snapshot).toBeDefined();
		expect(snapshot?.getText(0, snapshot.getLength())).toBe(content);
		expect(host.getFileContent(filePath)).toBe(content);
		expect(host.hasFile(filePath)).toBe(true);

		host.dispose();
	});

	it("increments version and updates snapshot on modification", () => {
		const host = new InMemoryLanguageServiceHost({ projectRoot: tmpDir });
		const filePath = path.join(tmpDir, "src/app.ts");
		const content1 = "const v = 1;";
		const content2 = "const v = 2;";

		host.addOrUpdateFile(filePath, content1);
		expect(host.getScriptVersion(filePath)).toBe("1");

		host.addOrUpdateFile(filePath, content2);
		expect(host.getScriptVersion(filePath)).toBe("2");

		const snapshot = host.getScriptSnapshot(filePath);
		expect(snapshot?.getText(0, snapshot.getLength())).toBe(content2);
		expect(host.getFileContent(filePath)).toBe(content2);

		host.dispose();
	});

	it("does not increment version if content is identical", () => {
		const host = new InMemoryLanguageServiceHost({ projectRoot: tmpDir });
		const filePath = path.join(tmpDir, "src/same.ts");
		const content = "const same = true;";

		host.addOrUpdateFile(filePath, content);
		expect(host.getScriptVersion(filePath)).toBe("1");

		host.addOrUpdateFile(filePath, content);
		expect(host.getScriptVersion(filePath)).toBe("1");

		host.dispose();
	});

	it("removes files and cleans up snapshot cache", () => {
		const host = new InMemoryLanguageServiceHost({ projectRoot: tmpDir });
		const filePath = path.join(tmpDir, "src/temp.ts");

		host.addOrUpdateFile(filePath, "const temp = true;");
		expect(host.hasFile(filePath)).toBe(true);

		const deleted = host.deleteFile(filePath);
		expect(deleted).toBe(true);
		expect(host.getFileNames()).not.toContain(normalizeFilePath(filePath));
		expect(host.getScriptSnapshot(filePath)).toBeUndefined();
		expect(host.hasFile(filePath)).toBe(false);

		host.dispose();
	});

	it("reads files from disk when not preloaded in memory", () => {
		const diskFilePath = path.join(tmpDir, "on-disk.ts");
		const diskContent = "export const diskValue: string = 'from disk';";
		fs.writeFileSync(diskFilePath, diskContent, "utf-8");

		const host = new InMemoryLanguageServiceHost({
			projectRoot: tmpDir,
			useDiskFallback: true,
		});

		expect(host.hasFile(diskFilePath)).toBe(true);
		expect(host.readFile(diskFilePath)).toBe(diskContent);

		const snapshot = host.getScriptSnapshot(diskFilePath);
		expect(snapshot).toBeDefined();
		expect(snapshot?.getText(0, snapshot.getLength())).toBe(diskContent);

		host.dispose();
	});

	it("prioritizes in-memory snapshot overlay over disk content", () => {
		const filePath = path.join(tmpDir, "overlay.ts");
		fs.writeFileSync(filePath, "const disk = 100;", "utf-8");

		const host = new InMemoryLanguageServiceHost({
			projectRoot: tmpDir,
			useDiskFallback: true,
		});

		host.addOrUpdateFile(filePath, "const memory = 200;");

		const snapshot = host.getScriptSnapshot(filePath);
		expect(snapshot?.getText(0, snapshot.getLength())).toBe("const memory = 200;");
		expect(host.getFileContent(filePath)).toBe("const memory = 200;");

		host.dispose();
	});

	it("syncs from disk on demand via syncFromDisk", () => {
		const filePath = path.join(tmpDir, "sync.ts");
		fs.writeFileSync(filePath, "const initial = 1;", "utf-8");

		const host = new InMemoryLanguageServiceHost({
			projectRoot: tmpDir,
			useDiskFallback: true,
		});

		host.addOrUpdateFile(filePath, "const initial = 1;");
		expect(host.getScriptVersion(filePath)).toBe("1");

		// Write new content to disk
		fs.writeFileSync(filePath, "const updatedOnDisk = 2;", "utf-8");
		const synced = host.syncFromDisk(filePath);
		expect(synced).toBe(true);
		expect(host.getScriptVersion(filePath)).toBe("2");
		expect(host.getFileContent(filePath)).toBe("const updatedOnDisk = 2;");

		host.dispose();
	});

	it("handles empty files safely", () => {
		const host = new InMemoryLanguageServiceHost({ projectRoot: tmpDir });
		const filePath = path.join(tmpDir, "empty.ts");

		host.addOrUpdateFile(filePath, "");
		const snapshot = host.getScriptSnapshot(filePath);
		expect(snapshot).toBeDefined();
		expect(snapshot?.getLength()).toBe(0);

		host.dispose();
	});

	it("returns undefined snapshot and false for non-existent files", () => {
		const host = new InMemoryLanguageServiceHost({
			projectRoot: tmpDir,
			useDiskFallback: false,
		});
		const nonExistent = path.join(tmpDir, "does-not-exist.ts");

		expect(host.hasFile(nonExistent)).toBe(false);
		expect(host.getScriptSnapshot(nonExistent)).toBeUndefined();
		expect(host.readFile(nonExistent)).toBeUndefined();

		host.dispose();
	});

	it("performs rapid snapshot updates in sub-millisecond time", () => {
		const host = new InMemoryLanguageServiceHost({ projectRoot: tmpDir });
		const filePath = path.join(tmpDir, "perf.ts");

		const start = performance.now();
		for (let i = 0; i < 50; i++) {
			host.addOrUpdateFile(filePath, `const iteration: number = ${i};`);
		}
		const elapsed = performance.now() - start;

		expect(host.getScriptVersion(filePath)).toBe("50");
		expect(elapsed).toBeLessThan(500); // 50 updates well within 500ms (<10ms each)

		host.dispose();
	});

	it("LSPDiagnosticsEngine exposes host and wraps lifecycle", () => {
		const engine = new LSPDiagnosticsEngine({ projectRoot: tmpDir });

		engine.updateFile("test.ts", "export const ok = true;");
		expect(engine.getProjectFiles()).toContain(
			normalizeFilePath(path.resolve(tmpDir, "test.ts")),
		);

		engine.removeFile("test.ts");
		expect(engine.getHost().hasFile("test.ts")).toBe(false);

		engine.dispose();
	});
});
