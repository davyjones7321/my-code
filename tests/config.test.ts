import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadConfig, saveConfig, mergeConfigs, HarnessConfig } from '../src/config/index.ts';

describe('Config System', () => {
	let tempDir: string;
	let configPath: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-test-'));
		configPath = path.join(tempDir, 'config.toml');
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it('returns defaults when config file is missing', () => {
		const config = loadConfig(configPath);
		expect(config.defaultProvider).toBe('default');
		expect(config.approvalMode).toBe('manual');
		expect(config.maxIterations).toBe(50);
	});

	it('saves and loads config correctly', () => {
		const customConfig: HarnessConfig = {
			defaultProvider: 'openai',
			approvalMode: 'auto',
			maxIterations: 100,
			projectRoot: '/test/root',
			providers: {
				openai: {
					apiKey: 'test-key',
					model: 'gpt-4'
				}
			}
		};

		saveConfig(customConfig, configPath);
		
		const loadedConfig = loadConfig(configPath);
		expect(loadedConfig.defaultProvider).toBe('openai');
		expect(loadedConfig.approvalMode).toBe('auto');
		expect(loadedConfig.maxIterations).toBe(100);
		expect(loadedConfig.projectRoot).toBe('/test/root');
		expect(loadedConfig.providers?.openai.apiKey).toBe('test-key');
	});

	it('merges configs with later taking precedence', () => {
		const baseConfig: Partial<HarnessConfig> = {
			defaultProvider: 'default',
			maxIterations: 10
		};
		
		const overrideConfig: Partial<HarnessConfig> = {
			maxIterations: 20,
			providers: {
				anthropic: {
					apiKey: 'key',
					model: 'claude-3'
				}
			}
		};

		const merged = mergeConfigs(baseConfig, overrideConfig);
		expect(merged.defaultProvider).toBe('default');
		expect(merged.maxIterations).toBe(20);
		expect(merged.providers?.anthropic.model).toBe('claude-3');
	});
});
