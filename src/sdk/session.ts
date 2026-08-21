import type { ContentBlock, LoopEvent, Message } from "../agent/types.ts";
import { ControlLayer } from "../control/index.ts";
import type { Provider, ProviderCallConfig, ProviderResponse } from "../providers/base.ts";
import { ProviderRegistry } from "../providers/registry.ts";
import { ToolRegistry } from "../tools/registry.ts";
import { type ReplTurn, ReplSession } from "../tui/session.ts";
import { VerificationEngine } from "../verifier/engine.ts";
import type { VerificationCheck, VerificationReport } from "../verifier/types.ts";
import type { Harness } from "./harness.ts";
import type {
	ApprovalCallback,
	ApprovalRequest,
	DoneEvent,
	DoneListener,
	ErrorEvent,
	ErrorListener,
	ResponseEvent,
	ResponseListener,
	SDKEvent,
	SDKEventListener,
	SDKSendOptions,
	SDKSessionOptions,
	SDKSessionState,
	SDKTurnResult,
	ThinkingEvent,
	Tool,
	ToolCallEvent,
	ToolCallListener,
	ToolResultEvent,
	ToolResultListener,
	Unsubscribe,
} from "./types.ts";

/**
 * Stateful, isolated conversational session engine for embeddable AI agents.
 *
 * Coordinates multi-turn LLM reasoning loops, tool dispatch, sandbox enforcement,
 * approval interception, real-time event streaming, token accumulation, and cost tracking.
 */
export class HarnessSession {
	public readonly id: string;
	private harness: Harness;
	private session: ReplSession;
	private providerRegistry: ProviderRegistry;
	private toolRegistry: ToolRegistry;
	private controlLayer: ControlLayer;
	private currentProvider?: Provider;
	private currentModel: string;
	private systemPrompt: string;
	private maxIterations: number;
	private projectRoot: string;

	private approvalInterceptor: ApprovalCallback | null = null;
	private currentAbortController: AbortController | null = null;
	private isExecuting = false;

	// Event listener sets
	private eventListeners: Set<SDKEventListener> = new Set();
	private toolCallListeners: Set<ToolCallListener> = new Set();
	private toolResultListeners: Set<ToolResultListener> = new Set();
	private responseListeners: Set<ResponseListener> = new Set();
	private errorListeners: Set<ErrorListener> = new Set();
	private doneListeners: Set<DoneListener> = new Set();

	constructor(harness: Harness, options: SDKSessionOptions = {}) {
		this.id = options.id || `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
		this.harness = harness;
		const harnessConfig = harness.getConfig();
		const harnessOptions = harness.getOptions();

		this.projectRoot = options.projectRoot || harness.getProjectRoot();

		// 1. Initialize Provider Registry with inheritance
		this.providerRegistry = new ProviderRegistry();
		for (const name of harness.listProviders()) {
			const p = harness.getProvider(name);
			if (p) {
				this.providerRegistry.register(p);
			}
		}

		let providerName = options.providerName;
		if (typeof options.provider === "string") {
			providerName = options.provider;
		} else if (options.provider && typeof options.provider === "object") {
			this.providerRegistry.register(options.provider);
			this.currentProvider = options.provider;
			providerName = options.provider.name;
		}

		if (!providerName) {
			providerName =
				(typeof harnessOptions.provider === "string"
					? harnessOptions.provider
					: harnessOptions.provider?.name) ||
				harnessConfig.defaultProvider ||
				"default";
		}

		if (!this.currentProvider) {
			this.currentProvider = this.providerRegistry.get(providerName);
		}

		this.currentModel =
			options.modelName || harness.getDefaultModel() || "default";

		const initialMode =
			options.mode ||
			harnessOptions.mode ||
			(harnessConfig as any).mode ||
			"build";
		const initialApprovalMode =
			options.approvalMode ||
			harnessOptions.approvalMode ||
			harnessConfig.approvalMode ||
			"auto";
		this.maxIterations =
			options.maxIterations ||
			harnessOptions.maxIterations ||
			harnessConfig.maxIterations ||
			50;
		const maxTokens =
			options.maxTokens ||
			harnessOptions.maxTokens ||
			(harnessConfig as any).maxTokens ||
			128000;

		this.systemPrompt =
			options.systemPrompt ||
			harnessOptions.systemPrompt ||
			(harnessConfig as any).systemPrompt ||
			`You are an expert autonomous AI coding assistant.
You have access to tools for inspecting, editing, searching files, running shell commands, and managing memory.
Always verify your edits and prioritize safety.`;

		// 2. Initialize Tool Registry with inheritance
		this.toolRegistry = new ToolRegistry();
		for (const name of harness.listTools()) {
			const t = harness.getTool(name);
			if (t) {
				this.toolRegistry.register(t as any);
			}
		}

		if (options.tools) {
			for (const tool of options.tools) {
				this.toolRegistry.register(tool as any);
			}
		}

		// 3. Security and Control Layer
		this.controlLayer = new ControlLayer({
			approvalMode: initialApprovalMode,
			projectRoot: this.projectRoot,
		});
		this.controlLayer.getModeController().setMode(initialMode);

		// 4. Multi-turn Session Manager
		this.session = new ReplSession({
			id: options.id,
			providerName: this.currentProvider?.name || providerName,
			modelName: this.currentModel,
			mode: initialMode,
			approvalMode: initialApprovalMode,
			projectRoot: this.projectRoot,
			maxTokens,
		});
	}

	/**
	 * Get the parent Harness instance.
	 */
	public getHarness(): Harness {
		return this.harness;
	}

	/**
	 * Get the session ID.
	 */
	public getId(): string {
		return this.session.getId();
	}

	/**
	 * Get the active model name.
	 */
	public getCurrentModel(): string {
		return this.currentModel;
	}

	/**
	 * Get the active Provider instance.
	 */
	public getCurrentProvider(): Provider | undefined {
		return this.currentProvider;
	}

	/**
	 * Get the session's ToolRegistry.
	 */
	public getToolRegistry(): ToolRegistry {
		return this.toolRegistry;
	}

	/**
	 * Get the session's ProviderRegistry.
	 */
	public getProviderRegistry(): ProviderRegistry {
		return this.providerRegistry;
	}

	/**
	 * Get the session's ControlLayer.
	 */
	public getControlLayer(): ControlLayer {
		return this.controlLayer;
	}

	/**
	 * Get the underlying ReplSession.
	 */
	public getReplSession(): ReplSession {
		return this.session;
	}

	/**
	 * Get the total completed turns count in this session.
	 */
	public getTurnCount(): number {
		return this.session.getState().turnCount;
	}

	/**
	 * Run automated verification quality checks on the session project root.
	 */
	public async verify(checks?: VerificationCheck[]): Promise<VerificationReport> {
		const engine = new VerificationEngine(this.projectRoot, checks);
		return engine.verify();
	}

	/**
	 * Register a tool specifically into this session.
	 */
	public registerTool(tool: Tool): void {
		this.toolRegistry.register(tool as any);
	}

	/**
	 * Get a tool by name from this session.
	 */
	public getTool(name: string): Tool | undefined {
		return this.toolRegistry.get(name) as any;
	}

	/**
	 * List all registered tool names in this session.
	 */
	public listTools(): string[] {
		return this.toolRegistry.list();
	}

	/**
	 * Register a provider specifically into this session.
	 */
	public registerProvider(provider: Provider): void {
		this.providerRegistry.register(provider);
	}

	/**
	 * Get a provider by name from this session.
	 */
	public getProvider(name: string): Provider | undefined {
		return this.providerRegistry.get(name);
	}

	/**
	 * List all registered provider names in this session.
	 */
	public listProviders(): string[] {
		return this.providerRegistry.list();
	}

	/**
	 * Switch the active execution mode ("plan" | "build").
	 */
	public setMode(mode: "plan" | "build"): void {
		this.session.setMode(mode);
		this.controlLayer.getModeController().setMode(mode);
	}

	/**
	 * Switch the active approval mode ("auto" | "manual" | "yolo").
	 */
	public setApprovalMode(mode: "auto" | "manual" | "yolo"): void {
		this.session.setApprovalMode(mode);
		this.controlLayer.getApprovalGate().setMode(mode);
	}

	/**
	 * Switch the active provider and optionally model.
	 */
	public setProvider(
		providerNameOrInstance: string | Provider,
		modelName?: string,
	): void {
		if (typeof providerNameOrInstance === "string") {
			const found = this.providerRegistry.get(providerNameOrInstance);
			if (found) {
				this.currentProvider = found;
			}
			const model = modelName || this.currentModel;
			if (modelName) {
				this.currentModel = modelName;
			}
			this.session.setProvider(providerNameOrInstance, model);
		} else {
			this.providerRegistry.register(providerNameOrInstance);
			this.currentProvider = providerNameOrInstance;
			const model = modelName || this.currentModel;
			if (modelName) {
				this.currentModel = modelName;
			}
			this.session.setProvider(providerNameOrInstance.name, model);
		}
	}

	/**
	 * Switch the active model.
	 */
	public setModel(model: string): void {
		this.currentModel = model;
		this.session.setModel(model);
	}

	/**
	 * Set custom system prompt override.
	 */
	public setSystemPrompt(systemPrompt: string): void {
		this.systemPrompt = systemPrompt;
	}

	/**
	 * Set maximum loop iterations per turn.
	 */
	public setMaxIterations(maxIterations: number): void {
		this.maxIterations = maxIterations;
	}

	/**
	 * Get conversation history protocol messages.
	 */
	public getHistory(): Message[] {
		return this.session.getHistory();
	}

	/**
	 * Get conversation history messages (alias for getHistory).
	 */
	public getMessages(): Message[] {
		return this.session.getMessages();
	}

	/**
	 * Get recorded turn metadata.
	 */
	public getTurns(): ReplTurn[] {
		return this.session.getTurns();
	}

	/**
	 * Get current session state snapshot.
	 */
	public getState(): SDKSessionState {
		const s = this.session.getState();
		return {
			id: s.id,
			turnCount: s.turnCount,
			inputTokens: s.inputTokens,
			outputTokens: s.outputTokens,
			totalTokens: s.totalTokens,
			estimatedCost: s.estimatedCost,
			providerName: s.providerName,
			modelName: s.modelName,
			mode: s.mode,
			approvalMode: s.approvalMode,
			startTime: s.startTime,
			createdAt: s.createdAt,
			updatedAt: s.updatedAt,
		};
	}

	/**
	 * Reset conversation history, turns, and token accounting.
	 */
	public reset(): void {
		this.session.reset();
	}

	/**
	 * Abort the currently active turn execution.
	 */
	public abort(): void {
		if (this.currentAbortController && this.isExecuting) {
			this.currentAbortController.abort();
		}
	}

	/**
	 * Register a programmatic approval interceptor.
	 *
	 * When a tool requires approval (or in "manual" mode), this async callback is invoked
	 * to allow external services, web applications, or custom policies to approve or deny the call.
	 */
	public onApprovalRequest(callback: ApprovalCallback): void {
		this.approvalInterceptor = callback;
	}

	/**
	 * Register a listener for all SDK events.
	 */
	public on(
		eventName:
			| "event"
			| "tool_call"
			| "tool_result"
			| "response"
			| "error"
			| "done",
		listener: Function,
	): Unsubscribe {
		if (eventName === "event") {
			this.eventListeners.add(listener as SDKEventListener);
			return () => this.eventListeners.delete(listener as SDKEventListener);
		}
		if (eventName === "tool_call") {
			return this.onToolCall(listener as ToolCallListener);
		}
		if (eventName === "tool_result") {
			return this.onToolResult(listener as ToolResultListener);
		}
		if (eventName === "response") {
			return this.onResponse(listener as ResponseListener);
		}
		if (eventName === "error") {
			return this.onError(listener as ErrorListener);
		}
		if (eventName === "done") {
			return this.onDone(listener as DoneListener);
		}
		return () => {};
	}

	/**
	 * Register a listener for tool call events.
	 */
	public onToolCall(listener: ToolCallListener): Unsubscribe {
		this.toolCallListeners.add(listener);
		return () => this.toolCallListeners.delete(listener);
	}

	/**
	 * Register a listener for tool result events.
	 */
	public onToolResult(listener: ToolResultListener): Unsubscribe {
		this.toolResultListeners.add(listener);
		return () => this.toolResultListeners.delete(listener);
	}

	/**
	 * Register a listener for assistant response events.
	 */
	public onResponse(listener: ResponseListener): Unsubscribe {
		this.responseListeners.add(listener);
		return () => this.responseListeners.delete(listener);
	}

	/**
	 * Register a listener for error events.
	 */
	public onError(listener: ErrorListener): Unsubscribe {
		this.errorListeners.add(listener);
		return () => this.errorListeners.delete(listener);
	}

	/**
	 * Register a listener for turn done events.
	 */
	public onDone(listener: DoneListener): Unsubscribe {
		this.doneListeners.add(listener);
		return () => this.doneListeners.delete(listener);
	}

	/**
	 * Emit an event to all registered listeners.
	 */
	private emitEvent(event: SDKEvent): void {
		for (const listener of this.eventListeners) {
			try {
				listener(event);
			} catch {}
		}

		if (event.type === "tool_call") {
			for (const listener of this.toolCallListeners) {
				try {
					listener(event);
				} catch {}
			}
		} else if (event.type === "tool_result") {
			for (const listener of this.toolResultListeners) {
				try {
					listener(event);
				} catch {}
			}
		} else if (event.type === "response") {
			for (const listener of this.responseListeners) {
				try {
					listener(event.text);
				} catch {}
			}
		} else if (event.type === "error") {
			for (const listener of this.errorListeners) {
				try {
					listener(event.error);
				} catch {}
			}
		} else if (event.type === "done") {
			for (const listener of this.doneListeners) {
				try {
					listener(event);
				} catch {}
			}
		}
	}

	/**
	 * Executes a prompt turn and yields real-time streaming events.
	 * Returns the completed SDKTurnResult when the generator finishes.
	 */
	public async *sendStream(
		prompt: string,
		options?: SDKSendOptions,
	): AsyncGenerator<SDKEvent, SDKTurnResult> {
		if (this.isExecuting) {
			throw new Error("Another execution turn is already in progress for this session.");
		}

		this.isExecuting = true;
		this.currentAbortController = new AbortController();
		const abortController = this.currentAbortController;

		if (options?.signal) {
			if (options.signal.aborted) {
				abortController.abort();
			} else {
				options.signal.addEventListener("abort", () => abortController.abort(), {
					once: true,
				});
			}
		}

		const { signal } = abortController;
		const turnStartTime = Date.now();
		let turnInputTokens = 0;
		let turnOutputTokens = 0;
		let assistantResponseText = "";
		const turnEvents: SDKEvent[] = [];
		const turnToolEvents: LoopEvent[] = [];

		const emitAndYield = (event: SDKEvent) => {
			turnEvents.push(event);
			this.emitEvent(event);
			return event;
		};

		try {
			if (signal.aborted) {
				const error = new Error("Turn aborted before execution started.");
				const errorEvent: ErrorEvent = {
					type: "error",
					error,
				};
				yield emitAndYield(errorEvent);
				throw error;
			}

			if (!this.currentProvider) {
				const error = new Error("No active provider configured in session.");
				const errorEvent: ErrorEvent = { type: "error", error };
				yield emitAndYield(errorEvent);
				throw error;
			}

			// Prepare message history with full multi-turn context
			const previousMessages = this.session.getMessages();
			const turnMessages: Message[] = [...previousMessages];
			const userMsg: Message = {
				role: "user",
				content: [{ type: "text", text: prompt }],
			};
			turnMessages.push(userMsg);

			let iterations = 0;
			let turnComplete = false;

			while (iterations < this.maxIterations && !turnComplete) {
				if (signal.aborted) {
					const error = new Error("Turn aborted by user.");
					const errorEvent: ErrorEvent = {
						type: "error",
						error,
					};
					yield emitAndYield(errorEvent);
					throw error;
				}

				iterations++;

				const toolDefinitions = this.toolRegistry.getDefinitions();
				const callConfig: ProviderCallConfig = {
					model: this.currentModel,
					systemPrompt: this.systemPrompt,
				};

				const thinkingEvent: ThinkingEvent = {
					type: "thinking",
					message: `Reasoning turn ${iterations}...`,
				};
				yield emitAndYield(thinkingEvent);

				const response: ProviderResponse = await this.currentProvider.chat(
					turnMessages,
					toolDefinitions,
					callConfig,
				);

				if (signal.aborted) {
					const error = new Error("Turn aborted by user.");
					const errorEvent: ErrorEvent = {
						type: "error",
						error,
					};
					yield emitAndYield(errorEvent);
					throw error;
				}

				if (response.usage) {
					turnInputTokens += response.usage.inputTokens || 0;
					turnOutputTokens += response.usage.outputTokens || 0;
				}

				// Append assistant response to working history
				turnMessages.push({ role: "assistant", content: response.content });

				const toolUseBlocks = response.content.filter(
					(block) => block.type === "tool_use",
				);

				if (toolUseBlocks.length === 0) {
					// Non-tool response: extract text
					const textBlocks = response.content.filter((b) => b.type === "text");
					assistantResponseText = textBlocks
						.map((b) => ("text" in b ? b.text : ""))
						.join("\n");

					if (assistantResponseText) {
						const respEvent: ResponseEvent = {
							type: "response",
							text: assistantResponseText,
						};
						yield emitAndYield(respEvent);
					}
					turnComplete = true;
					break;
				}

				// Process tool calls
				const toolResults: ContentBlock[] = [];

				for (const block of toolUseBlocks) {
					if (block.type !== "tool_use") continue;
					if (signal.aborted) {
						const error = new Error("Turn aborted by user.");
						const errorEvent: ErrorEvent = {
							type: "error",
							error,
						};
						yield emitAndYield(errorEvent);
						throw error;
					}

					const toolCallEvt: ToolCallEvent = {
						type: "tool_call",
						toolName: block.name,
						toolInput: block.input,
						toolUseId: block.id,
					};
					yield emitAndYield(toolCallEvt);
					turnToolEvents.push(toolCallEvt);

					// Tool Verification & Approval
					let permitted = true;
					let denyReason = "";
					let sanitizedInput = { ...block.input };

					// 1. Mode Check
					const currentMode = this.controlLayer.getModeController().getMode();
					if (currentMode === "plan") {
						if (!this.controlLayer.getModeController().isToolAllowed(block.name)) {
							permitted = false;
							denyReason = `Tool ${block.name} is not allowed in plan mode`;
						}
					}

					// 2. Sandbox Check for file paths
					if (permitted) {
						for (const key of ["path", "TargetFile", "directory"]) {
							if (typeof sanitizedInput[key] === "string") {
								const validation = (this.controlLayer as any).sandbox?.validatePath(
									sanitizedInput[key] as string,
								);
								if (validation && !validation.valid) {
									permitted = false;
									denyReason = validation.reason || "Path outside sandbox";
									break;
								}
								if (validation && validation.resolvedPath) {
									sanitizedInput[key] = validation.resolvedPath;
								}
							}
						}
					}

					// 3. Approval Gate / Programmatic Interceptor Check
					if (permitted) {
						const approvalGate = this.controlLayer.getApprovalGate();
						const gateDecision = approvalGate.check({
							toolName: block.name,
							toolInput: sanitizedInput,
						});

						if (gateDecision === "deny") {
							permitted = false;
							denyReason = `Tool ${block.name} was denied by safety policies`;
						} else if (gateDecision === "ask_user") {
							// If an approval interceptor is registered, query it
							if (this.approvalInterceptor) {
								try {
									const approvalDecision = await this.approvalInterceptor({
										toolName: block.name,
										toolInput: sanitizedInput,
									});

									if (
										approvalDecision === true ||
										approvalDecision === "approve" ||
										(typeof approvalDecision === "object" &&
											approvalDecision !== null &&
											approvalDecision.approved === true)
									) {
										permitted = true;
									} else {
										permitted = false;
										denyReason =
											typeof approvalDecision === "object" &&
											approvalDecision !== null &&
											approvalDecision.reason
												? approvalDecision.reason
												: "Tool execution denied by approval interceptor";
									}
								} catch (err: any) {
									permitted = false;
									denyReason = `Approval interceptor threw error: ${err.message}`;
								}
							} else {
								// No interceptor in headless/SDK environment
								permitted = false;
								denyReason = "Tool execution requires approval, but no approval interceptor is registered in SDK session.";
							}
						}
					}

					if (signal.aborted) {
						const error = new Error("Turn aborted by user.");
						const errorEvent: ErrorEvent = {
							type: "error",
							error,
						};
						yield emitAndYield(errorEvent);
						throw error;
					}

					// 4. Execution
					let resultStr = "";
					let isError = false;

					if (!permitted) {
						resultStr = `[Control Denied]: ${denyReason}`;
						isError = true;
					} else {
						const toolInstance = this.toolRegistry.get(block.name);
						if (!toolInstance) {
							resultStr = `Tool not found: ${block.name}`;
							isError = true;
						} else {
							try {
								const res = await Promise.resolve(toolInstance.execute(sanitizedInput));
								resultStr = typeof res?.result === "string" ? res.result : String(res?.result ?? "");
								isError = Boolean(res?.isError);
							} catch (err: unknown) {
								const errMsg =
									err instanceof Error
										? err.message
										: typeof err === "object" && err !== null
											? JSON.stringify(err)
											: String(err ?? "Unknown error");
								resultStr = `Error executing tool: ${errMsg}`;
								isError = true;
							}
						}
					}


					const toolResultEvt: ToolResultEvent = {
						type: "tool_result",
						toolUseId: block.id,
						toolName: block.name,
						result: resultStr,
						isError,
					};
					yield emitAndYield(toolResultEvt);
					turnToolEvents.push(toolResultEvt);

					toolResults.push({
						type: "tool_result",
						toolUseId: block.id,
						content: resultStr,
						isError,
					});
				}

				if (signal.aborted) {
					const error = new Error("Turn aborted by user.");
					const errorEvent: ErrorEvent = {
						type: "error",
						error,
					};
					yield emitAndYield(errorEvent);
					throw error;
				}

				const toolMsg: Message = { role: "tool", content: toolResults };
				turnMessages.push(toolMsg);
			}

			if (iterations >= this.maxIterations && !turnComplete) {
				const errorEvent: ErrorEvent = {
					type: "error",
					error: new Error(`Max iterations (${this.maxIterations}) reached.`),
				};
				yield emitAndYield(errorEvent);
			}

			if (!signal.aborted) {
				const doneEvent: DoneEvent = {
					type: "done",
					totalIterations: iterations,
				};
				yield emitAndYield(doneEvent);
			}

			const durationMs = Date.now() - turnStartTime;

			// Record turn into ReplSession
			const turn = this.session.addTurn(
				prompt,
				assistantResponseText,
				{ inputTokens: turnInputTokens, outputTokens: turnOutputTokens },
				turnToolEvents,
				durationMs,
			);

			const turnResult: SDKTurnResult = {
				response: assistantResponseText,
				events: turnEvents,
				usage: {
					inputTokens: turnInputTokens,
					outputTokens: turnOutputTokens,
					totalTokens: turnInputTokens + turnOutputTokens,
				},
				cost: turn.cost,
				durationMs,
				turn,
			};

			return turnResult;
		} catch (err: any) {
			const error = err instanceof Error ? err : new Error(String(err));
			const errorEvent: ErrorEvent = { type: "error", error };
			yield emitAndYield(errorEvent);
			throw error;
		} finally {
			this.isExecuting = false;
			this.currentAbortController = null;
		}
	}

	/**
	 * Convenience method: executes a prompt turn and returns the aggregated SDKTurnResult.
	 */
	public async send(
		prompt: string,
		options?: SDKSendOptions,
	): Promise<SDKTurnResult> {
		const stream = this.sendStream(prompt, options);
		let finalResult: SDKTurnResult | undefined;

		while (true) {
			const { value, done } = await stream.next();
			if (done) {
				finalResult = value;
				break;
			}
		}

		return finalResult!;
	}
}
