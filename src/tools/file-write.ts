import fs from 'node:fs';
import path from 'node:path';
import type { Tool, ToolResult } from './registry.ts';

export function createFileWriteTool(projectRoot: string): Tool {
  return {
    name: 'write_file',
    description: 'Write content to a file, creating parent directories if needed',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
    async execute(input: Record<string, unknown>): Promise<ToolResult> {
      try {
        const relativePath = input.path as string;
        const content = input.content as string;
        
        const absolutePath = path.resolve(projectRoot, relativePath);
        
        if (!absolutePath.startsWith(projectRoot)) {
          return { result: 'Error: Permission denied', isError: true };
        }
        
        const dir = path.dirname(absolutePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        
        fs.writeFileSync(absolutePath, content, 'utf-8');
        
        const bytes = Buffer.byteLength(content, 'utf-8');
        return { result: `Successfully wrote ${bytes} bytes to ${relativePath}`, isError: false };
      } catch (err: any) {
        return { result: `Error: ${err.message}`, isError: true };
      }
    }
  };
}
