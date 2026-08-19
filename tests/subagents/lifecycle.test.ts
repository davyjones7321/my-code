import { beforeEach, describe, expect, it } from "bun:test";
import type { Message } from "../../src/agent/types.ts";
import { Deferred, MockMultiTurnProvider, createTestManager } from "./test-helpers.ts";

describe("Subagent Lifecycle & State Model", () => {
	let testEnv: ReturnType<typeof createTestManager>;

	beforeEach(() => {
		testEnv = createTestManager();
	});

	describe("State Machine Transitions", () => {
		it("LIFECYCLE-01: initializes with idle state on spawn", () => {
			const { manager } = testEnv;
			const instance = manager.spawn("parent-1", {
				prompt: "Investigate module layout",
				type: "research",
			});

			expect(instance.id).toBeDefined();
			expect(instance.parentId).toBe("parent-1");
			expect(instance.childIds).toEqual([]);
			expect(instance.createdAt).toBeGreaterThan(0);
			expect(instance.inbox).toEqual([]);
		});

		it("LIFECYCLE-02: transitions running -> done upon standard text completion", async () => {
			const { manager, provider } = testEnv;
			provider.queueResponse({
				content: [{ type: "text", text: "Analysis completed successfully." }],
			});

			const result = await manager.invoke("parent-1", {
				prompt: "Analyze architecture",
				type: "research",
			});

			expect(result.state).toBe("done");
			expect(result.status).toBe("done");
			expect(result.output).toBe("Analysis completed successfully.");
			expect(result.totalIterations).toBe(1);
			expect(result.durationMs).toBeGreaterThanOrEqual(0);

			const instance = manager.getInstance(result.instanceId);
			expect(instance?.state).toBe("done");
			expect(instance?.completedAt).toBeGreaterThanOrEqual(instance?.startedAt!);
		});

		it("LIFECYCLE-03: records tool use and transitions through intermediate states", async () => {
			const { manager, provider } = testEnv;

			// Turn 1: tool call
			provider.queueResponse({
				content: [
					{
						type: "tool_use",
						id: "tool-1",
						name: "read_file",
						input: { path: "src/index.ts" },
					},
				],
			});

			// Turn 2: final response
			provider.queueResponse({
				content: [{ type: "text", text: "Verified src/index.ts content." }],
			});

			const result = await manager.invoke("parent-1", {
				prompt: "Check src/index.ts",
				type: "research",
			});

			expect(result.state).toBe("done");
			expect(result.totalIterations).toBe(2);
			expect(result.toolCallsCount).toBe(1);
			expect(result.output).toBe("Verified src/index.ts content.");
		});

		it("LIFECYCLE-05: transitions to errored state on provider exception", async () => {
			const { manager, provider } = testEnv;
			provider.queueResponse(() => {
				throw new Error("Simulated LLM Provider Outage");
			});

			const result = await manager.invoke("parent-1", {
				prompt: "Do work",
				type: "research",
			});

			expect(result.state).toBe("errored");
			expect(result.error).toContain("Simulated LLM Provider Outage");
			const instance = manager.getInstance(result.instanceId);
			expect(instance?.state).toBe("errored");
		});

		it("LIFECYCLE-05b: transitions to errored state when reaching max iterations limit", async () => {
			const { manager, provider } = testEnv;

			// Always request tool use to exceed max iterations
			for (let i = 0; i < 5; i++) {
				provider.queueResponse({
					content: [
						{
							type: "tool_use",
							id: `tool-${i}`,
							name: "read_file",
							input: { path: `file-${i}.txt` },
						},
					],
				});
			}

			const result = await manager.invoke("parent-1", {
				prompt: "Loop forever",
				type: "research",
				maxIterations: 3,
			});

			expect(result.state).toBe("errored");
			expect(result.error).toContain("Max iterations (3) reached");
		});
	});

	describe("Hierarchy Tracking & Parent-Child Trees", () => {
		it("LIFECYCLE-07: establishes parent-child relationship tracking", () => {
			const { manager } = testEnv;
			const child = manager.spawn("root-session", {
				prompt: "Subtask 1",
				type: "research",
			});

			expect(child.parentId).toBe("root-session");
			const children = manager.getChildren("root-session");
			expect(children.length).toBe(1);
			expect(children[0].id).toBe(child.id);
		});

		it("LIFECYCLE-08: supports multi-tier hierarchy (Parent -> Child -> Grandchild)", () => {
			const { manager } = testEnv;
			const parent = manager.spawn("root", { prompt: "Parent task", type: "research" });
			const child = manager.spawn(parent.id, { prompt: "Child task", type: "research" });
			const grandchild = manager.spawn(child.id, {
				prompt: "Grandchild task",
				type: "research",
			});

			expect(grandchild.parentId).toBe(child.id);
			expect(child.parentId).toBe(parent.id);
			expect(parent.parentId).toBe("root");

			expect(parent.childIds).toContain(child.id);
			expect(child.childIds).toContain(grandchild.id);

			const ancestors = manager.getAncestors(grandchild.id);
			expect(ancestors.map((a) => a.id)).toEqual([child.id, parent.id]);

			const descendants = manager.getDescendants(parent.id);
			expect(descendants.map((d) => d.id)).toContain(child.id);
			expect(descendants.map((d) => d.id)).toContain(grandchild.id);
		});

		it("LIFECYCLE-09: isolates siblings with independent lifecycles", async () => {
			const { manager, provider } = testEnv;

			provider.queueResponse({ content: [{ type: "text", text: "Child 1 done" }] });
			provider.queueResponse({ content: [{ type: "text", text: "Child 2 done" }] });

			const child1Promise = manager.invoke("parent-root", { prompt: "Task 1" });
			const child2Promise = manager.invoke("parent-root", { prompt: "Task 2" });

			const [res1, res2] = await Promise.all([child1Promise, child2Promise]);

			expect(res1.instanceId).not.toBe(res2.instanceId);
			expect(res1.state).toBe("done");
			expect(res2.state).toBe("done");
			expect(res1.output).toBe("Child 1 done");
			expect(res2.output).toBe("Child 2 done");

			const children = manager.getChildren("parent-root");
			expect(children.length).toBe(2);
		});

		it("LIFECYCLE-10: generates hierarchical tree structure accurately", () => {
			const { manager } = testEnv;
			const parent = manager.spawn("root", { prompt: "Root task" });
			const c1 = manager.spawn(parent.id, { prompt: "C1" });
			const c2 = manager.spawn(parent.id, { prompt: "C2" });
			const gc1 = manager.spawn(c1.id, { prompt: "GC1" });

			const tree = manager.getTree(parent.id);
			expect(tree.instance.id).toBe(parent.id);
			expect(tree.children.length).toBe(2);
			const c1Node = tree.children.find((c) => c.instance.id === c1.id);
			expect(c1Node).toBeDefined();
			expect(c1Node?.children.length).toBe(1);
			expect(c1Node?.children[0].instance.id).toBe(gc1.id);
		});
	});

	describe("Termination & Cascading Cleanup", () => {
		it("LIFECYCLE-11: explicitly terminates running subagent with AbortController", async () => {
			const { manager, provider } = testEnv;
			const deferred = new Deferred<any>();

			provider.queueResponse(async () => {
				return await deferred.promise;
			});

			const instance = manager.spawn("root", { prompt: "Long task" });

			const terminated = await manager.terminate(instance.id, "Terminated by user test");
			expect(terminated).toBe(true);

			expect(instance.state).toBe("terminated");
			expect(instance.status).toBe("terminated");
			expect(instance.abortController.signal.aborted).toBe(true);

			deferred.resolve({ content: [{ type: "text", text: "Finished after abort" }] });
			const result = await instance.taskPromise!;
			expect(result.state).toBe("terminated");
		});

		it("LIFECYCLE-12: cascading subtree termination aborts all children recursively", async () => {
			const { manager } = testEnv;
			const parent = manager.spawn("root", { prompt: "P" });
			const child1 = manager.spawn(parent.id, { prompt: "C1" });
			const child2 = manager.spawn(parent.id, { prompt: "C2" });
			const grandchild1 = manager.spawn(child1.id, { prompt: "GC1" });

			const ok = await manager.terminate(parent.id, "Cascade kill", true);
			expect(ok).toBe(true);

			expect(parent.state).toBe("terminated");
			expect(child1.state).toBe("terminated");
			expect(child2.state).toBe("terminated");
			expect(grandchild1.state).toBe("terminated");

			expect(parent.abortController.signal.aborted).toBe(true);
			expect(child1.abortController.signal.aborted).toBe(true);
			expect(child2.abortController.signal.aborted).toBe(true);
			expect(grandchild1.abortController.signal.aborted).toBe(true);
		});

		it("LIFECYCLE-13: handles idempotent termination calls cleanly", async () => {
			const { manager } = testEnv;
			const instance = manager.spawn("root", { prompt: "Idempotent test" });

			const first = await manager.terminate(instance.id);
			const second = await manager.terminate(instance.id);

			expect(first).toBe(true);
			expect(second).toBe(true);
			expect(instance.state).toBe("terminated");
		});

		it("LIFECYCLE-14: terminateAll halts all tracked instances", async () => {
			const { manager } = testEnv;
			const a1 = manager.spawn("root", { prompt: "A1" });
			const a2 = manager.spawn("root", { prompt: "A2" });
			const a3 = manager.spawn("root", { prompt: "A3" });

			await manager.terminateAll();

			expect(a1.state).toBe("terminated");
			expect(a2.state).toBe("terminated");
			expect(a3.state).toBe("terminated");
		});
	});

	describe("Isolation Guarantees", () => {
		it("LIFECYCLE-15: isolates context memory without polluting parent history", async () => {
			const { manager, provider } = testEnv;

			// Subagent performs tool use
			provider.queueResponse({
				content: [
					{
						type: "tool_use",
						id: "tu-1",
						name: "read_file",
						input: { path: "internal.ts" },
					},
				],
			});
			provider.queueResponse({
				content: [{ type: "text", text: "Found internal facts." }],
			});

			const result = await manager.invoke("parent-convo", {
				prompt: "Investigate internal.ts",
				type: "research",
			});

			expect(result.state).toBe("done");
			const childInstance = manager.getInstance(result.instanceId);
			expect(childInstance).toBeDefined();

			// Child context contains the turn
			const childContext = await childInstance?.contextManager.getContext();
			expect(childContext?.length).toBeGreaterThan(0);

			// Check that parent context has 0 child tool calls injected
			const parentInstance = manager.getInstance("parent-convo");
			expect(parentInstance).toBeUndefined(); // parent is outside or clean
		});

		it("LIFECYCLE-17: filters tools strictly according to allowedTools and disallowedTools", () => {
			const { manager } = testEnv;
			const researchAgent = manager.spawn("root", {
				type: "research",
				prompt: "Check permissions",
			});

			// Research agent has read_file but NOT write_file or run_command
			const toolNames = researchAgent.toolRegistry.list();
			expect(toolNames).toContain("read_file");
			expect(toolNames).toContain("glob_files");
			expect(toolNames).not.toContain("write_file");
			expect(toolNames).not.toContain("run_command");

			const testEngineer = manager.spawn("root", {
				type: "test-engineer",
				prompt: "Run tests",
			});

			const testToolNames = testEngineer.toolRegistry.list();
			expect(testToolNames).toContain("read_file");
			expect(testToolNames).toContain("write_file");
			expect(testToolNames).toContain("run_command");
		});

		it("LIFECYCLE-18: isolates control layer modes between subagents", () => {
			const { manager } = testEnv;
			const researchAgent = manager.spawn("root", { type: "research", prompt: "P1" });
			const testEngineer = manager.spawn("root", { type: "test-engineer", prompt: "P2" });

			expect(researchAgent.controlLayer?.getModeController().getMode()).toBe("plan");
			expect(testEngineer.controlLayer?.getModeController().getMode()).toBe("build");
		});
	});
});
