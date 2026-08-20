import { describe, expect, it } from "bun:test";
import {
	formatScheduleExpression,
	getNextCronTime,
	matchesCron,
	parseCron,
	parseDuration,
} from "../../src/cron/parser.ts";

describe("Phase 12: Cron & Duration Parser", () => {
	describe("5-Field Cron Expression Parser (parseCron)", () => {
		it("should parse standard wildcard expression (* * * * *)", () => {
			const parsed = parseCron("* * * * *");
			expect(parsed.minutes.length).toBe(60);
			expect(parsed.hours.length).toBe(24);
			expect(parsed.daysOfMonth.length).toBe(31);
			expect(parsed.months.length).toBe(12);
			expect(parsed.daysOfWeek.length).toBe(7);
			expect(parsed.hasDomWildcard).toBe(true);
			expect(parsed.hasDowWildcard).toBe(true);
		});

		it("should parse specific scalar values", () => {
			const parsed = parseCron("15 14 1 5 3");
			expect(parsed.minutes).toEqual([15]);
			expect(parsed.hours).toEqual([14]);
			expect(parsed.daysOfMonth).toEqual([1]);
			expect(parsed.months).toEqual([5]);
			expect(parsed.daysOfWeek).toEqual([3]);
			expect(parsed.hasDomWildcard).toBe(false);
			expect(parsed.hasDowWildcard).toBe(false);
		});

		it("should parse ranges (e.g. 1-5 9-17)", () => {
			const parsed = parseCron("1-5 9-17 1-10 1-6 1-5");
			expect(parsed.minutes).toEqual([1, 2, 3, 4, 5]);
			expect(parsed.hours).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
			expect(parsed.daysOfMonth).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
			expect(parsed.months).toEqual([1, 2, 3, 4, 5, 6]);
			expect(parsed.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
		});

		it("should parse steps (e.g. */5, */10)", () => {
			const parsed = parseCron("*/15 */6 */10 */3 */2");
			expect(parsed.minutes).toEqual([0, 15, 30, 45]);
			expect(parsed.hours).toEqual([0, 6, 12, 18]);
			expect(parsed.daysOfMonth).toEqual([1, 11, 21, 31]);
			expect(parsed.months).toEqual([1, 4, 7, 10]);
			expect(parsed.daysOfWeek).toEqual([0, 2, 4, 6]);
		});

		it("should parse range with step (e.g. 1-10/2)", () => {
			const parsed = parseCron("1-10/2 10-20/5 5-25/10 2-8/2 1-5/2");
			expect(parsed.minutes).toEqual([1, 3, 5, 7, 9]);
			expect(parsed.hours).toEqual([10, 15, 20]);
			expect(parsed.daysOfMonth).toEqual([5, 15, 25]);
			expect(parsed.months).toEqual([2, 4, 6, 8]);
			expect(parsed.daysOfWeek).toEqual([1, 3, 5]);
		});

		it("should parse comma-separated lists and deduplicate", () => {
			const parsed = parseCron("1,5,10,5 0,12 1,15,30 1,6,12 0,6");
			expect(parsed.minutes).toEqual([1, 5, 10]);
			expect(parsed.hours).toEqual([0, 12]);
			expect(parsed.daysOfMonth).toEqual([1, 15, 30]);
			expect(parsed.months).toEqual([1, 6, 12]);
			expect(parsed.daysOfWeek).toEqual([0, 6]);
		});

		it("should parse complex mixed expressions (e.g. 0,15-30/5,45)", () => {
			const parsed = parseCron("0,15-30/5,45 * * * *");
			expect(parsed.minutes).toEqual([0, 15, 20, 25, 30, 45]);
		});

		it("should parse named months (JAN-DEC case-insensitively)", () => {
			const parsed1 = parseCron("0 0 1 JAN,MAR,DEC *");
			expect(parsed1.months).toEqual([1, 3, 12]);

			const parsed2 = parseCron("0 0 1 feb-apr *");
			expect(parsed2.months).toEqual([2, 3, 4]);
		});

		it("should parse named weekdays (SUN-SAT case-insensitively)", () => {
			const parsed = parseCron("0 0 * * MON-FRI");
			expect(parsed.daysOfWeek).toEqual([1, 2, 3, 4, 5]);

			const parsedWeekends = parseCron("0 0 * * sat,sun");
			expect(parsedWeekends.daysOfWeek).toEqual([0, 6]);
		});

		it("should normalize Sunday from both 0 and 7", () => {
			const parsed0 = parseCron("0 0 * * 0");
			const parsed7 = parseCron("0 0 * * 7");
			expect(parsed0.daysOfWeek).toEqual([0]);
			expect(parsed7.daysOfWeek).toEqual([0]);

			const parsedRange = parseCron("0 0 * * 5-7");
			expect(parsedRange.daysOfWeek).toEqual([0, 5, 6]);
		});

		it("should reject invalid field counts", () => {
			expect(() => parseCron("")).toThrow("Cron expression cannot be empty");
			expect(() => parseCron("* * * *")).toThrow("must contain exactly 5 fields");
			expect(() => parseCron("* * * * * *")).toThrow("must contain exactly 5 fields");
			expect(() => parseCron("   ")).toThrow("Cron expression cannot be empty");
		});

		it("should reject out-of-bounds values", () => {
			expect(() => parseCron("60 * * * *")).toThrow("out of valid bounds");
			expect(() => parseCron("* 24 * * *")).toThrow("out of valid bounds");
			expect(() => parseCron("* * 0 * *")).toThrow("out of valid bounds");
			expect(() => parseCron("* * 32 * *")).toThrow("out of valid bounds");
			expect(() => parseCron("* * * 0 *")).toThrow("out of valid bounds");
			expect(() => parseCron("* * * 13 *")).toThrow("out of valid bounds");
			expect(() => parseCron("* * * * 8")).toThrow("out of valid bounds");
		});

		it("should reject inverted ranges and invalid steps", () => {
			expect(() => parseCron("10-5 * * * *")).toThrow("cannot exceed end of range");
			expect(() => parseCron("*/0 * * * *")).toThrow("Step must be a positive non-zero integer");
			expect(() => parseCron("*/-5 * * * *")).toThrow("Step must be a positive non-zero integer");
			expect(() => parseCron("*/abc * * * *")).toThrow("Step must be a positive non-zero integer");
		});
	});

	describe("Relative Duration Parser (parseDuration)", () => {
		it("should parse milliseconds (ms)", () => {
			expect(parseDuration("500ms")).toBe(500);
			expect(parseDuration("1000ms")).toBe(1000);
			expect(parseDuration("1ms")).toBe(1);
		});

		it("should parse seconds (s)", () => {
			expect(parseDuration("30s")).toBe(30000);
			expect(parseDuration("1s")).toBe(1000);
			expect(parseDuration("0.5s")).toBe(500);
			expect(parseDuration("2.5s")).toBe(2500);
		});

		it("should parse minutes (m)", () => {
			expect(parseDuration("1m")).toBe(60000);
			expect(parseDuration("10m")).toBe(600000);
			expect(parseDuration("1.5m")).toBe(90000);
		});

		it("should parse hours (h)", () => {
			expect(parseDuration("1h")).toBe(3600000);
			expect(parseDuration("2h")).toBe(7200000);
			expect(parseDuration("0.5h")).toBe(1800000);
		});

		it("should parse days (d) and weeks (w)", () => {
			expect(parseDuration("1d")).toBe(86400000);
			expect(parseDuration("7d")).toBe(604800000);
			expect(parseDuration("1w")).toBe(604800000);
		});

		it("should be case-insensitive and tolerate whitespace", () => {
			expect(parseDuration("  30S  ")).toBe(30000);
			expect(parseDuration("10 M")).toBe(600000);
			expect(parseDuration("2 H")).toBe(7200000);
			expect(parseDuration("500 MS")).toBe(500);
		});

		it("should reject negative, zero, and malformed durations", () => {
			expect(() => parseDuration("-10s")).toThrow();
			expect(() => parseDuration("0s")).toThrow("positive non-zero number");
			expect(() => parseDuration("0m")).toThrow("positive non-zero number");
			expect(() => parseDuration("30")).toThrow("Invalid duration format");
			expect(() => parseDuration("10x")).toThrow("Invalid duration format");
			expect(() => parseDuration("5years")).toThrow("Invalid duration format");
			expect(() => parseDuration("")).toThrow("cannot be empty");
			expect(() => parseDuration("   ")).toThrow("cannot be empty");
			expect(() => parseDuration("abc")).toThrow("Invalid duration format");
		});
	});

	describe("Cron Matching (matchesCron)", () => {
		it("should match when date satisfies expression", () => {
			// Wednesday, 2026-08-20 14:30:00 (Month = 8, Day = 20, Dow = 4 (Thu))
			const date = new Date(2026, 7, 20, 14, 30, 0); // Month index 7 is August

			expect(matchesCron("* * * * *", date)).toBe(true);
			expect(matchesCron("30 14 * * *", date)).toBe(true);
			expect(matchesCron("30 14 20 8 *", date)).toBe(true);
			expect(matchesCron("30 14 * * 4", date)).toBe(true); // Thu = 4
			expect(matchesCron("*/5 * * * *", date)).toBe(true);

			expect(matchesCron("31 14 * * *", date)).toBe(false);
			expect(matchesCron("30 15 * * *", date)).toBe(false);
			expect(matchesCron("30 14 21 * *", date)).toBe(false);
			expect(matchesCron("30 14 * 9 *", date)).toBe(false);
			expect(matchesCron("30 14 * * 5", date)).toBe(false);
		});

		it("should respect POSIX DOM and DOW union behavior", () => {
			// Friday, 2026-08-21 (DOM = 21, DOW = 5)
			const date = new Date(2026, 7, 21, 10, 0, 0);

			// Both wildcard -> match
			expect(matchesCron("0 10 * * *", date)).toBe(true);

			// Only DOM non-wildcard -> DOM must match
			expect(matchesCron("0 10 21 * *", date)).toBe(true);
			expect(matchesCron("0 10 22 * *", date)).toBe(false);

			// Only DOW non-wildcard -> DOW must match
			expect(matchesCron("0 10 * * 5", date)).toBe(true);
			expect(matchesCron("0 10 * * 1", date)).toBe(false);

			// Both non-wildcard -> matches if DOM matches OR DOW matches
			// Matches because DOM=21 matches
			expect(matchesCron("0 10 21 * 1", date)).toBe(true);
			// Matches because DOW=5 matches
			expect(matchesCron("0 10 22 * 5", date)).toBe(true);
			// Fails because neither matches
			expect(matchesCron("0 10 22 * 1", date)).toBe(false);
		});
	});

	describe("Next Cron Time Calculation (getNextCronTime)", () => {
		it("should calculate next matching minute strictly > fromDate", () => {
			const base = new Date(2026, 7, 20, 10, 15, 30); // 10:15:30
			const next = getNextCronTime("* * * * *", base);

			expect(next.getFullYear()).toBe(2026);
			expect(next.getMonth()).toBe(7);
			expect(next.getDate()).toBe(20);
			expect(next.getHours()).toBe(10);
			expect(next.getMinutes()).toBe(16);
			expect(next.getSeconds()).toBe(0);
			expect(next.getMilliseconds()).toBe(0);
			expect(next.getTime()).toBeGreaterThan(base.getTime());
		});

		it("should calculate next step minute (*/5 * * * *)", () => {
			const base = new Date(2026, 7, 20, 10, 12, 0);
			const next = getNextCronTime("*/5 * * * *", base);

			expect(next.getHours()).toBe(10);
			expect(next.getMinutes()).toBe(15);
			expect(next.getSeconds()).toBe(0);
		});

		it("should roll over to next hour", () => {
			const base = new Date(2026, 7, 20, 10, 55, 0);
			const next = getNextCronTime("15 * * * *", base);

			expect(next.getHours()).toBe(11);
			expect(next.getMinutes()).toBe(15);
		});

		it("should roll over to next day", () => {
			const base = new Date(2026, 7, 20, 23, 30, 0);
			const next = getNextCronTime("0 9 * * *", base);

			expect(next.getDate()).toBe(21);
			expect(next.getHours()).toBe(9);
			expect(next.getMinutes()).toBe(0);
		});

		it("should roll over to next month and year", () => {
			const base = new Date(2026, 11, 31, 23, 0, 0); // Dec 31, 2026
			const next = getNextCronTime("0 0 1 1 *", base); // Jan 1 00:00

			expect(next.getFullYear()).toBe(2027);
			expect(next.getMonth()).toBe(0);
			expect(next.getDate()).toBe(1);
			expect(next.getHours()).toBe(0);
			expect(next.getMinutes()).toBe(0);
		});

		it("should calculate leap year dates correctly (e.g. Feb 29)", () => {
			const base = new Date(2026, 0, 1, 0, 0, 0); // Jan 1, 2026
			const next = getNextCronTime("0 0 29 2 *", base);

			// Next leap year is 2028
			expect(next.getFullYear()).toBe(2028);
			expect(next.getMonth()).toBe(1); // February
			expect(next.getDate()).toBe(29);
		});
	});

	describe("Format Schedule Expression (formatScheduleExpression)", () => {
		it("should format durations and common cron expressions", () => {
			expect(formatScheduleExpression("30s")).toBe("in 30s");
			expect(formatScheduleExpression("10m")).toBe("in 10m");
			expect(formatScheduleExpression("2h")).toBe("in 2.0h");
			expect(formatScheduleExpression("* * * * *")).toBe("Every minute");
			expect(formatScheduleExpression("0 * * * *")).toBe("Every hour");
			expect(formatScheduleExpression("0 0 * * *")).toBe("Every day at 00:00");
			expect(formatScheduleExpression("0 9 * * 1-5")).toBe("Weekdays at 09:00");
			expect(formatScheduleExpression("*/5 * * * *")).toBe("Every 5 minutes");
		});
	});

	describe("Adversarial & Extreme Boundary Hardening", () => {
		describe("Leap Year and Impossible Date Boundaries", () => {
			it("should advance from 2024-03-01 to 2028-02-29", () => {
				const base = new Date(2024, 2, 1, 0, 0, 0);
				const next = getNextCronTime("0 0 29 2 *", base);
				expect(next.getFullYear()).toBe(2028);
				expect(next.getMonth()).toBe(1);
				expect(next.getDate()).toBe(29);
				expect(next.getHours()).toBe(0);
				expect(next.getMinutes()).toBe(0);
			});

			it("should advance from 2028-02-29 00:00:00 to 2032-02-29", () => {
				const base = new Date(2028, 1, 29, 0, 0, 0);
				const next = getNextCronTime("0 0 29 2 *", base);
				expect(next.getFullYear()).toBe(2032);
				expect(next.getMonth()).toBe(1);
				expect(next.getDate()).toBe(29);
			});

			it("should skip non-leap 2029-2031 and land on 2032-02-29", () => {
				const base = new Date(2029, 0, 1, 0, 0, 0);
				const next = getNextCronTime("0 0 29 2 *", base);
				expect(next.getFullYear()).toBe(2032);
				expect(next.getMonth()).toBe(1);
				expect(next.getDate()).toBe(29);
			});

			it("should throw within 5 years for impossible Feb 30 and Feb 31", () => {
				const base = new Date(2026, 0, 1, 0, 0, 0);
				expect(() => getNextCronTime("0 0 30 2 *", base)).toThrow(
					"No matching cron time found within 5 years",
				);
				expect(() => getNextCronTime("0 0 31 2 *", base)).toThrow(
					"No matching cron time found within 5 years",
				);
			});

			it("should throw for non-existent 31st days in 30-day months (Apr, Jun, Sep, Nov)", () => {
				const base = new Date(2026, 0, 1, 0, 0, 0);
				expect(() => getNextCronTime("0 0 31 4 *", base)).toThrow(
					"No matching cron time found within 5 years",
				);
				expect(() => getNextCronTime("0 0 31 6 *", base)).toThrow(
					"No matching cron time found within 5 years",
				);
				expect(() => getNextCronTime("0 0 31 9 *", base)).toThrow(
					"No matching cron time found within 5 years",
				);
				expect(() => getNextCronTime("0 0 31 11 *", base)).toThrow(
					"No matching cron time found within 5 years",
				);
			});
		});

		describe("Month Rollovers and Sequence of 31st Days", () => {
			it("should hit all 7 months with 31 days and correctly roll over years", () => {
				let current = new Date(2026, 0, 1, 0, 0, 0);
				const expectedMonths = [
					{ year: 2026, month: 0, day: 31 }, // Jan
					{ year: 2026, month: 2, day: 31 }, // Mar
					{ year: 2026, month: 4, day: 31 }, // May
					{ year: 2026, month: 6, day: 31 }, // Jul
					{ year: 2026, month: 7, day: 31 }, // Aug
					{ year: 2026, month: 9, day: 31 }, // Oct
					{ year: 2026, month: 11, day: 31 }, // Dec
					{ year: 2027, month: 0, day: 31 }, // Jan (next year)
					{ year: 2027, month: 2, day: 31 }, // Mar
				];

				for (const exp of expectedMonths) {
					const next = getNextCronTime("0 0 31 * *", current);
					expect(next.getFullYear()).toBe(exp.year);
					expect(next.getMonth()).toBe(exp.month);
					expect(next.getDate()).toBe(exp.day);
					current = next;
				}
			});

			it("should handle Dec 31 23:59:59 to Jan 1 00:00:00 rollover", () => {
				const base = new Date(2026, 11, 31, 23, 59, 59, 999);
				const next = getNextCronTime("0 0 1 1 *", base);
				expect(next.getFullYear()).toBe(2027);
				expect(next.getMonth()).toBe(0);
				expect(next.getDate()).toBe(1);
				expect(next.getHours()).toBe(0);
				expect(next.getMinutes()).toBe(0);
			});
		});

		describe("Step and Range Edge Cases", () => {
			it("should parse step 1 (*/1) as all 60 minutes", () => {
				const parsed = parseCron("*/1 * * * *");
				expect(parsed.minutes.length).toBe(60);
				expect(parsed.minutes[0]).toBe(0);
				expect(parsed.minutes[59]).toBe(59);
			});

			it("should parse 0-59/59 as [0, 59]", () => {
				const parsed = parseCron("0-59/59 * * * *");
				expect(parsed.minutes).toEqual([0, 59]);
			});

			it("should parse 0-59/60 as [0]", () => {
				const parsed = parseCron("0-59/60 * * * *");
				expect(parsed.minutes).toEqual([0]);
			});

			it("should parse 1-12/12 in month as [1]", () => {
				const parsed = parseCron("* * * 1-12/12 *");
				expect(parsed.months).toEqual([1]);
			});

			it("should parse 1-12/11 in month as [1, 12]", () => {
				const parsed = parseCron("* * * 1-12/11 *");
				expect(parsed.months).toEqual([1, 12]);
			});

			it("should parse 0-6/6 in weekday as [0, 6]", () => {
				const parsed = parseCron("* * * * 0-6/6");
				expect(parsed.daysOfWeek).toEqual([0, 6]);
			});

			it("should parse 1-31/15 in DOM as [1, 16, 31]", () => {
				const parsed = parseCron("* * 1-31/15 * *");
				expect(parsed.daysOfMonth).toEqual([1, 16, 31]);
			});

			it("should parse single value step 50/5 as [50, 55]", () => {
				const parsed = parseCron("50/5 * * * *");
				expect(parsed.minutes).toEqual([50, 55]);
			});

			it("should parse single value step 55/5 as [55]", () => {
				const parsed = parseCron("55/5 * * * *");
				expect(parsed.minutes).toEqual([55]);
			});

			it("should parse step larger than range as start value only", () => {
				const parsed = parseCron("0-10/20 * * * *");
				expect(parsed.minutes).toEqual([0]);
			});
		});

		describe("List and Named Token Edge Cases", () => {
			it("should deduplicate and sort list elements", () => {
				const parsed = parseCron("59,0,30,15,45,0,59 * * * *");
				expect(parsed.minutes).toEqual([0, 15, 30, 45, 59]);
			});

			it("should parse mixed ranges, steps, and scalars in a single field", () => {
				const parsed = parseCron("0,10-20/5,30-32,50/5 * * * *");
				expect(parsed.minutes).toEqual([0, 10, 15, 20, 30, 31, 32, 50, 55]);
			});

			it("should parse all named months in various casings", () => {
				const parsed = parseCron("0 0 1 JAN,feb,MaR,aPr,MAY,jun,JUL,aug,SEP,oct,NOV,dec *");
				expect(parsed.months).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
			});

			it("should parse all named weekdays in various casings", () => {
				const parsed = parseCron("0 0 * * SUN,mon,Tue,wed,THU,fri,SAT");
				expect(parsed.daysOfWeek).toEqual([0, 1, 2, 3, 4, 5, 6]);
			});

			it("should parse named range with step (JAN-DEC/3)", () => {
				const parsed = parseCron("0 0 1 JAN-DEC/3 *");
				expect(parsed.months).toEqual([1, 4, 7, 10]);
			});

			it("should normalize Sunday 7 and ranges ending in 7", () => {
				expect(parseCron("0 0 * * 7").daysOfWeek).toEqual([0]);
				expect(parseCron("0 0 * * 0,7").daysOfWeek).toEqual([0]);
				expect(parseCron("0 0 * * 5-7").daysOfWeek).toEqual([0, 5, 6]);
				expect(parseCron("0 0 * * 6-7").daysOfWeek).toEqual([0, 6]);
				expect(parseCron("0 0 * * 7-7").daysOfWeek).toEqual([0]);
			});
		});

		describe("Invalid Input and Boundary Rejections", () => {
			it("should reject non-string and empty cron expressions", () => {
				expect(() => parseCron(null as unknown as string)).toThrow("Cron expression must be a string");
				expect(() => parseCron(undefined as unknown as string)).toThrow("Cron expression must be a string");
				expect(() => parseCron(123 as unknown as string)).toThrow("Cron expression must be a string");
				expect(() => parseCron("")).toThrow("Cron expression cannot be empty");
				expect(() => parseCron("   \t\n  ")).toThrow("Cron expression cannot be empty");
			});

			it("should reject invalid field counts", () => {
				expect(() => parseCron("* * * *")).toThrow("must contain exactly 5 fields");
				expect(() => parseCron("* * * * * *")).toThrow("must contain exactly 5 fields");
				expect(() => parseCron("*")).toThrow("must contain exactly 5 fields");
			});

			it("should reject out-of-bounds field values", () => {
				expect(() => parseCron("60 * * * *")).toThrow("out of valid bounds");
				expect(() => parseCron("-1 * * * *")).toThrow();
				expect(() => parseCron("* 24 * * *")).toThrow("out of valid bounds");
				expect(() => parseCron("* -1 * * *")).toThrow();
				expect(() => parseCron("* * 0 * *")).toThrow("out of valid bounds");
				expect(() => parseCron("* * 32 * *")).toThrow("out of valid bounds");
				expect(() => parseCron("* * * 0 *")).toThrow("out of valid bounds");
				expect(() => parseCron("* * * 13 *")).toThrow("out of valid bounds");
				expect(() => parseCron("* * * * -1")).toThrow();
				expect(() => parseCron("* * * * 8")).toThrow("out of valid bounds");
			});

			it("should reject inverted ranges and invalid steps", () => {
				expect(() => parseCron("10-5 * * * *")).toThrow("Start of range cannot exceed end of range");
				expect(() => parseCron("*/0 * * * *")).toThrow("Step must be a positive non-zero integer");
				expect(() => parseCron("*/-1 * * * *")).toThrow("Step must be a positive non-zero integer");
				expect(() => parseCron("1-10/0 * * * *")).toThrow("Step must be a positive non-zero integer");
				expect(() => parseCron("*/5/2 * * * *")).toThrow("Invalid step expression");
			});

			it("should reject trailing/leading commas and malformed lists", () => {
				expect(() => parseCron(",1,2 * * * *")).toThrow("Invalid empty list item in field");
				expect(() => parseCron("1,2, * * * *")).toThrow("Invalid empty list item in field");
				expect(() => parseCron(", * * * *")).toThrow("Invalid empty list item in field");
				expect(() => parseCron("1,,2 * * * *")).toThrow("Invalid empty list item in field");
			});
		});

		describe("parseDuration Adversarial Suite", () => {
			it("should parse valid durations with correct multipliers", () => {
				expect(parseDuration("1ms")).toBe(1);
				expect(parseDuration("500ms")).toBe(500);
				expect(parseDuration("1500ms")).toBe(1500);
				expect(parseDuration("1s")).toBe(1000);
				expect(parseDuration("30s")).toBe(30000);
				expect(parseDuration("0.5s")).toBe(500);
				expect(parseDuration("2.5s")).toBe(2500);
				expect(parseDuration("0.001s")).toBe(1);
				expect(parseDuration("1m")).toBe(60000);
				expect(parseDuration("10m")).toBe(600000);
				expect(parseDuration("1.5m")).toBe(90000);
				expect(parseDuration("0.25m")).toBe(15000);
				expect(parseDuration("1h")).toBe(3600000);
				expect(parseDuration("2h")).toBe(7200000);
				expect(parseDuration("0.5h")).toBe(1800000);
				expect(parseDuration("2.25h")).toBe(8100000);
				expect(parseDuration("1d")).toBe(86400000);
				expect(parseDuration("7d")).toBe(604800000);
				expect(parseDuration("0.5d")).toBe(43200000);
				expect(parseDuration("1000d")).toBe(86400000000);
				expect(parseDuration("1w")).toBe(604800000);
				expect(parseDuration("2w")).toBe(1209600000);
				expect(parseDuration("0.5w")).toBe(302400000);
				expect(parseDuration("52w")).toBe(31449600000);
			});

			it("should be case-insensitive and tolerate whitespace", () => {
				expect(parseDuration("  500  MS  ")).toBe(500);
				expect(parseDuration(" 10 M ")).toBe(600000);
				expect(parseDuration("2 H")).toBe(7200000);
				expect(parseDuration("1 D")).toBe(86400000);
				expect(parseDuration("1 W")).toBe(604800000);
			});

			it("should reject zero, negative, and malformed durations", () => {
				expect(() => parseDuration("0s")).toThrow("positive non-zero number");
				expect(() => parseDuration("0m")).toThrow("positive non-zero number");
				expect(() => parseDuration("0h")).toThrow("positive non-zero number");
				expect(() => parseDuration("0d")).toThrow("positive non-zero number");
				expect(() => parseDuration("0w")).toThrow("positive non-zero number");
				expect(() => parseDuration("0ms")).toThrow("positive non-zero number");
				expect(() => parseDuration("0.0s")).toThrow("positive non-zero number");
				expect(() => parseDuration("-1s")).toThrow("Invalid duration format");
				expect(() => parseDuration("-10m")).toThrow("Invalid duration format");
				expect(() => parseDuration("-0.5h")).toThrow("Invalid duration format");
				expect(() => parseDuration("NaNs")).toThrow("Invalid duration format");
				expect(() => parseDuration("Infinityh")).toThrow("Invalid duration format");
				expect(() => parseDuration("2.5.5h")).toThrow("Invalid duration format");
				expect(() => parseDuration("10x")).toThrow("Invalid duration format");
				expect(() => parseDuration("10sec")).toThrow("Invalid duration format");
				expect(() => parseDuration("10min")).toThrow("Invalid duration format");
				expect(() => parseDuration("10s extra")).toThrow("Invalid duration format");
				expect(() => parseDuration("s")).toThrow("Invalid duration format");
				expect(() => parseDuration("100")).toThrow("Invalid duration format");
				expect(() => parseDuration("")).toThrow("cannot be empty");
				expect(() => parseDuration("   ")).toThrow("cannot be empty");
				expect(() => parseDuration(null as unknown as string)).toThrow("Duration must be a string");
				expect(() => parseDuration(undefined as unknown as string)).toThrow("Duration must be a string");
			});
		});

		describe("Sequential Simulation and Idempotence", () => {
			it("should deterministically step through 100 iterations of */15 * * * *", () => {
				let current = new Date(2026, 0, 1, 0, 0, 0, 0);
				for (let i = 0; i < 100; i++) {
					const next = getNextCronTime("*/15 * * * *", current);
					expect(next.getTime()).toBe(current.getTime() + 15 * 60 * 1000);
					expect(next.getSeconds()).toBe(0);
					expect(next.getMilliseconds()).toBe(0);
					expect(next.getMinutes() % 15).toBe(0);
					current = next;
				}
			});

			it("should calculate exact next run when fromDate is exactly on trigger boundary", () => {
				const exactBoundary = new Date(2026, 7, 20, 12, 0, 0, 0);
				const next = getNextCronTime("0 12 * * *", exactBoundary);
				expect(next.getFullYear()).toBe(2026);
				expect(next.getMonth()).toBe(7);
				expect(next.getDate()).toBe(21);
				expect(next.getHours()).toBe(12);
				expect(next.getMinutes()).toBe(0);
			});

			it("should calculate same-day run when fromDate is 1ms before trigger boundary", () => {
				const justBefore = new Date(2026, 7, 20, 11, 59, 59, 999);
				const next = getNextCronTime("0 12 * * *", justBefore);
				expect(next.getFullYear()).toBe(2026);
				expect(next.getMonth()).toBe(7);
				expect(next.getDate()).toBe(20);
				expect(next.getHours()).toBe(12);
				expect(next.getMinutes()).toBe(0);
			});
		});
	});
});
