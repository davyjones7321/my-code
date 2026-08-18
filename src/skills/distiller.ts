import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Message } from "../agent/types.ts";
import { parseSkillMarkdown } from "./parser.ts";
import type { SkillManifest, SkillValidationResult } from "./types.ts";

export interface DistillOptions {
	name: string;
	description: string;
	messages: Message[];
	tags?: string[];
	author?: string;
	triggers?: string[];
	version?: string;
}

export class SkillDistiller {
	/**
	 * Distills a valid SkillManifest from a multi-turn conversation trajectory.
	 */
	static distillFromTrajectory(options: DistillOptions): SkillValidationResult {
		const name = options.name ? options.name.trim() : "";
		const description = options.description ? options.description.trim() : "";

		const errors: Array<{ code: string; message: string }> = [];

		if (!name) {
			errors.push({
				code: "ERR_SKILL_MISSING_NAME",
				message: "Skill name is required and cannot be empty",
			});
		} else if (/[A-Z\s!@#$%^&*()+=\[\]{}|\\/:;'"<>,.?~`]/.test(name)) {
			errors.push({
				code: "ERR_SKILL_INVALID_NAME",
				message: `Skill name "${name}" contains invalid characters or uppercase letters.`,
			});
		}

		if (!description) {
			errors.push({
				code: "ERR_SKILL_MISSING_DESCRIPTION",
				message: "Skill description is required and cannot be empty",
			});
		}

		if (errors.length > 0) {
			return {
				valid: false,
				errors,
			};
		}

		// Extract procedural actions from messages
		const steps: string[] = [];
		let userGoal = "";

		for (const msg of options.messages || []) {
			if (msg.role === "user") {
				for (const block of msg.content) {
					if (block.type === "text" && !userGoal) {
						userGoal = block.text.trim();
					}
				}
			} else if (msg.role === "assistant") {
				for (const block of msg.content) {
					if (block.type === "tool_use") {
						const inputSummary = Object.entries(block.input || {})
							.map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
							.join(", ");
						steps.push(`Execute \`${block.name}\` with parameter(s): ${inputSummary || "none"}`);
					} else if (block.type === "text" && block.text.trim().length > 0) {
						const firstLine = block.text.split("\n")[0].trim();
						if (firstLine.length > 10 && !steps.includes(firstLine)) {
							steps.push(firstLine);
						}
					}
				}
			}
		}

		if (steps.length === 0) {
			steps.push("Step 1. Inspect environment and requirements");
			steps.push("Step 2. Execute necessary tasks and verify outcome");
		}

		const version = options.version || "1.0.0";
		const author = options.author || "autonomous-distiller";
		const tags = options.tags || ["distilled", "workflow"];
		const triggers = options.triggers || [`/${name}`, name.replace(/-/g, " ")];

		const formatYamlString = (val: string): string => {
			if (/^[a-zA-Z0-9\s._-]+$/.test(val) && !val.includes(":") && !val.includes("#") && !val.includes('"') && !val.includes("'")) {
				return val;
			}
			return JSON.stringify(val);
		};

		let frontmatterYaml = `name: ${formatYamlString(name)}\ndescription: ${formatYamlString(description)}\nversion: ${formatYamlString(version)}\nauthor: ${formatYamlString(author)}\ntags:\n${tags.map((t) => `  - ${formatYamlString(t)}`).join("\n")}\ntriggers:\n${triggers.map((t) => `  - ${formatYamlString(t)}`).join("\n")}`;

		let instructionsMarkdown = `# ${name}\n\n## Overview\n${description}\n\n## Instructions\n`;
		steps.forEach((step, idx) => {
			instructionsMarkdown += `${idx + 1}. ${step}\n`;
		});

		const rawContent = `---\n${frontmatterYaml}\n---\n\n${instructionsMarkdown}\n`;

		return parseSkillMarkdown(rawContent, undefined, "project");
	}

	/**
	 * Saves a distilled skill manifest to disk in agentskills.io layout.
	 */
	static async saveDistilledSkill(manifest: SkillManifest, targetDirectory: string): Promise<string> {
		const skillName = manifest.frontmatter.name;
		const skillDir = path.join(targetDirectory, skillName);

		await fs.mkdir(skillDir, { recursive: true });
		await fs.writeFile(path.join(skillDir, "SKILL.md"), manifest.rawContent, "utf-8");
		await fs.mkdir(path.join(skillDir, "scripts"), { recursive: true });
		await fs.mkdir(path.join(skillDir, "references"), { recursive: true });
		await fs.mkdir(path.join(skillDir, "assets"), { recursive: true });

		return skillDir;
	}
}
