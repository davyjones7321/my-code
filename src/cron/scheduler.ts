/**
 * CronScheduler Engine for Phase 12 (Cron Scheduler & Recurring Agent Tasks)
 */

import { getNextCronTime, parseCron, parseDuration } from "./parser.ts";
import { ScheduleStore } from "./store.ts";
import type {
	CronScheduleOptions,
	CronSchedulerOptions,
	ScheduleEvent,
	ScheduleEventListener,
	ScheduleEventType,
	ScheduleExecutionResult,
	ScheduleRecord,
	StoredSchedule,
	TimerScheduleOptions,
} from "./types.ts";

export class CronScheduler {
	private readonly store: ScheduleStore;
	private readonly turnRunner?: (
		prompt: string,
		schedule: ScheduleRecord,
	) => Promise<string | undefined>;
	private readonly listeners: Map<ScheduleEventType | "*", Set<ScheduleEventListener>> = new Map();
	private readonly schedules: Map<string, ScheduleRecord> = new Map();
	private running = false;
	private tickTimer?: ReturnType<typeof setInterval>;
	private readonly tickIntervalMs: number;

	constructor(options?: CronSchedulerOptions) {
		if (options?.store) {
			this.store = options.store as ScheduleStore;
		} else {
			this.store = new ScheduleStore({
				projectRoot: options?.projectRoot,
				storagePath: options?.storagePath,
			});
		}

		if (options?.turnRunner) {
			const originalRunner = options.turnRunner;
			this.turnRunner = async (prompt, schedule) => {
				const res = await originalRunner(prompt, schedule);
				return typeof res === "string" ? res : undefined;
			};
		}
		this.tickIntervalMs = options?.tickIntervalMs || 1000;

		if (options?.autoStart) {
			this.start().catch((err) => {
				console.error("[CronScheduler] Auto-start error:", err);
			});
		}
	}

	/**
	 * Returns the ScheduleStore instance used by this scheduler
	 */
	getStore(): ScheduleStore {
		return this.store;
	}

	/**
	 * Returns whether the scheduler is currently active and running
	 */
	isRunning(): boolean {
		return this.running;
	}

	/**
	 * Subscribes to scheduler events
	 */
	on(event: ScheduleEventType | "*", listener: ScheduleEventListener): this {
		if (!this.listeners.has(event)) {
			this.listeners.set(event, new Set());
		}
		this.listeners.get(event)?.add(listener);
		return this;
	}

	/**
	 * Unsubscribes from scheduler events
	 */
	off(event: ScheduleEventType | "*", listener: ScheduleEventListener): this {
		this.listeners.get(event)?.delete(listener);
		return this;
	}

	/**
	 * Emits an event to registered listeners with safe error isolation
	 */
	private emit(event: ScheduleEvent): void {
		const specific = this.listeners.get(event.type);
		if (specific) {
			for (const listener of specific) {
				try {
					listener(event);
				} catch {
					// Isolate listener error
				}
			}
		}

		const wildcards = this.listeners.get("*");
		if (wildcards) {
			for (const listener of wildcards) {
				try {
					listener(event);
				} catch {
					// Isolate listener error
				}
			}
		}
	}

	/**
	 * Starts the scheduler and arms all stored active schedules
	 */
	async start(): Promise<void> {
		if (this.running) return;
		this.running = true;

		await this.reload();

		this.emit({
			type: "loaded",
			scheduleId: "*",
			schedule: {} as ScheduleRecord,
			timestamp: new Date(),
		});
	}

	/**
	 * Stops the scheduler and disarms all active timers
	 */
	stop(): void {
		this.running = false;
		if (this.tickTimer) {
			clearInterval(this.tickTimer);
			this.tickTimer = undefined;
		}

		for (const record of this.schedules.values()) {
			this.disarmRecord(record);
		}
	}

	/**
	 * Reloads schedules from disk and rearms active jobs
	 */
	async reload(): Promise<void> {
		// Disarm existing in-memory records
		for (const record of this.schedules.values()) {
			this.disarmRecord(record);
		}
		this.schedules.clear();

		const stored = await this.store.load();
		const now = new Date();

		for (const item of stored) {
			const record: ScheduleRecord = {
				...item,
				isExecuting: false,
			};

			this.schedules.set(record.id, record);

			if (this.running && record.status === "active") {
				// If cron or timer, calculate next run
				if (record.type === "cron") {
					try {
						const nextTime = getNextCronTime(record.expression, now);
						record.nextRunAt = nextTime.toISOString();
						this.armCronRecord(record);
					} catch {
						record.status = "error";
						record.lastError = `Invalid cron expression on reload: ${record.expression}`;
					}
				} else if (record.type === "timer") {
					if (record.nextRunAt) {
						const nextTime = new Date(record.nextRunAt);
						const delay = nextTime.getTime() - now.getTime();
						if (delay <= 0) {
							// Missed timer while down: execute soon
							this.armTimerRecord(record, 10);
						} else {
							this.armTimerRecord(record, delay);
						}
					}
				}
			}
		}
	}

	/**
	 * Adds a recurring cron job
	 */
	async scheduleCron(options: CronScheduleOptions): Promise<ScheduleRecord> {
		// Validate cron expression
		parseCron(options.cron);

		const now = new Date();
		const nextTime = getNextCronTime(options.cron, now);

		const id = options.id || `cron_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

		const record: ScheduleRecord = {
			id,
			name: options.name,
			type: "cron",
			expression: options.cron.trim(),
			prompt: options.prompt,
			status: "active",
			createdAt: now.toISOString(),
			updatedAt: now.toISOString(),
			nextRunAt: nextTime.toISOString(),
			runCount: 0,
			errorCount: 0,
			maxRuns: options.maxRuns,
			metadata: options.metadata,
			isExecuting: false,
		};

		this.schedules.set(id, record);
		await this.persistRecord(record);

		if (this.running && options.autoStart !== false) {
			this.armCronRecord(record);
		}

		this.emit({
			type: "scheduled",
			scheduleId: id,
			schedule: record,
			timestamp: now,
		});

		return record;
	}

	/**
	 * Adds a one-shot timer job
	 */
	async scheduleTimer(options: TimerScheduleOptions): Promise<ScheduleRecord> {
		const durationMs =
			typeof options.duration === "number" ? options.duration : parseDuration(options.duration);

		if (durationMs <= 0 || !Number.isFinite(durationMs)) {
			throw new Error("Timer duration must be a positive non-zero number");
		}

		const now = new Date();
		const nextTime = new Date(now.getTime() + durationMs);

		const id = options.id || `timer_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

		const exprStr =
			typeof options.duration === "string" ? options.duration.trim() : `${options.duration}ms`;

		const record: ScheduleRecord = {
			id,
			name: options.name,
			type: "timer",
			expression: exprStr,
			prompt: options.prompt,
			status: "active",
			createdAt: now.toISOString(),
			updatedAt: now.toISOString(),
			nextRunAt: nextTime.toISOString(),
			runCount: 0,
			errorCount: 0,
			maxRuns: 1,
			metadata: options.metadata,
			isExecuting: false,
		};

		this.schedules.set(id, record);
		await this.persistRecord(record);

		if (this.running && options.autoStart !== false) {
			this.armTimerRecord(record, durationMs);
		}

		this.emit({
			type: "scheduled",
			scheduleId: id,
			schedule: record,
			timestamp: now,
		});

		return record;
	}

	/**
	 * Cancels an active or paused schedule
	 */
	async cancelSchedule(id: string): Promise<boolean> {
		const record = this.schedules.get(id);
		if (!record) {
			const stored = await this.store.get(id);
			if (!stored) return false;
			await this.store.update(id, { status: "cancelled", nextRunAt: undefined });
			return true;
		}

		this.disarmRecord(record);
		record.status = "cancelled";
		record.nextRunAt = undefined;
		record.updatedAt = new Date().toISOString();

		await this.persistRecord(record);

		this.emit({
			type: "cancelled",
			scheduleId: id,
			schedule: record,
			timestamp: new Date(),
		});

		return true;
	}

	/**
	 * Pauses an active schedule
	 */
	async pauseSchedule(id: string): Promise<boolean> {
		const record = this.schedules.get(id);
		if (!record) {
			const stored = await this.store.get(id);
			if (!stored) return false;
			await this.store.update(id, { status: "paused", nextRunAt: undefined });
			return true;
		}

		if (record.status === "paused") return true;

		this.disarmRecord(record);
		record.status = "paused";
		record.nextRunAt = undefined;
		record.updatedAt = new Date().toISOString();

		await this.persistRecord(record);

		this.emit({
			type: "paused",
			scheduleId: id,
			schedule: record,
			timestamp: new Date(),
		});

		return true;
	}

	/**
	 * Resumes a paused schedule
	 */
	async resumeSchedule(id: string): Promise<boolean> {
		const record = this.schedules.get(id);
		if (!record) {
			const stored = await this.store.get(id);
			if (!stored) return false;
			// Reload and resume
			await this.reload();
			return this.resumeSchedule(id);
		}

		if (record.status === "active") return true;
		if (record.status === "completed" || record.status === "cancelled") {
			return false;
		}

		record.status = "active";
		record.updatedAt = new Date().toISOString();

		const now = new Date();
		if (record.type === "cron") {
			const nextTime = getNextCronTime(record.expression, now);
			record.nextRunAt = nextTime.toISOString();
			if (this.running) {
				this.armCronRecord(record);
			}
		} else if (record.type === "timer") {
			const durationMs = parseDuration(record.expression);
			const nextTime = new Date(now.getTime() + durationMs);
			record.nextRunAt = nextTime.toISOString();
			if (this.running) {
				this.armTimerRecord(record, durationMs);
			}
		}

		await this.persistRecord(record);

		this.emit({
			type: "resumed",
			scheduleId: id,
			schedule: record,
			timestamp: now,
		});

		return true;
	}

	/**
	 * Lists in-memory schedule records, optionally filtered
	 */
	listSchedules(filter?: (s: ScheduleRecord) => boolean): ScheduleRecord[] {
		const all = Array.from(this.schedules.values());
		return filter ? all.filter(filter) : all;
	}

	/**
	 * Retrieves an in-memory schedule record by ID
	 */
	getSchedule(id: string): ScheduleRecord | undefined {
		return this.schedules.get(id);
	}

	/**
	 * Manually executes a scheduled job immediately
	 */
	async triggerNow(id: string): Promise<ScheduleExecutionResult> {
		const record = this.schedules.get(id);
		if (!record) {
			throw new Error(`Schedule not found: ${id}`);
		}
		return this.executeTurn(record);
	}

	/**
	 * Arms a cron schedule timer
	 */
	private armCronRecord(record: ScheduleRecord): void {
		this.disarmRecord(record);

		if (!this.running || record.status !== "active") return;

		try {
			const now = new Date();
			const nextTime = getNextCronTime(record.expression, now);
			record.nextRunAt = nextTime.toISOString();

			const delayMs = Math.max(0, nextTime.getTime() - Date.now());

			// For delays over 24 days (max 32-bit int in setTimeout), cap and re-evaluate
			const safeDelay = Math.min(delayMs, 2147483647);

			const handle = setTimeout(() => {
				if (delayMs > 2147483647) {
					// Re-arm for remaining duration
					this.armCronRecord(record);
					return;
				}

				this.executeTurn(record).catch((err) => {
					// Error isolation: 0 unhandled rejections
					console.error(`[CronScheduler] Unexpected execution error for ${record.id}:`, err);
				});
			}, safeDelay);

			if (typeof (handle as { unref?: () => void }).unref === "function") {
				(handle as { unref: () => void }).unref();
			}
			record.timerHandle = handle;
		} catch (err: unknown) {
			record.status = "error";
			record.lastError = (err as Error).message || String(err);
		}
	}

	/**
	 * Arms a one-shot timer schedule
	 */
	private armTimerRecord(record: ScheduleRecord, delayMs: number): void {
		this.disarmRecord(record);

		if (!this.running || record.status !== "active") return;

		const safeDelay = Math.min(Math.max(0, delayMs), 2147483647);

		const handle = setTimeout(() => {
			if (delayMs > 2147483647) {
				const remaining = delayMs - 2147483647;
				this.armTimerRecord(record, remaining);
				return;
			}

			this.executeTurn(record).catch((err) => {
				console.error(`[CronScheduler] Unexpected timer execution error for ${record.id}:`, err);
			});
		}, safeDelay);

		if (typeof (handle as { unref?: () => void }).unref === "function") {
			(handle as { unref: () => void }).unref();
		}
		record.timerHandle = handle;
	}

	/**
	 * Disarms and clears active timer handles for a record
	 */
	private disarmRecord(record: ScheduleRecord): void {
		if (record.timerHandle) {
			clearTimeout(record.timerHandle as Parameters<typeof clearTimeout>[0]);
			clearInterval(record.timerHandle as Parameters<typeof clearInterval>[0]);
			record.timerHandle = undefined;
		}
	}

	/**
	 * Executes a scheduled agent turn with robust try/catch error boundaries
	 */
	private async executeTurn(record: ScheduleRecord): Promise<ScheduleExecutionResult> {
		if (record.isExecuting) {
			// Prevent overlapping execution of same job
			return {
				scheduleId: record.id,
				success: false,
				executedAt: new Date(),
				durationMs: 0,
				error: "Previous execution turn still in progress",
			};
		}

		record.isExecuting = true;
		const startTime = Date.now();
		const executedAt = new Date();

		let output: string | undefined;
		let executionError: string | undefined;
		let success = false;

		try {
			if (this.turnRunner) {
				const res = await this.turnRunner(record.prompt, record);
				output = typeof res === "string" ? res : undefined;
			}
			success = true;
		} catch (err: unknown) {
			success = false;
			executionError = (err as Error)?.message || String(err);
		} finally {
			record.isExecuting = false;
		}

		const durationMs = Date.now() - startTime;
		record.lastRunAt = executedAt.toISOString();
		record.updatedAt = new Date().toISOString();

		if (success) {
			record.runCount++;
			record.lastOutput = output;
		} else {
			record.errorCount++;
			record.lastError = executionError;
		}

		// Check completion conditions
		const reachedMaxRuns = typeof record.maxRuns === "number" && record.runCount >= record.maxRuns;
		const isOneShot = record.type === "timer";

		if (reachedMaxRuns || isOneShot) {
			record.status = "completed";
			record.nextRunAt = undefined;
			this.disarmRecord(record);
		} else if (record.type === "cron" && record.status === "active") {
			// Compute next cron occurrence and rearm
			try {
				const nextTime = getNextCronTime(record.expression, new Date());
				record.nextRunAt = nextTime.toISOString();
				if (this.running) {
					this.armCronRecord(record);
				}
			} catch (nextErr: unknown) {
				record.status = "error";
				record.lastError = (nextErr as Error).message || String(nextErr);
			}
		}

		await this.persistRecord(record).catch(() => {});

		const result: ScheduleExecutionResult = {
			scheduleId: record.id,
			success,
			executedAt,
			durationMs,
			output,
			error: executionError,
		};

		if (success) {
			this.emit({
				type: "trigger",
				scheduleId: record.id,
				schedule: record,
				timestamp: executedAt,
				result,
			});
		} else {
			this.emit({
				type: "error",
				scheduleId: record.id,
				schedule: record,
				timestamp: executedAt,
				result,
				error: new Error(executionError),
			});
		}

		if (record.status === "completed") {
			this.emit({
				type: "completed",
				scheduleId: record.id,
				schedule: record,
				timestamp: new Date(),
				result,
			});
		}

		return result;
	}

	/**
	 * Persists an in-memory record to the store
	 */
	private async persistRecord(record: ScheduleRecord): Promise<void> {
		const stored: StoredSchedule = {
			id: record.id,
			name: record.name,
			type: record.type,
			expression: record.expression,
			prompt: record.prompt,
			status: record.status,
			createdAt: record.createdAt,
			updatedAt: record.updatedAt,
			lastRunAt: record.lastRunAt,
			nextRunAt: record.nextRunAt,
			runCount: record.runCount,
			errorCount: record.errorCount,
			lastError: record.lastError,
			lastOutput: record.lastOutput,
			maxRuns: record.maxRuns,
			metadata: record.metadata,
		};
		await this.store.add(stored);
	}
}
