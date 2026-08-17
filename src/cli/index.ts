#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, saveConfig, getConfigPath } from '../config/index.ts';

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

import { AnthropicProvider } from '../providers/anthropic.ts';
import { runAgentLoop, type ToolExecutor } from '../agent/loop.ts';
import type { ToolDefinition } from '../agent/types.ts';

program
	.command('run')
	.description('Run the agent loop')
	.argument('<prompt>', 'The prompt for the agent')
	.action(async (prompt) => {
		try {
			const configPath = getConfigPath();
			const config = loadConfig(configPath);
			const defaultProviderName = config.defaultProvider || 'anthropic';
			const providerConfig = config.providers?.[defaultProviderName];
			
			if (!providerConfig || !providerConfig.apiKey) {
				console.error(chalk.red(`Error: Missing API key for provider ${defaultProviderName}. Please check your config at ${configPath}`));
				process.exit(1);
			}

			let provider;
			if (defaultProviderName === 'anthropic') {
				provider = new AnthropicProvider(providerConfig.apiKey, providerConfig.baseUrl);
			} else {
				console.error(chalk.red(`Error: Provider ${defaultProviderName} not supported yet.`));
				process.exit(1);
			}

			const echoToolDef: ToolDefinition = {
				name: 'echo',
				description: 'Echoes the input back',
				inputSchema: {
					type: 'object',
					properties: {
						message: { type: 'string' }
					},
					required: ['message']
				}
			};

			const echoToolExecutor: ToolExecutor = {
				name: 'echo',
				async execute(input) {
					return { result: String(input.message), isError: false };
				}
			};

			const loopConfig = {
				maxIterations: config.maxIterations || 10,
				systemPrompt: 'You are a helpful AI assistant.',
				tools: [echoToolDef]
			};

			console.log(chalk.blue(`Starting agent loop with prompt: "${prompt}"...`));

			// Wait, the runAgentLoop callConfig in loop.ts takes model. It takes it from ProviderCallConfig.
			// Actually I didn't pass callConfig into runAgentLoop correctly since runAgentLoop doesn't accept callConfig.
			// Let's modify the runAgentLoop logic in my head or just patch it.
			// I need to patch loop.ts to accept ProviderCallConfig if it's missing the model. Wait, loop.ts creates ProviderCallConfig itself!
			// I should edit runAgentLoop to accept the model as part of AgentLoopConfig or pass ProviderCallConfig to it.
			// The instructions didn't specify where model comes from, but CLI loads it from ProviderConfig.

			// Actually, let's fix loop.ts first. Wait, loop.ts has a ProviderCallConfig that has model: ''.
			// I'll update loop.ts too.
			
			const model = providerConfig.model || 'claude-3-haiku-20240307';
			const loopGenerator = runAgentLoop(provider, prompt, [echoToolExecutor], loopConfig, { model });
			
			for await (const event of loopGenerator) {
				switch (event.type) {
					case 'thinking':
						console.log(chalk.gray(`[Thinking] ${event.message}`));
						break;
					case 'tool_call':
						console.log(chalk.yellow(`[Tool Call] ${event.toolName}: ${JSON.stringify(event.toolInput)}`));
						break;
					case 'tool_result':
						if (event.isError) {
							console.log(chalk.red(`[Tool Result Error] ${event.result}`));
						} else {
							console.log(chalk.green(`[Tool Result] ${event.result}`));
						}
						break;
					case 'response':
						console.log(chalk.cyan(`[Response]\n${event.text}`));
						break;
					case 'error':
						console.error(chalk.red(`[Error] ${event.error.message}`));
						break;
					case 'done':
						console.log(chalk.magenta(`[Done] Iterations: ${event.totalIterations}`));
						break;
				}
			}
		} catch (error: any) {
			console.error(chalk.red(`Fatal error: ${error.message}`));
			process.exit(1);
		}
	});

program.parse();
