import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	toPosixPath,
	validateDirectoryStructure,
	validateSkillDirectory,
	validateSkillDirectorySync,
} from "../../src/skills/validator";
import { parseSkillMarkdown } from "../../src/skills/parser";
import { SkillErrorCodes } from "../../src/skills/types";

describe("Adversarial Validator Stress Tests (validator_adversarial.test.ts)", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-val-adv-"));
	});

	afterEach(async () => {
		try {
			await fs.rm(tmpDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	});

	// =========================================================================
	// Suite 1: Path & Existence Edge Cases
	// =========================================================================
	describe("1. Path and Non-Existent Target Handling", () => {
		it("rejects non-existent directory with ERR_SKILL_NOT_FOUND", async () => {
			const nonExistent = path.join(tmpDir, "does-not-exist-" + Date.now());
			const resAsync = await validateSkillDirectory(nonExistent);
			const resSync = validateSkillDirectorySync(nonExistent);

			expect(resAsync.valid).toBe(false);
			expect(resAsync.errors.some((e) => e.code === SkillErrorCodes.NOT_FOUND)).toBe(true);

			expect(resSync.valid).toBe(false);
			expect(resSync.errors.some((e) => e.code === SkillErrorCodes.NOT_FOUND)).toBe(true);
		});

		it("rejects empty string path gracefully", async () => {
			// empty string path resolves to cwd or fails
			const resAsync = await validateSkillDirectory("");
			const resSync = validateSkillDirectorySync("");

			// Should either reject missing SKILL.md or not found/not directory, but never throw unhandled exception
			expect(typeof resAsync.valid).toBe("boolean");
			expect(typeof resSync.valid).toBe("boolean");
			expect(resAsync.valid).toBe(false);
			expect(resSync.valid).toBe(false);
		});

		it("rejects regular file when passed as skill directory", async () => {
			const filePath = path.join(tmpDir, "skill_as_file.txt");
			await fs.writeFile(filePath, "I am a text file", "utf-8");

			const resAsync = await validateSkillDirectory(filePath);
			const resSync = validateSkillDirectorySync(filePath);

			expect(resAsync.valid).toBe(false);
			expect(resAsync.errors.some((e) => e.code === SkillErrorCodes.NOT_A_DIRECTORY)).toBe(true);

			expect(resSync.valid).toBe(false);
			expect(resSync.errors.some((e) => e.code === SkillErrorCodes.NOT_A_DIRECTORY)).toBe(true);
		});
	});

	// =========================================================================
	// Suite 2: Files instead of Directories for Subfolders
	// =========================================================================
	describe("2. Files Instead of Directories for Subfolders", () => {
		it("detects when scripts is a file instead of a directory", async () => {
			const skillDir = path.join(tmpDir, "scripts-file-skill");
			await fs.mkdir(skillDir, { recursive: true });
			await fs.writeFile(
				path.join(skillDir, "SKILL.md"),
				'---\nname: "scripts-file-skill"\ndescription: "Test scripts as file"\n---\nBody',
				"utf-8",
			);
			await fs.writeFile(path.join(skillDir, "scripts"), "not a dir", "utf-8");

			const resAsync = await validateSkillDirectory(skillDir);
			const resSync = validateSkillDirectorySync(skillDir);

			expect(resAsync.valid).toBe(false);
			expect(resAsync.errors.some((e) => e.code === SkillErrorCodes.INVALID_SUBDIRECTORY)).toBe(true);
			expect(resAsync.errors.some((e) => e.message.includes("'scripts'"))).toBe(true);

			expect(resSync.valid).toBe(false);
			expect(resSync.errors.some((e) => e.code === SkillErrorCodes.INVALID_SUBDIRECTORY)).toBe(true);
			expect(resSync.errors.some((e) => e.message.includes("'scripts'"))).toBe(true);
		});

		it("detects when references is a file instead of a directory", async () => {
			const skillDir = path.join(tmpDir, "references-file-skill");
			await fs.mkdir(skillDir, { recursive: true });
			await fs.writeFile(
				path.join(skillDir, "SKILL.md"),
				'---\nname: "references-file-skill"\ndescription: "Test references as file"\n---\nBody',
				"utf-8",
			);
			await fs.writeFile(path.join(skillDir, "references"), "not a dir", "utf-8");

			const resAsync = await validateSkillDirectory(skillDir);
			const resSync = validateSkillDirectorySync(skillDir);

			expect(resAsync.valid).toBe(false);
			expect(resAsync.errors.some((e) => e.code === SkillErrorCodes.INVALID_SUBDIRECTORY)).toBe(true);
			expect(resAsync.errors.some((e) => e.message.includes("'references'"))).toBe(true);

			expect(resSync.valid).toBe(false);
			expect(resSync.errors.some((e) => e.code === SkillErrorCodes.INVALID_SUBDIRECTORY)).toBe(true);
		});

		it("detects when assets is a file instead of a directory", async () => {
			const skillDir = path.join(tmpDir, "assets-file-skill");
			await fs.mkdir(skillDir, { recursive: true });
			await fs.writeFile(
				path.join(skillDir, "SKILL.md"),
				'---\nname: "assets-file-skill"\ndescription: "Test assets as file"\n---\nBody',
				"utf-8",
			);
			await fs.writeFile(path.join(skillDir, "assets"), "not a dir", "utf-8");

			const resAsync = await validateSkillDirectory(skillDir);
			const resSync = validateSkillDirectorySync(skillDir);

			expect(resAsync.valid).toBe(false);
			expect(resAsync.errors.some((e) => e.code === SkillErrorCodes.INVALID_SUBDIRECTORY)).toBe(true);
			expect(resAsync.errors.some((e) => e.message.includes("'assets'"))).toBe(true);

			expect(resSync.valid).toBe(false);
			expect(resSync.errors.some((e) => e.code === SkillErrorCodes.INVALID_SUBDIRECTORY)).toBe(true);
		});

		it("detects multiple subdirectories simultaneously being files", async () => {
			const skillDir = path.join(tmpDir, "all-subdirs-files-skill");
			await fs.mkdir(skillDir, { recursive: true });
			await fs.writeFile(
				path.join(skillDir, "SKILL.md"),
				'---\nname: "all-files-skill"\ndescription: "All subdirs are files"\n---\nBody',
				"utf-8",
			);
			await fs.writeFile(path.join(skillDir, "scripts"), "file 1", "utf-8");
			await fs.writeFile(path.join(skillDir, "references"), "file 2", "utf-8");
			await fs.writeFile(path.join(skillDir, "assets"), "file 3", "utf-8");

			const resAsync = await validateSkillDirectory(skillDir);
			const resSync = validateSkillDirectorySync(skillDir);

			expect(resAsync.valid).toBe(false);
			const invalidSubdirErrorsAsync = resAsync.errors.filter(
				(e) => e.code === SkillErrorCodes.INVALID_SUBDIRECTORY,
			);
			expect(invalidSubdirErrorsAsync.length).toBe(3);

			expect(resSync.valid).toBe(false);
			const invalidSubdirErrorsSync = resSync.errors.filter(
				(e) => e.code === SkillErrorCodes.INVALID_SUBDIRECTORY,
			);
			expect(invalidSubdirErrorsSync.length).toBe(3);
		});

		it("detects when SKILL.md is a directory instead of a file, even if it has files inside", async () => {
			const skillDir = path.join(tmpDir, "skill-md-dir-with-files");
			await fs.mkdir(path.join(skillDir, "SKILL.md"), { recursive: true });
			await fs.writeFile(
				path.join(skillDir, "SKILL.md", "nested.txt"),
				"some content",
				"utf-8",
			);

			const resAsync = await validateSkillDirectory(skillDir);
			const resSync = validateSkillDirectorySync(skillDir);

			expect(resAsync.valid).toBe(false);
			expect(resAsync.errors.some((e) => e.code === SkillErrorCodes.INVALID_SUBDIRECTORY)).toBe(true);

			expect(resSync.valid).toBe(false);
			expect(resSync.errors.some((e) => e.code === SkillErrorCodes.INVALID_SUBDIRECTORY)).toBe(true);
		});
	});

	// =========================================================================
	// Suite 3: Empty Directories & Ignored Files
	// =========================================================================
	describe("3. Empty Directories & Metadata Filtering", () => {
		it("handles skill directory that is completely empty (no files)", async () => {
			const skillDir = path.join(tmpDir, "completely-empty-dir");
			await fs.mkdir(skillDir, { recursive: true });

			const resAsync = await validateSkillDirectory(skillDir);
			const resSync = validateSkillDirectorySync(skillDir);

			expect(resAsync.valid).toBe(false);
			expect(resAsync.errors.some((e) => e.code === SkillErrorCodes.MISSING_SKILL_MD)).toBe(true);

			expect(resSync.valid).toBe(false);
			expect(resSync.errors.some((e) => e.code === SkillErrorCodes.MISSING_SKILL_MD)).toBe(true);
		});

		it("ignores .git, .DS_Store, and .gitkeep in subdirectories and reports hasScripts/hasAssets as false when only ignored files exist", async () => {
			const skillDir = path.join(tmpDir, "ignored-files-skill");
			await fs.mkdir(path.join(skillDir, "scripts"), { recursive: true });
			await fs.mkdir(path.join(skillDir, "references"), { recursive: true });
			await fs.mkdir(path.join(skillDir, "assets"), { recursive: true });

			await fs.writeFile(
				path.join(skillDir, "SKILL.md"),
				'---\nname: "ignored-files-skill"\ndescription: "Skill with only ignored files in subdirs"\n---\nBody',
				"utf-8",
			);
			await fs.writeFile(path.join(skillDir, "scripts", ".gitkeep"), "", "utf-8");
			await fs.writeFile(path.join(skillDir, "references", ".DS_Store"), "mock", "utf-8");
			await fs.mkdir(path.join(skillDir, "assets", ".git"), { recursive: true });
			await fs.writeFile(path.join(skillDir, "assets", ".git", "HEAD"), "ref", "utf-8");

			const resAsync = await validateSkillDirectory(skillDir);
			const resSync = validateSkillDirectorySync(skillDir);

			expect(resAsync.valid).toBe(true);
			expect(resAsync.manifest?.hasScripts).toBe(false);
			expect(resAsync.manifest?.hasReferences).toBe(false);
			expect(resAsync.manifest?.hasAssets).toBe(false);
			expect(resAsync.manifest?.scripts).toEqual([]);
			expect(resAsync.manifest?.references).toEqual([]);
			expect(resAsync.manifest?.assets).toEqual([]);

			expect(resSync.valid).toBe(true);
			expect(resSync.manifest?.hasScripts).toBe(false);
			expect(resSync.manifest?.hasReferences).toBe(false);
			expect(resSync.manifest?.hasAssets).toBe(false);
		});

		it("permits arbitrary auxiliary files and folders in root without error", async () => {
			const skillDir = path.join(tmpDir, "auxiliary-files-skill");
			await fs.mkdir(path.join(skillDir, ".agents", "worker"), { recursive: true });
			await fs.mkdir(path.join(skillDir, "node_modules", "some-pkg"), { recursive: true });
			await fs.mkdir(path.join(skillDir, "test_data"), { recursive: true });

			await fs.writeFile(
				path.join(skillDir, "SKILL.md"),
				'---\nname: "aux-skill"\ndescription: "Skill with extra files in root"\n---\nBody',
				"utf-8",
			);
			await fs.writeFile(path.join(skillDir, "README.md"), "# Readme", "utf-8");
			await fs.writeFile(path.join(skillDir, "LICENSE"), "MIT License", "utf-8");
			await fs.writeFile(path.join(skillDir, "package.json"), '{"name":"aux"}', "utf-8");
			await fs.writeFile(path.join(skillDir, ".gitignore"), "node_modules/", "utf-8");

			const resAsync = await validateSkillDirectory(skillDir);
			const resSync = validateSkillDirectorySync(skillDir);

			expect(resAsync.valid).toBe(true);
			expect(resAsync.manifest?.frontmatter.name).toBe("aux-skill");
			expect(resSync.valid).toBe(true);
			expect(resSync.manifest?.frontmatter.name).toBe("aux-skill");
		});
	});

	// =========================================================================
	// Suite 4: Deep Nesting & Large Directory Structures
	// =========================================================================
	describe("4. Deep Nesting & Asset Resolution", () => {
		it("recursively traverses 10+ levels of nested directories in assets and scripts with POSIX paths", async () => {
			const skillDir = path.join(tmpDir, "deep-nested-skill");
			const deepAssetsDir = path.join(
				skillDir,
				"assets",
				"l1",
				"l2",
				"l3",
				"l4",
				"l5",
				"l6",
				"l7",
				"l8",
				"l9",
				"l10",
			);
			await fs.mkdir(deepAssetsDir, { recursive: true });

			const deepScriptsDir = path.join(skillDir, "scripts", "a", "b", "c", "d");
			await fs.mkdir(deepScriptsDir, { recursive: true });

			await fs.writeFile(
				path.join(skillDir, "SKILL.md"),
				'---\nname: "deep-skill"\ndescription: "Deeply nested assets and scripts"\n---\nBody',
				"utf-8",
			);
			await fs.writeFile(path.join(deepAssetsDir, "deep_asset.json"), '{"deep": true}', "utf-8");
			await fs.writeFile(path.join(deepScriptsDir, "deep_runner.py"), 'print("deep")', "utf-8");

			const resAsync = await validateSkillDirectory(skillDir);
			const resSync = validateSkillDirectorySync(skillDir);

			expect(resAsync.valid).toBe(true);
			expect(resAsync.manifest?.hasAssets).toBe(true);
			expect(resAsync.manifest?.hasScripts).toBe(true);

			// Assert POSIX formatting (forward slashes only)
			expect(resAsync.manifest?.assets).toContain(
				"assets/l1/l2/l3/l4/l5/l6/l7/l8/l9/l10/deep_asset.json",
			);
			expect(resAsync.manifest?.scripts).toContain("scripts/a/b/c/d/deep_runner.py");

			// Ensure zero backslashes in asset/script paths on any OS
			for (const a of resAsync.manifest!.assets) {
				expect(a).not.toContain("\\");
			}
			for (const s of resAsync.manifest!.scripts) {
				expect(s).not.toContain("\\");
			}

			// Sync parity
			expect(resSync.manifest?.assets).toEqual(resAsync.manifest!.assets);
			expect(resSync.manifest?.scripts).toEqual(resAsync.manifest!.scripts);
		});

		it("handles 100+ files across multiple subdirectories quickly and sorted", async () => {
			const skillDir = path.join(tmpDir, "many-files-skill");
			await fs.mkdir(path.join(skillDir, "assets", "batch1"), { recursive: true });
			await fs.mkdir(path.join(skillDir, "assets", "batch2"), { recursive: true });
			await fs.mkdir(path.join(skillDir, "references", "docs"), { recursive: true });
			await fs.mkdir(path.join(skillDir, "scripts", "utils"), { recursive: true });

			await fs.writeFile(
				path.join(skillDir, "SKILL.md"),
				'---\nname: "many-files-skill"\ndescription: "Skill with 100+ files"\n---\nBody',
				"utf-8",
			);

			const filePromises: Promise<void>[] = [];
			for (let i = 0; i < 30; i++) {
				filePromises.push(
					fs.writeFile(
						path.join(skillDir, "assets", "batch1", `asset_${String(i).padStart(3, "0")}.txt`),
						`data ${i}`,
						"utf-8",
					),
				);
				filePromises.push(
					fs.writeFile(
						path.join(skillDir, "assets", "batch2", `asset_${String(i).padStart(3, "0")}.txt`),
						`data ${i}`,
						"utf-8",
					),
				);
				filePromises.push(
					fs.writeFile(
						path.join(skillDir, "references", "docs", `doc_${String(i).padStart(3, "0")}.md`),
						`# Doc ${i}`,
						"utf-8",
					),
				);
				filePromises.push(
					fs.writeFile(
						path.join(skillDir, "scripts", "utils", `tool_${String(i).padStart(3, "0")}.sh`),
						`echo ${i}`,
						"utf-8",
					),
				);
			}
			await Promise.all(filePromises);

			const resAsync = await validateSkillDirectory(skillDir);
			expect(resAsync.valid).toBe(true);
			expect(resAsync.manifest?.assets.length).toBe(60);
			expect(resAsync.manifest?.references.length).toBe(30);
			expect(resAsync.manifest?.scripts.length).toBe(30);

			// Assert deterministic alphabetical sorting
			const sortedAssets = [...resAsync.manifest!.assets].sort();
			expect(resAsync.manifest!.assets).toEqual(sortedAssets);
		});
	});

	// =========================================================================
	// Suite 5: Unusual Characters, Spaces, Unicode & Special Filenames
	// =========================================================================
	describe("5. Filenames with Special Characters and Unicode", () => {
		it("handles files and folders with spaces, unicode, emojis, and symbols", async () => {
			const skillDir = path.join(tmpDir, "weird-names-skill");
			await fs.mkdir(path.join(skillDir, "assets", "my folder with spaces"), {
				recursive: true,
			});
			await fs.mkdir(path.join(skillDir, "references", "指南 🚀"), { recursive: true });
			await fs.mkdir(path.join(skillDir, "scripts"), { recursive: true });

			await fs.writeFile(
				path.join(skillDir, "SKILL.md"),
				'---\nname: "weird-names-skill"\ndescription: "Weird filenames testing"\n---\nBody',
				"utf-8",
			);
			await fs.writeFile(
				path.join(skillDir, "assets", "my folder with spaces", "template file #1 (v2).json"),
				"{}",
				"utf-8",
			);
			await fs.writeFile(
				path.join(skillDir, "references", "指南 🚀", "参考手册_v1.0.md"),
				"# 指南",
				"utf-8",
			);
			await fs.writeFile(
				path.join(skillDir, "scripts", "run-script.test.min.sh"),
				"echo 1",
				"utf-8",
			);

			const resAsync = await validateSkillDirectory(skillDir);
			const resSync = validateSkillDirectorySync(skillDir);

			expect(resAsync.valid).toBe(true);
			expect(resAsync.manifest?.assets).toContain(
				"assets/my folder with spaces/template file #1 (v2).json",
			);
			expect(resAsync.manifest?.references).toContain("references/指南 🚀/参考手册_v1.0.md");
			expect(resAsync.manifest?.scripts).toContain("scripts/run-script.test.min.sh");

			expect(resSync.manifest?.assets).toEqual(resAsync.manifest!.assets);
			expect(resSync.manifest?.references).toEqual(resAsync.manifest!.references);
			expect(resSync.manifest?.scripts).toEqual(resAsync.manifest!.scripts);
		});
	});

	// =========================================================================
	// Suite 6: SKILL.md Malformed & Edge Cases
	// =========================================================================
	describe("6. SKILL.md Content Edge Cases", () => {
		it("handles 0-byte SKILL.md file", async () => {
			const skillDir = path.join(tmpDir, "zero-byte-skill");
			await fs.mkdir(skillDir, { recursive: true });
			await fs.writeFile(path.join(skillDir, "SKILL.md"), "", "utf-8");

			const resAsync = await validateSkillDirectory(skillDir);
			const resSync = validateSkillDirectorySync(skillDir);

			expect(resAsync.valid).toBe(false);
			expect(resAsync.errors.some((e) => e.code === SkillErrorCodes.INVALID_DELIMITER)).toBe(true);
			expect(resSync.valid).toBe(false);
		});

		it("handles SKILL.md containing only whitespace and newlines", async () => {
			const skillDir = path.join(tmpDir, "whitespace-skill");
			await fs.mkdir(skillDir, { recursive: true });
			await fs.writeFile(path.join(skillDir, "SKILL.md"), "   \n\n\t  \n  ", "utf-8");

			const resAsync = await validateSkillDirectory(skillDir);
			expect(resAsync.valid).toBe(false);
			expect(resAsync.errors.some((e) => e.code === SkillErrorCodes.INVALID_DELIMITER)).toBe(true);
		});

		it("handles SKILL.md with null bytes / binary content", async () => {
			const skillDir = path.join(tmpDir, "binary-skill");
			await fs.mkdir(skillDir, { recursive: true });
			const binaryBuffer = Buffer.from([0x00, 0xff, 0xfe, 0x00, 0x12, 0x34]);
			await fs.writeFile(path.join(skillDir, "SKILL.md"), binaryBuffer);

			const resAsync = await validateSkillDirectory(skillDir);
			expect(resAsync.valid).toBe(false);
			expect(resAsync.errors.length).toBeGreaterThan(0);
		});

		it("handles frontmatter with complex YAML anchors, aliases, and multiline scalars", async () => {
			const skillDir = path.join(tmpDir, "yaml-anchors-skill");
			await fs.mkdir(skillDir, { recursive: true });
			const content = `---
name: "anchors-skill"
description: >
  This is a multiline folded description
  that spans several lines
  in standard YAML format.
tags: &default_tags
  - "tag1"
  - "tag2"
custom_tags: *default_tags
---

# Instructions
Content here.
`;
			await fs.writeFile(path.join(skillDir, "SKILL.md"), content, "utf-8");

			const resAsync = await validateSkillDirectory(skillDir);
			expect(resAsync.valid).toBe(true);
			expect(resAsync.manifest?.frontmatter.name).toBe("anchors-skill");
			expect(resAsync.manifest?.frontmatter.description).toContain("multiline folded description");
			expect(resAsync.manifest?.frontmatter.tags).toEqual(["tag1", "tag2"]);
		});
	});

	// =========================================================================
	// Suite 7: Concurrency & Stress Testing
	// =========================================================================
	describe("7. Concurrency & Parallel Execution Stress", () => {
		it("executes 50 concurrent async validations across unique directories with 100% stability", async () => {
			const count = 50;
			const dirs: string[] = [];

			for (let i = 0; i < count; i++) {
				const sDir = path.join(tmpDir, `concurrent-skill-${i}`);
				await fs.mkdir(path.join(sDir, "scripts"), { recursive: true });
				await fs.mkdir(path.join(sDir, "assets"), { recursive: true });
				await fs.writeFile(
					path.join(sDir, "SKILL.md"),
					`---\nname: "skill-${i}"\ndescription: "Concurrent skill test ${i}"\n---\n# Step ${i}`,
					"utf-8",
				);
				await fs.writeFile(path.join(sDir, "scripts", `run_${i}.sh`), `echo ${i}`, "utf-8");
				await fs.writeFile(path.join(sDir, "assets", `data_${i}.json`), `{"i": ${i}}`, "utf-8");
				dirs.push(sDir);
			}

			// Validate all 50 in parallel
			const promises = dirs.map((d, i) => validateSkillDirectory(d, i % 2 === 0 ? "project" : "global"));
			const results = await Promise.all(promises);

			expect(results.length).toBe(count);
			for (let i = 0; i < count; i++) {
				const res = results[i];
				expect(res.valid).toBe(true);
				expect(res.errors).toHaveLength(0);
				expect(res.manifest?.frontmatter.name).toBe(`skill-${i}`);
				expect(res.manifest?.hasScripts).toBe(true);
				expect(res.manifest?.hasAssets).toBe(true);
				expect(res.manifest?.scope).toBe(i % 2 === 0 ? "project" : "global");
			}
		});

		it("executes 50 concurrent async validations on the EXACT same directory without race conditions", async () => {
			const sDir = path.join(tmpDir, "shared-skill");
			await fs.mkdir(path.join(sDir, "references"), { recursive: true });
			await fs.writeFile(
				path.join(sDir, "SKILL.md"),
				'---\nname: "shared-skill"\ndescription: "Shared concurrent access"\n---\nInstructions',
				"utf-8",
			);
			await fs.writeFile(path.join(sDir, "references", "guide.md"), "# Guide", "utf-8");

			const promises = Array.from({ length: 50 }, () => validateSkillDirectory(sDir, "project"));
			const results = await Promise.all(promises);

			for (const res of results) {
				expect(res.valid).toBe(true);
				expect(res.manifest?.frontmatter.name).toBe("shared-skill");
				expect(res.manifest?.references).toContain("references/guide.md");
			}
		});
	});
});
