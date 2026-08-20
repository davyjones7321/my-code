/**
 * CLI Commands for Phase 12 (Cron Scheduler & Recurring Agent Tasks)
 */

import chalk from "chalk";
import type { Command } from "commander";
import { getNextCronTime, parseCron, parseDuration } from "../cron/parser.ts";
import { ScheduleStore } from "../cron/store.ts";
import type { ScheduleType, StoredSchedule } from "../cron/types.ts";

export function registerCronCommands(
	program: Command,
	options?: { projectRoot?: string; storagePath?: string },
) {
	const cronCommand = program.command("cron").description("Manage scheduled cron jobs and timers");

	cronCommand
		.command("list")
		.description("List all scheduled cron jobs and timers")
		.option("--json", "Output as JSON")
		.action(async (cmdOpts) => {
			const projectRoot = options?.projectRoot || process.env.HARNESS_PROJECT_ROOT || process.cwd();
			const store = new ScheduleStore({
				projectRoot,
				storagePath: options?.storagePath,
			});
			const schedules = await store.list();

			if (cmdOpts.json) {
				console.log(JSON.stringify(schedules, null, 2));
				return;
			}

			if (schedules.length === 0) {
				console.log("No scheduled jobs found.");
				return;
			}

			console.log(chalk.bold(`\n=== Scheduled Tasks (${schedules.length}) ===`));
			for (const item of schedules) {
				const nextStr = item.nextRunAt ? new Date(item.nextRunAt).toLocaleString() : "N/A";
				const statusColor =
					item.status === "active"
						? chalk.green
						: item.status === "paused"
							? chalk.yellow
							: item.status === "completed"
								? chalk.blue
								: chalk.red;

				console.log(
					`- [${chalk.cyan(item.id)}] ${item.type} (${item.expression}): "${item.prompt}" [${statusColor(
						item.status,
					)}] (Next: ${nextStr}, Runs: ${item.runCount})`,
				);
			}
			console.log();
		});

	cronCommand
		.command("add <schedule> <prompt>")
		.description("Add a new recurring cron job or one-shot timer")
		.option("-n, --name <name>", "Optional human-readable name for schedule")
		.option("--json", "Output as JSON")
		.action(async (scheduleExpr, prompt, cmdOpts) => {
			const projectRoot = options?.projectRoot || process.env.HARNESS_PROJECT_ROOT || process.cwd();
			const store = new ScheduleStore({
				projectRoot,
				storagePath: options?.storagePath,
			});

			const trimmedExpr = scheduleExpr.trim();
			const trimmedPrompt = prompt.trim();

			if (!trimmedPrompt) {
				console.error(chalk.red("Error: Prompt cannot be empty."));
				process.exit(1);
			}

			let type: ScheduleType = "cron";
			let durationMs = 0;
			let isDuration = false;

			// Check if expression is duration
			try {
				durationMs = parseDuration(trimmedExpr);
				type = "timer";
				isDuration = true;
			} catch {
				// Not a duration, check if valid cron
				try {
					parseCron(trimmedExpr);
					type = "cron";
					isDuration = false;
				} catch (_cronErr: unknown) {
					console.error(
						chalk.red(
							`Error: Invalid schedule expression "${trimmedExpr}". Must be a 5-field cron (e.g. "*/5 * * * *") or duration (e.g. "30s", "10m", "2h").`,
						),
					);
					process.exit(1);
				}
			}

			const now = new Date();
			let nextRunAt: string | undefined;

			if (isDuration) {
				nextRunAt = new Date(now.getTime() + durationMs).toISOString();
			} else {
				nextRunAt = getNextCronTime(trimmedExpr, now).toISOString();
			}

			const id = `${type}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

			const record: StoredSchedule = {
				id,
				name: cmdOpts.name,
				type,
				expression: trimmedExpr,
				prompt: trimmedPrompt,
				status: "active",
				createdAt: now.toISOString(),
				updatedAt: now.toISOString(),
				nextRunAt,
				runCount: 0,
				errorCount: 0,
				maxRuns: isDuration ? 1 : undefined,
			};

			await store.add(record);

			if (cmdOpts.json) {
				console.log(JSON.stringify(record, null, 2));
				return;
			}

			console.log(
				chalk.green(
					`Successfully scheduled job "${record.id}" (${record.type}: ${record.expression})`,
				),
			);
			console.log(
				`Next run: ${nextRunAt ? new Date(nextRunAt).toLocaleString() : "N/A"} | Prompt: "${record.prompt}"`,
			);
		});

	cronCommand
		.command("remove <id>")
		.alias("cancel")
		.alias("delete")
		.alias("rm")
		.description("Remove a scheduled job by ID")
		.action(async (id) => {
			const projectRoot = options?.projectRoot || process.env.HARNESS_PROJECT_ROOT || process.cwd();
			const store = new ScheduleStore({
				projectRoot,
				storagePath: options?.storagePath,
			});

			const existing = await store.get(id);
			if (!existing) {
				console.error(chalk.red(`Error: Schedule with ID "${id}" not found.`));
				process.exit(1);
			}

			await store.remove(id);
			console.log(chalk.green(`Successfully removed scheduled job: ${id}`));
		});

	cronCommand
		.command("pause <id>")
		.description("Pause an active schedule by ID")
		.action(async (id) => {
			const projectRoot = options?.projectRoot || process.env.HARNESS_PROJECT_ROOT || process.cwd();
			const store = new ScheduleStore({
				projectRoot,
				storagePath: options?.storagePath,
			});

			const existing = await store.get(id);
			if (!existing) {
				console.error(chalk.red(`Error: Schedule with ID "${id}" not found.`));
				process.exit(1);
			}

			await store.update(id, { status: "paused", nextRunAt: undefined });
			console.log(chalk.green(`Successfully paused scheduled job: ${id}`));
		});

	cronCommand
		.command("resume <id>")
		.description("Resume a paused schedule by ID")
		.action(async (id) => {
			const projectRoot = options?.projectRoot || process.env.HARNESS_PROJECT_ROOT || process.cwd();
			const store = new ScheduleStore({
				projectRoot,
				storagePath: options?.storagePath,
			});

			const existing = await store.get(id);
			if (!existing) {
				console.error(chalk.red(`Error: Schedule with ID "${id}" not found.`));
				process.exit(1);
			}

			const now = new Date();
			let nextRunAt: string | undefined;

			try {
				if (existing.type === "cron") {
					nextRunAt = getNextCronTime(existing.expression, now).toISOString();
				} else {
					const durationMs = parseDuration(existing.expression);
					nextRunAt = new Date(now.getTime() + durationMs).toISOString();
				}
			} catch {
				nextRunAt = undefined;
			}

			await store.update(id, { status: "active", nextRunAt });
			console.log(chalk.green(`Successfully resumed scheduled job: ${id}`));
		});
}
