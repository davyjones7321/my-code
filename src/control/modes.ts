import { Tool } from './sandbox.js';

export type AgentMode = 'plan' | 'build';

/** Tools allowed in each mode */
const PLAN_MODE_TOOLS = ['read_file', 'glob_files', 'grep_search'];
const BUILD_MODE_TOOLS = ['read_file', 'glob_files', 'grep_search', 'write_file', 'edit_file', 'run_command'];

export class ModeController {
  private mode: AgentMode = 'build';
  
  /**
   * Get current mode
   * @returns Current mode
   */
  getMode(): AgentMode {
    return this.mode;
  }
  
  /**
   * Set mode
   * @param mode New mode
   */
  setMode(mode: AgentMode): void {
    this.mode = mode;
  }
  
  /**
   * Toggle between modes
   * @returns New mode
   */
  toggle(): AgentMode {
    this.mode = this.mode === 'plan' ? 'build' : 'plan';
    return this.mode;
  }
  
  /**
   * Check if a tool is allowed in the current mode
   * @param toolName Name of the tool
   * @returns True if allowed
   */
  isToolAllowed(toolName: string): boolean {
    const allowed = this.getAllowedTools();
    return allowed.includes(toolName);
  }
  
  /**
   * Filter a list of tools to only those allowed in current mode
   * @param tools List of tools to filter
   * @returns Filtered list
   */
  filterTools(tools: Tool[]): Tool[] {
    return tools.filter(t => this.isToolAllowed(t.name));
  }
  
  /**
   * Get list of allowed tool names for current mode
   * @returns List of allowed tool names
   */
  getAllowedTools(): string[] {
    return this.mode === 'plan' ? PLAN_MODE_TOOLS : BUILD_MODE_TOOLS;
  }
}
