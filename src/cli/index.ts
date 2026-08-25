#!/usr/bin/env bun
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { Command } from "commander";
import { type ToolExecutor, runAgentLoop } from "../agent/loop.ts";
import {
	getConfigPath,
	getProjectConfig,
	loadConfig,
	mergeConfigs,
	saveConfig,
} from "../config/index.ts";
import { ControlLayer } from "../control/index.ts";
import { MemoryAPI } from "../memory/api.ts";
import { createRecallTool, createRememberTool } from "../memory/tools.ts";
import { ProviderRegistry } from "../providers/registry.ts";
import { registerBuiltinTools } from "../tools/defaults.ts";
import { ToolRegistry } from "../tools/registry.ts";
import { startRepl } from "../tui/repl.ts";
import { GatewayServer } from "../gateway/server.ts";
import { registerSkillsCommands } from "./skills.ts";
import { registerCronCommands } from "./cron.ts";
import { registerSetupCommands } from "./setup.ts";
import { formatBuildInfo, getBuildInfo } from "./build-info.ts";

/**
 * Reads all buffered data from process.stdin until EOF
 */
export async function readAllStdin(timeoutMs = 50): Promise<string> {
	return new Promise((resolve) => {
		if (process.stdin.isTTY) {
			resolve("");
			return;
		}

		let data = "";
		let resolved = false;

		const finish = () => {
			if (!resolved) {
				resolved = true;
				if (timer) clearTimeout(timer);
				resolve(data);
			}
		};

		// Safety timer prevents hanging in test runners when stdin is non-TTY but unclosed
		const timer = setTimeout(() => {
			finish();
		}, timeoutMs);

		if (typeof (process.stdin as any).setEncoding === "function") {
			process.stdin.setEncoding("utf8");
		}

		process.stdin.on("data", (chunk) => {
			data += chunk;
			if (timer && typeof timer.refresh === "function") {
				timer.refresh();
			}
		});

		process.stdin.on("end", () => {
			finish();
		});

		process.stdin.on("error", () => {
			finish();
		});

		if (process.stdin.readableEnded) {
			finish();
		}
	});
}

/**
 * Executes a single-shot batch prompt through the agent loop with clean output formatting
 */
export async function executeOneShot(
	prompt: string,
	options: {
		provider?: string;
		model?: string;
		plan?: boolean;
		approval?: "auto" | "manual" | "yolo";
	} = {},
): Promise<void> {
	const isTTY = Boolean(process.stdout.isTTY);

	try {
		const globalConfigPath = getConfigPath();
		const globalConfig = loadConfig(globalConfigPath);
		const projectConfig = getProjectConfig(process.cwd());
		const config = mergeConfigs(globalConfig, projectConfig || {});
		const providerName = options.provider || config.defaultProvider || "default";

		const registry = ProviderRegistry.fromConfig(config);
		const provider = registry.get(providerName);

		if (!provider) {
			const available = registry.list();
			const errorMsg = `\nError: Provider "${providerName}" is not configured.`;
			if (isTTY) {
				console.error(chalk.red(errorMsg));
				if (available.length > 0) {
					console.log(chalk.yellow(`Available configured providers: ${available.join(", ")}`));
				} else {
					console.log(chalk.yellow(`\nPlease configure a provider in ${globalConfigPath}:`));
					console.log(
						chalk.gray(`
[providers.anthropic]
apiKey = "sk-ant-..."
model = "claude-3-7-sonnet-20250219"

[providers.openai]
apiKey = "sk-proj-..."
model = "gpt-4o"

[providers.ollama]
baseUrl = "http://localhost:11434/v1"
model = "deepseek-coder-v2"
apiKey = "ollama"
`),
					);
				}
			} else {
				console.error(errorMsg);
			}
			process.exit(1);
		}

		const providerConfig = config.providers?.[providerName];
		const model = options.model || providerConfig?.model || "default";
		const projectRoot = config.projectRoot || process.cwd();

		// 1. Initialize tool registry with builtin tools
		const toolRegistry = new ToolRegistry();
		registerBuiltinTools(toolRegistry, projectRoot);

		// 2. Add memory tools
		const memoryApi = new MemoryAPI();
		toolRegistry.register(createRememberTool(memoryApi));
		toolRegistry.register(createRecallTool(memoryApi));

		// 3. Setup control layer
		const controlLayer = new ControlLayer({
			approvalMode: options.approval || config.approvalMode || "auto",
			projectRoot,
		});

		if (options.plan) {
			controlLayer.getModeController().setMode("plan");
		}

		// Wrap tool executors with control layer validation
		const toolExecutors: ToolExecutor[] = toolRegistry.getExecutors().map((executor) => ({
			name: executor.name,
			async execute(input: Record<string, unknown>) {
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

		const toolDefinitions = toolRegistry.getDefinitions();

		const loopConfig = {
			maxIterations: config.maxIterations || 50,
			systemPrompt: `You are an expert autonomous AI coding assistant.
You have access to tools for inspecting, editing, searching files, running shell commands, and managing memory.
Always verify your edits and prioritize safety.`,
			tools: toolDefinitions,
		};

		if (isTTY) {
			console.log(
				chalk.blue(
					`\n🚀 Harness active: [Provider: ${providerName} | Model: ${model} | Mode: ${controlLayer.getModeController().getMode()}]`,
				),
			);
			console.log(chalk.gray(`Prompt: "${prompt}"\n`));
		} else {
			console.log(
				`Harness active: [Provider: ${providerName} | Model: ${model} | Mode: ${controlLayer.getModeController().getMode()}]`,
			);
		}

		const loopGenerator = runAgentLoop(provider, prompt, toolExecutors, loopConfig, { model });

		for await (const event of loopGenerator) {
			switch (event.type) {
				case "thinking":
					if (isTTY) {
						console.log(chalk.gray(`🧠 [Thinking] ${event.message}`));
					} else {
						console.log(`[Thinking] ${event.message}`);
					}
					break;
				case "tool_call":
					if (isTTY) {
						console.log(
							chalk.yellow(`🛠️  [Tool Call] ${event.toolName}: ${JSON.stringify(event.toolInput)}`),
						);
					} else {
						console.log(`[Tool Call] ${event.toolName}: ${JSON.stringify(event.toolInput)}`);
					}
					break;
				case "tool_result":
					if (event.isError) {
						if (isTTY) {
							console.log(chalk.red(`❌ [Tool Error] ${event.result}`));
						} else {
							console.log(`[Tool Error] ${event.result}`);
						}
					} else {
						const preview =
							event.result.length > 300
								? event.result.slice(0, 300) + "... (truncated)"
								: event.result;
						if (isTTY) {
							console.log(chalk.green(`✔️  [Tool Result] ${preview}`));
						} else {
							console.log(`[Tool Result] ${preview}`);
						}
					}
					break;
				case "response":
					if (isTTY) {
						console.log(chalk.cyan(`\n💬 [Response]\n${event.text}\n`));
					} else {
						console.log(`\n[Response]\n${event.text}\n`);
					}
					break;
				case "error":
					if (isTTY) {
						console.error(chalk.red(`\n💥 [Error] ${event.error.message}`));
					} else {
						console.error(`\n[Error] ${event.error.message}`);
					}
					break;
				case "done":
					if (isTTY) {
						console.log(
							chalk.magenta(`🏁 [Done] Completed in ${event.totalIterations} iteration(s).\n`),
						);
					} else {
						console.log(`[Done] Completed in ${event.totalIterations} iteration(s).\n`);
					}
					break;
			}
		}

		if ((options as any).verify) {
			const { VerificationEngine } = await import("../verifier/engine.ts");
			const engine = new VerificationEngine(projectRoot);
			const report = await engine.verify();
			if (isTTY) {
				console.log(chalk.bold("\n🔍 Verification Pass:"));
				console.log(report.summary);
			} else {
				console.log(`\nVerification Pass:\n${report.summary}`);
			}
		}
	} catch (error: any) {
		if (isTTY) {
			console.error(chalk.red(`Fatal error: ${error.message}`));
		} else {
			console.error(`Fatal error: ${error.message}`);
		}
		process.exit(1);
	}
}

/**
 * Builds and configures the Commander program
 */
export function buildCli(): Command {
	const prog = new Command();

	// Read package.json for version
	const __dirname = path.dirname(fileURLToPath(import.meta.url));
	const pkgPath = path.join(__dirname, "..", "..", "package.json");
	let version = "0.1.0";
	try {
		const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
		version = pkg.version || "0.1.0";
	} catch {
		// fallback
	}

	prog
		.name("harness")
		.description("A model-agnostic AI agent harness")
		.version(version)
		.option("-p, --provider <name>", "Provider to use (overrides defaultProvider in config)")
		.option("-m, --model <name>", "Model to use (overrides model in config)")
		.option("--plan", "Run in read-only plan mode")
		.option("--approval <mode>", "Tool approval mode (auto, manual, yolo)")
		.option("-i, --interactive", "Launch interactive REPL mode")
		.option("--build-info", "Display build metadata and diagnostic feature status")
		.action(async (options) => {
			if (options.buildInfo) {
				const info = getBuildInfo();
				console.log(formatBuildInfo(info));
				return;
			}
			// Handle piped stdin in headless / non-interactive mode
			if (!process.stdin.isTTY && !options.interactive) {
				const stdinPrompt = await readAllStdin();
				if (stdinPrompt && stdinPrompt.trim()) {
					await executeOneShot(stdinPrompt.trim(), options);
					return;
				}
			}

			// Default action launches interactive REPL
			await startRepl({
				providerName: options.provider,
				modelName: options.model,
				planMode: options.plan,
				approvalMode: options.approval,
				isTTY: process.stdout.isTTY,
			});
		});

	prog
		.command("init")
		.description("Initialize harness config")
		.action(() => {
			const configPath = getConfigPath();
			if (fs.existsSync(configPath)) {
				console.log(chalk.yellow(`Config already exists at ${configPath}`));
				return;
			}

			const defaultConfig = loadConfig(configPath);
			saveConfig(defaultConfig, configPath);
			console.log(chalk.green(`Initialized config at ${configPath}`));
		});

	prog
		.command("serve")
		.description("Launch the Multi-Platform HTTP & WebSocket Gateway Server")
		.option("--port <number>", "Port to listen on (default: 3000)", parseInt)
		.option("--host <string>", "Host to bind to (default: 0.0.0.0)")
		.option("-t, --token <string>", "Bearer token for API authentication")
		.option("-p, --provider <name>", "Default LLM provider")
		.option("-m, --model <name>", "Default LLM model")
		.option("--plan", "Run in read-only plan mode")
		.option("--approval <mode>", "Tool approval mode (auto, manual, yolo)")
		.action(async (options) => {
			const gateway = new GatewayServer({
				port: options.port,
				host: options.host,
				authToken: options.token,
				defaultProvider: options.provider,
				defaultModel: options.model,
				mode: options.plan ? "plan" : "build",
				approvalMode: options.approval,
			});
			const { port, url } = await gateway.start();
			console.log(chalk.bold.green(`\n🌐 Harness Multi-Platform Gateway active at ${url}`));
			console.log(chalk.gray(`- REST API: ${url}/api/v1/sessions`));
			console.log(chalk.gray(`- WebSocket: ws://${options.host || "localhost"}:${port}/api/v1/ws`));
			if (options.token) {
				console.log(chalk.yellow(`- Authentication: Bearer token active`));
			}
			console.log(chalk.gray("Press Ctrl+C to stop server.\n"));
		});

	registerSkillsCommands(prog);
	registerCronCommands(prog);
	registerSetupCommands(prog);

	prog
		.command("run [prompt]")
		.description("Run the agent loop with a prompt or launch interactive REPL")
		.option("-p, --provider <name>", "Provider to use (overrides defaultProvider in config)")
		.option("-m, --model <name>", "Model to use (overrides model in config)")
		.option("--plan", "Run in read-only plan mode")
		.option("--approval <mode>", "Tool approval mode (auto, manual, yolo)")
		.option("-v, --verify", "Run verification quality checks after turn")
		.option("-i, --interactive", "Force interactive REPL mode")
		.action(async (prompt, options) => {
			const mergedOpts = { ...prog.opts(), ...(options || {}) };
			// If no prompt was provided or interactive flag passed, start REPL
			if (!prompt || mergedOpts.interactive) {
				if (!process.stdin.isTTY && !mergedOpts.interactive) {
					const stdinPrompt = await readAllStdin();
					if (stdinPrompt && stdinPrompt.trim()) {
						await executeOneShot(stdinPrompt.trim(), mergedOpts);
						return;
					}
				}

				await startRepl({
					providerName: mergedOpts.provider,
					modelName: mergedOpts.model,
					planMode: mergedOpts.plan,
					approvalMode: mergedOpts.approval,
					isTTY: process.stdout.isTTY,
				});
				return;
			}

			// Single-shot batch execution
			await executeOneShot(prompt, mergedOpts);
		});

	return prog;
}

const program = buildCli();
program.parse();
