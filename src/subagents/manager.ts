import { runAgentLoop, type ToolExecutor } from "../agent/loop.ts";
import type { LoopEvent, Message } from "../agent/types.ts";
import { ContextManager } from "../context/manager.ts";
import { ControlLayer, type ControlConfig } from "../control/index.ts";
import type { Provider, ProviderCallConfig } from "../providers/base.ts";
import { ToolRegistry } from "../tools/registry.ts";
import { SubagentTypeRegistry } from "./registry.ts";
import type {
	ManageSubagentsInput,
	ManageSubagentsResult,
	MessageDeliveryResult,
	SubagentEvent,
	SubagentEventType,
	SubagentExecutionResult,
	SubagentInstance,
	SubagentInvocationSpec,
	SubagentLifecycleState,
	SubagentLogEntry,
	SubagentMessage,
	SubagentStatusDetail,
	SubagentSummary,
	SubagentTreeNode,
} from "./types.ts";

export interface SubagentManagerOptions {
	provider: Provider;
	toolRegistry: ToolRegistry;
	projectRoot: string;
	typeRegistry?: SubagentTypeRegistry;
	defaultModel?: string;
	maxConcurrentSubagents?: number;
	controlConfig?: Partial<ControlConfig>;
}

export class SubagentManager {
	private instances: Map<string, SubagentInstance> = new Map();
	private parentChildTree: Map<string, Set<string>> = new Map();
	private listeners: Array<{
		type?: string;
		callback: (event: SubagentEvent) => void;
	}> = [];

	private provider: Provider;
	private toolRegistry: ToolRegistry;
	private typeRegistry: SubagentTypeRegistry;
	private projectRoot: string;
	private defaultModel: string;
	private maxConcurrentSubagents: number;
	private controlConfig?: Partial<ControlConfig>;

	constructor(options: SubagentManagerOptions) {
		this.provider = options.provider;
		this.toolRegistry = options.toolRegistry;
		this.projectRoot = options.projectRoot;
		this.typeRegistry = options.typeRegistry || new SubagentTypeRegistry();
		this.defaultModel = options.defaultModel || "default";
		this.maxConcurrentSubagents = options.maxConcurrentSubagents || 50;
		this.controlConfig = options.controlConfig;
	}

	public getTypeRegistry(): SubagentTypeRegistry {
		return this.typeRegistry;
	}

	public getToolRegistry(): ToolRegistry {
		return this.toolRegistry;
	}

	public getProjectRoot(): string {
		return this.projectRoot;
	}

	/**
	 * Subscribe to subagent lifecycle events
	 */
	public on(
		eventOrListener: string | ((event: SubagentEvent) => void),
		maybeListener?: (event: SubagentEvent) => void,
	): () => void {
		let type: string | undefined;
		let callback: (event: SubagentEvent) => void;

		if (typeof eventOrListener === "string") {
			type = eventOrListener;
			callback = maybeListener!;
		} else {
			callback = eventOrListener;
		}

		const entry = { type, callback };
		this.listeners.push(entry);

		return () => {
			this.listeners = this.listeners.filter((l) => l !== entry);
		};
	}

	/**
	 * Emit an event to all matching listeners
	 */
	public emit(event: SubagentEvent): void {
		for (const listener of this.listeners) {
			if (!listener.type || listener.type === event.type) {
				try {
					listener.callback(event);
				} catch {
					// Suppress listener errors to ensure isolation
				}
			}
		}
	}

	private emitEvent(
		type: SubagentEventType,
		instanceId: string,
		data: Record<string, unknown> = {},
		extra: Partial<SubagentEvent> = {},
	): void {
		const event: SubagentEvent = {
			type,
			instanceId,
			subagentId: instanceId,
			timestamp: Date.now(),
			data,
			...extra,
		};
		this.emit(event);

		// Also emit prefixed / alternate alias if applicable
		if (type === "instance_created") {
			this.emit({ ...event, type: "subagent:created" });
		} else if (type === "state_changed") {
			this.emit({ ...event, type: "subagent:status_changed" });
		} else if (type === "message_delivered") {
			this.emit({ ...event, type: "subagent:message_sent" });
		} else if (type === "tool_executed") {
			this.emit({ ...event, type: "subagent:loop_event" });
		} else if (type === "completed") {
			this.emit({ ...event, type: "subagent:completed" });
		} else if (type === "errored") {
			this.emit({ ...event, type: "subagent:error" });
		}
	}

	/**
	 * Log a message to an instance's audit log
	 */
	private log(
		instance: SubagentInstance,
		level: SubagentLogEntry["level"],
		type: SubagentLogEntry["type"],
		message: string,
		details?: Record<string, unknown>,
	): void {
		const entry: SubagentLogEntry = {
			timestamp: Date.now(),
			level,
			type,
			message,
			details,
		};
		instance.logs.push(entry);
	}

	/**
	 * Spawn a new subagent instance with isolated context and tool access
	 */
	public spawn(parentConversationId: string, spec: SubagentInvocationSpec): SubagentInstance {
		const runningCount = Array.from(this.instances.values()).filter((i) => i.state === "running").length;
		if (runningCount >= this.maxConcurrentSubagents) {
			throw new Error(`Maximum concurrent subagents (${this.maxConcurrentSubagents}) exceeded.`);
		}

		const typeName = spec.type || "research";
		const definition = this.typeRegistry.get(typeName) || {
			name: typeName,
			description: "Custom dynamic subagent",
			systemPrompt: spec.systemPrompt || "You are an autonomous subagent assistant.",
			allowedTools: spec.allowedTools,
			disallowedTools: spec.disallowedTools,
			isBuiltin: false,
			maxIterations: spec.maxIterations || 25,
			defaultMaxIterations: spec.maxIterations || 25,
		};

		const instanceId = `subagent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		const contextManager = new ContextManager({ projectRoot: this.projectRoot });
		const abortController = new AbortController();

		// Determine allowed and disallowed tools
		const allowedSet = spec.allowedTools
			? new Set(spec.allowedTools)
			: definition.allowedTools
				? new Set(definition.allowedTools)
				: null;
		const disallowedSet = spec.disallowedTools
			? new Set(spec.disallowedTools)
			: definition.disallowedTools
				? new Set(definition.disallowedTools)
				: null;

		// Create isolated tool registry for this subagent instance
		const subagentToolRegistry = new ToolRegistry();
		for (const toolName of this.toolRegistry.list()) {
			if (allowedSet && !allowedSet.has(toolName)) continue;
			if (disallowedSet && disallowedSet.has(toolName)) continue;
			const tool = this.toolRegistry.get(toolName);
			if (tool) {
				subagentToolRegistry.register(tool);
			}
		}

		// Create isolated control layer for subagent
		const subagentControlLayer = new ControlLayer({
			approvalMode: this.controlConfig?.approvalMode || "auto",
			projectRoot: this.projectRoot,
		});
		if (definition.mode === "plan") {
			subagentControlLayer.getModeController().setMode("plan");
		} else {
			subagentControlLayer.getModeController().setMode("build");
		}

		const allowedToolsList = subagentToolRegistry.list();
		const maxIterations = spec.maxIterations ?? definition.maxIterations ?? definition.defaultMaxIterations ?? 25;

		const instance: SubagentInstance = {
			id: instanceId,
			name: spec.name || `${definition.name}-${instanceId.slice(-4)}`,
			type: definition.name,
			parentId: parentConversationId,
			childIds: [],
			state: "idle",
			status: "idle",
			createdAt: Date.now(),
			updatedAt: Date.now(),
			contextManager,
			toolRegistry: subagentToolRegistry,
			controlLayer: subagentControlLayer,
			provider: this.provider,
			definition,
			spec,
			systemPrompt: [definition.systemPrompt, spec.systemPrompt].filter(Boolean).join("\n\n"),
			allowedTools: allowedToolsList,
			maxIterations,
			model: spec.model || definition.defaultModel || this.defaultModel,
			inbox: [],
			mailbox: [],
			messageHistory: [],
			logs: [],
			events: [],
			abortController,
		};

		// Link mailbox alias
		instance.mailbox = instance.inbox;

		this.instances.set(instanceId, instance);

		if (parentConversationId) {
			if (!this.parentChildTree.has(parentConversationId)) {
				this.parentChildTree.set(parentConversationId, new Set());
			}
			this.parentChildTree.get(parentConversationId)!.add(instanceId);

			const parentInstance = this.instances.get(parentConversationId);
			if (parentInstance) {
				parentInstance.childIds.push(instanceId);
			}
		}

		this.log(instance, "info", "state_change", `Subagent spawned with type "${definition.name}"`);
		this.emitEvent("instance_created", instanceId, {
			type: definition.name,
			parentId: parentConversationId,
		}, { instance });

		// Start execution promise
		instance.taskPromise = this.executeInstance(instance);
		instance.executionPromise = instance.taskPromise;

		return instance;
	}

	/**
	 * Invoke a subagent and optionally await its completion
	 */
	public async invoke(
		parentConversationId: string,
		spec: SubagentInvocationSpec,
	): Promise<SubagentExecutionResult> {
		const isBackground = spec.waitForCompletion === false || spec.background === true;
		const instance = this.spawn(parentConversationId, spec);

		if (isBackground) {
			return {
				instanceId: instance.id,
				subagentId: instance.id,
				name: instance.name,
				type: instance.type,
				state: "running",
				status: "running",
				output: `Subagent [${instance.id}] running in background.`,
				response: `Subagent [${instance.id}] running in background.`,
				totalIterations: 0,
				toolCallsCount: 0,
				durationMs: 0,
			};
		}

		if (spec.timeoutMs && spec.timeoutMs > 0) {
			let timeoutHandle: any;
			const timeoutPromise = new Promise<never>((_, reject) => {
				timeoutHandle = setTimeout(() => {
					instance.abortController.abort();
					reject(new Error(`Subagent execution timed out after ${spec.timeoutMs}ms`));
				}, spec.timeoutMs);
			});

			try {
				const res = await Promise.race([instance.taskPromise!, timeoutPromise]);
				clearTimeout(timeoutHandle);
				return res;
			} catch (err: any) {
				clearTimeout(timeoutHandle);
				throw err;
			}
		}

		return await instance.taskPromise!;
	}

	/**
	 * Run the agent loop for a subagent instance
	 */
	private async executeInstance(instance: SubagentInstance): Promise<SubagentExecutionResult> {
		const oldStatus = instance.state;
		instance.state = "running";
		instance.status = "running";
		instance.startedAt = Date.now();
		instance.updatedAt = Date.now();
		this.emitEvent("state_changed", instance.id, { state: "running" }, {
			oldStatus,
			newStatus: "running",
		});

		const startTime = Date.now();
		let totalIterations = 0;
		let toolCallsCount = 0;
		let finalOutput = "";
		let errorMessage: string | undefined;

		try {
			const executors = instance.toolRegistry.getExecutors();
			const definitions = instance.toolRegistry.getDefinitions();

			const loopConfig = {
				maxIterations: instance.maxIterations,
				systemPrompt: instance.systemPrompt,
				tools: definitions,
			};

			const callConfig: Partial<ProviderCallConfig> = {
				model: instance.model || this.defaultModel,
				systemPrompt: instance.systemPrompt,
			};

			const loop = runAgentLoop(
				instance.provider,
				instance.spec.prompt,
				executors,
				loopConfig,
				callConfig,
			);

			for await (const event of loop) {
				if (instance.abortController.signal.aborted) {
					instance.state = "terminated";
					instance.status = "terminated";
					this.log(instance, "warn", "state_change", "Execution aborted by signal");
					break;
				}

				instance.events.push(event);

				switch (event.type) {
					case "thinking":
						this.log(instance, "debug", "output", event.message);
						break;
					case "tool_call":
						toolCallsCount++;
						this.log(instance, "info", "tool_call", `Called tool "${event.toolName}"`, {
							input: event.toolInput,
						});
						this.emitEvent("tool_executed", instance.id, {
							toolName: event.toolName,
							toolInput: event.toolInput,
						}, { event });
						break;
					case "tool_result":
						this.log(
							instance,
							event.isError ? "warn" : "info",
							"tool_result",
							`Result for toolUseId ${event.toolUseId}`,
							{ isError: event.isError },
						);
						break;
					case "response":
						finalOutput = event.text;
						this.log(instance, "info", "output", "Agent emitted final response");
						break;
					case "error":
						errorMessage = event.error.message;
						this.log(instance, "error", "error", errorMessage);
						this.emitEvent("errored", instance.id, { error: errorMessage }, {
							error: event.error,
						});
						break;
					case "done":
						totalIterations = event.totalIterations;
						break;
				}
			}

			if (instance.state !== "terminated") {
				if (errorMessage) {
					instance.state = "errored";
					instance.status = "errored";
					instance.error = errorMessage;
				} else if ((instance.state as SubagentLifecycleState) !== "waiting_for_message") {
					instance.state = "done";
					instance.status = "done";
				}
			}
		} catch (err: any) {
			instance.state = "errored";
			instance.status = "errored";
			instance.error = err?.message || String(err);
			errorMessage = typeof instance.error === "string" ? instance.error : instance.error?.message;
			this.log(instance, "error", "error", `Fatal loop error: ${errorMessage}`);
			this.emitEvent("errored", instance.id, { error: errorMessage }, { error: err });
		} finally {
			instance.completedAt = Date.now();
			instance.updatedAt = Date.now();
			this.emitEvent("state_changed", instance.id, { state: instance.state }, {
				oldStatus: "running",
				newStatus: instance.state,
			});

			const result: SubagentExecutionResult = {
				instanceId: instance.id,
				subagentId: instance.id,
				name: instance.name,
				type: instance.type,
				state: instance.state,
				status: instance.state,
				output: finalOutput || (errorMessage ? `Error: ${errorMessage}` : ""),
				response: finalOutput || (errorMessage ? `Error: ${errorMessage}` : ""),
				totalIterations,
				toolCallsCount,
				durationMs: Date.now() - startTime,
				error: errorMessage,
				events: instance.events,
			};

			instance.result = result;
			this.emitEvent("completed", instance.id, { result }, { result });
			return result;
		}
	}

	/**
	 * Send a message to a subagent
	 */
	public async sendMessage(
		fromId: string,
		toId: string,
		content: string,
		optionsOrAwait?:
			| { metadata?: Record<string, unknown>; awaitResponse?: boolean; timeoutMs?: number }
			| boolean,
	): Promise<MessageDeliveryResult> {
		let options: { metadata?: Record<string, unknown>; awaitResponse?: boolean; timeoutMs?: number } = {};
		if (typeof optionsOrAwait === "boolean") {
			options = { awaitResponse: optionsOrAwait };
		} else if (optionsOrAwait) {
			options = optionsOrAwait;
		}

		// Resolve "parent" recipient alias
		let targetId = toId;
		if (toId === "parent") {
			const caller = this.instances.get(fromId);
			if (caller?.parentId) {
				targetId = caller.parentId;
			}
		}

		const recipient = this.instances.get(targetId);
		if (!recipient) {
			return {
				success: false,
				messageId: "",
				recipientId: targetId,
				recipientState: "errored",
				delivered: false,
				queued: false,
				error: `Recipient subagent "${targetId}" not found.`,
			};
		}

		if (recipient.state === "terminated") {
			return {
				success: false,
				messageId: "",
				recipientId: targetId,
				recipientState: "terminated",
				delivered: false,
				queued: false,
				error: "Cannot send message to terminated subagent",
			};
		}

		if (!content || !content.trim()) {
			return {
				success: false,
				messageId: "",
				recipientId: targetId,
				recipientState: recipient.state,
				delivered: false,
				queued: false,
				error: "Message content cannot be empty",
			};
		}

		const messageId = `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		const sender = this.instances.get(fromId);
		const direction =
			recipient.parentId === fromId
				? "parent_to_child"
				: sender?.parentId === recipient.id
					? "child_to_parent"
					: "peer_to_peer";

		const message: SubagentMessage = {
			id: messageId,
			fromId,
			toId: targetId,
			content,
			timestamp: Date.now(),
			direction,
			metadata: options.metadata,
		};

		recipient.inbox.push(message);
		recipient.messageHistory.push(message);

		recipient.contextManager.addMessage({
			role: "user",
			content: [{ type: "text", text: `[Message from ${fromId}]: ${content}` }],
		});

		this.log(recipient, "info", "message", `Received message from ${fromId}`, {
			messageId,
			content,
		});
		this.emitEvent("message_delivered", targetId, { fromId, messageId }, { message });

		if (options.awaitResponse) {
			// Trigger a continuation turn and await its response
			const continuationResult = await this.continueExecution(recipient, content);
			return {
				success: continuationResult.state !== "errored",
				messageId,
				recipientId: targetId,
				recipientState: recipient.state,
				delivered: true,
				queued: false,
				response: continuationResult.output,
				error: continuationResult.error,
			};
		}

		if (recipient.state === "waiting_for_message") {
			recipient.state = "running";
			recipient.status = "running";
			this.emitEvent("state_changed", targetId, { state: "running" });
		}

		return {
			success: true,
			messageId,
			recipientId: targetId,
			recipientState: recipient.state,
			delivered: true,
			queued: false,
		};
	}

	/**
	 * Continue execution for a subagent when receiving an interactive turn
	 */
	private async continueExecution(
		instance: SubagentInstance,
		newPrompt: string,
	): Promise<SubagentExecutionResult> {
		if (instance.state === "terminated") {
			return {
				instanceId: instance.id,
				subagentId: instance.id,
				name: instance.name,
				type: instance.type,
				state: "terminated",
				status: "terminated",
				output: "Subagent has been terminated.",
				response: "Subagent has been terminated.",
				totalIterations: 0,
				toolCallsCount: 0,
				durationMs: 0,
				error: "Subagent has been terminated.",
			};
		}

		instance.spec.prompt = newPrompt;
		instance.taskPromise = this.executeInstance(instance);
		instance.executionPromise = instance.taskPromise;
		return await instance.taskPromise;
	}

	/**
	 * Terminate an active subagent instance and optionally all its descendants
	 */
	public async terminate(
		instanceId: string,
		reason = "Terminated by manager",
		recursive = true,
	): Promise<boolean> {
		const instance = this.instances.get(instanceId);
		if (!instance) return false;

		if (recursive) {
			const children = this.parentChildTree.get(instanceId);
			if (children) {
				for (const childId of children) {
					await this.terminate(childId, `Cascading termination from parent ${instanceId}`, true);
				}
			}
		}

		instance.abortController.abort();
		const oldStatus = instance.state;
		instance.state = "terminated";
		instance.status = "terminated";
		instance.error = reason;
		instance.completedAt = Date.now();
		instance.updatedAt = Date.now();

		this.log(instance, "warn", "state_change", `Terminated: ${reason}`);
		this.emitEvent("terminated", instanceId, { reason }, {
			oldStatus,
			newStatus: "terminated",
		});
		this.emitEvent("state_changed", instanceId, { state: "terminated", reason }, {
			oldStatus,
			newStatus: "terminated",
		});

		return true;
	}

	/**
	 * Terminate all active subagent instances
	 */
	public async terminateAll(parentId?: string): Promise<void> {
		if (parentId) {
			const children = this.getChildren(parentId);
			for (const child of children) {
				await this.terminate(child.id, "Manager termination", true);
			}
		} else {
			for (const instanceId of this.instances.keys()) {
				await this.terminate(instanceId, "Manager shutdown", false);
			}
		}
	}

	/**
	 * Get a subagent instance by ID
	 */
	public getInstance(instanceId: string): SubagentInstance | undefined {
		return this.instances.get(instanceId);
	}

	/**
	 * Get direct children of a subagent
	 */
	public getChildren(parentId: string): SubagentInstance[] {
		const childIds = this.parentChildTree.get(parentId);
		if (!childIds) return [];
		return Array.from(childIds)
			.map((id) => this.instances.get(id))
			.filter((i): i is SubagentInstance => i !== undefined);
	}

	/**
	 * Get ancestors of a subagent up to the root
	 */
	public getAncestors(instanceId: string): SubagentInstance[] {
		const ancestors: SubagentInstance[] = [];
		let current = this.instances.get(instanceId);

		while (current?.parentId) {
			const parent = this.instances.get(current.parentId);
			if (!parent) break;
			ancestors.push(parent);
			current = parent;
		}

		return ancestors;
	}

	/**
	 * Get all recursive descendants of a subagent
	 */
	public getDescendants(instanceId: string): SubagentInstance[] {
		const descendants: SubagentInstance[] = [];
		const directChildren = this.getChildren(instanceId);

		for (const child of directChildren) {
			descendants.push(child);
			descendants.push(...this.getDescendants(child.id));
		}

		return descendants;
	}

	/**
	 * Get hierarchy tree starting from a root or top-level nodes
	 */
	public getTree(rootId?: string): SubagentTreeNode {
		const rootInstance = rootId ? this.instances.get(rootId) : undefined;
		const buildNode = (instance: SubagentInstance): SubagentTreeNode => {
			const children = this.getChildren(instance.id).map((c) => buildNode(c));
			return { instance, children };
		};

		if (rootInstance) {
			return buildNode(rootInstance);
		}

		// Top root node containing all top-level instances
		const topInstances = Array.from(this.instances.values()).filter(
			(i) => !i.parentId || !this.instances.has(i.parentId),
		);

		const fakeRoot: SubagentInstance = {
			id: "root",
			name: "Root",
			type: "root",
			childIds: topInstances.map((i) => i.id),
			state: "done",
			status: "done",
			createdAt: Date.now(),
			updatedAt: Date.now(),
			contextManager: new ContextManager({ projectRoot: this.projectRoot }),
			toolRegistry: this.toolRegistry,
			provider: this.provider,
			definition: { name: "root", description: "Root", systemPrompt: "" },
			spec: { prompt: "" },
			systemPrompt: "",
			allowedTools: [],
			maxIterations: 0,
			inbox: [],
			mailbox: [],
			messageHistory: [],
			logs: [],
			events: [],
			abortController: new AbortController(),
		};

		return {
			instance: fakeRoot,
			children: topInstances.map((i) => buildNode(i)),
		};
	}

	/**
	 * List summaries of subagent instances
	 */
	public listInstances(parentId?: string): SubagentSummary[] {
		let list = Array.from(this.instances.values());
		if (parentId) {
			list = list.filter((i) => i.parentId === parentId);
		}

		return list.map((i) => ({
			id: i.id,
			name: i.name,
			type: i.type,
			parentId: i.parentId,
			state: i.state,
			createdAt: i.createdAt,
			completedAt: i.completedAt,
			childCount: i.childIds.length,
			totalIterations: i.result?.totalIterations,
		}));
	}

	/**
	 * Perform management actions
	 */
	public async manage(input: ManageSubagentsInput): Promise<ManageSubagentsResult> {
		switch (input.action) {
			case "list":
				return {
					action: "list",
					success: true,
					subagents: this.listInstances(input.parentId),
				};
			case "status": {
				if (!input.subagentId) {
					return {
						action: "status",
						success: false,
						message: "subagentId is required for status action",
					};
				}
				const inst = this.instances.get(input.subagentId);
				if (!inst) {
					return {
						action: "status",
						success: false,
						message: `Subagent "${input.subagentId}" not found.`,
					};
				}
				const status: SubagentStatusDetail = {
					id: inst.id,
					name: inst.name,
					type: inst.type,
					parentId: inst.parentId,
					state: inst.state,
					createdAt: inst.createdAt,
					completedAt: inst.completedAt,
					childCount: inst.childIds.length,
					totalIterations: inst.result?.totalIterations,
					logsCount: inst.logs.length,
					inboxSize: inst.inbox.length,
					messageCount: inst.messageHistory.length,
					outputPreview: inst.result?.output ? inst.result.output.slice(0, 500) : undefined,
					error: typeof inst.error === "string" ? inst.error : inst.error?.message,
					durationMs: inst.result?.durationMs,
				};
				return { action: "status", success: true, status };
			}
			case "terminate": {
				if (!input.subagentId) {
					return {
						action: "terminate",
						success: false,
						message: "subagentId is required for terminate action",
					};
				}
				const ok = await this.terminate(
					input.subagentId,
					"User requested termination",
					input.recursive ?? true,
				);
				return {
					action: "terminate",
					success: ok,
					terminated: ok,
					message: ok
						? `Subagent "${input.subagentId}" terminated.`
						: `Subagent "${input.subagentId}" not found.`,
				};
			}
			case "logs": {
				if (!input.subagentId) {
					return {
						action: "logs",
						success: false,
						message: "subagentId is required for logs action",
					};
				}
				const inst = this.instances.get(input.subagentId);
				if (!inst) {
					return {
						action: "logs",
						success: false,
						message: `Subagent "${input.subagentId}" not found.`,
					};
				}
				return { action: "logs", success: true, logs: inst.logs };
			}
			default:
				return {
					action: input.action,
					success: false,
					message: `Unsupported action "${input.action}"`,
				};
		}
	}
}
