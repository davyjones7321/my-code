import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import * as path from "node:path";

describe("CLI Entrypoint", () => {
	it("outputs a semver version string", () => {
		const cliPath = path.resolve(process.cwd(), "src/cli/index.ts");
		const result = spawnSync(
			"C:\\Users\\DavyJ\\.bun\\bin\\bun.exe",
			["run", cliPath, "--version"],
			{ encoding: "utf-8" },
		);

		expect(result.status).toBe(0);
		expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
	}, 30000);
});
