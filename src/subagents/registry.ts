import type { SubagentDefinition } from "./types.ts";

/**
 * Default built-in subagent definitions
 */
export const BUILTIN_SUBAGENT_DEFINITIONS: Record<string, SubagentDefinition> = {
	research: {
		name: "research",
		description: "Specialized read-only research agent for deep codebase exploration, file reading, structural analysis, and fact finding.",
		systemPrompt: `You are a specialized Research Subagent.
Your mission is to explore, analyze, and synthesize facts from the project without modifying any files.
Rely only on verified evidence from reading files, searching patterns, and recalling memory.
Return your findings with exact file paths, line references, and structured summaries.`,
		allowedTools: [
			"read_file",
			"glob_files",
			"grep_search",
			"recall_facts",
			"get_diagnostics",
			"get_definition",
			"find_references",
		],
		disallowedTools: ["write_file", "edit_file", "run_command", "remember_fact"],
		mode: "plan",
		isBuiltin: true,
		maxIterations: 25,
		defaultMaxIterations: 25,
	},
	"code-reviewer": {
		name: "code-reviewer",
		description: "Specialized code review agent for inspecting code quality, standards adherence, architecture design, edge cases, and type safety.",
		systemPrompt: `You are a specialized Code Reviewer Subagent.
Your mission is to perform rigorous code review along multiple axes (Standards vs Spec, anti-patterns, edge cases, type safety, test coverage).
Strictly read-only and non-destructive.
Provide actionable, constructive feedback with exact file locations and code snippets.`,
		allowedTools: [
			"read_file",
			"glob_files",
			"grep_search",
			"recall_facts",
			"get_diagnostics",
			"get_definition",
			"find_references",
		],
		disallowedTools: ["write_file", "edit_file", "run_command"],
		mode: "plan",
		isBuiltin: true,
		maxIterations: 20,
		defaultMaxIterations: 20,
	},
	"test-engineer": {
		name: "test-engineer",
		description: "Specialized test engineering agent for designing, writing, running, and diagnosing unit, integration, and stress tests.",
		systemPrompt: `You are a specialized Test Engineer Subagent.
Your mission is to design comprehensive test suites, write test cases with high edge-case coverage, execute tests using available test runners, diagnose failures, and ensure zero regressions.`,
		allowedTools: [
			"read_file",
			"glob_files",
			"grep_search",
			"write_file",
			"edit_file",
			"run_command",
			"recall_facts",
			"remember_fact",
			"get_diagnostics",
			"get_definition",
			"find_references",
		],
		mode: "build",
		isBuiltin: true,
		maxIterations: 30,
		defaultMaxIterations: 30,
	},
};

/**
 * Registry managing built-in and dynamic subagent role definitions
 */
export class SubagentTypeRegistry {
	private definitions: Map<string, SubagentDefinition> = new Map();

	constructor() {
		this.resetToDefaults();
	}

	/**
	 * Register a new subagent type definition
	 */
	public register(definition: SubagentDefinition, overwrite = false): void {
		if (!definition || typeof definition.name !== "string" || !/^[a-zA-Z0-9_-]+$/.test(definition.name.trim())) {
			throw new Error(`Invalid subagent name: "${definition?.name}". Must be alphanumeric with hyphens or underscores.`);
		}

		if (!definition.description || typeof definition.description !== "string" || definition.description.trim() === "") {
			throw new Error("Subagent description cannot be empty.");
		}

		if (!definition.systemPrompt || typeof definition.systemPrompt !== "string" || definition.systemPrompt.trim() === "") {
			throw new Error("Subagent systemPrompt cannot be empty.");
		}

		const name = definition.name.trim();
		const existing = this.definitions.get(name);

		if (existing) {
			if (existing.isBuiltin && !overwrite) {
				throw new Error(`Cannot overwrite built-in subagent type "${name}" without explicit overwrite permission.`);
			}
			if (!overwrite) {
				throw new Error(`Subagent type "${name}" is already registered.`);
			}
		}

		const maxIterations = definition.maxIterations ?? definition.defaultMaxIterations ?? 25;

		this.definitions.set(name, {
			...definition,
			name,
			maxIterations,
			defaultMaxIterations: maxIterations,
			isBuiltin: definition.isBuiltin ?? false,
		});
	}

	/**
	 * Unregister a dynamically added subagent type
	 */
	public unregister(name: string): boolean {
		const existing = this.definitions.get(name);
		if (!existing) return false;

		if (existing.isBuiltin) {
			throw new Error(`Cannot unregister built-in subagent type "${name}".`);
		}

		return this.definitions.delete(name);
	}

	/**
	 * Get a subagent definition by name
	 */
	public get(name: string): SubagentDefinition | undefined {
		return this.definitions.get(name);
	}

	/**
	 * Check if a subagent definition exists
	 */
	public has(name: string): boolean {
		return this.definitions.has(name);
	}

	/**
	 * List all registered subagent definitions
	 */
	public list(): SubagentDefinition[] {
		return Array.from(this.definitions.values());
	}

	/**
	 * List all registered subagent names
	 */
	public listNames(): string[] {
		return Array.from(this.definitions.keys());
	}

	/**
	 * Reset registry to initial built-in defaults
	 */
	public resetToDefaults(): void {
		this.definitions.clear();
		for (const [name, def] of Object.entries(BUILTIN_SUBAGENT_DEFINITIONS)) {
			this.definitions.set(name, { ...def });
		}
	}

	/**
	 * Alias for resetToDefaults
	 */
	public reset(): void {
		this.resetToDefaults();
	}

	/**
	 * Factory creating default registry
	 */
	public static createDefault(): SubagentTypeRegistry {
		return new SubagentTypeRegistry();
	}
}
