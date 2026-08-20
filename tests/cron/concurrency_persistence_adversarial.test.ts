import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CronScheduler } from "../../src/cron/scheduler.ts";
import { ScheduleStore } from "../../src/cron/store.ts";
import type { ScheduleEvent, StoredSchedule } from "../../src/cron/types.ts";

function waitForEvent<T>(
	register: (cb: (val: T) => void) => void,
	timeoutMs = 1500,
): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`Timed out waiting for event after ${timeoutMs}ms`));
		}, timeoutMs);
		register((val) => {
			clearTimeout(timer);
			resolve(val);
		});
	});
}

describe("Phase 12: Adversarial Concurrency & Persistence Verification", () => {
	let tempDir: string;
	let storagePath: string;
	let store: ScheduleStore;
	let scheduler: CronScheduler;
	let unhandledRejections: unknown[] = [];
	let uncaughtExceptions: unknown[] = [];

	const unhandledRejectionHandler = (reason: unknown) => {
		unhandledRejections.push(reason);
	};
	const uncaughtExceptionHandler = (err: unknown) => {
		uncaughtExceptions.push(err);
	};

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-adv-test-"));
		storagePath = path.join(tempDir, ".harness", "schedules.json");
		store = new ScheduleStore({ storagePath });
		unhandledRejections = [];
		uncaughtExceptions = [];
		process.on("unhandledRejection", unhandledRejectionHandler);
		process.on("uncaughtException", uncaughtExceptionHandler);
	});

	afterEach(() => {
		process.removeListener("unhandledRejection", unhandledRejectionHandler);
		process.removeListener("uncaughtException", uncaughtExceptionHandler);
		scheduler?.stop();
		try {
			fs.rmSync(tempDir, { recursive: true, force: true });
		} catch {}
	});

	// ==========================================
	// 1. CONCURRENCY STRESS
	// ==========================================
	describe("1. Concurrency Stress", () => {
		it("should handle sequential schedule additions and maintain in-memory catalog", async () => {
			scheduler = new CronScheduler({ store });
			await scheduler.start();

			for (let i = 0; i < 10; i++) {
				await scheduler.scheduleCron({
					id: `seq_cron_${i}`,
					cron: "*/10 * * * *",
					prompt: `Cron task ${i}`,
				});
				await scheduler.scheduleTimer({
					id: `seq_timer_${i}`,
					duration: `${100 + i * 10}ms`,
					prompt: `Timer task ${i}`,
				});
			}

			expect(scheduler.listSchedules().length).toBe(20);
			expect(unhandledRejections.length).toBe(0);
			expect(uncaughtExceptions.length).toBe(0);
		});

		it("should handle 20 simultaneous triggerNow calls on the same job with overlap locking", async () => {
			let runningCount = 0;
			let maxConcurrent = 0;

			scheduler = new CronScheduler({
				store,
				turnRunner: async () => {
					runningCount++;
					maxConcurrent = Math.max(maxConcurrent, runningCount);
					await new Promise((r) => setTimeout(r, 40));
					runningCount--;
					return "Done";
				},
			});
			await scheduler.start();

			const job = await scheduler.scheduleCron({
				id: "overlap_job",
				cron: "* * * * *",
				prompt: "Overlap test",
			});

			const triggers = Array.from({ length: 20 }, () => scheduler.triggerNow(job.id));
			const results = await Promise.all(triggers);

			const successes = results.filter((r) => r.success);
			const rejectedOverlaps = results.filter(
				(r) => !r.success && r.error?.includes("Previous execution turn still in progress"),
			);

			expect(maxConcurrent).toBe(1); // Never more than 1 running concurrently
			expect(successes.length).toBe(1);
			expect(rejectedOverlaps.length).toBe(19);
			expect(unhandledRejections.length).toBe(0);
		});

		it("should handle rapid sequential store operations without race conditions", async () => {
			const numOps = 20;
			for (let i = 0; i < numOps; i++) {
				await store.add({
					id: `rapid_${i}`,
					type: "timer",
					expression: "10s",
					prompt: `Prompt ${i}`,
					status: "active",
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					runCount: 0,
					errorCount: 0,
				});
			}

			const loaded = await store.load();
			expect(loaded.length).toBe(numOps);
		});

		it("should handle cancellation during in-flight turn execution", async () => {
			let resolveRunner: (() => void) | undefined;
			const runnerPromise = new Promise<void>((r) => {
				resolveRunner = r;
			});

			scheduler = new CronScheduler({
				store,
				turnRunner: async () => {
					await runnerPromise;
					return "Finished after delay";
				},
			});
			await scheduler.start();

			const cronJob = await scheduler.scheduleCron({
				id: "in_flight_cancel_cron",
				cron: "* * * * *",
				prompt: "Cancel mid flight",
			});

			// Trigger execution
			const execPromise = scheduler.triggerNow(cronJob.id);

			// Cancel while executing
			const cancelRes = await scheduler.cancelSchedule(cronJob.id);
			expect(cancelRes).toBe(true);
			expect(cronJob.status).toBe("cancelled");

			// Complete runner
			resolveRunner?.();
			const execRes = await execPromise;
			expect(execRes.success).toBe(true);

			// Cron job should remain cancelled and NOT rearm
			expect(cronJob.status).toBe("cancelled");
			expect(cronJob.timerHandle).toBeUndefined();
		});
	});

	// ==========================================
	// 2. ERROR RESILIENCE & ZERO UNHANDLED REJECTIONS
	// ==========================================
	describe("2. Error Resilience", () => {
		it("should cleanly catch synchronous runner errors with 0 unhandled rejections", async () => {
			scheduler = new CronScheduler({
				store,
				turnRunner: () => {
					throw new Error("Synchronous crash in runner");
				},
			});
			await scheduler.start();

			const errorPromise = waitForEvent<ScheduleEvent>((cb) => {
				scheduler.on("error", cb);
			});

			const job = await scheduler.scheduleTimer({
				duration: "10ms",
				prompt: "Sync throw test",
			});

			const errorEvent = await errorPromise;

			const updated = scheduler.getSchedule(job.id);
			expect(updated?.errorCount).toBe(1);
			expect(updated?.lastError).toContain("Synchronous crash in runner");
			expect(errorEvent.error?.message).toContain("Synchronous crash in runner");
			expect(unhandledRejections.length).toBe(0);
			expect(uncaughtExceptions.length).toBe(0);
		});

		it("should cleanly catch asynchronous Promise.reject errors with 0 unhandled rejections", async () => {
			scheduler = new CronScheduler({
				store,
				turnRunner: async () => {
					await new Promise((r) => setTimeout(r, 10));
					return Promise.reject(new Error("Async rejection in runner"));
				},
			});
			await scheduler.start();

			const errorPromise = waitForEvent<ScheduleEvent>((cb) => {
				scheduler.on("error", cb);
			});

			const job = await scheduler.scheduleTimer({
				duration: "10ms",
				prompt: "Async rejection test",
			});

			const errorEvent = await errorPromise;

			const updated = scheduler.getSchedule(job.id);
			expect(updated?.errorCount).toBe(1);
			expect(updated?.lastError).toContain("Async rejection in runner");
			expect(errorEvent.error?.message).toContain("Async rejection in runner");
			expect(unhandledRejections.length).toBe(0);
			expect(uncaughtExceptions.length).toBe(0);
		});

		it("should handle non-Error thrown objects (strings, objects, null)", async () => {
			let throwType = 0;
			scheduler = new CronScheduler({
				store,
				turnRunner: async () => {
					throwType++;
					if (throwType === 1) throw "String thrown exception";
					if (throwType === 2) throw { customError: true, code: 500 };
					throw null;
				},
			});
			await scheduler.start();

			const job = await scheduler.scheduleCron({
				cron: "* * * * *",
				prompt: "Non-error throw test",
			});

			// Trigger 1: String throw
			const res1 = await scheduler.triggerNow(job.id);
			expect(res1.success).toBe(false);
			expect(res1.error).toContain("String thrown exception");

			// Trigger 2: Object throw
			const res2 = await scheduler.triggerNow(job.id);
			expect(res2.success).toBe(false);
			expect(res2.error).toBeDefined();

			// Trigger 3: null throw
			const res3 = await scheduler.triggerNow(job.id);
			expect(res3.success).toBe(false);
			expect(res3.error).toBeDefined();

			expect(unhandledRejections.length).toBe(0);
		});

		it("should isolate failing event listeners without impacting other listeners or scheduler", async () => {
			scheduler = new CronScheduler({
				store,
				turnRunner: async () => "ok",
			});
			await scheduler.start();

			let listener2Called = false;
			let listener3Called = false;

			const triggerPromise = waitForEvent<void>((resolve) => {
				scheduler.on("trigger", () => {
					throw new Error("Broken listener 1");
				});
				scheduler.on("trigger", () => {
					listener2Called = true;
				});
				scheduler.on("*", (e) => {
					if (e.type === "trigger") {
						listener3Called = true;
						resolve();
					}
				});
			});

			await scheduler.scheduleTimer({
				duration: "10ms",
				prompt: "Listener resilience test",
			});

			await triggerPromise;

			expect(listener2Called).toBe(true);
			expect(listener3Called).toBe(true);
			expect(unhandledRejections.length).toBe(0);
			expect(uncaughtExceptions.length).toBe(0);
		});
	});

	// ==========================================
	// 3. PERSISTENCE STRESS & CORRUPTION RECOVERY
	// ==========================================
	describe("3. Persistence Stress & Corruption Recovery", () => {
		it("should handle various corrupted JSON formats gracefully without crashing", async () => {
			const dir = path.dirname(storagePath);
			fs.mkdirSync(dir, { recursive: true });

			const testCases = [
				"", // completely empty
				"   \n  \t  \r\n  ", // whitespace only
				"{ unclosed json",
				'{"valid": "object but not array"}',
				"12345",
				"true",
				"null",
			];

			for (const corruptedContent of testCases) {
				fs.writeFileSync(storagePath, corruptedContent, "utf-8");
				const loaded = await store.load();
				expect(Array.isArray(loaded)).toBe(true);
				expect(loaded.length).toBe(0);
			}
		});

		it("should perform atomic writes via temp file and rename", async () => {
			const items: StoredSchedule[] = Array.from({ length: 50 }, (_, i) => ({
				id: `atomic_${i}`,
				type: "timer",
				expression: "1m",
				prompt: `Atomic item ${i}`,
				status: "active",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				runCount: 0,
				errorCount: 0,
			}));

			await store.save(items);

			expect(fs.existsSync(storagePath)).toBe(true);
			const rawContent = fs.readFileSync(storagePath, "utf-8");
			const parsed = JSON.parse(rawContent);
			expect(parsed.length).toBe(50);

			// Ensure no residual .tmp files exist in directory
			const dirFiles = fs.readdirSync(path.dirname(storagePath));
			const tmpFiles = dirFiles.filter((f) => f.includes(".tmp."));
			expect(tmpFiles.length).toBe(0);
		});

		it("should preserve full schedule state and rearm on reload", async () => {
			scheduler = new CronScheduler({ store });
			await scheduler.start();

			const createdAt = new Date(Date.now() - 60000).toISOString();
			const updatedAt = new Date(Date.now() - 30000).toISOString();

			// Directly store records with custom metadata and counts
			const customJob: StoredSchedule = {
				id: "custom_state_job",
				name: "Backup task",
				type: "cron",
				expression: "0 12 * * *",
				prompt: "Do database backup",
				status: "active",
				createdAt,
				updatedAt,
				runCount: 42,
				errorCount: 3,
				lastError: "Previous disk full warning",
				lastOutput: "Backup archive #42 created",
				maxRuns: 100,
				metadata: { environment: "production", priority: "high" },
			};
			await store.add(customJob);

			// Reload scheduler from disk
			scheduler.stop();
			const scheduler2 = new CronScheduler({ store });
			await scheduler2.start();

			const reloaded = scheduler2.getSchedule("custom_state_job");
			expect(reloaded).toBeDefined();
			expect(reloaded?.name).toBe("Backup task");
			expect(reloaded?.type).toBe("cron");
			expect(reloaded?.expression).toBe("0 12 * * *");
			expect(reloaded?.prompt).toBe("Do database backup");
			expect(reloaded?.status).toBe("active");
			expect(reloaded?.runCount).toBe(42);
			expect(reloaded?.errorCount).toBe(3);
			expect(reloaded?.lastError).toBe("Previous disk full warning");
			expect(reloaded?.lastOutput).toBe("Backup archive #42 created");
			expect(reloaded?.maxRuns).toBe(100);
			expect(reloaded?.metadata).toEqual({ environment: "production", priority: "high" });
			expect(reloaded?.nextRunAt).toBeDefined();

			scheduler2.stop();
		});

		it("should mark corrupted cron expressions as error status during reload instead of crashing", async () => {
			const invalidJob: StoredSchedule = {
				id: "invalid_cron_on_disk",
				type: "cron",
				expression: "99 99 99 99 99", // completely invalid cron
				prompt: "Invalid expression",
				status: "active",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				runCount: 0,
				errorCount: 0,
			};
			await store.add(invalidJob);

			scheduler = new CronScheduler({ store });
			await scheduler.start(); // Should not throw

			const record = scheduler.getSchedule("invalid_cron_on_disk");
			expect(record).toBeDefined();
			expect(record?.status).toBe("error");
			expect(record?.lastError).toContain("Invalid cron expression on reload");
		});

		it("should execute past-due one-shot timers promptly upon reload", async () => {
			const pastDueTimer: StoredSchedule = {
				id: "past_due_timer",
				type: "timer",
				expression: "10ms",
				prompt: "Past due action",
				status: "active",
				createdAt: new Date(Date.now() - 10000).toISOString(),
				updatedAt: new Date(Date.now() - 10000).toISOString(),
				nextRunAt: new Date(Date.now() - 5000).toISOString(), // 5s in the past
				runCount: 0,
				errorCount: 0,
			};
			await store.add(pastDueTimer);

			let executed = false;
			scheduler = new CronScheduler({
				store,
				turnRunner: async () => {
					executed = true;
					return "Ran missed timer";
				},
			});

			const completedPromise = waitForEvent<void>((resolve) => {
				scheduler.on("completed", (e) => {
					if (e.scheduleId === "past_due_timer") {
						resolve();
					}
				});
			});

			await scheduler.start();
			await completedPromise;

			const record = scheduler.getSchedule("past_due_timer");
			expect(record?.status).toBe("completed");
			expect(record?.runCount).toBe(1);
			expect(executed).toBe(true);
		});
	});

	// ==========================================
	// 4. PROCESS LIFECYCLE & TIMER UNREF
	// ==========================================
	describe("4. Process Lifecycle & Timer Cleanliness", () => {
		it("should arm timer handles with unref capability", async () => {
			scheduler = new CronScheduler({ store });
			await scheduler.start();

			const timerJob = await scheduler.scheduleTimer({
				duration: "1h",
				prompt: "Unref check timer",
			});

			const cronJob = await scheduler.scheduleCron({
				cron: "0 0 * * *",
				prompt: "Unref check cron",
			});

			// Verify handles are defined
			expect(timerJob.timerHandle).toBeDefined();
			expect(cronJob.timerHandle).toBeDefined();

			// Stop scheduler and verify handles are disarmed
			scheduler.stop();
			expect(timerJob.timerHandle).toBeUndefined();
			expect(cronJob.timerHandle).toBeUndefined();
			expect(scheduler.isRunning()).toBe(false);
		});

		it("should be idempotent on multiple start() and stop() calls", async () => {
			scheduler = new CronScheduler({ store });
			await scheduler.start();
			await scheduler.start(); // redundant start
			expect(scheduler.isRunning()).toBe(true);

			scheduler.stop();
			scheduler.stop(); // redundant stop
			expect(scheduler.isRunning()).toBe(false);

			await scheduler.start(); // restart
			expect(scheduler.isRunning()).toBe(true);
			scheduler.stop();
		});

		it("should handle edge case actions on non-existent or completed jobs gracefully", async () => {
			scheduler = new CronScheduler({ store });
			await scheduler.start();

			// Actions on non-existent IDs
			expect(await scheduler.cancelSchedule("no_such_id")).toBe(false);
			expect(await scheduler.pauseSchedule("no_such_id")).toBe(false);
			expect(await scheduler.resumeSchedule("no_such_id")).toBe(false);
			expect(scheduler.getSchedule("no_such_id")).toBeUndefined();

			// Trigger non-existent throws expected Error
			let triggerError: Error | undefined;
			try {
				await scheduler.triggerNow("no_such_id");
			} catch (err: unknown) {
				triggerError = err as Error;
			}
			expect(triggerError).toBeDefined();
			expect(triggerError?.message).toContain("Schedule not found: no_such_id");

			// Complete a timer, then try resuming
			const timerCompletedPromise = waitForEvent<void>((resolve) => {
				scheduler.on("completed", () => resolve());
			});
			const timer = await scheduler.scheduleTimer({
				duration: "10ms",
				prompt: "Quick finish",
			});
			await timerCompletedPromise;
			expect(scheduler.getSchedule(timer.id)?.status).toBe("completed");

			// Resuming completed timer should return false
			const resumeResult = await scheduler.resumeSchedule(timer.id);
			expect(resumeResult).toBe(false);
		});
	});
});
