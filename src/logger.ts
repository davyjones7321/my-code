import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import { getConfigDir } from "./config/index.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
	timestamp: string;
	level: LogLevel;
	message: string;
	data?: any;
}

export class Logger {
	private logFile: string;

	constructor() {
		const logDir = path.join(getConfigDir(), "logs");
		if (!fs.existsSync(logDir)) {
			fs.mkdirSync(logDir, { recursive: true });
		}
		this.logFile = path.join(logDir, "harness.log");
	}

	private log(level: LogLevel, message: string, data?: any) {
		const entry: LogEntry = {
			timestamp: new Date().toISOString(),
			level,
			message,
			data,
		};

		// Console output
		let color = chalk.white;
		switch (level) {
			case "debug":
				color = chalk.gray;
				break;
			case "info":
				color = chalk.blue;
				break;
			case "warn":
				color = chalk.yellow;
				break;
			case "error":
				color = chalk.red;
				break;
		}

		const consoleMsg = `[${entry.timestamp}] ${level.toUpperCase()}: ${message}`;
		if (data) {
			console.log(color(consoleMsg), data);
		} else {
			console.log(color(consoleMsg));
		}

		// File output (append JSON lines)
		fs.appendFileSync(this.logFile, JSON.stringify(entry) + "\n", "utf8");
	}

	debug(message: string, data?: any) {
		this.log("debug", message, data);
	}
	info(message: string, data?: any) {
		this.log("info", message, data);
	}
	warn(message: string, data?: any) {
		this.log("warn", message, data);
	}
	error(message: string, data?: any) {
		this.log("error", message, data);
	}
}

export const logger = new Logger();
