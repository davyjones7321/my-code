import { beforeEach, describe, expect, it } from "bun:test";
import {
	createDefineSubagentTool,
	createInvokeSubagentTool,
	createManageSubagentsTool,
	createSendMessageTool,
	registerSubagentTools,
} from "../../src/subagents/tools.ts";
import { ToolRegistry } from "../../src/tools/registry.ts";
import { createTestManager } from "./test-helpers.ts";

describe("Subagent Tools Execution & Control Layer Integration", () => {
	let testEnv: ReturnType<typeof createTestManager>;

	beforeEach(() => {
		testEnv = createTestManager();
	});

	describe("invoke_subagent Tool", () => {
		it("TOOL-01: executes subagent synchronously and returns formatted report", async () => {
			const { manager, provider } = testEnv;
			provider.queueResponse({
				content: [{ type: "text", text: "Investigation complete." }],
			});

			const tool = createInvokeSubagentTool(manager, "parent-session");
			const result = await tool.execute({
				type: "research",
				prompt: "Explore codebase architecture",
			});

			expect(result.isError).toBe(false);
			expect(result.result).toContain("### Subagent Execution Report");
			expect(result.result).toContain("State: done");
			expect(result.result).toContain("Investigation complete.");
		});

		it("TOOL-02: executes subagent in background when waitForCompletion is false", async () => {
			const { manager } = testEnv;
			const tool = createInvokeSubagentTool(manager, "parent-session");

			const result = await tool.execute({
				type: "research",
				prompt: "Long running analysis",
				waitForCompletion: false,
			});

			expect(result.isError).toBe(false);
			expect(result.result).toContain("running in background");
		});

		it("TOOL-03: passes tool overrides and restricts permissions", async () => {
			const { manager, provider } = testEnv;
			provider.queueResponse({
				content: [{ type: "text", text: "Checked with restricted tools." }],
			});

			const tool = createInvokeSubagentTool(manager, "parent-session");
			const result = await tool.execute({
				type: "research",
				prompt: "Check files",
				allowedTools: ["read_file"],
			});

			expect(result.isError).toBe(false);
		});

		it("TOOL-04: returns error when prompt is missing or empty", async () => {
			const { manager } = testEnv;
			const tool = createInvokeSubagentTool(manager, "parent-session");

			const result1 = await tool.execute({ prompt: "" });
			expect(result1.isError).toBe(true);
			expect(result1.result).toContain("prompt is required");

			const result2 = await tool.execute({});
			expect(result2.isError).toBe(true);
		});
	});

	describe("send_message Tool", () => {
		it("TOOL-06: sends message with awaitResponse and returns child response", async () => {
			const { manager, provider } = testEnv;
			provider.queueResponse({ content: [{ type: "text", text: "Ready." }] });
			provider.queueResponse({ content: [{ type: "text", text: "Task completed." }] });

			const child = manager.spawn("parent", { prompt: "Start" });
			await child.taskPromise;

			const tool = createSendMessageTool(manager, "parent");
			const result = await tool.execute({
				recipientId: child.id,
				message: "Run step 2",
				awaitResponse: true,
			});

			expect(result.isError).toBe(false);
			expect(result.result).toContain("Response from");
			expect(result.result).toContain("Task completed.");
		});

		it("TOOL-07: sends message asynchronously (awaitResponse: false)", async () => {
			const { manager } = testEnv;
			const child = manager.spawn("parent", { prompt: "Start" });

			const tool = createSendMessageTool(manager, "parent");
			const result = await tool.execute({
				subagentId: child.id,
				message: "FYI background info",
				awaitResponse: false,
			});

			expect(result.isError).toBe(false);
			expect(result.result).toContain("delivered successfully");
		});

		it("TOOL-08: returns error for invalid or missing recipient", async () => {
			const { manager } = testEnv;
			const tool = createSendMessageTool(manager, "parent");

			const result1 = await tool.execute({ message: "Hello" });
			expect(result1.isError).toBe(true);
			expect(result1.result).toContain("recipientId or subagentId is required");

			const result2 = await tool.execute({ recipientId: "bad-id", message: "Hello" });
			expect(result2.isError).toBe(true);
			expect(result2.result).toContain("not found");
		});
	});

	describe("manage_subagents Tool", () => {
		it("TOOL-09: performs 'list' action returning JSON summary", async () => {
			const { manager } = testEnv;
			manager.spawn("root", { prompt: "Worker 1" });
			manager.spawn("root", { prompt: "Worker 2" });

			const tool = createManageSubagentsTool(manager);
			const result = await tool.execute({ action: "list" });

			expect(result.isError).toBe(false);
			const parsed = JSON.parse(result.result);
			expect(parsed.success).toBe(true);
			expect(parsed.subagents.length).toBe(2);
		});

		it("TOOL-10: performs 'status' action for a specific subagent", async () => {
			const { manager } = testEnv;
			const child = manager.spawn("root", { prompt: "Worker" });

			const tool = createManageSubagentsTool(manager);
			const result = await tool.execute({ action: "status", subagentId: child.id });

			expect(result.isError).toBe(false);
			const parsed = JSON.parse(result.result);
			expect(parsed.success).toBe(true);
			expect(parsed.status.id).toBe(child.id);
			expect(parsed.status.state).toBeDefined();
		});

		it("TOOL-11: performs 'logs' action returning audit log entries", async () => {
			const { manager } = testEnv;
			const child = manager.spawn("root", { prompt: "Worker" });

			const tool = createManageSubagentsTool(manager);
			const result = await tool.execute({ action: "logs", subagentId: child.id });

			expect(result.isError).toBe(false);
			const parsed = JSON.parse(result.result);
			expect(parsed.success).toBe(true);
			expect(Array.isArray(parsed.logs)).toBe(true);
			expect(parsed.logs.length).toBeGreaterThan(0);
		});

		it("TOOL-12: performs 'terminate' action halting active subagent", async () => {
			const { manager } = testEnv;
			const child = manager.spawn("root", { prompt: "Worker" });

			const tool = createManageSubagentsTool(manager);
			const result = await tool.execute({ action: "terminate", subagentId: child.id });

			expect(result.isError).toBe(false);
			const parsed = JSON.parse(result.result);
			expect(parsed.success).toBe(true);
			expect(parsed.terminated).toBe(true);
			expect(child.state).toBe("terminated");
		});

		it("TOOL-13: returns error when subagentId is missing for status/logs/terminate", async () => {
			const { manager } = testEnv;
			const tool = createManageSubagentsTool(manager);

			const res1 = await tool.execute({ action: "status" });
			expect(res1.isError).toBe(true);

			const res2 = await tool.execute({ action: "logs" });
			expect(res2.isError).toBe(true);

			const res3 = await tool.execute({ action: "terminate" });
			expect(res3.isError).toBe(true);
		});
	});

	describe("define_subagent Tool", () => {
		it("TOOL-14: dynamically defines a new subagent type", async () => {
			const { typeRegistry } = testEnv;
			const tool = createDefineSubagentTool(typeRegistry);

			const result = await tool.execute({
				name: "sql-optimizer",
				description: "Specialized in query performance and database indexing",
				systemPrompt: "You are a database performance expert.",
				allowedTools: ["read_file", "grep_search"],
				mode: "plan",
			});

			expect(result.isError).toBe(false);
			expect(result.result).toContain('Successfully registered subagent type "sql-optimizer"');
			expect(typeRegistry.has("sql-optimizer")).toBe(true);
		});

		it("TOOL-15: immediately invokes newly defined custom subagent", async () => {
			const { manager, typeRegistry, provider } = testEnv;
			const defineTool = createDefineSubagentTool(typeRegistry);
			const invokeTool = createInvokeSubagentTool(manager, "parent");

			await defineTool.execute({
				name: "graphql-specialist",
				description: "Designs GraphQL schemas",
				systemPrompt: "You are a GraphQL schema designer.",
			});

			provider.queueResponse({
				content: [{ type: "text", text: "GraphQL schema designed." }],
			});

			const invokeResult = await invokeTool.execute({
				type: "graphql-specialist",
				prompt: "Design User queries",
			});

			expect(invokeResult.isError).toBe(false);
			expect(invokeResult.result).toContain("GraphQL schema designed.");
		});
	});

	describe("Tool Registration & Schemas", () => {
		it("TOOL-16: registers all 4 subagent tools into ToolRegistry", () => {
			const { manager, typeRegistry } = testEnv;
			const targetRegistry = new ToolRegistry();

			registerSubagentTools(targetRegistry, manager, typeRegistry, "parent");

			const registeredNames = targetRegistry.list();
			expect(registeredNames).toContain("invoke_subagent");
			expect(registeredNames).toContain("send_message");
			expect(registeredNames).toContain("manage_subagents");
			expect(registeredNames).toContain("define_subagent");

			const definitions = targetRegistry.getDefinitions();
			expect(definitions.length).toBe(4);
			for (const def of definitions) {
				expect(def.name).toBeDefined();
				expect(def.description).toBeDefined();
				expect(def.inputSchema).toBeDefined();
			}
		});
	});
});
