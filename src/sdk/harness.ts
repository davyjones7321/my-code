import {
	type HarnessConfig,
	type ProviderConfig,
	getConfigPath,
	getProjectConfig,
	loadConfig,
	mergeConfigs,
} from "../config/index.ts";
import type { Provider } from "../providers/base.ts";
import { ProviderRegistry } from "../providers/registry.ts";
import { registerBuiltinTools } from "../tools/defaults.ts";
import { ToolRegistry } from "../tools/registry.ts";
import { HarnessSession } from "./session.ts";
import type { HarnessOptions, SDKSessionOptions, Tool } from "./types.ts";

/**
 * Root Harness runtime orchestrator for embeddable applications.
 *
 * Manages configuration resolution, provider registry, tool registry,
 * and factory instantiation of isolated conversational sessions.
 */
export class Harness {
	private config: HarnessConfig;
	private options: HarnessOptions;
	private providerRegistry: ProviderRegistry;
	private toolRegistry: ToolRegistry;
	private projectRoot: string;
	private defaultModel: string;

	constructor(options: HarnessOptions = {}) {
		this.options = { ...options };
		this.projectRoot = options.projectRoot || process.cwd();

		// 1. Resolve configuration with optional disk isolation
		if (options.loadDiskConfig === false) {
			// Pure in-memory configuration isolation
			const initialDefaultProvider =
				(typeof options.provider === "string"
					? options.provider
					: options.provider?.name) ||
				options.defaultProvider ||
				"default";

			this.config = {
				defaultProvider: initialDefaultProvider,
				approvalMode: options.approvalMode || "manual",
				maxIterations: options.maxIterations || 50,
				projectRoot: this.projectRoot,
			};
		} else {
			// Load global and project disk configurations
			const globalConfigPath = getConfigPath();
			const globalConfig = loadConfig(globalConfigPath);
			const projectConfig = getProjectConfig(this.projectRoot);
			this.config = mergeConfigs(globalConfig, projectConfig || {});
		}

		// 2. Apply programmatic overrides
		if (options.provider !== undefined) {
			this.config.defaultProvider =
				typeof options.provider === "string"
					? options.provider
					: options.provider.name;
		}
		if (options.defaultProvider !== undefined) {
			this.config.defaultProvider = options.defaultProvider;
		}
		if (options.approvalMode !== undefined) {
			this.config.approvalMode = options.approvalMode;
		}
		if (options.maxIterations !== undefined) {
			this.config.maxIterations = options.maxIterations;
		}
		if (options.projectRoot !== undefined) {
			this.config.projectRoot = options.projectRoot;
		}

		// 3. Initialize Provider Registry
		if (options.providers) {
			for (const [name, p] of Object.entries(options.providers)) {
				if (p && typeof (p as any).chat !== "function") {
					this.config.providers = {
						...this.config.providers,
						[name]: p as ProviderConfig,
					};
				}
			}
		}

		this.providerRegistry = ProviderRegistry.fromConfig(this.config);

		// Register Provider instance if passed in options.provider
		if (options.provider && typeof options.provider === "object") {
			this.providerRegistry.register(options.provider);
		}

		// Register programmatic Provider instances in options.providers
		if (options.providers) {
			for (const [name, p] of Object.entries(options.providers)) {
				if (p && typeof (p as any).chat === "function") {
					const providerInst = p as Provider;
					if (!providerInst.name) {
						providerInst.name = name;
					}
					this.providerRegistry.register(providerInst);
				}
			}
		}

		if (options.customProviders) {
			for (const provider of options.customProviders) {
				this.providerRegistry.register(provider);
			}
		}

		// 4. Resolve default model
		const providerName = this.config.defaultProvider || "default";
		const providerConf = this.config.providers?.[providerName];
		this.defaultModel = options.model || providerConf?.model || "default";

		// 5. Initialize Tool Registry and register built-in tools
		this.toolRegistry = new ToolRegistry();
		registerBuiltinTools(this.toolRegistry, this.projectRoot);

		// Register custom programmatic tools
		if (options.tools) {
			for (const tool of options.tools) {
				this.toolRegistry.register(tool as any);
			}
		}
	}

	/**
	 * Get a copy of the resolved Harness configuration.
	 */
	public getConfig(): HarnessConfig {
		return { ...this.config };
	}

	/**
	 * Get the active project root directory.
	 */
	public getProjectRoot(): string {
		return this.projectRoot;
	}

	/**
	 * Get the default model name.
	 */
	public getDefaultModel(): string {
		return this.defaultModel;
	}

	/**
	 * Get the original initialization options.
	 */
	public getOptions(): Readonly<HarnessOptions> {
		return this.options;
	}

	/**
	 * Register a custom Provider instance programmatically.
	 */
	public registerProvider(provider: Provider): void {
		this.providerRegistry.register(provider);
	}

	/**
	 * Get a registered Provider instance by name.
	 */
	public getProvider(name: string): Provider | undefined {
		return this.providerRegistry.get(name);
	}

	/**
	 * List all registered provider names.
	 */
	public listProviders(): string[] {
		return this.providerRegistry.list();
	}

	/**
	 * Get the underlying ProviderRegistry instance.
	 */
	public getProviderRegistry(): ProviderRegistry {
		return this.providerRegistry;
	}

	/**
	 * Register a custom Tool instance programmatically.
	 */
	public registerTool(tool: Tool): void {
		this.toolRegistry.register(tool as any);
	}

	/**
	 * Get a registered Tool instance by name.
	 */
	public getTool(name: string): Tool | undefined {
		return this.toolRegistry.get(name) as any;
	}

	/**
	 * List all registered tool names.
	 */
	public listTools(): string[] {
		return this.toolRegistry.list();
	}

	/**
	 * Get the underlying ToolRegistry instance.
	 */
	public getToolRegistry(): ToolRegistry {
		return this.toolRegistry;
	}

	/**
	 * Instantiate an isolated conversational session.
	 */
	public createSession(options?: SDKSessionOptions): HarnessSession {
		return new HarnessSession(this, options);
	}
}
