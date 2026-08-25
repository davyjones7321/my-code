import { describe, expect, it } from "bun:test";
import { CloudflareProvider } from "../../src/providers/cloudflare.ts";
import { ProviderRegistry } from "../../src/providers/registry.ts";

describe("Cloudflare Workers AI Provider Suite", () => {
	it("should construct CloudflareProvider with formatted OpenAI-compatible endpoint", () => {
		const provider = new CloudflareProvider("test-token", "account-123");
		expect(provider.name).toBe("cloudflare");
	});

	it("should auto-detect CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in ProviderRegistry", () => {
		process.env.CLOUDFLARE_API_TOKEN = "cf-token-abc";
		process.env.CLOUDFLARE_ACCOUNT_ID = "cf-account-xyz";

		const registry = ProviderRegistry.fromConfig({
			defaultProvider: "cloudflare",
			approvalMode: "auto",
			maxIterations: 50,
			projectRoot: ".",
		});

		expect(registry.list()).toContain("cloudflare");
		const cf = registry.get("cloudflare");
		expect(cf).toBeInstanceOf(CloudflareProvider);
	});
});
