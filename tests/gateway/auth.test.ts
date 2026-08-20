import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { GatewayServer } from "../../src/gateway/server.ts";

describe("Gateway Authentication Suite", () => {
	let gateway: GatewayServer;
	let serverUrl: string;
	const secretToken = "super-secret-token-123";

	beforeEach(async () => {
		gateway = new GatewayServer({
			port: 0,
			authToken: secretToken,
		});
		const { url } = await gateway.start();
		serverUrl = url;
	});

	afterEach(async () => {
		if (gateway && gateway.isRunning()) {
			await gateway.stop();
		}
	});

	it("should allow /health endpoint without token", async () => {
		const res = await fetch(`${serverUrl}/health`);
		expect(res.status).toBe(200);
	});

	it("should reject unauthenticated requests to /api/v1/sessions with 401", async () => {
		const res = await fetch(`${serverUrl}/api/v1/sessions`);
		expect(res.status).toBe(401);

		const body = (await res.json()) as any;
		expect(body.error).toContain("Unauthorized");
	});

	it("should authenticate requests using Authorization Bearer header", async () => {
		const res = await fetch(`${serverUrl}/api/v1/sessions`, {
			headers: { Authorization: `Bearer ${secretToken}` },
		});
		expect(res.status).toBe(200);
	});

	it("should authenticate requests using ?token= query parameter", async () => {
		const res = await fetch(`${serverUrl}/api/v1/sessions?token=${secretToken}`);
		expect(res.status).toBe(200);
	});

	it("should reject incorrect bearer token with 401", async () => {
		const res = await fetch(`${serverUrl}/api/v1/sessions`, {
			headers: { Authorization: "Bearer wrong-token" },
		});
		expect(res.status).toBe(401);
	});
});
