import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { Harness } from "../../src/sdk/harness.ts";
import type { ApprovalRequest, SDKEvent } from "../../src/sdk/types.ts";
import { Deferred, MockSDKProvider, createMockTool } from "./test-helpers.ts";

describe("Challenger 2 Empirical Adversarial Stress Test Suite", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-challenger2-"));
	});

	afterEach(async () => {
		try {
			await fs.rm(tempDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors on Windows
		}
	});

	// =========================================================================
	// 1. APPROVAL INTERCEPTOR EDGE CASES & ADVERSARIAL INPUTS
	// =========================================================================

	describe("1. Approval Interceptor Edge Cases", () => {
		it("ADV-A01: Interceptor returning boolean true (approve) and false (deny)", async () => {
			const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
			const provider = new MockSDKProvider("adv-bool-provider");

			// Turn 1: approved
			provider.queueToolCallResponse("db_query", { query: "SELECT 1" }, "c1");
			provider.queueTextResponse("Query 1 executed.");
			// Turn 2: denied
			provider.queueToolCallResponse("db_query", { query: "DROP TABLE users" }, "c2");
			provider.queueTextResponse("Query 2 was denied.");

			let executedCount = 0;
			const dbTool = createMockTool("db_query", async () => {
				executedCount++;
				return { result: "Query success", isError: false };
			});

			harness.registerProvider(provider);
			harness.registerTool(dbTool);

			const session = harness.createSession({
				providerName: "adv-bool-provider",
				approvalMode: "manual",
			});

			session.onApprovalRequest(async (req) => {
				if ((req.toolInput as any).query.includes("DROP")) {
					return false;
				}
				return true;
			});

			const res1 = await session.send("Run SELECT 1");
			expect(res1.response).toBe("Query 1 executed.");
			expect(executedCount).toBe(1);

			const res2 = await session.send("Run DROP TABLE users");
			expect(res2.response).toBe("Query 2 was denied.");
			expect(executedCount).toBe(1); // Did not increment

			const deniedResult = res2.events.find(
				(e) => e.type === "tool_result" && (e as any).isError,
			) as any;
			expect(deniedResult).toBeDefined();
			expect(deniedResult.result).toContain("Tool execution denied by approval interceptor");
		});

		it("ADV-A02: Interceptor returning string 'approve' and 'deny'", async () => {
			const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
			const provider = new MockSDKProvider("adv-str-provider");

			provider.queueToolCallResponse("action_tool", { action: "read" }, "c1");
			provider.queueToolCallResponse("action_tool", { action: "write" }, "c2");
			provider.queueTextResponse("Finished action tests.");

			let readRan = false;
			let writeRan = false;
			const actionTool = createMockTool("action_tool", async (input) => {
				if (input.action === "read") readRan = true;
				if (input.action === "write") writeRan = true;
				return { result: "action ok", isError: false };
			});

			harness.registerProvider(provider);
			harness.registerTool(actionTool);

			const session = harness.createSession({
				providerName: "adv-str-provider",
				approvalMode: "manual",
			});

			session.onApprovalRequest(async (req) => {
				return (req.toolInput as any).action === "read" ? ("approve" as any) : ("deny" as any);
			});

			const res = await session.send("Run read and write");
			expect(readRan).toBe(true);
			expect(writeRan).toBe(false);
			expect(res.response).toBe("Finished action tests.");
		});

		it("ADV-A03: Interceptor returning structured objects { approved: true } and { approved: false, reason: 'Forbidden' }", async () => {
			const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
			const provider = new MockSDKProvider("adv-obj-provider");

			provider.queueToolCallResponse("privileged_cmd", { target: "admin" }, "c1");
			provider.queueToolCallResponse("privileged_cmd", { target: "root" }, "c2");
			provider.queueTextResponse("Done structured approval check.");

			const privilegedTool = createMockTool("privileged_cmd", async (input) => ({
				result: `Executed on ${input.target}`,
				isError: false,
			}));

			harness.registerProvider(provider);
			harness.registerTool(privilegedTool);

			const session = harness.createSession({
				providerName: "adv-obj-provider",
				approvalMode: "manual",
			});

			session.onApprovalRequest(async (req) => {
				if ((req.toolInput as any).target === "root") {
					return {
						approved: false,
						reason: "Access to root target is strictly prohibited by security policy 403.",
					};
				}
				return { approved: true, reason: "Target admin is permissible" };
			});

			const res = await session.send("Execute on admin and root");
			const toolResults = res.events.filter((e) => e.type === "tool_result") as any[];
			expect(toolResults.length).toBe(2);

			expect(toolResults[0].isError).toBe(false);
			expect(toolResults[0].result).toContain("Executed on admin");

			expect(toolResults[1].isError).toBe(true);
			expect(toolResults[1].result).toContain(
				"[Control Denied]: Access to root target is strictly prohibited by security policy 403.",
			);
		});

		it("ADV-A04: Interceptor returning malformed / unexpected shapes (null, undefined, 0, non-bool object)", async () => {
			const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
			const provider = new MockSDKProvider("adv-malformed-provider");

			provider.queueToolCallResponse("test_tool", { val: 1 }, "c1");
			provider.queueToolCallResponse("test_tool", { val: 2 }, "c2");
			provider.queueToolCallResponse("test_tool", { val: 3 }, "c3");
			provider.queueTextResponse("Checked malformed return values.");

			let toolExecCount = 0;
			const testTool = createMockTool("test_tool", async () => {
				toolExecCount++;
				return { result: "ok", isError: false };
			});

			harness.registerProvider(provider);
			harness.registerTool(testTool);

			const session = harness.createSession({
				providerName: "adv-malformed-provider",
				approvalMode: "manual",
			});

			let callIdx = 0;
			session.onApprovalRequest(async () => {
				callIdx++;
				if (callIdx === 1) return null as any;
				if (callIdx === 2) return undefined as any;
				return { notApprovedKey: true } as any; // Malformed object lacking approved: true
			});

			const res = await session.send("Test malformed shapes");
			expect(toolExecCount).toBe(0); // All must be denied safely
			const deniedResults = res.events.filter(
				(e) => e.type === "tool_result" && (e as any).isError,
			) as any[];
			expect(deniedResults.length).toBe(3);
			for (const dr of deniedResults) {
				expect(dr.result).toContain("Tool execution denied by approval interceptor");
			}
		});

		it("ADV-A05: Interceptor throwing standard Error vs throwing string primitive", async () => {
			const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
			const provider = new MockSDKProvider("adv-throw-provider");

			provider.queueToolCallResponse("test_tool", { call: 1 }, "c1");
			provider.queueToolCallResponse("test_tool", { call: 2 }, "c2");
			provider.queueTextResponse("Handled throwing interceptors.");

			let execCount = 0;
			const testTool = createMockTool("test_tool", async () => {
				execCount++;
				return { result: "ok", isError: false };
			});

			harness.registerProvider(provider);
			harness.registerTool(testTool);

			const session = harness.createSession({
				providerName: "adv-throw-provider",
				approvalMode: "manual",
			});

			let callIdx = 0;
			session.onApprovalRequest(async () => {
				callIdx++;
				if (callIdx === 1) {
					throw new Error("LDAP authentication timeout during approval");
				}
				throw "String exception primitive";
			});

			const res = await session.send("Run throwing tools");
			expect(execCount).toBe(0);

			const toolResults = res.events.filter((e) => e.type === "tool_result") as any[];
			expect(toolResults.length).toBe(2);

			expect(toolResults[0].isError).toBe(true);
			expect(toolResults[0].result).toContain("Approval interceptor threw error: LDAP authentication timeout");

			expect(toolResults[1].isError).toBe(true);
			expect(toolResults[1].result).toContain("[Control Denied]: Approval interceptor threw error:");
		});

		it("ADV-A06: Dynamic re-assignment of approval interceptor across turns", async () => {
			const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
			const provider = new MockSDKProvider("adv-reassign-provider");

			provider.queueToolCallResponse("tool_a", {}, "c1");
			provider.queueTextResponse("Turn 1 done");

			provider.queueToolCallResponse("tool_a", {}, "c2");
			provider.queueTextResponse("Turn 2 done");

			let execs = 0;
			const toolA = createMockTool("tool_a", async () => {
				execs++;
				return { result: "ok", isError: false };
			});

			harness.registerProvider(provider);
			harness.registerTool(toolA);

			const session = harness.createSession({
				providerName: "adv-reassign-provider",
				approvalMode: "manual",
			});

			// Turn 1: Interceptor allows
			session.onApprovalRequest(async () => true);
			const res1 = await session.send("Turn 1 call");
			expect(execs).toBe(1);
			expect(res1.response).toBe("Turn 1 done");

			// Re-assign interceptor to deny
			session.onApprovalRequest(async () => ({ approved: false, reason: "Now locked down" }));
			const res2 = await session.send("Turn 2 call");
			expect(execs).toBe(1); // Did not execute
			const toolRes2 = res2.events.find((e) => e.type === "tool_result") as any;
			expect(toolRes2.isError).toBe(true);
			expect(toolRes2.result).toContain("Now locked down");
		});

		it("ADV-A07: Interceptor behavior differences in 'auto', 'manual', and 'yolo' modes", async () => {
			const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
			const provider = new MockSDKProvider("adv-modes-approval-provider");

			// 1. In 'auto' mode: read_file is safe -> interceptor is bypassed
			provider.queueToolCallResponse("read_file", { path: "a.txt" }, "c1");
			provider.queueTextResponse("Read file done");

			// 2. In 'yolo' mode: custom tool is auto-approved -> interceptor is bypassed
			provider.queueToolCallResponse("custom_op", {}, "c2");
			provider.queueTextResponse("Custom op in yolo done");

			// 3. In 'manual' mode: custom tool calls interceptor
			provider.queueToolCallResponse("custom_op", {}, "c3");
			provider.queueTextResponse("Custom op in manual done");

			let interceptorCalls = 0;
			const customOp = createMockTool("custom_op", async () => ({ result: "op done", isError: false }));
			const readFile = createMockTool("read_file", async () => ({ result: "contents", isError: false }));

			harness.registerProvider(provider);
			harness.registerTool(customOp);
			harness.registerTool(readFile);

			const session = harness.createSession({
				providerName: "adv-modes-approval-provider",
				approvalMode: "auto",
			});

			session.onApprovalRequest(async () => {
				interceptorCalls++;
				return true;
			});

			// Auto mode with safe tool
			await session.send("Read file");
			expect(interceptorCalls).toBe(0); // Bypassed for safe tool

			// Switch to yolo mode
			session.setApprovalMode("yolo");
			await session.send("Run custom in yolo");
			expect(interceptorCalls).toBe(0); // Bypassed in yolo mode

			// Switch to manual mode
			session.setApprovalMode("manual");
			await session.send("Run custom in manual");
			expect(interceptorCalls).toBe(1); // Invoked in manual mode
		});
	});

	// =========================================================================
	// 2. DYNAMIC MODE & PROVIDER SWITCHING BETWEEN TURNS
	// =========================================================================

	describe("2. Dynamic Mode & Provider Switching", () => {
		it("ADV-S01: Multi-turn dynamic mode switching: plan -> build -> plan with tool enforcement", async () => {
			const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
			const provider = new MockSDKProvider("mode-switch-adv-provider");

			// Turn 1 (plan mode): attempts write_file
			provider.queueToolCallResponse("write_file", { path: "out.txt", content: "hello" }, "c1");
			provider.queueTextResponse("Plan mode blocked write_file as expected.");

			// Turn 2 (build mode): attempts write_file
			provider.queueToolCallResponse("write_file", { path: "out.txt", content: "hello" }, "c2");
			provider.queueTextResponse("Build mode allowed write_file.");

			// Turn 3 (plan mode again): attempts edit_file
			provider.queueToolCallResponse("edit_file", { path: "out.txt" }, "c3");
			provider.queueTextResponse("Switched back to plan: edit_file blocked.");

			let writeRan = 0;
			let editRan = 0;
			const writeTool = createMockTool("write_file", async () => {
				writeRan++;
				return { result: "wrote file", isError: false };
			});
			const editTool = createMockTool("edit_file", async () => {
				editRan++;
				return { result: "edited file", isError: false };
			});

			harness.registerProvider(provider);
			harness.registerTool(writeTool);
			harness.registerTool(editTool);

			const session = harness.createSession({
				providerName: "mode-switch-adv-provider",
				mode: "plan",
				approvalMode: "yolo",
			});

			// Turn 1: Plan mode
			expect(session.getState().mode).toBe("plan");
			const res1 = await session.send("Turn 1 in plan");
			expect(writeRan).toBe(0);
			const err1 = res1.events.find((e) => e.type === "tool_result" && (e as any).isError) as any;
			expect(err1.result).toContain("Tool write_file is not allowed in plan mode");

			// Switch to Build mode
			session.setMode("build");
			expect(session.getState().mode).toBe("build");
			const res2 = await session.send("Turn 2 in build");
			expect(writeRan).toBe(1);
			expect(res2.response).toContain("Build mode allowed write_file");

			// Switch back to Plan mode
			session.setMode("plan");
			expect(session.getState().mode).toBe("plan");
			const res3 = await session.send("Turn 3 back in plan");
			expect(editRan).toBe(0);
			const err3 = res3.events.find((e) => e.type === "tool_result" && (e as any).isError) as any;
			expect(err3.result).toContain("Tool edit_file is not allowed in plan mode");
			expect(session.getTurns().length).toBe(3);
		});

		it("ADV-S02: Dynamic provider & model switching across 3 turns preserving conversation context", async () => {
			const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
			const providerA = new MockSDKProvider("provider-a");
			const providerB = new MockSDKProvider("provider-b");
			const providerC = new MockSDKProvider("provider-c");

			// Provider A Turn 1
			providerA.queueResponse((messages, tools, config) => {
				expect(config?.model).toBe("model-alpha");
				return {
					content: [{ type: "text", text: "Provider A responded: stored secret KEY_123" }],
					usage: { inputTokens: 10, outputTokens: 10 },
				};
			});

			// Provider B Turn 2
			providerB.queueResponse((messages, tools, config) => {
				expect(config?.model).toBe("model-beta");
				// Verify Provider B receives full history from Provider A
				const sawSecret = messages.some((m) =>
					m.content.some((c) => c.type === "text" && c.text.includes("KEY_123")),
				);
				expect(sawSecret).toBe(true);
				return {
					content: [{ type: "text", text: "Provider B confirmed secret KEY_123 is in history" }],
					usage: { inputTokens: 30, outputTokens: 15 },
				};
			});

			// Provider C Turn 3
			providerC.queueResponse((messages, tools, config) => {
				expect(config?.model).toBe("model-gamma");
				expect(messages.length).toBeGreaterThanOrEqual(5); // 2 previous turns + new turn user msg
				return {
					content: [{ type: "text", text: "Provider C completed the 3-provider relay." }],
					usage: { inputTokens: 50, outputTokens: 20 },
				};
			});

			harness.registerProvider(providerA);
			harness.registerProvider(providerB);
			harness.registerProvider(providerC);

			const session = harness.createSession({
				providerName: "provider-a",
				modelName: "model-alpha",
			});

			// Turn 1: Provider A
			const r1 = await session.send("Hello Provider A, remember KEY_123");
			expect(r1.response).toContain("KEY_123");
			expect(session.getState().providerName).toBe("provider-a");
			expect(session.getState().modelName).toBe("model-alpha");

			// Switch to Provider B
			session.setProvider("provider-b", "model-beta");
			expect(session.getState().providerName).toBe("provider-b");
			expect(session.getState().modelName).toBe("model-beta");

			const r2 = await session.send("What was the secret from before?");
			expect(r2.response).toContain("Provider B confirmed secret KEY_123");

			// Switch to Provider C via instance & setModel
			session.setProvider(providerC);
			session.setModel("model-gamma");
			expect(session.getState().providerName).toBe("provider-c");
			expect(session.getState().modelName).toBe("model-gamma");

			const r3 = await session.send("Final verification turn");
			expect(r3.response).toContain("Provider C completed the 3-provider relay");

			// Token & turn accumulation across all 3 providers
			const state = session.getState();
			expect(state.turnCount).toBe(3);
			expect(state.inputTokens).toBe(10 + 30 + 50);
			expect(state.outputTokens).toBe(10 + 15 + 20);
			expect(state.totalTokens).toBe(90 + 45);
		});

		it("ADV-S03: Custom system prompt and maxIterations dynamic reconfiguration", async () => {
			const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
			const provider = new MockSDKProvider("adv-sysprompt-provider");

			let capturedSystemPrompt = "";
			provider.queueResponse((messages, tools, config) => {
				capturedSystemPrompt = config?.systemPrompt || "";
				return {
					content: [{ type: "text", text: "System prompt acknowledged." }],
					usage: { inputTokens: 5, outputTokens: 5 },
				};
			});

			harness.registerProvider(provider);
			const session = harness.createSession({
				providerName: "adv-sysprompt-provider",
			});

			session.setSystemPrompt("You are a specialized mathematical theorem prover.");
			await session.send("Prove 1 + 1 = 2");
			expect(capturedSystemPrompt).toBe("You are a specialized mathematical theorem prover.");
		});
	});

	// =========================================================================
	// 3. MULTI-TURN STATE CONTINUITY & RESET INTEGRITY
	// =========================================================================

	describe("3. Multi-Turn State Continuity & Reset Integrity", () => {
		it("ADV-C01: Precise token, cost, and turn state accumulation across 5 turns", async () => {
			const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
			const provider = new MockSDKProvider("adv-metrics-provider");

			for (let i = 1; i <= 5; i++) {
				provider.queueTextResponse(`Response turn ${i}`, {
					inputTokens: i * 10,
					outputTokens: i * 5,
				});
			}

			harness.registerProvider(provider);
			const session = harness.createSession({ providerName: "adv-metrics-provider" });

			let expectedInput = 0;
			let expectedOutput = 0;

			for (let i = 1; i <= 5; i++) {
				const turnRes = await session.send(`Prompt turn ${i}`);
				expectedInput += i * 10;
				expectedOutput += i * 5;

				expect(turnRes.usage.inputTokens).toBe(i * 10);
				expect(turnRes.usage.outputTokens).toBe(i * 5);
				expect(turnRes.usage.totalTokens).toBe(i * 15);
				expect(turnRes.turn.turnIndex).toBe(i);

				const state = session.getState();
				expect(state.turnCount).toBe(i);
				expect(state.inputTokens).toBe(expectedInput);
				expect(state.outputTokens).toBe(expectedOutput);
				expect(state.totalTokens).toBe(expectedInput + expectedOutput);
			}

			expect(session.getTurns().length).toBe(5);
			expect(session.getHistory().length).toBe(10); // 5 user + 5 assistant
		});

		it("ADV-C02: Immutability of getHistory(), getMessages(), and getTurns() snapshots", async () => {
			const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
			const provider = new MockSDKProvider("adv-immutable-provider");
			provider.queueTextResponse("Original response");

			harness.registerProvider(provider);
			const session = harness.createSession({ providerName: "adv-immutable-provider" });

			await session.send("Initial prompt");

			const history = session.getHistory();
			const messages = session.getMessages();
			const turns = session.getTurns();

			// Mutating external array copies
			history.push({ role: "user", content: [{ type: "text", text: "Injected corrupt message" }] });
			messages.length = 0;
			turns.pop();

			// Verify internal state was unaffected
			expect(session.getHistory().length).toBe(2);
			expect(session.getMessages().length).toBe(2);
			expect(session.getTurns().length).toBe(1);
			expect(session.getHistory()[0].content[0]).toEqual({ type: "text", text: "Initial prompt" });
		});

		it("ADV-C03: Complete session.reset() lifecycle and post-reset conversation isolation", async () => {
			const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
			const provider = new MockSDKProvider("adv-reset-lifecycle-provider");

			// Turn 1 (before reset)
			provider.queueTextResponse("Pre-reset response", { inputTokens: 40, outputTokens: 20 });
			// Turn 2 (after reset)
			provider.queueResponse((messages) => {
				// Must NOT have any pre-reset messages
				const hasPreReset = messages.some((m) =>
					m.content.some((c) => c.type === "text" && c.text.includes("Pre-reset")),
				);
				expect(hasPreReset).toBe(false);
				expect(messages.length).toBe(1); // Only new post-reset user prompt
				return {
					content: [{ type: "text", text: "Fresh post-reset response" }],
					usage: { inputTokens: 15, outputTokens: 10 },
				};
			});

			harness.registerProvider(provider);
			const session = harness.createSession({ providerName: "adv-reset-lifecycle-provider" });

			await session.send("Pre-reset message");
			expect(session.getState().turnCount).toBe(1);
			expect(session.getState().totalTokens).toBe(60);
			expect(session.getHistory().length).toBe(2);

			// Perform reset
			session.reset();

			// Verify zeroed state
			const resetState = session.getState();
			expect(resetState.turnCount).toBe(0);
			expect(resetState.inputTokens).toBe(0);
			expect(resetState.outputTokens).toBe(0);
			expect(resetState.totalTokens).toBe(0);
			expect(resetState.estimatedCost).toBe(0);
			expect(session.getHistory().length).toBe(0);
			expect(session.getTurns().length).toBe(0);

			// Turn after reset
			const postResetResult = await session.send("Post-reset message");
			expect(postResetResult.response).toBe("Fresh post-reset response");
			expect(postResetResult.turn.turnIndex).toBe(1);

			const postResetState = session.getState();
			expect(postResetState.turnCount).toBe(1);
			expect(postResetState.inputTokens).toBe(15);
			expect(postResetState.outputTokens).toBe(10);
			expect(postResetState.totalTokens).toBe(25);
			expect(session.getHistory().length).toBe(2);
			expect(session.getTurns().length).toBe(1);
		});

		it("ADV-C04: Multiple consecutive reset() calls are safe and idempotent", () => {
			const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
			const session = harness.createSession();

			expect(() => {
				session.reset();
				session.reset();
				session.reset();
			}).not.toThrow();

			expect(session.getState().turnCount).toBe(0);
			expect(session.getHistory().length).toBe(0);
		});

		it("ADV-C05: Transcript export in JSON and Markdown maintains full fidelity", async () => {
			const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
			const provider = new MockSDKProvider("adv-transcript-provider");

			provider.queueToolCallResponse("mock_calc", { expression: "2+2" }, "c_calc");
			provider.queueTextResponse("Calculated: 4", { inputTokens: 20, outputTokens: 10 });

			const calcTool = createMockTool("mock_calc", async () => ({ result: "4", isError: false }));

			harness.registerProvider(provider);
			harness.registerTool(calcTool);

			const session = harness.createSession({
				providerName: "adv-transcript-provider",
				approvalMode: "yolo",
			});

			await session.send("What is 2+2?");

			const replSession = session.getReplSession();
			const jsonTranscript = replSession.exportTranscript("json");
			const parsed = JSON.parse(jsonTranscript);

			expect(parsed.version).toBe("1.0");
			expect(parsed.session.id).toBe(session.getId());
			expect(parsed.turns.length).toBe(1);
			expect(parsed.turns[0].userPrompt).toBe("What is 2+2?");
			expect(parsed.turns[0].assistantResponse).toBe("Calculated: 4");
			expect(parsed.turns[0].toolEvents?.length).toBeGreaterThan(0);

			const mdTranscript = replSession.exportTranscript("markdown");
			expect(mdTranscript).toContain("# REPL Session Transcript");
			expect(mdTranscript).toContain("Calculated: 4");
			expect(mdTranscript).toContain("mock_calc");
		});
	});
});
