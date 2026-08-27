export interface GuardrailResult {
	permitted: boolean;
	isDestructive: boolean;
	ruleName?: string;
	reason?: string;
}

export class CommandGuardrails {
	private enabled = true;

	private dangerousPatterns: { pattern: RegExp; ruleName: string; reason: string }[] = [
		{
			pattern: /git\s+reset\s+--hard/i,
			ruleName: "Git Hard Reset Protection",
			reason: "Destructive git operation: 'git reset --hard' discards uncommitted changes permanently.",
		},
		{
			pattern: /git\s+push\s+.*(?:--force|-f\b)/i,
			ruleName: "Git Force Push Protection",
			reason: "Destructive git operation: 'git push --force' can overwrite remote history for teammates.",
		},
		{
			pattern: /git\s+clean\s+.*-f/i,
			ruleName: "Git Clean Protection",
			reason: "Destructive git operation: 'git clean -f' permanently deletes untracked files.",
		},
		{
			pattern: /rm\s+-rf\s+[\/\*~]/i,
			ruleName: "Recursive Directory Deletion Protection",
			reason: "High-risk system operation: 'rm -rf' on root or directory trees causes irreversible data loss.",
		},
		{
			pattern: /Remove-Item\s+.*-Recurse\s+.*-Force/i,
			ruleName: "PowerShell Recursive Force Deletion Protection",
			reason: "High-risk system operation: 'Remove-Item -Recurse -Force' causes irreversible data loss.",
		},
		{
			pattern: /\b(?:format|diskpart)\b/i,
			ruleName: "Disk Partition Formatting Protection",
			reason: "Critical OS security policy: Disk formatting commands are blocked.",
		},
	];

	public setEnabled(enabled: boolean): void {
		this.enabled = enabled;
	}

	public isEnabled(): boolean {
		return this.enabled;
	}

	/** Check if a command violates security guardrails */
	public checkCommand(command: string): GuardrailResult {
		if (!this.enabled || !command) {
			return { permitted: true, isDestructive: false };
		}

		for (const { pattern, ruleName, reason } of this.dangerousPatterns) {
			if (pattern.test(command.trim())) {
				return {
					permitted: false,
					isDestructive: true,
					ruleName,
					reason,
				};
			}
		}

		return { permitted: true, isDestructive: false };
	}
}

export const globalCommandGuardrails = new CommandGuardrails();
