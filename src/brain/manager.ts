import * as fs from "node:fs";
import * as path from "node:path";
import { getConfigDir } from "../config/index.ts";

export interface BrainRule {
	id: string;
	category?: string;
	rule: string;
	timestamp: number;
}

export class BrainManager {
	private globalBrainDir: string;
	private projectBrainDir: string;

	constructor(private projectRoot: string = process.cwd()) {
		this.globalBrainDir = path.join(getConfigDir(), "brain");
		this.projectBrainDir = path.join(projectRoot, ".harness", "brain");
		this.ensureDirectories();
	}

	private ensureDirectories(): void {
		if (!fs.existsSync(this.globalBrainDir)) {
			fs.mkdirSync(this.globalBrainDir, { recursive: true });
		}
		if (!fs.existsSync(this.projectBrainDir)) {
			fs.mkdirSync(this.projectBrainDir, { recursive: true });
		}
	}

	/** Get path to learnings.md (prefers local project over global) */
	public getLearningsPath(): string {
		const projectPath = path.join(this.projectBrainDir, "learnings.md");
		if (fs.existsSync(projectPath)) {
			return projectPath;
		}
		return path.join(this.globalBrainDir, "learnings.md");
	}

	/** Add a new rule/lesson to learnings.md */
	public addLearning(ruleText: string, category: string = "general", isProjectLocal: boolean = false): BrainRule {
		const targetDir = isProjectLocal ? this.projectBrainDir : this.globalBrainDir;
		if (!fs.existsSync(targetDir)) {
			fs.mkdirSync(targetDir, { recursive: true });
		}

		const filePath = path.join(targetDir, "learnings.md");
		const id = `rule-${Date.now().toString(36)}`;
		const timestamp = Date.now();
		const dateStr = new Date().toISOString().split("T")[0];

		const ruleLine = `- [${category}] ${ruleText.trim()} <!-- ${id} | ${dateStr} -->\n`;

		if (!fs.existsSync(filePath)) {
			const header = `# Agentic Brain Learnings & Rules\n\n## Learned Rules\n`;
			fs.writeFileSync(filePath, header + ruleLine, "utf8");
		} else {
			fs.appendFileSync(filePath, ruleLine, "utf8");
		}

		return {
			id,
			category,
			rule: ruleText.trim(),
			timestamp,
		};
	}

	/** Get all active rules from global and project learnings.md */
	public getLearnings(): string[] {
		const rules: string[] = [];

		const pathsToRead = [
			path.join(this.globalBrainDir, "learnings.md"),
			path.join(this.projectBrainDir, "learnings.md"),
		];

		for (const p of pathsToRead) {
			if (fs.existsSync(p)) {
				try {
					const content = fs.readFileSync(p, "utf8");
					const lines = content.split("\n");
					for (const line of lines) {
						const trimmed = line.trim();
						if (trimmed.startsWith("- ")) {
							rules.push(trimmed.slice(2).replace(/<!--.*-->/, "").trim());
						}
					}
				} catch {
					// Ignore unreadable files
				}
			}
		}

		return [...new Set(rules)];
	}

	/** Generate prompt section containing active brain rules */
	public getPromptSection(): string {
		const rules = this.getLearnings();
		if (rules.length === 0) {
			return "";
		}

		let section = "\n\n## AGENTIC BRAIN - LEARNED RULES & EXPERIENCE:\n";
		rules.slice(-15).forEach((rule) => {
			section += `- ${rule}\n`;
		});

		return section;
	}
}
