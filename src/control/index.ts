import { ApprovalGate, ApprovalMode } from './approval.js';
import { PathSandbox } from './sandbox.js';
import { ModeController } from './modes.js';

export interface ControlConfig {
  approvalMode: ApprovalMode;
  projectRoot: string;
}

/** Combines approval gate, sandbox, and mode control into a single guard */
export class ControlLayer {
  private approval: ApprovalGate;
  private sandbox: PathSandbox;
  private modeController: ModeController;
  
  /**
   * Create a new ControlLayer
   * @param config Configuration for control layer
   */
  constructor(config: ControlConfig) {
    this.approval = new ApprovalGate(config.approvalMode);
    this.sandbox = new PathSandbox(config.projectRoot);
    this.modeController = new ModeController();
  }
  
  /**
   * Check if a tool call is permitted (mode + approval + sandbox)
   * @param toolName The name of the tool
   * @param toolInput The input arguments for the tool
   * @returns Result indicating if permitted and sanitized input
   */
  async checkToolCall(toolName: string, toolInput: Record<string, unknown>): Promise<{
    permitted: boolean;
    reason?: string;
    sanitizedInput?: Record<string, unknown>;
  }> {
    // 1. Check mode
    if (!this.modeController.isToolAllowed(toolName)) {
      return { permitted: false, reason: `Tool ${toolName} is not allowed in ${this.modeController.getMode()} mode` };
    }
    
    // 2. Check sandbox
    const sanitizedInput = { ...toolInput };
    
    for (const key of ['path', 'TargetFile', 'directory']) {
      if (typeof sanitizedInput[key] === 'string') {
        const validation = this.sandbox.validatePath(sanitizedInput[key] as string);
        if (!validation.valid) {
          return { permitted: false, reason: validation.reason };
        }
        sanitizedInput[key] = validation.resolvedPath;
      }
    }
    
    // 3. Check approval
    const decision = this.approval.check({
      toolName,
      toolInput: sanitizedInput
    });
    
    if (decision === 'deny') {
      return { permitted: false, reason: `Tool ${toolName} was denied by safety policies` };
    }
    
    if (decision === 'ask_user') {
      return { permitted: false, reason: 'ask_user' };
    }
    
    // 4. Approved
    return { permitted: true, sanitizedInput };
  }
  
  /**
   * Get the mode controller for mode switching
   * @returns The mode controller
   */
  getModeController(): ModeController {
    return this.modeController;
  }
  
  /**
   * Get approval gate for mode changes
   * @returns The approval gate
   */
  getApprovalGate(): ApprovalGate {
    return this.approval;
  }
}

export * from './approval.js';
export * from './sandbox.js';
export * from './modes.js';
