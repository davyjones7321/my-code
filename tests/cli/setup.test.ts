import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadDotEnvFiles } from "../../src/config/index.ts";
import { ProviderRegistry } from "../../src/providers/registry.ts";

describe("Phase 15: 3-Tier .env Loader & Setup Suite", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "harness-env-test-"));
	});

	afterEach(async () => {
		await fs.promises.rm(tempDir, { recursive: true, force: true });
	});

	it("should parse .env files and populate process.env", () => {
		const envFile = path.join(tempDir, ".env");
		fs.writeFileSync(envFile, 'OPENROUTER_API_KEY="sk-test-12345"\nCUSTOM_TEST_VAR="hello_world"\n');

		loadDotEnvFiles(tempDir);

		expect(process.env.OPENROUTER_API_KEY).toBe("sk-test-12345");
		expect(process.env.CUSTOM_TEST_VAR).toBe("hello_world");
	});

	it("should auto-detect environment variables in ProviderRegistry.fromConfig()", () => {
		process.env.OPENROUTER_API_KEY = "sk-or-test-auto";

		const registry = ProviderRegistry.fromConfig({
			defaultProvider: "default",
			approvalMode: "auto",
			maxIterations: 50,
			projectRoot: tempDir,
		});

		const providers = registry.list();
		expect(providers).toContain("openrouter");
		expect(registry.get("openrouter")).toBeDefined();
	});
});
