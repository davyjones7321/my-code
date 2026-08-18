import type { Command } from "commander";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { SkillRegistry } from "../skills/registry";
import { validateSkillDirectory } from "../skills/validator";

export async function createSkillAction(
	skillName: string,
	options: { projectRoot?: string; globalRoot?: string; scope?: "project" | "global"; force?: boolean; description?: string }
) {
	if (/[A-Z\s!@#$%^&*()+=\[\]{}|\\/:;'"<>,.?~`]/.test(skillName)) {
		throw new Error(`Invalid skill name "${skillName}". Only lowercase letters, numbers, hyphens, and emojis are allowed.`);
	}

	const scope = options.scope || "project";
	let targetDir: string;

	if (scope === "global" && options.globalRoot) {
		targetDir = path.join(options.globalRoot, ".harness", "skills");
	} else if (options.projectRoot) {
		targetDir = path.join(options.projectRoot, ".harness", "skills");
	} else {
		targetDir = path.join(process.cwd(), ".harness", "skills");
	}

	const expectedSkillDir = path.join(targetDir, skillName);

	if (existsSync(expectedSkillDir)) {
		if (!options.force) {
			throw new Error(`Skill directory already exists: ${expectedSkillDir}`);
		}
	} else {
		await fs.mkdir(expectedSkillDir, { recursive: true });
	}

	const description = options.description || "A new skill created via harness skills create";
	const boilerplateSkillMd = `---
name: "${skillName}"
description: "${description}"
version: "1.0.0"
---

# ${skillName}

## Overview
Describe what this skill does.

## Instructions
1. Step 1
2. Step 2
`;
	await fs.writeFile(path.join(expectedSkillDir, "SKILL.md"), boilerplateSkillMd, "utf-8");
	await fs.mkdir(path.join(expectedSkillDir, "scripts"), { recursive: true });
	await fs.mkdir(path.join(expectedSkillDir, "references"), { recursive: true });
	await fs.mkdir(path.join(expectedSkillDir, "assets"), { recursive: true });
}

export function registerSkillsCommands(program: Command, options?: { projectRoot?: string; globalRoot?: string }) {
	const skillsCommand = program.command("skills").description("Manage portable skills");

	skillsCommand
		.command("list")
		.description("List skills")
		.option("--json", "Output JSON")
		.action(async (cmdOpts) => {
			const projectRoot = options?.projectRoot || process.env.HARNESS_PROJECT_ROOT || process.cwd();
			const globalRoot = options?.globalRoot || process.env.HARNESS_GLOBAL_ROOT || path.join(process.env.USERPROFILE || process.env.HOME || "", ".harness");
			
			const registry = new SkillRegistry({ projectRoot, globalRoot });
			const skills = await registry.discover();
			
			if (cmdOpts.json) {
				console.log(JSON.stringify(skills, null, 2));
				return;
			}
			
			if (skills.length === 0) {
				console.log("No skills found.");
				return;
			}
			
			for (const skill of skills) {
				console.log(`- ${skill.name} (${skill.scope}): ${skill.description}`);
			}
		});

	skillsCommand
		.command("show <name>")
		.description("Show skill")
		.option("--json", "Output JSON")
		.action(async (name, cmdOpts) => {
			const projectRoot = options?.projectRoot || process.env.HARNESS_PROJECT_ROOT || process.cwd();
			const globalRoot = options?.globalRoot || process.env.HARNESS_GLOBAL_ROOT || path.join(process.env.USERPROFILE || process.env.HOME || "", ".harness");
			
			const registry = new SkillRegistry({ projectRoot, globalRoot });
			await registry.discover();
			const manifest = await registry.getSkill(name);
			
			if (!manifest) {
				console.error(`Error: Skill not found - ${name}`);
				process.exit(1);
			}
			
			if (cmdOpts.json) {
				console.log(JSON.stringify(manifest, null, 2));
				return;
			}
			
			console.log(`Name: ${manifest.frontmatter.name}`);
			console.log(`Version: ${manifest.frontmatter.version || 'N/A'}`);
			console.log(`Author: ${manifest.frontmatter.author || 'N/A'}`);
			console.log(`\nInstructions:\n${manifest.instructions}`);
		});

	skillsCommand
		.command("create <name>")
		.description("Create skill")
		.option("--global", "Create in global root")
		.option("--force", "Overwrite existing directory")
		.action(async (name, cmdOpts) => {
			const projectRoot = options?.projectRoot || process.env.HARNESS_PROJECT_ROOT || process.cwd();
			const globalRoot = options?.globalRoot || process.env.HARNESS_GLOBAL_ROOT || path.join(process.env.USERPROFILE || process.env.HOME || "", ".harness");
			
			try {
				await createSkillAction(name, {
					projectRoot,
					globalRoot,
					scope: cmdOpts.global ? "global" : "project",
					force: cmdOpts.force,
				});
				console.log(`Successfully created skill: ${name}`);
			} catch (err: any) {
				console.error(`Error creating skill: ${err.message}`);
				process.exit(1);
			}
		});
}
