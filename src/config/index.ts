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
 * Loads .env files from global user home (~/.harness/.env) and project root (.env)
 * into process.env if not already set.
 */
export function loadDotEnvFiles(projectRoot: string = process.cwd()): void {
	const pathsToTry = [
		path.join(getConfigDir(), ".env"),
		path.join(projectRoot, ".env"),
	];

	for (const envPath of pathsToTry) {
		if (fs.existsSync(envPath)) {
			try {
				const content = fs.readFileSync(envPath, "utf8");
				const lines = content.split("\n");
				for (const line of lines) {
					const trimmed = line.trim();
					if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
						const [key, ...valParts] = trimmed.split("=");
						const keyName = key.trim();
						const val = valParts.join("=").trim().replace(/^["']|["']$/g, "");
						if (keyName && !process.env[keyName]) {
							process.env[keyName] = val;
						}
					}
				}
			} catch {
				// Ignore unreadable env files
			}
		}
	}
}
/**
 * Searches exclusively for SOUL.md system prompt files in project root,
 * project config directory (.harness/SOUL.md), and global user home (~/.harness/SOUL.md).
 * Returns prompt content and source filename if found.
 */
export function loadCustomSystemPrompt(projectRoot: string = process.cwd()): { content: string; sourceFile?: string } {
	const candidates = [
		{ path: path.join(projectRoot, "SOUL.md"), name: "SOUL.md" },
		{ path: path.join(projectRoot, ".harness", "SOUL.md"), name: ".harness/SOUL.md" },
		{ path: path.join(getConfigDir(), "SOUL.md"), name: "~/.harness/SOUL.md" },
	];

	for (const candidate of candidates) {
		if (fs.existsSync(candidate.path)) {
			try {
				const content = fs.readFileSync(candidate.path, "utf8").trim();
				if (content) {
					return { content, sourceFile: candidate.name };
				}
			} catch {
				// Ignore unreadable prompt files
			}
		}
	}

	return { content: "" };
}
/**
 * Loads and parses a config file from the given path.
 * Returns null if file doesn't exist.
 */
export function loadConfig(configPath: string = getConfigPath()): HarnessConfig {
	loadDotEnvFiles(path.dirname(path.dirname(configPath)));
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
