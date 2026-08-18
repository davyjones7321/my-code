import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	normalizeSkillContent,
	parseSkillMarkdown,
	validateSkillDirectory,
	validateSkillDirectorySync,
} from "../../src/skills/parser";
import type { SkillManifest, SkillValidationResult } from "../../src/skills/types";
import { SkillErrorCodes } from "../../src/skills/types";

describe("Skill Parser & Schema Validation (parser.test.ts)", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-parser-test-"));
	});

	afterEach(async () => {
		try {
			await fs.rm(tmpDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	});

	// =========================================================================
	// Suite 1: normalizeSkillContent
	// =========================================================================
	describe("normalizeSkillContent", () => {
		it("strips UTF-8 BOM and standardizes CRLF and CR to LF", () => {
			const input = "\uFEFFline1\r\nline2\rline3\n";
			const output = normalizeSkillContent(input);
			expect(output).toBe("line1\nline2\nline3\n");
			expect(output.charCodeAt(0)).not.toBe(0xfeff);
		});
	});

	// =========================================================================
	// Suite 2: parseSkillMarkdown
	// =========================================================================
	describe("parseSkillMarkdown", () => {
		// -----------------------------------------------------------------------
		// Tier 1: Primary Happy Paths
		// -----------------------------------------------------------------------
		it("Tier 1: parses valid SKILL.md with full frontmatter metadata and markdown body", () => {
			const content = `---
name: "git-release-manager"
description: "Automates semver tagging and GitHub release generation"
version: "1.2.0"
tags: ["git", "release", "automation"]
triggers: ["/release", "cut release"]
author: "Agent Team"
license: "MIT"
---

# Git Release Manager

## Overview
This skill guides the release workflow.

## Steps
1. Verify git clean status
2. Run test suite
3. Bump version and create git tag
`;

			const result: SkillValidationResult = parseSkillMarkdown(
				content,
				"/mock/path/git-release",
				"project",
			);

			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
			expect(result.manifest).toBeDefined();

			const manifest = result.manifest as SkillManifest;
			expect(manifest.frontmatter.name).toBe("git-release-manager");
			expect(manifest.frontmatter.description).toBe(
				"Automates semver tagging and GitHub release generation",
			);
			expect(manifest.frontmatter.version).toBe("1.2.0");
			expect(manifest.frontmatter.tags).toEqual(["git", "release", "automation"]);
			expect(manifest.frontmatter.triggers).toEqual(["/release", "cut release"]);
			expect(manifest.frontmatter.author).toBe("Agent Team");
			expect(manifest.frontmatter.license).toBe("MIT");
			expect(manifest.instructions).toContain("# Git Release Manager");
			expect(manifest.instructions).toContain("1. Verify git clean status");
			expect(manifest.rawContent).toBe(content);
			expect(manifest.skillDir).toBe("/mock/path/git-release");
			expect(manifest.scope).toBe("project");
		});

		it("Tier 1: parses minimal compliant frontmatter with only required fields (name and description)", () => {
			const content = `---
name: "minimal-skill"
description: "A minimal skill containing only required fields"
---

## Minimal Instructions
Do something simple.
`;

			const result = parseSkillMarkdown(content);

			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
			expect(result.manifest).toBeDefined();
			expect(result.manifest?.frontmatter.name).toBe("minimal-skill");
			expect(result.manifest?.frontmatter.description).toBe(
				"A minimal skill containing only required fields",
			);
			expect(result.manifest?.frontmatter.version).toBeUndefined();
			expect(result.manifest?.instructions).toContain("## Minimal Instructions");
		});

		it("Tier 1: sets scope correctly based on parameter (project vs global)", () => {
			const content = `---
name: "scoped-skill"
description: "Testing scope assignment"
---
Instructions
`;

			const projectResult = parseSkillMarkdown(content, "/path/p", "project");
			expect(projectResult.manifest?.scope).toBe("project");

			const globalResult = parseSkillMarkdown(content, "/path/g", "global");
			expect(globalResult.manifest?.scope).toBe("global");
		});

		// -----------------------------------------------------------------------
		// Tier 2: Boundary Conditions & Encoding Edge Cases
		// -----------------------------------------------------------------------
		it("Tier 2: handles Windows CRLF (\\r\\n) line endings seamlessly", () => {
			const content =
				'---\r\nname: "crlf-skill"\r\ndescription: "Skill with Windows line breaks"\r\nversion: "0.1.0"\r\n---\r\n\r\n# Windows Instructions\r\nLine 1\r\nLine 2\r\n';

			const result = parseSkillMarkdown(content);

			expect(result.valid).toBe(true);
			expect(result.manifest).toBeDefined();
			expect(result.manifest?.frontmatter.name).toBe("crlf-skill");
			expect(result.manifest?.frontmatter.description).toBe("Skill with Windows line breaks");
			expect(result.manifest?.instructions).toContain("Line 1");
			expect(result.manifest?.instructions).toContain("Line 2");
		});

		it("Tier 2: strips UTF-8 Byte Order Mark (BOM) without error", () => {
			const content =
				'\uFEFF---\nname: "bom-skill"\ndescription: "Skill file starting with BOM"\n---\n\nBody content';

			const result = parseSkillMarkdown(content);

			expect(result.valid).toBe(true);
			expect(result.manifest).toBeDefined();
			expect(result.manifest?.frontmatter.name).toBe("bom-skill");
			expect(result.manifest?.instructions).toContain("Body content");
		});

		it("Tier 2: preserves Unicode, multi-language characters, and emojis in frontmatter and body", () => {
			const content = `---
name: "i18n-skill-🚀"
description: "国际化技能 ✨ - Поддержка разных языков & Español"
author: "René François"
tags: ["🚀", "nlp", "multilingual"]
---

# 多语言指南 🌟
1. Привет мир
2. ¡Hola Mundo!
3. こんにちは世界
`;

			const result = parseSkillMarkdown(content);

			expect(result.valid).toBe(true);
			expect(result.manifest?.frontmatter.name).toBe("i18n-skill-🚀");
			expect(result.manifest?.frontmatter.description).toContain("国际化技能 ✨");
			expect(result.manifest?.frontmatter.author).toBe("René François");
			expect(result.manifest?.frontmatter.tags).toContain("🚀");
			expect(result.manifest?.instructions).toContain("こんにちは世界");
		});

		it("Tier 2: handles large markdown bodies (>50KB) with complex markdown and code blocks", () => {
			const largeSection =
				"```typescript\nconst a = 1;\nfunction test() { return a + 2; }\n```\n\n".repeat(800);
			const content = `---
name: "large-skill"
description: "Skill with a very large markdown instruction body"
---

# Large Skill Documentation

${largeSection}

## Final Summary
Done.
`;

			const result = parseSkillMarkdown(content);

			expect(result.valid).toBe(true);
			expect(result.manifest).toBeDefined();
			expect(result.manifest?.instructions.length).toBeGreaterThan(40000);
			expect(result.manifest?.instructions).toContain("Final Summary");
		});

		it("Tier 2: preserves horizontal rules and code blocks containing --- in markdown body", () => {
			const content = `---
name: "hr-skill"
description: "Skill containing horizontal rules in body"
---

# Section 1

---

# Section 2

\`\`\`yaml
---
key: value
---
\`\`\`

---

# Section 3
`;

			const result = parseSkillMarkdown(content);

			expect(result.valid).toBe(true);
			expect(result.manifest).toBeDefined();
			expect(result.manifest?.frontmatter.name).toBe("hr-skill");
			expect(result.manifest?.instructions).toContain("# Section 1");
			expect(result.manifest?.instructions).toContain("# Section 2");
			expect(result.manifest?.instructions).toContain("key: value");
			expect(result.manifest?.instructions).toContain("# Section 3");
		});

		it("Tier 2: handles empty markdown body after frontmatter cleanly", () => {
			const content = `---
name: "no-body-skill"
description: "Frontmatter only without procedural markdown"
---
`;

			const result = parseSkillMarkdown(content);

			expect(result.valid).toBe(true);
			expect(result.manifest).toBeDefined();
			expect(result.manifest?.instructions.trim()).toBe("");
		});

		it("Tier 2: gracefully ignores additional custom metadata fields in YAML", () => {
			const content = `---
name: "custom-meta-skill"
description: "Skill with extra non-standard metadata keys"
customField1: 12345
nestedConfig:
  settingA: true
  settingB: "advanced"
---

Instructions here.
`;

			const result = parseSkillMarkdown(content);

			expect(result.valid).toBe(true);
			expect(result.manifest).toBeDefined();
			expect(result.manifest?.frontmatter.name).toBe("custom-meta-skill");
			expect(result.manifest?.frontmatter.description).toBe(
				"Skill with extra non-standard metadata keys",
			);
		});

		// -----------------------------------------------------------------------
		// Tier 2: Malformed Inputs & Diagnostic Error Handling
		// -----------------------------------------------------------------------
		it("Tier 2: rejects content missing frontmatter delimiters entirely", () => {
			const content = `# Pure Markdown File
There are no YAML frontmatter delimiters in this file.
`;

			const result = parseSkillMarkdown(content);

			expect(result.valid).toBe(false);
			expect(result.errors.length).toBeGreaterThan(0);
			expect(result.manifest).toBeUndefined();
		});

		it("Tier 2: rejects content with unclosed frontmatter block", () => {
			const content = `---
name: "unclosed-skill"
description: "Missing closing delimiter"
# Forgot the second ---
Some markdown body
`;

			const result = parseSkillMarkdown(content);

			expect(result.valid).toBe(false);
			expect(result.errors.length).toBeGreaterThan(0);
		});

		it("Tier 2: rejects malformed YAML syntax with descriptive error", () => {
			const content = `---
name: "broken-yaml"
description: [invalid yaml syntax here: :::
---

Body
`;

			const result = parseSkillMarkdown(content);

			expect(result.valid).toBe(false);
			expect(result.errors.length).toBeGreaterThan(0);
			const yamlErr = result.errors.find(
				(e) =>
					e.code.includes("YAML") ||
					e.message.toLowerCase().includes("yaml") ||
					e.message.toLowerCase().includes("syntax"),
			);
			expect(yamlErr).toBeDefined();
		});

		it("Tier 2: rejects YAML root that is a list instead of key-value mapping", () => {
			const content = `---
- item1
- item2
---

Body
`;

			const result = parseSkillMarkdown(content);

			expect(result.valid).toBe(false);
			expect(result.errors.length).toBeGreaterThan(0);
			expect(result.errors.some((e) => e.code === SkillErrorCodes.INVALID_YAML)).toBe(true);
		});

		it('Tier 2: rejects frontmatter missing required "name" field', () => {
			const content = `---
description: "Missing the name field"
version: "1.0.0"
---

Body
`;

			const result = parseSkillMarkdown(content);

			expect(result.valid).toBe(false);
			expect(result.errors.length).toBeGreaterThan(0);
			const nameErr = result.errors.find(
				(e) => e.code.includes("NAME") || e.message.toLowerCase().includes("name"),
			);
			expect(nameErr).toBeDefined();
		});

		it('Tier 2: rejects frontmatter missing required "description" field', () => {
			const content = `---
name: "missing-desc-skill"
version: "1.0.0"
---

Body
`;

			const result = parseSkillMarkdown(content);

			expect(result.valid).toBe(false);
			expect(result.errors.length).toBeGreaterThan(0);
			const descErr = result.errors.find(
				(e) => e.code.includes("DESC") || e.message.toLowerCase().includes("description"),
			);
			expect(descErr).toBeDefined();
		});

		it('Tier 2: rejects frontmatter with empty or blank "name" or "description"', () => {
			const content1 = `---
name: "   "
description: "Valid description"
---
Body`;

			const res1 = parseSkillMarkdown(content1);
			expect(res1.valid).toBe(false);

			const content2 = `---
name: "valid-name"
description: ""
---
Body`;

			const res2 = parseSkillMarkdown(content2);
			expect(res2.valid).toBe(false);
		});

		it("Tier 2: rejects invalid data types for optional fields (tags, triggers, author, license)", () => {
			const invalidTagsContent = `---
name: "invalid-tags"
description: "Has number in tags"
tags: [123, "valid"]
---
Body`;
			const resTags = parseSkillMarkdown(invalidTagsContent);
			expect(resTags.valid).toBe(false);
			expect(resTags.errors.some((e) => e.code === SkillErrorCodes.INVALID_TAGS)).toBe(true);

			const invalidTriggersContent = `---
name: "invalid-triggers"
description: "Triggers is a string not array"
triggers: "not-an-array"
---
Body`;
			const resTriggers = parseSkillMarkdown(invalidTriggersContent);
			expect(resTriggers.valid).toBe(false);
			expect(resTriggers.errors.some((e) => e.code === SkillErrorCodes.INVALID_TRIGGERS)).toBe(
				true,
			);

			const invalidAuthorContent = `---
name: "invalid-author"
description: "Author is an object"
author: { name: "John" }
---
Body`;
			const resAuthor = parseSkillMarkdown(invalidAuthorContent);
			expect(resAuthor.valid).toBe(false);
			expect(resAuthor.errors.some((e) => e.code === SkillErrorCodes.INVALID_AUTHOR)).toBe(true);

			const invalidLicenseContent = `---
name: "invalid-license"
description: "License is a number"
license: 1234
---
Body`;
			const resLicense = parseSkillMarkdown(invalidLicenseContent);
			expect(resLicense.valid).toBe(false);
			expect(resLicense.errors.some((e) => e.code === SkillErrorCodes.INVALID_LICENSE)).toBe(true);
		});
	});

	// =========================================================================
	// Suite 3: validateSkillDirectory
	// =========================================================================
	describe("validateSkillDirectory", () => {
		// -----------------------------------------------------------------------
		// Tier 1: Directory Layout Happy Paths
		// -----------------------------------------------------------------------
		it("Tier 1: validates full standard directory with SKILL.md, scripts/, references/, and assets/", async () => {
			const skillDir = path.join(tmpDir, "full-skill");
			await fs.mkdir(skillDir, { recursive: true });
			await fs.mkdir(path.join(skillDir, "scripts"), { recursive: true });
			await fs.mkdir(path.join(skillDir, "references"), { recursive: true });
			await fs.mkdir(path.join(skillDir, "assets"), { recursive: true });

			const skillMd = `---
name: "full-skill"
description: "Full agentskills.io package layout"
version: "2.0.0"
tags: ["full", "complete"]
---

# Full Skill
Procedural instructions.
`;
			await fs.writeFile(path.join(skillDir, "SKILL.md"), skillMd, "utf-8");
			await fs.writeFile(
				path.join(skillDir, "scripts", "build.sh"),
				'#!/bin/bash\necho "building"',
				"utf-8",
			);
			await fs.writeFile(
				path.join(skillDir, "references", "cheat-sheet.md"),
				"# Cheatsheet\nDetails",
				"utf-8",
			);
			await fs.writeFile(
				path.join(skillDir, "assets", "template.json"),
				'{"key":"value"}',
				"utf-8",
			);

			const result = await validateSkillDirectory(skillDir, "project");

			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
			expect(result.manifest).toBeDefined();

			const manifest = result.manifest as SkillManifest;
			expect(manifest.frontmatter.name).toBe("full-skill");
			expect(manifest.hasScripts).toBe(true);
			expect(manifest.hasReferences).toBe(true);
			expect(manifest.hasAssets).toBe(true);

			// Check scripts array contains build.sh or scripts/build.sh
			expect(manifest.scripts.some((s: string) => s.includes("build.sh"))).toBe(true);
			expect(manifest.references.some((r: string) => r.includes("cheat-sheet.md"))).toBe(true);
			expect(manifest.assets.some((a: string) => a.includes("template.json"))).toBe(true);
			expect(manifest.skillDir).toBe(skillDir);
			expect(manifest.scope).toBe("project");
		});

		it("Tier 1: validates minimal directory containing only SKILL.md and no subdirectories", async () => {
			const skillDir = path.join(tmpDir, "minimal-dir-skill");
			await fs.mkdir(skillDir, { recursive: true });

			const skillMd = `---
name: "minimal-dir-skill"
description: "Minimal directory with only SKILL.md"
---

# Minimal
Simple procedure.
`;
			await fs.writeFile(path.join(skillDir, "SKILL.md"), skillMd, "utf-8");

			const result = await validateSkillDirectory(skillDir, "global");

			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
			expect(result.manifest).toBeDefined();

			const manifest = result.manifest as SkillManifest;
			expect(manifest.frontmatter.name).toBe("minimal-dir-skill");
			expect(manifest.hasScripts).toBe(false);
			expect(manifest.hasReferences).toBe(false);
			expect(manifest.hasAssets).toBe(false);
			expect(manifest.scripts).toEqual([]);
			expect(manifest.references).toEqual([]);
			expect(manifest.assets).toEqual([]);
			expect(manifest.scope).toBe("global");
		});

		// -----------------------------------------------------------------------
		// Tier 2: Directory Errors & Edge Cases
		// -----------------------------------------------------------------------
		it("Tier 2: returns error when directory does not exist", async () => {
			const nonExistentPath = path.join(tmpDir, "non-existent-directory-xyz");

			const result = await validateSkillDirectory(nonExistentPath);

			expect(result.valid).toBe(false);
			expect(result.errors.length).toBeGreaterThan(0);
			expect(result.manifest).toBeUndefined();
			const notFoundErr = result.errors.find(
				(e) =>
					e.code.includes("NOT_FOUND") ||
					e.code.includes("MISSING") ||
					e.message.toLowerCase().includes("not found") ||
					e.message.toLowerCase().includes("directory"),
			);
			expect(notFoundErr).toBeDefined();
		});

		it("Tier 2: returns error when skill path is a file instead of a directory", async () => {
			const filePath = path.join(tmpDir, "not-a-dir.txt");
			await fs.writeFile(filePath, "just a file", "utf-8");

			const result = await validateSkillDirectory(filePath);

			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.code === SkillErrorCodes.NOT_A_DIRECTORY)).toBe(true);
		});

		it("Tier 2: returns error when directory exists but lacks SKILL.md", async () => {
			const skillDir = path.join(tmpDir, "missing-skill-md");
			await fs.mkdir(skillDir, { recursive: true });
			await fs.mkdir(path.join(skillDir, "scripts"), { recursive: true });
			await fs.writeFile(path.join(skillDir, "scripts", "test.sh"), "echo test", "utf-8");

			const result = await validateSkillDirectory(skillDir);

			expect(result.valid).toBe(false);
			expect(result.errors.length).toBeGreaterThan(0);
			const skillMdErr = result.errors.find(
				(e) =>
					e.code.includes("SKILL") ||
					e.code.includes("FILE") ||
					e.message.toLowerCase().includes("skill.md"),
			);
			expect(skillMdErr).toBeDefined();
		});

		it("Tier 2: returns error when SKILL.md is a directory instead of a regular file", async () => {
			const skillDir = path.join(tmpDir, "skill-md-is-dir");
			await fs.mkdir(skillDir, { recursive: true });
			await fs.mkdir(path.join(skillDir, "SKILL.md"), { recursive: true });

			const result = await validateSkillDirectory(skillDir);

			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.code === SkillErrorCodes.INVALID_SUBDIRECTORY)).toBe(true);
		});

		it("Tier 2: returns error when scripts/ or references/ is a regular file instead of a directory", async () => {
			const skillDir = path.join(tmpDir, "scripts-is-file");
			await fs.mkdir(skillDir, { recursive: true });
			await fs.writeFile(
				path.join(skillDir, "SKILL.md"),
				'---\nname: "test"\ndescription: "desc"\n---\nBody',
				"utf-8",
			);
			await fs.writeFile(path.join(skillDir, "scripts"), "not a directory", "utf-8");

			const result = await validateSkillDirectory(skillDir);

			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.code === SkillErrorCodes.INVALID_SUBDIRECTORY)).toBe(true);
		});

		it("Tier 2: returns error when directory contains corrupted SKILL.md", async () => {
			const skillDir = path.join(tmpDir, "corrupted-skill");
			await fs.mkdir(skillDir, { recursive: true });
			await fs.writeFile(path.join(skillDir, "SKILL.md"), "not a valid frontmatter", "utf-8");

			const result = await validateSkillDirectory(skillDir);

			expect(result.valid).toBe(false);
			expect(result.errors.length).toBeGreaterThan(0);
			expect(result.manifest).toBeUndefined();
		});

		// -----------------------------------------------------------------------
		// Tier 3: Advanced Structure & Nested Assets
		// -----------------------------------------------------------------------
		it("Tier 3: handles empty subdirectories (scripts/, references/, assets/) without false positives", async () => {
			const skillDir = path.join(tmpDir, "empty-subdirs");
			await fs.mkdir(skillDir, { recursive: true });
			await fs.mkdir(path.join(skillDir, "scripts"), { recursive: true });
			await fs.mkdir(path.join(skillDir, "references"), { recursive: true });
			await fs.mkdir(path.join(skillDir, "assets"), { recursive: true });

			const skillMd = `---
name: "empty-subdirs-skill"
description: "Skill with empty optional folders"
---

# Empty Folders
`;
			await fs.writeFile(path.join(skillDir, "SKILL.md"), skillMd, "utf-8");

			const result = await validateSkillDirectory(skillDir);

			expect(result.valid).toBe(true);
			expect(result.manifest).toBeDefined();
			expect(result.manifest?.hasScripts).toBe(false);
			expect(result.manifest?.scripts).toHaveLength(0);
		});

		it("Tier 3: discovers nested files inside references/ and scripts/ directories", async () => {
			const skillDir = path.join(tmpDir, "nested-files-skill");
			await fs.mkdir(skillDir, { recursive: true });
			await fs.mkdir(path.join(skillDir, "references", "docs", "guides"), { recursive: true });
			await fs.mkdir(path.join(skillDir, "scripts", "helpers"), { recursive: true });

			const skillMd = `---
name: "nested-skill"
description: "Skill with nested reference guides"
---

Instructions.
`;
			await fs.writeFile(path.join(skillDir, "SKILL.md"), skillMd, "utf-8");
			await fs.writeFile(
				path.join(skillDir, "references", "docs", "guides", "deep-guide.md"),
				"# Deep Guide",
				"utf-8",
			);
			await fs.writeFile(
				path.join(skillDir, "scripts", "helpers", "util.py"),
				'print("util")',
				"utf-8",
			);

			const result = await validateSkillDirectory(skillDir);

			expect(result.valid).toBe(true);
			expect(result.manifest?.hasReferences).toBe(true);
			expect(result.manifest?.hasScripts).toBe(true);
			expect(result.manifest?.references.some((r) => r.includes("deep-guide.md"))).toBe(true);
			expect(result.manifest?.scripts.some((s) => s.includes("util.py"))).toBe(true);
		});

		it("Tier 3: validateSkillDirectorySync works synchronously and returns identical results", () => {
			const skillDir = path.join(tmpDir, "sync-skill");
			require("node:fs").mkdirSync(skillDir, { recursive: true });
			require("node:fs").mkdirSync(path.join(skillDir, "scripts"), { recursive: true });
			require("node:fs").writeFileSync(
				path.join(skillDir, "SKILL.md"),
				'---\nname: "sync-skill"\ndescription: "Synchronous skill validation"\n---\n# Body',
				"utf-8",
			);
			require("node:fs").writeFileSync(
				path.join(skillDir, "scripts", "run.sh"),
				'echo "run"',
				"utf-8",
			);

			const result = validateSkillDirectorySync(skillDir, "project");

			expect(result.valid).toBe(true);
			expect(result.manifest).toBeDefined();
			expect(result.manifest?.frontmatter.name).toBe("sync-skill");
			expect(result.manifest?.hasScripts).toBe(true);
			expect(result.manifest?.scripts.some((s) => s.includes("run.sh"))).toBe(true);
		});
	});
});
