import type { Tool, ToolRegistry } from "../tools/registry.ts";
import type { SubagentManager } from "./manager.ts";
import type { SubagentTypeRegistry } from "./registry.ts";
import type { ManageSubagentAction } from "./types.ts";

/**
 * Creates the `invoke_subagent` tool
 */
export function createInvokeSubagentTool(manager: SubagentManager, currentAgentId = "parent"): Tool {
	return {
		name: "invoke_subagent",
		description:
			"Launch an isolated subagent worker with a dedicated role ('research', 'code-reviewer', 'test-engineer', or custom), prompt, and isolated context.",
		inputSchema: {
			type: "object",
			properties: {
				type: {
					type: "string",
					description:
						"Subagent type ('research', 'code-reviewer', 'test-engineer', or custom registered type)",
					default: "research",
				},
				prompt: {
					type: "string",
					description: "The task instructions and objectives for the subagent",
				},
				name: {
					type: "string",
					description: "Optional human-readable label for this subagent instance",
				},
				systemPrompt: {
					type: "string",
					description: "Optional custom system instructions to append",
				},
				allowedTools: {
					type: "array",
					items: { type: "string" },
					description: "Optional list of allowed tools",
				},
				model: {
					type: "string",
					description: "Optional model override",
				},
				maxIterations: {
					type: "number",
					description: "Maximum iterations (default: 25)",
				},
				waitForCompletion: {
					type: "boolean",
					description: "Whether to await completion (default: true)",
					default: true,
				},
				background: {
					type: "boolean",
					description: "Run in background without awaiting completion",
				},
			},
			required: ["prompt"],
		},
		async execute(input: Record<string, unknown>) {
			try {
				const rawPrompt = input.prompt;
				if (typeof rawPrompt !== "string" || !rawPrompt.trim()) {
					return { result: "Error: prompt is required and cannot be empty.", isError: true };
				}

				const isBackground = input.background === true || input.waitForCompletion === false;

				const result = await manager.invoke(currentAgentId, {
					type: typeof input.type === "string" ? input.type : undefined,
					prompt: rawPrompt,
					name: typeof input.name === "string" ? input.name : undefined,
					systemPrompt: typeof input.systemPrompt === "string" ? input.systemPrompt : undefined,
					allowedTools: Array.isArray(input.allowedTools)
						? (input.allowedTools as string[])
						: undefined,
					model: typeof input.model === "string" ? input.model : undefined,
					maxIterations:
						typeof input.maxIterations === "number" ? input.maxIterations : undefined,
					waitForCompletion: !isBackground,
					background: isBackground,
				});

				const outputText = [
					`### Subagent Execution Report [${result.instanceId}]`,
					`- Type: ${result.type}`,
					`- State: ${result.state}`,
					`- Duration: ${result.durationMs}ms`,
					`- Iterations: ${result.totalIterations}`,
					`- Tool Calls: ${result.toolCallsCount}`,
					result.error ? `- Error: ${result.error}` : null,
					`\n#### Response:`,
					result.output,
				]
					.filter(Boolean)
					.join("\n");

				return {
					result: outputText,
					isError: result.state === "errored",
				};
			} catch (err: any) {
				return {
					result: `Failed to invoke subagent: ${err.message}`,
					isError: true,
				};
			}
		},
	};
}

/**
 * Creates the `send_message` tool
 */
export function createSendMessageTool(manager: SubagentManager, currentAgentId = "parent"): Tool {
	return {
		name: "send_message",
		description:
			"Send a direct message to a subagent instance without polluting the user conversation transcript.",
		inputSchema: {
			type: "object",
			properties: {
				recipientId: {
					type: "string",
					description: "Target subagent ID or 'parent'",
				},
				subagentId: {
					type: "string",
					description: "Alias for recipientId",
				},
				message: {
					type: "string",
					description: "Message content to deliver",
				},
				content: {
					type: "string",
					description: "Alias for message content",
				},
				awaitResponse: {
					type: "boolean",
					description: "Whether to wait for response (default: true)",
					default: true,
				},
			},
		},
		async execute(input: Record<string, unknown>) {
			const targetId = (input.recipientId || input.subagentId) as string | undefined;
			const messageContent = (input.message || input.content) as string | undefined;
			const awaitResponse = input.awaitResponse !== false;

			if (!targetId || typeof targetId !== "string") {
				return {
					result: "Error: recipientId or subagentId is required.",
					isError: true,
				};
			}

			if (!messageContent || typeof messageContent !== "string" || !messageContent.trim()) {
				return {
					result: "Error: message content cannot be empty.",
					isError: true,
				};
			}

			const delivery = await manager.sendMessage(
				currentAgentId,
				targetId,
				messageContent,
				{ awaitResponse },
			);

			if (!delivery.success) {
				return {
					result: `Error delivering message: ${delivery.error}`,
					isError: true,
				};
			}

			if (awaitResponse && delivery.response) {
				return {
					result: `Response from ${targetId}:\n${delivery.response}`,
					isError: false,
				};
			}

			return {
				result: `Message [${delivery.messageId}] delivered successfully to subagent ${targetId}. Recipient state: ${delivery.recipientState}.`,
				isError: false,
			};
		},
	};
}

/**
 * Creates the `manage_subagents` tool
 */
export function createManageSubagentsTool(manager: SubagentManager): Tool {
	return {
		name: "manage_subagents",
		description:
			"List subagents, query subagent status, inspect execution logs, or terminate active subagents.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["list", "status", "terminate", "logs"],
					description: "Management action to perform",
				},
				subagentId: {
					type: "string",
					description: "Target subagent ID (required for status, terminate, and logs)",
				},
				recursive: {
					type: "boolean",
					description: "Whether to recursively terminate child subagents (default: true)",
					default: true,
				},
				parentId: {
					type: "string",
					description: "Optional parent ID filter for list action",
				},
			},
			required: ["action"],
		},
		async execute(input: Record<string, unknown>) {
			const action = input.action as ManageSubagentAction;
			const subagentId = input.subagentId ? String(input.subagentId) : undefined;
			const recursive = input.recursive !== false;
			const parentId = input.parentId ? String(input.parentId) : undefined;

			const res = await manager.manage({ action, subagentId, recursive, parentId });
			return {
				result: JSON.stringify(res, null, 2),
				isError: !res.success,
			};
		},
	};
}

/**
 * Creates the `define_subagent` tool
 */
export function createDefineSubagentTool(typeRegistry: SubagentTypeRegistry): Tool {
	return {
		name: "define_subagent",
		description:
			"Dynamically register a new custom subagent type with specialized system prompt instructions and tool constraints.",
		inputSchema: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description:
						"Unique alphanumeric name for the custom subagent role (e.g. 'security-auditor')",
				},
				description: {
					type: "string",
					description: "Description of what this subagent role does",
				},
				systemPrompt: {
					type: "string",
					description: "System instructions for this subagent role",
				},
				allowedTools: {
					type: "array",
					items: { type: "string" },
					description: "Optional whitelist of permitted tools",
				},
				disallowedTools: {
					type: "array",
					items: { type: "string" },
					description: "Optional blacklist of disallowed tools",
				},
				mode: {
					type: "string",
					enum: ["plan", "build"],
					description: "Default control mode for this subagent",
				},
				maxIterations: {
					type: "number",
					description: "Optional default max iterations",
				},
				defaultMaxIterations: {
					type: "number",
					description: "Alias for maxIterations",
				},
				defaultModel: {
					type: "string",
					description: "Optional default model",
				},
			},
			required: ["name", "description", "systemPrompt"],
		},
		async execute(input: Record<string, unknown>) {
			try {
				const name = String(input.name || "");
				const description = String(input.description || "");
				const systemPrompt = String(input.systemPrompt || "");

				typeRegistry.register({
					name,
					description,
					systemPrompt,
					allowedTools: Array.isArray(input.allowedTools)
						? (input.allowedTools as string[])
						: undefined,
					disallowedTools: Array.isArray(input.disallowedTools)
						? (input.disallowedTools as string[])
						: undefined,
					mode: (input.mode as "plan" | "build") || undefined,
					maxIterations:
						typeof input.maxIterations === "number"
							? input.maxIterations
							: typeof input.defaultMaxIterations === "number"
								? input.defaultMaxIterations
								: undefined,
					defaultModel: typeof input.defaultModel === "string" ? input.defaultModel : undefined,
					isBuiltin: false,
				});

				return {
					result: `Successfully registered subagent type "${name}".`,
					isError: false,
				};
			} catch (err: any) {
				return {
					result: `Failed to define subagent: ${err.message}`,
					isError: true,
				};
			}
		},
	};
}

/**
 * Register all 4 subagent tools into a ToolRegistry
 */
export function registerSubagentTools(
	toolRegistry: ToolRegistry,
	manager: SubagentManager,
	typeRegistry?: SubagentTypeRegistry,
	agentId = "parent",
): void {
	const reg = typeRegistry || manager.getTypeRegistry();
	toolRegistry.register(createInvokeSubagentTool(manager, agentId));
	toolRegistry.register(createSendMessageTool(manager, agentId));
	toolRegistry.register(createManageSubagentsTool(manager));
	toolRegistry.register(createDefineSubagentTool(reg));
}
