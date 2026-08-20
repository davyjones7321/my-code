// Main package entry point for my-harness
export { Harness } from "./sdk/harness.ts";
export { HarnessSession } from "./sdk/session.ts";
export * from "./sdk/types.ts";

// Re-export core subsystem interfaces for programmatic consumers
export { ProviderRegistry } from "./providers/registry.ts";
export type { Provider, ProviderCallConfig, ProviderResponse } from "./providers/base.ts";
export { ToolRegistry } from "./tools/registry.ts";
export { ControlLayer } from "./control/index.ts";
export { ApprovalGate } from "./control/approval.ts";
export { ModeController } from "./control/modes.ts";
export { PathSandbox } from "./control/sandbox.ts";
export { ContextManager } from "./context/manager.ts";
export { ReplSession, type ReplTurn } from "./tui/session.ts";
export {
	loadConfig,
	saveConfig,
	getProjectConfig,
	mergeConfigs,
	getConfigPath,
	getConfigDir,
	type HarnessConfig,
	type ProviderConfig,
} from "./config/index.ts";
