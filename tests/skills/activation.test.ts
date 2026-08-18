import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "../../src/agent/types";
import { assembleContext, buildProjectTier } from "../../src/context/tiers";
import { SkillRegistry } from "../../src/skills/registry";
import { registerSkillTools } from "../../src/skills/tools";
import { ToolRegistry } from "../../src/tools/registry";

describe("Phase 7: Skill Activation & Tier 2 Context Integration", () => {
	let tempDir: string;
	let projectSkillsDir: string;
	let globalSkillsDir: string;

	beforeEach(() => {
		tempDir = join(
			tmpdir(),
			`harness-act-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
		);
		projectSkillsDir = join(tempDir, "project", ".harness", "skills");
		globalSkillsDir = join(tempDir, "global", ".harness", "skills");
		mkdirSync(projectSkillsDir, { recursive: true });
		mkdirSync(globalSkillsDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	// Helper to create a skill folder with SKILL.md and optional files
	function createTestSkill(options: {
		baseDir: string;
		name: string;
		description: string;
		instructions: string;
		version?: string;
		tags?: string[];
		triggers?: string[];
		scripts?: Record<string, string>;
		references?: Record<string, string>;
		assets?: Record<string, string>;
	}) {
		const skillPath = join(options.baseDir, options.name);
		mkdirSync(skillPath, { recursive: true });

		const tagsYaml = options.tags
			? `\ntags:\n${options.tags.map((t) => `  - ${t}`).join("\n")}`
			: "";
		const triggersYaml = options.triggers
			? `\ntriggers:\n${options.triggers.map((t) => `  - ${t}`).join("\n")}`
			: "";
		const versionYaml = options.version ? `\nversion: "${options.version}"` : '\nversion: "1.0.0"';

		const skillContent = `---
name: ${options.name}
description: ${options.description}${versionYaml}${tagsYaml}${triggersYaml}
---

${options.instructions}
`;
		writeFileSync(join(skillPath, "SKILL.md"), skillContent, "utf-8");

		if (options.scripts) {
			const scriptsDir = join(skillPath, "scripts");
			mkdirSync(scriptsDir, { recursive: true });
			for (const [filename, content] of Object.entries(options.scripts)) {
				writeFileSync(join(scriptsDir, filename), content, "utf-8");
			}
		}

		if (options.references) {
			const refDir = join(skillPath, "references");
			mkdirSync(refDir, { recursive: true });
			for (const [filename, content] of Object.entries(options.references)) {
				writeFileSync(join(refDir, filename), content, "utf-8");
			}
		}

		if (options.assets) {
			const assetsDir = join(skillPath, "assets");
			mkdirSync(assetsDir, { recursive: true });
			for (const [filename, content] of Object.entries(options.assets)) {
				writeFileSync(join(assetsDir, filename), content, "utf-8");
			}
		}

		return skillPath;
	}

	// ==========================================
	// Tier 1: Core Feature Coverage (Happy Paths)
	// ==========================================
	describe("Tier 1: Core Feature Coverage", () => {
		it("1. should activate a single skill and return full SkillManifest", async () => {
			createTestSkill({
				baseDir: projectSkillsDir,
				name: "code-review",
				description: "Comprehensive code review assistant",
				instructions: "## Code Review Instructions\n1. Check style.\n2. Check security.",
				tags: ["review", "quality"],
			});

			const registry = new SkillRegistry({
				projectRoot: join(tempDir, "project"),
				globalRoot: join(tempDir, "global"),
			});

			await registry.discover();
			const manifest = await registry.activate("code-review");

			expect(manifest).toBeDefined();
			expect(manifest.frontmatter.name).toBe("code-review");
			expect(manifest.frontmatter.description).toBe("Comprehensive code review assistant");
			expect(manifest.instructions).toContain("## Code Review Instructions");
			expect(manifest.instructions).toContain("Check style.");
			expect(manifest.scope).toBe("project");
		});

		it("2. should list active skill manifests via getActiveSkills()", async () => {
			createTestSkill({
				baseDir: projectSkillsDir,
				name: "test-runner",
				description: "Runs automated test suites",
				instructions: "## Test Runner\nExecute bun test.",
			});

			const registry = new SkillRegistry({
				projectRoot: join(tempDir, "project"),
				globalRoot: join(tempDir, "global"),
			});

			await registry.discover();
			expect(registry.getActiveSkills()).toHaveLength(0);

			await registry.activate("test-runner");
			const active = registry.getActiveSkills();
			expect(active).toHaveLength(1);
			expect(active[0].frontmatter.name).toBe("test-runner");
		});

		it("3. should dynamically inject active skill instructions into Tier 2 project context", async () => {
			createTestSkill({
				baseDir: projectSkillsDir,
				name: "k8s-deploy",
				description: "Kubernetes deployment specialist",
				instructions:
					"## K8s Deployment Steps\n1. kubectl apply -f manifest.yaml\n2. kubectl rollout status",
			});

			const projectRoot = join(tempDir, "project");
			const registry = new SkillRegistry({
				projectRoot,
				globalRoot: join(tempDir, "global"),
			});

			await registry.discover();
			await registry.activate("k8s-deploy");

			const messages = await buildProjectTier(projectRoot, undefined, registry);
			expect(messages.length).toBeGreaterThanOrEqual(1);

			const skillMessage = messages.find(
				(m) =>
					m.role === "system" &&
					m.content.some((c) => c.type === "text" && c.text.includes("K8s Deployment Steps")),
			);
			expect(skillMessage).toBeDefined();
			const textContent = skillMessage?.content.find((c) => c.type === "text");
			if (textContent && textContent.type === "text") {
				expect(textContent.text).toContain("k8s-deploy");
				expect(textContent.text).toContain("kubectl rollout status");
			}
		});

		it("4. should format discovery prompt with lightweight metadata only (~20-40 tokens)", async () => {
			createTestSkill({
				baseDir: projectSkillsDir,
				name: "git-helper",
				description: "Git workflow assistant",
				instructions: "A VERY LONG INSTRUCTION BODY THAT SHOULD NOT BE IN DISCOVERY PROMPT.".repeat(
					20,
				),
			});
			createTestSkill({
				baseDir: projectSkillsDir,
				name: "db-migrator",
				description: "Database migration manager",
				instructions: "ANOTHER VERY LONG INSTRUCTION BODY.".repeat(20),
			});

			const registry = new SkillRegistry({
				projectRoot: join(tempDir, "project"),
				globalRoot: join(tempDir, "global"),
			});

			await registry.discover();
			const prompt = registry.formatDiscoveryPrompt();

			expect(prompt).toContain("git-helper");
			expect(prompt).toContain("Git workflow assistant");
			expect(prompt).toContain("db-migrator");
			expect(prompt).toContain("Database migration manager");
			// Full instructions body MUST NOT be in the discovery prompt index
			expect(prompt).not.toContain("VERY LONG INSTRUCTION BODY");
		});

		it("5. should deactivate an active skill and remove it from getActiveSkills()", async () => {
			createTestSkill({
				baseDir: projectSkillsDir,
				name: "linter",
				description: "Code linter",
				instructions: "Run eslint or biome check.",
			});

			const registry = new SkillRegistry({
				projectRoot: join(tempDir, "project"),
				globalRoot: join(tempDir, "global"),
			});

			await registry.discover();
			await registry.activate("linter");
			expect(registry.getActiveSkills()).toHaveLength(1);

			const deactivated = registry.deactivate("linter");
			expect(deactivated).toBe(true);
			expect(registry.getActiveSkills()).toHaveLength(0);
		});

		it("6. should ensure zero residual prompt tokens in Tier 2 context upon deactivation", async () => {
			createTestSkill({
				baseDir: projectSkillsDir,
				name: "docker-build",
				description: "Docker image builder",
				instructions: "UNIQUE_SECRET_INSTRUCTION_DOCKER_BUILD_V123",
			});

			const projectRoot = join(tempDir, "project");
			const registry = new SkillRegistry({
				projectRoot,
				globalRoot: join(tempDir, "global"),
			});

			await registry.discover();
			await registry.activate("docker-build");

			// Verify active
			const activeMsgs = await buildProjectTier(projectRoot, undefined, registry);
			const hasActiveSkill = activeMsgs.some((m) =>
				m.content.some(
					(c) =>
						c.type === "text" && c.text.includes("UNIQUE_SECRET_INSTRUCTION_DOCKER_BUILD_V123"),
				),
			);
			expect(hasActiveSkill).toBe(true);

			// Deactivate
			registry.deactivate("docker-build");

			// Verify zero tokens / no trace in Tier 2
			const inactiveMsgs = await buildProjectTier(projectRoot, undefined, registry);
			const hasInactiveSkill = inactiveMsgs.some((m) =>
				m.content.some(
					(c) =>
						c.type === "text" &&
						(c.text.includes("UNIQUE_SECRET_INSTRUCTION_DOCKER_BUILD_V123") ||
							c.text.includes("docker-build")),
				),
			);
			expect(hasInactiveSkill).toBe(false);
		});

		it("7. activate_skill tool should activate skill and return success", async () => {
			createTestSkill({
				baseDir: projectSkillsDir,
				name: "release-manager",
				description: "Manages semantic releases",
				instructions: "## Release Instructions\n1. Tag version\n2. Publish release notes",
			});

			const registry = new SkillRegistry({
				projectRoot: join(tempDir, "project"),
				globalRoot: join(tempDir, "global"),
			});
			await registry.discover();

			const toolRegistry = new ToolRegistry();
			registerSkillTools(toolRegistry, registry);

			const activateTool = toolRegistry.get("activate_skill");
			expect(activateTool).toBeDefined();

			const result = await activateTool!.execute({ name: "release-manager" });
			expect(result.isError).toBe(false);
			expect(result.result).toContain("release-manager");
			expect(registry.getActiveSkills().some((s) => s.frontmatter.name === "release-manager")).toBe(
				true,
			);
		});

		it("8. deactivate_skill tool should deactivate skill and return success", async () => {
			createTestSkill({
				baseDir: projectSkillsDir,
				name: "release-manager",
				description: "Manages semantic releases",
				instructions: "## Release Instructions",
			});

			const registry = new SkillRegistry({
				projectRoot: join(tempDir, "project"),
				globalRoot: join(tempDir, "global"),
			});
			await registry.discover();
			await registry.activate("release-manager");

			const toolRegistry = new ToolRegistry();
			registerSkillTools(toolRegistry, registry);

			const deactivateTool = toolRegistry.get("deactivate_skill");
			expect(deactivateTool).toBeDefined();

			const result = await deactivateTool!.execute({ name: "release-manager" });
			expect(result.isError).toBe(false);
			expect(result.result).toContain("release-manager");
			expect(registry.getActiveSkills().some((s) => s.frontmatter.name === "release-manager")).toBe(
				false,
			);
		});

		it("9. read_skill_reference tool should read content from references/ directory", async () => {
			createTestSkill({
				baseDir: projectSkillsDir,
				name: "api-guide",
				description: "API Design Guide",
				instructions: "Follow API standards.",
				references: {
					"cheatsheet.md": "# API Cheatsheet\nUse HTTP 201 for Created.",
				},
			});

			const registry = new SkillRegistry({
				projectRoot: join(tempDir, "project"),
				globalRoot: join(tempDir, "global"),
			});
			await registry.discover();

			const toolRegistry = new ToolRegistry();
			registerSkillTools(toolRegistry, registry);

			const refTool = toolRegistry.get("read_skill_reference");
			expect(refTool).toBeDefined();

			// Support { skill_name, reference_path } or { skill, path } or { name, reference }
			const result = await refTool!.execute({
				skill_name: "api-guide",
				reference_path: "cheatsheet.md",
			});
			expect(result.isError).toBe(false);
			expect(result.result).toContain("# API Cheatsheet");
			expect(result.result).toContain("HTTP 201");
		});

		it("10. run_skill_script tool should execute script in scripts/ directory and return stdout", async () => {
			// Node/Bun script that outputs text
			const scriptCode = `
const args = process.argv.slice(2);
console.log("Skill script executed successfully with args: " + args.join(", "));
`;
			createTestSkill({
				baseDir: projectSkillsDir,
				name: "scaffolder",
				description: "Scaffolds project templates",
				instructions: "Run scaffolding scripts.",
				scripts: {
					"scaffold.js": scriptCode,
				},
			});

			const registry = new SkillRegistry({
				projectRoot: join(tempDir, "project"),
				globalRoot: join(tempDir, "global"),
			});
			await registry.discover();

			const toolRegistry = new ToolRegistry();
			registerSkillTools(toolRegistry, registry);

			const runTool = toolRegistry.get("run_skill_script");
			expect(runTool).toBeDefined();

			const result = await runTool!.execute({
				skill_name: "scaffolder",
				script_path: "scaffold.js",
				args: ["component", "MyButton"],
			});

			expect(result.isError).toBe(false);
			expect(result.result).toContain("Skill script executed successfully");
			expect(result.result).toContain("component, MyButton");
		});
	});

	// ==========================================
	// Tier 2: Boundary, Corner & Error Cases
	// ==========================================
	describe("Tier 2: Boundary, Corner & Error Cases", () => {
		it("11. activating non-existent skill should throw or reject", async () => {
			const registry = new SkillRegistry({
				projectRoot: join(tempDir, "project"),
				globalRoot: join(tempDir, "global"),
			});
			await registry.discover();

			expect(registry.activate("non-existent-skill")).rejects.toThrow();
		});

		it("12. deactivating a non-active skill should return false gracefully without throwing", async () => {
			const registry = new SkillRegistry({
				projectRoot: join(tempDir, "project"),
				globalRoot: join(tempDir, "global"),
			});
			await registry.discover();

			const result = registry.deactivate("never-activated-skill");
			expect(result).toBe(false);
		});

		it("13. activating the same skill multiple times should be idempotent", async () => {
			createTestSkill({
				baseDir: projectSkillsDir,
				name: "idempotent-skill",
				description: "Tests idempotency",
				instructions: "## Step 1: Idempotency check.",
			});

			const projectRoot = join(tempDir, "project");
			const registry = new SkillRegistry({
				projectRoot,
				globalRoot: join(tempDir, "global"),
			});
			await registry.discover();

			await registry.activate("idempotent-skill");
			await registry.activate("idempotent-skill");
			await registry.activate("idempotent-skill");

			expect(registry.getActiveSkills()).toHaveLength(1);

			const messages = await buildProjectTier(projectRoot, undefined, registry);
			const skillMsgs = messages.filter((m) =>
				m.content.some((c) => c.type === "text" && c.text.includes("Idempotency check")),
			);
			expect(skillMsgs).toHaveLength(1);
		});

		it("14. activating skill with empty instructions should handle gracefully without crash", async () => {
			createTestSkill({
				baseDir: projectSkillsDir,
				name: "empty-instructions",
				description: "Skill with empty instructions",
				instructions: "   \n\n   ",
			});

			const projectRoot = join(tempDir, "project");
			const registry = new SkillRegistry({
				projectRoot,
				globalRoot: join(tempDir, "global"),
			});
			await registry.discover();

			const manifest = await registry.activate("empty-instructions");
			expect(manifest).toBeDefined();

			const messages = await buildProjectTier(projectRoot, undefined, registry);
			expect(Array.isArray(messages)).toBe(true);
		});

		it("15. should preserve markdown tables, code fences, unicode, and emojis in context", async () => {
			const complexMarkdown = `
# 🛠️ Advanced Tooling
| Command | Purpose | Speed |
|---|---|---|
| \`bun test\` | Fast unit testing | ⚡ 10ms |
| \`biome check\` | Fast linting | 🚀 5ms |

\`\`\`typescript
export function optimize(input: string): string {
  return \`✨ \${input.trim()} ✨\`;
}
\`\`\`
`;
			createTestSkill({
				baseDir: projectSkillsDir,
				name: "complex-formatting",
				description: "Complex markdown skill",
				instructions: complexMarkdown,
			});

			const projectRoot = join(tempDir, "project");
			const registry = new SkillRegistry({
				projectRoot,
				globalRoot: join(tempDir, "global"),
			});
			await registry.discover();
			await registry.activate("complex-formatting");

			const messages = await buildProjectTier(projectRoot, undefined, registry);
			const matchingMsg = messages.find((m) =>
				m.content.some((c) => c.type === "text" && c.text.includes("Advanced Tooling")),
			);
			expect(matchingMsg).toBeDefined();
			const text = (matchingMsg!.content[0] as any).text;
			expect(text).toContain("| Command | Purpose | Speed |");
			expect(text).toContain("```typescript");
			expect(text).toContain("✨ ${input.trim()} ✨");
			expect(text).toContain("🚀 5ms");
		});

		it("16. activate_skill tool should return error for unknown skill", async () => {
			const registry = new SkillRegistry({
				projectRoot: join(tempDir, "project"),
				globalRoot: join(tempDir, "global"),
			});
			await registry.discover();

			const toolRegistry = new ToolRegistry();
			registerSkillTools(toolRegistry, registry);

			const activateTool = toolRegistry.get("activate_skill");
			const result = await activateTool!.execute({ name: "missing-skill-123" });

			expect(result.isError).toBe(true);
			expect(result.result).toMatch(/not found|error|invalid/i);
		});

		it("17. read_skill_reference tool should block path traversal outside references/", async () => {
			createTestSkill({
				baseDir: projectSkillsDir,
				name: "secure-skill",
				description: "Secure Skill",
				instructions: "Secure instructions.",
				references: {
					"legit.md": "Legit reference content",
				},
			});

			const registry = new SkillRegistry({
				projectRoot: join(tempDir, "project"),
				globalRoot: join(tempDir, "global"),
			});
			await registry.discover();

			const toolRegistry = new ToolRegistry();
			registerSkillTools(toolRegistry, registry);

			const refTool = toolRegistry.get("read_skill_reference");

			// Path traversal attempts
			const attack1 = await refTool!.execute({
				skill_name: "secure-skill",
				reference_path: "../SKILL.md",
			});
			expect(attack1.isError).toBe(true);

			const attack2 = await refTool!.execute({
				skill_name: "secure-skill",
				reference_path: "../../../../etc/passwd",
			});
			expect(attack2.isError).toBe(true);
		});

		it("18. read_skill_reference tool should return error for non-existent reference file", async () => {
			createTestSkill({
				baseDir: projectSkillsDir,
				name: "secure-skill",
				description: "Secure Skill",
				instructions: "Secure instructions.",
			});

			const registry = new SkillRegistry({
				projectRoot: join(tempDir, "project"),
				globalRoot: join(tempDir, "global"),
			});
			await registry.discover();

			const toolRegistry = new ToolRegistry();
			registerSkillTools(toolRegistry, registry);

			const refTool = toolRegistry.get("read_skill_reference");
			const result = await refTool!.execute({
				skill_name: "secure-skill",
				reference_path: "does_not_exist.md",
			});

			expect(result.isError).toBe(true);
			expect(result.result).toMatch(/not found|error|does not exist/i);
		});

		it("19. run_skill_script tool should block path traversal outside scripts/", async () => {
			createTestSkill({
				baseDir: projectSkillsDir,
				name: "sandbox-skill",
				description: "Sandbox Skill",
				instructions: "Sandbox instructions.",
				scripts: {
					"safe.js": 'console.log("safe");',
				},
			});

			const registry = new SkillRegistry({
				projectRoot: join(tempDir, "project"),
				globalRoot: join(tempDir, "global"),
			});
			await registry.discover();

			const toolRegistry = new ToolRegistry();
			registerSkillTools(toolRegistry, registry);

			const runTool = toolRegistry.get("run_skill_script");

			const attack = await runTool!.execute({
				skill_name: "sandbox-skill",
				script_path: "../../package.json",
			});
			expect(attack.isError).toBe(true);
			expect(attack.result).toMatch(/denied|invalid|outside|error|not found/i);
		});

		it("20. run_skill_script tool should capture script failures with isError: true", async () => {
			// Script that exits with error code
			const failScript = `
console.error("FATAL_SCRIPT_CRASH_ERR_77");
process.exit(1);
`;
			createTestSkill({
				baseDir: projectSkillsDir,
				name: "failing-skill",
				description: "Failing script skill",
				instructions: "Instructions.",
				scripts: {
					"fail.js": failScript,
				},
			});

			const registry = new SkillRegistry({
				projectRoot: join(tempDir, "project"),
				globalRoot: join(tempDir, "global"),
			});
			await registry.discover();

			const toolRegistry = new ToolRegistry();
			registerSkillTools(toolRegistry, registry);

			const runTool = toolRegistry.get("run_skill_script");
			const result = await runTool!.execute({
				skill_name: "failing-skill",
				script_path: "fail.js",
			});

			expect(result.isError).toBe(true);
			expect(result.result).toContain("FATAL_SCRIPT_CRASH_ERR_77");
		});

		it("21. tool definitions in ToolRegistry should conform to JSON Schema specifications", () => {
			const registry = new SkillRegistry({
				projectRoot: join(tempDir, "project"),
				globalRoot: join(tempDir, "global"),
			});
			const toolRegistry = new ToolRegistry();
			registerSkillTools(toolRegistry, registry);

			const defs = toolRegistry.getDefinitions();
			const toolNames = defs.map((d) => d.name);

			expect(toolNames).toContain("activate_skill");
			expect(toolNames).toContain("deactivate_skill");
			expect(toolNames).toContain("read_skill_reference");
			expect(toolNames).toContain("run_skill_script");

			for (const def of defs) {
				expect(def.name).toBeTruthy();
				expect(def.description).toBeTruthy();
				expect(def.inputSchema).toBeDefined();
				expect(typeof def.inputSchema).toBe("object");
				expect((def.inputSchema as any).type).toBe("object");
			}
		});
	});

	// ==========================================
	// Tier 3: Combinations & Cross-Feature Integration
	// ==========================================
	describe("Tier 3: Combinations & Cross-Feature Integration", () => {
		it("22. should support multiple simultaneously active skills in Tier 2 context", async () => {
			createTestSkill({
				baseDir: projectSkillsDir,
				name: "skill-alpha",
				description: "Alpha skill",
				instructions: "ALPHA_INSTRUCTIONS_TOKEN",
			});
			createTestSkill({
				baseDir: projectSkillsDir,
				name: "skill-beta",
				description: "Beta skill",
				instructions: "BETA_INSTRUCTIONS_TOKEN",
			});
			createTestSkill({
				baseDir: projectSkillsDir,
				name: "skill-gamma",
				description: "Gamma skill",
				instructions: "GAMMA_INSTRUCTIONS_TOKEN",
			});

			const projectRoot = join(tempDir, "project");
			const registry = new SkillRegistry({
				projectRoot,
				globalRoot: join(tempDir, "global"),
			});
			await registry.discover();

			await registry.activate("skill-alpha");
			await registry.activate("skill-beta");
			await registry.activate("skill-gamma");

			expect(registry.getActiveSkills()).toHaveLength(3);

			const messages = await buildProjectTier(projectRoot, undefined, registry);
			const combinedText = messages.map((m) => (m.content[0] as any).text).join("\n");

			expect(combinedText).toContain("ALPHA_INSTRUCTIONS_TOKEN");
			expect(combinedText).toContain("BETA_INSTRUCTIONS_TOKEN");
			expect(combinedText).toContain("GAMMA_INSTRUCTIONS_TOKEN");
		});

		it("23. should handle partial deactivation with remaining skills staying active", async () => {
			createTestSkill({
				baseDir: projectSkillsDir,
				name: "skill-alpha",
				description: "Alpha skill",
				instructions: "ALPHA_INSTRUCTIONS_TOKEN",
			});
			createTestSkill({
				baseDir: projectSkillsDir,
				name: "skill-beta",
				description: "Beta skill",
				instructions: "BETA_INSTRUCTIONS_TOKEN",
			});
			createTestSkill({
				baseDir: projectSkillsDir,
				name: "skill-gamma",
				description: "Gamma skill",
				instructions: "GAMMA_INSTRUCTIONS_TOKEN",
			});

			const projectRoot = join(tempDir, "project");
			const registry = new SkillRegistry({
				projectRoot,
				globalRoot: join(tempDir, "global"),
			});
			await registry.discover();

			await registry.activate("skill-alpha");
			await registry.activate("skill-beta");
			await registry.activate("skill-gamma");

			// Deactivate beta only
			registry.deactivate("skill-beta");

			const active = registry.getActiveSkills();
			expect(active).toHaveLength(2);
			expect(active.some((s) => s.frontmatter.name === "skill-alpha")).toBe(true);
			expect(active.some((s) => s.frontmatter.name === "skill-gamma")).toBe(true);
			expect(active.some((s) => s.frontmatter.name === "skill-beta")).toBe(false);

			const messages = await buildProjectTier(projectRoot, undefined, registry);
			const combinedText = messages.map((m) => (m.content[0] as any).text).join("\n");

			expect(combinedText).toContain("ALPHA_INSTRUCTIONS_TOKEN");
			expect(combinedText).toContain("GAMMA_INSTRUCTIONS_TOKEN");
			expect(combinedText).not.toContain("BETA_INSTRUCTIONS_TOKEN");
		});

		it("24. assembleContext should place active skills in Tier 2 between stable and volatile tiers", async () => {
			const projectRoot = join(tempDir, "project");
			writeFileSync(join(projectRoot, "AGENTS.md"), "# Project AGENTS.md");

			createTestSkill({
				baseDir: projectSkillsDir,
				name: "full-stack-assistant",
				description: "Full stack guide",
				instructions: "FULL_STACK_ACTIVE_INSTRUCTION",
			});

			const registry = new SkillRegistry({
				projectRoot,
				globalRoot: join(tempDir, "global"),
			});
			await registry.discover();
			await registry.activate("full-stack-assistant");

			const history: Message[] = [
				{ role: "user", content: [{ type: "text", text: "USER_QUERY_START" }] },
				{ role: "assistant", content: [{ type: "text", text: "ASSISTANT_REPLY_1" }] },
			];

			const fullContext = await assembleContext({
				stableConfig: { systemPrompt: "STABLE_SYSTEM_PROMPT_123" },
				projectRoot,
				conversationHistory: history,
				memoryFacts: ["USER_FAVORITE_COLOR_BLUE"],
				skillRegistry: registry,
			});

			expect(fullContext.length).toBeGreaterThanOrEqual(4);

			// Verify Tier 1 (Stable) is first
			const firstMsgText = (fullContext[0].content[0] as any).text;
			expect(firstMsgText).toContain("STABLE_SYSTEM_PROMPT_123");

			// Verify Tier 2 contains active skill before user history
			const skillIdx = fullContext.findIndex((m) =>
				m.content.some(
					(c) => c.type === "text" && c.text.includes("FULL_STACK_ACTIVE_INSTRUCTION"),
				),
			);
			const userIdx = fullContext.findIndex((m) =>
				m.content.some((c) => c.type === "text" && c.text.includes("USER_QUERY_START")),
			);

			expect(skillIdx).toBeGreaterThan(0);
			expect(userIdx).toBeGreaterThan(skillIdx);
		});

		it("25. project-level skill should shadow global skill when activated in context", async () => {
			createTestSkill({
				baseDir: globalSkillsDir,
				name: "formatter",
				description: "Global Formatter",
				instructions: "GLOBAL_FORMATTER_INSTRUCTIONS_BODY",
			});
			createTestSkill({
				baseDir: projectSkillsDir,
				name: "formatter",
				description: "Project Formatter",
				instructions: "PROJECT_OVERRIDE_FORMATTER_INSTRUCTIONS_BODY",
			});

			const projectRoot = join(tempDir, "project");
			const registry = new SkillRegistry({
				projectRoot,
				globalRoot: join(tempDir, "global"),
			});
			await registry.discover();

			const manifest = await registry.activate("formatter");
			expect(manifest.scope).toBe("project");
			expect(manifest.instructions).toContain("PROJECT_OVERRIDE_FORMATTER_INSTRUCTIONS_BODY");

			const messages = await buildProjectTier(projectRoot, undefined, registry);
			const combinedText = messages.map((m) => (m.content[0] as any).text).join("\n");

			expect(combinedText).toContain("PROJECT_OVERRIDE_FORMATTER_INSTRUCTIONS_BODY");
			expect(combinedText).not.toContain("GLOBAL_FORMATTER_INSTRUCTIONS_BODY");
		});

		it("26. end-to-end tool and context dynamic lifecycle", async () => {
			createTestSkill({
				baseDir: projectSkillsDir,
				name: "workflow-bot",
				description: "E2E workflow bot",
				instructions: "## WORKFLOW_BOT_INSTRUCTIONS\nStep 1: Do work.",
				references: {
					"manual.md": "# WORKFLOW MANUAL\nRead carefully.",
				},
				scripts: {
					"ping.js": 'console.log("PONG_OUTPUT_SUCCESS");',
				},
			});

			const projectRoot = join(tempDir, "project");
			const registry = new SkillRegistry({
				projectRoot,
				globalRoot: join(tempDir, "global"),
			});
			await registry.discover();

			const toolRegistry = new ToolRegistry();
			registerSkillTools(toolRegistry, registry);

			// 1. Initially inactive
			expect(registry.getActiveSkills()).toHaveLength(0);
			let msgs = await buildProjectTier(projectRoot, undefined, registry);
			expect(
				msgs.some((m) => (m.content[0] as any).text.includes("WORKFLOW_BOT_INSTRUCTIONS")),
			).toBe(false);

			// 2. Activate via tool
			const actResult = await toolRegistry.get("activate_skill")!.execute({ name: "workflow-bot" });
			expect(actResult.isError).toBe(false);
			expect(registry.getActiveSkills()).toHaveLength(1);

			// 3. Verify Tier 2 updated
			msgs = await buildProjectTier(projectRoot, undefined, registry);
			expect(
				msgs.some((m) => (m.content[0] as any).text.includes("WORKFLOW_BOT_INSTRUCTIONS")),
			).toBe(true);

			// 4. Read reference
			const refResult = await toolRegistry.get("read_skill_reference")!.execute({
				skill_name: "workflow-bot",
				reference_path: "manual.md",
			});
			expect(refResult.isError).toBe(false);
			expect(refResult.result).toContain("WORKFLOW MANUAL");

			// 5. Run script
			const scriptResult = await toolRegistry.get("run_skill_script")!.execute({
				skill_name: "workflow-bot",
				script_path: "ping.js",
			});
			expect(scriptResult.isError).toBe(false);
			expect(scriptResult.result).toContain("PONG_OUTPUT_SUCCESS");

			// 6. Deactivate via tool
			const deactResult = await toolRegistry
				.get("deactivate_skill")!
				.execute({ name: "workflow-bot" });
			expect(deactResult.isError).toBe(false);
			expect(registry.getActiveSkills()).toHaveLength(0);

			// 7. Verify zero tokens in Tier 2
			msgs = await buildProjectTier(projectRoot, undefined, registry);
			expect(
				msgs.some((m) => (m.content[0] as any).text.includes("WORKFLOW_BOT_INSTRUCTIONS")),
			).toBe(false);
		});
	});
});
