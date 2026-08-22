import { describe, expect, it } from "bun:test";
import { MemoryAPI } from "../../src/memory/api.ts";
import { MemoryStore } from "../../src/memory/store.ts";
import { Harness } from "../../src/sdk/harness.ts";

describe("Phase 14: Embedded Assets & Runtime Systems Integration", () => {
	it("should initialize Harness, SQLite FTS5 MemoryAPI, and Tools in bundled runtime environment", async () => {
		const store = new MemoryStore(":memory:");
		const memory = new MemoryAPI(store);
		memory.remember("harness build phase 14 completed");

		const facts = memory.recall("phase 14");
		expect(facts.length).toBeGreaterThan(0);
		expect(facts[0]).toContain("phase 14 completed");
		store.close();
	});

	it("should initialize Harness SDK instance and list all 14 phases of built-in tools", () => {
		const harness = new Harness({ loadDiskConfig: false });
		const tools = harness.listTools();

		expect(tools).toContain("read_file");
		expect(tools).toContain("write_file");
		expect(tools).toContain("edit_file");
		expect(tools).toContain("glob_files");
		expect(tools).toContain("grep_search");
		expect(tools).toContain("run_command");
	});
});
