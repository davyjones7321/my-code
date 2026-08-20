/**
 * Schedule Types and Contracts for Phase 12 (Cron Scheduler & Recurring Agent Tasks)
 */

export type ScheduleType = "cron" | "timer";

export type ScheduleStatus = "active" | "paused" | "completed" | "cancelled" | "error";

export type ScheduleEventType =
	| "trigger"
	| "completed"
	| "error"
	| "cancelled"
	| "paused"
	| "resumed"
	| "loaded"
	| "scheduled";

export interface StoredSchedule {
	id: string;
	name?: string;
	type: ScheduleType;
	expression: string;
	prompt: string;
	status: ScheduleStatus;
	createdAt: string;
	updatedAt: string;
	lastRunAt?: string;
	nextRunAt?: string;
	runCount: number;
	errorCount: number;
	lastError?: string;
	lastOutput?: string;
	maxRuns?: number;
	metadata?: Record<string, unknown>;
}

export interface ScheduleRecord extends StoredSchedule {
	timerHandle?: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval> | unknown;
	abortController?: AbortController;
	isExecuting?: boolean;
}

export interface CronScheduleOptions {
	id?: string;
	name?: string;
	cron: string;
	prompt: string;
	maxRuns?: number;
	metadata?: Record<string, unknown>;
	autoStart?: boolean;
}

export interface TimerScheduleOptions {
	id?: string;
	name?: string;
	duration: string | number;
	prompt: string;
	metadata?: Record<string, unknown>;
	autoStart?: boolean;
}

export interface ScheduleExecutionResult {
	scheduleId: string;
	success: boolean;
	executedAt: Date;
	durationMs: number;
	output?: string;
	error?: string;
}

export interface ScheduleEvent {
	type: ScheduleEventType;
	scheduleId: string;
	schedule: ScheduleRecord;
	timestamp: Date;
	result?: ScheduleExecutionResult;
	error?: Error;
}

export type ScheduleEventListener = (event: ScheduleEvent) => void;

export interface CronSchedulerOptions {
	projectRoot?: string;
	storagePath?: string;
	store?: unknown;
	turnRunner?: (prompt: string, schedule: ScheduleRecord) => Promise<string | undefined>;
	autoStart?: boolean;
	tickIntervalMs?: number;
}

export interface ParsedCronSchedule {
	raw: string;
	minutes: number[];
	hours: number[];
	daysOfMonth: number[];
	months: number[];
	daysOfWeek: number[];
	hasDomWildcard: boolean;
	hasDowWildcard: boolean;
}
