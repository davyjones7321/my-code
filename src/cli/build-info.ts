export interface BuildInfo {
	version: string;
	name: string;
	description: string;
	target: string;
	platform: string;
	arch: string;
	bunVersion: string;
	compiledBinary: boolean;
	features: {
		agentLoop: boolean;
		fts5Memory: boolean;
		lspDiagnostics: boolean;
		subagentsEngine: boolean;
		interactiveTUI: boolean;
		embeddableSDK: boolean;
		gatewayServer: boolean;
		cronScheduler: boolean;
		selfHealingVerifier: boolean;
	};
}

export function getBuildInfo(): BuildInfo {
	const isCompiled = Boolean((process as any).isBunCompiled || process.execPath.includes("harness-"));

	return {
		version: "0.1.0",
		name: "my-harness",
		description: "A model-agnostic AI agent harness in TypeScript/Bun",
		target: `${process.platform}-${process.arch}`,
		platform: process.platform,
		arch: process.arch,
		bunVersion: Bun.version,
		compiledBinary: isCompiled,
		features: {
			agentLoop: true,
			fts5Memory: true,
			lspDiagnostics: true,
			subagentsEngine: true,
			interactiveTUI: true,
			embeddableSDK: true,
			gatewayServer: true,
			cronScheduler: true,
			selfHealingVerifier: true,
		},
	};
}

export function formatBuildInfo(info: BuildInfo): string {
	const lines: string[] = [
		`🤖 ${info.name} v${info.version}`,
		`  Description:     ${info.description}`,
		`  Platform/Arch:   ${info.platform} / ${info.arch}`,
		`  Bun Engine:      v${info.bunVersion}`,
		`  Binary Mode:     ${info.compiledBinary ? "Single-File Compiled Executable" : "TypeScript Source (Bun runtime)"}`,
		"",
		"⚡ Integrated Features (Phases 0–14):",
		`  [✓] Autonomous Agent Loop & Control Layer`,
		`  [✓] SQLite FTS5 Memory Engine & Fact Recall`,
		`  [✓] TypeScript LSP Diagnostics Engine`,
		`  [✓] Multi-Agent Subagent Runtime Engine`,
		`  [✓] Interactive TUI REPL & Live Status Bar`,
		`  [✓] Programmatic Embeddable SDK`,
		`  [✓] Multi-Platform HTTP & WebSocket Gateway`,
		`  [✓] Persistent Cron Scheduler & Timers`,
		`  [✓] Verifier Engine & Self-Healing Repair Loops`,
		`  [✓] Standalone Executable Binary Compilation`,
	];

	return lines.join("\n");
}
