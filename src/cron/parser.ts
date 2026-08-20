/**
 * Pure TypeScript 5-field Cron and Duration Parser for Phase 12
 */

import type { ParsedCronSchedule } from "./types.ts";

const MONTH_NAMES: Record<string, number> = {
	JAN: 1,
	FEB: 2,
	MAR: 3,
	APR: 4,
	MAY: 5,
	JUN: 6,
	JUL: 7,
	AUG: 8,
	SEP: 9,
	OCT: 10,
	NOV: 11,
	DEC: 12,
};

const DAY_NAMES: Record<string, number> = {
	SUN: 0,
	MON: 1,
	TUE: 2,
	WED: 3,
	THU: 4,
	FRI: 5,
	SAT: 6,
};

/**
 * Parses a single cron field expression into an array of matching integer values
 */
function parseField(
	fieldStr: string,
	min: number,
	max: number,
	nameMap?: Record<string, number>,
	allowSevenAsSunday = false,
): number[] {
	const rawTrimmed = fieldStr.trim();
	if (!rawTrimmed) {
		throw new Error("Cron field cannot be empty");
	}

	let normalized = rawTrimmed.toUpperCase();
	if (nameMap) {
		for (const [name, val] of Object.entries(nameMap)) {
			// Replace whole-word name or token
			const regex = new RegExp(`\\b${name}\\b`, "gi");
			normalized = normalized.replace(regex, String(val));
		}
	}

	const parts = normalized.split(",");
	const resultSet = new Set<number>();

	for (const part of parts) {
		const trimmedPart = part.trim();
		if (!trimmedPart) {
			throw new Error(`Invalid empty list item in field: "${fieldStr}"`);
		}

		const slashParts = trimmedPart.split("/");
		if (slashParts.length > 2) {
			throw new Error(`Invalid step expression: "${trimmedPart}"`);
		}

		let step = 1;
		if (slashParts.length === 2) {
			const stepStr = slashParts[1].trim();
			step = Number.parseInt(stepStr, 10);
			if (Number.isNaN(step) || step <= 0 || String(step) !== stepStr) {
				throw new Error(`Step must be a positive non-zero integer in: "${trimmedPart}"`);
			}
		}

		const rangePart = slashParts[0].trim();
		let start = min;
		let end = max;

		if (rangePart === "*") {
			start = min;
			end = max;
		} else if (rangePart.includes("-")) {
			const dashParts = rangePart.split("-");
			if (dashParts.length !== 2) {
				throw new Error(`Invalid range expression: "${rangePart}"`);
			}
			const startStr = dashParts[0].trim();
			const endStr = dashParts[1].trim();
			start = Number.parseInt(startStr, 10);
			end = Number.parseInt(endStr, 10);

			if (Number.isNaN(start) || Number.isNaN(end)) {
				throw new Error(`Invalid range values: "${rangePart}"`);
			}
			if (start > end) {
				throw new Error(`Start of range cannot exceed end of range: "${rangePart}"`);
			}
			const effectiveMax = allowSevenAsSunday && max === 6 ? 7 : max;
			if (start < min || end > effectiveMax) {
				throw new Error(`Range "${rangePart}" out of valid bounds [${min}-${effectiveMax}]`);
			}
		} else {
			const singleVal = Number.parseInt(rangePart, 10);
			const effectiveMax = allowSevenAsSunday && max === 6 ? 7 : max;
			if (Number.isNaN(singleVal) || singleVal < min || singleVal > effectiveMax) {
				throw new Error(`Value "${rangePart}" out of valid bounds [${min}-${effectiveMax}]`);
			}

			if (slashParts.length === 2) {
				// E.g. "10/2" -> start from 10 up to max with step 2
				start = singleVal;
				end = effectiveMax;
			} else {
				start = singleVal;
				end = singleVal;
			}
		}

		for (let v = start; v <= end; v += step) {
			const normalizedVal = allowSevenAsSunday && v === 7 ? 0 : v;
			resultSet.add(normalizedVal);
		}
	}

	if (resultSet.size === 0) {
		throw new Error(`Field expression "${fieldStr}" produced no valid numbers`);
	}

	return Array.from(resultSet).sort((a, b) => a - b);
}

/**
 * Parses a standard 5-field cron expression string
 * Format: minute (0-59) hour (0-23) dayOfMonth (1-31) month (1-12) dayOfWeek (0-7, 0 & 7 = Sun)
 */
export function parseCron(expr: string): ParsedCronSchedule {
	if (typeof expr !== "string") {
		throw new Error("Cron expression must be a string");
	}

	const trimmed = expr.trim();
	if (!trimmed) {
		throw new Error("Cron expression cannot be empty");
	}

	const fields = trimmed.split(/\s+/);
	if (fields.length !== 5) {
		throw new Error(
			`Cron expression must contain exactly 5 fields (minute hour day-of-month month day-of-week). Got ${fields.length}: "${expr}"`,
		);
	}

	const minutes = parseField(fields[0], 0, 59);
	const hours = parseField(fields[1], 0, 23);
	const daysOfMonth = parseField(fields[2], 1, 31);
	const months = parseField(fields[3], 1, 12, MONTH_NAMES);
	const daysOfWeek = parseField(fields[4], 0, 6, DAY_NAMES, true);

	const hasDomWildcard = fields[2] === "*";
	const hasDowWildcard = fields[4] === "*";

	return {
		raw: trimmed,
		minutes,
		hours,
		daysOfMonth,
		months,
		daysOfWeek,
		hasDomWildcard,
		hasDowWildcard,
	};
}

/**
 * Parses a relative duration string (e.g. "30s", "10m", "2h", "1d", "500ms", "1w") into milliseconds.
 * Throws an Error on invalid, negative, or zero values.
 */
export function parseDuration(str: string): number {
	if (typeof str !== "string") {
		throw new Error("Duration must be a string");
	}

	const trimmed = str.trim();
	if (!trimmed) {
		throw new Error("Duration string cannot be empty");
	}

	const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)$/i);
	if (!match) {
		throw new Error(
			`Invalid duration format: "${str}". Expected format like "30s", "10m", "2h", "1d", "500ms", "1w".`,
		);
	}

	const val = Number.parseFloat(match[1]);
	if (Number.isNaN(val) || !Number.isFinite(val) || val <= 0) {
		throw new Error(`Duration must be a positive non-zero number, got: "${str}"`);
	}

	const unit = match[2].toLowerCase();
	let multiplier = 1;

	switch (unit) {
		case "ms":
			multiplier = 1;
			break;
		case "s":
			multiplier = 1000;
			break;
		case "m":
			multiplier = 60 * 1000;
			break;
		case "h":
			multiplier = 60 * 60 * 1000;
			break;
		case "d":
			multiplier = 24 * 60 * 60 * 1000;
			break;
		case "w":
			multiplier = 7 * 24 * 60 * 60 * 1000;
			break;
		default:
			throw new Error(`Unsupported duration unit: "${unit}"`);
	}

	return Math.round(val * multiplier);
}

/**
 * Checks if a given Date matches a parsed or raw cron expression
 */
export function matchesCron(parsedOrExpr: ParsedCronSchedule | string, date: Date): boolean {
	const parsed = typeof parsedOrExpr === "string" ? parseCron(parsedOrExpr) : parsedOrExpr;

	const minute = date.getMinutes();
	const hour = date.getHours();
	const dom = date.getDate();
	const month = date.getMonth() + 1; // 1-12
	const dow = date.getDay(); // 0-6

	if (!parsed.minutes.includes(minute)) return false;
	if (!parsed.hours.includes(hour)) return false;
	if (!parsed.months.includes(month)) return false;

	// POSIX DOM & DOW matching rule:
	// If both are wildcards -> matches
	// If only DOM is wildcard -> check DOW
	// If only DOW is wildcard -> check DOM
	// If neither is wildcard -> match if EITHER matches (union)
	if (parsed.hasDomWildcard && parsed.hasDowWildcard) {
		return true;
	}
	if (!parsed.hasDomWildcard && parsed.hasDowWildcard) {
		return parsed.daysOfMonth.includes(dom);
	}
	if (parsed.hasDomWildcard && !parsed.hasDowWildcard) {
		return parsed.daysOfWeek.includes(dow);
	}
	return parsed.daysOfMonth.includes(dom) || parsed.daysOfWeek.includes(dow);
}

/**
 * Computes the next occurrence Date strictly after `fromDate`, zeroing seconds and milliseconds
 */
export function getNextCronTime(
	parsedOrExpr: ParsedCronSchedule | string,
	fromDate: Date = new Date(),
): Date {
	const parsed = typeof parsedOrExpr === "string" ? parseCron(parsedOrExpr) : parsedOrExpr;

	const target = new Date(fromDate.getTime());
	target.setSeconds(0, 0);
	target.setMinutes(target.getMinutes() + 1);

	// Ensure target is strictly greater than fromDate
	if (target.getTime() <= fromDate.getTime()) {
		target.setMinutes(target.getMinutes() + 1);
	}

	// Maximum lookahead: 5 years (prevent infinite loops on impossible dates)
	const maxTime = fromDate.getTime() + 5 * 366 * 24 * 60 * 60 * 1000;

	while (target.getTime() <= maxTime) {
		const month = target.getMonth() + 1;
		if (!parsed.months.includes(month)) {
			// Fast forward to next month
			target.setDate(1);
			target.setHours(0, 0, 0, 0);
			target.setMonth(target.getMonth() + 1);
			continue;
		}

		const dom = target.getDate();
		const dow = target.getDay();

		let domDowMatch: boolean;
		if (parsed.hasDomWildcard && parsed.hasDowWildcard) {
			domDowMatch = true;
		} else if (!parsed.hasDomWildcard && parsed.hasDowWildcard) {
			domDowMatch = parsed.daysOfMonth.includes(dom);
		} else if (parsed.hasDomWildcard && !parsed.hasDowWildcard) {
			domDowMatch = parsed.daysOfWeek.includes(dow);
		} else {
			domDowMatch = parsed.daysOfMonth.includes(dom) || parsed.daysOfWeek.includes(dow);
		}

		if (!domDowMatch) {
			// Fast forward to next day
			target.setHours(0, 0, 0, 0);
			target.setDate(target.getDate() + 1);
			continue;
		}

		const hour = target.getHours();
		if (!parsed.hours.includes(hour)) {
			// Fast forward to next hour
			target.setMinutes(0, 0, 0);
			target.setHours(target.getHours() + 1);
			continue;
		}

		const minute = target.getMinutes();
		if (!parsed.minutes.includes(minute)) {
			target.setMinutes(target.getMinutes() + 1);
			continue;
		}

		return new Date(target.getTime());
	}

	throw new Error(`No matching cron time found within 5 years for expression: "${parsed.raw}"`);
}

/**
 * Formats a cron expression or duration into a friendly human-readable summary
 */
export function formatScheduleExpression(expr: string): string {
	const trimmed = expr.trim();
	try {
		// Test duration
		const ms = parseDuration(trimmed);
		if (ms < 1000) return `in ${ms}ms`;
		if (ms < 60000) return `in ${Math.round(ms / 1000)}s`;
		if (ms < 3600000) return `in ${Math.round(ms / 60000)}m`;
		if (ms < 86400000) return `in ${(ms / 3600000).toFixed(1)}h`;
		return `in ${(ms / 86400000).toFixed(1)}d`;
	} catch {
		// Try cron
		if (trimmed === "* * * * *") return "Every minute";
		if (trimmed === "0 * * * *") return "Every hour";
		if (trimmed === "0 0 * * *") return "Every day at 00:00";
		if (trimmed === "0 9 * * 1-5") return "Weekdays at 09:00";
		if (/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/.test(trimmed)) {
			const step = trimmed.match(/^\*\/(\d+)/)?.[1];
			return `Every ${step} minutes`;
		}
		return trimmed;
	}
}
