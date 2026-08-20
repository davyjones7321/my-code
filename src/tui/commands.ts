import { spawn as nodeSpawn } from "node:child_process";
import { SkillRegistry } from "../skills/registry.ts";
import { formatCost } from "./cost.ts";
import type {
	CommandContext,
	CommandResult,
	ReplMode,
	SlashCommand,
} from "./types.ts";

/**
 * Executes a shell command with ControlLayer safety gating and timeout protection.
 */
export async function executeShellPassthrough(
	input: string,
	context: CommandContext,
	options?: { timeoutMs?: number; cwd?: string },
): Promise<CommandResult> {
	const rawCommand = input.trim().startsWith("!") ? input.trim().slice(1).trim() : input.trim();

	if (!rawCommand) {
		const msg = "Error: No shell command specified after '!'";
		context.output(`${msg}\n`);
		return { handled: true, message: msg };
	}

	// 1. Gating through ControlLayer if available
	if (context.controlLayer) {
		const check = await context.controlLayer.checkToolCall("run_command", { command: rawCommand });
		if (!check.permitted) {
			const reason = check.reason || "Operation denied by safety policies";
			const deniedMsg = `[Control Denied]: ${reason}`;
			context.output(`${deniedMsg}\n`);
			return { handled: true, message: deniedMsg };
		}
	}

	// 2. Resolve working directory
	const projectRoot =
		options?.cwd ||
		(context.session && typeof (context.session as any).getState === "function"
			? (context.session as any).getState().projectRoot
			: undefined) ||
		process.cwd();

	const timeoutMs = options?.timeoutMs || 30000;
	const isWindows = process.platform === "win32";
	const shell = isWindows ? "cmd" : "sh";
	const shellArgs = isWindows ? ["/c", rawCommand] : ["-c", rawCommand];

	context.output(`$ ${rawCommand}\n`);

	try {
		// Use Bun.spawn if available in Bun runtime, otherwise fallback to Node child_process
		if (typeof Bun !== "undefined" && typeof Bun.spawn === "function") {
			const proc = Bun.spawn([shell, ...shellArgs], {
				cwd: projectRoot,
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
			});

			return await new Promise<CommandResult>((resolve) => {
				let isTimeout = false;
				const timer = setTimeout(() => {
					isTimeout = true;
					try {
						proc.kill();
					} catch {}
					const timeoutMsg = `Command timed out after ${timeoutMs}ms.`;
					context.output(`${timeoutMsg}\n`);
					resolve({ handled: true, message: timeoutMsg });
				}, timeoutMs);

				(async () => {
					try {
						const stdout = await new Response(proc.stdout).text();
						const stderr = await new Response(proc.stderr).text();
						const exitCode = await proc.exited;

						clearTimeout(timer);
						if (isTimeout) return;

						if (stdout) {
							context.output(stdout.endsWith("\n") ? stdout : `${stdout}\n`);
						}
						if (stderr) {
							context.output(stderr.endsWith("\n") ? stderr : `${stderr}\n`);
						}

						let resultMsg = "";
						if (exitCode !== 0) {
							const exitMsg = `[Process exited with code ${exitCode}]`;
							context.output(`${exitMsg}\n`);
							resultMsg = exitMsg;
						}

						resolve({
							handled: true,
							message: resultMsg || stdout || stderr || `Exited with code ${exitCode}`,
						});
					} catch (err: any) {
						clearTimeout(timer);
						if (!isTimeout) {
							const errMsg = `Error running command: ${err.message}`;
							context.output(`${errMsg}\n`);
							resolve({ handled: true, message: errMsg });
						}
					}
				})();
			});
		} else {
			// Node.js fallback
			return await new Promise<CommandResult>((resolve) => {
				const child = nodeSpawn(shell, shellArgs, {
					cwd: projectRoot,
					stdio: ["pipe", "pipe", "pipe"],
				});

				let stdout = "";
				let stderr = "";
				let isTimeout = false;

				const timer = setTimeout(() => {
					isTimeout = true;
					child.kill();
					const timeoutMsg = `Command timed out after ${timeoutMs}ms.`;
					context.output(`${timeoutMsg}\n`);
					resolve({ handled: true, message: timeoutMsg });
				}, timeoutMs);

				child.stdout?.on("data", (data) => {
					stdout += data.toString();
				});
				child.stderr?.on("data", (data) => {
					stderr += data.toString();
				});

				child.on("close", (code) => {
					clearTimeout(timer);
					if (isTimeout) return;

					if (stdout) {
						context.output(stdout.endsWith("\n") ? stdout : `${stdout}\n`);
					}
					if (stderr) {
						context.output(stderr.endsWith("\n") ? stderr : `${stderr}\n`);
					}

					let resultMsg = "";
					if (code !== 0) {
						const exitMsg = `[Process exited with code ${code}]`;
						context.output(`${exitMsg}\n`);
						resultMsg = exitMsg;
					}

					resolve({
						handled: true,
						message: resultMsg || stdout || stderr || `Exited with code ${code}`,
					});
				});

				child.on("error", (err) => {
					clearTimeout(timer);
					if (!isTimeout) {
						const errMsg = `Error running command: ${err.message}`;
						context.output(`${errMsg}\n`);
						resolve({ handled: true, message: errMsg });
					}
				});
			});
		}
	} catch (err: any) {
		const errMsg = `Error executing shell command: ${err.message}`;
		context.output(`${errMsg}\n`);
		return { handled: true, message: errMsg };
	}
}

/**
 * Built-in Slash Commands
 */

export const helpCommand: SlashCommand = {
	name: "help",
	aliases: ["h", "?"],
	description: "Show available slash commands and usage examples",
	usage: "/help",
	execute: (_args, context) => {
		const commands = [
			{ cmd: "/help, /h, /?", desc: "Show available slash commands and usage" },
			{ cmd: "/clear, /cls", desc: "Clear the terminal viewport" },
			{ cmd: "/exit, /quit, /q", desc: "Exit the REPL session" },
			{ cmd: "/history, /hist", desc: "Print turn history, tokens, and response previews" },
			{ cmd: "/reset, /restart", desc: "Clear conversation history and reset session metrics" },
			{ cmd: "/model [name] [provider]", desc: "Inspect current model or switch model/provider" },
			{ cmd: "/usage, /stats", desc: "Output token usage breakdown, context %, cost, and duration" },
			{ cmd: "/skills, /sk", desc: "List discovered and active agent skills" },
			{ cmd: "/mode [plan|build]", desc: "Inspect or toggle agent mode (plan vs build)" },
			{ cmd: "!<command>", desc: "Execute shell command with safety approval (e.g. !git status)" },
		];

		let output = "\n=== Available Commands ===\n";
		for (const c of commands) {
			output += `  ${c.cmd.padEnd(28)} ${c.desc}\n`;
		}
		output += "\n";

		context.output(output);
		return { handled: true };
	},
};

export const clearCommand: SlashCommand = {
	name: "clear",
	aliases: ["cls"],
	description: "Clear terminal viewport",
	usage: "/clear",
	execute: (_args, context) => {
		context.output("\x1Bc");
		if (typeof context.clearScreen === "function") {
			context.clearScreen();
		}
		return { handled: true };
	},
};

export const exitCommand: SlashCommand = {
	name: "exit",
	aliases: ["quit", "q"],
	description: "Exit REPL session",
	usage: "/exit",
	execute: (_args, context) => {
		context.output("Exiting harness REPL. Goodbye!\n");
		return { handled: true, shouldExit: true, message: "Exiting session." };
	},
};

export const historyCommand: SlashCommand = {
	name: "history",
	aliases: ["hist"],
	description: "Print conversation turn history with timestamps, tokens, and previews",
	usage: "/history",
	execute: (_args, context) => {
		const session = context.session as any;
		const turns = typeof session.getTurns === "function" ? session.getTurns() : [];

		if (!turns || turns.length === 0) {
			context.output("No conversation turns recorded in this session.\n");
			return { handled: true };
		}

		let output = `\n=== Session Turn History (${turns.length} turn${turns.length === 1 ? "" : "s"}) ===\n`;

		for (const turn of turns) {
			const dateStr = new Date(turn.timestamp).toLocaleTimeString();
			const costStr = formatCost(turn.cost);
			output += `\n[Turn ${turn.turnIndex}] ${dateStr} | Tokens: ${turn.totalTokens.toLocaleString()} (In: ${turn.inputTokens.toLocaleString()}, Out: ${turn.outputTokens.toLocaleString()}) | Cost: ${costStr}\n`;

			const userPreview =
				turn.userPrompt && turn.userPrompt.length > 100
					? turn.userPrompt.slice(0, 100) + "..."
					: turn.userPrompt || "";
			const assistantPreview =
				turn.assistantResponse && turn.assistantResponse.length > 150
					? turn.assistantResponse.slice(0, 150) + "..."
					: turn.assistantResponse || "";

			output += `  👤 User: "${userPreview.replace(/\n/g, " ")}"\n`;
			output += `  🤖 Assistant: "${assistantPreview.replace(/\n/g, " ")}"\n`;
		}
		output += "\n";

		context.output(output);
		return { handled: true };
	},
};

export const resetCommand: SlashCommand = {
	name: "reset",
	aliases: ["restart"],
	description: "Clear conversation history and reset session token metrics",
	usage: "/reset",
	execute: (_args, context) => {
		if (context.session && typeof context.session.reset === "function") {
			context.session.reset();
		}
		if (context.contextManager && typeof context.contextManager.reset === "function") {
			context.contextManager.reset();
		}

		context.output("Session conversation history and token metrics have been reset.\n");
		return { handled: true };
	},
};

export const modelCommand: SlashCommand = {
	name: "model",
	aliases: ["m"],
	description: "Inspect current model or switch active model and provider",
	usage: "/model [model-name] [provider-name]",
	execute: (args, context) => {
		const state = context.session?.getState() || {
			modelName: context.currentModel || "default",
			providerName: context.currentProvider?.name || "default",
		};

		if (args.length === 0) {
			let output = `\n=== Model Configuration ===\n`;
			output += `Active Model:    ${state.modelName}\n`;
			output += `Active Provider: ${state.providerName}\n`;

			if (context.providerRegistry && typeof context.providerRegistry.list === "function") {
				const available = context.providerRegistry.list();
				output += `Configured Providers: ${available.join(", ") || "none"}\n`;
			}
			output += `\nUsage: /model <model-name> [provider-name]\n\n`;

			context.output(output);
			return { handled: true };
		}

		const newModel = args[0].trim();
		const newProvider = args.length > 1 ? args[1].trim() : undefined;

		if (context.session && typeof (context.session as any).setModel === "function") {
			(context.session as any).setModel(newModel, newProvider);
		}

		if (newProvider && context.providerRegistry && context.setProvider) {
			const prov = context.providerRegistry.get(newProvider);
			if (prov) {
				context.setProvider(prov, newModel);
			} else {
				context.output(
					`Warning: Provider "${newProvider}" not found in registry. Model name set to "${newModel}".\n`,
				);
				return { handled: true };
			}
		} else if (context.setProvider && context.currentProvider) {
			context.setProvider(context.currentProvider, newModel);
		}

		context.output(
			`Active model updated to: ${newModel}${newProvider ? ` (Provider: ${newProvider})` : ""}\n`,
		);
		return { handled: true };
	},
};

export const usageCommand: SlashCommand = {
	name: "usage",
	aliases: ["tokens", "cost", "stats"],
	description: "Output formatted token breakdown, context %, cost, and duration",
	usage: "/usage",
	execute: (_args, context) => {
		const state = context.session?.getState() || {
			turnCount: 0,
			inputTokens: 0,
			outputTokens: 0,
			totalTokens: 0,
			estimatedCost: 0,
			startTime: Date.now(),
		};

		const tokenUsage =
			typeof (context.session as any)?.getTokenUsage === "function"
				? (context.session as any).getTokenUsage()
				: context.contextManager?.getTokenUsage?.() || {
						estimated: state.totalTokens,
						budget: 128000,
						percentage: (state.totalTokens / 128000) * 100,
				  };

		const durationMs =
			typeof (context.session as any)?.getDurationMs === "function"
				? (context.session as any).getDurationMs()
				: Math.max(0, Date.now() - state.startTime);

		const durationSec = Math.floor(durationMs / 1000);
		const mins = Math.floor(durationSec / 60);
		const secs = durationSec % 60;
		const formattedDuration = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

		let output = `\n=== Session Usage Metrics ===\n`;
		output += `Turn Count:       ${state.turnCount}\n`;
		output += `Input Tokens:     ${state.inputTokens.toLocaleString()}\n`;
		output += `Output Tokens:    ${state.outputTokens.toLocaleString()}\n`;
		output += `Total Tokens:     ${state.totalTokens.toLocaleString()}\n`;
		output += `Context Usage:    ${tokenUsage.estimated.toLocaleString()} / ${tokenUsage.budget.toLocaleString()} tokens (${tokenUsage.percentage.toFixed(1)}%)\n`;
		output += `Estimated Cost:   ${formatCost(state.estimatedCost)}\n`;
		output += `Session Duration: ${formattedDuration}\n\n`;

		context.output(output);
		return { handled: true };
	},
};

export const skillsCommand: SlashCommand = {
	name: "skills",
	aliases: ["sk"],
	description: "List discovered and active agent skills",
	usage: "/skills",
	execute: (_args, context) => {
		const registry =
			context.skillRegistry ||
			SkillRegistry.getActiveForProject(process.cwd()) ||
			new SkillRegistry();

		const index = registry.getSkillIndex();
		const activeNames = new Set(registry.getActiveSkills().map((s) => s.frontmatter.name));

		if (index.length === 0) {
			context.output("No skills discovered in project or global skill locations.\n");
			return { handled: true };
		}

		let output = `\n=== Discovered Skills (${index.length}) ===\n`;
		for (const skill of index) {
			const isActive = activeNames.has(skill.name);
			const statusBadge = isActive ? "[active]" : "[inactive]";
			const scopeBadge = `[${skill.scope}]`;
			const triggers =
				skill.triggers && skill.triggers.length > 0
					? ` (Triggers: ${skill.triggers.join(", ")})`
					: "";

			output += `* ${skill.name} ${scopeBadge} ${statusBadge}\n`;
			output += `  ${skill.description}${triggers}\n`;
		}
		output += "\n";

		context.output(output);
		return { handled: true };
	},
};

export const modeCommand: SlashCommand = {
	name: "mode",
	aliases: [],
	description: "Inspect or toggle agent mode (plan vs build)",
	usage: "/mode [plan|build]",
	execute: (args, context) => {
		const currentState = context.session?.getState();
		const currentMode: ReplMode = currentState?.mode || "build";

		let targetMode: ReplMode;

		if (args.length === 0) {
			// Toggle mode
			targetMode = currentMode === "plan" ? "build" : "plan";
		} else {
			const requested = args[0].toLowerCase().trim();
			if (requested !== "plan" && requested !== "build") {
				context.output(`Invalid mode: "${args[0]}". Valid modes are "plan" or "build".\n`);
				return { handled: true };
			}
			targetMode = requested as ReplMode;
		}

		// Apply mode changes
		if (context.session && typeof (context.session as any).setMode === "function") {
			(context.session as any).setMode(targetMode);
		}
		if (context.controlLayer?.getModeController()) {
			context.controlLayer.getModeController().setMode(targetMode);
		}
		if (typeof context.setMode === "function") {
			context.setMode(targetMode);
		}

		const modeDesc =
			targetMode === "plan"
				? "Read-only / Non-destructive mode"
				: "Full execution mode (editing, shell commands, tools enabled)";

		context.output(`Agent mode set to: [${targetMode.toUpperCase()}] (${modeDesc})\n`);
		return { handled: true };
	},
};

export const BUILTIN_COMMANDS: SlashCommand[] = [
	helpCommand,
	clearCommand,
	exitCommand,
	historyCommand,
	resetCommand,
	modelCommand,
	usageCommand,
	skillsCommand,
	modeCommand,
];

/**
 * SlashCommandRegistry
 *
 * Manages registration, alias lookup, parsing, and execution dispatch
 * for slash commands and shell passthrough commands.
 */
export class SlashCommandRegistry {
	private commands: Map<string, SlashCommand> = new Map();
	private aliasMap: Map<string, string> = new Map();

	constructor(options?: { registerBuiltins?: boolean }) {
		if (options?.registerBuiltins !== false) {
			this.registerBuiltins();
		}
	}

	/**
	 * Register all standard built-in slash commands
	 */
	public registerBuiltins(): void {
		for (const cmd of BUILTIN_COMMANDS) {
			this.register(cmd);
		}
	}

	/**
	 * Register a slash command
	 */
	public register(command: SlashCommand): void {
		const canonical = this.normalizeName(command.name);
		this.commands.set(canonical, command);

		if (command.aliases && Array.isArray(command.aliases)) {
			for (const alias of command.aliases) {
				const normAlias = this.normalizeName(alias);
				this.aliasMap.set(normAlias, canonical);
			}
		}
	}

	/**
	 * Lookup a command by name or alias
	 */
	public get(nameOrAlias: string): SlashCommand | undefined {
		const key = this.normalizeName(nameOrAlias);
		if (this.commands.has(key)) {
			return this.commands.get(key);
		}
		const canonical = this.aliasMap.get(key);
		if (canonical) {
			return this.commands.get(canonical);
		}
		return undefined;
	}

	/**
	 * List all unique registered slash commands
	 */
	public list(): SlashCommand[] {
		return Array.from(this.commands.values());
	}

	/**
	 * Check if an input line is a slash command
	 */
	public isSlashCommand(input: string): boolean {
		return input.trim().startsWith("/");
	}

	/**
	 * Check if an input line is a shell passthrough command
	 */
	public isShellPassthrough(input: string): boolean {
		return input.trim().startsWith("!");
	}

	/**
	 * Check if an input line is either a slash command or shell passthrough
	 */
	public isCommand(input: string): boolean {
		return this.isSlashCommand(input) || this.isShellPassthrough(input);
	}

	/**
	 * Parse command name and arguments from a raw command string
	 */
	public parseCommand(input: string): { command: string; args: string[]; raw: string } | null {
		const trimmed = input.trim();
		if (!trimmed.startsWith("/")) {
			return null;
		}

		const parts = trimmed
			.slice(1)
			.split(/\s+/)
			.filter((p) => p.length > 0);
		if (parts.length === 0) {
			return { command: "", args: [], raw: trimmed };
		}

		const command = parts[0].toLowerCase();
		const args = parts.slice(1);
		return { command, args, raw: trimmed };
	}

	/**
	 * Execute an input line (slash command or shell passthrough)
	 */
	public async execute(input: string, context: CommandContext): Promise<CommandResult> {
		const trimmed = input.trim();
		if (!trimmed) {
			return { handled: false };
		}

		// 1. Handle Shell Passthrough (!<cmd>)
		if (this.isShellPassthrough(trimmed)) {
			return await executeShellPassthrough(trimmed, context);
		}

		// 2. Handle Slash Commands (/<cmd>)
		if (this.isSlashCommand(trimmed)) {
			const parsed = this.parseCommand(trimmed);
			if (!parsed || !parsed.command) {
				context.output("Empty slash command. Type /help for available commands.\n");
				return { handled: true, message: "Empty command." };
			}

			const command = this.get(parsed.command);
			if (!command) {
				const unknownMsg = `Unknown command: /${parsed.command}. Type /help for available commands.`;
				context.output(`${unknownMsg}\n`);
				return { handled: true, message: unknownMsg };
			}

			try {
				const result = await command.execute(parsed.args, context);
				return result;
			} catch (err: any) {
				const errorMsg = `Error executing /${parsed.command}: ${err.message}`;
				context.output(`${errorMsg}\n`);
				return { handled: true, message: errorMsg };
			}
		}

		// 3. Not a command (regular prompt)
		return { handled: false };
	}

	/**
	 * Normalize a command name or alias
	 */
	private normalizeName(name: string): string {
		return name.trim().replace(/^\//, "").toLowerCase();
	}
}

/**
 * Creates and returns a pre-configured SlashCommandRegistry with all built-ins
 */
export function createDefaultRegistry(): SlashCommandRegistry {
	return new SlashCommandRegistry({ registerBuiltins: true });
}
