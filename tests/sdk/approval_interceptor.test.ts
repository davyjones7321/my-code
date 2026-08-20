import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { Harness } from "../../src/sdk/harness.ts";
import type { ApprovalRequest } from "../../src/sdk/types.ts";
import { Deferred, MockSDKProvider, createMockTool } from "./test-helpers.ts";

describe("SDK Tier 1-4: Programmatic Approval Interceptor Suite", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-approval-test-"));
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

	it("A-01: should allow tool execution when onApprovalRequest resolves to true / approved", async () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const provider = new MockSDKProvider("approval-allow-provider");

		provider.queueToolCallResponse("sensitive_tool", { action: "restart_server" }, "call_s1");
		provider.queueTextResponse("Server restart was approved and executed.");

		let toolExecuted = false;
		const sensitiveTool = createMockTool("sensitive_tool", async () => {
			toolExecuted = true;
			return { result: "Server restarted successfully", isError: false };
		});

		harness.registerProvider(provider);
		harness.registerTool(sensitiveTool);

		const session = harness.createSession({
			providerName: "approval-allow-provider",
			approvalMode: "manual",
		});

		let interceptorCalled = false;
		session.onApprovalRequest(async (req) => {
			interceptorCalled = true;
			expect(req.toolName).toBe("sensitive_tool");
			expect((req.toolInput as any).action).toBe("restart_server");
			return true; // approve
		});

		const result = await session.send("Please restart the server");
		expect(interceptorCalled).toBe(true);
		expect(toolExecuted).toBe(true);
		expect(result.response).toContain("Server restart was approved");
	});

	it("A-02: should block tool execution and propagate reason when onApprovalRequest returns denied", async () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const provider = new MockSDKProvider("approval-deny-provider");

		provider.queueToolCallResponse("delete_database", { target: "production" }, "call_del_1");
		provider.queueResponse((messages) => {
			const toolResultMsg = messages.find((m) =>
				m.content.some((c) => c.type === "tool_result" && (c as any).isError),
			);
			return {
				content: [
					{
						type: "text",
						text: toolResultMsg
							? "Operation was aborted: production delete denied by security policy."
							: "Unexpected execution.",
					},
				],
				usage: { inputTokens: 20, outputTokens: 10 },
			};
		});

		let toolExecuted = false;
		const deleteTool = createMockTool("delete_database", async () => {
			toolExecuted = true;
			return { result: "Deleted database", isError: false };
		});

		harness.registerProvider(provider);
		harness.registerTool(deleteTool);

		const session = harness.createSession({
			providerName: "approval-deny-provider",
			approvalMode: "manual",
		});

		session.onApprovalRequest(async (req) => {
			if ((req.toolInput as any).target === "production") {
				return { approved: false, reason: "Production drop disallowed" };
			}
			return true;
		});

		const result = await session.send("Delete production database");
		expect(toolExecuted).toBe(false);
		expect(result.response).toContain("Operation was aborted");
	});

	it("A-03: should handle multiple sequential tool approvals accurately in a turn", async () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const provider = new MockSDKProvider("multi-approval-provider");

		provider.queueToolCallResponse("step_one", { step: 1 }, "call_st1");
		provider.queueToolCallResponse("step_two", { step: 2 }, "call_st2");
		provider.queueTextResponse("Both steps approved and completed.");

		const tool1 = createMockTool("step_one", async () => ({ result: "Step 1 done", isError: false }));
		const tool2 = createMockTool("step_two", async () => ({ result: "Step 2 done", isError: false }));

		harness.registerProvider(provider);
		harness.registerTool(tool1);
		harness.registerTool(tool2);

		const session = harness.createSession({
			providerName: "multi-approval-provider",
			approvalMode: "manual",
		});

		const approvedTools: string[] = [];
		session.onApprovalRequest(async (req) => {
			approvedTools.push(req.toolName);
			return true;
		});

		const result = await session.send("Run step 1 and step 2");
		expect(approvedTools).toEqual(["step_one", "step_two"]);
		expect(result.response).toBe("Both steps approved and completed.");
	});

	it("A-04: should safely deny tool calls in manual mode if no approval interceptor is registered", async () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const provider = new MockSDKProvider("no-interceptor-provider");

		provider.queueToolCallResponse("any_tool", {}, "call_any");
		provider.queueTextResponse("Handled denied tool call.");

		let toolExecuted = false;
		const anyTool = createMockTool("any_tool", async () => {
			toolExecuted = true;
			return { result: "ok", isError: false };
		});

		harness.registerProvider(provider);
		harness.registerTool(anyTool);

		const session = harness.createSession({
			providerName: "no-interceptor-provider",
			approvalMode: "manual",
		});

		// No onApprovalRequest registered!
		const result = await session.send("Execute tool in manual mode");
		expect(toolExecuted).toBe(false);
		const toolResultEv = result.events.find((e) => e.type === "tool_result") as any;
		expect(toolResultEv).toBeDefined();
		expect(toolResultEv.isError).toBe(true);
	});

	// ==========================================
	// TIER 2: BOUNDARY & ERROR CONDITIONS
	// ==========================================

	it("A-05: should handle error thrown inside onApprovalRequest gracefully as denial", async () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const provider = new MockSDKProvider("throwing-interceptor-provider");

		provider.queueToolCallResponse("guarded_tool", {}, "call_g1");
		provider.queueTextResponse("Tool was denied due to interceptor exception.");

		let toolExecuted = false;
		const guardedTool = createMockTool("guarded_tool", async () => {
			toolExecuted = true;
			return { result: "ok", isError: false };
		});

		harness.registerProvider(provider);
		harness.registerTool(guardedTool);

		const session = harness.createSession({
			providerName: "throwing-interceptor-provider",
			approvalMode: "manual",
		});

		session.onApprovalRequest(async () => {
			throw new Error("Approval database connection timeout");
		});

		const result = await session.send("Run guarded tool");
		expect(toolExecuted).toBe(false);
		const toolResultEv = result.events.find((e) => e.type === "tool_result") as any;
		expect(toolResultEv).toBeDefined();
		expect(toolResultEv.isError).toBe(true);
	});

	it("A-06: should support asynchronous delayed approval via Promise/Deferred", async () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const provider = new MockSDKProvider("async-delay-approval-provider");

		provider.queueToolCallResponse("async_tool", {}, "call_as1");
		provider.queueTextResponse("Async tool approved after verification.");

		let toolExecuted = false;
		const asyncTool = createMockTool("async_tool", async () => {
			toolExecuted = true;
			return { result: "ok", isError: false };
		});

		harness.registerProvider(provider);
		harness.registerTool(asyncTool);

		const session = harness.createSession({
			providerName: "async-delay-approval-provider",
			approvalMode: "manual",
		});

		const deferredApproval = new Deferred<boolean>();

		session.onApprovalRequest(async () => {
			return await deferredApproval.promise;
		});

		const sendPromise = session.send("Execute async tool");

		// Simulate external async resolution (e.g. user approval click after 50ms)
		setTimeout(() => {
			deferredApproval.resolve(true);
		}, 50);

		const result = await sendPromise;
		expect(toolExecuted).toBe(true);
		expect(result.response).toContain("Async tool approved");
	});

	// ==========================================
	// TIER 3: CROSS-FEATURE COMBINATIONS
	// ==========================================

	it("A-07: selective approval policy allowing read operations and rejecting write operations", async () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const provider = new MockSDKProvider("selective-policy-provider");

		// Tool 1: read_stats (should be approved)
		provider.queueToolCallResponse("read_stats", { metric: "cpu" }, "call_r1");
		// Tool 2: reset_stats (should be denied)
		provider.queueToolCallResponse("reset_stats", {}, "call_w1");
		provider.queueTextResponse("Read stats: 45%. Reset was blocked by policy.");

		let readExecuted = false;
		let resetExecuted = false;

		const readTool = createMockTool("read_stats", async () => {
			readExecuted = true;
			return { result: "CPU 45%", isError: false };
		});
		const resetTool = createMockTool("reset_stats", async () => {
			resetExecuted = true;
			return { result: "Reset", isError: false };
		});

		harness.registerProvider(provider);
		harness.registerTool(readTool);
		harness.registerTool(resetTool);

		const session = harness.createSession({
			providerName: "selective-policy-provider",
			approvalMode: "manual",
		});

		session.onApprovalRequest(async (req) => {
			if (req.toolName.startsWith("read_")) {
				return true;
			}
			return { approved: false, reason: "Write/reset operations restricted" };
		});

		const result = await session.send("Read cpu then reset");
		expect(readExecuted).toBe(true);
		expect(resetExecuted).toBe(false);
		expect(result.response).toContain("Read stats: 45%");
	});

	// ==========================================
	// TIER 4: REAL-WORLD SCENARIOS
	// ==========================================

	it("A-08: Human-In-The-Loop (HITL) Webhook Approval Simulation", async () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const provider = new MockSDKProvider("hitl-provider");

		provider.queueToolCallResponse("deploy_prod", { version: "v2.0.0" }, "call_prod");
		provider.queueTextResponse("Production deploy of v2.0.0 completed.");

		let deployRan = false;
		const deployTool = createMockTool("deploy_prod", async (input) => {
			deployRan = true;
			return { result: `Deployed ${input.version} to prod`, isError: false };
		});

		harness.registerProvider(provider);
		harness.registerTool(deployTool);

		const session = harness.createSession({
			providerName: "hitl-provider",
			approvalMode: "manual",
		});

		// Mock external webhook approval service
		const mockRemoteAuditLog: ApprovalRequest[] = [];
		session.onApprovalRequest(async (req) => {
			mockRemoteAuditLog.push(req);
			// Simulate async approval webhook processing
			await new Promise((r) => setTimeout(r, 20));
			return { approved: true };
		});

		const result = await session.send("Deploy v2.0.0 to prod");
		expect(deployRan).toBe(true);
		expect(mockRemoteAuditLog.length).toBe(1);
		expect(mockRemoteAuditLog[0].toolName).toBe("deploy_prod");
		expect(result.response).toContain("Production deploy of v2.0.0 completed");
	});
});
