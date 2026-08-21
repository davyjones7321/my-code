import type { HarnessSession } from "../sdk/session.ts";
import { VerificationEngine } from "./engine.ts";
import type {
	SelfHealingOptions,
	SelfHealingResult,
	VerificationReport,
} from "./types.ts";

export class SelfHealingCoordinator {
	private engine: VerificationEngine;
	private maxRounds: number;
	private projectRoot: string;

	constructor(options: SelfHealingOptions = {}) {
		this.projectRoot = options.projectRoot || process.cwd();
		this.maxRounds = options.maxRounds || 3;
		this.engine = new VerificationEngine(this.projectRoot, options.checks);
	}

	public getVerificationEngine(): VerificationEngine {
		return this.engine;
	}

	/**
	 * Formats verification failure report into a structured agent remediation prompt.
	 */
	public formatFeedbackPrompt(report: VerificationReport, round: number): string {
		const lines: string[] = [
			`⚠️ AUTOMATED QUALITY GATE FAILURE (Self-Healing Round ${round}/${this.maxRounds})`,
			`Your recent changes introduced code quality errors or broken tests. Please fix the following errors immediately:`,
			"",
		];

		for (const res of report.results) {
			if (!res.passed) {
				lines.push(`❌ Failed Check: ${res.name}`);
				if (res.diagnostics.length > 0) {
					for (const diag of res.diagnostics) {
						lines.push(
							`   • ${diag.file ? `[${diag.file}:${diag.line || 1}:${diag.column || 1}] ` : ""}${diag.message}`,
						);
					}
				} else if (res.output) {
					lines.push(`   Output:\n${res.output.slice(0, 1000)}`);
				}
				lines.push("");
			}
		}

		lines.push(
			"Instructions: Inspect the error locations above, edit the broken files to resolve the issue, and ensure all compiler/test failures are resolved.",
		);

		return lines.join("\n");
	}

	/**
	 * Runs verification and enters iterative repair turn loops with the session until clean or maxRounds exhausted.
	 */
	public async runSelfHealingLoop(
		session: HarnessSession,
		initialPrompt: string,
	): Promise<SelfHealingResult> {
		const roundHistory: SelfHealingResult["roundHistory"] = [];
		let currentRound = 0;

		// 1. Initial turn execution
		await session.send(initialPrompt);

		while (currentRound < this.maxRounds) {
			currentRound++;

			// 2. Run verification check
			const report = await this.engine.verify();
			roundHistory.push({
				round: currentRound,
				report,
			});

			if (report.allPassed) {
				return {
					success: true,
					totalRounds: currentRound,
					finalReport: report,
					repaired: currentRound > 1,
					roundHistory,
				};
			}

			// 3. If failed and we have remaining rounds, send feedback prompt to session
			if (currentRound < this.maxRounds) {
				const feedbackPrompt = this.formatFeedbackPrompt(report, currentRound);
				roundHistory[roundHistory.length - 1].feedbackPrompt = feedbackPrompt;
				await session.send(feedbackPrompt);
			}
		}

		// Final check after maxRounds
		const finalReport = await this.engine.verify();
		return {
			success: finalReport.allPassed,
			totalRounds: currentRound,
			finalReport,
			repaired: false,
			roundHistory,
		};
	}
}
