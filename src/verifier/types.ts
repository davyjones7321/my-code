export interface VerificationDiagnostic {
	file?: string;
	line?: number;
	column?: number;
	message: string;
	code?: string | number;
	severity: "error" | "warning" | "info";
}

export interface VerificationResult {
	name: string;
	passed: boolean;
	durationMs: number;
	diagnostics: VerificationDiagnostic[];
	output?: string;
}

export interface VerificationCheck {
	name: string;
	description: string;
	run(projectRoot: string): Promise<VerificationResult>;
}

export interface VerificationReport {
	allPassed: boolean;
	totalDurationMs: number;
	passedCount: number;
	failedCount: number;
	results: VerificationResult[];
	summary: string;
}

export interface SelfHealingOptions {
	maxRounds?: number;
	checks?: VerificationCheck[];
	autoRollbackOnFailure?: boolean;
	projectRoot?: string;
}

export interface SelfHealingResult {
	success: boolean;
	totalRounds: number;
	finalReport: VerificationReport;
	repaired: boolean;
	roundHistory: {
		round: number;
		report: VerificationReport;
		feedbackPrompt?: string;
	}[];
}
