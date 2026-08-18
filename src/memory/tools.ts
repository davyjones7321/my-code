import type { Tool } from "../tools/registry.ts";
import type { MemoryAPI } from "./api.ts";

export function createRememberTool(memory: MemoryAPI): Tool {
	return {
		name: "remember_fact",
		description:
			"Store an important fact or learning for recall in future sessions. Use for: project conventions, codebase patterns, user preferences, key decisions.",
		inputSchema: {
			type: "object",
			properties: {
				content: { type: "string", description: "The fact to remember" },
				tags: {
					type: "array",
					items: { type: "string" },
					description: "Optional tags for categorization",
				},
			},
			required: ["content"],
		},
		async execute(input) {
			const result = memory.remember(input.content as string, input.tags as string[]);
			return { result: result.message, isError: false };
		},
	};
}

export function createRecallTool(memory: MemoryAPI): Tool {
	return {
		name: "recall_facts",
		description: "Search through stored facts and past session knowledge using full-text search.",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "Search query for finding relevant facts" },
				limit: { type: "number", description: "Max results to return (default: 5)" },
			},
			required: ["query"],
		},
		async execute(input) {
			const limit = typeof input.limit === "number" ? input.limit : 5;
			const facts = memory.recall(input.query as string, limit);
			if (facts.length === 0) {
				return { result: "No matching facts found.", isError: false };
			}
			return { result: facts.join("n---n"), isError: false };
		},
	};
}
