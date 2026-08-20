/**
 * Persistent Schedule Store for Phase 12 (.harness/schedules.json)
 */

import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { StoredSchedule } from "./types.ts";

export interface ScheduleStoreOptions {
	storagePath?: string;
	projectRoot?: string;
}

export class ScheduleStore {
	private readonly storagePath: string;

	constructor(options?: ScheduleStoreOptions) {
		if (options?.storagePath) {
			this.storagePath = path.resolve(options.storagePath);
		} else {
			const projectRoot = options?.projectRoot || process.env.HARNESS_PROJECT_ROOT || process.cwd();
			this.storagePath = path.join(projectRoot, ".harness", "schedules.json");
		}
	}

	/**
	 * Returns the resolved filesystem path to the schedules.json file
	 */
	getStoragePath(): string {
		return this.storagePath;
	}

	/**
	 * Loads all stored schedules from disk.
	 * Gracefully returns an empty array if the file is missing or contains corrupt JSON.
	 */
	async load(): Promise<StoredSchedule[]> {
		try {
			if (!existsSync(this.storagePath)) {
				return [];
			}
			const content = await fs.readFile(this.storagePath, "utf-8");
			if (!content.trim()) {
				return [];
			}
			const parsed = JSON.parse(content);
			if (!Array.isArray(parsed)) {
				console.warn(
					`[ScheduleStore] Warning: Invalid format in ${this.storagePath}, expected array. Initializing with empty list.`,
				);
				return [];
			}
			return parsed as StoredSchedule[];
		} catch (err: unknown) {
			const errMsg = err instanceof Error ? err.message : String(err);
			console.warn(
				`[ScheduleStore] Warning: Failed to load schedules from ${this.storagePath} (${errMsg}). Returning empty list.`,
			);
			return [];
		}
	}

	/**
	 * Atomically persists schedules to disk via a temporary file and rename.
	 * Auto-creates parent directories recursively if they do not exist.
	 */
	async save(schedules: StoredSchedule[]): Promise<void> {
		const dir = path.dirname(this.storagePath);
		if (!existsSync(dir)) {
			await fs.mkdir(dir, { recursive: true });
		}

		const tempPath = path.join(
			dir,
			`.schedules.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`,
		);

		const data = JSON.stringify(schedules, null, 2);
		await fs.writeFile(tempPath, data, "utf-8");

		try {
			await fs.rename(tempPath, this.storagePath);
		} catch (renameErr) {
			// On Windows, if destination exists, rename might fail with EPERM/EBUSY in rare cases; fallback to copy+unlink
			try {
				await fs.copyFile(tempPath, this.storagePath);
				await fs.unlink(tempPath).catch(() => {});
			} catch (_fallbackErr) {
				await fs.unlink(tempPath).catch(() => {});
				throw renameErr;
			}
		}
	}

	/**
	 * Adds a new schedule or replaces an existing one by ID
	 */
	async add(schedule: StoredSchedule): Promise<void> {
		const schedules = await this.load();
		const idx = schedules.findIndex((s) => s.id === schedule.id);
		if (idx >= 0) {
			schedules[idx] = schedule;
		} else {
			schedules.push(schedule);
		}
		await this.save(schedules);
	}

	/**
	 * Updates an existing schedule by ID
	 */
	async update(id: string, updates: Partial<StoredSchedule>): Promise<StoredSchedule | null> {
		const schedules = await this.load();
		const idx = schedules.findIndex((s) => s.id === id);
		if (idx === -1) {
			return null;
		}

		const updated: StoredSchedule = {
			...schedules[idx],
			...updates,
			updatedAt: new Date().toISOString(),
		};
		schedules[idx] = updated;
		await this.save(schedules);
		return updated;
	}

	/**
	 * Removes a schedule by ID
	 */
	async remove(id: string): Promise<boolean> {
		const schedules = await this.load();
		const initialLength = schedules.length;
		const filtered = schedules.filter((s) => s.id !== id);
		if (filtered.length === initialLength) {
			return false;
		}
		await this.save(filtered);
		return true;
	}

	/**
	 * Retrieves a schedule by ID
	 */
	async get(id: string): Promise<StoredSchedule | null> {
		const schedules = await this.load();
		return schedules.find((s) => s.id === id) || null;
	}

	/**
	 * Lists all schedules, optionally filtered
	 */
	async list(filter?: (s: StoredSchedule) => boolean): Promise<StoredSchedule[]> {
		const schedules = await this.load();
		return filter ? schedules.filter(filter) : schedules;
	}

	/**
	 * Clears all stored schedules
	 */
	async clear(): Promise<void> {
		await this.save([]);
	}
}
