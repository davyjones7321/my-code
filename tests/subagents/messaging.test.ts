import { beforeEach, describe, expect, it } from "bun:test";
import { createTestManager } from "./test-helpers.ts";

describe("Subagent Bidirectional Messaging & Mailbox", () => {
	let testEnv: ReturnType<typeof createTestManager>;

	beforeEach(() => {
		testEnv = createTestManager();
	});

	describe("Communication Channels & Routing", () => {
		it("MSG-01: delivers message from parent to child inbox and context", async () => {
			const { manager } = testEnv;
			const child = manager.spawn("parent-session", {
				prompt: "Initial subagent prompt",
				type: "research",
			});

			const delivery = await manager.sendMessage(
				"parent-session",
				child.id,
				"Please also analyze utils/math.ts",
				false,
			);

			expect(delivery.success).toBe(true);
			expect(delivery.delivered).toBe(true);
			expect(delivery.recipientId).toBe(child.id);

			expect(child.inbox.length).toBe(1);
			expect(child.inbox[0].fromId).toBe("parent-session");
			expect(child.inbox[0].content).toBe("Please also analyze utils/math.ts");
			expect(child.inbox[0].direction).toBe("parent_to_child");

			const context = await child.contextManager.getContext();
			const lastMsg = context[context.length - 1];
			expect(lastMsg.role).toBe("user");
			expect(JSON.stringify(lastMsg.content)).toContain(
				"[Message from parent-session]: Please also analyze utils/math.ts",
			);
		});

		it("MSG-02: resolves 'parent' keyword to caller's parentId", async () => {
			const { manager } = testEnv;
			const parent = manager.spawn("root", { prompt: "Parent" });
			const child = manager.spawn(parent.id, { prompt: "Child" });

			const delivery = await manager.sendMessage(
				child.id,
				"parent",
				"Completed step 1, requesting feedback",
				false,
			);

			expect(delivery.success).toBe(true);
			expect(delivery.recipientId).toBe(parent.id);
			expect(parent.inbox.length).toBe(1);
			expect(parent.inbox[0].direction).toBe("child_to_parent");
		});

		it("MSG-03: routes peer-to-peer messages between sibling subagents", async () => {
			const { manager } = testEnv;
			const workerA = manager.spawn("root", { prompt: "Worker A" });
			const workerB = manager.spawn("root", { prompt: "Worker B" });

			const delivery = await manager.sendMessage(
				workerA.id,
				workerB.id,
				"Found interface contract in types.ts",
				false,
			);

			expect(delivery.success).toBe(true);
			expect(delivery.recipientId).toBe(workerB.id);
			expect(workerB.inbox.length).toBe(1);
			expect(workerB.inbox[0].fromId).toBe(workerA.id);
			expect(workerB.inbox[0].direction).toBe("peer_to_peer");
		});

		it("MSG-04: supports multi-turn ping-pong exchanges with continuation", async () => {
			const { manager, provider } = testEnv;

			// Turn 1 initial response
			provider.queueResponse({
				content: [{ type: "text", text: "Ready for task." }],
			});

			// Turn 2 continuation response
			provider.queueResponse({
				content: [{ type: "text", text: "Processed extra instructions." }],
			});

			const initialResult = await manager.invoke("parent-session", {
				prompt: "Start worker",
				type: "research",
			});

			expect(initialResult.output).toBe("Ready for task.");

			const delivery = await manager.sendMessage(
				"parent-session",
				initialResult.instanceId,
				"Here are extra instructions",
				true,
			);

			expect(delivery.success).toBe(true);
			expect(delivery.response).toBe("Processed extra instructions.");

			const childInstance = manager.getInstance(initialResult.instanceId);
			expect(childInstance?.messageHistory.length).toBe(1);
		});
	});

	describe("Queueing & Semantics", () => {
		it("MSG-05: queues multiple messages in strict FIFO order", async () => {
			const { manager } = testEnv;
			const child = manager.spawn("parent", { prompt: "Busy worker" });

			await manager.sendMessage("parent", child.id, "Message 1", false);
			await manager.sendMessage("parent", child.id, "Message 2", false);
			await manager.sendMessage("parent", child.id, "Message 3", false);

			expect(child.inbox.length).toBe(3);
			expect(child.inbox[0].content).toBe("Message 1");
			expect(child.inbox[1].content).toBe("Message 2");
			expect(child.inbox[2].content).toBe("Message 3");
		});

		it("MSG-06: validates message attribution formatting", async () => {
			const { manager } = testEnv;
			const agent = manager.spawn("root", { prompt: "Task" });

			await manager.sendMessage("qa-bot", agent.id, "Bug found in line 42", false);

			const context = await agent.contextManager.getContext();
			const msgContent = JSON.stringify(context);
			expect(msgContent).toContain("[Message from qa-bot]: Bug found in line 42");
		});

		it("MSG-07: rejects empty or whitespace-only messages", async () => {
			const { manager } = testEnv;
			const agent = manager.spawn("root", { prompt: "Task" });

			const emptyRes = await manager.sendMessage("parent", agent.id, "", false);
			expect(emptyRes.success).toBe(false);
			expect(emptyRes.error).toContain("Message content cannot be empty");

			const wsRes = await manager.sendMessage("parent", agent.id, "   \n\t  ", false);
			expect(wsRes.success).toBe(false);
			expect(wsRes.error).toContain("Message content cannot be empty");
		});
	});

	describe("Synchronization & Error Handling", () => {
		it("MSG-08: synchronous send (awaitResponse: true) executes turn and returns reply", async () => {
			const { manager, provider } = testEnv;
			provider.queueResponse({ content: [{ type: "text", text: "Initial greeting." }] });
			provider.queueResponse({ content: [{ type: "text", text: "Answer to question." }] });

			const instance = manager.spawn("parent", { prompt: "Hello" });
			await instance.taskPromise;

			const result = await manager.sendMessage(
				"parent",
				instance.id,
				"What is 2+2?",
				true,
			);

			expect(result.success).toBe(true);
			expect(result.response).toBe("Answer to question.");
			expect(result.delivered).toBe(true);
		});

		it("MSG-09: asynchronous send (awaitResponse: false) delivers immediately", async () => {
			const { manager } = testEnv;
			const instance = manager.spawn("parent", { prompt: "Worker" });

			const result = await manager.sendMessage(
				"parent",
				instance.id,
				"Background update",
				false,
			);

			expect(result.success).toBe(true);
			expect(result.delivered).toBe(true);
			expect(result.response).toBeUndefined();
		});

		it("MSG-10: returns error for non-existent recipient ID", async () => {
			const { manager } = testEnv;
			const result = await manager.sendMessage(
				"parent",
				"non-existent-subagent-id",
				"Hello",
				false,
			);

			expect(result.success).toBe(false);
			expect(result.delivered).toBe(false);
			expect(result.error).toContain("not found");
		});

		it("MSG-11: returns error when sending message to terminated subagent", async () => {
			const { manager } = testEnv;
			const agent = manager.spawn("root", { prompt: "Agent" });
			await manager.terminate(agent.id);

			const result = await manager.sendMessage("parent", agent.id, "Hello", false);

			expect(result.success).toBe(false);
			expect(result.delivered).toBe(false);
			expect(result.error).toContain("terminated");
		});
	});
});
