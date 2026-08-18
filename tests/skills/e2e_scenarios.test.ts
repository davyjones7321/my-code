import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { Message } from "../../src/agent/types";
import { assembleContext, buildProjectTier } from "../../src/context/tiers";
import { type DistillOptions, SkillDistiller } from "../../src/skills/distiller";
import { validateSkillDirectory } from "../../src/skills/parser";
import { SkillRegistry } from "../../src/skills/registry";
import { registerSkillTools } from "../../src/skills/tools";
import type { SkillManifest } from "../../src/skills/types";
import { ToolRegistry } from "../../src/tools/registry";

describe("Phase 7: Tier 4 Real-World Application Scenarios (tests/skills/e2e_scenarios.test.ts)", () => {
	let tmpDir: string;
	let projectRoot: string;
	let globalRoot: string;
	let projectSkillsDir: string;
	let globalSkillsDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-e2e-scenario-test-"));
		projectRoot = path.join(tmpDir, "project");
		globalRoot = path.join(tmpDir, "global");
		projectSkillsDir = path.join(projectRoot, ".harness", "skills");
		globalSkillsDir = path.join(globalRoot, ".harness", "skills");

		await fs.mkdir(projectSkillsDir, { recursive: true });
		await fs.mkdir(globalSkillsDir, { recursive: true });
	});

	afterEach(async () => {
		try {
			await fs.rm(tmpDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	});

	// Helper to create a skill folder on disk
	async function createSkillFixture(options: {
		targetDir: string;
		name: string;
		description: string;
		version?: string;
		tags?: string[];
		triggers?: string[];
		author?: string;
		license?: string;
		instructions?: string;
		scripts?: Record<string, string>;
		references?: Record<string, string>;
		assets?: Record<string, string>;
	}): Promise<string> {
		const skillDir = path.join(options.targetDir, options.name);
		await fs.mkdir(skillDir, { recursive: true });

		let frontmatter = `name: "${options.name}"\ndescription: "${options.description}"\n`;
		if (options.version) frontmatter += `version: "${options.version}"\n`;
		if (options.tags) frontmatter += `tags: ${JSON.stringify(options.tags)}\n`;
		if (options.triggers) frontmatter += `triggers: ${JSON.stringify(options.triggers)}\n`;
		if (options.author) frontmatter += `author: "${options.author}"\n`;
		if (options.license) frontmatter += `license: "${options.license}"\n`;

		const content = `---\n${frontmatter}---\n\n${options.instructions || `# ${options.name}\n\nDefault instructions.`}\n`;
		await fs.writeFile(path.join(skillDir, "SKILL.md"), content, "utf-8");

		if (options.scripts) {
			const scriptsDir = path.join(skillDir, "scripts");
			await fs.mkdir(scriptsDir, { recursive: true });
			for (const [name, sContent] of Object.entries(options.scripts)) {
				await fs.writeFile(path.join(scriptsDir, name), sContent, "utf-8");
			}
		}

		if (options.references) {
			const refDir = path.join(skillDir, "references");
			await fs.mkdir(refDir, { recursive: true });
			for (const [name, rContent] of Object.entries(options.references)) {
				await fs.writeFile(path.join(refDir, name), rContent, "utf-8");
			}
		}

		if (options.assets) {
			const assetsDir = path.join(skillDir, "assets");
			await fs.mkdir(assetsDir, { recursive: true });
			for (const [name, aContent] of Object.entries(options.assets)) {
				await fs.writeFile(path.join(assetsDir, name), aContent, "utf-8");
			}
		}

		return skillDir;
	}

	// =========================================================================
	// Scenario S1: Full Lifecycle Workflow
	// (Scaffolding -> Discovery -> Activation -> Asset/Script Exec -> Deactivation)
	// Features: F1, F2, F4, F5, F7, F8, F9, F10, F15
	// =========================================================================
	describe("Scenario S1: End-to-End Skill Lifecycle Workflow", () => {
		it("S1.1: executes complete scaffolding -> discovery -> activation -> asset resolution -> deactivation lifecycle", async () => {
			const skillName = "git-release-manager";

			// 1. Scaffold skill directory with full layout
			const skillDir = await createSkillFixture({
				targetDir: projectSkillsDir,
				name: skillName,
				description: "Automated semantic release workflow with changelog generation",
				version: "1.4.0",
				tags: ["git", "release", "semver"],
				triggers: ["/release", "cut release"],
				author: "Release Bot",
				license: "MIT",
				instructions:
					"# Git Release Manager\n\n## Release Procedure\n1. Ensure working directory is clean.\n2. Run automated test suite.\n3. Generate changelog from commit history.\n4. Bump semver version in package.json.\n5. Create signed git tag and push.",
				scripts: {
					"bump_version.sh": '#!/bin/bash\necho "bumping version to $1"',
					"check_git_clean.sh": "#!/bin/bash\ngit status --porcelain",
				},
				references: {
					"semver_rules.md":
						"# Semver Rules\n- Major: Breaking changes\n- Minor: New features\n- Patch: Bug fixes",
				},
				assets: {
					"release_template.md": "# Release [VERSION]\n\n## Changes\n- ...",
				},
			});

			// 2. Directory Schema Validation
			const validation = await validateSkillDirectory(skillDir, "project");
			expect(validation.valid).toBe(true);
			expect(validation.errors).toHaveLength(0);
			expect(validation.manifest).toBeDefined();
			expect(validation.manifest?.hasScripts).toBe(true);
			expect(validation.manifest?.hasReferences).toBe(true);
			expect(validation.manifest?.hasAssets).toBe(true);
			expect(validation.manifest?.scripts.sort()).toEqual(
				["scripts/bump_version.sh", "scripts/check_git_clean.sh"].sort(),
			);
			expect(validation.manifest?.references).toEqual(["references/semver_rules.md"]);
			expect(validation.manifest?.assets).toEqual(["assets/release_template.md"]);

			// 3. Progressive Discovery in SkillRegistry
			const registry = new SkillRegistry({ projectRoot, globalRoot });
			const index = await registry.discover();
			expect(index.length).toBe(1);
			expect(index[0].name).toBe(skillName);
			expect(index[0].description).toBe(
				"Automated semantic release workflow with changelog generation",
			);
			expect(index[0].scope).toBe("project");
			expect(index[0].triggers).toEqual(["/release", "cut release"]);

			// Discovery prompt index should contain lightweight name + description only
			const discoveryPrompt = registry.formatDiscoveryPrompt();
			expect(discoveryPrompt).toContain(skillName);
			expect(discoveryPrompt).toContain("Automated semantic release workflow");
			expect(discoveryPrompt).not.toContain("## Release Procedure"); // Full instructions not loaded yet

			// 4. Pre-Activation Context Check (0 tokens from skill in Tier 2)
			let projectTier = await buildProjectTier(projectRoot);
			const preActivationText = projectTier
				.map((m) => m.content.map((c) => ("text" in c ? c.text : "")).join(""))
				.join("");
			expect(preActivationText).not.toContain("Git Release Manager");
			expect(preActivationText).not.toContain("## Release Procedure");

			// 5. Dynamic Activation
			const activeManifest = await registry.activate(skillName);
			expect(activeManifest).toBeDefined();
			expect(activeManifest.frontmatter.name).toBe(skillName);
			expect(activeManifest.instructions).toContain("## Release Procedure");

			const activeList = registry.getActiveSkills();
			expect(activeList.length).toBe(1);
			expect(activeList[0].frontmatter.name).toBe(skillName);

			// 6. Post-Activation Context Check (Injected into Tier 2 Project Context)
			projectTier = await buildProjectTier(projectRoot);
			const postActivationText = projectTier
				.map((m) => m.content.map((c) => ("text" in c ? c.text : "")).join(""))
				.join("");
			expect(postActivationText).toContain("Git Release Manager");
			expect(postActivationText).toContain("## Release Procedure");
			expect(postActivationText).toContain("1. Ensure working directory is clean.");

			// 7. Asset and Reference Resolution (Lazy Loading with Path Validation)
			const refPath = await registry.resolveAssetPath(skillName, "references/semver_rules.md");
			expect(existsSync(refPath)).toBe(true);
			const refContent = await fs.readFile(refPath, "utf-8");
			expect(refContent).toContain("# Semver Rules");
			expect(refContent).toContain("Major: Breaking changes");

			const scriptPath = await registry.resolveAssetPath(skillName, "scripts/bump_version.sh");
			expect(existsSync(scriptPath)).toBe(true);
			const scriptContent = await fs.readFile(scriptPath, "utf-8");
			expect(scriptContent).toContain("bumping version");

			// 8. Tool Integration via ToolRegistry
			const toolRegistry = new ToolRegistry();
			registerSkillTools(toolRegistry, registry);
			const toolDefs = toolRegistry.getDefinitions();
			const toolNames = toolDefs.map((t) => t.name);

			expect(toolNames).toContain("activate_skill");
			expect(toolNames).toContain("deactivate_skill");
			expect(toolNames).toContain("read_skill_reference");
			expect(toolNames).toContain("run_skill_script");

			// 9. Deactivation
			const deactivated = registry.deactivate(skillName);
			expect(deactivated).toBe(true);
			expect(registry.getActiveSkills().length).toBe(0);

			// 10. Post-Deactivation Context Check (Zero residual token footprint)
			projectTier = await buildProjectTier(projectRoot);
			const postDeactivationText = projectTier
				.map((m) => m.content.map((c) => ("text" in c ? c.text : "")).join(""))
				.join("");
			expect(postDeactivationText).not.toContain("Git Release Manager");
			expect(postDeactivationText).not.toContain("## Release Procedure");
		});

		it("S1.2: handles multiple concurrent skill activations and selective deactivations cleanly", async () => {
			await createSkillFixture({
				targetDir: projectSkillsDir,
				name: "skill-alpha",
				description: "Alpha processing utility",
				instructions: "# Skill Alpha Instructions\nPerform Alpha tasks.",
			});

			await createSkillFixture({
				targetDir: projectSkillsDir,
				name: "skill-beta",
				description: "Beta processing utility",
				instructions: "# Skill Beta Instructions\nPerform Beta tasks.",
			});

			const registry = new SkillRegistry({ projectRoot, globalRoot });
			await registry.discover();

			// Activate Alpha and Beta
			await registry.activate("skill-alpha");
			await registry.activate("skill-beta");
			expect(registry.getActiveSkills().length).toBe(2);

			let projectTier = await buildProjectTier(projectRoot);
			let contextText = projectTier
				.map((m) => m.content.map((c) => ("text" in c ? c.text : "")).join(""))
				.join("");
			expect(contextText).toContain("Skill Alpha Instructions");
			expect(contextText).toContain("Skill Beta Instructions");

			// Deactivate only Alpha
			registry.deactivate("skill-alpha");
			expect(registry.getActiveSkills().length).toBe(1);

			projectTier = await buildProjectTier(projectRoot);
			contextText = projectTier
				.map((m) => m.content.map((c) => ("text" in c ? c.text : "")).join(""))
				.join("");
			expect(contextText).not.toContain("Skill Alpha Instructions");
			expect(contextText).toContain("Skill Beta Instructions");

			// Deactivate Beta
			registry.deactivate("skill-beta");
			expect(registry.getActiveSkills().length).toBe(0);

			projectTier = await buildProjectTier(projectRoot);
			contextText = projectTier
				.map((m) => m.content.map((c) => ("text" in c ? c.text : "")).join(""))
				.join("");
			expect(contextText).not.toContain("Skill Alpha Instructions");
			expect(contextText).not.toContain("Skill Beta Instructions");
		});
	});

	// =========================================================================
	// Scenario S2: Scope Precedence & Shadowing (Project Overrides Global)
	// Features: F4, F5, F6, F8, F13, F14
	// =========================================================================
	describe("Scenario S2: Scope Precedence & Deterministic Shadowing", () => {
		it("S2.1: project-level skill deterministically overrides global skill with same name across all subsystems", async () => {
			const commonSkillName = "k8s-deployer";

			// 1. Global skill (v1.0.0 - generic cloud)
			await createSkillFixture({
				targetDir: globalSkillsDir,
				name: commonSkillName,
				description: "Generic cloud Kubernetes deployment helper",
				version: "1.0.0",
				author: "Global Cloud Team",
				instructions: "# Global Kubernetes Deployment\n\nRun standard cloud cluster deployment.",
			});

			// 2. Project skill (v2.5.0 - project-specific minikube & custom manifests)
			await createSkillFixture({
				targetDir: projectSkillsDir,
				name: commonSkillName,
				description: "Custom Minikube local Kubernetes deployment with Istio mesh",
				version: "2.5.0",
				author: "Local App Team",
				instructions:
					"# Project Minikube Deployment\n\nRun custom kubectl apply -k ./overlays/local with Istio injection.",
			});

			// 3. Discovery in Registry
			const registry = new SkillRegistry({ projectRoot, globalRoot });
			const index = await registry.discover();

			// Shadowing guarantee: exactly 1 entry for k8s-deployer with scope 'project'
			const matched = index.filter((s) => s.name === commonSkillName);
			expect(matched.length).toBe(1);
			expect(matched[0].scope).toBe("project");
			expect(matched[0].description).toBe(
				"Custom Minikube local Kubernetes deployment with Istio mesh",
			);

			// 4. Activation loads project version
			const activeManifest = await registry.activate(commonSkillName);
			expect(activeManifest.scope).toBe("project");
			expect(activeManifest.frontmatter.version).toBe("2.5.0");
			expect(activeManifest.frontmatter.author).toBe("Local App Team");
			expect(activeManifest.instructions).toContain("Project Minikube Deployment");
			expect(activeManifest.instructions).not.toContain("Global Kubernetes Deployment");

			// 5. Tier 2 Context Injection injects project instructions
			const projectTier = await buildProjectTier(projectRoot);
			const tierText = projectTier
				.map((m) => m.content.map((c) => ("text" in c ? c.text : "")).join(""))
				.join("");
			expect(tierText).toContain("Project Minikube Deployment");
			expect(tierText).not.toContain("Global Kubernetes Deployment");
		});

		it("S2.2: multi-scope hierarchy resolves .harness/skills > ./skills > ~/.harness/skills in exact precedence", async () => {
			const skillName = "multi-scope-tool";
			const altProjectSkillsDir = path.join(projectRoot, "skills");
			await fs.mkdir(altProjectSkillsDir, { recursive: true });

			// Global (Lowest precedence)
			await createSkillFixture({
				targetDir: globalSkillsDir,
				name: skillName,
				description: "Global version",
				version: "1.0.0",
			});

			// ./skills/ (Middle precedence)
			await createSkillFixture({
				targetDir: altProjectSkillsDir,
				name: skillName,
				description: "Middle ./skills version",
				version: "2.0.0",
			});

			// .harness/skills/ (Highest precedence)
			await createSkillFixture({
				targetDir: projectSkillsDir,
				name: skillName,
				description: "Highest .harness/skills version",
				version: "3.0.0",
			});

			// Discovery should pick .harness/skills (v3.0.0)
			let registry = new SkillRegistry({ projectRoot, globalRoot });
			let index = await registry.discover();
			let entry = index.find((s) => s.name === skillName);
			expect(entry?.description).toBe("Highest .harness/skills version");

			// Remove highest precedence version, verify ./skills (v2.0.0) takes precedence over global
			await fs.rm(path.join(projectSkillsDir, skillName), { recursive: true, force: true });
			registry = new SkillRegistry({ projectRoot, globalRoot });
			index = await registry.discover();
			entry = index.find((s) => s.name === skillName);
			expect(entry?.description).toBe("Middle ./skills version");

			// Remove ./skills version, verify global (v1.0.0) becomes active
			await fs.rm(path.join(altProjectSkillsDir, skillName), { recursive: true, force: true });
			registry = new SkillRegistry({ projectRoot, globalRoot });
			index = await registry.discover();
			entry = index.find((s) => s.name === skillName);
			expect(entry?.description).toBe("Global version");
			expect(entry?.scope).toBe("global");
		});
	});

	// =========================================================================
	// Scenario S3: Autonomous Skill Learning & Distillation (/learn)
	// Features: F1, F2, F11, F12, F13, F14
	// =========================================================================
	describe("Scenario S3: Autonomous Skill Distillation Trajectory", () => {
		it("S3.1: distills multi-tool problem solving trajectory into valid SKILL.md, persists to project, and indexes immediately", async () => {
			// 1. Construct realistic conversation trajectory of resolving a complex task
			const trajectory: Message[] = [
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "Please diagnose the failing database migration and fix the Prisma schema.",
						},
					],
				},
				{
					role: "assistant",
					content: [
						{
							type: "text",
							text: "I will first inspect the migration logs to identify the failed constraint.",
						},
						{
							type: "tool_use",
							id: "call_1",
							name: "run_command",
							input: { command: "npx prisma migrate status" },
						},
					],
				},
				{
					role: "tool",
					content: [
						{
							type: "tool_result",
							toolUseId: "call_1",
							content:
								"Error: P3009 - Migration failed to apply clean: unique constraint violation on users.email",
							isError: true,
						},
					],
				},
				{
					role: "assistant",
					content: [
						{
							type: "text",
							text: "Let me inspect prisma/schema.prisma to fix the conflicting index definition.",
						},
						{
							type: "tool_use",
							id: "call_2",
							name: "read_file",
							input: { path: "prisma/schema.prisma" },
						},
					],
				},
				{
					role: "tool",
					content: [
						{
							type: "tool_result",
							toolUseId: "call_2",
							content: "model User {\n  id Int @id\n  email String @unique\n}",
							isError: false,
						},
					],
				},
				{
					role: "assistant",
					content: [
						{
							type: "text",
							text: "I will now apply migration repair and re-run prisma migrate deploy.",
						},
						{
							type: "tool_use",
							id: "call_3",
							name: "run_command",
							input: {
								command:
									"npx prisma migrate resolve --applied 20260818_init && npx prisma migrate deploy",
							},
						},
					],
				},
				{
					role: "tool",
					content: [
						{
							type: "tool_result",
							toolUseId: "call_3",
							content: "Database migrations successfully applied. Schema in sync.",
							isError: false,
						},
					],
				},
				{
					role: "assistant",
					content: [
						{
							type: "text",
							text: "Database migration issue resolved: schema is in sync and migrations applied.",
						},
					],
				},
			];

			// 2. Distill Skill via Distiller Engine
			const distillOptions: DistillOptions = {
				name: "prisma-migration-repair",
				description: "Diagnose and repair failed Prisma migrations and sync schema",
				messages: trajectory,
				tags: ["prisma", "database", "migrations", "postgresql"],
				author: "AutoDistiller",
			};

			const distillResult = SkillDistiller.distillFromTrajectory(distillOptions);

			// 3. Verify Distillation Schema Gate
			expect(distillResult.valid).toBe(true);
			expect(distillResult.errors).toHaveLength(0);
			expect(distillResult.manifest).toBeDefined();

			const manifest = distillResult.manifest as SkillManifest;
			expect(manifest.frontmatter.name).toBe("prisma-migration-repair");
			expect(manifest.frontmatter.description).toBe(
				"Diagnose and repair failed Prisma migrations and sync schema",
			);
			expect(manifest.frontmatter.tags).toEqual(["prisma", "database", "migrations", "postgresql"]);
			expect(manifest.instructions).toContain("prisma");

			// 4. Save Distilled Skill to project skills directory
			const savedPath = await SkillDistiller.saveDistilledSkill(manifest, projectSkillsDir);
			expect(existsSync(savedPath)).toBe(true);
			expect(existsSync(path.join(savedPath, "SKILL.md"))).toBe(true);

			// 5. Validate Saved Directory on Disk
			const diskValidation = await validateSkillDirectory(savedPath, "project");
			expect(diskValidation.valid).toBe(true);
			expect(diskValidation.manifest?.frontmatter.name).toBe("prisma-migration-repair");

			// 6. Registry Immediate Discovery & Activation
			const registry = new SkillRegistry({ projectRoot, globalRoot });
			const index = await registry.discover();
			const discovered = index.find((s) => s.name === "prisma-migration-repair");
			expect(discovered).toBeDefined();
			expect(discovered?.scope).toBe("project");

			const active = await registry.activate("prisma-migration-repair");
			expect(active).toBeDefined();
			expect(active.frontmatter.name).toBe("prisma-migration-repair");
		});

		it("S3.2: distillation schema gate rejects malformed drafts before saving to disk", async () => {
			const invalidDistillOptions: DistillOptions = {
				name: "INVALID NAME WITH SPACES",
				description: "", // Empty description
				messages: [],
			};

			const distillResult = SkillDistiller.distillFromTrajectory(invalidDistillOptions);
			expect(distillResult.valid).toBe(false);
			expect(distillResult.errors.length).toBeGreaterThan(0);
		});
	});

	// =========================================================================
	// Scenario S4: Malicious & Corrupted Skill Directory Handling
	// Features: F2, F3, F7, F8
	// =========================================================================
	describe("Scenario S4: Malicious & Corrupted Skill Directory Resilience", () => {
		it("S4.1: strictly blocks path traversal attacks in asset and reference resolution", async () => {
			const skillName = "traversal-target-skill";
			await createSkillFixture({
				targetDir: projectSkillsDir,
				name: skillName,
				description: "Testing path traversal security",
				references: {
					"safe_ref.md": "# Safe Reference",
				},
			});

			const registry = new SkillRegistry({ projectRoot, globalRoot });
			await registry.discover();

			const maliciousPaths = [
				"../../../../etc/passwd",
				"..\\..\\..\\Windows\\System32\\cmd.exe",
				"references/../../../../sensitive.key",
				"/etc/shadow",
				"C:\\Windows\\System32\\config\\SAM",
			];

			for (const malPath of maliciousPaths) {
				let threw = false;
				try {
					await registry.resolveAssetPath(skillName, malPath);
				} catch (e: unknown) {
					threw = true;
					const msg = e instanceof Error ? e.message : String(e);
					expect(msg).toMatch(/path traversal|sandbox|outside|invalid/i);
				}
				expect(threw).toBe(true);
			}

			// Safe relative path works
			const safePath = await registry.resolveAssetPath(skillName, "references/safe_ref.md");
			expect(existsSync(safePath)).toBe(true);
		});

		it("S4.2: discovery and runtime continue uninterrupted when corrupted skill folders exist", async () => {
			// 1. Valid Skill 1
			await createSkillFixture({
				targetDir: projectSkillsDir,
				name: "valid-skill-1",
				description: "First valid operational skill",
			});

			// 2. Corrupted YAML Skill
			const brokenYamlDir = path.join(projectSkillsDir, "broken-yaml-skill");
			await fs.mkdir(brokenYamlDir, { recursive: true });
			await fs.writeFile(
				path.join(brokenYamlDir, "SKILL.md"),
				`---\nname: "broken-yaml-skill"\ndescription: "Broken: [unclosed\n---\nBody`,
				"utf-8",
			);

			// 3. Empty Directory without SKILL.md
			const emptyDir = path.join(projectSkillsDir, "empty-skill-dir");
			await fs.mkdir(emptyDir, { recursive: true });

			// 4. Skill missing frontmatter delimiters
			const missingDelimDir = path.join(projectSkillsDir, "no-delimiters-skill");
			await fs.mkdir(missingDelimDir, { recursive: true });
			await fs.writeFile(
				path.join(missingDelimDir, "SKILL.md"),
				"# Plain Markdown with no frontmatter",
				"utf-8",
			);

			// 5. Valid Skill 2
			await createSkillFixture({
				targetDir: projectSkillsDir,
				name: "valid-skill-2",
				description: "Second valid operational skill",
			});

			// 6. Execute Discovery — must NOT crash
			const registry = new SkillRegistry({ projectRoot, globalRoot });
			const discovered = await registry.discover();

			const discoveredNames = discovered.map((s) => s.name);
			expect(discoveredNames).toContain("valid-skill-1");
			expect(discoveredNames).toContain("valid-skill-2");
			expect(discoveredNames).not.toContain("broken-yaml-skill");
			expect(discoveredNames).not.toContain("empty-skill-dir");
			expect(discoveredNames).not.toContain("no-delimiters-skill");

			// Valid skills activate and operate normally
			const active1 = await registry.activate("valid-skill-1");
			expect(active1.frontmatter.name).toBe("valid-skill-1");

			const active2 = await registry.activate("valid-skill-2");
			expect(active2.frontmatter.name).toBe("valid-skill-2");
		});

		it("S4.3: activating non-existent or corrupted skill throws clean diagnostic error", async () => {
			const registry = new SkillRegistry({ projectRoot, globalRoot });
			await registry.discover();

			let threw = false;
			try {
				await registry.activate("totally-nonexistent-skill");
			} catch (e: unknown) {
				threw = true;
				const msg = e instanceof Error ? e.message : String(e);
				expect(msg).toMatch(/not found|ERR_SKILL_NOT_FOUND/i);
			}
			expect(threw).toBe(true);
			expect(registry.getActiveSkills()).toHaveLength(0);
		});
	});

	// =========================================================================
	// Scenario S5: Context Budget & Token Efficiency Verification
	// Features: F5, F8, F9
	// =========================================================================
	describe("Scenario S5: Context Budget & Lifecycle Token Efficiency", () => {
		it("S5.1: strictly verifies token budget: Discovery Index (~30 tokens/skill) vs Activation (full body) vs Deactivation (0 tokens)", async () => {
			// 1. Create 5 skills with heavy instruction bodies (5,000 chars / ~1,200 tokens each)
			const heavyInstructionBlock = `\n### Detailed Sub-Step\n${"Execute step with parameter validation, security checking, and telemetry recording. ".repeat(40)}\n`;
			const skillCount = 5;

			for (let i = 1; i <= skillCount; i++) {
				await createSkillFixture({
					targetDir: projectSkillsDir,
					name: `heavy-skill-${i}`,
					description: `Comprehensive diagnostic automation procedure ${i}`,
					instructions: `# Heavy Skill ${i} Documentation\n\n## Instructions\n${heavyInstructionBlock.repeat(3)}`,
				});
			}

			const registry = new SkillRegistry({ projectRoot, globalRoot });
			await registry.discover();

			// STAGE 1: Discovery Prompt Index Footprint
			const discoveryPrompt = registry.formatDiscoveryPrompt();

			// Total discovery prompt length should be compact: approx 50-80 chars per skill (~15-20 tokens)
			const totalChars = discoveryPrompt.length;
			const charsPerSkill = totalChars / skillCount;
			expect(charsPerSkill).toBeLessThan(250); // Well within ~30-40 tokens budget

			// Must NOT contain full instruction bodies
			expect(discoveryPrompt).not.toContain("Execute step with parameter validation");

			// STAGE 2: Activation Stage
			// Activate heavy-skill-1 only
			await registry.activate("heavy-skill-1");

			let projectTier = await buildProjectTier(projectRoot);
			let tierContent = projectTier
				.map((m) => m.content.map((c) => ("text" in c ? c.text : "")).join(""))
				.join("");

			// heavy-skill-1 instructions ARE injected
			expect(tierContent).toContain("Heavy Skill 1 Documentation");
			expect(tierContent).toContain("Execute step with parameter validation");

			// Other 4 skills are NOT injected (0 token consumption)
			for (let i = 2; i <= skillCount; i++) {
				expect(tierContent).not.toContain(`Heavy Skill ${i} Documentation`);
			}

			// STAGE 3: Deactivation & Zero Token Cleanup
			registry.deactivate("heavy-skill-1");
			expect(registry.getActiveSkills().length).toBe(0);

			projectTier = await buildProjectTier(projectRoot);
			tierContent = projectTier
				.map((m) => m.content.map((c) => ("text" in c ? c.text : "")).join(""))
				.join("");

			// Zero token footprint from all skills
			for (let i = 1; i <= skillCount; i++) {
				expect(tierContent).not.toContain(`Heavy Skill ${i} Documentation`);
			}
		});

		it("S5.2: assembleContext maintains correct Tier 1 -> Tier 2 -> Tier 3 ordering with active skills", async () => {
			await createSkillFixture({
				targetDir: projectSkillsDir,
				name: "active-context-skill",
				description: "Context ordering test skill",
				instructions: "# Active Skill Context Instructions",
			});

			const registry = new SkillRegistry({ projectRoot, globalRoot });
			await registry.discover();
			await registry.activate("active-context-skill");

			const messages = await assembleContext({
				stableConfig: { systemPrompt: "Base Stable System Prompt" },
				projectRoot,
				conversationHistory: [
					{ role: "user", content: [{ type: "text", text: "Hello agent" }] },
					{ role: "assistant", content: [{ type: "text", text: "Hello user" }] },
				],
				memoryFacts: ["User prefers TypeScript"],
			});

			expect(messages.length).toBeGreaterThanOrEqual(4);

			// Verify Tier 1 (Stable) is first
			const firstMsgText = messages[0].content.map((c) => ("text" in c ? c.text : "")).join("");
			expect(firstMsgText).toContain("Base Stable System Prompt");

			// Verify Tier 2 (Project & Active Skills) is in middle
			const projectTierMsg = messages.find((m) => {
				const text = m.content.map((c) => ("text" in c ? c.text : "")).join("");
				return text.includes("Active Skill Context Instructions");
			});
			expect(projectTierMsg).toBeDefined();

			// Verify Tier 3 (Volatile: memory facts + conversation history) is at end
			const lastMsg = messages[messages.length - 1];
			expect(lastMsg.role).toBe("assistant");
			const lastMsgText = lastMsg.content.map((c) => ("text" in c ? c.text : "")).join("");
			expect(lastMsgText).toBe("Hello user");
		});
	});
});
