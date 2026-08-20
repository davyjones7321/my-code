import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Command } from "commander";
import { registerCronCommands } from "../../src/cli/cron.ts";
import { ScheduleStore } from "../../src/cron/store.ts";
import { SlashCommandRegistry, scheduleCommand } from "../../src/tui/commands.ts";
import { ReplSession } from "../../src/tui/session.ts";
import type { CommandContext } from "../../src/tui/types.ts";

function createMockContext(overrides?: Partial<CommandContext>): {
	context: CommandContext;
	outputs: string[];
} {
	const outputs: string[] = [];
	const session = new ReplSession({
		providerName: "anthropic",
		modelName: "claude-3-7-sonnet",
	});

	const context: CommandContext = {
		session,
		output: (text: string) => {
			outputs.push(text);
		},
		...overrides,
	};

	return { context, outputs };
}

describe("Phase 12: TUI /schedule Slash Command & CLI Integration", () => {
	let tempDir: string;
	let storagePath: string;
	let originalCwd: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-cli-slash-test-"));
		storagePath = path.join(tempDir, ".harness", "schedules.json");
		originalCwd = process.cwd();
		process.chdir(tempDir);
	});

	afterEach(() => {
		process.chdir(originalCwd);
		try {
			fs.rmSync(tempDir, { recursive: true, force: true });
		} catch {}
	});

	describe("REPL /schedule Slash Command", () => {
		it("should display empty message when no schedules exist", async () => {
			const { context, outputs } = createMockContext();
			const result = await scheduleCommand.execute(["list"], context);

			expect(result.handled).toBe(true);
			expect(outputs.join("")).toContain("No active schedules found");
		});

		it("should schedule a one-shot timer via /schedule add 10m <prompt>", async () => {
			const { context, outputs } = createMockContext();
			const result = await scheduleCommand.execute(
				["add", "10m", "Run", "integration", "tests"],
				context,
			);

			expect(result.handled).toBe(true);
			const out = outputs.join("");
			expect(out).toContain("Successfully scheduled job");
			expect(out).toContain("Type: timer");
			expect(out).toContain("Run integration tests");

			const store = new ScheduleStore({ storagePath });
			const list = await store.load();
			expect(list.length).toBe(1);
			expect(list[0].type).toBe("timer");
			expect(list[0].expression).toBe("10m");
			expect(list[0].prompt).toBe("Run integration tests");
		});

		it("should schedule a 5-field cron via unquoted whitespace tokens", async () => {
			const { context, outputs } = createMockContext();
			const result = await scheduleCommand.execute(
				["add", "*/5", "*", "*", "*", "*", "Check", "git", "status"],
				context,
			);

			expect(result.handled).toBe(true);
			const out = outputs.join("");
			expect(out).toContain("Successfully scheduled job");
			expect(out).toContain("Type: cron");
			expect(out).toContain("Check git status");

			const store = new ScheduleStore({ storagePath });
			const list = await store.load();
			expect(list.length).toBe(1);
			expect(list[0].type).toBe("cron");
			expect(list[0].expression).toBe("*/5 * * * *");
			expect(list[0].prompt).toBe("Check git status");
		});

		it("should schedule a 5-field cron via quoted string", async () => {
			const { context, outputs } = createMockContext();
			const result = await scheduleCommand.execute(
				["add", '"0 0 * * *"', "Daily cleanup"],
				context,
			);

			expect(result.handled).toBe(true);
			const out = outputs.join("");
			expect(out).toContain("Successfully scheduled job");
			expect(out).toContain("Type: cron");

			const store = new ScheduleStore({ storagePath });
			const list = await store.load();
			expect(list.length).toBe(1);
			expect(list[0].expression).toBe("0 0 * * *");
		});

		it("should list active schedules after creation", async () => {
			const { context: ctx1 } = createMockContext();
			await scheduleCommand.execute(["add", "30s", "Task 1"], ctx1);
			await scheduleCommand.execute(["add", "*/10 * * * *", "Task 2"], ctx1);

			const { context: ctx2, outputs: listOutputs } = createMockContext();
			await scheduleCommand.execute(["list"], ctx2);

			const combined = listOutputs.join("");
			expect(combined).toContain("=== Active Schedules (2) ===");
			expect(combined).toContain("Task 1");
			expect(combined).toContain("Task 2");
		});

		it("should cancel schedules via /schedule cancel <id>", async () => {
			const store = new ScheduleStore({ storagePath });
			await store.add({
				id: "timer_to_cancel",
				type: "timer",
				expression: "5m",
				prompt: "Cancel me",
				status: "active",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				runCount: 0,
				errorCount: 0,
			});

			const { context, outputs } = createMockContext();
			const result = await scheduleCommand.execute(["cancel", "timer_to_cancel"], context);

			expect(result.handled).toBe(true);
			expect(outputs.join("")).toContain('Schedule "timer_to_cancel" cancelled successfully.');
			expect((await store.load()).length).toBe(0);
		});

		it("should pause and resume schedules via slash command", async () => {
			const store = new ScheduleStore({ storagePath });
			await store.add({
				id: "sched_pause_test",
				type: "cron",
				expression: "0 * * * *",
				prompt: "Hourly sync",
				status: "active",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				runCount: 0,
				errorCount: 0,
			});

			const { context: ctx1, outputs: out1 } = createMockContext();
			await scheduleCommand.execute(["pause", "sched_pause_test"], ctx1);
			expect(out1.join("")).toContain("paused");
			expect((await store.get("sched_pause_test"))?.status).toBe("paused");

			const { context: ctx2, outputs: out2 } = createMockContext();
			await scheduleCommand.execute(["resume", "sched_pause_test"], ctx2);
			expect(out2.join("")).toContain("resumed");
			expect((await store.get("sched_pause_test"))?.status).toBe("active");
		});

		it("should dispatch via SlashCommandRegistry with /sched and /cron aliases", async () => {
			const registry = new SlashCommandRegistry();
			registry.register(scheduleCommand);

			const { context, outputs } = createMockContext();
			await registry.execute("/sched add 5m Registry alias test", context);
			expect(outputs.join("")).toContain("Successfully scheduled job");

			outputs.length = 0;
			await registry.execute("/cron list", context);
			expect(outputs.join("")).toContain("Registry alias test");
		});

		it("should reject invalid schedule expressions and empty prompts", async () => {
			const { context, outputs } = createMockContext();
			await scheduleCommand.execute(["add", "invalid_expr", "Some prompt"], context);
			expect(outputs.join("")).toContain("Error: Invalid schedule expression");

			outputs.length = 0;
			await scheduleCommand.execute(["add"], context);
			expect(outputs.join("")).toContain("Usage: /schedule add");
		});
	});

	describe("CLI harness cron Subcommands", () => {
		it("should register cron command group with commander program", () => {
			const program = new Command();
			registerCronCommands(program, { storagePath });

			const cronCmd = program.commands.find((c) => c.name() === "cron");
			expect(cronCmd).toBeDefined();

			const subNames = cronCmd?.commands.map((c) => c.name());
			expect(subNames).toContain("list");
			expect(subNames).toContain("add");
			expect(subNames).toContain("remove");
			expect(subNames).toContain("pause");
			expect(subNames).toContain("resume");
		});

		it("should list empty schedules via CLI", async () => {
			const logs: string[] = [];
			const origLog = console.log;
			console.log = (msg: string) => logs.push(msg);

			try {
				const program = new Command();
				registerCronCommands(program, { storagePath });
				await program.parseAsync(["node", "harness", "cron", "list"]);

				expect(logs.join("")).toContain("No scheduled jobs found.");
			} finally {
				console.log = origLog;
			}
		});

		it("should add and list jobs via CLI with --json option", async () => {
			const logs: string[] = [];
			const origLog = console.log;
			console.log = (msg: string) => logs.push(msg);

			try {
				const program = new Command();
				registerCronCommands(program, { storagePath });
				await program.parseAsync([
					"node",
					"harness",
					"cron",
					"add",
					"*/15 * * * *",
					"CLI scheduled prompt",
					"--name",
					"cli_job",
					"--json",
				]);

				const addedJson = JSON.parse(logs[0]);
				expect(addedJson.expression).toBe("*/15 * * * *");
				expect(addedJson.name).toBe("cli_job");

				logs.length = 0;
				const progList = new Command();
				registerCronCommands(progList, { storagePath });
				await progList.parseAsync(["node", "harness", "cron", "list", "--json"]);

				const listJson = JSON.parse(logs[0]);
				expect(Array.isArray(listJson)).toBe(true);
				expect(listJson.length).toBe(1);
				expect(listJson[0].name).toBe("cli_job");
			} finally {
				console.log = origLog;
			}
		});

		it("should remove scheduled job via CLI", async () => {
			const store = new ScheduleStore({ storagePath });
			await store.add({
				id: "cli_rm_target",
				type: "timer",
				expression: "10s",
				prompt: "To remove",
				status: "active",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				runCount: 0,
				errorCount: 0,
			});

			const logs: string[] = [];
			const origLog = console.log;
			console.log = (msg: string) => logs.push(msg);

			try {
				const program = new Command();
				registerCronCommands(program, { storagePath });
				await program.parseAsync(["node", "harness", "cron", "remove", "cli_rm_target"]);

				expect(logs.join("")).toContain("Successfully removed scheduled job: cli_rm_target");
				expect((await store.load()).length).toBe(0);
			} finally {
				console.log = origLog;
			}
		});
	});
});
