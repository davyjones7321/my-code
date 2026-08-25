import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import chalk from "chalk";
import type { Command } from "commander";
import { getConfigDir, getConfigPath, loadConfig, saveConfig } from "../config/index.ts";

export async function runInteractiveSetup(): Promise<boolean> {
	console.log(chalk.cyan.bold("\n🔑 Welcome to my-code Interactive Setup Wizard!\n"));
	console.log(chalk.gray("Configure your AI model provider and API key to enable my-code anywhere on your PC.\n"));

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	const askQuestion = (query: string): Promise<string> => {
		return new Promise((resolve) => rl.question(query, resolve));
	};

	try {
		console.log(chalk.yellow("Select your AI model provider:"));
		console.log("  1) OpenRouter (Recommended - 100+ models including Claude & Gemini)");
		console.log("  2) Anthropic (Claude 3.7 Sonnet / Claude 3.5)");
		console.log("  3) OpenAI (GPT-4o / O3)");
		console.log("  4) Ollama (Local LLM)");

		const choice = (await askQuestion(chalk.cyan("\nEnter choice [1-4] (default: 1): "))).trim() || "1";

		let providerName = "openrouter";
		let defaultModel = "dots-studio/dots-3-note-preview:free";
		let baseUrl = "https://openrouter.ai/api/v1";
		let envKeyName = "OPENROUTER_API_KEY";

		if (choice === "2") {
			providerName = "anthropic";
			defaultModel = "claude-3-7-sonnet-20250219";
			baseUrl = "https://api.anthropic.com/v1";
			envKeyName = "ANTHROPIC_API_KEY";
		} else if (choice === "3") {
			providerName = "openai";
			defaultModel = "gpt-4o";
			baseUrl = "https://api.openai.com/v1";
			envKeyName = "OPENAI_API_KEY";
		} else if (choice === "4") {
			providerName = "ollama";
			defaultModel = "deepseek-coder-v2";
			baseUrl = "http://localhost:11434/v1";
			envKeyName = "OLLAMA_API_KEY";
		}

		let apiKey = "";
		if (providerName !== "ollama") {
			apiKey = (await askQuestion(chalk.cyan(`\nEnter your ${providerName} API key: `))).trim();
			if (!apiKey) {
				console.log(chalk.red("❌ Setup cancelled: API key is required."));
				rl.close();
				return false;
			}
		} else {
			apiKey = "ollama";
		}

		const customModel = (
			await askQuestion(chalk.cyan(`Enter model name (press Enter for default [${defaultModel}]): `))
		).trim();
		if (customModel) {
			defaultModel = customModel;
		}

		// 1. Save to ~/.harness/.env
		const configDir = getConfigDir();
		if (!fs.existsSync(configDir)) {
			fs.mkdirSync(configDir, { recursive: true });
		}

		const globalEnvPath = path.join(configDir, ".env");
		const envContent = `# my-code Global Environment Config\n${envKeyName}="${apiKey}"\n`;
		fs.writeFileSync(globalEnvPath, envContent, "utf8");
		process.env[envKeyName] = apiKey;

		// 2. Save to ~/.harness/config.toml
		const currentConfig = loadConfig();
		currentConfig.defaultProvider = providerName;
		currentConfig.providers = currentConfig.providers || {};
		currentConfig.providers[providerName] = {
			apiKey,
			baseUrl,
			model: defaultModel,
		};

		saveConfig(currentConfig, getConfigPath());

		// 3. Save default ~/.harness/SOUL.md if missing
		const soulPath = path.join(configDir, "SOUL.md");
		if (!fs.existsSync(soulPath)) {
			const defaultSoul = `# Agent SOUL & System Instructions\n\n## Persona & Identity\n- You are an expert autonomous AI software engineer and coding assistant.\n\n## Execution Rules\n1. DO NOT STOP MID-TASK: Invoke built-in tools (write_file, edit_file) in the SAME turn until all files are 100% written.\n2. PREFER BUILT-IN TOOLS: Use write_file directly for file creation.\n3. SHELL AWARENESS: Respect OS environment (Windows/cmd.exe vs Posix/Bash).\n`;
			fs.writeFileSync(soulPath, defaultSoul, "utf8");
		}
		rl.close();

		console.log(chalk.green.bold(`\n🎉 Setup Complete!`));
		console.log(chalk.gray(`Saved credentials to ${globalEnvPath}`));
		console.log(
			chalk.cyan(
				`Active Provider: [${providerName}] | Model: [${defaultModel}]\nType 'my-code' anytime to start!\n`,
			),
		);
		return true;
	} catch (e: any) {
		rl.close();
		console.error(chalk.red(`\nSetup error: ${e.message}`));
		return false;
	}
}

export function registerSetupCommands(prog: Command): void {
	prog
		.command("setup")
		.description("Run interactive setup wizard to configure API keys and model providers")
		.option("-k, --key <apiKey>", "Directly set API key")
		.option("-p, --provider <provider>", "Set default provider (openrouter, anthropic, openai, ollama)")
		.option("-m, --model <model>", "Set default model name")
		.action(async (options) => {
			if (options.key || options.provider || options.model) {
				const providerName = options.provider || "openrouter";
				const modelName = options.model || "dots-studio/dots-3-note-preview:free";
				const apiKey = options.key || process.env.OPENROUTER_API_KEY || "";

				const configDir = getConfigDir();
				if (!fs.existsSync(configDir)) {
					fs.mkdirSync(configDir, { recursive: true });
				}

				if (apiKey) {
					const envKeyName = providerName.toUpperCase() + "_API_KEY";
					fs.writeFileSync(path.join(configDir, ".env"), `${envKeyName}="${apiKey}"\n`, "utf8");
					process.env[envKeyName] = apiKey;
				}

				const currentConfig = loadConfig();
				currentConfig.defaultProvider = providerName;
				currentConfig.providers = currentConfig.providers || {};
				currentConfig.providers[providerName] = {
					apiKey: apiKey || currentConfig.providers[providerName]?.apiKey || "",
					baseUrl: providerName === "anthropic" ? "https://api.anthropic.com/v1" : "https://openrouter.ai/api/v1",
					model: modelName,
				};

				saveConfig(currentConfig, getConfigPath());
				console.log(chalk.green(`✔️ Updated my-code configuration [Provider: ${providerName} | Model: ${modelName}]`));
				return;
			}

			await runInteractiveSetup();
		});
}
