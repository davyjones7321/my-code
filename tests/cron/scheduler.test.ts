import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CronScheduler } from "../../src/cron/scheduler.ts";
import { ScheduleStore } from "../../src/cron/store.ts";
import type { ScheduleEvent } from "../../src/cron/types.ts";

describe("Phase 12: CronScheduler Engine", () => {
	let tempDir: string;
	let storagePath: string;
	let store: ScheduleStore;
	let scheduler: CronScheduler;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-sched-test-"));
		storagePath = path.join(tempDir, ".harness", "schedules.json");
		store = new ScheduleStore({ storagePath });
	});

	afterEach(() => {
		scheduler?.stop();
		try {
			fs.rmSync(tempDir, { recursive: true, force: true });
		} catch {}
	});

	it("should initialize with correct default state", () => {
		scheduler = new CronScheduler({ store });
		expect(scheduler.isRunning()).toBe(false);
		expect(scheduler.listSchedules().length).toBe(0);
	});

	it("should start, stop, and report running status", async () => {
		scheduler = new CronScheduler({ store });
		await scheduler.start();
		expect(scheduler.isRunning()).toBe(true);

		scheduler.stop();
		expect(scheduler.isRunning()).toBe(false);
	});

	it("should execute a one-shot timer job and mark completed", async () => {
		let executedPrompt = "";
		scheduler = new CronScheduler({
			store,
			turnRunner: async (prompt) => {
				executedPrompt = prompt;
				return "Turn finished successfully";
			},
		});

		await scheduler.start();

		const events: ScheduleEvent[] = [];
		scheduler.on("*", (e) => events.push(e));

		const job = await scheduler.scheduleTimer({
			duration: "25ms",
			prompt: "Check background logs",
		});

		expect(job.status).toBe("active");
		expect(job.type).toBe("timer");
		expect(job.maxRuns).toBe(1);

		// Wait for timer to execute
		await new Promise((r) => setTimeout(r, 300));

		const updated = scheduler.getSchedule(job.id);
		expect(updated).toBeDefined();
		expect(updated?.status).toBe("completed");
		expect(updated?.runCount).toBe(1);
		expect(updated?.lastOutput).toBe("Turn finished successfully");
		expect(executedPrompt).toBe("Check background logs");

		// Check events
		const eventTypes = events.map((e) => e.type);
		expect(eventTypes).toContain("scheduled");
		expect(eventTypes).toContain("trigger");
		expect(eventTypes).toContain("completed");
	});

	it("should schedule recurring cron jobs and support manual triggerNow", async () => {
		let callCount = 0;
		scheduler = new CronScheduler({
			store,
			turnRunner: async () => {
				callCount++;
				return `Run #${callCount}`;
			},
		});

		await scheduler.start();

		const cronJob = await scheduler.scheduleCron({
			cron: "*/5 * * * *",
			prompt: "Recurring health check",
		});

		expect(cronJob.status).toBe("active");
		expect(cronJob.type).toBe("cron");
		expect(cronJob.runCount).toBe(0);
		expect(cronJob.nextRunAt).toBeDefined();

		// Manually trigger
		const res1 = await scheduler.triggerNow(cronJob.id);
		expect(res1.success).toBe(true);
		expect(res1.output).toBe("Run #1");
		expect(cronJob.runCount).toBe(1);

		// Second manual trigger
		const res2 = await scheduler.triggerNow(cronJob.id);
		expect(res2.success).toBe(true);
		expect(res2.output).toBe("Run #2");
		expect(cronJob.runCount).toBe(2);
		expect(cronJob.status).toBe("active"); // Recurring remains active
	});

	it("should respect maxRuns limit on recurring cron jobs", async () => {
		scheduler = new CronScheduler({
			store,
			turnRunner: async () => "Job output",
		});

		await scheduler.start();

		const cronJob = await scheduler.scheduleCron({
			cron: "* * * * *",
			prompt: "Limited run job",
			maxRuns: 2,
		});

		await scheduler.triggerNow(cronJob.id);
		expect(cronJob.runCount).toBe(1);
		expect(cronJob.status).toBe("active");

		await scheduler.triggerNow(cronJob.id);
		expect(cronJob.runCount).toBe(2);
		expect(cronJob.status).toBe("completed");
	});

	it("should isolate execution errors without crashing or unhandled rejections", async () => {
		scheduler = new CronScheduler({
			store,
			turnRunner: async () => {
				throw new Error("Simulated LLM network timeout");
			},
		});

		await scheduler.start();

		const events: ScheduleEvent[] = [];
		scheduler.on("error", (e) => events.push(e));

		const job = await scheduler.scheduleTimer({
			duration: "20ms",
			prompt: "Failing task",
		});

		// Wait for timer to fire and catch error
		await new Promise((r) => setTimeout(r, 300));

		const updated = scheduler.getSchedule(job.id);
		expect(updated).toBeDefined();
		expect(updated?.errorCount).toBe(1);
		expect(updated?.lastError).toContain("Simulated LLM network timeout");

		expect(events.length).toBe(1);
		expect(events[0].error?.message).toContain("Simulated LLM network timeout");
	});

	it("should safely isolate errors thrown by event listeners", async () => {
		scheduler = new CronScheduler({
			store,
			turnRunner: async () => "success",
		});

		await scheduler.start();

		// Add throwing listener
		scheduler.on("trigger", () => {
			throw new Error("Faulty external listener exception");
		});

		let secondListenerCalled = false;
		scheduler.on("trigger", () => {
			secondListenerCalled = true;
		});

		await scheduler.scheduleTimer({
			duration: "10ms",
			prompt: "Listener isolation test",
		});

		await new Promise((r) => setTimeout(r, 300));

		expect(secondListenerCalled).toBe(true);
	});

	it("should support pause and resume lifecycle", async () => {
		scheduler = new CronScheduler({ store });
		await scheduler.start();

		const job = await scheduler.scheduleCron({
			cron: "0 * * * *",
			prompt: "Hourly report",
		});

		expect(job.status).toBe("active");

		// Pause
		const paused = await scheduler.pauseSchedule(job.id);
		expect(paused).toBe(true);
		expect(job.status).toBe("paused");
		expect(job.nextRunAt).toBeUndefined();

		// Resume
		const resumed = await scheduler.resumeSchedule(job.id);
		expect(resumed).toBe(true);
		expect(job.status).toBe("active");
		expect(job.nextRunAt).toBeDefined();
	});

	it("should support cancel lifecycle", async () => {
		scheduler = new CronScheduler({ store });
		await scheduler.start();

		const job = await scheduler.scheduleTimer({
			duration: "1h",
			prompt: "Cancelable reminder",
		});

		expect(job.status).toBe("active");

		const cancelled = await scheduler.cancelSchedule(job.id);
		expect(cancelled).toBe(true);
		expect(job.status).toBe("cancelled");

		const nonExistent = await scheduler.cancelSchedule("non_existent_id");
		expect(nonExistent).toBe(false);
	});

	it("should reload active persistent jobs across restarts", async () => {
		scheduler = new CronScheduler({ store });
		await scheduler.start();

		await scheduler.scheduleCron({
			id: "persistent_cron_1",
			cron: "0 0 * * *",
			prompt: "Daily summary",
		});

		await scheduler.scheduleTimer({
			id: "persistent_timer_1",
			duration: "2h",
			prompt: "Long timer",
		});

		scheduler.stop();

		// Create a second scheduler instance pointing to the same storage
		const scheduler2 = new CronScheduler({ store });
		await scheduler2.start();

		const reloadedSchedules = scheduler2.listSchedules();
		expect(reloadedSchedules.length).toBe(2);

		const cronJob = scheduler2.getSchedule("persistent_cron_1");
		expect(cronJob).toBeDefined();
		expect(cronJob?.status).toBe("active");
		expect(cronJob?.expression).toBe("0 0 * * *");

		const timerJob = scheduler2.getSchedule("persistent_timer_1");
		expect(timerJob).toBeDefined();
		expect(timerJob?.status).toBe("active");

		scheduler2.stop();
	});

	it("should prevent duplicate overlapping execution on the same job", async () => {
		let resolveTurn: (() => void) | undefined;
		const turnPromise = new Promise<void>((r) => {
			resolveTurn = r;
		});

		scheduler = new CronScheduler({
			store,
			turnRunner: async () => {
				await turnPromise;
				return "Done";
			},
		});

		await scheduler.start();

		const job = await scheduler.scheduleCron({
			cron: "* * * * *",
			prompt: "Long running task",
		});

		// Trigger first turn (starts running)
		const firstRunPromise = scheduler.triggerNow(job.id);

		// Trigger second turn while first is running
		const secondRunResult = await scheduler.triggerNow(job.id);
		expect(secondRunResult.success).toBe(false);
		expect(secondRunResult.error).toContain("Previous execution turn still in progress");

		resolveTurn?.();
		const firstRunResult = await firstRunPromise;
		expect(firstRunResult.success).toBe(true);
	});
});
