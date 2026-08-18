import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
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

describe("Skill Registry & Progressive Discovery (registry.test.ts)", () => {
	let tmpDir: string;
	let projectRoot: string;
	let globalRoot: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-registry-test-"));
		projectRoot = path.join(tmpDir, "project");
		globalRoot = path.join(tmpDir, "global");

		await fs.mkdir(projectRoot, { recursive: true });
		await fs.mkdir(globalRoot, { recursive: true });
	});

	afterEach(async () => {
		try {
			await fs.rm(tmpDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	});

	// Helper to create a skill folder with SKILL.md
	async function createSkillFixture(options: {
		baseDir: string;
		skillName: string;
		description: string;
		version?: string;
		tags?: string[];
		triggers?: string[];
		body?: string;
		scripts?: Record<string, string>;
		references?: Record<string, string>;
		assets?: Record<string, string>;
	}): Promise<string> {
		const skillDir = path.join(options.baseDir, options.skillName);
		await fs.mkdir(skillDir, { recursive: true });

		let frontmatterYaml = `name: "${options.skillName}"\ndescription: "${options.description}"\n`;
		if (options.version) frontmatterYaml += `version: "${options.version}"\n`;
		if (options.tags) frontmatterYaml += `tags: ${JSON.stringify(options.tags)}\n`;
		if (options.triggers) frontmatterYaml += `triggers: ${JSON.stringify(options.triggers)}\n`;

		const content = `---\n${frontmatterYaml}---\n\n${options.body || `# ${options.skillName}\nDefault instructions.`}\n`;
		await fs.writeFile(path.join(skillDir, "SKILL.md"), content, "utf-8");

		if (options.scripts) {
			const scriptsDir = path.join(skillDir, "scripts");
			await fs.mkdir(scriptsDir, { recursive: true });
			for (const [name, scriptContent] of Object.entries(options.scripts)) {
				const scriptPath = path.join(scriptsDir, name);
				await fs.mkdir(path.dirname(scriptPath), { recursive: true });
				await fs.writeFile(scriptPath, scriptContent, "utf-8");
			}
		}

		if (options.references) {
			const refsDir = path.join(skillDir, "references");
			await fs.mkdir(refsDir, { recursive: true });
			for (const [name, refContent] of Object.entries(options.references)) {
				const refPath = path.join(refsDir, name);
				await fs.mkdir(path.dirname(refPath), { recursive: true });
				await fs.writeFile(refPath, refContent, "utf-8");
			}
		}

		if (options.assets) {
			const assetsDir = path.join(skillDir, "assets");
			await fs.mkdir(assetsDir, { recursive: true });
			for (const [name, assetContent] of Object.entries(options.assets)) {
				const assetPath = path.join(assetsDir, name);
				await fs.mkdir(path.dirname(assetPath), { recursive: true });
				await fs.writeFile(assetPath, assetContent, "utf-8");
			}
		}

		return skillDir;
	}

	// =========================================================================
	// Suite 1: Multi-Scope Discovery & Metadata Indexing
	// =========================================================================
	describe("Multi-Scope Discovery & Indexing", () => {
		it("Tier 1: discovers skills across global, project (.harness/skills), and project (./skills) directories", async () => {
			const globalSkillsDir = path.join(globalRoot, "skills");
			const projectHarnessSkillsDir = path.join(projectRoot, ".harness", "skills");
			const projectRootSkillsDir = path.join(projectRoot, "skills");

			await createSkillFixture({
				baseDir: globalSkillsDir,
				skillName: "global-tool",
				description: "Global utility skill",
			});

			await createSkillFixture({
				baseDir: projectHarnessSkillsDir,
				skillName: "harness-tool",
				description: "Project harness skill",
			});

			await createSkillFixture({
				baseDir: projectRootSkillsDir,
				skillName: "root-tool",
				description: "Project root skill",
			});

			const registry = new SkillRegistry({ projectRoot, globalRoot });
			const discovered = await registry.discover();

			expect(discovered.length).toBe(3);

			const index = registry.getSkillIndex();
			expect(index.length).toBe(3);

			const globalEntry = index.find((s) => s.name === "global-tool");
			const harnessEntry = index.find((s) => s.name === "harness-tool");
			const rootEntry = index.find((s) => s.name === "root-tool");

			expect(globalEntry).toBeDefined();
			expect(globalEntry?.description).toBe("Global utility skill");
			expect(globalEntry?.scope).toBe("global");

			expect(harnessEntry).toBeDefined();
			expect(harnessEntry?.description).toBe("Project harness skill");
			expect(harnessEntry?.scope).toBe("project");

			expect(rootEntry).toBeDefined();
			expect(rootEntry?.description).toBe("Project root skill");
			expect(rootEntry?.scope).toBe("project");
		});

		it("Tier 1: indexes lightweight metadata without eagerly loading full instruction bodies into memory index", async () => {
			const largeBody = "# Huge Instruction Body\n".repeat(500);
			await createSkillFixture({
				baseDir: path.join(projectRoot, ".harness", "skills"),
				skillName: "heavy-skill",
				description: "Heavy instructions skill",
				triggers: ["/heavy"],
				body: largeBody,
			});

			const registry = new SkillRegistry({ projectRoot, globalRoot });
			const index = await registry.discover();

			expect(index).toHaveLength(1);
			const entry = index[0];

			expect(entry.name).toBe("heavy-skill");
			expect(entry.description).toBe("Heavy instructions skill");
			expect(entry.scope).toBe("project");
			expect(entry.triggers).toEqual(["/heavy"]);

			// SkillIndexEntry interface must only contain lightweight properties
			expect((entry as unknown as Record<string, unknown>).instructions).toBeUndefined();
			expect((entry as unknown as Record<string, unknown>).rawContent).toBeUndefined();
		});

		it("Tier 1: formats discovery prompt for prompt tier injection", async () => {
			await createSkillFixture({
				baseDir: path.join(projectRoot, ".harness", "skills"),
				skillName: "test-runner",
				description: "Runs test suites with coverage",
			});
			await createSkillFixture({
				baseDir: path.join(globalRoot, "skills"),
				skillName: "code-review",
				description: "Performs multi-axis code review",
			});

			const registry = new SkillRegistry({ projectRoot, globalRoot });
			await registry.discover();

			const prompt = registry.formatDiscoveryPrompt();

			expect(prompt).toContain("test-runner");
			expect(prompt).toContain("Runs test suites with coverage");
			expect(prompt).toContain("code-review");
			expect(prompt).toContain("Performs multi-axis code review");
		});

		it("Tier 2: handles empty global and project skill directories cleanly", async () => {
			const registry = new SkillRegistry({ projectRoot, globalRoot });
			const discovered = await registry.discover();

			expect(discovered).toEqual([]);
			expect(registry.getSkillIndex()).toEqual([]);

			const prompt = registry.formatDiscoveryPrompt();
			expect(typeof prompt).toBe("string");
		});

		it("Tier 2: ignores non-directory files and malformed skill folders without crashing discovery", async () => {
			const projectSkillsDir = path.join(projectRoot, ".harness", "skills");
			await fs.mkdir(projectSkillsDir, { recursive: true });

			// Add a regular text file
			await fs.writeFile(path.join(projectSkillsDir, "random.txt"), "hello", "utf-8");

			// Add an invalid skill folder (broken YAML)
			const badDir = path.join(projectSkillsDir, "broken-skill");
			await fs.mkdir(badDir, { recursive: true });
			await fs.writeFile(path.join(badDir, "SKILL.md"), "not-yaml-content", "utf-8");

			// Add a valid skill folder
			await createSkillFixture({
				baseDir: projectSkillsDir,
				skillName: "valid-skill",
				description: "Valid skill in mixed folder",
			});

			const registry = new SkillRegistry({ projectRoot, globalRoot });
			const discovered = await registry.discover();

			// Only valid skill should be indexed
			expect(discovered.length).toBe(1);
			expect(discovered[0].name).toBe("valid-skill");
		});

		it("Tier 2: preserves custom triggers array in discovered skill index entries", async () => {
			await createSkillFixture({
				baseDir: path.join(projectRoot, ".harness", "skills"),
				skillName: "linter",
				description: "Runs biome lint checks",
				triggers: ["/lint", "check-syntax", "lint code"],
			});

			const registry = new SkillRegistry({ projectRoot, globalRoot });
			await registry.discover();

			const entry = registry.getSkillIndex().find((s) => s.name === "linter");
			expect(entry).toBeDefined();
			expect(entry?.triggers).toEqual(["/lint", "check-syntax", "lint code"]);
		});
	});

	// =========================================================================
	// Suite 2: Scope Precedence & Shadowing
	// =========================================================================
	describe("Scope Precedence & Shadowing", () => {
		it("Tier 3: project skill (.harness/skills) shadows global skill (~/.harness/skills) with same name", async () => {
			await createSkillFixture({
				baseDir: path.join(globalRoot, "skills"),
				skillName: "deploy-skill",
				description: "Global cloud deployer",
			});

			await createSkillFixture({
				baseDir: path.join(projectRoot, ".harness", "skills"),
				skillName: "deploy-skill",
				description: "Project-customized deployer",
			});

			const registry = new SkillRegistry({ projectRoot, globalRoot });
			await registry.discover();

			const index = registry.getSkillIndex();
			// Should have 1 entry (shadowed), not 2
			expect(index.length).toBe(1);

			const entry = index[0];
			expect(entry.name).toBe("deploy-skill");
			expect(entry.description).toBe("Project-customized deployer");
			expect(entry.scope).toBe("project");
		});

		it("Tier 3: project skill (.harness/skills) shadows project root skill (./skills) with same name", async () => {
			await createSkillFixture({
				baseDir: path.join(projectRoot, "skills"),
				skillName: "builder",
				description: "Root skills builder",
			});

			await createSkillFixture({
				baseDir: path.join(projectRoot, ".harness", "skills"),
				skillName: "builder",
				description: "Harness preferred builder",
			});

			const registry = new SkillRegistry({ projectRoot, globalRoot });
			await registry.discover();

			const index = registry.getSkillIndex();
			expect(index.length).toBe(1);

			const entry = index[0];
			expect(entry.description).toBe("Harness preferred builder");
			expect(entry.scope).toBe("project");
		});

		it("Tier 3: project root skill (./skills) shadows global skill with same name", async () => {
			await createSkillFixture({
				baseDir: path.join(globalRoot, "skills"),
				skillName: "tester",
				description: "Global tester",
			});

			await createSkillFixture({
				baseDir: path.join(projectRoot, "skills"),
				skillName: "tester",
				description: "Root project tester",
			});

			const registry = new SkillRegistry({ projectRoot, globalRoot });
			await registry.discover();

			const index = registry.getSkillIndex();
			expect(index.length).toBe(1);

			const entry = index[0];
			expect(entry.description).toBe("Root project tester");
			expect(entry.scope).toBe("project");
		});

		it("Tier 3: enforces full 3-level deterministic precedence (.harness/skills > ./skills > global)", async () => {
			await createSkillFixture({
				baseDir: path.join(globalRoot, "skills"),
				skillName: "multi-tier",
				description: "Level 1 Global",
			});

			await createSkillFixture({
				baseDir: path.join(projectRoot, "skills"),
				skillName: "multi-tier",
				description: "Level 2 Project Root",
			});

			await createSkillFixture({
				baseDir: path.join(projectRoot, ".harness", "skills"),
				skillName: "multi-tier",
				description: "Level 3 Project Harness",
			});

			const registry = new SkillRegistry({ projectRoot, globalRoot });
			await registry.discover();

			const entry = registry.getSkillIndex().find((s) => s.name === "multi-tier");
			expect(entry).toBeDefined();
			expect(entry?.description).toBe("Level 3 Project Harness");
		});

		it("Tier 3: customDirs option takes highest priority and shadows standard project and global directories", async () => {
			const customDir = path.join(tmpDir, "custom-skills");
			await createSkillFixture({
				baseDir: customDir,
				skillName: "custom-override",
				description: "Custom directory high-priority skill",
			});
			await createSkillFixture({
				baseDir: path.join(projectRoot, ".harness", "skills"),
				skillName: "custom-override",
				description: "Standard project skill should be shadowed",
			});

			const registry = new SkillRegistry({
				projectRoot,
				globalRoot,
				customDirs: [customDir],
			});
			const discovered = await registry.discover();

			expect(discovered).toHaveLength(1);
			expect(discovered[0].description).toBe("Custom directory high-priority skill");
		});
	});

	// =========================================================================
	// Suite 3: On-Demand Loading & Activation Lifecycle
	// =========================================================================
	describe("Activation Lifecycle & On-Demand Loading", () => {
		it("Tier 1: getSkill() loads full SkillManifest on demand", async () => {
			await createSkillFixture({
				baseDir: path.join(projectRoot, ".harness", "skills"),
				skillName: "lazy-loaded-skill",
				description: "Skill to test lazy loading",
				version: "1.0.0",
				tags: ["lazy", "test"],
				body: "# Full Documentation\nDetailed steps.",
				scripts: { "run.sh": 'echo "hello"' },
				references: { "guide.md": "# Guide" },
				assets: { "config.json": "{}" },
			});

			const registry = new SkillRegistry({ projectRoot, globalRoot });
			await registry.discover();

			const manifest = await registry.getSkill("lazy-loaded-skill");
			expect(manifest).toBeDefined();
			expect(manifest?.frontmatter.name).toBe("lazy-loaded-skill");
			expect(manifest?.frontmatter.version).toBe("1.0.0");
			expect(manifest?.instructions).toContain("# Full Documentation");
			expect(manifest?.hasScripts).toBe(true);
			expect(manifest?.hasReferences).toBe(true);
			expect(manifest?.hasAssets).toBe(true);
		});

		it("Tier 1: getSkill() returns undefined for non-existent skill", async () => {
			const registry = new SkillRegistry({ projectRoot, globalRoot });
			await registry.discover();

			const manifest = await registry.getSkill("unknown-skill-xyz");
			expect(manifest).toBeUndefined();
		});

		it("Tier 1: activate() transitions skill into active state and returns manifest", async () => {
			await createSkillFixture({
				baseDir: path.join(projectRoot, ".harness", "skills"),
				skillName: "active-test-skill",
				description: "Test activation",
				body: "# Active Instructions",
			});

			const registry = new SkillRegistry({ projectRoot, globalRoot });
			await registry.discover();

			expect(registry.getActiveSkills()).toHaveLength(0);

			const manifest = await registry.activate("active-test-skill");
			expect(manifest).toBeDefined();
			expect(manifest.frontmatter.name).toBe("active-test-skill");

			const active = registry.getActiveSkills();
			expect(active).toHaveLength(1);
			expect(active[0].frontmatter.name).toBe("active-test-skill");
			expect(active[0].instructions).toContain("# Active Instructions");
		});

		it("Tier 1: deactivate() removes skill from active set and returns true", async () => {
			await createSkillFixture({
				baseDir: path.join(projectRoot, ".harness", "skills"),
				skillName: "deact-skill",
				description: "Test deactivation",
			});

			const registry = new SkillRegistry({ projectRoot, globalRoot });
			await registry.discover();

			await registry.activate("deact-skill");
			expect(registry.getActiveSkills()).toHaveLength(1);

			const result = registry.deactivate("deact-skill");
			expect(result).toBe(true);
			expect(registry.getActiveSkills()).toHaveLength(0);
		});

		it("Tier 2: activate() rejects when skill name is not found", async () => {
			const registry = new SkillRegistry({ projectRoot, globalRoot });
			await registry.discover();

			expect(registry.activate("non-existent-skill")).rejects.toThrow();
		});

		it("Tier 2: deactivate() returns false when target skill is not active", async () => {
			await createSkillFixture({
				baseDir: path.join(projectRoot, ".harness", "skills"),
				skillName: "inactive-skill",
				description: "Not active",
			});

			const registry = new SkillRegistry({ projectRoot, globalRoot });
			await registry.discover();

			const res1 = registry.deactivate("inactive-skill");
			expect(res1).toBe(false);

			const res2 = registry.deactivate("completely-random-skill");
			expect(res2).toBe(false);
		});

		it("Tier 2: activating an already active skill is idempotent", async () => {
			await createSkillFixture({
				baseDir: path.join(projectRoot, ".harness", "skills"),
				skillName: "idempotent-skill",
				description: "Test idempotency",
			});

			const registry = new SkillRegistry({ projectRoot, globalRoot });
			await registry.discover();

			const m1 = await registry.activate("idempotent-skill");
			const m2 = await registry.activate("idempotent-skill");

			expect(m1).toBe(m2);
			expect(registry.getActiveSkills()).toHaveLength(1);
		});

		it("Tier 2: supports multiple concurrently active skills and individual deactivation", async () => {
			await createSkillFixture({
				baseDir: path.join(projectRoot, ".harness", "skills"),
				skillName: "skill-alpha",
				description: "Alpha",
			});
			await createSkillFixture({
				baseDir: path.join(projectRoot, ".harness", "skills"),
				skillName: "skill-beta",
				description: "Beta",
			});
			await createSkillFixture({
				baseDir: path.join(projectRoot, ".harness", "skills"),
				skillName: "skill-gamma",
				description: "Gamma",
			});

			const registry = new SkillRegistry({ projectRoot, globalRoot });
			await registry.discover();

			await registry.activate("skill-alpha");
			await registry.activate("skill-beta");
			await registry.activate("skill-gamma");

			expect(registry.getActiveSkills()).toHaveLength(3);

			registry.deactivate("skill-beta");
			const activeNames = registry.getActiveSkills().map((s) => s.frontmatter.name);
			expect(activeNames).toEqual(["skill-alpha", "skill-gamma"]);
		});
	});

	// =========================================================================
	// Suite 4: Asset Path Resolution & Security Sandboxing
	// =========================================================================
	describe("Asset Path Resolution & Sandboxing", () => {
		it("Tier 1: resolves valid relative asset and script paths to absolute filesystem locations", async () => {
			const skillDir = await createSkillFixture({
				baseDir: path.join(projectRoot, ".harness", "skills"),
				skillName: "asset-skill",
				description: "Skill with assets",
				scripts: { "deploy.sh": "#!/bin/sh" },
				references: { "api.md": "# API" },
			});

			const registry = new SkillRegistry({ projectRoot, globalRoot });
			await registry.discover();

			const scriptPath = await registry.resolveAssetPath("asset-skill", "scripts/deploy.sh");
			expect(path.normalize(scriptPath)).toBe(
				path.normalize(path.join(skillDir, "scripts", "deploy.sh")),
			);

			const refPath = await registry.resolveAssetPath("asset-skill", "references/api.md");
			expect(path.normalize(refPath)).toBe(
				path.normalize(path.join(skillDir, "references", "api.md")),
			);
		});

		it("Tier 2: blocks directory traversal attacks (../../) attempting to escape skill root", async () => {
			await createSkillFixture({
				baseDir: path.join(projectRoot, ".harness", "skills"),
				skillName: "traversal-target",
				description: "Target for traversal test",
				scripts: { "safe.sh": "echo safe" },
			});

			const registry = new SkillRegistry({ projectRoot, globalRoot });
			await registry.discover();

			// Unix style traversal
			expect(registry.resolveAssetPath("traversal-target", "../../etc/passwd")).rejects.toThrow();

			// Windows style traversal
			expect(
				registry.resolveAssetPath("traversal-target", "..\\..\\Windows\\System32\\cmd.exe"),
			).rejects.toThrow();
		});

		it("Tier 2: throws error when resolving asset for unknown skill name", async () => {
			const registry = new SkillRegistry({ projectRoot, globalRoot });
			await registry.discover();

			expect(registry.resolveAssetPath("non-existent-skill", "scripts/run.sh")).rejects.toThrow();
		});

		it("Tier 3: dynamically reflects newly created skills upon re-discovery", async () => {
			await createSkillFixture({
				baseDir: path.join(projectRoot, ".harness", "skills"),
				skillName: "initial-skill",
				description: "First skill",
			});

			const registry = new SkillRegistry({ projectRoot, globalRoot });
			await registry.discover();
			expect(registry.getSkillIndex()).toHaveLength(1);

			// Add a second skill dynamically
			await createSkillFixture({
				baseDir: path.join(projectRoot, ".harness", "skills"),
				skillName: "dynamic-skill",
				description: "Dynamically added skill",
			});

			// Re-discover
			const reDiscovered = await registry.discover();
			expect(reDiscovered).toHaveLength(2);
			expect(registry.getSkillIndex()).toHaveLength(2);

			const active = await registry.activate("dynamic-skill");
			expect(active.frontmatter.name).toBe("dynamic-skill");
		});
	});

	// =========================================================================
	// Suite 5: Direct Loader & Asset Reader Tests (loader.ts)
	// =========================================================================
	describe("Skill Loader Module (loader.ts)", () => {
		it("loads manifest asynchronously and synchronously with full parity", async () => {
			const skillDir = await createSkillFixture({
				baseDir: path.join(projectRoot, "skills"),
				skillName: "parity-skill",
				description: "Parity loader test",
				scripts: { "test.py": "print('hello')" },
				references: { "notes.md": "# Notes" },
			});

			const asyncManifest = await loadSkillManifest(skillDir, "project");
			const syncManifest = loadSkillManifestSync(skillDir, "project");

			expect(asyncManifest.frontmatter.name).toBe("parity-skill");
			expect(syncManifest.frontmatter.name).toBe("parity-skill");
			expect(asyncManifest.hasScripts).toBe(true);
			expect(syncManifest.hasScripts).toBe(true);
		});

		it("reads asset content safely using readSkillAsset and readSkillAssetSync", async () => {
			const skillDir = await createSkillFixture({
				baseDir: path.join(projectRoot, "skills"),
				skillName: "reader-skill",
				description: "Asset reader test",
				references: { "nested/deep/doc.txt": "Deep Content Here" },
			});

			const contentAsync = await readSkillAsset(skillDir, "references/nested/deep/doc.txt");
			expect(contentAsync).toBe("Deep Content Here");

			const contentSync = readSkillAssetSync(skillDir, "references/nested/deep/doc.txt");
			expect(contentSync).toBe("Deep Content Here");
		});

		it("resolveSkillAsset rejects dangerous absolute and out-of-bounds paths", async () => {
			const skillDir = await createSkillFixture({
				baseDir: path.join(projectRoot, "skills"),
				skillName: "sandbox-strict",
				description: "Sandbox strict test",
			});

			expect(() => resolveSkillAsset(skillDir, "../sibling/file.txt")).toThrow();
			expect(() => resolveSkillAsset(skillDir, "references/../../outside.txt")).toThrow();
			expect(() => resolveSkillAsset(skillDir, "/etc/shadow")).toThrow();
			expect(() => resolveSkillAsset(skillDir, "C:\\boot.ini")).toThrow();
		});

		it("loadSkillManifest throws on non-existent directory", async () => {
			const missingDir = path.join(tmpDir, "missing-dir-123");
			expect(loadSkillManifest(missingDir)).rejects.toThrow();
			expect(() => loadSkillManifestSync(missingDir)).toThrow();
		});
	});
});
