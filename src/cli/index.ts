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

program
	.command('run')
	.description('Run the agent loop')
	.argument('<prompt>', 'The prompt for the agent')
	.action((prompt) => {
		console.log(chalk.blue(`Agent loop not yet implemented (prompt: ${prompt})`));
	});

program.parse();
