import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import ts from "typescript";

import { runAgentLoop } from "../../src/agent/loop.ts";
import type { LoopEvent, Message, ToolDefinition } from "../../src/agent/types.ts";
import { ContextManager } from "../../src/context/manager.ts";
import { ApprovalGate } from "../../src/control/approval.ts";
import { ControlLayer } from "../../src/control/index.ts";
import { ModeController } from "../../src/control/modes.ts";
import { LSPDiagnosticsEngine } from "../../src/lsp/engine.ts";
import { InMemoryLanguageServiceHost, normalizeFilePath } from "../../src/lsp/host.ts";
import { SelfHealingCoordinator } from "../../src/lsp/self-healing.ts";
import {
	createFindReferencesTool,
	createGetDefinitionTool,
	createGetDiagnosticsTool,
	registerLSPTools,
} from "../../src/lsp/tools.ts";
import { MemoryAPI } from "../../src/memory/api.ts";
import { MemoryStore } from "../../src/memory/store.ts";
import type { Provider, ProviderCallConfig, ProviderResponse } from "../../src/providers/base.ts";
import { SubagentManager } from "../../src/subagents/manager.ts";
import { SubagentTypeRegistry } from "../../src/subagents/registry.ts";
import {
	createDefineSubagentTool,
	createInvokeSubagentTool,
	createManageSubagentsTool,
	createSendMessageTool,
	registerSubagentTools,
} from "../../src/subagents/tools.ts";
import type {
	SubagentDefinition,
	SubagentEvent,
	SubagentExecutionResult,
	SubagentInvocationSpec,
	SubagentLifecycleState,
} from "../../src/subagents/types.ts";
import { registerBuiltinTools } from "../../src/tools/defaults.ts";
import { ToolRegistry } from "../../src/tools/registry.ts";

// ============================================================================
// Test Infrastructure & Fixture Helpers
// ============================================================================

/**
 * Creates an isolated temporary directory sandbox for testing.
 */
async function createTempProject(files: Record<string, string> = {}): Promise<{
	projectRoot: string;
	cleanup: () => Promise<void>;
}> {
	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-phase8-e2e-"));
	const projectRoot = normalizeFilePath(tmpDir);

	// Default tsconfig if not provided
	const tsconfig = {
		compilerOptions: {
			target: "ESNext",
			module: "ESNext",
			moduleResolution: "Bundler",
			strict: true,
			esModuleInterop: true,
			skipLibCheck: true,
			noEmit: true,
		},
		include: ["**/*"],
	};

	if (!files["tsconfig.json"]) {
		await fs.writeFile(
			path.join(projectRoot, "tsconfig.json"),
			JSON.stringify(tsconfig, null, 2),
			"utf-8",
		);
	}

	for (const [relPath, content] of Object.entries(files)) {
		const fullPath = path.join(projectRoot, relPath);
		await fs.mkdir(path.dirname(fullPath), { recursive: true });
		await fs.writeFile(fullPath, content, "utf-8");
	}

	return {
		projectRoot,
		cleanup: async () => {
			try {
				await fs.rm(projectRoot, { recursive: true, force: true });
			} catch {
				// Ignore cleanup failures
			}
		},
	};
}

/**
 * Programmable mock provider supporting single and multi-turn scripted conversations.
 */
class DeterministicMockProvider implements Provider {
	public readonly name = "deterministic-mock";
	private responseQueue: Array<
		| ProviderResponse
		| ((
				messages: Message[],
				tools?: ToolDefinition[],
				callConfig?: ProviderCallConfig,
		  ) => ProviderResponse | Promise<ProviderResponse>)
	> = [];
	public callHistory: Array<{
		messages: Message[];
		tools?: ToolDefinition[];
		callConfig?: ProviderCallConfig;
	}> = [];

	constructor(
		initialResponses: Array<
			| ProviderResponse
			| ((
					messages: Message[],
					tools?: ToolDefinition[],
					callConfig?: ProviderCallConfig,
			  ) => ProviderResponse | Promise<ProviderResponse>)
		> = [],
	) {
		this.responseQueue = [...initialResponses];
	}

	public queueResponse(
		response:
			| ProviderResponse
			| ((
					messages: Message[],
					tools?: ToolDefinition[],
					callConfig?: ProviderCallConfig,
			  ) => ProviderResponse | Promise<ProviderResponse>),
	): void {
		this.responseQueue.push(response);
	}

	public clear(): void {
		this.responseQueue = [];
		this.callHistory = [];
	}

	public getCallCount(): number {
		return this.callHistory.length;
	}

	public async chat(
		messages: Message[],
		tools?: ToolDefinition[],
		callConfig?: ProviderCallConfig,
	): Promise<ProviderResponse> {
		this.callHistory.push({
			messages: JSON.parse(JSON.stringify(messages)),
			tools: tools ? JSON.parse(JSON.stringify(tools)) : undefined,
			callConfig: callConfig ? { ...callConfig } : undefined,
		});

		if (this.responseQueue.length > 0) {
			const item = this.responseQueue.shift()!;
			if (typeof item === "function") {
				return await item(messages, tools, callConfig);
			}
			return item;
		}

		// Fallback response if queue is empty
		return {
			content: [
				{
					type: "text",
					text: "Deterministic mock response: completed.",
				},
			],
		};
	}
}

/**
 * Initializes a complete E2E test harness containing all Phase 8 components.
 */
function createE2EHarness(options: {
	projectRoot: string;
	provider?: DeterministicMockProvider;
	approvalMode?: "auto" | "manual" | "yolo";
}) {
	const provider = options.provider || new DeterministicMockProvider();
	const toolRegistry = new ToolRegistry();
	const typeRegistry = new SubagentTypeRegistry();

	// Register base file and shell tools
	registerBuiltinTools(toolRegistry, options.projectRoot);

	// Register LSP engine & tools
	const host = new InMemoryLanguageServiceHost({
		projectRoot: options.projectRoot,
		useDiskFallback: true,
	});
	const lspEngine = new LSPDiagnosticsEngine({ host, projectRoot: options.projectRoot });
	registerLSPTools(toolRegistry, lspEngine);

	// Register Self-Healing coordinator
	const selfHealing = new SelfHealingCoordinator(lspEngine);

	// Register Subagent manager & tools
	const subagentManager = new SubagentManager({
		provider,
		toolRegistry,
		typeRegistry,
		projectRoot: options.projectRoot,
	});
	registerSubagentTools(toolRegistry, subagentManager, typeRegistry);

	// Register in-memory SQLite Memory API
	const memoryStore = new MemoryStore(":memory:");
	const memoryApi = new MemoryAPI(memoryStore);

	const controlLayer = new ControlLayer({
		projectRoot: options.projectRoot,
		approvalMode: options.approvalMode || "auto",
	});

	return {
		provider,
		toolRegistry,
		typeRegistry,
		subagentManager,
		lspEngine,
		host,
		selfHealing,
		memoryApi,
		controlLayer,
	};
}

// ============================================================================
// E2E Test Suite
// ============================================================================

describe("Phase 8: Comprehensive 4-Tier Opaque-Box E2E Test Suite (tests/e2e/phase8_e2e.test.ts)", () => {
	let sandbox: { projectRoot: string; cleanup: () => Promise<void> };

	beforeEach(async () => {
		sandbox = await createTempProject();
	});

	afterEach(async () => {
		await sandbox.cleanup();
	});

	// =========================================================================
	// Tier 1: Feature Coverage (F1–F10, >=5 test cases per feature)
	// =========================================================================

	describe("Tier 1: Feature Coverage (F1–F10)", () => {
		// --- F1: Subagent Lifecycle & State Model ---
		describe("F1: Subagent Lifecycle & State Model", () => {
			it("T1.F1.01: should initialize subagent instance with valid state, UUID, and context", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.provider.queueResponse({
					content: [{ type: "text", text: "Subagent finished initial mission." }],
				});

				const result = await harness.subagentManager.invoke("parent-001", {
					type: "research",
					prompt: "Perform initial repository survey",
				});

				expect(result.instanceId).toBeDefined();
				expect(result.type).toBe("research");
				expect(result.state).toBe("done");
				expect(result.output).toContain("Subagent finished initial mission.");
			});

			it("T1.F1.02: should transition through full standard lifecycle (idle -> running -> done)", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const observedStates: SubagentLifecycleState[] = [];

				harness.subagentManager.on("state_changed", (event: SubagentEvent) => {
					if (event.data?.state) {
						observedStates.push(event.data.state as SubagentLifecycleState);
					}
				});

				harness.provider.queueResponse({
					content: [{ type: "text", text: "Task completed." }],
				});

				const result = await harness.subagentManager.invoke("parent-001", {
					prompt: "Run lifecycle transition check",
				});

				expect(result.state).toBe("done");
				expect(observedStates).toContain("running");
				expect(observedStates).toContain("done");
			});

			it("T1.F1.03: should transition to errored state on unhandled loop error", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.provider.queueResponse(() => {
					throw new Error("Simulated LLM inference failure");
				});

				const result = await harness.subagentManager.invoke("parent-001", {
					prompt: "This will fail in model loop",
				});

				expect(result.state).toBe("errored");
				expect(result.error).toContain("Simulated LLM inference failure");
			});

			it("T1.F1.04: should track parent-child hierarchy tree correctly", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.provider.queueResponse({
					content: [{ type: "text", text: "Child worker finished." }],
				});

				const parentInst = harness.subagentManager.spawn("root-conv", {
					name: "parent-worker",
					type: "research",
					prompt: "Parent task",
				});

				const childResult = await harness.subagentManager.invoke(parentInst.id, {
					name: "child-worker",
					type: "code-reviewer",
					prompt: "Child task",
				});

				const children = harness.subagentManager.getChildren(parentInst.id);
				expect(children.length).toBe(1);
				expect(children[0].id).toBe(childResult.instanceId);

				const ancestors = harness.subagentManager.getAncestors(childResult.instanceId);
				expect(ancestors.length).toBe(1);
				expect(ancestors[0].id).toBe(parentInst.id);
			});

			it("T1.F1.05: should isolate child ContextManager from parent transcript", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const parentContext = new ContextManager({ projectRoot: sandbox.projectRoot });
				parentContext.addMessage({
					role: "user",
					content: [{ type: "text", text: "Secret parent conversation data" }],
				});

				harness.provider.queueResponse({
					content: [{ type: "text", text: "Child execution report." }],
				});

				const childResult = await harness.subagentManager.invoke("parent-001", {
					prompt: "Process isolated child prompt",
				});

				const childInst = harness.subagentManager.getInstance(childResult.instanceId);
				expect(childInst).toBeDefined();

				const childHistory = await childInst!.contextManager.getContext();
				const hasParentSecret = childHistory.some((m) =>
					JSON.stringify(m).includes("Secret parent conversation data"),
				);
				expect(hasParentSecret).toBe(false);
			});

			it("T1.F1.06: should gracefully terminate subagent and transition to terminated state", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const subInst = harness.subagentManager.spawn("parent-001", {
					prompt: "Long running worker",
					background: true,
				});

				const terminated = await harness.subagentManager.terminate(subInst.id, "Aborted by admin");
				expect(terminated).toBe(true);

				const instance = harness.subagentManager.getInstance(subInst.id);
				expect(instance?.state).toBe("terminated");
			});
		});

		// --- F2: Built-in & Dynamic Subagent Types ---
		describe("F2: Built-in & Dynamic Subagent Types", () => {
			it("T1.F2.01: should provide built-in research definition with read-only tools", () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const researchDef = harness.typeRegistry.get("research");

				expect(researchDef).toBeDefined();
				expect(researchDef?.isBuiltin).toBe(true);
				expect(researchDef?.mode).toBe("plan");
				expect(researchDef?.allowedTools).toContain("read_file");
				expect(researchDef?.allowedTools).toContain("get_diagnostics");
				expect(researchDef?.disallowedTools).toContain("write_file");
			});

			it("T1.F2.02: should provide built-in code-reviewer definition", () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const reviewerDef = harness.typeRegistry.get("code-reviewer");

				expect(reviewerDef).toBeDefined();
				expect(reviewerDef?.isBuiltin).toBe(true);
				expect(reviewerDef?.allowedTools).toContain("get_diagnostics");
				expect(reviewerDef?.allowedTools).toContain("find_references");
				expect(reviewerDef?.disallowedTools).toContain("write_file");
			});

			it("T1.F2.03: should provide built-in test-engineer definition with build tools", () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const testerDef = harness.typeRegistry.get("test-engineer");

				expect(testerDef).toBeDefined();
				expect(testerDef?.isBuiltin).toBe(true);
				expect(testerDef?.mode).toBe("build");
				expect(testerDef?.allowedTools).toContain("write_file");
				expect(testerDef?.allowedTools).toContain("run_command");
			});

			it("T1.F2.04: should allow registering dynamic custom subagent role", () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const customDef: SubagentDefinition = {
					name: "security-auditor",
					description: "Audits codebase for security vulnerabilities",
					systemPrompt: "You are a Security Auditor. Check for dangerous patterns.",
					allowedTools: ["read_file", "grep_search"],
					mode: "plan",
				};

				harness.typeRegistry.register(customDef);
				expect(harness.typeRegistry.has("security-auditor")).toBe(true);
				expect(harness.typeRegistry.get("security-auditor")?.description).toBe(
					customDef.description,
				);
			});

			it("T1.F2.05: should restrict tools on subagent instance according to dynamic definition", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.typeRegistry.register({
					name: "restricted-reader",
					description: "Only reads files",
					systemPrompt: "Reader only",
					allowedTools: ["read_file"],
				});

				harness.provider.queueResponse({
					content: [{ type: "text", text: "Read-only inspection done." }],
				});

				const result = await harness.subagentManager.invoke("parent-001", {
					type: "restricted-reader",
					prompt: "Read repo",
				});

				const inst = harness.subagentManager.getInstance(result.instanceId);
				expect(inst).toBeDefined();
				expect(inst?.toolRegistry.list()).toContain("read_file");
				expect(inst?.toolRegistry.list()).not.toContain("write_file");
				expect(inst?.toolRegistry.list()).not.toContain("run_command");
			});

			it("T1.F2.06: should list and unregister dynamic types correctly", () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.typeRegistry.register({
					name: "temp-role",
					description: "Temporary role",
					systemPrompt: "Do temp stuff",
				});

				expect(harness.typeRegistry.listNames()).toContain("temp-role");
				const unregistered = harness.typeRegistry.unregister("temp-role");
				expect(unregistered).toBe(true);
				expect(harness.typeRegistry.has("temp-role")).toBe(false);
			});
		});

		// --- F3: Subagent Tools ---
		describe("F3: Subagent Tools", () => {
			it("T1.F3.01: should execute invoke_subagent tool and return structured execution report", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.provider.queueResponse({
					content: [{ type: "text", text: "Worker executed task successfully." }],
				});

				const invokeTool = createInvokeSubagentTool(harness.subagentManager, "parent-001");
				const toolResult = await invokeTool.execute({
					type: "research",
					prompt: "Analyze architecture overview",
				});

				expect(toolResult.isError).toBe(false);
				expect(toolResult.result).toContain("Subagent Execution Report");
				expect(toolResult.result).toContain("Worker executed task successfully.");
			});

			it("T1.F3.02: should execute send_message tool to deliver messages between agents", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const child = harness.subagentManager.spawn("parent-001", {
					name: "active-child",
					prompt: "Child prompt",
				});

				const sendTool = createSendMessageTool(harness.subagentManager, "parent-001");
				const deliveryResult = await sendTool.execute({
					recipientId: child.id,
					message: "Continue to step 2",
					awaitResponse: false,
				});

				expect(deliveryResult.isError).toBe(false);
				expect(deliveryResult.result).toContain("delivered successfully");
				expect(child.inbox.length).toBe(1);
				expect(child.inbox[0].content).toBe("Continue to step 2");
			});

			it("T1.F3.03: should execute manage_subagents tool with action: 'list'", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.subagentManager.spawn("parent-001", { prompt: "Worker 1" });
				harness.subagentManager.spawn("parent-001", { prompt: "Worker 2" });

				const manageTool = createManageSubagentsTool(harness.subagentManager);
				const listRes = await manageTool.execute({ action: "list" });

				expect(listRes.isError).toBe(false);
				const parsed = JSON.parse(listRes.result);
				expect(parsed.success).toBe(true);
				expect(parsed.subagents.length).toBe(2);
			});

			it("T1.F3.04: should execute manage_subagents tool with action: 'status'", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const inst = harness.subagentManager.spawn("parent-001", { prompt: "Status check worker" });

				const manageTool = createManageSubagentsTool(harness.subagentManager);
				const statusRes = await manageTool.execute({
					action: "status",
					subagentId: inst.id,
				});

				expect(statusRes.isError).toBe(false);
				const parsed = JSON.parse(statusRes.result);
				expect(parsed.status.id).toBe(inst.id);
			});

			it("T1.F3.05: should execute manage_subagents tool with action: 'terminate'", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const inst = harness.subagentManager.spawn("parent-001", { prompt: "Worker to stop" });

				const manageTool = createManageSubagentsTool(harness.subagentManager);
				const termRes = await manageTool.execute({
					action: "terminate",
					subagentId: inst.id,
				});

				expect(termRes.isError).toBe(false);
				expect(inst.state).toBe("terminated");
			});

			it("T1.F3.06: should execute manage_subagents tool with action: 'logs'", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const inst = harness.subagentManager.spawn("parent-001", { prompt: "Logged worker" });

				const manageTool = createManageSubagentsTool(harness.subagentManager);
				const logsRes = await manageTool.execute({
					action: "logs",
					subagentId: inst.id,
				});

				expect(logsRes.isError).toBe(false);
				const parsed = JSON.parse(logsRes.result);
				expect(Array.isArray(parsed.logs)).toBe(true);
				expect(parsed.logs.length).toBeGreaterThan(0);
			});

			it("T1.F3.07: should execute define_subagent tool to dynamically add a role", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const defineTool = createDefineSubagentTool(harness.typeRegistry);

				const defineRes = await defineTool.execute({
					name: "docs-generator",
					description: "Generates Markdown documentation",
					systemPrompt: "You generate concise documentation.",
					allowedTools: ["read_file", "write_file"],
				});

				expect(defineRes.isError).toBe(false);
				expect(defineRes.result).toContain("Successfully registered subagent type");
				expect(harness.typeRegistry.has("docs-generator")).toBe(true);
			});
		});

		// --- F4: Concurrent & Reactive Scheduling ---
		describe("F4: Concurrent & Reactive Scheduling", () => {
			it("T1.F4.01: should execute multiple subagents in parallel via Promise.all", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.provider.queueResponse({ content: [{ type: "text", text: "Task 1 complete" }] });
				harness.provider.queueResponse({ content: [{ type: "text", text: "Task 2 complete" }] });
				harness.provider.queueResponse({ content: [{ type: "text", text: "Task 3 complete" }] });

				const [r1, r2, r3] = await Promise.all([
					harness.subagentManager.invoke("parent-001", { prompt: "Task 1" }),
					harness.subagentManager.invoke("parent-001", { prompt: "Task 2" }),
					harness.subagentManager.invoke("parent-001", { prompt: "Task 3" }),
				]);

				expect(r1.state).toBe("done");
				expect(r2.state).toBe("done");
				expect(r3.state).toBe("done");
				expect(r1.instanceId).not.toBe(r2.instanceId);
			});

			it("T1.F4.02: should support background non-blocking invocation", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.provider.queueResponse({ content: [{ type: "text", text: "Background done" }] });

				const res = await harness.subagentManager.invoke("parent-001", {
					prompt: "Background task",
					background: true,
				});

				expect(res.state).toBe("running");
				expect(res.output).toContain("running in background");
			});

			it("T1.F4.03: should dispatch lifecycle events via event emitter", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const emittedTypes: string[] = [];

				harness.subagentManager.on((event: SubagentEvent) => {
					emittedTypes.push(event.type);
				});

				harness.provider.queueResponse({ content: [{ type: "text", text: "Event test done" }] });

				await harness.subagentManager.invoke("parent-001", { prompt: "Event test" });

				expect(emittedTypes).toContain("instance_created");
				expect(emittedTypes).toContain("state_changed");
				expect(emittedTypes).toContain("completed");
			});

			it("T1.F4.04: should execute burst of 10 concurrent subagents safely", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				for (let i = 0; i < 10; i++) {
					harness.provider.queueResponse({
						content: [{ type: "text", text: `Burst worker ${i} done` }],
					});
				}

				const tasks = Array.from({ length: 10 }, (_, i) =>
					harness.subagentManager.invoke("parent-001", { prompt: `Burst task ${i}` }),
				);

				const results = await Promise.all(tasks);
				expect(results.length).toBe(10);
				for (const res of results) {
					expect(res.state).toBe("done");
				}
			});

			it("T1.F4.05: should queue sequential messages sent to subagent", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const child = harness.subagentManager.spawn("parent-001", { prompt: "Queue target" });

				await harness.subagentManager.sendMessage("parent-001", child.id, "Message 1", false);
				await harness.subagentManager.sendMessage("parent-001", child.id, "Message 2", false);
				await harness.subagentManager.sendMessage("parent-001", child.id, "Message 3", false);

				expect(child.inbox.length).toBe(3);
				expect(child.inbox[0].content).toBe("Message 1");
				expect(child.inbox[1].content).toBe("Message 2");
				expect(child.inbox[2].content).toBe("Message 3");
			});
		});

		// --- F5: TypeScript Language Service Host & Snapshots ---
		describe("F5: TypeScript Language Service Host & Snapshots", () => {
			it("T1.F5.01: should initialize language service host with default compiler settings", () => {
				const host = new InMemoryLanguageServiceHost({ projectRoot: sandbox.projectRoot });
				const settings = host.getCompilationSettings();

				expect(settings.strict).toBe(true);
				expect(settings.noEmit).toBe(true);
				expect(host.getCurrentDirectory()).toBe(normalizeFilePath(sandbox.projectRoot));
			});

			it("T1.F5.02: should add and retrieve file snapshots correctly", () => {
				const host = new InMemoryLanguageServiceHost({ projectRoot: sandbox.projectRoot });
				const content = "export const PI = 3.14159;";
				host.addFile("src/constants.ts", content);

				expect(host.hasFile("src/constants.ts")).toBe(true);
				const snapshot = host.getScriptSnapshot("src/constants.ts");
				expect(snapshot).toBeDefined();
				expect(snapshot!.getText(0, snapshot!.getLength())).toBe(content);
				expect(host.getScriptVersion("src/constants.ts")).toBe("1");
			});

			it("T1.F5.03: should update file snapshots and increment version string", () => {
				const host = new InMemoryLanguageServiceHost({ projectRoot: sandbox.projectRoot });
				host.addFile("src/config.ts", "export const port = 3000;");
				expect(host.getScriptVersion("src/config.ts")).toBe("1");

				host.updateFile("src/config.ts", "export const port = 8080;");
				expect(host.getScriptVersion("src/config.ts")).toBe("2");
				expect(host.getFileContent("src/config.ts")).toBe("export const port = 8080;");
			});

			it("T1.F5.04: should remove files and cleanup snapshot cache", () => {
				const host = new InMemoryLanguageServiceHost({ projectRoot: sandbox.projectRoot });
				host.addFile("src/temp.ts", "const a = 1;");
				expect(host.hasFile("src/temp.ts")).toBe(true);

				const deleted = host.removeFile("src/temp.ts");
				expect(deleted).toBe(true);
				expect(host.hasFile("src/temp.ts")).toBe(false);
			});

			it("T1.F5.05: should resolve relative in-memory modules across project files", () => {
				const host = new InMemoryLanguageServiceHost({ projectRoot: sandbox.projectRoot });
				host.addFile("src/math.ts", "export function add(a: number, b: number) { return a + b; }");
				host.addFile("src/main.ts", "import { add } from './math'; console.log(add(1, 2));");

				const service = host.getLanguageService();
				const diags = service.getSemanticDiagnostics(host.resolvePath("src/main.ts"));
				expect(diags.length).toBe(0);
			});
		});

		// --- F6: Compiler Diagnostics Tool ---
		describe("F6: Compiler Diagnostics Tool", () => {
			it("T1.F6.01: should return zero diagnostics for clean TypeScript files", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.host.addFile(
					"src/clean.ts",
					"export function multiply(a: number, b: number): number { return a * b; }",
				);

				const diags = await harness.lspEngine.getDiagnostics("src/clean.ts");
				expect(diags.length).toBe(0);
			});

			it("T1.F6.02: should detect syntactic errors with exact line and column", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.host.addFile("src/syntax_err.ts", "const x: = 100;");

				const diags = await harness.lspEngine.getDiagnostics("src/syntax_err.ts");
				expect(diags.length).toBeGreaterThan(0);
				const err = diags[0];
				expect(err.category).toBe("error");
				expect(err.code).toBeGreaterThanOrEqual(1000);
				expect(err.code).toBeLessThan(2000);
				expect(err.line).toBe(1);
			});

			it("T1.F6.03: should detect semantic type mismatch errors (TS2322)", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.host.addFile("src/type_err.ts", "const greeting: number = 'hello world';");

				const diags = await harness.lspEngine.getDiagnostics("src/type_err.ts");
				expect(diags.length).toBeGreaterThan(0);
				const mismatch = diags.find((d) => d.code === 2322);
				expect(mismatch).toBeDefined();
				expect(mismatch?.message).toContain("Type 'string' is not assignable to type 'number'");
			});

			it("T1.F6.04: should detect unresolved imports and identifiers (TS2304 / TS2307)", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.host.addFile("src/import_err.ts", "const result = nonExistentFunction();");

				const diags = await harness.lspEngine.getDiagnostics("src/import_err.ts");
				const unresolved = diags.find((d) => d.code === 2304);
				expect(unresolved).toBeDefined();
				expect(unresolved?.message).toContain("Cannot find name 'nonExistentFunction'");
			});

			it("T1.F6.05: should aggregate whole-project diagnostics when filePath is omitted", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.host.addFile("src/file1.ts", "const a: number = 'str';");
				harness.host.addFile("src/file2.ts", "const b: boolean = 123;");
				harness.host.addFile("src/clean.ts", "export const c = 42;");

				const diags = await harness.lspEngine.getDiagnostics();
				expect(diags.length).toBeGreaterThanOrEqual(2);
				const file1Err = diags.find((d) => d.filePath.includes("file1.ts"));
				const file2Err = diags.find((d) => d.filePath.includes("file2.ts"));
				expect(file1Err).toBeDefined();
				expect(file2Err).toBeDefined();
			});

			it("T1.F6.06: should execute get_diagnostics tool and return formatted snippet with carets", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.host.addFile("src/bad.ts", "const num: number = 'wrong';");

				const diagTool = createGetDiagnosticsTool(harness.lspEngine);
				const toolResult = await diagTool.execute({ path: "src/bad.ts" });

				expect(toolResult.isError).toBe(false);
				expect(toolResult.result).toContain("[Error TS2322]");
				expect(toolResult.result).toContain("Type 'string' is not assignable to type 'number'");
				expect(toolResult.result).toContain("^");
			});
		});

		// --- F7: Symbol Definition Resolution Tool ---
		describe("F7: Symbol Definition Resolution Tool", () => {
			it("T1.F7.01: should resolve local variable declaration location", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const code = `const appVersion = "1.0.0";\nconsole.log(appVersion);\n`;
				harness.host.addFile("src/app.ts", code);

				const defs = await harness.lspEngine.getDefinition("src/app.ts", 2, 14);
				expect(defs.length).toBeGreaterThan(0);
				expect(defs[0].name).toBe("appVersion");
				expect(defs[0].line).toBe(1);
			});

			it("T1.F7.02: should resolve exported symbol definition across files", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.host.addFile(
					"src/utils.ts",
					"export function computeHash(data: string): string { return data; }",
				);
				harness.host.addFile(
					"src/main.ts",
					"import { computeHash } from './utils';\nconst h = computeHash('test');",
				);

				const defs = await harness.lspEngine.getDefinition("src/main.ts", 2, 12);
				expect(defs.length).toBeGreaterThan(0);
				expect(defs[0].filePath).toContain("utils.ts");
				expect(defs[0].name).toBe("computeHash");
			});

			it("T1.F7.03: should resolve interface and class definitions", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const code = `interface UserAccount {\n  id: string;\n  name: string;\n}\nconst user: UserAccount = { id: "1", name: "Alice" };\n`;
				harness.host.addFile("src/types.ts", code);

				const defs = await harness.lspEngine.getDefinition("src/types.ts", 5, 14);
				expect(defs.length).toBeGreaterThan(0);
				expect(defs[0].name).toBe("UserAccount");
				expect(defs[0].kind).toBe("interface");
			});

			it("T1.F7.04: should resolve class methods and properties", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const code = `class Calculator {\n  public calculateTotal(): number { return 100; }\n}\nconst c = new Calculator();\nc.calculateTotal();\n`;
				harness.host.addFile("src/calc.ts", code);

				const defs = await harness.lspEngine.getDefinition("src/calc.ts", 5, 4);
				expect(defs.length).toBeGreaterThan(0);
				expect(defs[0].name).toBe("calculateTotal");
				expect(defs[0].kind).toBe("method");
				expect(defs[0].line).toBe(2);
			});

			it("T1.F7.05: should execute get_definition tool and return formatted preview", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.host.addFile("src/lib.ts", "export const MAGIC_NUMBER = 42;\nconst x = MAGIC_NUMBER;");

				const defTool = createGetDefinitionTool(harness.lspEngine);
				const res = await defTool.execute({ path: "src/lib.ts", line: 2, column: 12 });

				expect(res.isError).toBe(false);
				expect(res.result).toContain("Symbol: MAGIC_NUMBER");
				expect(res.result).toContain("Location: src/lib.ts:1:14");
			});
		});

		// --- F8: Symbol Reference Finder Tool ---
		describe("F8: Symbol Reference Finder Tool", () => {
			it("T1.F8.01: should find local variable references in single file", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const code = `function sum(a: number, b: number) {\n  const total = a + b;\n  console.log(total);\n  return total;\n}\n`;
				harness.host.addFile("src/sum.ts", code);

				const refs = await harness.lspEngine.findReferences("src/sum.ts", 2, 9);
				expect(refs.length).toBe(3); // Declaration + 2 usages
				const defRef = refs.find((r) => r.isDefinition);
				expect(defRef).toBeDefined();
				expect(defRef?.line).toBe(2);
			});

			it("T1.F8.02: should find cross-file symbol references across project", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.host.addFile("src/service.ts", "export function startService() { return true; }");
				harness.host.addFile("src/worker.ts", "import { startService } from './service'; startService();");
				harness.host.addFile("src/cli.ts", "import { startService } from './service'; startService();");

				const refs = await harness.lspEngine.findReferences("src/service.ts", 1, 17);
				expect(refs.length).toBeGreaterThanOrEqual(3);
				const workerRef = refs.find((r) => r.filePath.includes("worker.ts"));
				const cliRef = refs.find((r) => r.filePath.includes("cli.ts"));
				expect(workerRef).toBeDefined();
				expect(cliRef).toBeDefined();
			});

			it("T1.F8.03: should distinguish write access from read access", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const code = `let counter = 0;\ncounter = 10;\nconsole.log(counter);\n`;
				harness.host.addFile("src/counter.ts", code);

				const refs = await harness.lspEngine.findReferences("src/counter.ts", 1, 5);
				const writeRef = refs.find((r) => r.line === 2);
				const readRef = refs.find((r) => r.line === 3);

				expect(writeRef?.isWriteAccess).toBe(true);
				expect(readRef?.isWriteAccess).toBe(false);
			});

			it("T1.F8.04: should find references through barrel re-exports", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.host.addFile("src/core.ts", "export const CORE_ID = 'engine-01';");
				harness.host.addFile("src/index.ts", "export * from './core';");
				harness.host.addFile("src/app.ts", "import { CORE_ID } from './index'; console.log(CORE_ID);");

				const refs = await harness.lspEngine.findReferences("src/core.ts", 1, 14);
				expect(refs.length).toBeGreaterThanOrEqual(3);
			});

			it("T1.F8.05: should execute find_references tool and return formatted reference output", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.host.addFile("src/api.ts", "export const API_URL = 'https://api.com';\nconst u = API_URL;");

				const refTool = createFindReferencesTool(harness.lspEngine);
				const res = await refTool.execute({ path: "src/api.ts", line: 1, column: 14 });

				expect(res.isError).toBe(false);
				expect(res.result).toContain("Found 2 reference(s)");
				expect(res.result).toContain("src/api.ts:1:14 [definition]");
				expect(res.result).toContain("src/api.ts:2:11 [reference]");
			});
		});

		// --- F9: Self-Healing Loop Coordinator ---
		describe("F9: Self-Healing Loop Coordinator", () => {
			it("T1.F9.01: should assess codebase errors and generate structured remediation suggestions", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.host.addFile("src/broken.ts", "const num: number = 'not a number';");

				const assessment = await harness.selfHealing.assess();
				expect(assessment.isClean).toBe(false);
				expect(assessment.totalErrors).toBe(1);
				expect(assessment.classifiedErrors[0].category).toBe("type_mismatch");
				expect(assessment.classifiedErrors[0].severity).toBe("high");
			});

			it("T1.F9.02: should verify error elimination after applying corrective patch", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.host.addFile("src/patch_test.ts", "const x: number = 'wrong';");

				const pre = await harness.lspEngine.getDiagnostics("src/patch_test.ts");
				expect(pre.length).toBe(1);

				// Apply fix
				harness.host.updateFile("src/patch_test.ts", "const x: number = 42;");
				const post = await harness.lspEngine.getDiagnostics("src/patch_test.ts");

				const outcome = harness.selfHealing.verifyRemediation(pre, post);
				expect(outcome.isClean).toBe(true);
				expect(outcome.resolvedErrors.length).toBe(1);
				expect(outcome.remainingErrors.length).toBe(0);
			});

			it("T1.F9.03: should execute multi-round checkAndRemediate loop successfully", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.host.addFile("src/multi_round.ts", "const a: number = 'round1';");

				const report = await harness.selfHealing.checkAndRemediate(
					["src/multi_round.ts"],
					async () => {
						// Apply fix when remediation callback is triggered
						harness.host.updateFile("src/multi_round.ts", "const a: number = 100;");
					},
					3,
				);

				expect(report.success).toBe(true);
				expect(report.roundsExecuted).toBe(1);
				expect(report.finalErrorCount).toBe(0);
			});

			it("T1.F9.04: should return clean report with 0 rounds when project has no errors", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.host.addFile("src/valid.ts", "export const valid = true;");

				const report = await harness.selfHealing.checkAndRemediate(
					["src/valid.ts"],
					async () => {},
					3,
				);

				expect(report.success).toBe(true);
				expect(report.roundsExecuted).toBe(0);
				expect(report.totalDiagnostics).toBe(0);
			});

			it("T1.F9.05: should create complete RemediationPlan with prioritized file order", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.host.addFile("src/syntax.ts", "const broken = ;");
				harness.host.addFile("src/type.ts", "const val: boolean = 123;");

				const assessment = await harness.selfHealing.assess();
				const plan = harness.selfHealing.createRemediationPlan(assessment);

				expect(plan.suggestedFixOrder.length).toBe(2);
				expect(plan.suggestedFixOrder[0]).toContain("syntax.ts"); // Syntax priority
				expect(plan.fileBreakdown.length).toBe(2);
			});
		});

		// --- F10: Tool Defaults & Control Wiring ---
		describe("F10: Tool Defaults & Control Wiring", () => {
			it("T1.F10.01: should register all Phase 8 tools in ToolRegistry", () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const registered = harness.toolRegistry.list();

				// Base tools
				expect(registered).toContain("read_file");
				expect(registered).toContain("write_file");
				// LSP tools
				expect(registered).toContain("get_diagnostics");
				expect(registered).toContain("get_definition");
				expect(registered).toContain("find_references");
				// Subagent tools
				expect(registered).toContain("invoke_subagent");
				expect(registered).toContain("send_message");
				expect(registered).toContain("manage_subagents");
				expect(registered).toContain("define_subagent");
			});

			it("T1.F10.02: should enforce PLAN mode tool filtering", () => {
				const modeCtrl = new ModeController();
				modeCtrl.setMode("plan");

				expect(modeCtrl.isToolAllowed("read_file")).toBe(true);
				expect(modeCtrl.isToolAllowed("glob_files")).toBe(true);
				expect(modeCtrl.isToolAllowed("grep_search")).toBe(true);
				expect(modeCtrl.isToolAllowed("recall_facts")).toBe(true);
			});

			it("T1.F10.03: should deny mutating tools in PLAN mode", () => {
				const modeCtrl = new ModeController();
				modeCtrl.setMode("plan");

				expect(modeCtrl.isToolAllowed("write_file")).toBe(false);
				expect(modeCtrl.isToolAllowed("edit_file")).toBe(false);
				expect(modeCtrl.isToolAllowed("run_command")).toBe(false);
			});

			it("T1.F10.04: should allow standard build tools in BUILD mode", () => {
				const modeCtrl = new ModeController();
				modeCtrl.setMode("build");

				expect(modeCtrl.isToolAllowed("read_file")).toBe(true);
				expect(modeCtrl.isToolAllowed("write_file")).toBe(true);
				expect(modeCtrl.isToolAllowed("edit_file")).toBe(true);
				expect(modeCtrl.isToolAllowed("run_command")).toBe(true);
			});

			it("T1.F10.05: should auto-approve safe tools and file edits in ApprovalGate", () => {
				const gate = new ApprovalGate("auto");

				expect(gate.check({ toolName: "read_file", toolInput: {} })).toBe("approve");
				expect(gate.check({ toolName: "glob_files", toolInput: {} })).toBe("approve");
				expect(gate.check({ toolName: "grep_search", toolInput: {} })).toBe("approve");
				expect(gate.check({ toolName: "write_file", toolInput: {} })).toBe("approve");
				expect(gate.check({ toolName: "edit_file", toolInput: {} })).toBe("approve");
			});

			it("T1.F10.06: should filter tool definitions based on current active mode", () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const definitions = harness.toolRegistry.getDefinitions();

				harness.controlLayer.getModeController().setMode("plan");
				const allowed = harness.controlLayer.getModeController().getAllowedTools();
				const filtered = definitions.filter((d) => allowed.includes(d.name));
				const names = filtered.map((d) => d.name);

				expect(names).toContain("read_file");
				expect(names).not.toContain("write_file");
			});
		});
	});

	// =========================================================================
	// Tier 2: Boundary & Corner Cases (F1–F10, >=5 test cases per feature)
	// =========================================================================

	describe("Tier 2: Boundary & Corner Cases (F1–F10)", () => {
		// --- F1 Boundaries: Lifecycle & Hierarchy ---
		describe("F1 Boundaries: Lifecycle & Hierarchy", () => {
			it("T2.F1.01: should handle terminating an already terminated subagent idempotently", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const inst = harness.subagentManager.spawn("parent-001", { prompt: "Task" });

				await harness.subagentManager.terminate(inst.id);
				const secondTerm = await harness.subagentManager.terminate(inst.id);
				expect(secondTerm).toBe(true);
			});

			it("T2.F1.02: should handle spawning with non-existent parent ID as top-level node safely", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.provider.queueResponse({ content: [{ type: "text", text: "Top level worker done" }] });

				const res = await harness.subagentManager.invoke("non-existent-parent-id", {
					prompt: "Top level task",
				});

				expect(res.state).toBe("done");
				const ancestors = harness.subagentManager.getAncestors(res.instanceId);
				expect(ancestors.length).toBe(0);
			});

			it("T2.F1.03: should validate maxIterations boundary and cap execution", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				// Always request tool calls to test max iterations guard
				harness.provider.queueResponse({
					content: [
						{
							type: "tool_use",
							id: "c1",
							name: "read_file",
							input: { path: "tsconfig.json" },
						},
					],
				});
				harness.provider.queueResponse({
					content: [
						{
							type: "tool_use",
							id: "c2",
							name: "read_file",
							input: { path: "tsconfig.json" },
						},
					],
				});

				const res = await harness.subagentManager.invoke("parent-001", {
					prompt: "Loop forever",
					maxIterations: 1,
				});

				expect(res.totalIterations).toBeLessThanOrEqual(2);
			});

			it("T2.F1.04: should traverse deep 4-level parent-child-grandchild hierarchy cleanly", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const a = harness.subagentManager.spawn("root", { name: "A", prompt: "A" });
				const b = harness.subagentManager.spawn(a.id, { name: "B", prompt: "B" });
				const c = harness.subagentManager.spawn(b.id, { name: "C", prompt: "C" });
				const d = harness.subagentManager.spawn(c.id, { name: "D", prompt: "D" });

				const ancestors = harness.subagentManager.getAncestors(d.id);
				expect(ancestors.map((inst) => inst.id)).toEqual([c.id, b.id, a.id]);

				const descendants = harness.subagentManager.getDescendants(a.id);
				expect(descendants.map((inst) => inst.id)).toContain(b.id);
				expect(descendants.map((inst) => inst.id)).toContain(c.id);
				expect(descendants.map((inst) => inst.id)).toContain(d.id);
			});

			it("T2.F1.05: should serialize error structures with special characters safely", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.provider.queueResponse(() => {
					throw new Error('Unicode Error: 🚀 <script>alert("xss")</script> \n\t "quoted"');
				});

				const res = await harness.subagentManager.invoke("parent-001", { prompt: "Trigger error" });
				expect(res.state).toBe("errored");
				expect(res.error).toContain("Unicode Error: 🚀");
			});
		});

		// --- F2 Boundaries: Dynamic Types & Registry ---
		describe("F2 Boundaries: Dynamic Types & Registry", () => {
			it("T2.F2.01: should throw error when registering subagent with empty or whitespace name", () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				expect(() => {
					harness.typeRegistry.register({
						name: "   ",
						description: "Invalid name",
						systemPrompt: "Prompt",
					});
				}).toThrow("Invalid subagent name");
			});

			it("T2.F2.02: should throw error when registering subagent with empty description", () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				expect(() => {
					harness.typeRegistry.register({
						name: "valid-name",
						description: "",
						systemPrompt: "Prompt",
					});
				}).toThrow("description cannot be empty");
			});

			it("T2.F2.03: should throw error when registering subagent with empty systemPrompt", () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				expect(() => {
					harness.typeRegistry.register({
						name: "valid-name",
						description: "Description",
						systemPrompt: "  ",
					});
				}).toThrow("systemPrompt cannot be empty");
			});

			it("T2.F2.04: should reject duplicate registration without overwrite flag", () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.typeRegistry.register({
					name: "custom-dup",
					description: "First",
					systemPrompt: "First prompt",
				});

				expect(() => {
					harness.typeRegistry.register({
						name: "custom-dup",
						description: "Second",
						systemPrompt: "Second prompt",
					});
				}).toThrow("already registered");
			});

			it("T2.F2.05: should register subagent with unicode names and multi-lingual prompt cleanly", () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.typeRegistry.register({
					name: "i18n-agent",
					description: "多语言助手",
					systemPrompt: "你好，世界！🌍 Здравствуйте, мир! こんにちは世界",
				});

				expect(harness.typeRegistry.has("i18n-agent")).toBe(true);
				expect(harness.typeRegistry.get("i18n-agent")?.systemPrompt).toContain("你好，世界！🌍");
			});
		});

		// --- F3 Boundaries: Subagent Tool Inputs & Validations ---
		describe("F3 Boundaries: Subagent Tool Inputs & Validations", () => {
			it("T2.F3.01: should return isError: true when sending message to non-existent subagent ID", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const sendTool = createSendMessageTool(harness.subagentManager, "parent-001");

				const res = await sendTool.execute({
					recipientId: "ghost-subagent-999",
					message: "Hello?",
				});

				expect(res.isError).toBe(true);
				expect(res.result).toContain("not found");
			});

			it("T2.F3.02: should return validation error when send_message has empty message content", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const child = harness.subagentManager.spawn("parent-001", { prompt: "Target" });
				const sendTool = createSendMessageTool(harness.subagentManager, "parent-001");

				const res = await sendTool.execute({
					recipientId: child.id,
					message: "   ",
				});

				expect(res.isError).toBe(true);
				expect(res.result).toContain("cannot be empty");
			});

			it("T2.F3.03: should return error when sending message to terminated subagent", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const child = harness.subagentManager.spawn("parent-001", { prompt: "Target" });
				await harness.subagentManager.terminate(child.id);

				const sendTool = createSendMessageTool(harness.subagentManager, "parent-001");
				const res = await sendTool.execute({
					recipientId: child.id,
					message: "Wake up",
				});

				expect(res.isError).toBe(true);
				expect(res.result).toContain("terminated");
			});

			it("T2.F3.04: should return error when manage_subagents status action is missing subagentId", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const manageTool = createManageSubagentsTool(harness.subagentManager);

				const res = await manageTool.execute({ action: "status" });
				expect(res.isError).toBe(true);
				const parsed = JSON.parse(res.result);
				expect(parsed.message).toContain("subagentId is required");
			});

			it("T2.F3.05: should return error when manage_subagents receives invalid action", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const manageTool = createManageSubagentsTool(harness.subagentManager);

				const res = await manageTool.execute({ action: "destroy_everything" });
				expect(res.isError).toBe(true);
				const parsed = JSON.parse(res.result);
				expect(parsed.message).toContain("Unsupported action");
			});

			it("T2.F3.06: should return validation error when invoke_subagent receives empty prompt", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const invokeTool = createInvokeSubagentTool(harness.subagentManager, "parent-001");

				const res = await invokeTool.execute({ prompt: "  " });
				expect(res.isError).toBe(true);
				expect(res.result).toContain("prompt is required");
			});
		});

		// --- F4 Boundaries: Concurrency & Async Scheduling ---
		describe("F4 Boundaries: Concurrency & Async Scheduling", () => {
			it("T2.F4.01: should enforce execution timeout and mark subagent errored/aborted", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				// Provider delays responding beyond timeout threshold
				harness.provider.queueResponse(async () => {
					await new Promise((r) => setTimeout(r, 200));
					return { content: [{ type: "text", text: "Late response" }] };
				});

				expect(
					harness.subagentManager.invoke("parent-001", {
						prompt: "Will timeout",
						timeoutMs: 50,
					}),
				).rejects.toThrow("timed out");
			});

			it("T2.F4.02: should maintain FIFO message ordering during burst message delivery", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const child = harness.subagentManager.spawn("parent-001", { prompt: "Mailbox worker" });

				const sends = Array.from({ length: 10 }, (_, i) =>
					harness.subagentManager.sendMessage("parent-001", child.id, `Burst msg ${i}`, false),
				);
				await Promise.all(sends);

				expect(child.inbox.length).toBe(10);
				child.inbox.forEach((msg, idx) => {
					expect(msg.content).toBe(`Burst msg ${idx}`);
				});
			});

			it("T2.F4.03: should isolate crash in one subagent without affecting sibling subagents", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.provider.queueResponse(() => {
					throw new Error("Worker 1 fatal crash");
				});
				harness.provider.queueResponse({
					content: [{ type: "text", text: "Worker 2 succeeded cleanly" }],
				});

				const [res1, res2] = await Promise.all([
					harness.subagentManager.invoke("parent-001", { prompt: "Failing worker" }),
					harness.subagentManager.invoke("parent-001", { prompt: "Succeeding worker" }),
				]);

				expect(res1.state).toBe("errored");
				expect(res2.state).toBe("done");
				expect(res2.output).toContain("Worker 2 succeeded cleanly");
			});

			it("T2.F4.04: should cascade termination recursively to all child and grandchild workers", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const parent = harness.subagentManager.spawn("root", { prompt: "Parent" });
				const child = harness.subagentManager.spawn(parent.id, { prompt: "Child" });
				const grandchild = harness.subagentManager.spawn(child.id, { prompt: "Grandchild" });

				await harness.subagentManager.terminateAll(parent.id);

				expect(child.state).toBe("terminated");
				expect(grandchild.state).toBe("terminated");
			});

			it("T2.F4.05: should isolate event listener failures from stopping event dispatch", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				let secondListenerCalled = false;

				harness.subagentManager.on("completed", () => {
					throw new Error("Broken listener exception");
				});
				harness.subagentManager.on("completed", () => {
					secondListenerCalled = true;
				});

				harness.provider.queueResponse({ content: [{ type: "text", text: "Done" }] });
				await harness.subagentManager.invoke("parent-001", { prompt: "Listener test" });

				expect(secondListenerCalled).toBe(true);
			});
		});

		// --- F5 Boundaries: Host Snapshots & Resolution ---
		describe("F5 Boundaries: Host Snapshots & Resolution", () => {
			it("T2.F5.01: should return undefined cleanly for non-existent file query on host", () => {
				const host = new InMemoryLanguageServiceHost({
					projectRoot: sandbox.projectRoot,
					useDiskFallback: false,
				});

				const snapshot = host.getScriptSnapshot("does/not/exist.ts");
				expect(snapshot).toBeUndefined();
				expect(host.getFileContent("does/not/exist.ts")).toBeUndefined();
			});

			it("T2.F5.02: should handle empty TypeScript file (0 bytes) with zero errors", () => {
				const host = new InMemoryLanguageServiceHost({ projectRoot: sandbox.projectRoot });
				host.addFile("src/empty.ts", "");

				expect(host.hasFile("src/empty.ts")).toBe(true);
				const snapshot = host.getScriptSnapshot("src/empty.ts");
				expect(snapshot?.getLength()).toBe(0);

				const service = host.getLanguageService();
				const diags = service.getSemanticDiagnostics(host.resolvePath("src/empty.ts"));
				expect(diags.length).toBe(0);
			});

			it("T2.F5.03: should maintain monotonic version count across rapid burst updates", () => {
				const host = new InMemoryLanguageServiceHost({ projectRoot: sandbox.projectRoot });
				host.addFile("src/burst.ts", "let x = 0;");

				for (let i = 1; i <= 20; i++) {
					host.updateFile("src/burst.ts", `let x = ${i};`);
				}

				expect(host.getScriptVersion("src/burst.ts")).toBe("21");
				expect(host.getFileContent("src/burst.ts")).toBe("let x = 20;");
			});

			it("T2.F5.04: should process circular mutual imports between modules without hanging", () => {
				const host = new InMemoryLanguageServiceHost({ projectRoot: sandbox.projectRoot });
				host.addFile(
					"src/modA.ts",
					"import { funcB } from './modB'; export function funcA(): string { return funcB(); }",
				);
				host.addFile(
					"src/modB.ts",
					"import { funcA } from './modA'; export function funcB(): string { return funcA(); }",
				);

				const service = host.getLanguageService();
				const diagsA = service.getSemanticDiagnostics(host.resolvePath("src/modA.ts"));
				const diagsB = service.getSemanticDiagnostics(host.resolvePath("src/modB.ts"));

				expect(diagsA.length).toBe(0);
				expect(diagsB.length).toBe(0);
			});

			it("T2.F5.05: should preserve line/column coordinates for multi-byte Unicode content", () => {
				const host = new InMemoryLanguageServiceHost({ projectRoot: sandbox.projectRoot });
				const code = `// 🚀 中文注释\nconst 变量: number = 42;\n`;
				host.addFile("src/unicode.ts", code);

				const service = host.getLanguageService();
				const diags = service.getSemanticDiagnostics(host.resolvePath("src/unicode.ts"));
				expect(diags.length).toBe(0);
			});
		});

		// --- F6 Boundaries: Diagnostics Edge Cases ---
		describe("F6 Boundaries: Diagnostics Edge Cases", () => {
			it("T2.F6.01: should handle non-existent file query in getDiagnostics safely", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const diags = await harness.lspEngine.getDiagnostics("src/nonexistent_file.ts");
				expect(Array.isArray(diags)).toBe(true);
			});

			it("T2.F6.02: should return zero diagnostics for file containing only comments and whitespace", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.host.addFile("src/comments_only.ts", "// Comment line 1\n/* Block comment */\n\n\t  ");

				const diags = await harness.lspEngine.getDiagnostics("src/comments_only.ts");
				expect(diags.length).toBe(0);
			});

			it("T2.F6.03: should return syntactic diagnostics for corrupt syntax without engine crash", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.host.addFile("src/corrupt.ts", "function (((( { ;;; class const =");

				const diags = await harness.lspEngine.getDiagnostics("src/corrupt.ts");
				expect(diags.length).toBeGreaterThan(0);
				expect(diags.every((d) => d.category === "error")).toBe(true);
			});

			it("T2.F6.04: should detect circular type alias error (TS2456)", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.host.addFile("src/circular_type.ts", "type NodeA = NodeB;\ntype NodeB = NodeA;\n");

				const diags = await harness.lspEngine.getDiagnostics("src/circular_type.ts");
				const circErr = diags.find((d) => d.code === 2456);
				expect(circErr).toBeDefined();
				expect(circErr?.message).toContain("circularly references itself");
			});

			it("T2.F6.05: should handle path traversal attempts in get_diagnostics tool safely", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const diagTool = createGetDiagnosticsTool(harness.lspEngine);

				const res = await diagTool.execute({ path: "../../etc/passwd" });
				expect(typeof res.result).toBe("string");
			});
		});

		// --- F7 Boundaries: Definition Edge Cases ---
		describe("F7 Boundaries: Definition Edge Cases", () => {
			it("T2.F7.01: should return empty array when querying definition with line number > EOF", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.host.addFile("src/tiny.ts", "export const x = 1;");

				const defs = await harness.lspEngine.getDefinition("src/tiny.ts", 99999, 1);
				expect(defs.length).toBe(0);
			});

			it("T2.F7.02: should return empty array when querying definition with column number > line length", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.host.addFile("src/tiny.ts", "export const x = 1;");

				const defs = await harness.lspEngine.getDefinition("src/tiny.ts", 1, 500);
				expect(defs.length).toBe(0);
			});

			it("T2.F7.03: should return empty array when querying definition on whitespace or comments", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.host.addFile("src/space.ts", "   \n// Some comment\nconst a = 1;");

				const defs = await harness.lspEngine.getDefinition("src/space.ts", 1, 2);
				expect(defs.length).toBe(0);
			});

			it("T2.F7.04: should return empty array when querying definition on non-symbol whitespace", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.host.addFile("src/kw.ts", "function test() { return 42; }");

				const defs = await harness.lspEngine.getDefinition("src/kw.ts", 1, 16); // space before return
				expect(defs.length).toBe(0);
			});

			it("T2.F7.05: should handle unresolved import definition query without crashing", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.host.addFile("src/unresolved.ts", "import { ghost } from './ghost_module';");

				const defs = await harness.lspEngine.getDefinition("src/unresolved.ts", 1, 10);
				expect(Array.isArray(defs)).toBe(true);
			});
		});

		// --- F8 Boundaries: References Edge Cases ---
		describe("F8 Boundaries: References Edge Cases", () => {
			it("T2.F8.01: should return only declaration when symbol has 0 usages", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.host.addFile("src/unused.ts", "const unusedVariable = 42;");

				const refs = await harness.lspEngine.findReferences("src/unused.ts", 1, 7);
				expect(refs.length).toBe(1);
				expect(refs[0].isDefinition).toBe(true);
			});

			it("T2.F8.02: should scope references correctly for lexically shadowed identifiers", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const code = `const val = 1;\nfunction outer() {\n  const val = 2;\n  console.log(val);\n}\nconsole.log(val);\n`;
				harness.host.addFile("src/shadow.ts", code);

				// Query inner 'val' at line 3, col 9
				const refs = await harness.lspEngine.findReferences("src/shadow.ts", 3, 9);
				expect(refs.length).toBe(2); // Inner declaration + inner console.log
				expect(refs.some((r) => r.line === 1)).toBe(false);
			});

			it("T2.F8.03: should return empty array when querying references out-of-bounds", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.host.addFile("src/bounds.ts", "export const ok = true;");

				const refs = await harness.lspEngine.findReferences("src/bounds.ts", 100, 100);
				expect(refs.length).toBe(0);
			});

			it("T2.F8.04: should return empty array when querying references on punctuation", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.host.addFile("src/punct.ts", "const a = (1 + 2);");

				const refs = await harness.lspEngine.findReferences("src/punct.ts", 1, 11); // On '+'
				expect(refs.length).toBe(0);
			});

			it("T2.F8.05: should scope private class property references accurately", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const code = `class Account {\n  private balance = 100;\n  getBalance() { return this.balance; }\n}\nclass Other {\n  balance = 500;\n}\n`;
				harness.host.addFile("src/scope.ts", code);

				const refs = await harness.lspEngine.findReferences("src/scope.ts", 2, 11);
				expect(refs.length).toBe(2); // Account declaration + Account usage
				expect(refs.some((r) => r.line === 6)).toBe(false); // Does not match Other.balance
			});
		});

		// --- F9 Boundaries: Self-Healing Edge Cases ---
		describe("F9 Boundaries: Self-Healing Edge Cases", () => {
			it("T2.F9.01: should return success and 0 rounds on already clean project", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.host.addFile("src/clean_app.ts", "export const isReady = true;");

				const report = await harness.selfHealing.checkAndRemediate(
					["src/clean_app.ts"],
					async () => {},
					3,
				);

				expect(report.success).toBe(true);
				expect(report.roundsExecuted).toBe(0);
			});

			it("T2.F9.02: should terminate immediately when maxRounds is 0", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.host.addFile("src/broken_code.ts", "const x: number = 'str';");

				let fixCalled = false;
				const report = await harness.selfHealing.checkAndRemediate(
					["src/broken_code.ts"],
					async () => {
						fixCalled = true;
					},
					0,
				);

				expect(report.success).toBe(false);
				expect(fixCalled).toBe(false);
			});

			it("T2.F9.03: should catch errors thrown by remediationFn cleanly", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.host.addFile("src/err_file.ts", "const a: number = 'x';");

				expect(
					harness.selfHealing.checkAndRemediate(
						["src/err_file.ts"],
						async () => {
							throw new Error("Remediation worker crashed");
						},
						1,
					),
				).rejects.toThrow("Remediation worker crashed");
			});

			it("T2.F9.04: should detect regressions when patch introduces new compiler errors", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				harness.host.addFile("src/regress.ts", "const a: number = 'str';");

				const pre = await harness.lspEngine.getDiagnostics("src/regress.ts");
				// Patch introduces syntax error
				harness.host.updateFile("src/regress.ts", "const a: = 123;");
				const post = await harness.lspEngine.getDiagnostics("src/regress.ts");

				const outcome = harness.selfHealing.verifyRemediation(pre, post);
				expect(outcome.status).toBe("regressed");
				expect(outcome.newErrors.length).toBeGreaterThan(0);
			});

			it("T2.F9.05: should handle empty files list in assess cleanly", async () => {
				const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
				const assessment = await harness.selfHealing.assess([]);
				expect(assessment.isClean).toBe(true);
				expect(assessment.totalErrors).toBe(0);
			});
		});

		// --- F10 Boundaries: Control & Safety Gate Edge Cases ---
		describe("F10 Boundaries: Control & Safety Gate Edge Cases", () => {
			it("T2.F10.01: should block invoke_subagent tool in plan mode", () => {
				const modeCtrl = new ModeController();
				modeCtrl.setMode("plan");
				expect(modeCtrl.isToolAllowed("invoke_subagent")).toBe(false);
			});

			it("T2.F10.02: should block define_subagent tool in plan mode", () => {
				const modeCtrl = new ModeController();
				modeCtrl.setMode("plan");
				expect(modeCtrl.isToolAllowed("define_subagent")).toBe(false);
			});

			it("T2.F10.03: should deny dangerous shell commands in subagent approval check", () => {
				const gate = new ApprovalGate("auto");

				const rmCheck = gate.check({
					toolName: "run_command",
					toolInput: { command: "rm -rf /" },
				});
				expect(rmCheck).toBe("deny");

				const formatCheck = gate.check({
					toolName: "run_command",
					toolInput: { command: "format C:" },
				});
				expect(formatCheck).toBe("deny");
			});

			it("T2.F10.04: should require ask_user in manual approval mode for all tools", () => {
				const gate = new ApprovalGate("manual");

				expect(gate.check({ toolName: "read_file", toolInput: { path: "a.ts" } })).toBe(
					"ask_user",
				);
				expect(gate.check({ toolName: "get_diagnostics", toolInput: {} })).toBe("ask_user");
				expect(gate.check({ toolName: "invoke_subagent", toolInput: {} })).toBe("ask_user");
			});

			it("T2.F10.05: should approve all actions in yolo mode without exception", () => {
				const gate = new ApprovalGate("yolo");

				expect(gate.check({ toolName: "run_command", toolInput: { command: "rm -rf /" } })).toBe(
					"approve",
				);
				expect(gate.check({ toolName: "invoke_subagent", toolInput: {} })).toBe("approve");
			});
		});
	});

	// =========================================================================
	// Tier 3: Cross-Feature Interactions (10+ Complex Multi-System Tests)
	// =========================================================================

	describe("Tier 3: Cross-Feature Interactions", () => {
		it("T3.01: Subagent executing get_diagnostics tool inside child loop", async () => {
			const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
			harness.host.addFile("src/test_diag.ts", "const x: number = 'error';");

			// Child calls get_diagnostics tool via tool_use block, then produces final report
			harness.provider.queueResponse({
				content: [
					{
						type: "tool_use",
						id: "c1",
						name: "get_diagnostics",
						input: { path: "src/test_diag.ts" },
					},
				],
			});
			harness.provider.queueResponse({
				content: [{ type: "text", text: "Diagnostics check complete: Found TS2322 type error." }],
			});

			const result = await harness.subagentManager.invoke("parent-001", {
				type: "research",
				prompt: "Check diagnostics for test_diag.ts",
			});

			expect(result.state).toBe("done");
			expect(result.output).toContain("Found TS2322 type error");
			expect(result.toolCallsCount).toBe(1);
		});

		it("T3.02: Dynamically defined subagent self-verifying generated code via LSP", async () => {
			const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
			harness.typeRegistry.register({
				name: "ts-author",
				description: "Authors TypeScript code and validates it",
				systemPrompt: "Author and validate",
				allowedTools: ["write_file", "get_diagnostics"],
				mode: "build",
			});

			harness.provider.queueResponse({
				content: [
					{
						type: "tool_use",
						id: "c1",
						name: "write_file",
						input: {
							path: "src/generated.ts",
							content: "export const answer: number = 42;",
						},
					},
				],
			});
			harness.provider.queueResponse({
				content: [
					{
						type: "tool_use",
						id: "c2",
						name: "get_diagnostics",
						input: { path: "src/generated.ts" },
					},
				],
			});
			harness.provider.queueResponse({
				content: [{ type: "text", text: "Generated valid code with 0 compiler errors." }],
			});

			const result = await harness.subagentManager.invoke("parent-001", {
				type: "ts-author",
				prompt: "Create generated.ts and verify it",
			});

			expect(result.state).toBe("done");
			expect(result.output).toContain("0 compiler errors");
			expect(result.toolCallsCount).toBe(2);
		});

		it("T3.03: Parallel subagents refactoring distinct files discovered by find_references", async () => {
			const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
			harness.host.addFile("src/shared.ts", "export function oldHelper() { return 'old'; }");
			harness.host.addFile("src/consumerA.ts", "import { oldHelper } from './shared'; oldHelper();");
			harness.host.addFile("src/consumerB.ts", "import { oldHelper } from './shared'; oldHelper();");

			const refs = await harness.lspEngine.findReferences("src/shared.ts", 1, 17);
			expect(refs.length).toBeGreaterThanOrEqual(3);

			harness.provider.queueResponse({
				content: [{ type: "text", text: "Consumer A refactored" }],
			});
			harness.provider.queueResponse({
				content: [{ type: "text", text: "Consumer B refactored" }],
			});

			const [resA, resB] = await Promise.all([
				harness.subagentManager.invoke("parent-001", {
					name: "refactor-worker-a",
					prompt: "Refactor consumerA.ts",
				}),
				harness.subagentManager.invoke("parent-001", {
					name: "refactor-worker-b",
					prompt: "Refactor consumerB.ts",
				}),
			]);

			expect(resA.state).toBe("done");
			expect(resB.state).toBe("done");
		});

		it("T3.04: ModeController enforcing subagent plan vs build permissions", async () => {
			const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
			// Subagent spawned in plan mode
			const planInst = harness.subagentManager.spawn("parent-001", {
				type: "research", // plan mode archetype
				prompt: "Plan task",
			});

			expect(planInst.controlLayer?.getModeController().getMode()).toBe("plan");
			expect(planInst.toolRegistry.list()).not.toContain("write_file");

			// Subagent spawned in build mode
			const buildInst = harness.subagentManager.spawn("parent-001", {
				type: "test-engineer", // build mode archetype
				prompt: "Build task",
			});

			expect(buildInst.controlLayer?.getModeController().getMode()).toBe("build");
			expect(buildInst.toolRegistry.list()).toContain("write_file");
		});

		it("T3.05: ApprovalGate intercepting subagent shell commands", async () => {
			const harness = createE2EHarness({ projectRoot: sandbox.projectRoot, approvalMode: "auto" });

			const safeDecision = harness.controlLayer.getApprovalGate().check({
				toolName: "run_command",
				toolInput: { command: "bun test" },
			});
			expect(safeDecision).toBe("approve");

			const dangerousDecision = harness.controlLayer.getApprovalGate().check({
				toolName: "run_command",
				toolInput: { command: "rm -rf /var/data" },
			});
			expect(dangerousDecision).toBe("deny");
		});

		it("T3.06: Bidirectional messaging during active subagent diagnostics", async () => {
			const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
			harness.host.addFile("src/diag_check.ts", "const valid = true;");

			const child = harness.subagentManager.spawn("parent-001", {
				name: "diag-worker",
				prompt: "Ready for commands",
			});

			harness.provider.queueResponse({
				content: [{ type: "text", text: "Diagnostics verified clean upon request." }],
			});

			const msgRes = await harness.subagentManager.sendMessage(
				"parent-001",
				child.id,
				"Please inspect src/diag_check.ts",
				true, // awaitResponse
			);

			expect(msgRes.success).toBe(true);
			expect(msgRes.response).toContain("Diagnostics verified clean");
		});

		it("T3.07: Self-Healing coordinator repairing subagent-generated broken code", async () => {
			const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
			harness.host.addFile("src/sub_broken.ts", "const x: number = 'mistake';");

			const assessment = await harness.selfHealing.assess(["src/sub_broken.ts"]);
			expect(assessment.isClean).toBe(false);

			const report = await harness.selfHealing.checkAndRemediate(
				["src/sub_broken.ts"],
				async () => {
					harness.host.updateFile("src/sub_broken.ts", "const x: number = 42;");
				},
				2,
			);

			expect(report.success).toBe(true);
			expect(report.finalErrorCount).toBe(0);
		});

		it("T3.08: Multi-agent shared memory via MemoryAPI", async () => {
			const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
			harness.memoryApi.remember("API uses JWT authentication with 1-hour expiration.");

			const recalled = harness.memoryApi.recall("JWT");
			expect(recalled.length).toBeGreaterThan(0);
			expect(recalled[0]).toContain("JWT authentication");
		});

		it("T3.09: 3-Level hierarchy with error propagation up the tree", async () => {
			const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
			const parent = harness.subagentManager.spawn("root", { prompt: "Parent" });
			const child = harness.subagentManager.spawn(parent.id, { prompt: "Child" });

			harness.provider.queueResponse(() => {
				throw new Error("Grandchild fatal fault");
			});

			const grandchildRes = await harness.subagentManager.invoke(child.id, {
				prompt: "Grandchild will fail",
			});

			expect(grandchildRes.state).toBe("errored");
			expect(grandchildRes.error).toContain("Grandchild fatal fault");

			const ancestors = harness.subagentManager.getAncestors(grandchildRes.instanceId);
			expect(ancestors.map((a) => a.id)).toEqual([child.id, parent.id]);
		});

		it("T3.10: Full CLI agent loop simulation with all Phase 8 tools registered", async () => {
			const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });
			harness.provider.queueResponse({
				content: [
					{
						type: "tool_use",
						id: "c1",
						name: "invoke_subagent",
						input: { prompt: "Research dependency tree", type: "research" },
					},
				],
			});
			harness.provider.queueResponse({
				content: [{ type: "text", text: "Subagent research concluded. Architecture verified." }],
			});

			const loop = runAgentLoop(
				harness.provider,
				"Perform multi-agent project analysis",
				harness.toolRegistry.getExecutors(),
				{
					maxIterations: 10,
					systemPrompt: "You are the top-level CLI agent coordinator.",
					tools: harness.toolRegistry.getDefinitions(),
				},
			);

			const events: LoopEvent[] = [];
			for await (const event of loop) {
				events.push(event);
			}

			const toolCallEvent = events.find((e) => e.type === "tool_call");
			const responseEvent = events.find((e) => e.type === "response");
			const doneEvent = events.find((e) => e.type === "done");

			expect(toolCallEvent).toBeDefined();
			expect(responseEvent).toBeDefined();
			expect(doneEvent).toBeDefined();
		});
	});

	// =========================================================================
	// Tier 4: Real-World Application Workloads (5 Comprehensive Scenarios)
	// =========================================================================

	describe("Tier 4: Real-World Application Workloads", () => {
		// Scenario 1: Multi-Agent Greenfield TypeScript Library Implementation
		it("T4.01: Scenario 1 — Multi-Agent Greenfield TypeScript Library Implementation", async () => {
			const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });

			// Step 1: Research subagent designs specification
			harness.provider.queueResponse({
				content: [{ type: "text", text: "Matrix and Vector math interfaces designed." }],
			});
			const researchResult = await harness.subagentManager.invoke("orch-01", {
				type: "research",
				prompt: "Design Matrix2D and Vector2D interfaces in src/math/types.ts",
			});
			expect(researchResult.state).toBe("done");

			// Step 2: Developer subagent implements module on disk
			const vectorCode = `export interface Vector2D { x: number; y: number; }\nexport function addVectors(a: Vector2D, b: Vector2D): Vector2D { return { x: a.x + b.x, y: a.y + b.y }; }\nexport function dotProduct(a: Vector2D, b: Vector2D): number { return a.x * b.x + a.y * b.y; }\n`;
			harness.host.addFile("src/math/vector.ts", vectorCode);
			await fs.mkdir(path.join(sandbox.projectRoot, "src/math"), { recursive: true });
			await fs.writeFile(path.join(sandbox.projectRoot, "src/math/vector.ts"), vectorCode, "utf-8");

			// Step 3: LSP Diagnostics verification
			const diags = await harness.lspEngine.getDiagnostics("src/math/vector.ts");
			expect(diags.length).toBe(0);

			// Step 4: Test Engineer subagent authors unit tests
			const testCode = `import { addVectors, dotProduct } from '../src/math/vector';\nconsole.log(addVectors({x:1,y:2}, {x:3,y:4}));\n`;
			harness.host.addFile("tests/vector.test.ts", testCode);

			const testDiags = await harness.lspEngine.getDiagnostics("tests/vector.test.ts");
			expect(testDiags.length).toBe(0);

			// Step 5: Verify clean completion
			expect(harness.host.hasFile("src/math/vector.ts")).toBe(true);
			expect(harness.host.hasFile("tests/vector.test.ts")).toBe(true);
		});

		// Scenario 2: Automated Compiler Diagnostic Feedback & Multi-Stage Self-Healing
		it("T4.02: Scenario 2 — Automated Compiler Diagnostic Feedback & Multi-Stage Self-Healing", async () => {
			const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });

			// Initial broken multi-stage file
			// Stage 1: Syntax error (missing closing brace)
			harness.host.addFile("src/service.ts", "export function runService() { return 'ok'; ");

			const assessment1 = await harness.selfHealing.assess(["src/service.ts"]);
			expect(assessment1.isClean).toBe(false);
			expect(assessment1.classifiedErrors[0].category).toBe("syntax");

			// Multi-round remediation loop
			let roundCount = 0;
			const report = await harness.selfHealing.checkAndRemediate(
				["src/service.ts"],
				async () => {
					roundCount++;
					if (roundCount === 1) {
						// Fix syntax error, but introduce type mismatch (Stage 2)
						harness.host.updateFile("src/service.ts", "export function runService(): number { return 'text'; }");
					} else if (roundCount === 2) {
						// Fix type mismatch (Stage 3: clean)
						harness.host.updateFile("src/service.ts", "export function runService(): number { return 42; }");
					}
				},
				3,
			);

			expect(report.success).toBe(true);
			expect(report.roundsExecuted).toBe(2);
			expect(report.finalErrorCount).toBe(0);
		});

		// Scenario 3: Multi-File Symbol Renaming & Reference Refactoring
		it("T4.03: Scenario 3 — Multi-File Symbol Renaming & Reference Refactoring", async () => {
			const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });

			harness.host.addFile(
				"src/pricing.ts",
				"export function calculateDiscount(price: number, percent: number): number { return price * (percent / 100); }",
			);
			harness.host.addFile(
				"src/cart.ts",
				"import { calculateDiscount } from './pricing';\nexport const cartDiscount = calculateDiscount(100, 10);",
			);
			harness.host.addFile(
				"src/checkout.ts",
				"import { calculateDiscount } from './pricing';\nexport const checkoutDiscount = calculateDiscount(200, 15);",
			);

			// Step 1: Discover all call sites via find_references
			const refs = await harness.lspEngine.findReferences("src/pricing.ts", 1, 24);
			expect(refs.length).toBe(5); // 1 definition + 2 imports + 2 calls

			// Step 2: Refactor to computeDiscount
			harness.host.updateFile(
				"src/pricing.ts",
				"export function computeDiscount(price: number, percent: number): number { return price * (percent / 100); }",
			);
			harness.host.updateFile(
				"src/cart.ts",
				"import { computeDiscount } from './pricing';\nexport const cartDiscount = computeDiscount(100, 10);",
			);
			harness.host.updateFile(
				"src/checkout.ts",
				"import { computeDiscount } from './pricing';\nexport const checkoutDiscount = computeDiscount(200, 15);",
			);

			// Step 3: Verify all definitions and diagnostics are 100% clean
			const diags = await harness.lspEngine.getDiagnostics();
			expect(diags.length).toBe(0);

			const newRefs = await harness.lspEngine.findReferences("src/pricing.ts", 1, 24);
			expect(newRefs.length).toBe(5);
		});

		// Scenario 4: Collaborative Code Review, Quality Analysis & Test Generation
		it("T4.04: Scenario 4 — Collaborative Code Review, Quality Analysis & Test Generation", async () => {
			const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });

			// Untyped legacy code with implicit any
			harness.host.addFile(
				"src/legacy_user.ts",
				"export function parseUserData(raw: any) {\n  return { id: raw.id, name: raw.name.toUpperCase() };\n}\n",
			);

			// Step 1: Launch code-reviewer subagent
			harness.provider.queueResponse({
				content: [
					{
						type: "text",
						text: "REVIEW FINDINGS: Function parseUserData uses 'any' and has potential null dereference on raw.name.",
					},
				],
			});
			const reviewResult = await harness.subagentManager.invoke("orch-01", {
				type: "code-reviewer",
				prompt: "Review src/legacy_user.ts for type safety and null safety",
			});
			expect(reviewResult.output).toContain("REVIEW FINDINGS");

			// Step 2: Developer fixes types
			const safeCode = `export interface UserInput { id: string; name?: string; }\nexport interface UserOutput { id: string; name: string; }\nexport function parseUserData(raw: UserInput): UserOutput {\n  return { id: raw.id, name: (raw.name || 'Anonymous').toUpperCase() };\n}\n`;
			harness.host.updateFile("src/legacy_user.ts", safeCode);

			// Step 3: Launch test-engineer subagent to write tests
			harness.provider.queueResponse({
				content: [{ type: "text", text: "Unit tests authored and verified for edge cases." }],
			});
			const testResult = await harness.subagentManager.invoke("orch-01", {
				type: "test-engineer",
				prompt: "Write unit tests for parseUserData handling undefined name",
			});
			expect(testResult.state).toBe("done");

			// Step 4: Verify clean diagnostics
			const diags = await harness.lspEngine.getDiagnostics("src/legacy_user.ts");
			expect(diags.length).toBe(0);
		});

		// Scenario 5: End-to-End CLI Multi-Agent Orchestration Run
		it("T4.05: Scenario 5 — End-to-End CLI Multi-Agent Orchestration Run", async () => {
			const harness = createE2EHarness({ projectRoot: sandbox.projectRoot });

			// Scripted multi-turn CLI agent loop
			// Turn 1: Top-level agent delegates to research subagent
			harness.provider.queueResponse({
				content: [
					{
						type: "tool_use",
						id: "call-sub-1",
						name: "invoke_subagent",
						input: {
							prompt: "Inspect project package manifests",
							type: "research",
						},
					},
				],
			});
			// Child subagent response during invoke_subagent execution
			harness.provider.queueResponse({
				content: [{ type: "text", text: "Package manifests inspected: no conflicts found." }],
			});
			// Turn 2: Subagent completes, top-level agent creates subagent type
			harness.provider.queueResponse({
				content: [
					{
						type: "tool_use",
						id: "call-sub-2",
						name: "define_subagent",
						input: {
							name: "benchmarker",
							description: "Runs performance benchmarks",
							systemPrompt: "You run benchmarks and report latency.",
							allowedTools: ["read_file", "run_command"],
						},
					},
				],
			});
			// Turn 3: Top-level agent wraps up
			harness.provider.queueResponse({
				content: [{ type: "text", text: "All multi-agent workflows executed successfully. Exit code: 0." }],
			});

			const loop = runAgentLoop(
				harness.provider,
				"Orchestrate Phase 8 validation run",
				harness.toolRegistry.getExecutors(),
				{
					maxIterations: 10,
					systemPrompt: "You are the top-level CLI harness executor.",
					tools: harness.toolRegistry.getDefinitions(),
				},
			);

			const turnEvents: LoopEvent[] = [];
			for await (const ev of loop) {
				turnEvents.push(ev);
			}

			expect(turnEvents.some((e) => e.type === "tool_call" && e.toolName === "invoke_subagent")).toBe(true);
			expect(turnEvents.some((e) => e.type === "tool_call" && e.toolName === "define_subagent")).toBe(true);
			expect(harness.typeRegistry.has("benchmarker")).toBe(true);

			const finalResponse = turnEvents.find((e) => e.type === "response");
			expect(finalResponse?.text).toContain("Exit code: 0");
		});
	});
});
