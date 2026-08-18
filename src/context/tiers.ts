import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Message, ToolDefinition } from "../agent/types.ts";
import type { InjectionScanner } from "./injection-scanner.ts";

export function buildStableTier(config: {
	systemPrompt?: string;
	toolDefinitions?: ToolDefinition[];
}): Message[] {
	const timestamp = new Date().toISOString();

	let content = "You are an AI coding assistant. You have access to tools.\n\n";

	if (config.systemPrompt) {
		content += `${config.systemPrompt}\n\n`;
	}

	content += `Current time: ${timestamp}`;

	return [
		{
			role: "system",
			content: [{ type: "text", text: content }],
		},
	];
}

import { SkillRegistry } from "../skills/registry.ts";

export async function buildProjectTier(
	projectRoot: string,
	scanner?: InjectionScanner,
	skillRegistry?: SkillRegistry,
): Promise<Message[]> {
	const instructionFiles = [
		"AGENTS.md",
		"CLAUDE.md",
		".cursorrules",
		join(".harness", "instructions.md"),
	];

	const messages: Message[] = [];

	for (const file of instructionFiles) {
		const fullPath = join(projectRoot, file);
		if (existsSync(fullPath)) {
			const content = await readFile(fullPath, "utf8");

			if (scanner) {
				const scanResult = scanner.scan(content, fullPath);
				if (!scanResult.isSafe) {
					// Threat detected
				}
			}

			messages.push({
				role: "system",
				content: [{ type: "text", text: `Instructions from ${file}:\n\n${content}` }],
			});
		}
	}

	// Active skills injected into Tier 2 Project context
	const effectiveRegistry = skillRegistry || SkillRegistry.getActiveForProject(projectRoot);
	if (effectiveRegistry) {
		const activeSkills = effectiveRegistry.getActiveSkills();
		for (const skill of activeSkills) {
			messages.push({
				role: "system",
				content: [
					{
						type: "text",
						text: `Skill: ${skill.frontmatter.name}\n\n${skill.instructions}`,
					},
				],
			});
		}
	}

	// Check git status
	try {
		const { execSync } = require("child_process");
		const gitBranch = execSync("git rev-parse --abbrev-ref HEAD", {
			cwd: projectRoot,
			encoding: "utf8",
		}).trim();
		const gitCommit = execSync("git log -1 --format=%h", {
			cwd: projectRoot,
			encoding: "utf8",
		}).trim();
		messages.push({
			role: "system",
			content: [{ type: "text", text: `Git info:\nBranch: ${gitBranch}\nCommit: ${gitCommit}` }],
		});
	} catch (e) {
		// Not a git repo
	}

	return messages;
}

export function buildVolatileTier(config: {
	conversationHistory: Message[];
	memoryFacts?: string[];
}): Message[] {
	const messages: Message[] = [];

	if (config.memoryFacts && config.memoryFacts.length > 0) {
		messages.push({
			role: "system",
			content: [
				{
					type: "text",
					text: `Recalled memory facts:\n${config.memoryFacts.map((f) => `- ${f}`).join("\n")}`,
				},
			],
		});
	}

	messages.push(...config.conversationHistory);

	return messages;
}

export async function assembleContext(config: {
	stableConfig: Parameters<typeof buildStableTier>[0];
	projectRoot: string;
	conversationHistory: Message[];
	memoryFacts?: string[];
	scanner?: InjectionScanner;
	skillRegistry?: SkillRegistry;
}): Promise<Message[]> {
	const stable = buildStableTier(config.stableConfig);
	const project = await buildProjectTier(config.projectRoot, config.scanner, config.skillRegistry);
	const volatile = buildVolatileTier({
		conversationHistory: config.conversationHistory,
		memoryFacts: config.memoryFacts,
	});

	return [...stable, ...project, ...volatile];
}

