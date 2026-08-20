import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { GatewayServer } from "../../src/gateway/server.ts";

describe("Gateway Server-Sent Events (SSE) Suite", () => {
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

	it("should open SSE stream and receive connection establishment event", async () => {
		// Create session
		const createRes = await fetch(`${serverUrl}/api/v1/sessions`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ sessionName: "sse-session" }),
		});
		const { sessionId } = (await createRes.json()) as any;

		// Connect to SSE stream
		const sseRes = await fetch(`${serverUrl}/api/v1/sessions/${sessionId}/stream`);
		expect(sseRes.status).toBe(200);
		expect(sseRes.headers.get("Content-Type")).toContain("text/event-stream");

		const reader = sseRes.body?.getReader();
		expect(reader).toBeDefined();

		const { value } = await reader!.read();
		const text = new TextDecoder().decode(value);
		expect(text).toContain("event: connected");
		expect(text).toContain(sessionId);

		reader?.cancel();
	});
});
