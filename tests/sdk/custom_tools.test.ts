import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { Harness } from "../../src/sdk/harness.ts";
import type { Tool } from "../../src/tools/registry.ts";
import { MockSDKProvider, createMockTool } from "./test-helpers.ts";

describe("SDK Tier 1-4: Custom Tools Integration Suite", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-custom-tools-test-"));
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

	it("T-01: should register custom tool at Harness level and execute it during agent turn", async () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const provider = new MockSDKProvider("custom-tool-provider");

		provider.queueToolCallResponse("db_query", { table: "users", limit: 5 }, "call_db_1");
		provider.queueTextResponse("Found 5 users in database.");

		let dbToolExecuted = false;
		const dbTool = createMockTool(
			"db_query",
			async (input) => {
				dbToolExecuted = true;
				expect(input.table).toBe("users");
				expect(input.limit).toBe(5);
				return {
					result: JSON.stringify([{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }]),
					isError: false,
				};
			},
			{
				description: "Query internal database",
				properties: {
					table: { type: "string" },
					limit: { type: "number" },
				},
				required: ["table"],
			},
		);

		harness.registerProvider(provider);
		harness.registerTool(dbTool);

		const session = harness.createSession({
			providerName: "custom-tool-provider",
			approvalMode: "yolo",
		});

		const result = await session.send("Query the users table");
		expect(dbToolExecuted).toBe(true);
		expect(result.response).toContain("Found 5 users");
	});

	it("T-02: should register custom tool at session level via options.tools", async () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const provider = new MockSDKProvider("session-tool-provider");

		provider.queueToolCallResponse("session_specific_tool", { flag: true }, "call_s1");
		provider.queueTextResponse("Session tool executed successfully.");

		let sessionToolRun = false;
		const sessionTool: Tool = {
			name: "session_specific_tool",
			description: "Tool exclusive to this session",
			inputSchema: {
				type: "object",
				properties: { flag: { type: "boolean" } },
			},
			execute: async (input) => {
				sessionToolRun = true;
				return { result: `Flag was: ${input.flag}`, isError: false };
			},
		};

		harness.registerProvider(provider);

		const session = harness.createSession({
			providerName: "session-tool-provider",
			tools: [sessionTool],
			approvalMode: "yolo",
		});

		const result = await session.send("Execute session specific tool");
		expect(sessionToolRun).toBe(true);
		expect(result.response).toBe("Session tool executed successfully.");
	});

	it("T-03: should validate schema and pass complex nested JSON arguments accurately", async () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const provider = new MockSDKProvider("complex-args-provider");

		const inputPayload = {
			config: {
				retries: 3,
				tags: ["urgent", "prod"],
			},
			metadata: {
				author: "engineer",
				enabled: true,
			},
		};

		provider.queueToolCallResponse("deploy_service", inputPayload, "call_dep_1");
		provider.queueTextResponse("Deployment complete with 3 retries.");

		let receivedInput: any = null;
		const deployTool = createMockTool(
			"deploy_service",
			async (input) => {
				receivedInput = input;
				return { result: "Deployment initialized", isError: false };
			},
			{
				description: "Deploy service tool",
				properties: {
					config: { type: "object" },
					metadata: { type: "object" },
				},
			},
		);

		harness.registerProvider(provider);
		harness.registerTool(deployTool);

		const session = harness.createSession({
			providerName: "complex-args-provider",
			approvalMode: "yolo",
		});

		await session.send("Deploy the service");
		expect(receivedInput).toEqual(inputPayload);
		expect(receivedInput.config.tags).toContain("urgent");
	});

	it("T-04: should handle custom tools returning both string and structured JSON results", async () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const provider = new MockSDKProvider("json-tool-provider");

		provider.queueToolCallResponse("json_producer", {}, "call_json_1");
		provider.queueTextResponse("JSON handled cleanly.");

		const jsonTool = createMockTool("json_producer", async () => ({
			result: JSON.stringify({ status: 200, items: [10, 20, 30] }),
			isError: false,
		}));

		harness.registerProvider(provider);
		harness.registerTool(jsonTool);

		const session = harness.createSession({
			providerName: "json-tool-provider",
			approvalMode: "yolo",
		});

		const result = await session.send("Produce json");
		expect(result.events.some((e) => e.type === "tool_result" && (e as any).result.includes("status"))).toBe(true);
	});

	it("T-05: should propagate custom tool error results ({ isError: true }) to provider", async () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const provider = new MockSDKProvider("tool-error-provider");

		provider.queueToolCallResponse("failing_tool", { param: "bad" }, "call_fail_1");
		provider.queueResponse((messages) => {
			const toolResultMsg = messages.find((m) =>
				m.content.some((c) => c.type === "tool_result" && (c as any).isError),
			);
			return {
				content: [
					{
						type: "text",
						text: toolResultMsg
							? "Recovered from tool error: Invalid parameter"
							: "Tool error not detected",
					},
				],
				usage: { inputTokens: 20, outputTokens: 10 },
			};
		});

		const failingTool = createMockTool("failing_tool", async () => ({
			result: "Invalid parameter provided",
			isError: true,
		}));

		harness.registerProvider(provider);
		harness.registerTool(failingTool);

		const session = harness.createSession({
			providerName: "tool-error-provider",
			approvalMode: "yolo",
		});

		const result = await session.send("Run failing tool");
		expect(result.response).toContain("Recovered from tool error");
	});

	it("T-06: should safely catch uncaught exceptions thrown inside tool execute() and convert to isError", async () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const provider = new MockSDKProvider("throw-tool-provider");

		provider.queueToolCallResponse("crash_tool", {}, "call_crash_1");
		provider.queueTextResponse("Handled crash safely.");

		const crashTool = createMockTool("crash_tool", async () => {
			throw new Error("Fatal network socket disconnection in custom tool");
		});

		harness.registerProvider(provider);
		harness.registerTool(crashTool);

		const session = harness.createSession({
			providerName: "throw-tool-provider",
			approvalMode: "yolo",
		});

		const result = await session.send("Run crash tool");
		expect(result.response).toBe("Handled crash safely.");
		const toolResultEv = result.events.find((e) => e.type === "tool_result") as any;
		expect(toolResultEv).toBeDefined();
		expect(toolResultEv.isError).toBe(true);
		expect(toolResultEv.result).toContain("Fatal network socket");
	});

	// ==========================================
	// TIER 2: BOUNDARY & ERROR CONDITIONS
	// ==========================================

	it("T-07: should support custom tool with empty input schema and no parameters", async () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const provider = new MockSDKProvider("no-param-provider");

		provider.queueToolCallResponse("get_timestamp", {}, "call_ts_1");
		provider.queueTextResponse("Current time received.");

		const timestampTool: Tool = {
			name: "get_timestamp",
			description: "Returns server timestamp",
			inputSchema: { type: "object", properties: {} },
			execute: async () => ({
				result: "2026-08-20T12:00:00Z",
				isError: false,
			}),
		};

		harness.registerProvider(provider);
		harness.registerTool(timestampTool);

		const session = harness.createSession({
			providerName: "no-param-provider",
			approvalMode: "yolo",
		});

		const result = await session.send("What time is it?");
		expect(result.response).toBe("Current time received.");
	});

	it("T-08: should handle tool returning empty string gracefully", async () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const provider = new MockSDKProvider("empty-result-provider");

		provider.queueToolCallResponse("empty_result_tool", {}, "call_empty_1");
		provider.queueTextResponse("Received empty result.");

		const emptyTool = createMockTool("empty_result_tool", async () => ({
			result: "",
			isError: false,
		}));

		harness.registerProvider(provider);
		harness.registerTool(emptyTool);

		const session = harness.createSession({
			providerName: "empty-result-provider",
			approvalMode: "yolo",
		});

		const result = await session.send("Call empty tool");
		expect(result.response).toBe("Received empty result.");
	});

	// ==========================================
	// TIER 3: CROSS-FEATURE COMBINATIONS
	// ==========================================

	it("T-09: should execute a multi-tool chain across iterations in a single turn", async () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const provider = new MockSDKProvider("chain-provider");

		// Step 1: LLM calls tool 1
		provider.queueToolCallResponse("fetch_user_id", { username: "charlie" }, "call_u1");
		// Step 2: LLM calls tool 2 with id from tool 1
		provider.queueToolCallResponse("fetch_user_orders", { userId: "usr_99" }, "call_o1");
		// Step 3: LLM outputs final response
		provider.queueTextResponse("Charlie has 2 active orders.");

		const userTool = createMockTool("fetch_user_id", async () => ({
			result: "usr_99",
			isError: false,
		}));

		const ordersTool = createMockTool("fetch_user_orders", async (input) => ({
			result: `Orders for ${input.userId}: [Order #101, Order #102]`,
			isError: false,
		}));

		harness.registerProvider(provider);
		harness.registerTool(userTool);
		harness.registerTool(ordersTool);

		const session = harness.createSession({
			providerName: "chain-provider",
			approvalMode: "yolo",
		});

		const result = await session.send("Get orders for charlie");
		expect(result.response).toBe("Charlie has 2 active orders.");

		const toolCalls = result.events.filter((e) => e.type === "tool_call");
		expect(toolCalls.length).toBe(2);
		expect((toolCalls[0] as any).toolName).toBe("fetch_user_id");
		expect((toolCalls[1] as any).toolName).toBe("fetch_user_orders");
	});

	// ==========================================
	// TIER 4: REAL-WORLD SCENARIOS
	// ==========================================

	it("T-10: should support enterprise data analytics workflow with custom tools", async () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const provider = new MockSDKProvider("analytics-provider");

		// Agent queries revenue -> calculates growth -> formats report
		provider.queueToolCallResponse("query_financials", { quarter: "Q3" }, "c_fin");
		provider.queueToolCallResponse("calculate_growth", { prev: 100000, curr: 125000 }, "c_calc");
		provider.queueTextResponse("Executive Summary: Q3 revenue reached $125,000, representing 25% QoQ growth.");

		const finTool = createMockTool("query_financials", async () => ({
			result: JSON.stringify({ revenue: 125000, expenses: 80000 }),
			isError: false,
		}));

		const calcTool = createMockTool("calculate_growth", async (input) => ({
			result: `${((input.curr - input.prev) / input.prev) * 100}%`,
			isError: false,
		}));

		harness.registerProvider(provider);
		harness.registerTool(finTool);
		harness.registerTool(calcTool);

		const session = harness.createSession({
			providerName: "analytics-provider",
			approvalMode: "yolo",
		});

		const result = await session.send("Generate Q3 financial performance report");
		expect(result.response).toContain("25% QoQ growth");
		expect(session.getTurns().length).toBe(1);
	});
});
