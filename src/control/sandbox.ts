import path from 'path';

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: Record<string, unknown>): Promise<any>;
}

export class PathSandbox {
  private allowedRoot: string;

  /**
   * Create a new PathSandbox
   * @param allowedRoot The root directory to restrict paths to
   */
  constructor(allowedRoot: string) {
    this.allowedRoot = path.resolve(allowedRoot);
  }
  
  /**
   * Resolve a path and check if it's within the allowed root
   * @param inputPath The path to check
   * @returns Result indicating if valid and the resolved path
   */
  validatePath(inputPath: string): { valid: boolean; resolvedPath: string; reason?: string } {
    // Resolve relative to allowedRoot (or absolute if it is already absolute)
    // Actually, path.resolve with allowedRoot as base? 
    // Wait, path.resolve(inputPath) will resolve against CWD. We should resolve relative to allowedRoot if it's relative.
    const resolvedPath = path.isAbsolute(inputPath) 
      ? path.normalize(inputPath) 
      : path.resolve(this.allowedRoot, inputPath);
      
    if (!resolvedPath.startsWith(this.allowedRoot)) {
      return { valid: false, resolvedPath, reason: `Path is outside sandbox root: ${this.allowedRoot}` };
    }
    
    return { valid: true, resolvedPath };
  }
  
  /**
   * Wrap a tool to enforce path sandboxing
   * @param tool The tool to wrap
   * @returns A wrapped tool
   */
  wrapTool(tool: Tool): Tool {
    return {
      ...tool,
      execute: async (input: Record<string, unknown>) => {
        const sanitizedInput = { ...input };
        if (typeof sanitizedInput.path === 'string') {
          const validation = this.validatePath(sanitizedInput.path);
          if (!validation.valid) {
            return { result: `Error: ${validation.reason}`, isError: true };
          }
          sanitizedInput.path = validation.resolvedPath;
        }
        // Also check TargetFile for write_file tool style
        if (typeof sanitizedInput.TargetFile === 'string') {
          const validation = this.validatePath(sanitizedInput.TargetFile);
          if (!validation.valid) {
            return { result: `Error: ${validation.reason}`, isError: true };
          }
          sanitizedInput.TargetFile = validation.resolvedPath;
        }
        return tool.execute(sanitizedInput);
      }
    };
  }
}
