import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { GatewayServer } from "../../src/gateway/server.ts";

describe("Gateway REST Routes Suite", () => {
	let gateway: GatewayServer;
	let serverUrl: string;

	beforeEach(async () => {
		gateway = new GatewayServer({ port: 0 });
		const { url } = await gateway.start();
		serverUrl = url;
	});

	afterEach(async () => {
		if (gateway && gateway.isRunning()) {
			await gateway.stop();
		}
	});

	it("should list registered providers and tools", async () => {
		const provRes = await fetch(`${serverUrl}/api/v1/providers`);
		expect(provRes.status).toBe(200);
		const provBody = (await provRes.json()) as any;
		expect(Array.isArray(provBody.providers)).toBe(true);

		const toolRes = await fetch(`${serverUrl}/api/v1/tools`);
		expect(toolRes.status).toBe(200);
		const toolBody = (await toolRes.json()) as any;
		expect(Array.isArray(toolBody.tools)).toBe(true);
		expect(toolBody.tools.length).toBeGreaterThan(0);
	});

	it("should create, list, inspect, and delete sessions via REST API", async () => {
		// 1. Create Session
		const createRes = await fetch(`${serverUrl}/api/v1/sessions`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ sessionName: "test-rest-session", mode: "plan" }),
		});
		expect(createRes.status).toBe(201);
		const createBody = (await createRes.json()) as any;
		expect(createBody.sessionId).toBeDefined();
		expect(createBody.state.mode).toBe("plan");

		const sessionId = createBody.sessionId;

		// 2. List Sessions
		const listRes = await fetch(`${serverUrl}/api/v1/sessions`);
		expect(listRes.status).toBe(200);
		const listBody = (await listRes.json()) as any;
		expect(listBody.sessions.length).toBe(1);
		expect(listBody.sessions[0].sessionId).toBe(sessionId);

		// 3. Inspect Session Detail
		const detailRes = await fetch(`${serverUrl}/api/v1/sessions/${sessionId}`);
		expect(detailRes.status).toBe(200);
		const detailBody = (await detailRes.json()) as any;
		expect(detailBody.sessionId).toBe(sessionId);
		expect(detailBody.turnsCount).toBe(0);

		// 4. Delete Session
		const delRes = await fetch(`${serverUrl}/api/v1/sessions/${sessionId}`, {
			method: "DELETE",
		});
		expect(delRes.status).toBe(200);

		// Verify deleted
		const listAfterRes = await fetch(`${serverUrl}/api/v1/sessions`);
		const listAfterBody = (await listAfterRes.json()) as any;
		expect(listAfterBody.sessions.length).toBe(0);
	});

	it("should return 404 for non-existent session ID", async () => {
		const res = await fetch(`${serverUrl}/api/v1/sessions/non-existent-session-id`);
		expect(res.status).toBe(404);
	});
});
