import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { SkillRegistry } from "../../src/skills/registry";
import { loadSkillManifest, resolveSkillAsset } from "../../src/skills/loader";

describe("Adversarial Skill Registry Stress & Scale Harness (registry.stress.test.ts)", () => {
	let tmpDir: string;
	let projectRoot: string;
	let globalRoot: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-reg-stress-"));
		projectRoot = path.join(tmpDir, "project");
		globalRoot = path.join(tmpDir, "global");

		await fs.mkdir(projectRoot, { recursive: true });
		await fs.mkdir(globalRoot, { recursive: true });
	});

	afterEach(async () => {
		try {
			await fs.rm(tmpDir, { recursive: true, force: true });
		} catch {
			// ignore cleanup errors
		}
	});

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
	// 1. Extreme Multi-Tier Shadowing & Precedence Cascade
	// =========================================================================
	describe("Extreme Multi-Tier Shadowing Cascade", () => {
		it("enforces full 5-tier precedence hierarchy when identical skill name exists in all 5 scopes", async () => {
			const customDir1 = path.join(tmpDir, "custom1");
			const customDir2 = path.join(tmpDir, "custom2");
			const projHarness = path.join(projectRoot, ".harness", "skills");
			const projRoot = path.join(projectRoot, "skills");
			const globHarness = path.join(globalRoot, ".harness", "skills");
			const globRoot = path.join(globalRoot, "skills");

			// Create skill "cascade-skill" in all locations
			await createSkillFixture({
				baseDir: globRoot,
				skillName: "cascade-skill",
				description: "Tier 5: Global Root",
				body: "Body Global Root",
			});
			await createSkillFixture({
				baseDir: globHarness,
				skillName: "cascade-skill",
				description: "Tier 4: Global Harness",
				body: "Body Global Harness",
			});
			await createSkillFixture({
				baseDir: projRoot,
				skillName: "cascade-skill",
				description: "Tier 3: Project Root",
				body: "Body Project Root",
			});
			await createSkillFixture({
				baseDir: projHarness,
				skillName: "cascade-skill",
				description: "Tier 2: Project Harness",
				body: "Body Project Harness",
			});
			await createSkillFixture({
				baseDir: customDir2,
				skillName: "cascade-skill",
				description: "Tier 1b: Custom Dir 2",
				body: "Body Custom 2",
			});
			await createSkillFixture({
				baseDir: customDir1,
				skillName: "cascade-skill",
				description: "Tier 1a: Custom Dir 1",
				body: "Body Custom 1",
			});

			// Case A: With customDir1 and customDir2 -> customDir1 wins (order in customDirs)
			const regA = new SkillRegistry({
				projectRoot,
				globalRoot,
				customDirs: [customDir1, customDir2],
			});
			const discA = await regA.discover();
			expect(discA).toHaveLength(1);
			expect(discA[0].description).toBe("Tier 1a: Custom Dir 1");
			expect(discA[0].scope).toBe("project");

			const manifestA = await regA.getSkill("cascade-skill");
			expect(manifestA?.instructions).toContain("Body Custom 1");

			// Case B: With only customDir2 -> customDir2 wins
			const regB = new SkillRegistry({
				projectRoot,
				globalRoot,
				customDirs: [customDir2],
			});
			const discB = await regB.discover();
			expect(discB).toHaveLength(1);
			expect(discB[0].description).toBe("Tier 1b: Custom Dir 2");

			// Case C: Without customDirs -> Project Harness wins
			const regC = new SkillRegistry({ projectRoot, globalRoot });
			const discC = await regC.discover();
			expect(discC).toHaveLength(1);
			expect(discC[0].description).toBe("Tier 2: Project Harness");
			const manifestC = await regC.getSkill("cascade-skill");
			expect(manifestC?.instructions).toContain("Body Project Harness");

			// Case D: Remove Project Harness -> Project Root wins
			await fs.rm(path.join(projHarness, "cascade-skill"), { recursive: true, force: true });
			const regD = new SkillRegistry({ projectRoot, globalRoot });
			const discD = await regD.discover();
			expect(discD).toHaveLength(1);
			expect(discD[0].description).toBe("Tier 3: Project Root");
			expect(discD[0].scope).toBe("project");

			// Case E: Remove Project Root -> Global Harness wins
			await fs.rm(path.join(projRoot, "cascade-skill"), { recursive: true, force: true });
			const regE = new SkillRegistry({ projectRoot, globalRoot });
			const discE = await regE.discover();
			expect(discE).toHaveLength(1);
			expect(discE[0].description).toBe("Tier 4: Global Harness");
			expect(discE[0].scope).toBe("global");

			// Case F: Remove Global Harness -> Global Root wins
			await fs.rm(path.join(globHarness, "cascade-skill"), { recursive: true, force: true });
			const regF = new SkillRegistry({ projectRoot, globalRoot });
			const discF = await regF.discover();
			expect(discF).toHaveLength(1);
			expect(discF[0].description).toBe("Tier 5: Global Root");
			expect(discF[0].scope).toBe("global");
		});

		it("handles multiple shadowed skills across distinct directories without cross-pollution", async () => {
			const projHarness = path.join(projectRoot, ".harness", "skills");
			const globSkills = path.join(globalRoot, "skills");

			// Skill 1 in both
			await createSkillFixture({
				baseDir: globSkills,
				skillName: "skill-one",
				description: "Global One",
			});
			await createSkillFixture({
				baseDir: projHarness,
				skillName: "skill-one",
				description: "Project One",
			});

			// Skill 2 only in global
			await createSkillFixture({
				baseDir: globSkills,
				skillName: "skill-two",
				description: "Global Two",
			});

			// Skill 3 only in project
			await createSkillFixture({
				baseDir: projHarness,
				skillName: "skill-three",
				description: "Project Three",
			});

			const reg = new SkillRegistry({ projectRoot, globalRoot });
			const index = await reg.discover();

			expect(index).toHaveLength(3);

			const one = index.find((s) => s.name === "skill-one");
			const two = index.find((s) => s.name === "skill-two");
			const three = index.find((s) => s.name === "skill-three");

			expect(one?.description).toBe("Project One");
			expect(one?.scope).toBe("project");

			expect(two?.description).toBe("Global Two");
			expect(two?.scope).toBe("global");

			expect(three?.description).toBe("Project Three");
			expect(three?.scope).toBe("project");
		});
	});

	// =========================================================================
	// 2. Scale & Token Efficiency Verification
	// =========================================================================
	describe("Scale & Token Efficiency Verification", () => {
		it("discovers and indexes 60 skills rapidly with lightweight token footprint", async () => {
			const projectSkills = path.join(projectRoot, ".harness", "skills");
			const count = 60;

			// Bulk create 60 skills with realistic metadata and 5KB body each
			const largeBody = "## Step Guidelines\nFollow these procedures carefully.\n".repeat(50);
			const creationPromises: Promise<string>[] = [];

			for (let i = 0; i < count; i++) {
				const name = `skill-${String(i).padStart(3, "0")}`;
				creationPromises.push(
					createSkillFixture({
						baseDir: projectSkills,
						skillName: name,
						description: `Autonomous assistant capability for workflow task #${i} processing`,
						version: `1.${i}.0`,
						triggers: [`/run-${i}`, `action-${i}`],
						body: `# ${name} Documentation\n\n${largeBody}`,
					}),
				);
			}
			await Promise.all(creationPromises);

			const registry = new SkillRegistry({ projectRoot, globalRoot });

			const startTime = Date.now();
			const index = await registry.discover();
			const durationMs = Date.now() - startTime;

			expect(index).toHaveLength(count);
			expect(durationMs).toBeLessThan(5000);

			// Verify Token Efficiency:
			// 1. Check that instruction bodies are NOT in index entries
			for (const entry of index) {
				expect((entry as any).instructions).toBeUndefined();
				expect((entry as any).rawContent).toBeUndefined();
			}

			// 2. Verify formatDiscoveryPrompt output
			const prompt = registry.formatDiscoveryPrompt();
			expect(prompt.startsWith("Available skills:")).toBe(true);

			const promptLines = prompt.split("\n").filter((l) => l.startsWith("- "));
			expect(promptLines).toHaveLength(count);

			let totalPromptChars = 0;
			for (const line of promptLines) {
				totalPromptChars += line.length;
			}
			const avgPromptTokens = totalPromptChars / count / 4;
			// Prompt line per skill is ~20-40 tokens
			expect(avgPromptTokens).toBeGreaterThan(15);
			expect(avgPromptTokens).toBeLessThan(45);
		});

		it("skill with massive 100KB body has prompt footprint of < 40 tokens and loads on demand", async () => {
			const projectSkills = path.join(projectRoot, ".harness", "skills");
			const hugeBody = "# Comprehensive Reference Manual\n" + "Lorem ipsum dolor sit amet. ".repeat(4000); // ~110KB

			await createSkillFixture({
				baseDir: projectSkills,
				skillName: "massive-manual",
				description: "Extensive reference documentation for database administration",
				triggers: ["/db-admin"],
				body: hugeBody,
			});

			const registry = new SkillRegistry({ projectRoot, globalRoot });
			const index = await registry.discover();

			expect(index).toHaveLength(1);
			const entry = index[0];

			// Check that full body is not retained in index
			expect((entry as any).instructions).toBeUndefined();
			expect((entry as any).rawContent).toBeUndefined();

			// Discovery prompt is lightweight (~20-40 tokens)
			const prompt = registry.formatDiscoveryPrompt();
			const promptTokens = prompt.length / 4;
			expect(promptTokens).toBeLessThan(40);

			// On-demand manifest loading retrieves the entire 100KB body
			const manifest = await registry.getSkill("massive-manual");
			expect(manifest).toBeDefined();
			expect(manifest?.instructions.length).toBeGreaterThan(100000);
		});
	});

	// =========================================================================
	// 3. Circular Paths, Symlinks, and Malformed Filesystem Artifacts
	// =========================================================================
	describe("Symlinks, Nested Directories & Malformed Artifacts", () => {
		it("ignores hidden folders (.git, .hidden) and non-directory files", async () => {
			const projectSkills = path.join(projectRoot, ".harness", "skills");
			await fs.mkdir(projectSkills, { recursive: true });

			// Hidden folder with SKILL.md
			const hiddenDir = path.join(projectSkills, ".git");
			await fs.mkdir(hiddenDir, { recursive: true });
			await fs.writeFile(path.join(hiddenDir, "SKILL.md"), "---\nname: hidden-git\ndescription: git\n---\n", "utf-8");

			// Non-directory file named like a skill
			await fs.writeFile(path.join(projectSkills, "plain-file.skill"), "some text", "utf-8");

			// Empty folder without SKILL.md
			await fs.mkdir(path.join(projectSkills, "empty-folder"), { recursive: true });

			// Valid skill
			await createSkillFixture({
				baseDir: projectSkills,
				skillName: "real-skill",
				description: "Real discoverable skill",
			});

			const registry = new SkillRegistry({ projectRoot, globalRoot });
			const index = await registry.discover();

			expect(index).toHaveLength(1);
			expect(index[0].name).toBe("real-skill");
		});

		it("handles SKILL.md being a subdirectory instead of a file gracefully", async () => {
			const projectSkills = path.join(projectRoot, ".harness", "skills");
			const badSkill = path.join(projectSkills, "folder-as-skillmd");
			await fs.mkdir(path.join(badSkill, "SKILL.md"), { recursive: true });

			await createSkillFixture({
				baseDir: projectSkills,
				skillName: "good-skill",
				description: "Good skill",
			});

			const registry = new SkillRegistry({ projectRoot, globalRoot });
			const index = await registry.discover();

			expect(index).toHaveLength(1);
			expect(index[0].name).toBe("good-skill");
		});

		it("handles empty (0-byte) SKILL.md and binary SKILL.md gracefully", async () => {
			const projectSkills = path.join(projectRoot, ".harness", "skills");

			// 0-byte file
			const emptyDir = path.join(projectSkills, "zero-byte-skill");
			await fs.mkdir(emptyDir, { recursive: true });
			await fs.writeFile(path.join(emptyDir, "SKILL.md"), "", "utf-8");

			// Binary / garbage bytes
			const binaryDir = path.join(projectSkills, "binary-skill");
			await fs.mkdir(binaryDir, { recursive: true });
			await fs.writeFile(path.join(binaryDir, "SKILL.md"), Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x12]), "utf-8");

			// Valid skill
			await createSkillFixture({
				baseDir: projectSkills,
				skillName: "survivor-skill",
				description: "Valid despite corrupt siblings",
			});

			const registry = new SkillRegistry({ projectRoot, globalRoot });
			const index = await registry.discover();

			expect(index).toHaveLength(1);
			expect(index[0].name).toBe("survivor-skill");
		});

		it("handles unicode and special characters in skill names and descriptions", async () => {
			const projectSkills = path.join(projectRoot, ".harness", "skills");

			await createSkillFixture({
				baseDir: projectSkills,
				skillName: "react-19-migrate",
				description: "React 19 升级指南 with 中文 and emoji 🚀⚡",
				triggers: ["/react-19", "升级"],
			});

			const registry = new SkillRegistry({ projectRoot, globalRoot });
			const index = await registry.discover();

			expect(index).toHaveLength(1);
			expect(index[0].description).toBe("React 19 升级指南 with 中文 and emoji 🚀⚡");
			expect(index[0].triggers).toEqual(["/react-19", "升级"]);

			const prompt = registry.formatDiscoveryPrompt();
			expect(prompt).toContain("React 19 升级指南 with 中文 and emoji 🚀⚡");
		});
	});

	// =========================================================================
	// 4. Rapid Concurrency & Lifecycle Cycling
	// =========================================================================
	describe("Rapid Concurrency & Lifecycle Cycling", () => {
		it("supports 100 rapid sequential activate and deactivate cycles cleanly", async () => {
			const projectSkills = path.join(projectRoot, ".harness", "skills");
			await createSkillFixture({
				baseDir: projectSkills,
				skillName: "cycle-target",
				description: "Cycling test",
			});

			const registry = new SkillRegistry({ projectRoot, globalRoot });
			await registry.discover();

			for (let i = 0; i < 100; i++) {
				const manifest = await registry.activate("cycle-target");
				expect(manifest.frontmatter.name).toBe("cycle-target");
				expect(registry.getActiveSkills()).toHaveLength(1);

				const deactResult = registry.deactivate("cycle-target");
				expect(deactResult).toBe(true);
				expect(registry.getActiveSkills()).toHaveLength(0);
			}
		});

		it("handles concurrent activation requests for the same skill safely", async () => {
			const projectSkills = path.join(projectRoot, ".harness", "skills");
			await createSkillFixture({
				baseDir: projectSkills,
				skillName: "concurrent-target",
				description: "Concurrency test",
			});

			const registry = new SkillRegistry({ projectRoot, globalRoot });
			await registry.discover();

			// 20 concurrent activations of the same skill
			const results = await Promise.all(
				Array.from({ length: 20 }, () => registry.activate("concurrent-target")),
			);

			// All should resolve to identical manifest data
			expect(results).toHaveLength(20);
			const first = results[0];
			for (const r of results) {
				expect(r.frontmatter.name).toBe(first.frontmatter.name);
				expect(r.instructions).toBe(first.instructions);
			}

			expect(registry.getActiveSkills()).toHaveLength(1);
		});

		it("handles concurrent activation of 30 different skills simultaneously", async () => {
			const projectSkills = path.join(projectRoot, ".harness", "skills");
			const count = 30;

			for (let i = 0; i < count; i++) {
				await createSkillFixture({
					baseDir: projectSkills,
					skillName: `concurrent-skill-${i}`,
					description: `Concurrent skill ${i}`,
				});
			}

			const registry = new SkillRegistry({ projectRoot, globalRoot });
			await registry.discover();

			// Activate all 30 in parallel
			const activations = Array.from({ length: count }, (_, i) =>
				registry.activate(`concurrent-skill-${i}`),
			);
			const results = await Promise.all(activations);

			expect(results).toHaveLength(count);
			expect(registry.getActiveSkills()).toHaveLength(count);

			// Deactivate all 30
			for (let i = 0; i < count; i++) {
				const deact = registry.deactivate(`concurrent-skill-${i}`);
				expect(deact).toBe(true);
			}
			expect(registry.getActiveSkills()).toHaveLength(0);
		});

		it("interleaved concurrent activation and deactivation maintains consistent state", async () => {
			const projectSkills = path.join(projectRoot, ".harness", "skills");
			for (let i = 0; i < 10; i++) {
				await createSkillFixture({
					baseDir: projectSkills,
					skillName: `interleave-${i}`,
					description: `Interleaved skill ${i}`,
				});
			}

			const registry = new SkillRegistry({ projectRoot, globalRoot });
			await registry.discover();

			// Activate all
			await Promise.all(
				Array.from({ length: 10 }, (_, i) => registry.activate(`interleave-${i}`)),
			);
			expect(registry.getActiveSkills()).toHaveLength(10);

			// Deactivate odd ones
			for (let i = 1; i < 10; i += 2) {
				registry.deactivate(`interleave-${i}`);
			}
			expect(registry.getActiveSkills()).toHaveLength(5);

			// Re-activate odd ones
			await Promise.all(
				Array.from({ length: 5 }, (_, idx) => registry.activate(`interleave-${idx * 2 + 1}`)),
			);
			expect(registry.getActiveSkills()).toHaveLength(10);
		});
	});

	// =========================================================================
	// 5. Deep Asset Resolution & Path Traversal Adversarial Harness
	// =========================================================================
	describe("Deep Asset Resolution & Path Traversal", () => {
		it("resolves deeply nested references and scripts safely", async () => {
			const skillDir = await createSkillFixture({
				baseDir: path.join(projectRoot, ".harness", "skills"),
				skillName: "deep-assets",
				description: "Deep assets test",
				references: {
					"deeply/nested/dir/structure/guide.md": "# Deep Guide",
				},
				scripts: {
					"nested/helpers/test.sh": "echo nested",
				},
			});

			const registry = new SkillRegistry({ projectRoot, globalRoot });
			await registry.discover();

			const resolvedRef = await registry.resolveAssetPath(
				"deep-assets",
				"references/deeply/nested/dir/structure/guide.md",
			);
			expect(path.normalize(resolvedRef)).toBe(
				path.normalize(path.join(skillDir, "references/deeply/nested/dir/structure/guide.md")),
			);

			// Dot-slash normalization inside directory root should succeed
			const resolvedScript = await registry.resolveAssetPath(
				"deep-assets",
				"./scripts/nested/helpers/test.sh",
			);
			expect(path.normalize(resolvedScript)).toBe(
				path.normalize(path.join(skillDir, "scripts/nested/helpers/test.sh")),
			);
		});

		it("blocks all complex directory traversal payload attempts", async () => {
			await createSkillFixture({
				baseDir: path.join(projectRoot, ".harness", "skills"),
				skillName: "defense-skill",
				description: "Defense skill",
			});

			const registry = new SkillRegistry({ projectRoot, globalRoot });
			await registry.discover();

			const maliciousPayloads = [
				"../outside.txt",
				"../../outside.txt",
				"../../../etc/shadow",
				"references/../../../../../../etc/passwd",
				"..\\..\\..\\Windows\\win.ini",
				"C:\\Windows\\System32\\cmd.exe",
				"/bin/sh",
				"references/../../../projectRoot",
			];

			for (const payload of maliciousPayloads) {
				expect(
					registry.resolveAssetPath("defense-skill", payload),
				).rejects.toThrow();
			}
		});
	});

	// =========================================================================
	// 6. Multiple Registry Isolation & Independent State
	// =========================================================================
	describe("Multiple Registry Isolation", () => {
		it("independent SkillRegistry instances maintain isolated active states", async () => {
			const projectSkills = path.join(projectRoot, ".harness", "skills");
			await createSkillFixture({
				baseDir: projectSkills,
				skillName: "iso-skill",
				description: "Isolation test",
			});

			const reg1 = new SkillRegistry({ projectRoot, globalRoot });
			const reg2 = new SkillRegistry({ projectRoot, globalRoot });

			await reg1.discover();
			await reg2.discover();

			await reg1.activate("iso-skill");

			expect(reg1.getActiveSkills()).toHaveLength(1);
			expect(reg2.getActiveSkills()).toHaveLength(0);

			reg2.deactivate("iso-skill");
			expect(reg1.getActiveSkills()).toHaveLength(1);
		});
	});
});
