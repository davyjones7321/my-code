import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ScheduleStore } from "../../src/cron/store.ts";
import type { StoredSchedule } from "../../src/cron/types.ts";

describe("Phase 12: ScheduleStore Persistence", () => {
	let tempDir: string;
	let storagePath: string;
	let store: ScheduleStore;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-store-test-"));
		storagePath = path.join(tempDir, ".harness", "schedules.json");
		store = new ScheduleStore({ storagePath });
	});

	afterEach(() => {
		try {
			fs.rmSync(tempDir, { recursive: true, force: true });
		} catch {}
	});

	it("should return storage path", () => {
		expect(store.getStoragePath()).toBe(path.resolve(storagePath));
	});

	it("should return empty array when file does not exist", async () => {
		const schedules = await store.load();
		expect(schedules).toEqual([]);
	});

	it("should save and load schedules atomically", async () => {
		const sample: StoredSchedule = {
			id: "cron_test_1",
			name: "Test Cron",
			type: "cron",
			expression: "*/5 * * * *",
			prompt: "Check system health",
			status: "active",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			nextRunAt: new Date().toISOString(),
			runCount: 0,
			errorCount: 0,
		};

		await store.save([sample]);

		expect(fs.existsSync(storagePath)).toBe(true);

		const loaded = await store.load();
		expect(loaded.length).toBe(1);
		expect(loaded[0].id).toBe("cron_test_1");
		expect(loaded[0].expression).toBe("*/5 * * * *");
	});

	it("should recover gracefully when JSON file is corrupted", async () => {
		const dir = path.dirname(storagePath);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(storagePath, "{ corrupted json syntax !!", "utf-8");

		const loaded = await store.load();
		expect(loaded).toEqual([]);
	});

	it("should handle non-array JSON objects safely", async () => {
		const dir = path.dirname(storagePath);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(storagePath, JSON.stringify({ not: "an array" }), "utf-8");

		const loaded = await store.load();
		expect(loaded).toEqual([]);
	});

	it("should add and update schedules", async () => {
		const item1: StoredSchedule = {
			id: "timer_1",
			type: "timer",
			expression: "30s",
			prompt: "Run quick task",
			status: "active",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			runCount: 0,
			errorCount: 0,
		};

		await store.add(item1);
		let all = await store.load();
		expect(all.length).toBe(1);
		expect(all[0].id).toBe("timer_1");

		// Update
		const updated = await store.update("timer_1", {
			status: "completed",
			runCount: 1,
			lastOutput: "Done!",
		});
		expect(updated).not.toBeNull();
		expect(updated?.status).toBe("completed");
		expect(updated?.runCount).toBe(1);

		all = await store.load();
		expect(all[0].status).toBe("completed");
		expect(all[0].runCount).toBe(1);
		expect(all[0].lastOutput).toBe("Done!");
	});

	it("should return null when updating non-existent schedule", async () => {
		const result = await store.update("non_existent", { status: "paused" });
		expect(result).toBeNull();
	});

	it("should remove schedules by ID", async () => {
		const item: StoredSchedule = {
			id: "cron_to_remove",
			type: "cron",
			expression: "0 0 * * *",
			prompt: "Midnight job",
			status: "active",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			runCount: 0,
			errorCount: 0,
		};

		await store.add(item);
		expect((await store.load()).length).toBe(1);

		const removed = await store.remove("cron_to_remove");
		expect(removed).toBe(true);
		expect((await store.load()).length).toBe(0);

		const removeAgain = await store.remove("cron_to_remove");
		expect(removeAgain).toBe(false);
	});

	it("should get single schedule by ID", async () => {
		const item: StoredSchedule = {
			id: "sched_lookup",
			type: "timer",
			expression: "10m",
			prompt: "Lookup test",
			status: "active",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			runCount: 0,
			errorCount: 0,
		};

		await store.add(item);

		const found = await store.get("sched_lookup");
		expect(found).not.toBeNull();
		expect(found?.id).toBe("sched_lookup");

		const missing = await store.get("does_not_exist");
		expect(missing).toBeNull();
	});

	it("should list schedules with optional predicate filtering", async () => {
		const item1: StoredSchedule = {
			id: "active_1",
			type: "cron",
			expression: "*/5 * * * *",
			prompt: "Active task",
			status: "active",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			runCount: 0,
			errorCount: 0,
		};
		const item2: StoredSchedule = {
			id: "paused_1",
			type: "timer",
			expression: "1h",
			prompt: "Paused task",
			status: "paused",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			runCount: 0,
			errorCount: 0,
		};

		await store.add(item1);
		await store.add(item2);

		const activeOnly = await store.list((s) => s.status === "active");
		expect(activeOnly.length).toBe(1);
		expect(activeOnly[0].id).toBe("active_1");

		const timersOnly = await store.list((s) => s.type === "timer");
		expect(timersOnly.length).toBe(1);
		expect(timersOnly[0].id).toBe("paused_1");
	});

	it("should clear all stored schedules", async () => {
		await store.add({
			id: "s1",
			type: "cron",
			expression: "* * * * *",
			prompt: "p1",
			status: "active",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			runCount: 0,
			errorCount: 0,
		});

		expect((await store.load()).length).toBe(1);

		await store.clear();
		expect((await store.load()).length).toBe(0);
	});
});
