#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, saveConfig, getConfigPath, getProjectConfig, mergeConfigs } from '../config/index.ts';

const program = new Command();

// Read package.json for version
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgPath = path.join(__dirname, '..', '..', 'package.json');
let version = '0.0.0';
try {
	const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
	version = pkg.version;
} catch (e) {
	// fallback
}

program
	.name('harness')
	.description('A model-agnostic AI agent harness')
	.version(version);

program
	.command('init')
	.description('Initialize harness config')
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

import { ProviderRegistry } from '../providers/registry.ts';
import { ToolRegistry } from '../tools/registry.ts';
import { registerBuiltinTools } from '../tools/defaults.ts';
import { MemoryAPI } from '../memory/api.ts';
import { createRememberTool, createRecallTool } from '../memory/tools.ts';
import { ControlLayer } from '../control/index.ts';
import { runAgentLoop, type ToolExecutor } from '../agent/loop.ts';

program
	.command('run')
	.description('Run the agent loop')
	.argument('<prompt>', 'The prompt for the agent')
	.option('-p, --provider <name>', 'Provider to use (overrides defaultProvider in config)')
	.option('-m, --model <name>', 'Model to use (overrides model in config)')
	.option('--plan', 'Run in read-only plan mode')
	.action(async (prompt, options) => {
		try {
			const globalConfigPath = getConfigPath();
			const globalConfig = loadConfig(globalConfigPath);
			const projectConfig = getProjectConfig(process.cwd());
			const config = mergeConfigs(globalConfig, projectConfig || {});
			const providerName = options.provider || config.defaultProvider || 'default';
			
			const registry = ProviderRegistry.fromConfig(config);
			const provider = registry.get(providerName);
			
			if (!provider) {
				const available = registry.list();
				console.error(chalk.red(`\nError: Provider "${providerName}" is not configured.`));
				if (available.length > 0) {
					console.log(chalk.yellow(`Available configured providers: ${available.join(', ')}`));
				} else {
					console.log(chalk.yellow(`\nPlease configure a provider in ${configPath}:`));
					console.log(chalk.gray(`
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
`));
				}
				process.exit(1);
			}

			const providerConfig = config.providers?.[providerName];
			const model = options.model || providerConfig?.model || 'default';
			const projectRoot = config.projectRoot || process.cwd();

			// 1. Initialize tool registry with all builtin tools
			const toolRegistry = new ToolRegistry();
			registerBuiltinTools(toolRegistry, projectRoot);

			// 2. Add memory tools
			const memoryApi = new MemoryAPI();
			toolRegistry.register(createRememberTool(memoryApi));
			toolRegistry.register(createRecallTool(memoryApi));

			// 3. Setup control layer
			const controlLayer = new ControlLayer({
				approvalMode: config.approvalMode || 'auto',
				projectRoot
			});

			if (options.plan) {
				controlLayer.getModeController().setMode('plan');
			}

			// Wrap tool executors with control layer validation
			const toolExecutors: ToolExecutor[] = toolRegistry.getExecutors().map(executor => ({
				name: executor.name,
				async execute(input: Record<string, unknown>) {
					const check = await controlLayer.checkToolCall(executor.name, input);
					if (!check.permitted) {
						return {
							result: `[Control Denied]: ${check.reason || 'Operation not permitted'}`,
							isError: true
						};
					}
					return executor.execute(check.sanitizedInput || input);
				}
			}));

			const toolDefinitions = toolRegistry.getDefinitions();

			const loopConfig = {
				maxIterations: config.maxIterations || 50,
				systemPrompt: `You are an expert autonomous AI coding assistant.
You have access to tools for inspecting, editing, searching files, running shell commands, and managing memory.
Always verify your edits and prioritize safety.`,
				tools: toolDefinitions
			};

			console.log(chalk.blue(`\n🚀 Harness active: [Provider: ${providerName} | Model: ${model} | Mode: ${controlLayer.getModeController().getMode()}]`));
			console.log(chalk.gray(`Prompt: "${prompt}"\n`));

			const loopGenerator = runAgentLoop(provider, prompt, toolExecutors, loopConfig, { model });

			for await (const event of loopGenerator) {
				switch (event.type) {
					case 'thinking':
						console.log(chalk.gray(`🧠 [Thinking] ${event.message}`));
						break;
					case 'tool_call':
						console.log(chalk.yellow(`🛠️  [Tool Call] ${event.toolName}: ${JSON.stringify(event.toolInput)}`));
						break;
					case 'tool_result':
						if (event.isError) {
							console.log(chalk.red(`❌ [Tool Error] ${event.result}`));
						} else {
							// Truncate long results for clean CLI display
							const preview = event.result.length > 300 
								? event.result.slice(0, 300) + '... (truncated)' 
								: event.result;
							console.log(chalk.green(`✔️  [Tool Result] ${preview}`));
						}
						break;
					case 'response':
						console.log(chalk.cyan(`\n💬 [Response]\n${event.text}\n`));
						break;
					case 'error':
						console.error(chalk.red(`\n💥 [Error] ${event.error.message}`));
						break;
					case 'done':
						console.log(chalk.magenta(`🏁 [Done] Completed in ${event.totalIterations} iteration(s).\n`));
						break;
				}
			}
		} catch (error: any) {
			console.error(chalk.red(`Fatal error: ${error.message}`));
			process.exit(1);
		}
	});

program.parse();

