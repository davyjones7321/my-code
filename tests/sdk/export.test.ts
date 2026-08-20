import { describe, expect, it } from "bun:test";
import * as rootExports from "../../src/index.ts";
import { Harness } from "../../src/index.ts";
import { HarnessSession } from "../../src/index.ts";

describe("SDK Tier 1: Package Export & Resolution Suite", () => {
	it("EXP-01: should export Harness and HarnessSession from package entrypoint", () => {
		expect(Harness).toBeDefined();
		expect(typeof Harness).toBe("function");

		expect(HarnessSession).toBeDefined();
		expect(typeof HarnessSession).toBe("function");
	});

	it("EXP-02: should expose all expected runtime classes and utilities from root barrel", () => {
		expect(rootExports.Harness).toBeDefined();
		expect(rootExports.HarnessSession).toBeDefined();
	});

	it("EXP-03: should allow instantiation of Harness directly from root export", () => {
		const harness = new rootExports.Harness({
			loadDiskConfig: false,
		});

		expect(harness).toBeInstanceOf(rootExports.Harness);
		expect(harness.listTools().length).toBeGreaterThan(0);
	});
});
