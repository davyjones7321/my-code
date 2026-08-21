import { createTypecheckCheck } from "./checks/typecheck.ts";
import type {
	VerificationCheck,
	VerificationReport,
	VerificationResult,
} from "./types.ts";

export class VerificationEngine {
	private checks: Map<string, VerificationCheck> = new Map();
	private projectRoot: string;

	constructor(projectRoot: string = process.cwd(), checks?: VerificationCheck[]) {
		this.projectRoot = projectRoot;
		if (checks && checks.length > 0) {
			for (const check of checks) {
				this.registerCheck(check);
			}
		} else {
			// Register default typecheck check
			this.registerCheck(createTypecheckCheck());
		}
	}

	public registerCheck(check: VerificationCheck): void {
		this.checks.set(check.name, check);
	}

	public unregisterCheck(name: string): boolean {
		return this.checks.delete(name);
	}

	public getCheck(name: string): VerificationCheck | undefined {
		return this.checks.get(name);
	}

	public listChecks(): VerificationCheck[] {
		return Array.from(this.checks.values());
	}

	/**
	 * Runs registered verification checks sequentially or in parallel.
	 */
	public async verify(options?: { parallel?: boolean }): Promise<VerificationReport> {
		const startTime = Date.now();
		const checkList = Array.from(this.checks.values());
		const results: VerificationResult[] = [];

		if (options?.parallel) {
			const checkPromises = checkList.map((check) => check.run(this.projectRoot));
			const settled = await Promise.allSettled(checkPromises);
			for (let i = 0; i < settled.length; i++) {
				const item = settled[i];
				if (item.status === "fulfilled") {
					results.push(item.value);
				} else {
					results.push({
						name: checkList[i].name,
						passed: false,
						durationMs: 0,
						diagnostics: [{ message: String(item.reason), severity: "error" }],
					});
				}
			}
		} else {
			for (const check of checkList) {
				const res = await check.run(this.projectRoot);
				results.push(res);
			}
		}

		const totalDurationMs = Date.now() - startTime;
		const passedCount = results.filter((r) => r.passed).length;
		const failedCount = results.length - passedCount;
		const allPassed = failedCount === 0;

		const summaryLines: string[] = [
			allPassed
				? `✅ Verification Passed (${passedCount}/${results.length} checks passed in ${totalDurationMs}ms)`
				: `❌ Verification Failed (${failedCount}/${results.length} checks failed in ${totalDurationMs}ms)`,
		];

		for (const res of results) {
			const badge = res.passed ? "✔️ PASS" : "❌ FAIL";
			summaryLines.push(`  - [${badge}] ${res.name} (${res.durationMs}ms)`);
			if (!res.passed && res.diagnostics.length > 0) {
				for (const diag of res.diagnostics.slice(0, 5)) {
					summaryLines.push(`      • ${diag.file ? `${diag.file}:${diag.line}:${diag.column} ` : ""}${diag.message}`);
				}
				if (res.diagnostics.length > 5) {
					summaryLines.push(`      ... plus ${res.diagnostics.length - 5} more diagnostic messages.`);
				}
			}
		}

		return {
			allPassed,
			totalDurationMs,
			passedCount,
			failedCount,
			results,
			summary: summaryLines.join("\n"),
		};
	}
}
