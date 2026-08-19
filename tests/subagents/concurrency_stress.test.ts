import { beforeEach, describe, expect, it } from "bun:test";
import { Deferred, createTestManager } from "./test-helpers.ts";

describe("Subagent Concurrency & Stress Tests", () => {
	let testEnv: ReturnType<typeof createTestManager>;

	beforeEach(() => {
		testEnv = createTestManager({ maxConcurrentSubagents: 100 });
	});

	describe("High-Scale Parallel Execution", () => {
		it("STRESS-01: executes 20 concurrent subagents in parallel with zero state collisions", async () => {
			const { manager, provider } = testEnv;

			for (let i = 0; i < 20; i++) {
				provider.queueResponse({
					content: [{ type: "text", text: `Worker ${i} completed analysis.` }],
				});
			}

			const invocations = Array.from({ length: 20 }, (_, i) =>
				manager.invoke("root-concurrency", {
					prompt: `Task ${i}`,
					type: "research",
				}),
			);

			const results = await Promise.all(invocations);

			expect(results.length).toBe(20);
			const uniqueIds = new Set(results.map((r) => r.instanceId));
			expect(uniqueIds.size).toBe(20);

			for (const res of results) {
				expect(res.state).toBe("done");
				expect(res.output).toContain("completed analysis");
			}
		});

		it("STRESS-02: executes concurrent tool calls across 15 subagents simultaneously", async () => {
			const { manager, provider } = testEnv;

			for (let i = 0; i < 30; i++) {
				provider.queueResponse((messages) => {
					const hasTool = messages.some((m) => m.role === "tool");
					const userMsg = messages[0]?.content?.find((c) => c.type === "text");
					const promptText = userMsg && "text" in userMsg ? userMsg.text : "";
					const moduleNum = promptText.replace(/[^0-9]/g, "") || "0";

					if (hasTool) {
						return {
							content: [{ type: "text", text: `Output for module_${moduleNum}` }],
						};
					}

					return {
						content: [
							{
								type: "tool_use",
								id: `tu-${moduleNum}`,
								name: "read_file",
								input: { path: `src/module_${moduleNum}.ts` },
							},
						],
					};
				});
			}

			const invocations = Array.from({ length: 15 }, (_, i) =>
				manager.invoke("root-tools", {
					prompt: `Examine module ${i}`,
					type: "research",
				}),
			);

			const results = await Promise.all(invocations);

			expect(results.length).toBe(15);
			for (let i = 0; i < 15; i++) {
				const res = results[i];
				expect(res.state).toBe("done");
				expect(res.toolCallsCount).toBe(1);
				expect(res.totalIterations).toBe(2);
			}
		});

		it("STRESS-03: enforces maxConcurrentSubagents boundary limit", () => {
			const constrainedManager = createTestManager({ maxConcurrentSubagents: 3 }).manager;

			// Spawn 3 active
			constrainedManager.spawn("root", { prompt: "Task 1" });
			constrainedManager.spawn("root", { prompt: "Task 2" });
			constrainedManager.spawn("root", { prompt: "Task 3" });

			// 4th spawn should throw
			expect(() => {
				constrainedManager.spawn("root", { prompt: "Task 4" });
			}).toThrow(/Maximum concurrent subagents/);
		});
	});

	describe("High-Throughput Messaging & Mesh Routing", () => {
		it("STRESS-04: handles rapid 50-message burst in strict FIFO order without drops", async () => {
			const { manager } = testEnv;
			const target = manager.spawn("root", { prompt: "Target receiver" });

			const messageSends = Array.from({ length: 50 }, (_, i) =>
				manager.sendMessage("sender", target.id, `Burst message #${i}`, false),
			);

			const deliveryResults = await Promise.all(messageSends);

			for (const d of deliveryResults) {
				expect(d.success).toBe(true);
				expect(d.delivered).toBe(true);
			}

			expect(target.inbox.length).toBe(50);
			for (let i = 0; i < 50; i++) {
				expect(target.inbox[i].content).toBe(`Burst message #${i}`);
			}
		});

		it("STRESS-05: executes mesh/ping-pong interleaved messaging across 5 pairs", async () => {
			const { manager } = testEnv;

			const pairs = Array.from({ length: 5 }, (_, i) => ({
				agentA: manager.spawn("root", { prompt: `Pair ${i} Agent A` }),
				agentB: manager.spawn("root", { prompt: `Pair ${i} Agent B` }),
			}));

			const meshOps: Promise<any>[] = [];
			for (let i = 0; i < pairs.length; i++) {
				const { agentA, agentB } = pairs[i];
				meshOps.push(manager.sendMessage(agentA.id, agentB.id, `Ping from A${i}`, false));
				meshOps.push(manager.sendMessage(agentB.id, agentA.id, `Pong from B${i}`, false));
			}

			await Promise.all(meshOps);

			for (let i = 0; i < pairs.length; i++) {
				expect(pairs[i].agentA.inbox.length).toBe(1);
				expect(pairs[i].agentA.inbox[0].content).toBe(`Pong from B${i}`);
				expect(pairs[i].agentB.inbox.length).toBe(1);
				expect(pairs[i].agentB.inbox[0].content).toBe(`Ping from A${i}`);
			}
		});
	});

	describe("Deep Hierarchy & Tree Scaling", () => {
		it("STRESS-06: builds and navigates 4-tier deep subagent hierarchy", () => {
			const { manager } = testEnv;
			const l0 = manager.spawn("root", { prompt: "Level 0" });
			const l1 = manager.spawn(l0.id, { prompt: "Level 1" });
			const l2 = manager.spawn(l1.id, { prompt: "Level 2" });
			const l3 = manager.spawn(l2.id, { prompt: "Level 3" });

			expect(l3.parentId).toBe(l2.id);
			expect(l2.parentId).toBe(l1.id);
			expect(l1.parentId).toBe(l0.id);

			const ancestors = manager.getAncestors(l3.id);
			expect(ancestors.map((a) => a.id)).toEqual([l2.id, l1.id, l0.id]);

			const descendants = manager.getDescendants(l0.id);
			expect(descendants.map((d) => d.id)).toEqual([l1.id, l2.id, l3.id]);
		});

		it("STRESS-07: tracks wide and deep 13-agent tree hierarchy", () => {
			const { manager } = testEnv;
			const root = manager.spawn("root", { prompt: "Root Orchestrator" });

			const children = Array.from({ length: 3 }, (_, c) =>
				manager.spawn(root.id, { prompt: `Child ${c}` }),
			);

			for (const child of children) {
				for (let g = 0; g < 3; g++) {
					manager.spawn(child.id, { prompt: `Grandchild ${g} of ${child.name}` });
				}
			}

			const allDescendants = manager.getDescendants(root.id);
			expect(allDescendants.length).toBe(12); // 3 children + 9 grandchildren

			const tree = manager.getTree(root.id);
			expect(tree.children.length).toBe(3);
			for (const cNode of tree.children) {
				expect(cNode.children.length).toBe(3);
			}
		});
	});

	describe("Mass Abort & Churn Resilience", () => {
		it("STRESS-08: cleanly aborts 20 running subagents under load without unhandled rejections", async () => {
			const { manager, provider } = testEnv;
			const deferreds = Array.from({ length: 20 }, () => new Deferred<any>());

			for (let i = 0; i < 20; i++) {
				const d = deferreds[i];
				provider.queueResponse(async () => {
					return await d.promise;
				});
			}

			const instances = Array.from({ length: 20 }, (_, i) =>
				manager.spawn("root", { prompt: `Long Task ${i}` }),
			);

			// Trigger mass termination
			await manager.terminateAll();

			for (const inst of instances) {
				expect(inst.state).toBe("terminated");
				expect(inst.abortController.signal.aborted).toBe(true);
			}

			// Release any pending provider calls
			for (const d of deferreds) {
				d.resolve({ content: [{ type: "text", text: "Finished" }] });
			}

			const results = await Promise.all(instances.map((i) => i.taskPromise!));
			for (const r of results) {
				expect(r.state).toBe("terminated");
			}
		});

		it("STRESS-09: cascades abort through 3-level deep tree", async () => {
			const { manager } = testEnv;
			const l1 = manager.spawn("root", { prompt: "L1" });
			const l2 = manager.spawn(l1.id, { prompt: "L2" });
			const l3 = manager.spawn(l2.id, { prompt: "L3" });

			await manager.terminate(l1.id, "Root abort", true);

			expect(l1.state).toBe("terminated");
			expect(l2.state).toBe("terminated");
			expect(l3.state).toBe("terminated");
		});

		it("STRESS-10: handles rapid high-churn spawn-and-destroy cycles (30 cycles)", async () => {
			const { manager, provider } = testEnv;

			for (let i = 0; i < 30; i++) {
				provider.queueResponse({
					content: [{ type: "text", text: `Quick turn ${i}` }],
				});
			}

			for (let i = 0; i < 30; i++) {
				const inst = manager.spawn("root", { prompt: `Cycle ${i}` });
				await inst.taskPromise;
				expect(inst.state).toBe("done");
				await manager.terminate(inst.id);
			}

			const summaries = manager.listInstances();
			expect(summaries.length).toBe(30);
		});

		it("STRESS-11: error resilience with mixed success and throwing subagents running concurrently", async () => {
			const { manager, provider } = testEnv;

			for (let i = 0; i < 10; i++) {
				// 5 success, 5 error
				if (i % 2 === 0) {
					provider.queueResponse({
						content: [{ type: "text", text: `Success ${i}` }],
					});
				} else {
					provider.queueResponse(() => {
						throw new Error(`Deliberate Error ${i}`);
					});
				}
			}

			const invocations = Array.from({ length: 10 }, (_, i) =>
				manager.invoke("root", { prompt: `Task ${i}` }),
			);

			const results = await Promise.all(invocations);

			expect(results.length).toBe(10);
			const successes = results.filter((r) => r.state === "done");
			const errors = results.filter((r) => r.state === "errored");

			expect(successes.length).toBe(5);
			expect(errors.length).toBe(5);
		});
	});
});
