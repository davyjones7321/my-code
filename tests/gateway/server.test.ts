import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { GatewayServer } from "../../src/gateway/server.ts";

describe("GatewayServer Lifecycle Suite", () => {
	let gateway: GatewayServer;

	beforeEach(() => {
		gateway = new GatewayServer({ port: 0 }); // Random free port
	});

	afterEach(async () => {
		if (gateway && gateway.isRunning()) {
			await gateway.stop();
		}
	});

	it("should initialize GatewayServer with default configuration", () => {
		expect(gateway).toBeDefined();
		expect(gateway.isRunning()).toBe(false);
	});

	it("should start and stop GatewayServer cleanly on assigned port", async () => {
		const { port, url } = await gateway.start();
		expect(gateway.isRunning()).toBe(true);
		expect(port).toBeGreaterThan(0);
		expect(url).toContain(String(port));

		// Query public health endpoint
		const res = await fetch(`${url}/health`);
		expect(res.status).toBe(200);

		const body = (await res.json()) as any;
		expect(body.status).toBe("ok");
		expect(body.gateway).toBe("my-harness-gateway");
		expect(body.version).toBe("0.1.0");

		// Stop server
		await gateway.stop();
		expect(gateway.isRunning()).toBe(false);
	});
});
