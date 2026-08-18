import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "../../src/agent/types";
import { buildProjectTier } from "../../src/context/tiers";
import { type DistillOptions, SkillDistiller } from "../../src/skills/distiller";
import { parseSkillMarkdown, validateSkillDirectory } from "../../src/skills/parser";
import { SkillRegistry } from "../../src/skills/registry";

describe("Phase 7: Autonomous Skill Distillation & Schema Gate", () => {
	let tempDir: string;
	let projectSkillsDir: string;
	let globalSkillsDir: string;

	beforeEach(() => {
		tempDir = join(
			tmpdir(),
			`harness-dist-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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

	// Helper to create synthetic conversation trajectories
	function createSampleTrajectory(): Message[] {
		return [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Please configure Biome linter and run format check for this repository.",
					},
				],
			},
			{
				role: "assistant",
				content: [
					{ type: "text", text: "I will create biome.json and execute biome check." },
					{
						type: "tool_use",
						id: "call_1",
						name: "write_file",
						input: {
							path: "biome.json",
							content:
								'{\n  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",\n  "formatter": { "enabled": true }\n}',
						},
					},
				],
			},
			{
				role: "tool",
				content: [
					{
						type: "tool_result",
						toolUseId: "call_1",
						content: "Successfully wrote biome.json",
						isError: false,
					},
				],
			},
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "call_2",
						name: "shell",
						input: {
							command: "bun x @biomejs/biome check --write .",
						},
					},
				],
			},
			{
				role: "tool",
				content: [
					{
						type: "tool_result",
						toolUseId: "call_2",
						content: "Checked 14 files. Fixed 2 files. No errors.",
						isError: false,
					},
				],
			},
			{
				role: "assistant",
				content: [
					{
						type: "text",
						text: "Biome configuration has been initialized in biome.json and formatting has been applied across the codebase.",
					},
				],
			},
		];
	}

	// ==========================================
	// Tier 1: Core Feature Coverage (Happy Paths)
	// ==========================================
	describe("Tier 1: Core Feature Coverage", () => {
		it("1. should distill a valid SkillManifest from a standard conversation trajectory", () => {
			const messages = createSampleTrajectory();
			const options: DistillOptions = {
				name: "biome-setup",
				description: "Configures Biome linter and formatter for TypeScript projects",
				messages,
				tags: ["linting", "formatting", "biome"],
				author: "harness-agent",
			};

			const result = SkillDistiller.distillFromTrajectory(options);

			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
			expect(result.manifest).toBeDefined();
			expect(result.manifest?.frontmatter.name).toBe("biome-setup");
			expect(result.manifest?.frontmatter.description).toBe(
				"Configures Biome linter and formatter for TypeScript projects",
			);
		});

		it("2. should extract and populate frontmatter metadata accurately", () => {
			const messages = createSampleTrajectory();
			const options: DistillOptions = {
				name: "biome-setup",
				description: "Configures Biome linter and formatter",
				messages,
				tags: ["tooling", "dx"],
				author: "ai-assistant",
			};

			const result = SkillDistiller.distillFromTrajectory(options);
			expect(result.valid).toBe(true);
			const fm = result.manifest!.frontmatter;

			expect(fm.name).toBe("biome-setup");
			expect(fm.description).toBe("Configures Biome linter and formatter");
			expect(fm.tags).toContain("tooling");
			expect(fm.tags).toContain("dx");
			expect(fm.author).toBe("ai-assistant");
			expect(fm.version).toBeDefined();
		});

		it("3. should generate structured markdown procedural instructions", () => {
			const messages = createSampleTrajectory();
			const options: DistillOptions = {
				name: "biome-setup",
				description: "Configures Biome linter and formatter",
				messages,
			};

			const result = SkillDistiller.distillFromTrajectory(options);
			expect(result.valid).toBe(true);
			const instructions = result.manifest!.instructions;

			expect(instructions.length).toBeGreaterThan(20);
			// Should contain structured sections (e.g. headers or numbered steps)
			expect(instructions).toMatch(/#|##|\d+\./);
		});

		it("4. should synthesize commands and tool actions from trajectory into procedural instructions", () => {
			const messages = createSampleTrajectory();
			const options: DistillOptions = {
				name: "biome-setup",
				description: "Configures Biome linter and formatter",
				messages,
			};

			const result = SkillDistiller.distillFromTrajectory(options);
			expect(result.valid).toBe(true);
			const raw = result.manifest!.rawContent;

			// Trajectory used biome.json and @biomejs/biome check
			expect(raw).toMatch(/biome\.json|biome/i);
		});

		it("5. should produce valid agentskills.io format that parses via parseSkillMarkdown", () => {
			const messages = createSampleTrajectory();
			const options: DistillOptions = {
				name: "docker-deploy",
				description: "Builds and deploys containerized applications",
				messages,
				tags: ["docker", "deploy"],
			};

			const result = SkillDistiller.distillFromTrajectory(options);
			expect(result.valid).toBe(true);

			const parsed = parseSkillMarkdown(result.manifest!.rawContent);
			expect(parsed.valid).toBe(true);
			expect(parsed.manifest?.frontmatter.name).toBe("docker-deploy");
			expect(parsed.manifest?.frontmatter.description).toBe(
				"Builds and deploys containerized applications",
			);
		});

		it("6. should save distilled skill to target directory via saveDistilledSkill", async () => {
			const messages = createSampleTrajectory();
			const result = SkillDistiller.distillFromTrajectory({
				name: "saved-distilled-skill",
				description: "A test distilled skill for file saving",
				messages,
			});
			expect(result.valid).toBe(true);

			const savedDir = await SkillDistiller.saveDistilledSkill(result.manifest!, projectSkillsDir);

			expect(existsSync(savedDir)).toBe(true);
			const skillMdPath = join(savedDir, "SKILL.md");
			expect(existsSync(skillMdPath)).toBe(true);

			const fileContent = readFileSync(skillMdPath, "utf-8");
			expect(fileContent).toContain("name: saved-distilled-skill");
			expect(fileContent).toContain("description: A test distilled skill for file saving");
		});

		it("7. should validate saved directory layout via validateSkillDirectory", async () => {
			const messages = createSampleTrajectory();
			const result = SkillDistiller.distillFromTrajectory({
				name: "validated-distilled-skill",
				description: "A validated distilled skill",
				messages,
			});
			expect(result.valid).toBe(true);

			const savedDir = await SkillDistiller.saveDistilledSkill(result.manifest!, projectSkillsDir);

			const validation = await validateSkillDirectory(savedDir, "project");
			expect(validation.valid).toBe(true);
			expect(validation.errors).toHaveLength(0);
			expect(validation.manifest?.frontmatter.name).toBe("validated-distilled-skill");
		});

		it("8. should make saved distilled skill immediately discoverable in SkillRegistry", async () => {
			const messages = createSampleTrajectory();
			const result = SkillDistiller.distillFromTrajectory({
				name: "auto-discovered-skill",
				description: "Skill created and immediately discovered",
				messages,
				tags: ["auto", "discovery"],
			});
			expect(result.valid).toBe(true);

			await SkillDistiller.saveDistilledSkill(result.manifest!, projectSkillsDir);

			const registry = new SkillRegistry({
				projectRoot: join(tempDir, "project"),
				globalRoot: join(tempDir, "global"),
			});

			const index = await registry.discover();
			const entry = index.find((e) => e.name === "auto-discovered-skill");

			expect(entry).toBeDefined();
			expect(entry?.description).toBe("Skill created and immediately discovered");
			expect(entry?.scope).toBe("project");
		});
	});

	// ==========================================
	// Tier 2: Boundary, Corner & Error Cases
	// ==========================================
	describe("Tier 2: Boundary, Corner & Error Cases", () => {
		it("9. should reject invalid skill name with uppercase characters via schema gate", () => {
			const messages = createSampleTrajectory();
			const result = SkillDistiller.distillFromTrajectory({
				name: "InvalidSkillNameWithUppercase",
				description: "Valid description",
				messages,
			});

			expect(result.valid).toBe(false);
			expect(result.manifest).toBeUndefined();
			expect(result.errors.length).toBeGreaterThanOrEqual(1);
			expect(result.errors.some((e) => /name|invalid|uppercase/i.test(e.message || e.code))).toBe(
				true,
			);
		});

		it("10. should reject skill name containing spaces or illegal characters", () => {
			const messages = createSampleTrajectory();
			const invalidNames = [
				"skill with spaces",
				"skill@special!",
				"skill_with_traversal/../../",
				"skill*name",
			];

			for (const invalidName of invalidNames) {
				const result = SkillDistiller.distillFromTrajectory({
					name: invalidName,
					description: "Valid description",
					messages,
				});

				expect(result.valid).toBe(false);
				expect(result.manifest).toBeUndefined();
				expect(result.errors.length).toBeGreaterThanOrEqual(1);
			}
		});

		it("11. should reject empty or whitespace-only skill name", () => {
			const messages = createSampleTrajectory();
			const resultEmpty = SkillDistiller.distillFromTrajectory({
				name: "",
				description: "Valid description",
				messages,
			});
			expect(resultEmpty.valid).toBe(false);
			expect(resultEmpty.errors.length).toBeGreaterThanOrEqual(1);

			const resultWhitespace = SkillDistiller.distillFromTrajectory({
				name: "   ",
				description: "Valid description",
				messages,
			});
			expect(resultWhitespace.valid).toBe(false);
			expect(resultWhitespace.errors.length).toBeGreaterThanOrEqual(1);
		});

		it("12. should reject missing or empty description", () => {
			const messages = createSampleTrajectory();
			const result = SkillDistiller.distillFromTrajectory({
				name: "valid-name",
				description: "",
				messages,
			});

			expect(result.valid).toBe(false);
			expect(result.manifest).toBeUndefined();
			expect(result.errors.some((e) => /description|missing/i.test(e.message || e.code))).toBe(
				true,
			);
		});

		it("13. should handle empty messages trajectory gracefully", () => {
			const result = SkillDistiller.distillFromTrajectory({
				name: "empty-trajectory-skill",
				description: "A skill distilled from an empty trajectory",
				messages: [],
			});

			// Should either produce a valid starter template or return a clear result without unhandled exception
			expect(result).toBeDefined();
			expect(typeof result.valid).toBe("boolean");
			if (result.valid) {
				expect(result.manifest?.frontmatter.name).toBe("empty-trajectory-skill");
			}
		});

		it("14. should handle trajectory with failed tool calls and capture corrective steps", () => {
			const failureTrajectory: Message[] = [
				{
					role: "user",
					content: [
						{ type: "text", text: "Run the database migrations and fix any connection issues." },
					],
				},
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "c1",
							name: "shell",
							input: { command: "bun run migrate" },
						},
					],
				},
				{
					role: "tool",
					content: [
						{
							type: "tool_result",
							toolUseId: "c1",
							content: "Error: Connection refused at localhost:5432. DATABASE_URL is unset.",
							isError: true,
						},
					],
				},
				{
					role: "assistant",
					content: [
						{
							type: "text",
							text: "DATABASE_URL was missing. I will export the environment variable and retry.",
						},
						{
							type: "tool_use",
							id: "c2",
							name: "shell",
							input: {
								command:
									'export DATABASE_URL="postgresql://user:pass@localhost:5432/db" && bun run migrate',
							},
						},
					],
				},
				{
					role: "tool",
					content: [
						{
							type: "tool_result",
							toolUseId: "c2",
							content: "Migration applied successfully.",
							isError: false,
						},
					],
				},
			];

			const result = SkillDistiller.distillFromTrajectory({
				name: "db-migration-troubleshoot",
				description: "Handles database migration with connection fallback",
				messages: failureTrajectory,
			});

			expect(result.valid).toBe(true);
			expect(result.manifest).toBeDefined();
			expect(result.manifest?.instructions).toBeTruthy();
		});

		it("15. should safely escape YAML special characters in description and tags", () => {
			const messages = createSampleTrajectory();
			const trickyDescription = `Configures & "verifies" [linter: v1.0] {fast: true} -- 'safe'`;
			const trickyTags = ["tag:with:colon", 'tag "with quotes"', "tag-with-dashes"];

			const result = SkillDistiller.distillFromTrajectory({
				name: "tricky-yaml-escape",
				description: trickyDescription,
				messages,
				tags: trickyTags,
			});

			expect(result.valid).toBe(true);
			// Verify rawContent parses back cleanly without YAML syntax error
			const parsed = parseSkillMarkdown(result.manifest!.rawContent);
			expect(parsed.valid).toBe(true);
			expect(parsed.manifest?.frontmatter.name).toBe("tricky-yaml-escape");
		});

		it("16. should preserve unicode, emojis, backticks, and code blocks in trajectory content", () => {
			const richTrajectory: Message[] = [
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "Build a high-performance logger with 🚀 emojis and ```typescript code blocks.",
						},
					],
				},
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "c1",
							name: "write_file",
							input: {
								path: "logger.ts",
								content: "export const log = (msg: string) => console.log(`🚀 ${msg}`);",
							},
						},
					],
				},
				{
					role: "tool",
					content: [
						{ type: "tool_result", toolUseId: "c1", content: "Wrote logger.ts", isError: false },
					],
				},
			];

			const result = SkillDistiller.distillFromTrajectory({
				name: "emoji-logger",
				description: "Logger with 🚀 emojis and TypeScript types",
				messages: richTrajectory,
			});

			expect(result.valid).toBe(true);
			expect(result.manifest?.rawContent).toContain("🚀");
		});

		it("17. should default version and handle omitted optional fields gracefully", () => {
			const messages = createSampleTrajectory();
			const result = SkillDistiller.distillFromTrajectory({
				name: "minimal-options-skill",
				description: "Minimal options skill",
				messages,
				// tags, author omitted
			});

			expect(result.valid).toBe(true);
			expect(result.manifest?.frontmatter.name).toBe("minimal-options-skill");
			expect(result.manifest?.frontmatter.version).toBeDefined();
		});

		it("18. should create nested target directories recursively on save", async () => {
			const messages = createSampleTrajectory();
			const result = SkillDistiller.distillFromTrajectory({
				name: "nested-save-skill",
				description: "Tests deep recursive directory creation",
				messages,
			});
			expect(result.valid).toBe(true);

			const deepDir = join(tempDir, "deep", "nested", "path", "skills");
			const savedDir = await SkillDistiller.saveDistilledSkill(result.manifest!, deepDir);

			expect(existsSync(savedDir)).toBe(true);
			expect(existsSync(join(savedDir, "SKILL.md"))).toBe(true);
		});

		it("19. should allow cleanly updating/overwriting an existing skill folder", async () => {
			const messages = createSampleTrajectory();

			// Save v1
			const v1Result = SkillDistiller.distillFromTrajectory({
				name: "updatable-skill",
				description: "Version 1 description",
				messages,
			});
			await SkillDistiller.saveDistilledSkill(v1Result.manifest!, projectSkillsDir);

			// Save v2
			const v2Result = SkillDistiller.distillFromTrajectory({
				name: "updatable-skill",
				description: "Version 2 updated description with new features",
				messages,
			});
			const savedDir = await SkillDistiller.saveDistilledSkill(
				v2Result.manifest!,
				projectSkillsDir,
			);

			const updatedContent = readFileSync(join(savedDir, "SKILL.md"), "utf-8");
			expect(updatedContent).toContain("Version 2 updated description");
		});
	});

	// ==========================================
	// Tier 3: Combinations & Cross-Feature Integration
	// ==========================================
	describe("Tier 3: Combinations & Cross-Feature Integration", () => {
		it("20. should execute full lifecycle: Distill -> Save -> Discover -> Activate -> Tier 2 Context Injection", async () => {
			const trajectory: Message[] = [
				{
					role: "user",
					content: [{ type: "text", text: "Set up Prisma ORM and generate schema client." }],
				},
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "c1",
							name: "shell",
							input: { command: "bun x prisma init" },
						},
					],
				},
				{
					role: "tool",
					content: [
						{
							type: "tool_result",
							toolUseId: "c1",
							content: "Initialized Prisma schema",
							isError: false,
						},
					],
				},
				{
					role: "assistant",
					content: [
						{
							type: "text",
							text: "Prisma has been configured. Run bun x prisma generate to generate types.",
						},
					],
				},
			];

			// 1. Distill
			const distillResult = SkillDistiller.distillFromTrajectory({
				name: "prisma-workflow",
				description: "Prisma ORM setup and generation workflow",
				messages: trajectory,
				tags: ["prisma", "database", "orm"],
			});
			expect(distillResult.valid).toBe(true);

			// 2. Save to project skills
			const projectRoot = join(tempDir, "project");
			const savedPath = await SkillDistiller.saveDistilledSkill(
				distillResult.manifest!,
				projectSkillsDir,
			);
			expect(existsSync(savedPath)).toBe(true);

			// 3. Discover via SkillRegistry
			const registry = new SkillRegistry({
				projectRoot,
				globalRoot: join(tempDir, "global"),
			});
			const index = await registry.discover();
			expect(index.some((s) => s.name === "prisma-workflow")).toBe(true);

			// 4. Activate
			const activeManifest = await registry.activate("prisma-workflow");
			expect(activeManifest.frontmatter.name).toBe("prisma-workflow");
			expect(registry.getActiveSkills()).toHaveLength(1);

			// 5. Tier 2 Context Injection
			const messages = await buildProjectTier(projectRoot, undefined, registry);
			const hasPrismaSkill = messages.some((m) =>
				m.content.some(
					(c) =>
						c.type === "text" && (c.text.includes("prisma-workflow") || c.text.includes("Prisma")),
				),
			);
			expect(hasPrismaSkill).toBe(true);
		});

		it("21. should distill complex multi-tool trajectory with grep, file_read, file_edit, and shell", () => {
			const complexTrajectory: Message[] = [
				{
					role: "user",
					content: [
						{ type: "text", text: "Investigate and fix memory leak in background workers." },
					],
				},
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "c1",
							name: "grep",
							input: { query: "setInterval", path: "src/workers" },
						},
					],
				},
				{
					role: "tool",
					content: [
						{
							type: "tool_result",
							toolUseId: "c1",
							content: "src/workers/queue.ts:15: setInterval(poll, 1000)",
							isError: false,
						},
					],
				},
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "c2",
							name: "read_file",
							input: { path: "src/workers/queue.ts" },
						},
					],
				},
				{
					role: "tool",
					content: [
						{
							type: "tool_result",
							toolUseId: "c2",
							content: "15: setInterval(poll, 1000);\n// Missing clearInterval",
							isError: false,
						},
					],
				},
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "c3",
							name: "file_edit",
							input: { path: "src/workers/queue.ts", edit: "add clearInterval on cleanup" },
						},
					],
				},
				{
					role: "tool",
					content: [
						{
							type: "tool_result",
							toolUseId: "c3",
							content: "Edited src/workers/queue.ts",
							isError: false,
						},
					],
				},
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "c4",
							name: "shell",
							input: { command: "bun test tests/workers.test.ts" },
						},
					],
				},
				{
					role: "tool",
					content: [
						{
							type: "tool_result",
							toolUseId: "c4",
							content: "Pass: 5/5 tests passed.",
							isError: false,
						},
					],
				},
				{
					role: "assistant",
					content: [
						{ type: "text", text: "Fixed memory leak by adding interval cleanup handler." },
					],
				},
			];

			const result = SkillDistiller.distillFromTrajectory({
				name: "memory-leak-fixer",
				description: "Diagnoses and fixes timer memory leaks in worker processes",
				messages: complexTrajectory,
				tags: ["debugging", "memory", "performance"],
			});

			expect(result.valid).toBe(true);
			expect(result.manifest).toBeDefined();
			expect(result.manifest?.instructions).toBeTruthy();
		});

		it("22. should preserve tags in discovered registry index after distillation", async () => {
			const messages = createSampleTrajectory();
			const tags = ["security", "auth", "oauth2"];

			const result = SkillDistiller.distillFromTrajectory({
				name: "oauth2-setup",
				description: "Configures OAuth2 authentication flow",
				messages,
				tags,
			});
			expect(result.valid).toBe(true);

			await SkillDistiller.saveDistilledSkill(result.manifest!, projectSkillsDir);

			const registry = new SkillRegistry({
				projectRoot: join(tempDir, "project"),
				globalRoot: join(tempDir, "global"),
			});
			await registry.discover();

			const skill = await registry.getSkill("oauth2-setup");
			expect(skill).toBeDefined();
			expect(skill?.frontmatter.tags).toEqual(
				expect.arrayContaining(["security", "auth", "oauth2"]),
			);
		});

		it("23. should distinguish project scope from global scope when saving distilled skills", async () => {
			const messages = createSampleTrajectory();

			const projectSkillResult = SkillDistiller.distillFromTrajectory({
				name: "project-distilled-tool",
				description: "Project scoped tool",
				messages,
			});
			const globalSkillResult = SkillDistiller.distillFromTrajectory({
				name: "global-distilled-tool",
				description: "Global scoped tool",
				messages,
			});

			await SkillDistiller.saveDistilledSkill(projectSkillResult.manifest!, projectSkillsDir);
			await SkillDistiller.saveDistilledSkill(globalSkillResult.manifest!, globalSkillsDir);

			const registry = new SkillRegistry({
				projectRoot: join(tempDir, "project"),
				globalRoot: join(tempDir, "global"),
			});
			const index = await registry.discover();

			const projectEntry = index.find((e) => e.name === "project-distilled-tool");
			const globalEntry = index.find((e) => e.name === "global-distilled-tool");

			expect(projectEntry?.scope).toBe("project");
			expect(globalEntry?.scope).toBe("global");
		});

		it("24. should handle large multi-turn trajectory with dozens of messages without memory leak or bloat", () => {
			const largeTrajectory: Message[] = [];
			for (let i = 0; i < 25; i++) {
				largeTrajectory.push({
					role: "user",
					content: [
						{ type: "text", text: `Perform step ${i}: check subsystem health and report status.` },
					],
				});
				largeTrajectory.push({
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: `call_${i}`,
							name: "shell",
							input: { command: `echo "Subsystem ${i} OK"` },
						},
					],
				});
				largeTrajectory.push({
					role: "tool",
					content: [
						{
							type: "tool_result",
							toolUseId: `call_${i}`,
							content: `Subsystem ${i} OK`,
							isError: false,
						},
					],
				});
			}

			const startTime = Date.now();
			const result = SkillDistiller.distillFromTrajectory({
				name: "system-health-check",
				description: "Performs multi-subsystem diagnostic sweep",
				messages: largeTrajectory,
				tags: ["diagnostics", "health"],
			});
			const durationMs = Date.now() - startTime;

			expect(result.valid).toBe(true);
			expect(result.manifest?.instructions).toBeTruthy();
			// Should complete quickly and produce reasonable output size
			expect(durationMs).toBeLessThan(5000);
			expect(result.manifest?.rawContent.length).toBeLessThan(50000);
		});
	});
});
