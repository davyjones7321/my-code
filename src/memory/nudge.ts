export interface NudgeConfig {
  /** How many turns between nudge checks */
  intervalTurns: number;
  /** Whether nudges are enabled */
  enabled: boolean;
}

export class MemoryNudge {
  private turnCount: number = 0;
  private config: NudgeConfig;
  
  constructor(config?: Partial<NudgeConfig>) {
    this.config = {
      intervalTurns: config?.intervalTurns ?? 10,
      enabled: config?.enabled ?? true,
    };
  }
  
  /** Track a turn. Returns a nudge message if it's time to nudge. */
  tick(): string | null {
    this.turnCount++;
    if (this.config.enabled && this.turnCount % this.config.intervalTurns === 0) {
      return this.generateNudge();
    }
    return null;
  }
  
  /** Generate a nudge message to inject into context */
  private generateNudge(): string {
    return `[System Note: You've completed ${this.turnCount} turns in this session. ` +
      `If you've learned anything important about the project, codebase conventions, ` +
      `user preferences, or key decisions, consider using the remember_fact tool to ` +
      `save it for future sessions.]`;
  }
  
  /** Reset turn counter (e.g., on new session) */
  reset(): void {
    this.turnCount = 0;
  }
}
