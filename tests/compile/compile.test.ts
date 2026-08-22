import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { formatBuildInfo, getBuildInfo } from "../../src/cli/build-info.ts";

describe("Phase 14: Packaging & Build Info Suite", () => {
	it("should return valid build metadata from getBuildInfo()", () => {
		const info = getBuildInfo();
		expect(info.version).toBe("0.1.0");
		expect(info.name).toBe("my-harness");
		expect(info.platform).toBe(process.platform);
		expect(info.arch).toBe(process.arch);
		expect(info.bunVersion).toBe(Bun.version);
		expect(info.features.agentLoop).toBe(true);
		expect(info.features.fts5Memory).toBe(true);
		expect(info.features.gatewayServer).toBe(true);
		expect(info.features.cronScheduler).toBe(true);
		expect(info.features.selfHealingVerifier).toBe(true);
	});

	it("should format build info cleanly for CLI output", () => {
		const info = getBuildInfo();
		const formatted = formatBuildInfo(info);
		expect(formatted).toContain("my-harness v0.1.0");
		expect(formatted).toContain("Platform/Arch:");
		expect(formatted).toContain("Bun Engine:");
		expect(formatted).toContain("Integrated Features (Phases 0–14):");
	});

	it("should compile standalone binary using scripts/compile.ts", async () => {
		const { compileBinary } = await import("../../scripts/compile.ts");
		const res = await compileBinary({ outDir: "dist-test" });

		expect(res.success).toBe(true);
		expect(res.outFiles.length).toBe(1);

		const binaryPath = res.outFiles[0];
		expect(fs.existsSync(binaryPath)).toBe(true);

		// Clean up test dist directory
		fs.rmSync(path.dirname(binaryPath), { recursive: true, force: true });
	});
});
