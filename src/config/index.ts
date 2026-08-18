import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parse, stringify } from "smol-toml";

export interface ProviderConfig {
	apiKey: string;
	baseUrl?: string;
	model: string;
}

export interface HarnessConfig {
	providers?: Record<string, ProviderConfig>;
	defaultProvider: string;
	approvalMode: "auto" | "manual" | "yolo";
	maxIterations: number;
	projectRoot: string;
}

const DEFAULT_CONFIG: HarnessConfig = {
	defaultProvider: "default",
	approvalMode: "manual",
	maxIterations: 50,
	projectRoot: process.cwd(),
};

/**
 * Gets the global config directory path
 */
export function getConfigDir(): string {
	return path.join(os.homedir(), ".harness");
}

/**
 * Gets the global config file path
 */
export function getConfigPath(): string {
	return path.join(getConfigDir(), "config.toml");
}

/**
 * Loads and parses a config file from the given path.
 * Returns null if file doesn't exist.
 */
export function loadConfig(configPath: string = getConfigPath()): HarnessConfig {
	try {
		const content = fs.readFileSync(configPath, "utf8");
		const parsed = parse(content) as unknown as Partial<HarnessConfig>;
		return mergeConfigs(DEFAULT_CONFIG, parsed as HarnessConfig);
	} catch (error) {
		// Return defaults if file is missing or unparseable
		return { ...DEFAULT_CONFIG };
	}
}

/**
 * Saves a config object to the given path.
 */
export function saveConfig(config: HarnessConfig, configPath: string = getConfigPath()): void {
	const dir = path.dirname(configPath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
	const content = stringify(config as any);
	fs.writeFileSync(configPath, content, "utf8");
}

/**
 * Gets project-specific config if it exists.
 */
export function getProjectConfig(projectRoot: string): HarnessConfig | null {
	const projectConfigPath = path.join(projectRoot, ".harness", "config.toml");
	if (fs.existsSync(projectConfigPath)) {
		return loadConfig(projectConfigPath);
	}
	return null;
}

/**
 * Merges multiple configs, later configs take precedence.
 */
export function mergeConfigs(...configs: Partial<HarnessConfig>[]): HarnessConfig {
	const result: any = { ...DEFAULT_CONFIG };

	for (const config of configs) {
		if (!config) continue;

		for (const key of Object.keys(config) as (keyof HarnessConfig)[]) {
			if (key === "providers") {
				result.providers = {
					...result.providers,
					...config.providers,
				};
			} else if (config[key] !== undefined) {
				result[key] = config[key];
			}
		}
	}

	return result as HarnessConfig;
}
