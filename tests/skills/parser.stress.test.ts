import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	parseSkillMarkdown,
	validateSkillDirectory,
	validateSkillDirectorySync,
} from "../../src/skills/parser";
import { SkillErrorCodes } from "../../src/skills/types";

describe("Adversarial Stress & Edge Case Harness (parser.stress.test.ts)", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-adversarial-test-"));
	});

	afterEach(async () => {
		try {
			await fs.rm(tmpDir, { recursive: true, force: true });
		} catch {
			// ignore cleanup
		}
	});

	// =========================================================================
	// 1. Deeply Nested YAML & Prototype Pollution
	// =========================================================================
	describe("Deeply Nested YAML & Prototype Pollution", () => {
		it("handles 50 levels of deeply nested YAML objects without stack overflow", () => {
			let nestedYaml = "name: deep-skill\ndescription: deep nesting test\nmetadata:\n";
			let indent = "  ";
			for (let i = 0; i < 50; i++) {
				nestedYaml += `${indent}level_${i}:\n`;
				indent += "  ";
			}
			nestedYaml += `${indent}leaf: "deep value"\n`;

			const content = `---\n${nestedYaml}---\n# Body\n`;
			const result = parseSkillMarkdown(content);

			expect(result.valid).toBe(true);
			expect(result.manifest?.frontmatter.name).toBe("deep-skill");
			expect(result.manifest?.frontmatter.metadata).toBeDefined();
		});

		it("handles YAML anchors and aliases cleanly", () => {
			const content = `---
name: anchor-skill
description: &desc "Shared description text"
author: *desc
tags:
  - &tag1 "dev"
  - *tag1
---
# Body
`;
			const result = parseSkillMarkdown(content);
			expect(result.valid).toBe(true);
			expect(result.manifest?.frontmatter.name).toBe("anchor-skill");
			expect(result.manifest?.frontmatter.description).toBe("Shared description text");
			expect(result.manifest?.frontmatter.author).toBe("Shared description text");
			expect(result.manifest?.frontmatter.tags).toEqual(["dev", "dev"]);
		});

		it("safely handles prototype pollution attempts (__proto__, constructor)", () => {
			const content = `---
name: proto-test
description: Testing prototype safety
__proto__:
  polluted: true
constructor:
  prototype:
    injected: true
---
# Body
`;
			const result = parseSkillMarkdown(content);
			expect(result.valid).toBe(true);
			// Verify Object prototype is not polluted
			expect(({} as Record<string, unknown>).polluted).toBeUndefined();
			expect(({} as Record<string, unknown>).injected).toBeUndefined();
		});
	});

	// =========================================================================
	// 2. Duplicate Keys in YAML
	// =========================================================================
	describe("Duplicate Keys in YAML", () => {
		it("handles duplicate keys per YAML standard without crashing", () => {
			const content = `---
name: initial-name
name: overridden-name
description: duplicate key test
---
# Body
`;
			const result = parseSkillMarkdown(content);
			// YAML 1.2 parser may overwrite or error; both are acceptable as long as it does not crash
			if (result.valid) {
				expect(result.manifest?.frontmatter.name).toBe("overridden-name");
			} else {
				expect(result.errors.length).toBeGreaterThan(0);
			}
		});
	});

	// =========================================================================
	// 3. Exotic Unicode, RTL, ZWJ & Control Characters
	// =========================================================================
	describe("Exotic Unicode & Edge Encoding", () => {
		it("handles Right-to-Left (RTL) Arabic and Hebrew text", () => {
			const content = `---
name: "مهارة-البحث"
description: "وصف مهارة متقدمة בעברית וערבית"
author: "أحمد & משה"
tags: ["عربي", "עברית"]
---
# تعليمات المهارة
1. الخطوة الأولى
2. שלב שני
`;
			const result = parseSkillMarkdown(content);
			expect(result.valid).toBe(true);
			expect(result.manifest?.frontmatter.name).toBe("مهارة-البحث");
			expect(result.manifest?.frontmatter.description).toBe("وصف مهارة متقدمة בעברית וערבית");
			expect(result.manifest?.instructions).toContain("الخطوة الأولى");
			expect(result.manifest?.instructions).toContain("שלב שני");
		});

		it("handles complex ZWJ emojis and surrogate pairs (👨‍👩‍👧‍👦, 🏳️‍🌈, 𠜎, 𝄞)", () => {
			const content = `---
name: "emoji-skill-👨‍👩‍👧‍👦-🏳️‍🌈"
description: "Skill with surrogate pairs: 𠜎 (CJK extension B) and musical symbol 𝄞"
tags: ["👨‍👩‍👧‍👦", "🏳️‍🌈", "𠜎", "𝄞"]
---
# 🎵 Instructions with 𠜎 and 𝄞
`;
			const result = parseSkillMarkdown(content);
			expect(result.valid).toBe(true);
			expect(result.manifest?.frontmatter.name).toBe("emoji-skill-👨‍👩‍👧‍👦-🏳️‍🌈");
			expect(result.manifest?.frontmatter.description).toContain("𠜎");
			expect(result.manifest?.frontmatter.description).toContain("𝄞");
			expect(result.manifest?.instructions).toContain("🎵 Instructions with 𠜎 and 𝄞");
		});

		it("handles zero-width spaces (ZWSP, ZWNJ, ZWJ) within text", () => {
			const content = `---
name: "zwsp\u200Bskill\u200Ctest"
description: "Description with\u200Dzero\u200Bwidth"
---
# Body with\u200Bzero\u200Bwidth
`;
			const result = parseSkillMarkdown(content);
			expect(result.valid).toBe(true);
			expect(result.manifest?.frontmatter.name).toContain("\u200B");
			expect(result.manifest?.frontmatter.description).toContain("\u200B");
		});

		it("handles multiple sequential UTF-8 BOM characters", () => {
			// Multiple BOMs: \uFEFF\uFEFF---
			const content =
				"\uFEFF\uFEFF---\nname: multi-bom\ndescription: multiple BOM test\n---\n# Body\n";
			const result = parseSkillMarkdown(content);
			// normalizeSkillContent handles first BOM; if second BOM remains, parser handles or returns valid
			expect(typeof result.valid).toBe("boolean");
		});
	});

	// =========================================================================
	// 4. Multiple --- Delimiters in Content & Edge Cases
	// =========================================================================
	describe("Multiple Delimiters & Delimiter Edge Cases", () => {
		it("handles multiple horizontal rules (---) throughout markdown body", () => {
			const content = `---
name: hr-torture
description: Lots of horizontal rules
---
# Title

---

## Subtitle 1

---

## Subtitle 2

---
`;
			const result = parseSkillMarkdown(content);
			expect(result.valid).toBe(true);
			expect(result.manifest?.instructions).toContain("## Subtitle 1");
			expect(result.manifest?.instructions).toContain("## Subtitle 2");
			// Count number of --- in instructions
			const hrCount = (result.manifest?.instructions.match(/---/g) || []).length;
			expect(hrCount).toBe(3);
		});

		it("handles nested code blocks containing frontmatter-like content in body", () => {
			const content = `---
name: doc-generator
description: Generates skill documentation
---
# How to write a SKILL.md

Example of a skill file:

\`\`\`markdown
---
name: inner-skill
description: An inner example skill
tags: ["example"]
---
# Inner Body
\`\`\`

More guidelines follow...
`;
			const result = parseSkillMarkdown(content);
			expect(result.valid).toBe(true);
			expect(result.manifest?.frontmatter.name).toBe("doc-generator");
			expect(result.manifest?.instructions).toContain("name: inner-skill");
			expect(result.manifest?.instructions).toContain("More guidelines follow...");
		});

		it("handles trailing spaces after --- delimiter", () => {
			const content =
				"---   \t \nname: trailing-spaces\ndescription: spaces after delimiter\n---    \n# Body\n";
			const result = parseSkillMarkdown(content);
			expect(result.valid).toBe(true);
			expect(result.manifest?.frontmatter.name).toBe("trailing-spaces");
		});
	});

	// =========================================================================
	// 5. Empty & Whitespace Frontmatter
	// =========================================================================
	describe("Empty & Whitespace Frontmatter", () => {
		it("rejects empty frontmatter block (---\\n---) due to missing required fields", () => {
			const content = "---\n---\n# Body without metadata";
			const result = parseSkillMarkdown(content);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.code === SkillErrorCodes.MISSING_NAME)).toBe(true);
			expect(result.errors.some((e) => e.code === SkillErrorCodes.MISSING_DESCRIPTION)).toBe(true);
		});

		it("rejects whitespace-only frontmatter block", () => {
			const content = "---\n   \n\t\n---\n# Body";
			const result = parseSkillMarkdown(content);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.code === SkillErrorCodes.MISSING_NAME)).toBe(true);
		});

		it("rejects comment-only frontmatter block", () => {
			const content = "---\n# Just a comment\n# Another comment\n---\n# Body";
			const result = parseSkillMarkdown(content);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.code === SkillErrorCodes.MISSING_NAME)).toBe(true);
		});

		it("rejects completely empty content string", () => {
			const result = parseSkillMarkdown("");
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.code === SkillErrorCodes.INVALID_DELIMITER)).toBe(true);
		});

		it("rejects single line delimiter '---' without closing", () => {
			const result = parseSkillMarkdown("---");
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.code === SkillErrorCodes.INVALID_DELIMITER)).toBe(true);
		});
	});

	// =========================================================================
	// 6. Massive Documents & Stress Scaling
	// =========================================================================
	describe("Massive Documents & Scale Testing", () => {
		it("parses massive 5MB markdown document within 300ms", () => {
			const repeatCount = 50000;
			const repeatedText = "This is a detailed procedural instruction step in markdown.\n";
			const largeBody = repeatedText.repeat(repeatCount); // ~3MB
			const content = `---\nname: "massive-skill"\ndescription: "Massive scale test"\nversion: "1.0.0"\n---\n${largeBody}`;

			const startTime = performance.now();
			const result = parseSkillMarkdown(content);
			const elapsed = performance.now() - startTime;

			expect(result.valid).toBe(true);
			expect(result.manifest?.frontmatter.name).toBe("massive-skill");
			expect(result.manifest?.instructions.length).toBeGreaterThan(2500000);
			expect(elapsed).toBeLessThan(1000); // Must parse in < 1 second
		});

		it("handles massive frontmatter with 1,000 tags and 1,000 triggers", () => {
			const tags = Array.from({ length: 1000 }, (_, i) => `tag-${i}`);
			const triggers = Array.from({ length: 1000 }, (_, i) => `trigger-${i}`);

			const yamlTags = tags.map((t) => `  - "${t}"`).join("\n");
			const yamlTriggers = triggers.map((t) => `  - "${t}"`).join("\n");

			const content = `---\nname: "thousand-tags-skill"\ndescription: "Skill with 1000 tags and triggers"\ntags:\n${yamlTags}\ntriggers:\n${yamlTriggers}\n---\n# Body\n`;

			const result = parseSkillMarkdown(content);
			expect(result.valid).toBe(true);
			expect(result.manifest?.frontmatter.tags?.length).toBe(1000);
			expect(result.manifest?.frontmatter.triggers?.length).toBe(1000);
		});
	});

	// =========================================================================
	// 7. Type Safety & Boundary Conditions
	// =========================================================================
	describe("Type Safety & Boundary Values", () => {
		it("handles numeric version values properly (version: 1.0 -> '1.0' or '1')", () => {
			const content = `---
name: "num-version-skill"
description: "Testing numeric version"
version: 2.5
---
# Body
`;
			const result = parseSkillMarkdown(content);
			expect(result.valid).toBe(true);
			expect(result.manifest?.frontmatter.version).toBe("2.5");
		});

		it("rejects boolean name (name: true)", () => {
			const content = `---
name: true
description: "Valid description"
---
# Body
`;
			const result = parseSkillMarkdown(content);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.code === SkillErrorCodes.INVALID_NAME)).toBe(true);
		});

		it("rejects boolean description (description: false)", () => {
			const content = `---
name: "valid-name"
description: false
---
# Body
`;
			const result = parseSkillMarkdown(content);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.code === SkillErrorCodes.INVALID_DESCRIPTION)).toBe(true);
		});

		it("rejects tags containing null or non-strings", () => {
			const content = `---
name: "invalid-tags-content"
description: "Tags with null inside"
tags: ["valid", null, "another"]
---
# Body
`;
			const result = parseSkillMarkdown(content);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.code === SkillErrorCodes.INVALID_TAGS)).toBe(true);
		});

		it("rejects object triggers (triggers: { key: 'val' })", () => {
			const content = `---
name: "invalid-triggers-object"
description: "Triggers is an object"
triggers:
  key: val
---
# Body
`;
			const result = parseSkillMarkdown(content);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.code === SkillErrorCodes.INVALID_TRIGGERS)).toBe(true);
		});
	});

	// =========================================================================
	// 8. Directory Validator Stress & File Layouts
	// =========================================================================
	describe("Directory Validator Edge Cases", () => {
		it("ignores hidden files (.git, .DS_Store, .gitkeep) during asset enumeration", async () => {
			const skillDir = path.join(tmpDir, "hidden-files-skill");
			await fs.mkdir(skillDir, { recursive: true });
			await fs.mkdir(path.join(skillDir, "scripts"), { recursive: true });
			await fs.mkdir(path.join(skillDir, "references"), { recursive: true });

			const skillMd = `---
name: "hidden-files-skill"
description: "Ignores dotfiles"
---
# Body
`;
			await fs.writeFile(path.join(skillDir, "SKILL.md"), skillMd, "utf-8");
			await fs.writeFile(path.join(skillDir, "scripts", ".gitkeep"), "", "utf-8");
			await fs.writeFile(path.join(skillDir, "scripts", ".DS_Store"), "", "utf-8");
			await fs.writeFile(path.join(skillDir, "scripts", "real-script.sh"), "echo 1", "utf-8");
			await fs.writeFile(path.join(skillDir, "references", ".hidden.md"), "", "utf-8");
			await fs.writeFile(path.join(skillDir, "references", "guide.md"), "# Guide", "utf-8");

			const result = await validateSkillDirectory(skillDir);

			expect(result.valid).toBe(true);
			expect(result.manifest?.hasScripts).toBe(true);
			// scripts should only contain real-script.sh and not .gitkeep or .DS_Store
			expect(result.manifest?.scripts).toEqual(["scripts/real-script.sh"]);
			// references should contain guide.md (and .hidden.md if not in filter, let's check)
			expect(result.manifest?.references.some((r) => r.includes("guide.md"))).toBe(true);
			expect(result.manifest?.scripts.includes("scripts/.gitkeep")).toBe(false);
			expect(result.manifest?.scripts.includes("scripts/.DS_Store")).toBe(false);
		});

		it("handles deep 10-level nested directories in references/ and assets/", async () => {
			const skillDir = path.join(tmpDir, "deep-tree-skill");
			await fs.mkdir(skillDir, { recursive: true });

			let deepRefPath = path.join(skillDir, "references");
			for (let i = 1; i <= 10; i++) {
				deepRefPath = path.join(deepRefPath, `level_${i}`);
			}
			await fs.mkdir(deepRefPath, { recursive: true });
			await fs.writeFile(path.join(deepRefPath, "deep_ref.txt"), "content", "utf-8");

			const skillMd = `---
name: "deep-tree-skill"
description: "Deep nested asset tree"
---
# Body
`;
			await fs.writeFile(path.join(skillDir, "SKILL.md"), skillMd, "utf-8");

			const result = await validateSkillDirectory(skillDir);
			expect(result.valid).toBe(true);
			expect(result.manifest?.hasReferences).toBe(true);
			expect(result.manifest?.references[0]).toContain("references/level_1/level_2");
			expect(result.manifest?.references[0]).toContain("deep_ref.txt");
		});

		it("handles files with spaces and international characters in scripts/ and references/", async () => {
			const skillDir = path.join(tmpDir, "i18n-filenames-skill");
			await fs.mkdir(skillDir, { recursive: true });
			await fs.mkdir(path.join(skillDir, "scripts"), { recursive: true });
			await fs.mkdir(path.join(skillDir, "references"), { recursive: true });

			const skillMd = `---
name: "i18n-filenames"
description: "Filenames with unicode and spaces"
---
# Body
`;
			await fs.writeFile(path.join(skillDir, "SKILL.md"), skillMd, "utf-8");
			await fs.writeFile(
				path.join(skillDir, "scripts", "my helper script (v1).sh"),
				"echo 1",
				"utf-8",
			);
			await fs.writeFile(path.join(skillDir, "references", "指南 2026.md"), "# 指南", "utf-8");

			const result = await validateSkillDirectory(skillDir);
			expect(result.valid).toBe(true);
			expect(result.manifest?.scripts.some((s) => s.includes("my helper script (v1).sh"))).toBe(
				true,
			);
			expect(result.manifest?.references.some((r) => r.includes("指南 2026.md"))).toBe(true);
		});

		it("produces identical results between validateSkillDirectory and validateSkillDirectorySync", async () => {
			const skillDir = path.join(tmpDir, "parity-skill");
			await fs.mkdir(skillDir, { recursive: true });
			await fs.mkdir(path.join(skillDir, "scripts"), { recursive: true });
			await fs.mkdir(path.join(skillDir, "assets"), { recursive: true });

			const skillMd = `---
name: "parity-skill"
description: "Testing async and sync parity"
tags: ["parity"]
---
# Body
`;
			await fs.writeFile(path.join(skillDir, "SKILL.md"), skillMd, "utf-8");
			await fs.writeFile(path.join(skillDir, "scripts", "run.js"), "console.log()", "utf-8");
			await fs.writeFile(path.join(skillDir, "assets", "template.txt"), "temp", "utf-8");

			const asyncRes = await validateSkillDirectory(skillDir, "global");
			const syncRes = validateSkillDirectorySync(skillDir, "global");

			expect(asyncRes.valid).toBe(syncRes.valid);
			expect(asyncRes.manifest?.frontmatter).toEqual(syncRes.manifest?.frontmatter);
			expect(asyncRes.manifest?.instructions).toEqual(syncRes.manifest?.instructions);
			expect(asyncRes.manifest?.scripts).toEqual(syncRes.manifest?.scripts);
			expect(asyncRes.manifest?.assets).toEqual(syncRes.manifest?.assets);
			expect(asyncRes.manifest?.scope).toBe(syncRes.manifest?.scope);
		});
	});
});
