import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { GatewayServer } from "../../src/gateway/server.ts";

describe("Gateway WebSocket Suite", () => {
	let gateway: GatewayServer;
	let serverUrl: string;
	let wsUrl: string;

	beforeEach(async () => {
		gateway = new GatewayServer({ port: 0 });
		const { port } = await gateway.start();
		serverUrl = `http://localhost:${port}`;
		wsUrl = `ws://localhost:${port}/api/v1/ws`;
	});

	afterEach(async () => {
		if (gateway && gateway.isRunning()) {
			await gateway.stop();
		}
	});

	it("should connect to /api/v1/ws and handle ping/pong protocol", async () => {
		const ws = new WebSocket(wsUrl);

		await new Promise<void>((resolve, reject) => {
			ws.onopen = () => resolve();
			ws.onerror = (err) => reject(err);
		});

		const messagePromise = new Promise<string>((resolve) => {
			ws.onmessage = (event) => resolve(String(event.data));
		});

		ws.send(JSON.stringify({ type: "ping" }));

		const replyText = await messagePromise;
		const reply = JSON.parse(replyText);
		expect(reply.type).toBe("pong");

		ws.close();
	});

	it("should send prompt over WebSocket and receive error if session not found", async () => {
		const ws = new WebSocket(wsUrl);

		await new Promise<void>((resolve) => {
			ws.onopen = () => resolve();
		});

		const messagePromise = new Promise<string>((resolve) => {
			ws.onmessage = (event) => resolve(String(event.data));
		});

		ws.send(
			JSON.stringify({
				type: "prompt",
				sessionId: "unknown-session-123",
				prompt: "Hello",
			}),
		);

		const replyText = await messagePromise;
		const reply = JSON.parse(replyText);
		expect(reply.type).toBe("error");
		expect(reply.error).toContain("not found");

		ws.close();
	});
});
