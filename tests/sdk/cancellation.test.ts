import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { Harness } from "../../src/sdk/harness.ts";
import { Deferred, MockSDKProvider, createMockTool } from "./test-helpers.ts";

describe("SDK Tier 1-4: Cancellation & AbortSignal Suite", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-cancellation-test-"));
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

	it("C-01: should abort mid-turn execution when AbortSignal fires during send()", async () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const provider = new MockSDKProvider("abort-provider");

		const slowChatDeferred = new Deferred<any>();
		provider.queueResponse(async () => {
			return await slowChatDeferred.promise;
		});

		harness.registerProvider(provider);
		const session = harness.createSession({ providerName: "abort-provider" });

		const controller = new AbortController();

		const sendPromise = session.send("Long running task", { signal: controller.signal });

		// Trigger abort
		controller.abort(new Error("User cancelled operation"));

		// Settle provider promise
		slowChatDeferred.resolve({
			content: [{ type: "text", text: "Finished late" }],
			usage: { inputTokens: 5, outputTokens: 5 },
		});

		try {
			const result = await sendPromise;
			const hasErrorEvent = result.events.some((e) => e.type === "error");
			expect(hasErrorEvent).toBe(true);
		} catch (err: any) {
			expect(err).toBeDefined();
		}
	});

	it("C-02: should stop sendStream() generator when AbortSignal triggers", async () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const provider = new MockSDKProvider("stream-abort-provider");

		const controller = new AbortController();
		provider.queueToolCallResponse("step1", {}, "c1");
		provider.queueResponse(async () => {
			controller.abort();
			return {
				content: [{ type: "text", text: "Post abort response" }],
				usage: { inputTokens: 5, outputTokens: 5 },
			};
		});

		const stepTool = createMockTool("step1", async () => ({ result: "ok", isError: false }));

		harness.registerProvider(provider);
		harness.registerTool(stepTool);

		const session = harness.createSession({
			providerName: "stream-abort-provider",
			approvalMode: "yolo",
		});

		const yieldedEvents: any[] = [];
		try {
			for await (const ev of session.sendStream("Run stream", { signal: controller.signal })) {
				yieldedEvents.push(ev);
			}
		} catch (err: any) {
			expect(err).toBeDefined();
		}

		expect(yieldedEvents.some((e) => e.type === "error")).toBe(true);
	});

	it("C-03: should immediately record abort event and avoid provider calls if signal is pre-aborted", async () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const provider = new MockSDKProvider("pre-aborted-provider");

		harness.registerProvider(provider);
		const session = harness.createSession({ providerName: "pre-aborted-provider" });

		const controller = new AbortController();
		controller.abort(new Error("Pre-aborted signal"));

		try {
			const result = await session.send("Should never execute", { signal: controller.signal });
			expect(result.events.some((e) => e.type === "error")).toBe(true);
		} catch (err: any) {
			expect(err).toBeDefined();
		}

		expect(provider.getCallCount()).toBe(0);
	});

	it("C-04: session.abort() method should abort currently active execution", async () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const provider = new MockSDKProvider("session-abort-provider");

		const slowDeferred = new Deferred<any>();
		provider.queueResponse(async () => {
			return await slowDeferred.promise;
		});

		harness.registerProvider(provider);
		const session = harness.createSession({ providerName: "session-abort-provider" });

		const sendPromise = session.send("Start long process");

		// Trigger abort on session
		setTimeout(() => {
			session.abort();
			slowDeferred.resolve({ content: [{ type: "text", text: "Late" }] });
		}, 30);

		try {
			const result = await sendPromise;
			expect(result.events.some((e) => e.type === "error")).toBe(true);
		} catch (err: any) {
			expect(err).toBeDefined();
		}
	});

	// ==========================================
	// TIER 2: BOUNDARY & ERROR CONDITIONS
	// ==========================================

	it("C-05: should cancel during tool execution and prevent execution of remaining chain", async () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const provider = new MockSDKProvider("tool-abort-provider");

		const controller = new AbortController();

		provider.queueToolCallResponse("slow_tool", {}, "c_slow");
		provider.queueToolCallResponse("never_tool", {}, "c_never");
		provider.queueTextResponse("Done");

		let slowToolStarted = false;
		let neverToolExecuted = false;

		const slowTool = createMockTool("slow_tool", async () => {
			slowToolStarted = true;
			controller.abort();
			return { result: "slow tool completed", isError: false };
		});

		const neverTool = createMockTool("never_tool", async () => {
			neverToolExecuted = true;
			return { result: "never executed", isError: false };
		});

		harness.registerProvider(provider);
		harness.registerTool(slowTool);
		harness.registerTool(neverTool);

		const session = harness.createSession({
			providerName: "tool-abort-provider",
			approvalMode: "yolo",
		});

		try {
			await session.send("Execute chain", { signal: controller.signal });
		} catch {
			// Expected abort exception
		}

		expect(slowToolStarted).toBe(true);
		expect(neverToolExecuted).toBe(false);
	});

	it("C-06: should keep session in a valid state allowing subsequent turns after an abort", async () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const provider = new MockSDKProvider("recovery-provider");

		const deferred = new Deferred<any>();
		provider.queueResponse(async () => await deferred.promise);
		provider.queueTextResponse("Recovered clean response for turn 2");

		harness.registerProvider(provider);
		const session = harness.createSession({ providerName: "recovery-provider" });

		const controller = new AbortController();
		const abortedTurn = session.send("Turn 1 (will abort)", { signal: controller.signal });

		controller.abort();
		deferred.resolve({ content: [{ type: "text", text: "Late" }] });

		try {
			await abortedTurn;
		} catch {
			// Expected abort
		}

		// Subsequent turn should work normally!
		const turn2 = await session.send("Turn 2 (normal)");
		expect(turn2.response).toBe("Recovered clean response for turn 2");
	});

	it("C-07: calling session.abort() when no turn is active should be a no-op", () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const session = harness.createSession();

		expect(() => {
			session.abort();
			session.abort();
		}).not.toThrow();
	});

	// ==========================================
	// TIER 3 & 4: REAL-WORLD USER CANCELLATION SCENARIOS
	// ==========================================

	it("C-08: should handle user cancellation and subsequent retry in interactive application", async () => {
		const harness = new Harness({ loadDiskConfig: false, projectRoot: tempDir });
		const provider = new MockSDKProvider("web-app-provider");

		// User question 1: takes too long, user aborts
		const slow1 = new Deferred<any>();
		provider.queueResponse(async () => await slow1.promise);

		// User question 2: smaller question, responds immediately
		provider.queueTextResponse("Here is the quick summary you requested.");

		harness.registerProvider(provider);
		const session = harness.createSession({ providerName: "web-app-provider" });

		const userController = new AbortController();
		const req1 = session.send("Generate 100 pages of report", { signal: userController.signal });

		// User clicks 'Cancel' button in web UI
		userController.abort();
		slow1.resolve({ content: [{ type: "text", text: "Report generated" }] });

		try {
			const res1 = await req1;
			expect(res1.events.some((e) => e.type === "error")).toBe(true);
		} catch (err: any) {
			expect(err).toBeDefined();
		}

		// User types new prompt
		const req2 = await session.send("Give me a 1-sentence summary instead");
		expect(req2.response).toBe("Here is the quick summary you requested.");
	});
});
