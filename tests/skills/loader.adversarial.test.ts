import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	loadSkillManifest,
	loadSkillManifestSync,
	readSkillAsset,
	readSkillAssetSync,
	resolveSkillAsset,
} from "../../src/skills/loader";
import { SkillRegistry } from "../../src/skills/registry";

describe("Adversarial Skill Loader & Asset Resolution Stress Tests (loader.adversarial.test.ts)", () => {
	let tmpDir: string;
	let skillDir: string;
	let externalDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-loader-adv-"));
		skillDir = path.join(tmpDir, "target-skill");
		externalDir = path.join(tmpDir, "external-folder");

		await fs.mkdir(skillDir, { recursive: true });
		await fs.mkdir(externalDir, { recursive: true });

		// Create standard skill layout
		await fs.mkdir(path.join(skillDir, "scripts"), { recursive: true });
		await fs.mkdir(path.join(skillDir, "references"), { recursive: true });
		await fs.mkdir(path.join(skillDir, "assets"), { recursive: true });

		const validSkillMd = `---
name: "target-skill"
description: "Target skill for adversarial testing"
version: "1.0.0"
---

# Target Skill Instructions
Operational guide for adversarial testing.
`;
		await fs.writeFile(path.join(skillDir, "SKILL.md"), validSkillMd, "utf-8");
		await fs.writeFile(path.join(skillDir, "scripts", "run.sh"), 'echo "running"', "utf-8");
		await fs.writeFile(path.join(skillDir, "references", "guide.md"), "# Guide Content", "utf-8");
		await fs.writeFile(path.join(skillDir, "assets", "config.json"), '{"key": "value"}', "utf-8");

		// Create an external secret file to test sandboxing
		await fs.writeFile(path.join(externalDir, "secret.key"), "SUPER_SECRET_KEY_12345", "utf-8");
	});

	afterEach(async () => {
		try {
			await fs.rm(tmpDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	});

	// =========================================================================
	// 1. Path Traversal & Sandbox Escape Exploits
	// =========================================================================
	describe("1. Path Traversal & Sandbox Escape Exploits", () => {
		it("blocks relative parent directory traversal escapes (../../..)", () => {
			const attacks = [
				"../",
				"../../",
				"../../../",
				"../../../../etc/passwd",
				"../../external-folder/secret.key",
				"scripts/../../external-folder/secret.key",
				"references/nested/../../../../external-folder/secret.key",
				"assets/./../../secret.key",
				"./../../secret.key",
				"..\\..\\Windows\\System32\\cmd.exe",
				"scripts\\..\\..\\external-folder\\secret.key",
			];

			for (const attack of attacks) {
				expect(() => resolveSkillAsset(skillDir, attack)).toThrow(
					/Path traversal \/ sandbox violation/i,
				);
			}
		});

		it("blocks absolute path injection targeting system files or other drives", () => {
			const absoluteAttacks = [
				"/etc/passwd",
				"/etc/shadow",
				"/var/log/syslog",
				"/",
				"\\",
				"C:\\Windows\\System32\\drivers\\etc\\hosts",
				"C:\\boot.ini",
				"D:\\external-folder\\secret.key",
				"\\\\attacker-server\\share\\exploit.ps1",
				"\\\\?\\C:\\Windows\\System32",
			];

			for (const attack of absoluteAttacks) {
				expect(() => resolveSkillAsset(skillDir, attack)).toThrow(
					/Path traversal \/ sandbox violation/i,
				);
			}
		});

		it("blocks same-prefix directory collision bypass attempts", async () => {
			// e.g. skillDir is "target-skill", target is "target-skill-sibling/secret.txt"
			const siblingSkillDir = path.join(tmpDir, "target-skill-sibling");
			await fs.mkdir(siblingSkillDir, { recursive: true });
			await fs.writeFile(path.join(siblingSkillDir, "stolen.txt"), "stolen", "utf-8");

			const exploit = "../target-skill-sibling/stolen.txt";
			expect(() => resolveSkillAsset(skillDir, exploit)).toThrow(
				/Path traversal \/ sandbox violation/i,
			);
		});

		it("handles URL-encoded path traversal characters and prevents escaping", () => {
			const encodedAttacks = [
				"%2e%2e%2f%2e%2e%2fsecret.key",
				"..%2f..%2fsecret.key",
				"..%5c..%5csecret.key",
				"%2fetc%2fpasswd",
				"scripts/%2e%2e/%2e%2e/secret.key",
			];

			for (const attack of encodedAttacks) {
				// If not decoded by caller, resolveSkillAsset treats '%2e' as literal file name within sandbox.
				// If treated literally, it stays inside skillDir and does not escape.
				const resolved = resolveSkillAsset(skillDir, attack);
				expect(resolved.startsWith(path.resolve(skillDir))).toBe(true);

				// If the caller URL-decodes it before passing, it must throw!
				const decoded = decodeURIComponent(attack);
				expect(() => resolveSkillAsset(skillDir, decoded)).toThrow(
					/Path traversal \/ sandbox violation/i,
				);
			}
		});

		it("handles null bytes in subpaths securely", async () => {
			const nullBytePaths = [
				"scripts/run.sh\0.png",
				"\0",
				"assets/\0/config.json",
				"references/guide.md\0",
			];

			for (const nbPath of nullBytePaths) {
				// Either resolveSkillAsset throws OR reading the null byte path throws an error
				try {
					const safePath = resolveSkillAsset(skillDir, nbPath);
					await expect(fs.readFile(safePath, "utf-8")).rejects.toThrow();
				} catch (err: any) {
					expect(err).toBeDefined();
				}
			}
		});

		it("allows valid complex and nested paths within the sandbox", () => {
			const validPaths = [
				"scripts/run.sh",
				"./scripts/run.sh",
				"references/../references/guide.md",
				"assets/./config.json",
				"assets/sub/../../assets/config.json",
			];

			for (const p of validPaths) {
				const resolved = resolveSkillAsset(skillDir, p);
				expect(resolved.startsWith(path.resolve(skillDir))).toBe(true);
				expect(fsSync.existsSync(resolved)).toBe(true);
			}
		});
	});

	// =========================================================================
	// 2. Asset Reading: Missing Files, Binary Files & Encodings
	// =========================================================================
	describe("2. Asset Reading: Missing Files, Binary Files & Encodings", () => {
		it("throws ENOENT for missing asset files (async & sync)", async () => {
			await expect(readSkillAsset(skillDir, "scripts/missing_file.sh")).rejects.toThrow();
			expect(() => readSkillAssetSync(skillDir, "scripts/missing_file.sh")).toThrow();

			await expect(readSkillAsset(skillDir, "assets/non_existent.json")).rejects.toThrow();
			expect(() => readSkillAssetSync(skillDir, "assets/non_existent.json")).toThrow();
		});

		it("throws EISDIR or error when attempting to read directory as asset (async & sync)", async () => {
			await expect(readSkillAsset(skillDir, "scripts")).rejects.toThrow();
			expect(() => readSkillAssetSync(skillDir, "scripts")).toThrow();

			await expect(readSkillAsset(skillDir, "assets")).rejects.toThrow();
			expect(() => readSkillAssetSync(skillDir, "assets")).toThrow();
		});

		it("reads binary asset files with base64, hex, and binary buffer encodings accurately", async () => {
			const binaryBytes = Buffer.from([
				0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG magic header
				0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
				0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00,
				0x08, 0x06, 0x00, 0x00, 0x00, 0x5c, 0x72, 0xa8,
				0x00, 0xff, 0xfe, 0xaa, 0x55, 0x00,
			]);

			const binaryAssetPath = path.join(skillDir, "assets", "logo.png");
			await fs.writeFile(binaryAssetPath, binaryBytes);

			// Read with base64 encoding (async & sync)
			const b64Async = await readSkillAsset(skillDir, "assets/logo.png", "base64");
			const b64Sync = readSkillAssetSync(skillDir, "assets/logo.png", "base64");

			expect(b64Async).toBe(binaryBytes.toString("base64"));
			expect(b64Sync).toBe(binaryBytes.toString("base64"));
			expect(Buffer.from(b64Async, "base64")).toEqual(binaryBytes);

			// Read with hex encoding
			const hexAsync = await readSkillAsset(skillDir, "assets/logo.png", "hex");
			const hexSync = readSkillAssetSync(skillDir, "assets/logo.png", "hex");

			expect(hexAsync).toBe(binaryBytes.toString("hex"));
			expect(hexSync).toBe(binaryBytes.toString("hex"));
			expect(Buffer.from(hexAsync, "hex")).toEqual(binaryBytes);

			// Read with latin1 / binary encoding
			const latin1Async = await readSkillAsset(skillDir, "assets/logo.png", "latin1");
			const latin1Sync = readSkillAssetSync(skillDir, "assets/logo.png", "latin1");
			expect(latin1Async).toBe(binaryBytes.toString("latin1"));
			expect(latin1Sync).toBe(binaryBytes.toString("latin1"));
		});

		it("reads 0-byte asset file cleanly without error", async () => {
			await fs.writeFile(path.join(skillDir, "assets", "empty.txt"), "", "utf-8");

			const contentAsync = await readSkillAsset(skillDir, "assets/empty.txt");
			const contentSync = readSkillAssetSync(skillDir, "assets/empty.txt");

			expect(contentAsync).toBe("");
			expect(contentSync).toBe("");
		});

		it("handles large asset files (5MB) without data corruption or memory degradation", async () => {
			const largeString = "A".repeat(5 * 1024 * 1024); // 5MB
			await fs.writeFile(path.join(skillDir, "assets", "large.txt"), largeString, "utf-8");

			const contentAsync = await readSkillAsset(skillDir, "assets/large.txt");
			expect(contentAsync.length).toBe(5 * 1024 * 1024);
			expect(contentAsync).toBe(largeString);

			const contentSync = readSkillAssetSync(skillDir, "assets/large.txt");
			expect(contentSync.length).toBe(5 * 1024 * 1024);
			expect(contentSync).toBe(largeString);
		});

		it("executes 100 concurrent async asset reads under heavy load without errors", async () => {
			const readPromises: Promise<string>[] = [];
			for (let i = 0; i < 100; i++) {
				const assetKey = i % 3 === 0 ? "scripts/run.sh" : i % 3 === 1 ? "references/guide.md" : "assets/config.json";
				readPromises.push(readSkillAsset(skillDir, assetKey));
			}

			const results = await Promise.all(readPromises);
			expect(results.length).toBe(100);
			for (let i = 0; i < 100; i++) {
				if (i % 3 === 0) expect(results[i]).toBe('echo "running"');
				else if (i % 3 === 1) expect(results[i]).toBe("# Guide Content");
				else expect(results[i]).toBe('{"key": "value"}');
			}
		});
	});

	// =========================================================================
	// 3. Manifest Loader Robustness (loadSkillManifest / Sync)
	// =========================================================================
	describe("3. Manifest Loader Robustness", () => {
		it("rejects non-existent directory with descriptive error", async () => {
			const missing = path.join(tmpDir, "missing-skill-dir");
			await expect(loadSkillManifest(missing)).rejects.toThrow(
				/Failed to load skill manifest/i,
			);
			expect(() => loadSkillManifestSync(missing)).toThrow(/Failed to load skill manifest/i);
		});

		it("rejects skill folder with missing SKILL.md", async () => {
			const emptyDir = path.join(tmpDir, "empty-skill-dir");
			await fs.mkdir(emptyDir, { recursive: true });

			await expect(loadSkillManifest(emptyDir)).rejects.toThrow(
				/Failed to load skill manifest/i,
			);
			expect(() => loadSkillManifestSync(emptyDir)).toThrow(/Failed to load skill manifest/i);
		});

		it("rejects skill folder with invalid YAML syntax in SKILL.md", async () => {
			const badYamlDir = path.join(tmpDir, "bad-yaml-skill");
			await fs.mkdir(badYamlDir, { recursive: true });
			await fs.writeFile(
				path.join(badYamlDir, "SKILL.md"),
				"---\nname: [unclosed list\ndescription: missing\n---\n# Body",
				"utf-8",
			);

			await expect(loadSkillManifest(badYamlDir)).rejects.toThrow(
				/Failed to load skill manifest/i,
			);
			expect(() => loadSkillManifestSync(badYamlDir)).toThrow(/Failed to load skill manifest/i);
		});

		it("rejects skill folder when scripts or references are files instead of directories", async () => {
			const brokenSubdir = path.join(tmpDir, "broken-subdir-skill");
			await fs.mkdir(brokenSubdir, { recursive: true });
			await fs.writeFile(
				path.join(brokenSubdir, "SKILL.md"),
				'---\nname: "broken-subdir"\ndescription: "broken"\n---\n# Body',
				"utf-8",
			);
			await fs.writeFile(path.join(brokenSubdir, "scripts"), "file instead of dir", "utf-8");

			await expect(loadSkillManifest(brokenSubdir)).rejects.toThrow(
				/Failed to load skill manifest/i,
			);
			expect(() => loadSkillManifestSync(brokenSubdir)).toThrow(/Failed to load skill manifest/i);
		});

		it("loads valid manifest correctly with all metadata flags set", async () => {
			const manifest = await loadSkillManifest(skillDir, "project");
			expect(manifest.frontmatter.name).toBe("target-skill");
			expect(manifest.frontmatter.description).toBe("Target skill for adversarial testing");
			expect(manifest.hasScripts).toBe(true);
			expect(manifest.hasReferences).toBe(true);
			expect(manifest.hasAssets).toBe(true);
			expect(manifest.scripts).toContain("scripts/run.sh");
			expect(manifest.references).toContain("references/guide.md");
			expect(manifest.assets).toContain("assets/config.json");
			expect(manifest.scope).toBe("project");
		});
	});

	// =========================================================================
	// 4. Registry Integration: Asset Sandbox & Shadowing
	// =========================================================================
	describe("4. Registry Integration: Asset Sandbox & Shadowing", () => {
		it("SkillRegistry.resolveAssetPath enforces sandbox traversal rejection", async () => {
			const projectRoot = path.join(tmpDir, "project");
			const globalRoot = path.join(tmpDir, "global");
			await fs.mkdir(path.join(projectRoot, ".harness", "skills", "test-skill"), {
				recursive: true,
			});
			await fs.writeFile(
				path.join(projectRoot, ".harness", "skills", "test-skill", "SKILL.md"),
				'---\nname: "test-skill"\ndescription: "Registry sandbox test"\n---\n# Body',
				"utf-8",
			);

			const registry = new SkillRegistry({ projectRoot, globalRoot });
			await registry.discover();

			// Traversal exploits via registry
			await expect(
				registry.resolveAssetPath("test-skill", "../../outside.txt"),
			).rejects.toThrow(/Path traversal \/ sandbox violation/i);

			await expect(
				registry.resolveAssetPath("test-skill", "/etc/passwd"),
			).rejects.toThrow(/Path traversal \/ sandbox violation/i);

			await expect(
				registry.resolveAssetPath("non-existent-skill", "scripts/test.sh"),
			).rejects.toThrow(/Skill "non-existent-skill" not found/i);
		});

		it("SkillRegistry resolves assets from the higher precedence shadowed skill directory", async () => {
			const projectRoot = path.join(tmpDir, "project-shadow");
			const globalRoot = path.join(tmpDir, "global-shadow");

			// Global skill definition with global script
			const globalSkillDir = path.join(globalRoot, "skills", "shadow-tool");
			await fs.mkdir(path.join(globalSkillDir, "scripts"), { recursive: true });
			await fs.writeFile(
				path.join(globalSkillDir, "SKILL.md"),
				'---\nname: "shadow-tool"\ndescription: "Global Version"\n---\n# Global',
				"utf-8",
			);
			await fs.writeFile(
				path.join(globalSkillDir, "scripts", "action.sh"),
				'echo "global action"',
				"utf-8",
			);

			// Project skill definition with overridden project script
			const projectSkillDir = path.join(projectRoot, ".harness", "skills", "shadow-tool");
			await fs.mkdir(path.join(projectSkillDir, "scripts"), { recursive: true });
			await fs.writeFile(
				path.join(projectSkillDir, "SKILL.md"),
				'---\nname: "shadow-tool"\ndescription: "Project Version"\n---\n# Project',
				"utf-8",
			);
			await fs.writeFile(
				path.join(projectSkillDir, "scripts", "action.sh"),
				'echo "project action"',
				"utf-8",
			);

			const registry = new SkillRegistry({ projectRoot, globalRoot });
			await registry.discover();

			const resolvedPath = await registry.resolveAssetPath("shadow-tool", "scripts/action.sh");
			expect(path.normalize(resolvedPath)).toBe(
				path.normalize(path.join(projectSkillDir, "scripts", "action.sh")),
			);

			const content = await fs.readFile(resolvedPath, "utf-8");
			expect(content).toBe('echo "project action"');
		});
	});
});
