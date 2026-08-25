import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";
import chalk from "chalk";

import { getSystemEnvironmentPrompt, type ToolExecutor } from "../agent/loop.ts";
import type { ContentBlock, LoopEvent, Message, ToolDefinition } from "../agent/types.ts";
import {
	type HarnessConfig,
	getConfigPath,
	getProjectConfig,
	loadConfig,
	mergeConfigs,
} from "../config/index.ts";
import { ContextManager } from "../context/manager.ts";
import { ControlLayer } from "../control/index.ts";
import { LSPDiagnosticsEngine } from "../lsp/engine.ts";
import { registerLSPTools } from "../lsp/tools.ts";
import { MemoryAPI } from "../memory/api.ts";
import { createRecallTool, createRememberTool } from "../memory/tools.ts";
import type { Provider, ProviderCallConfig, ProviderResponse } from "../providers/base.ts";
import { ProviderRegistry } from "../providers/registry.ts";
import { SkillRegistry } from "../skills/registry.ts";
import { registerSkillTools } from "../skills/tools.ts";
import { SubagentManager } from "../subagents/manager.ts";
import { registerSubagentTools } from "../subagents/tools.ts";
import { registerBuiltinTools } from "../tools/defaults.ts";
import { ToolRegistry } from "../tools/registry.ts";

import {
	SlashCommandRegistry,
	createDefaultRegistry,
} from "./commands.ts";
import { ReplSession } from "./session.ts";
import { Spinner } from "./spinner.ts";
import { StatusBar } from "./status-bar.ts";
import { StreamRenderer } from "./stream-renderer.ts";
import type {
	CommandContext,
	ReplApprovalMode,
	ReplMode,
	ReplOptions,
} from "./types.ts";

/**
 * Interactive REPL Engine
 *
 * Coordinates multi-turn user conversations, readline input loop,
 * slash commands, live adaptive status bar, stream rendering,
 * and seamless integration with all runtime subsystems.
 */
export class ReplEngine {
	private options: ReplOptions;
	private inputStream: NodeJS.ReadableStream;
	private outputStream: NodeJS.WritableStream;
	private isTTY: boolean;
	private projectRoot: string;
	private version = "0.0.0";

	private config: HarnessConfig;
	private providerRegistry: ProviderRegistry;
	private currentProvider?: Provider;
	private currentModel: string;
	private toolRegistry: ToolRegistry;
	private controlLayer: ControlLayer;
	private contextManager: ContextManager;
	private memoryApi: MemoryAPI;
	private skillRegistry: SkillRegistry;
	private subagentManager?: SubagentManager;
	private lspEngine?: LSPDiagnosticsEngine;
	private session: ReplSession;
	private slashCommands: SlashCommandRegistry;
	private statusBar: StatusBar;
	private streamRenderer: StreamRenderer;
	private spinner: Spinner;

	private rl: readline.Interface | null = null;
	private isGenerating = false;
	private currentAbortController: AbortController | null = null;
	private lastSigintTime = 0;
	private closed = false;

	constructor(options: ReplOptions = {}) {
		this.options = options;
		this.projectRoot = options.projectRoot || process.cwd();
		this.inputStream = options.input || process.stdin;
		this.outputStream = options.output || process.stdout;
		this.isTTY = options.isTTY !== undefined ? options.isTTY : Boolean((this.outputStream as any)?.isTTY);

		// Read package version
		try {
			const __dirname = path.dirname(fileURLToPath(import.meta.url));
			const pkgPath = path.join(__dirname, "..", "..", "package.json");
			if (fs.existsSync(pkgPath)) {
				const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
				this.version = pkg.version || "0.0.0";
			}
		} catch {
			this.version = "0.0.0";
		}

		// 1. Config System
		const globalConfigPath = getConfigPath();
		const globalConfig = loadConfig(globalConfigPath);
		const projectConfig = getProjectConfig(this.projectRoot);
		this.config = mergeConfigs(globalConfig, projectConfig || {});

		// 2. Provider Registry & Model Resolution
		let providerName = options.providerName || this.config.defaultProvider || "default";
		this.providerRegistry = ProviderRegistry.fromConfig(this.config);
		this.currentProvider = this.providerRegistry.get(providerName);

		// If default provider is missing, fallback to any available registered provider
		const registeredNames = this.providerRegistry.list();
		if (!this.currentProvider && registeredNames.length > 0) {
			providerName = registeredNames.includes(this.config.defaultProvider)
				? this.config.defaultProvider
				: registeredNames[0];
			this.currentProvider = this.providerRegistry.get(providerName);
			this.config.defaultProvider = providerName;
		}

		const providerConfig = this.config.providers?.[providerName];
		this.currentModel = options.modelName || providerConfig?.model || "dots-studio/dots-3-note-preview:free";

		// 3. Security & Control Layer
		const effectiveApprovalMode: ReplApprovalMode =
			options.approvalMode || "auto";
		this.controlLayer = new ControlLayer({
			approvalMode: effectiveApprovalMode,
			projectRoot: this.projectRoot,
		});

		const initialMode: ReplMode = options.planMode || (this.config as any).mode === "plan" ? "plan" : "build";
		if (initialMode === "plan") {
			this.controlLayer.getModeController().setMode("plan");
		}

		// 4. Memory API
		this.memoryApi = new MemoryAPI();

		// 5. Skill Registry
		this.skillRegistry =
			SkillRegistry.getActiveForProject(this.projectRoot) || new SkillRegistry();

		// 6. Tool Registry & Subsystem Tool Bindings
		this.toolRegistry = new ToolRegistry();
		registerBuiltinTools(this.toolRegistry, this.projectRoot);
		this.toolRegistry.register(createRememberTool(this.memoryApi));
		this.toolRegistry.register(createRecallTool(this.memoryApi));
		registerSkillTools(this.toolRegistry, this.skillRegistry);

		// 7. Subagent Manager
		if (this.currentProvider) {
			this.subagentManager = new SubagentManager({
				provider: this.currentProvider,
				toolRegistry: this.toolRegistry,
				defaultModel: this.currentModel,
				projectRoot: this.projectRoot,
			});
			registerSubagentTools(this.toolRegistry, this.subagentManager);
		}

		// 8. LSP Diagnostics Engine
		try {
			this.lspEngine = new LSPDiagnosticsEngine({ projectRoot: this.projectRoot });
			registerLSPTools(this.toolRegistry, this.lspEngine);
		} catch {
			// LSP engine optional in non-TS directories
		}

		// 9. Context Manager & Multi-Turn Session
		this.contextManager = new ContextManager({
			projectRoot: this.projectRoot,
			maxTokens: (this.config as any).maxTokens || 128000,
		});

		this.session = new ReplSession({
			providerName,
			modelName: this.currentModel,
			mode: initialMode,
			approvalMode: effectiveApprovalMode,
			projectRoot: this.projectRoot,
			contextManager: this.contextManager,
		});

		// 10. Slash Command Registry
		this.slashCommands = createDefaultRegistry();

		// 11. UI Components (Status Bar, Renderer, Spinner)
		this.statusBar = new StatusBar({
			stream: this.outputStream,
			isTTY: this.isTTY,
			state: this.session.getState(),
		});

		this.streamRenderer = new StreamRenderer({
			output: this.outputStream,
			isTTY: this.isTTY,
		});

		this.spinner = new Spinner({
			stream: this.outputStream,
			isTTY: this.isTTY,
		});
	}

	/**
	 * Get the active REPL session
	 */
	public getSession(): ReplSession {
		return this.session;
	}

	/**
	 * Get the live status bar
	 */
	public getStatusBar(): StatusBar {
		return this.statusBar;
	}

	/**
	 * Get the stream terminal renderer
	 */
	public getStreamRenderer(): StreamRenderer {
		return this.streamRenderer;
	}

	/**
	 * Get the control layer
	 */
	public getControlLayer(): ControlLayer {
		return this.controlLayer;
	}

	/**
	 * Get the tool registry
	 */
	public getToolRegistry(): ToolRegistry {
		return this.toolRegistry;
	}

	/**
	 * Get the provider registry
	 */
	public getProviderRegistry(): ProviderRegistry {
		return this.providerRegistry;
	}

	/**
	 * Get the active provider instance
	 */
	public getCurrentProvider(): Provider | undefined {
		return this.currentProvider;
	}

	/**
	 * Get the active model name
	 */
	public getCurrentModel(): string {
		return this.currentModel;
	}

	/**
	 * Get the skill registry
	 */
	public getSkillRegistry(): SkillRegistry {
		return this.skillRegistry;
	}

	/**
	 * Get the subagent manager
	 */
	public getSubagentManager(): SubagentManager | undefined {
		return this.subagentManager;
	}

	/**
	 * Get the LSP diagnostics engine
	 */
	public getLSPEngine(): LSPDiagnosticsEngine | undefined {
		return this.lspEngine;
	}

	/**
	 * Switch the active provider and model
	 */
	public setProvider(provider: Provider, model: string): void {
		this.currentProvider = provider;
		this.currentModel = model;
		this.session.setProvider(provider.name, model);
		this.statusBar.update(this.session.getState());
	}

	/**
	 * Switch execution mode (plan vs build)
	 */
	public setMode(mode: ReplMode): void {
		this.session.setMode(mode);
		this.controlLayer.getModeController().setMode(mode);
		this.statusBar.update(this.session.getState());
	}

	/**
	 * Switch approval mode (auto, manual, yolo)
	 */
	public setApprovalMode(mode: ReplApprovalMode): void {
		this.session.setApprovalMode(mode);
		this.controlLayer.getApprovalGate().setMode(mode);
		this.statusBar.update(this.session.getState());
	}

	/**
	 * Returns true if an agent turn is currently actively generating
	 */
	public isTurnGenerating(): boolean {
		return this.isGenerating;
	}

	/**
	 * Aborts the current generating turn without exiting the REPL
	 */
	public abortCurrentTurn(): void {
		if (this.currentAbortController && this.isGenerating) {
			this.currentAbortController.abort();
		}
	}

	/**
	 * Prints the interactive welcome banner and initial status
	 */
	private renderWelcome(): void {
		if (this.options.welcomeMessage === false) return;

		const state = this.session.getState();
		const banner = `
╭─────────────────────────────────────────────────────────────╮
│  🤖 my-harness AI Agent REPL v${this.version.padEnd(28)} │
│  Type /help for available commands or ask a question.       │
╰─────────────────────────────────────────────────────────────╯
`;
		if (this.isTTY) {
			this.outputStream.write(chalk.cyan(banner) + "\n");
			this.statusBar.render();
			this.outputStream.write("\n\n");
		} else {
			this.outputStream.write(`my-harness REPL v${this.version}\n`);
		}
	}

	/**
	 * Execute a single prompt or command turn directly
	 */
	public async executeInput(rawInput: string): Promise<boolean> {
		const trimmed = rawInput.trim();
		if (!trimmed) {
			return false;
		}

		// 1. Slash command or Shell Passthrough
		if (this.slashCommands.isCommand(trimmed)) {
			const cmdContext: CommandContext = {
				session: this.session,
				controlLayer: this.controlLayer,
				contextManager: this.contextManager,
				providerRegistry: this.providerRegistry,
				skillRegistry: this.skillRegistry,
				currentProvider: this.currentProvider,
				currentModel: this.currentModel,
				output: (text: string) => {
					this.outputStream.write(text);
				},
				setProvider: (p: Provider, m: string) => {
					this.setProvider(p, m);
				},
				setMode: (mode: ReplMode) => {
					this.setMode(mode);
				},
				setApprovalMode: (mode: ReplApprovalMode) => {
					this.setApprovalMode(mode);
				},
				clearScreen: () => {
					if (this.isTTY) {
						this.outputStream.write("\x1Bc");
					}
				},
			};

			const result = await this.slashCommands.execute(trimmed, cmdContext);
			this.statusBar.update(this.session.getState());
			if (result.shouldExit) {
				return true; // Should exit REPL
			}
			return false;
		}

		// 2. Regular Conversational Agent Turn
		await this.executeTurn(trimmed);
		this.statusBar.update(this.session.getState());
		return false;
	}

	/**
	 * Execute an agent conversation turn with multi-turn message history,
	 * tool execution loops, live streaming/cards, and token/cost accounting.
	 */
	public async executeTurn(prompt: string): Promise<void> {
		if (!prompt.trim()) return;

		if (!this.currentProvider) {
			const errorMsg = `No active provider configured. Use /model <model> <provider> or configure a provider.`;
			this.streamRenderer.writeEvent({
				type: "error",
				error: new Error(errorMsg),
			});
			return;
		}

		this.isGenerating = true;
		this.currentAbortController = new AbortController();
		const { signal } = this.currentAbortController;

		const turnStartTime = Date.now();
		let turnInputTokens = 0;
		let turnOutputTokens = 0;
		let assistantResponseText = "";
		const turnToolEvents: LoopEvent[] = [];

		if (this.isTTY) {
			this.spinner.start("Thinking...");
		}

		try {
			// 1. Prepare tool executors with ControlLayer validation
			const toolDefinitions = this.toolRegistry.getDefinitions();
			const controlLayer = this.controlLayer;
			const toolExecutors: ToolExecutor[] = this.toolRegistry.getExecutors().map((executor) => ({
				name: executor.name,
				execute: async (input: Record<string, unknown>) => {
					const check = await controlLayer.checkToolCall(executor.name, input);
					if (!check.permitted) {
						return {
							result: `[Control Denied]: ${check.reason || "Operation not permitted"}`,
							isError: true,
						};
					}
					return executor.execute(check.sanitizedInput || input);
				},
			}));

			// 2. Prepare message history with full multi-turn context
			const previousMessages = this.session.getMessages();
			const turnMessages: Message[] = [...previousMessages];
			const userMsg: Message = {
				role: "user",
				content: [{ type: "text", text: prompt }],
			};
			turnMessages.push(userMsg);

			let iterations = 0;
			const maxIterations = (this.config as any).maxIterations || 50;
			let turnComplete = false;

			while (iterations < maxIterations && !turnComplete) {
				if (signal.aborted) {
					if (this.isTTY) this.spinner.stop();
					this.streamRenderer.writeEvent({
						type: "error",
						error: new Error("Turn interrupted by user."),
					});
					break;
				}

				iterations++;

				const callConfig: ProviderCallConfig = {
					model: this.currentModel,
					systemPrompt:
						(this.config as any).systemPrompt ||
						getSystemEnvironmentPrompt(this.projectRoot),
					maxTokens: (this.config as any).maxTokens,
				};

				const response: ProviderResponse = await this.currentProvider.chat(
					turnMessages,
					toolDefinitions,
					callConfig,
				);

				if (signal.aborted) {
					if (this.isTTY) this.spinner.stop();
					this.streamRenderer.writeEvent({
						type: "error",
						error: new Error("Turn interrupted by user."),
					});
					break;
				}

				if (this.isTTY) {
					this.spinner.stop();
				}

				if (response.usage) {
					turnInputTokens += response.usage.inputTokens || 0;
					turnOutputTokens += response.usage.outputTokens || 0;
				}

				// Append assistant response to turn messages
				turnMessages.push({ role: "assistant", content: response.content });

				const toolUseBlocks = response.content.filter((block) => block.type === "tool_use");

				if (toolUseBlocks.length === 0) {
					// Non-tool response: extract text and render markdown
					const textBlocks = response.content.filter((b) => b.type === "text");
					assistantResponseText = textBlocks.map((b) => ("text" in b ? b.text : "")).join("\n");

					if (assistantResponseText) {
						this.streamRenderer.writeEvent({
							type: "response",
							text: assistantResponseText,
						});
					}
					turnComplete = true;
					break;
				}

				// Tool call execution
				const toolResults: ContentBlock[] = [];

				for (const block of toolUseBlocks) {
					if (block.type !== "tool_use") continue;
					if (signal.aborted) break;

					const callEvent: LoopEvent = {
						type: "tool_call",
						toolName: block.name,
						toolInput: block.input,
						toolUseId: block.id,
					};
					turnToolEvents.push(callEvent);
					this.streamRenderer.writeEvent(callEvent);

					if (this.isTTY) {
						this.spinner.start(`Executing tool: ${block.name}...`);
					}

					const executor = toolExecutors.find((t) => t.name === block.name);
					let resultStr = "";
					let isError = false;

					if (!executor) {
						resultStr = `Tool not found: ${block.name}`;
						isError = true;
					} else {
						try {
							const res = await executor.execute(block.input);
							resultStr = res.result;
							isError = res.isError;
						} catch (err: any) {
							resultStr = `Error executing tool: ${err.message}`;
							isError = true;
						}
					}

					if (this.isTTY) {
						this.spinner.stop();
					}

					const resultEvent: LoopEvent = {
						type: "tool_result",
						toolUseId: block.id,
						toolName: block.name,
						result: resultStr,
						isError,
					};
					turnToolEvents.push(resultEvent);
					this.streamRenderer.writeEvent(resultEvent);

					toolResults.push({
						type: "tool_result",
						toolUseId: block.id,
						content: resultStr,
						isError,
					});
				}

				if (signal.aborted) {
					this.streamRenderer.writeEvent({
						type: "error",
						error: new Error("Turn interrupted by user."),
					});
					break;
				}

				const toolMsg: Message = { role: "tool", content: toolResults };
				turnMessages.push(toolMsg);
			}

			if (iterations >= maxIterations && !turnComplete) {
				this.streamRenderer.writeEvent({
					type: "error",
					error: new Error(`Max iterations (${maxIterations}) reached.`),
				});
			}

			const durationMs = Date.now() - turnStartTime;

			// Record completed turn into session
			this.session.addTurn(
				prompt,
				assistantResponseText,
				{ inputTokens: turnInputTokens, outputTokens: turnOutputTokens },
				turnToolEvents,
				durationMs,
			);

			this.statusBar.update(this.session.getState(), { lastCommandDurationMs: durationMs });
		} catch (err: any) {
			if (this.isTTY) {
				this.spinner.stop();
			}
			this.streamRenderer.writeEvent({
				type: "error",
				error: err instanceof Error ? err : new Error(String(err)),
			});
		} finally {
			if (this.isTTY) {
				this.spinner.stop();
			}
			this.isGenerating = false;
			this.currentAbortController = null;
		}
	}

	/**
	 * Starts the interactive REPL readline loop
	 */
	public async start(): Promise<void> {
		this.renderWelcome();

		if (this.isTTY) {
			this.statusBar.start();
		}

		this.rl = readline.createInterface({
			input: this.inputStream as NodeJS.ReadableStream,
			output: this.outputStream as NodeJS.WritableStream,
			prompt: this.isTTY ? "harness> " : "",
			terminal: this.isTTY,
		});

		// Setup Ctrl+C (SIGINT) handler
		this.rl.on("SIGINT", () => {
			if (this.isGenerating) {
				this.abortCurrentTurn();
				this.outputStream.write("\n[Generation interrupted]\n");
				this.lastSigintTime = 0;
				if (this.isTTY && this.rl) {
					this.rl.prompt();
				}
				return;
			}

			const now = Date.now();
			if (now - this.lastSigintTime < 2000) {
				this.outputStream.write("\nExiting harness REPL. Goodbye!\n");
				this.stop();
			} else {
				this.lastSigintTime = now;
				this.outputStream.write("\n(Press Ctrl+C again or type /exit to quit)\n");
				if (this.isTTY && this.rl) {
					this.rl.prompt();
				}
			}
		});

		// Multiline accumulators
		let multilineBuffer: string[] = [];
		let inTripleQuote = false;
		let quoteDelimiter: "'''" | '"""' | null = null;

		if (this.isTTY) {
			this.rl.prompt();
		}

		try {
			for await (const rawLine of this.rl) {
				if (this.closed) break;

				const line = rawLine.replace(/\r$/, "");

				// Handle Multiline: inside triple quotes
				if (inTripleQuote && quoteDelimiter) {
					if (line.includes(quoteDelimiter)) {
						const parts = line.split(quoteDelimiter);
						multilineBuffer.push(parts[0]);
						const fullPrompt = multilineBuffer.join("\n");
						multilineBuffer = [];
						inTripleQuote = false;
						quoteDelimiter = null;

						const shouldExit = await this.executeInput(fullPrompt);
						if (shouldExit) {
							break;
						}
					} else {
						multilineBuffer.push(line);
					}

					if (this.isTTY && this.rl && inTripleQuote) {
						this.rl.setPrompt("... ");
						this.rl.prompt();
					} else if (this.isTTY && this.rl) {
						this.rl.setPrompt("harness> ");
						this.rl.prompt();
					}
					continue;
				}

				// Handle Multiline: trailing backslash continuation
				if (multilineBuffer.length > 0) {
					if (line.endsWith("\\") && !line.endsWith("\\\\")) {
						multilineBuffer.push(line.slice(0, -1));
						if (this.isTTY && this.rl) {
							this.rl.setPrompt("... ");
							this.rl.prompt();
						}
						continue;
					}

					multilineBuffer.push(line);
					const fullPrompt = multilineBuffer.join("\n");
					multilineBuffer = [];

					if (this.isTTY && this.rl) {
						this.rl.setPrompt("harness> ");
					}

					const shouldExit = await this.executeInput(fullPrompt);
					if (shouldExit) {
						break;
					}

					if (this.isTTY && this.rl) {
						this.rl.prompt();
					}
					continue;
				}

				// Check if starting triple quotes
				const trimmedLine = line.trim();
				if (trimmedLine.startsWith('"""') && (trimmedLine.match(/"""/g) || []).length < 2) {
					inTripleQuote = true;
					quoteDelimiter = '"""';
					multilineBuffer.push(trimmedLine.slice(3));
					if (this.isTTY && this.rl) {
						this.rl.setPrompt("... ");
						this.rl.prompt();
					}
					continue;
				}

				if (trimmedLine.startsWith("'''") && (trimmedLine.match(/'''/g) || []).length < 2) {
					inTripleQuote = true;
					quoteDelimiter = "'''";
					multilineBuffer.push(trimmedLine.slice(3));
					if (this.isTTY && this.rl) {
						this.rl.setPrompt("... ");
						this.rl.prompt();
					}
					continue;
				}

				// Check if line ends with single backslash
				if (line.endsWith("\\") && !line.endsWith("\\\\")) {
					multilineBuffer.push(line.slice(0, -1));
					if (this.isTTY && this.rl) {
						this.rl.setPrompt("... ");
						this.rl.prompt();
					}
					continue;
				}

				// Process normal single line
				const shouldExit = await this.executeInput(line);
				if (shouldExit) {
					break;
				}

				if (this.isTTY && this.rl) {
					this.rl.prompt();
				}
			}
		} finally {
			this.stop();
		}
	}

	/**
	 * Stops the REPL, cleans up status bar and readline listeners
	 */
	public stop(): void {
		if (this.closed) return;
		this.closed = true;

		this.spinner.stop();
		this.statusBar.stop();

		if (this.rl) {
			this.rl.close();
			this.rl = null;
		}
	}
}

/**
 * Entry point to initialize and start the interactive REPL
 */
export async function startRepl(options: ReplOptions = {}): Promise<void> {
	const engine = new ReplEngine(options);
	await engine.start();
}
