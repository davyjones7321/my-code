export type PonytailIntensity = "lite" | "full" | "ultra";

export interface PonytailState {
	enabled: boolean;
	intensity: PonytailIntensity;
}

export class PonytailEngine {
	private state: PonytailState = {
		enabled: true,
		intensity: "full",
	};

	public setIntensity(intensity: PonytailIntensity): void {
		this.state.intensity = intensity;
		this.state.enabled = true;
	}

	public setEnabled(enabled: boolean): void {
		this.state.enabled = enabled;
	}

	public getState(): PonytailState {
		return { ...this.state };
	}

	/** Generate system prompt directive for Ponytail mode */
	public getSystemPromptDirective(): string {
		if (!this.state.enabled) return "";

		const intensityRules =
			this.state.intensity === "ultra"
				? "EXTREME PONYTAIL MODE (ULTRA): Question every single line of code. If it can be done in 1 line with stdlib, delete the 50 lines. Remove all unneeded dependencies, speculative abstractions, and dead code aggressively."
				: this.state.intensity === "lite"
					? "PONYTAIL MODE (LITE): Prefer simple stdlib solutions and avoid adding new dependencies unless strictly necessary."
					: "PONYTAIL MODE (FULL): Enforce YAGNI (You Aren't Gonna Need It). Reach for standard library APIs before dependencies. Write the shortest, simplest solution that works. Cut over-engineering.";

		return `\n\n✂️ ${intensityRules}\n`;
	}

	/** Generate review checklist for /ponytail-review */
	public generateReviewPrompt(filesSummary: string): string {
		return `Review the following code for over-engineering based on Ponytail principles:
1. What can be deleted?
2. Are there reinvented standard library functions?
3. Are there unneeded third-party dependencies?
4. Are there speculative abstractions or unused flexibility?

Code Summary:
${filesSummary}
`;
	}

	/** Generate audit checklist for /ponytail-audit */
	public generateAuditPrompt(projectRoot: string): string {
		return `Perform a whole-repository Ponytail audit for over-engineering on '${projectRoot}':
- Ranked list of what to delete, simplify, or replace with stdlib/native equivalents.
- Unnecessary package dependencies.
- Dead code or unused utility functions.
`;
	}
}

export const globalPonytailEngine = new PonytailEngine();
