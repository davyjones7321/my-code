import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Message } from "../../src/agent/types.ts";
import { MemoryAPI } from "../../src/memory/api.ts";
import { MemoryStore } from "../../src/memory/store.ts";

describe("MemoryAPI", () => {
	let dbPath: string;
	let store: MemoryStore;
	let api: MemoryAPI;

	beforeEach(() => {
		dbPath = path.join(os.tmpdir(), `harness-test-api-${Date.now()}-${Math.random()}.db`);
		store = new MemoryStore(dbPath);
		api = new MemoryAPI(store);
	});

	afterEach(() => {
		try {
			store.close();
			if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
			const wal = dbPath + "-wal";
			const shm = dbPath + "-shm";
			if (fs.existsSync(wal)) fs.unlinkSync(wal);
			if (fs.existsSync(shm)) fs.unlinkSync(shm);
		} catch (e) {}
	});

	it("remember stores a fact and returns confirmation message", () => {
		const res = api.remember("API Fact");
		expect(res.id).toBeGreaterThan(0);
		expect(res.message).toContain("Fact successfully remembered");
		expect(api.getStore().getFacts().length).toBe(1);
	});

	it("recall finds stored facts by keyword", () => {
		api.remember("API Fact blue");
		api.remember("API Fact red");
		const results = api.recall("blue");
		expect(results.length).toBe(1);
		expect(results[0]).toBe("API Fact blue");
	});

	it("recall returns empty for no matches", () => {
		api.remember("API Fact blue");
		const results = api.recall("green");
		expect(results.length).toBe(0);
	});

	it("summarizeSession without provider creates mechanical summary", async () => {
		const messages: Message[] = [
			{ role: "user", content: [{ type: "text", text: "Hello" }] },
			{
				role: "assistant",
				content: [
					{ type: "text", text: "Hi" },
					{ type: "tool_use", id: "1", name: "t1", input: {} },
				],
			},
			{ role: "user", content: [{ type: "text", text: "Bye" }] },
		];
		const summary = await api.summarizeSession("sess1", messages);
		expect(summary).toContain("2 user messages");
		expect(summary).toContain("t1");
		expect(summary).toContain("Hello");
		expect(summary).toContain("Bye");
	});

	it("summarizeSession bounds output to 500 chars", async () => {
		const longText = "A".repeat(600);
		const messages: Message[] = [{ role: "user", content: [{ type: "text", text: longText }] }];
		const summary = await api.summarizeSession("sess2", messages);
		expect(summary.length).toBeLessThanOrEqual(500);
	});

	it("getContextFacts returns relevant facts for current prompt", () => {
		api.remember("context fact 1");
		const facts = api.getContextFacts("context fact");
		expect(facts.length).toBe(1);
		expect(facts[0]).toBe("context fact 1");
	});
});
