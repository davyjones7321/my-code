export type ApprovalMode = 'auto' | 'manual' | 'yolo';

export type ApprovalDecision = 'approve' | 'deny' | 'ask_user';

export interface ApprovalRequest {
  toolName: string;
  toolInput: Record<string, unknown>;
  reason?: string;
}

export interface ApprovalResult {
  approved: boolean;
  reason?: string;
}

/** Patterns that indicate dangerous operations */
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /rm\s+(-rf?|--recursive)/, description: 'Recursive delete' },
  { pattern: /rm\s+-[a-z]*f/, description: 'Force delete' },
  { pattern: /rmdir\s+\/s/, description: 'Windows recursive delete' },
  { pattern: /del\s+\/[sfq]/i, description: 'Windows force delete' },
  { pattern: /git\s+push.*--force/, description: 'Force push' },
  { pattern: /git\s+reset\s+--hard/, description: 'Hard reset' },
  { pattern: /git\s+clean\s+-[a-z]*f/, description: 'Git clean force' },
  { pattern: /chmod\s+777/, description: 'World-writable permissions' },
  { pattern: /curl.*\|\s*(bash|sh)/, description: 'Pipe to shell' },
  { pattern: />(\s*\/etc\/|\s*~\/)/, description: 'Write to system/home files' },
  { pattern: /format\s+[a-z]:/i, description: 'Format disk' },
  { pattern: /:\(\){ :\|:& };:/, description: 'Fork bomb' },
  { pattern: /shutdown|reboot|halt/i, description: 'System shutdown' },
];

/** Safe tool names that never need approval */
const SAFE_TOOLS = ['read_file', 'glob_files', 'grep_search'];

/** Tools that always need approval in auto mode */
const ALWAYS_ASK_TOOLS = ['run_command'];

export class ApprovalGate {
  /**
   * Create a new ApprovalGate
   * @param mode The initial approval mode
   */
  constructor(private mode: ApprovalMode) {}
  
  /**
   * Check if a tool call should be approved
   * @param request The tool call request
   * @returns The approval decision
   */
  check(request: ApprovalRequest): ApprovalDecision {
    if (this.mode === 'yolo') {
      return 'approve';
    }
    
    if (this.mode === 'manual') {
      return 'ask_user';
    }
    
    // auto mode
    if (SAFE_TOOLS.includes(request.toolName)) {
      return 'approve';
    }
    
    if (request.toolName === 'write_file' || request.toolName === 'edit_file') {
      return 'approve';
    }
    
    if (request.toolName === 'run_command') {
      const command = String(request.toolInput?.command || request.toolInput?.commandLine || '');
      const dangerousCheck = this.isDangerous(command);
      if (dangerousCheck.dangerous) {
        return 'deny';
      }
      return 'approve';
    }
    
    return 'ask_user';
  }
  
  /**
   * Check if a command string contains dangerous patterns
   * @param command The command string to check
   * @returns Result indicating if dangerous and why
   */
  isDangerous(command: string): { dangerous: boolean; reason?: string } {
    for (const { pattern, description } of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        return { dangerous: true, reason: description };
      }
    }
    return { dangerous: false };
  }
  
  /**
   * Change the approval mode
   * @param mode The new mode
   */
  setMode(mode: ApprovalMode): void {
    this.mode = mode;
  }
}
