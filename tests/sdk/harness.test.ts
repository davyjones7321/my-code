import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { Harness } from "../../src/sdk/harness.ts";
import { HarnessSession } from "../../src/sdk/session.ts";
import type { Tool } from "../../src/tools/registry.ts";
import { MockSDKProvider, createMockTool } from "./test-helpers.ts";

describe("SDK Tier 1-4: Harness Core & Configuration Suite", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-sdk-test-"));
	});

	afterEach(async () => {
		try {
			await fs.rm(tempDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors on Windows
		}
	});

	// ==========================================
	// TIER 1: FEATURE COVERAGE
	// ==========================================

	it("H-01: should instantiate Harness with default options and isolated config", () => {
		const harness = new Harness({
			loadDiskConfig: false,
			projectRoot: tempDir,
		});

		expect(harness).toBeInstanceOf(Harness);
		const config = harness.getConfig();
		expect(config).toBeDefined();
		expect(config.projectRoot).toBe(tempDir);
		expect(config.approvalMode).toBeDefined();
	});

	it("H-02: should accept programmatic configuration overrides", () => {
		const harness = new Harness({
			loadDiskConfig: false,
			projectRoot: tempDir,
			defaultProvider: "mock-custom-provider",
			model: "mock-custom-model",
			mode: "plan",
			approvalMode: "manual",
			systemPrompt: "You are a custom SDK test agent.",
			maxIterations: 12,
			maxTokens: 50000,
		});

		const config = harness.getConfig();
		expect(config.defaultProvider).toBe("mock-custom-provider");
		expect(harness.getDefaultModel()).toBe("mock-custom-model");
		expect(config.approvalMode).toBe("manual");
		expect(config.maxIterations).toBe(12);
	});

	it("H-03: should enforce pure in-memory isolation when loadDiskConfig is false", () => {
		const harness = new Harness({
			loadDiskConfig: false,
			projectRoot: tempDir,
			defaultProvider: "anthropic",
			model: "claude-3-5-sonnet",
		});

		const config = harness.getConfig();
		expect(config.defaultProvider).toBe("anthropic");
		expect(harness.getDefaultModel()).toBe("claude-3-5-sonnet");
	});

	it("H-04: should register and list custom tools at harness level", () => {
		const harness = new Harness({
			loadDiskConfig: false,
			projectRoot: tempDir,
		});

		const customTool1 = createMockTool("calculator", async (input) => ({
			result: `Calculated ${input.expr}`,
			isError: false,
		}));

		const customTool2 = createMockTool("fetch_weather", async (input) => ({
			result: `Weather in ${input.city}: sunny`,
			isError: false,
		}));

		harness.registerTool(customTool1);
		harness.registerTool(customTool2);

		const tools = harness.listTools();
		expect(tools).toContain("calculator");
		expect(tools).toContain("fetch_weather");
		// Should also include built-in tools
		expect(tools).toContain("read_file");
		expect(tools).toContain("write_file");
		expect(tools).toContain("run_command");
	});

	it("H-05: should register and list custom providers at harness level", () => {
		const harness = new Harness({
			loadDiskConfig: false,
			projectRoot: tempDir,
		});

		const mockProvider = new MockSDKProvider("custom-local-llm");
		harness.registerProvider(mockProvider);

		const providers = harness.listProviders();
		expect(providers).toContain("custom-local-llm");
	});

	it("H-06: should create HarnessSession inheriting harness defaults", () => {
		const harness = new Harness({
			loadDiskConfig: false,
			projectRoot: tempDir,
			mode: "build",
			approvalMode: "yolo",
			systemPrompt: "Base harness prompt",
		});

		const mockProvider = new MockSDKProvider("inherited-provider");
		harness.registerProvider(mockProvider);

		const session = harness.createSession({
			providerName: "inherited-provider",
		});

		expect(session).toBeInstanceOf(HarnessSession);
		const state = session.getState();
		expect(state.mode).toBe("build");
		expect(state.approvalMode).toBe("yolo");
		expect(state.providerName).toBe("inherited-provider");
	});

	it("H-07: should allow session-level option overrides to take precedence", () => {
		const harness = new Harness({
			loadDiskConfig: false,
			projectRoot: tempDir,
			mode: "build",
			approvalMode: "auto",
			model: "harness-default-model",
		});

		const mockProvider1 = new MockSDKProvider("p1");
		const mockProvider2 = new MockSDKProvider("p2");
		harness.registerProvider(mockProvider1);
		harness.registerProvider(mockProvider2);

		const session = harness.createSession({
			providerName: "p2",
			modelName: "session-override-model",
			mode: "plan",
			approvalMode: "manual",
			systemPrompt: "Overridden session prompt",
		});

		const state = session.getState();
		expect(state.providerName).toBe("p2");
		expect(state.modelName).toBe("session-override-model");
		expect(state.mode).toBe("plan");
		expect(state.approvalMode).toBe("manual");
	});

	// ==========================================
	// TIER 2: BOUNDARY & ERROR CONDITIONS
	// ==========================================

	it("H-08: should handle tool re-registration cleanly by overwriting or updating definition", () => {
		const harness = new Harness({
			loadDiskConfig: false,
			projectRoot: tempDir,
		});

		const toolV1 = createMockTool("dynamic_calc", async () => ({
			result: "v1",
			isError: false,
		}));
		const toolV2 = createMockTool("dynamic_calc", async () => ({
			result: "v2",
			isError: false,
		}));

		harness.registerTool(toolV1);
		harness.registerTool(toolV2);

		const tools = harness.listTools();
		const matches = tools.filter((t) => t === "dynamic_calc");
		expect(matches.length).toBe(1);
	});

	it("H-09: should initialize harness with empty tools and providers list without crashing", () => {
		const harness = new Harness({
			loadDiskConfig: false,
			projectRoot: tempDir,
			tools: [],
			providers: {},
		});

		expect(harness.listTools().length).toBeGreaterThan(0); // built-ins still present
		expect(harness.listProviders()).toBeDefined();
	});

	it("H-10: should throw or fail when executing session with non-existent provider", async () => {
		const harness = new Harness({
			loadDiskConfig: false,
			projectRoot: tempDir,
			defaultProvider: "non-existent-provider",
		});

		const session = harness.createSession({ providerName: "non-existent-provider" });
		expect(session.getCurrentProvider()).toBeUndefined();
		await expect(session.send("Test")).rejects.toThrow();
	});

	// ==========================================
	// TIER 3: CROSS-FEATURE COMBINATIONS
	// ==========================================

	it("H-11: should pass custom providers and custom tools down to created sessions", async () => {
		const harness = new Harness({
			loadDiskConfig: false,
			projectRoot: tempDir,
		});

		const provider = new MockSDKProvider("harness-combo-provider");
		provider.queueToolCallResponse("sdk_echo", { message: "hello SDK" }, "call_1");
		provider.queueTextResponse("Echo received: hello SDK");

		const echoTool = createMockTool("sdk_echo", async (input) => ({
			result: `Echo: ${input.message}`,
			isError: false,
		}));

		harness.registerProvider(provider);
		harness.registerTool(echoTool);

		const session = harness.createSession({
			providerName: "harness-combo-provider",
			approvalMode: "yolo",
		});

		const result = await session.send("Run echo test");
		expect(result.response).toContain("Echo received: hello SDK");
		expect(result.events.some((e) => e.type === "tool_call" && (e as any).toolName === "sdk_echo")).toBe(true);
	});

	it("H-12: should keep multiple sessions created from the same harness isolated", async () => {
		const harness = new Harness({
			loadDiskConfig: false,
			projectRoot: tempDir,
		});

		const provider1 = new MockSDKProvider("p-session-1");
		provider1.queueTextResponse("Response from Session 1");

		const provider2 = new MockSDKProvider("p-session-2");
		provider2.queueTextResponse("Response from Session 2");

		harness.registerProvider(provider1);
		harness.registerProvider(provider2);

		const session1 = harness.createSession({ providerName: "p-session-1" });
		const session2 = harness.createSession({ providerName: "p-session-2" });

		await session1.send("Message to 1");
		await session2.send("Message to 2");

		expect(session1.getHistory().length).toBeGreaterThan(0);
		expect(session2.getHistory().length).toBeGreaterThan(0);
		expect(session1.getState().providerName).toBe("p-session-1");
		expect(session2.getState().providerName).toBe("p-session-2");
		expect(session1.getState().id).not.toBe(session2.getState().id);
	});

	// ==========================================
	// TIER 4: REAL-WORLD SCENARIOS
	// ==========================================

	it("H-13: should support headless multi-tenant agent worker scenario", async () => {
		const harness = new Harness({
			loadDiskConfig: false,
			projectRoot: tempDir,
			approvalMode: "yolo",
		});

		const sharedProvider = new MockSDKProvider("tenant-shared-provider");
		harness.registerProvider(sharedProvider);

		// Tenant A worker
		sharedProvider.queueTextResponse("Tenant A initial response");
		const tenantASession = harness.createSession({
			providerName: "tenant-shared-provider",
			systemPrompt: "You are Tenant A agent",
		});

		// Tenant B worker
		sharedProvider.queueTextResponse("Tenant B initial response");
		const tenantBSession = harness.createSession({
			providerName: "tenant-shared-provider",
			systemPrompt: "You are Tenant B agent",
		});

		const resA = await tenantASession.send("Tenant A job");
		const resB = await tenantBSession.send("Tenant B job");

		expect(resA.response).toBe("Tenant A initial response");
		expect(resB.response).toBe("Tenant B initial response");

		expect(tenantASession.getState().turnCount).toBe(1);
		expect(tenantBSession.getState().turnCount).toBe(1);
	});
});
