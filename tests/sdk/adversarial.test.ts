import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { Harness } from "../../src/sdk/harness.ts";
import type { SDKEvent, Tool } from "../../src/sdk/types.ts";
import { Deferred, MockSDKProvider, createMockTool } from "./test-helpers.ts";

describe("SDK Adversarial & Empirical Stress Test Suite", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-adversarial-test-"));
	});

	afterEach(async () => {
		try {
			await fs.rm(tempDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors on Windows
		}
	});

	// =========================================================================
	// 1. CONCURRENCY STRESS SUITE (ADV-CONC)
	// =========================================================================
	describe("1. Concurrency Stress", () => {
		it("ADV-CONC-01: 20 isolated sessions running concurrent multi-turn turns simultaneously from 1 Harness", async () => {
			const harness = new Harness({
				loadDiskConfig: false,
				projectRoot: tempDir,
				approvalMode: "yolo",
			});

			const sessionCount = 20;
			const sessions = [];
			const providers: MockSDKProvider[] = [];

			for (let i = 0; i < sessionCount; i++) {
				const provider = new MockSDKProvider(`provider_concurrent_${i}`);
				// Turn 1
				provider.queueTextResponse(`Response from worker ${i} - Turn 1`, {
					inputTokens: 10 + i,
					outputTokens: 5 + i,
				});
				// Turn 2
				provider.queueTextResponse(`Response from worker ${i} - Turn 2`, {
					inputTokens: 20 + i,
					outputTokens: 10 + i,
				});
				harness.registerProvider(provider);
				providers.push(provider);

				const session = harness.createSession({
					id: `session_${i}`,
					providerName: `provider_concurrent_${i}`,
					systemPrompt: `System prompt for worker ${i}`,
				});
				sessions.push(session);
			}

			// Run Turn 1 concurrently across all 20 sessions
			const turn1Results = await Promise.all(
				sessions.map((s, idx) => s.send(`Prompt to worker ${idx} turn 1`)),
			);

			// Verify Turn 1 results are completely isolated
			for (let i = 0; i < sessionCount; i++) {
				expect(turn1Results[i].response).toBe(`Response from worker ${i} - Turn 1`);
				expect(sessions[i].getState().turnCount).toBe(1);
				expect(sessions[i].getState().inputTokens).toBe(10 + i);
				expect(sessions[i].getHistory().length).toBe(2);
			}

			// Run Turn 2 concurrently across all 20 sessions
			const turn2Results = await Promise.all(
				sessions.map((s, idx) => s.send(`Prompt to worker ${idx} turn 2`)),
			);

			// Verify Turn 2 results
			for (let i = 0; i < sessionCount; i++) {
				expect(turn2Results[i].response).toBe(`Response from worker ${i} - Turn 2`);
				expect(sessions[i].getState().turnCount).toBe(2);
				expect(sessions[i].getState().inputTokens).toBe(30 + 2 * i);
				expect(sessions[i].getHistory().length).toBe(4);
				expect(sessions[i].getId()).toBe(`session_${i}`);
			}
		});

		it("ADV-CONC-02: dynamic reconfiguration of session A while session B is actively streaming", async () => {
			const harness = new Harness({
				loadDiskConfig: false,
				projectRoot: tempDir,
				approvalMode: "yolo",
			});

			const providerA = new MockSDKProvider("provider_reconfig_a");
			const providerB = new MockSDKProvider("provider_reconfig_b");

			const slowDeferred = new Deferred<any>();
			providerB.queueResponse(async () => {
				return await slowDeferred.promise;
			});

			harness.registerProvider(providerA);
			harness.registerProvider(providerB);

			const sessionA = harness.createSession({ providerName: "provider_reconfig_a" });
			const sessionB = harness.createSession({ providerName: "provider_reconfig_b" });

			// Start active execution on Session B
			const sessionBPromise = sessionB.send("Long turn on B");

			// While B is running, heavily reconfigure Session A
			sessionA.setMode("plan");
			sessionA.setApprovalMode("manual");
			sessionA.setModel("custom-model-alpha");
			sessionA.setSystemPrompt("New system prompt for A");

			const customToolA = createMockTool("tool_only_for_a", async () => ({
				result: "A tool executed",
				isError: false,
			}));
			sessionA.registerTool(customToolA);

			// Verify A's reconfiguration did NOT mutate B's state or Harness registry
			expect(sessionB.getState().mode).toBe("build");
			expect(sessionB.getState().approvalMode).toBe("yolo");
			expect(sessionB.getTool("tool_only_for_a")).toBeUndefined();
			expect(harness.getTool("tool_only_for_a")).toBeUndefined();

			// Resolve B
			slowDeferred.resolve({
				content: [{ type: "text", text: "Finished session B" }],
				usage: { inputTokens: 5, outputTokens: 5 },
			});

			const resultB = await sessionBPromise;
			expect(resultB.response).toBe("Finished session B");
			expect(sessionB.getState().mode).toBe("build");
		});

		it("ADV-CONC-03: mutual exclusion: 5 concurrent send() calls on SAME session allows 1 and rejects 4", async () => {
			const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
			const provider = new MockSDKProvider("single_session_conc");

			const deferred = new Deferred<any>();
			provider.queueResponse(async () => await deferred.promise);

			harness.registerProvider(provider);
			const session = harness.createSession({ providerName: "single_session_conc" });

			// Launch 5 turns simultaneously on the EXACT same session
			const p1 = session.send("Turn 1");
			const p2 = session.send("Turn 2 (concurrent collision)");
			const p3 = session.send("Turn 3 (concurrent collision)");
			const p4 = session.send("Turn 4 (concurrent collision)");
			const p5 = session.send("Turn 5 (concurrent collision)");

			// p2..p5 should immediately reject synchronously or on first tick
			const results = await Promise.allSettled([p1, p2, p3, p4, p5]);

			// Resolve p1
			deferred.resolve({
				content: [{ type: "text", text: "P1 success" }],
				usage: { inputTokens: 5, outputTokens: 5 },
			});

			const [res1, ...others] = results;
			expect(res1.status).toBe("fulfilled");
			if (res1.status === "fulfilled") {
				expect(res1.value.response).toBe("P1 success");
			}

			// All 4 other turns must have rejected with concurrency violation
			for (const other of others) {
				expect(other.status).toBe("rejected");
				if (other.status === "rejected") {
					expect(String(other.reason.message)).toContain("Another execution turn is already in progress");
				}
			}

			// Session must now be unlocked and ready for next turn
			provider.queueTextResponse("P_next success");
			const nextResult = await session.send("Subsequent turn after collisions");
			expect(nextResult.response).toBe("P_next success");
		});

		it("ADV-CONC-04: high-throughput pipeline: 50 sequential turns across 5 sessions with 0 leaks", async () => {
			const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
			const provider = new MockSDKProvider("pipeline_provider");

			for (let i = 0; i < 50; i++) {
				provider.queueTextResponse(`Pipeline response ${i}`, { inputTokens: 5, outputTokens: 5 });
			}

			harness.registerProvider(provider);

			const sessionPool = Array.from({ length: 5 }, (_, i) =>
				harness.createSession({ id: `pool_${i}`, providerName: "pipeline_provider" }),
			);

			for (let i = 0; i < 50; i++) {
				const session = sessionPool[i % 5];
				const res = await session.send(`Job ${i}`);
				expect(res.response).toBe(`Pipeline response ${i}`);
			}

			for (const session of sessionPool) {
				expect(session.getState().turnCount).toBe(10);
				expect(session.getState().totalTokens).toBe(100);
			}
		});
	});

	// =========================================================================
	// 2. TOOL EDGE CASES & PATHOLOGICAL BEHAVIOR (ADV-TOOL)
	// =========================================================================
	describe("2. Tool Edge Cases & Malformed Inputs", () => {
		it("ADV-TOOL-01: custom tool returning massive output (1MB string / 10,000 lines)", async () => {
			const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
			const provider = new MockSDKProvider("large_tool_provider");

			provider.queueToolCallResponse("huge_output_tool", {}, "call_huge_1");
			provider.queueTextResponse("Processed large output successfully.");

			const bigPayload = "A".repeat(100) + "\n";
			const massiveString = bigPayload.repeat(10000); // 1,010,000 chars

			const hugeTool = createMockTool("huge_output_tool", async () => ({
				result: massiveString,
				isError: false,
			}));

			harness.registerProvider(provider);
			harness.registerTool(hugeTool);

			const session = harness.createSession({
				providerName: "large_tool_provider",
				approvalMode: "yolo",
			});

			const result = await session.send("Trigger massive output tool");
			expect(result.response).toBe("Processed large output successfully.");

			const toolResultEv = result.events.find((e) => e.type === "tool_result") as any;
			expect(toolResultEv).toBeDefined();
			expect(toolResultEv.result.length).toBe(massiveString.length);
		});

		it("ADV-TOOL-02: custom tool throwing non-Error primitives (string, number, null, undefined, object)", async () => {
			const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
			const provider = new MockSDKProvider("throw_primitives_provider");

			const thrownValues: any[] = [
				"plain string error",
				503,
				null,
				undefined,
				{ customErrorCode: "ERR_UNAUTHORIZED" },
			];

			for (let i = 0; i < thrownValues.length; i++) {
				provider.queueToolCallResponse(`throw_tool_${i}`, {}, `call_throw_${i}`);
				provider.queueTextResponse(`Handled throw ${i}`);

				const tool: Tool = {
					name: `throw_tool_${i}`,
					description: `Throws value ${i}`,
					inputSchema: { type: "object", properties: {} },
					execute: async () => {
						throw thrownValues[i];
					},
				};
				harness.registerTool(tool);
			}

			harness.registerProvider(provider);
			const session = harness.createSession({
				providerName: "throw_primitives_provider",
				approvalMode: "yolo",
			});

			for (let i = 0; i < thrownValues.length; i++) {
				const result = await session.send(`Call throw tool ${i}`);
				expect(result.response).toBe(`Handled throw ${i}`);
				const toolResultEv = result.events.find((e) => e.type === "tool_result") as any;
				expect(toolResultEv).toBeDefined();
				expect(toolResultEv.isError).toBe(true);
				expect(toolResultEv.result).toBeDefined();
			}
		});

		it("ADV-TOOL-03: custom tool returning non-standard result objects (void, null result, number result, object result)", async () => {
			const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
			const provider = new MockSDKProvider("nonstandard_tool_provider");

			// 1. Tool returning undefined (forgot return)
			provider.queueToolCallResponse("void_tool", {}, "c_void");
			provider.queueTextResponse("Handled void tool");

			// 2. Tool returning number in result
			provider.queueToolCallResponse("number_tool", {}, "c_num");
			provider.queueTextResponse("Handled number tool");

			// 3. Tool returning object in result
			provider.queueToolCallResponse("object_tool", {}, "c_obj");
			provider.queueTextResponse("Handled object tool");

			const voidTool = {
				name: "void_tool",
				description: "Void tool",
				inputSchema: { type: "object" },
				execute: (async () => {}) as any,
			};

			const numberTool = {
				name: "number_tool",
				description: "Number tool",
				inputSchema: { type: "object" },
				execute: async () => ({ result: 42 as any, isError: false }),
			};

			const objectTool = {
				name: "object_tool",
				description: "Object tool",
				inputSchema: { type: "object" },
				execute: async () => ({ result: { user: "davy", role: "admin" } as any, isError: false }),
			};

			harness.registerTool(voidTool as any);
			harness.registerTool(numberTool as any);
			harness.registerTool(objectTool as any);
			harness.registerProvider(provider);

			const session = harness.createSession({
				providerName: "nonstandard_tool_provider",
				approvalMode: "yolo",
			});

			const r1 = await session.send("Call void tool");
			expect(r1.response).toBe("Handled void tool");

			const r2 = await session.send("Call number tool");
			expect(r2.response).toBe("Handled number tool");

			const r3 = await session.send("Call object tool");
			expect(r3.response).toBe("Handled object tool");
		});

		it("ADV-TOOL-04: custom tools with pathological schema variations and unicode names", async () => {
			const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
			const provider = new MockSDKProvider("schema_fuzz_provider");

			const unicodeToolName = "工具_🚀_test_123";
			provider.queueToolCallResponse(unicodeToolName, { nested: { deep: { value: "ok" } } }, "c_uni");
			provider.queueTextResponse("Unicode tool executed successfully.");

			const complexTool: Tool = {
				name: unicodeToolName,
				description: "Tool with unicode name and 5-level deep schema: 🔍 📦 ✨",
				inputSchema: {
					type: "object",
					properties: {
						nested: {
							type: "object",
							properties: {
								deep: {
									type: "object",
									properties: {
										value: { type: "string" },
									},
									required: ["value"],
								},
							},
						},
					},
					additionalProperties: true,
				},
				execute: async (input) => ({
					result: `Received deep value: ${(input as any)?.nested?.deep?.value}`,
					isError: false,
				}),
			};

			harness.registerTool(complexTool);
			harness.registerProvider(provider);

			const session = harness.createSession({
				providerName: "schema_fuzz_provider",
				approvalMode: "yolo",
			});

			const result = await session.send("Call unicode complex tool");
			expect(result.response).toBe("Unicode tool executed successfully.");
			const toolResultEv = result.events.find((e) => e.type === "tool_result") as any;
			expect(toolResultEv.result).toBe("Received deep value: ok");
		});

		it("ADV-TOOL-05: tool execution returning synchronous ToolResult without Promise", async () => {
			const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
			const provider = new MockSDKProvider("sync_tool_provider");

			provider.queueToolCallResponse("sync_calc", { val: 10 }, "c_sync");
			provider.queueTextResponse("Calculated synchronously: 20");

			const syncTool = {
				name: "sync_calc",
				description: "Sync calculator",
				inputSchema: { type: "object", properties: { val: { type: "number" } } },
				execute: (input: any) => ({
					result: String(input.val * 2),
					isError: false,
				}),
			};

			harness.registerTool(syncTool as any);
			harness.registerProvider(provider);

			const session = harness.createSession({
				providerName: "sync_tool_provider",
				approvalMode: "yolo",
			});

			const result = await session.send("Calculate 10 * 2");
			expect(result.response).toContain("20");
		});

		it("ADV-TOOL-06: batch execution of 15 simultaneous tool calls in a single turn", async () => {
			const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
			const provider = new MockSDKProvider("batch_tools_provider");

			const toolNames: string[] = [];
			const toolUseBlocks: any[] = [];
			for (let i = 0; i < 15; i++) {
				const name = `batch_tool_${i}`;
				toolNames.push(name);
				toolUseBlocks.push({
					type: "tool_use",
					id: `call_batch_${i}`,
					name,
					input: { index: i },
				});

				const tool = createMockTool(name, async (input) => ({
					result: `Batch result #${input.index}`,
					isError: false,
				}));
				harness.registerTool(tool);
			}

			provider.queueResponse({
				content: toolUseBlocks,
				usage: { inputTokens: 50, outputTokens: 50 },
			});
			provider.queueTextResponse("All 15 batch tools completed.");

			harness.registerProvider(provider);
			const session = harness.createSession({
				providerName: "batch_tools_provider",
				approvalMode: "yolo",
			});

			const result = await session.send("Execute 15 batch tools");
			expect(result.response).toBe("All 15 batch tools completed.");

			const toolResults = result.events.filter((e) => e.type === "tool_result");
			expect(toolResults.length).toBe(15);
		});
	});

	// =========================================================================
	// 3. ABORT & CANCELLATION STRESS SUITE (ADV-ABORT)
	// =========================================================================
	describe("3. Abort & Cancellation Stress", () => {
		it("ADV-ABORT-01: ultra-rapid abort immediately after send() dispatch in same tick", async () => {
			const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
			const provider = new MockSDKProvider("rapid_abort_provider");

			harness.registerProvider(provider);
			const session = harness.createSession({ providerName: "rapid_abort_provider" });

			const controller = new AbortController();
			const sendPromise = session.send("Prompt that will be aborted immediately", {
				signal: controller.signal,
			});

			// Abort immediately in the same tick
			controller.abort(new Error("Immediate sync abort"));

			try {
				await sendPromise;
			} catch (err: any) {
				expect(err).toBeDefined();
			}

			// Verify session is clean and accepts next turn
			provider.queueTextResponse("Clean recovery response");
			const cleanResult = await session.send("Subsequent prompt");
			expect(cleanResult.response).toBe("Clean recovery response");
		});

		it("ADV-ABORT-02: abort while approval interceptor is waiting asynchronously", async () => {
			const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
			const provider = new MockSDKProvider("approval_abort_provider");

			provider.queueToolCallResponse("sensitive_op", {}, "c_sens");
			provider.queueTextResponse("Done");

			const sensitiveTool = createMockTool("sensitive_op");
			harness.registerTool(sensitiveTool);
			harness.registerProvider(provider);

			const session = harness.createSession({
				providerName: "approval_abort_provider",
				approvalMode: "manual",
			});

			const approvalDeferred = new Deferred<boolean>();
			session.onApprovalRequest(async () => {
				return await approvalDeferred.promise;
			});

			const controller = new AbortController();
			const sendPromise = session.send("Run sensitive op", { signal: controller.signal });

			// Simulate waiting for approval, then user cancels
			setTimeout(() => {
				controller.abort(new Error("User cancelled at approval dialog"));
				approvalDeferred.resolve(true); // Settle interceptor
			}, 30);

			try {
				await sendPromise;
			} catch (err: any) {
				expect(err).toBeDefined();
			}

			// Subsequent turn should execute without issue
			provider.queueTextResponse("Recovered after approval cancel");
			const r2 = await session.send("New prompt");
			expect(r2.response).toBe("Recovered after approval cancel");
		});

		it("ADV-ABORT-03: multiple 50x rapid redundant abort() calls before, during, and after turn", async () => {
			const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
			const provider = new MockSDKProvider("fuzz_abort_provider");

			provider.queueTextResponse("Normal turn 1");
			provider.queueTextResponse("Normal turn 2");

			harness.registerProvider(provider);
			const session = harness.createSession({ providerName: "fuzz_abort_provider" });

			// 1. Abort before any turn
			for (let i = 0; i < 20; i++) {
				session.abort();
			}

			// 2. Run normal turn
			const res1 = await session.send("Turn 1");
			expect(res1.response).toBe("Normal turn 1");

			// 3. Abort after turn completion 20 times
			for (let i = 0; i < 20; i++) {
				session.abort();
			}

			// 4. Run second turn
			const res2 = await session.send("Turn 2");
			expect(res2.response).toBe("Normal turn 2");

			// 5. Final abort spam
			for (let i = 0; i < 10; i++) {
				session.abort();
			}
		});

		it("ADV-ABORT-04: 20 rapid cycles of turn dispatch followed by immediate abort", async () => {
			const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
			const provider = new MockSDKProvider("cycle_abort_provider");
			harness.registerProvider(provider);

			const session = harness.createSession({ providerName: "cycle_abort_provider" });

			for (let i = 0; i < 20; i++) {
				const ctrl = new AbortController();
				const p = session.send(`Turn ${i}`, { signal: ctrl.signal });
				ctrl.abort();
				try {
					await p;
				} catch {
					// Expected abort
				}
			}

			// Final clean turn must succeed
			provider.queueTextResponse("Pristine success after 20 abort cycles");
			const finalRes = await session.send("Final clean prompt");
			expect(finalRes.response).toBe("Pristine success after 20 abort cycles");
		});

		it("ADV-ABORT-05: sendStream() aborted via generator .return() correctly unlocks session", async () => {
			const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
			const provider = new MockSDKProvider("generator_return_provider");

			provider.queueTextResponse("Streamed response text");
			harness.registerProvider(provider);

			const session = harness.createSession({ providerName: "generator_return_provider" });

			// Start stream
			const stream = session.sendStream("Stream prompt");
			const firstEvent = await stream.next();
			expect(firstEvent.value).toBeDefined();

			// Consumer abandons stream early via .return()
			await stream.return(undefined as any);

			// Session execution state must be unlocked
			provider.queueTextResponse("Success after generator return");
			const result = await session.send("New prompt");
			expect(result.response).toBe("Success after generator return");
		});
	});

	// =========================================================================
	// 4. SECURITY, EVENT RESILIENCE & INTEGRITY (ADV-SEC)
	// =========================================================================
	describe("4. Security, Event Resilience & Integrity", () => {
		it("ADV-SEC-01: buggy event listeners throwing uncaught errors must not disrupt turn loop", async () => {
			const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
			const provider = new MockSDKProvider("listener_error_provider");

			provider.queueToolCallResponse("dummy_tool", {}, "c_dum");
			provider.queueTextResponse("Completed despite throwing listeners.");

			const dummyTool = createMockTool("dummy_tool");
			harness.registerTool(dummyTool);
			harness.registerProvider(provider);

			const session = harness.createSession({
				providerName: "listener_error_provider",
				approvalMode: "yolo",
			});

			// Register faulty listeners
			session.on("event", () => {
				throw new Error("Buggy generic listener explosion!");
			});
			session.onToolCall(() => {
				throw new Error("Buggy onToolCall listener explosion!");
			});
			session.onToolResult(() => {
				throw new Error("Buggy onToolResult listener explosion!");
			});
			session.onResponse(() => {
				throw new Error("Buggy onResponse listener explosion!");
			});
			session.onDone(() => {
				throw new Error("Buggy onDone listener explosion!");
			});

			// A healthy listener to ensure it still receives events
			const healthyEvents: SDKEvent[] = [];
			session.on("event", (e: any) => healthyEvents.push(e));

			const result = await session.send("Test error resilience");
			expect(result.response).toBe("Completed despite throwing listeners.");
			expect(healthyEvents.length).toBeGreaterThan(0);
		});

		it("ADV-SEC-02: sandbox validation blocks path traversal in tool arguments in build mode", async () => {
			const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
			const provider = new MockSDKProvider("sandbox_provider");

			// Attempt path traversal outside project root
			const maliciousPath = path.resolve(tempDir, "../../sensitive_secret.txt");
			provider.queueToolCallResponse("read_file", { path: maliciousPath }, "c_trav");
			provider.queueTextResponse("Handled path traversal block.");

			harness.registerProvider(provider);
			const session = harness.createSession({
				providerName: "sandbox_provider",
				approvalMode: "yolo",
			});

			const result = await session.send("Read secret outside sandbox");
			expect(result.response).toBe("Handled path traversal block.");

			const toolResultEv = result.events.find((e) => e.type === "tool_result") as any;
			expect(toolResultEv).toBeDefined();
			expect(toolResultEv.isError).toBe(true);
			expect(toolResultEv.result).toContain("Control Denied");
		});

		it("ADV-SEC-03: approval interceptor structured denial with custom reason is propagated to provider", async () => {
			const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
			const provider = new MockSDKProvider("denial_reason_provider");

			provider.queueToolCallResponse("run_command", { command: "rm -rf /" }, "c_rm");
			provider.queueResponse((messages) => {
				const toolResultMsg = messages.find((m) =>
					m.content.some((c) => c.type === "tool_result" && (c as any).content.includes("Strict Security Policy #403")),
				);
				return {
					content: [
						{
							type: "text",
							text: toolResultMsg
								? "Security blocked: Strict Security Policy #403"
								: "Denial reason lost",
						},
					],
					usage: { inputTokens: 10, outputTokens: 5 },
				};
			});

			harness.registerProvider(provider);
			const session = harness.createSession({
				providerName: "denial_reason_provider",
				approvalMode: "manual",
			});

			session.onApprovalRequest(async () => {
				return {
					approved: false,
					reason: "Strict Security Policy #403: Destructive command rejected",
				};
			});

			const result = await session.send("Delete all files");
			expect(result.response).toContain("Strict Security Policy #403");
		});
	});
});
