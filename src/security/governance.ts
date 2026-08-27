import * as fs from "node:fs";
import * as path from "node:path";
import { getConfigDir } from "../config/index.ts";

export interface AuditEvent {
	timestamp: string;
	eventType: "tool_execution" | "injection_detected" | "guardrail_blocked" | "system_event";
	detail: string;
	severity: "info" | "warning" | "critical";
}

export class GovernanceAuditLogger {
	private auditLogPath: string;

	constructor() {
		const configDir = getConfigDir();
		if (!fs.existsSync(configDir)) {
			fs.mkdirSync(configDir, { recursive: true });
		}
		this.auditLogPath = path.join(configDir, "audit.log");
	}

	public logEvent(eventType: AuditEvent["eventType"], detail: string, severity: AuditEvent["severity"] = "info"): void {
		const timestamp = new Date().toISOString();
		const entry = `[${timestamp}] [${severity.toUpperCase()}] [${eventType}] ${detail}\n`;

		try {
			fs.appendFileSync(this.auditLogPath, entry, "utf8");
		} catch {
			// Ignore logging errors
		}
	}

	public getRecentLogs(limit: number = 20): string[] {
		if (!fs.existsSync(this.auditLogPath)) {
			return [];
		}

		try {
			const content = fs.readFileSync(this.auditLogPath, "utf8");
			const lines = content.split("\n").filter((l) => l.trim().length > 0);
			return lines.slice(-limit);
		} catch {
			return [];
		}
	}

	public getAuditLogPath(): string {
		return this.auditLogPath;
	}
}

export const globalAuditLogger = new GovernanceAuditLogger();
