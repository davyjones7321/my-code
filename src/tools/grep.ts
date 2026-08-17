import { spawn } from 'bun';
import path from 'node:path';
import fs from 'node:fs';
import type { Tool, ToolResult } from './registry.ts';

export function createGrepTool(projectRoot: string): Tool {
  return {
    name: 'grep_search',
    description: 'Search for text in files',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        path: { type: 'string' },
        includePattern: { type: 'string' },
      },
      required: ['query'],
    },
    async execute(input: Record<string, unknown>): Promise<ToolResult> {
      try {
        const query = input.query as string;
        const relativePath = input.path as string | undefined;
        const includePattern = input.includePattern as string | undefined;
        
        const searchDir = relativePath ? path.resolve(projectRoot, relativePath) : projectRoot;
        
        if (!searchDir.startsWith(projectRoot)) {
          return { result: 'Error: Permission denied', isError: true };
        }
        
        try {
          const args = ['rg', '--line-number', '--json', query];
          if (includePattern) {
            args.push('-g', includePattern);
          }
          args.push(searchDir);

          const proc = spawn(args, {
            stdout: 'pipe',
            stderr: 'ignore',
          });

          const stdout = await new Response(proc.stdout).text();
          const exitCode = await proc.exited;

          if (exitCode === 0 || exitCode === 1) { // 1 means no matches for rg
            const matches: string[] = [];
            const lines = stdout.split('\n').filter(Boolean);
            
            for (const line of lines) {
              try {
                const parsed = JSON.parse(line);
                if (parsed.type === 'match') {
                  const filePath = parsed.data.path.text;
                  const lineNum = parsed.data.line_number;
                  const text = parsed.data.lines.text.trimEnd();
                  matches.push(`${filePath}:${lineNum}: ${text}`);
                  if (matches.length >= 50) {
                    matches.push('... (results truncated to 50 entries)');
                    break;
                  }
                }
              } catch {
                // Ignore parse errors
              }
            }
            
            if (matches.length === 0) {
              return { result: 'No matches found', isError: false };
            }
            return { result: matches.join('\n'), isError: false };
          }
        } catch (e) {
          // rg not found or failed, fallback to basic JS search (not fully implemented for brevity)
          // As per requirements: "If rg not available, do a recursive file search with string matching"
        }

        // Basic JS fallback
        const matches: string[] = [];
        const scanDir = async (dir: string) => {
          if (matches.length >= 50) return;
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (matches.length >= 50) return;
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
                await scanDir(fullPath);
              }
            } else {
              try {
                const content = fs.readFileSync(fullPath, 'utf-8');
                const lines = content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                  if (lines[i].includes(query)) {
                    const relPath = path.relative(projectRoot, fullPath);
                    matches.push(`${relPath}:${i + 1}: ${lines[i]}`);
                    if (matches.length >= 50) {
                      matches.push('... (results truncated to 50 entries)');
                      return;
                    }
                  }
                }
              } catch {
                // Ignore unreadable files
              }
            }
          }
        };

        if (fs.existsSync(searchDir)) {
          const stat = fs.statSync(searchDir);
          if (stat.isDirectory()) {
            await scanDir(searchDir);
          } else {
            // single file
             const content = fs.readFileSync(searchDir, 'utf-8');
             const lines = content.split('\n');
             for (let i = 0; i < lines.length; i++) {
               if (lines[i].includes(query)) {
                 const relPath = path.relative(projectRoot, searchDir);
                 matches.push(`${relPath}:${i + 1}: ${lines[i]}`);
                 if (matches.length >= 50) break;
               }
             }
          }
        }
        
        if (matches.length === 0) {
          return { result: 'No matches found', isError: false };
        }
        return { result: matches.join('\n'), isError: false };
        
      } catch (err: any) {
        return { result: `Error: ${err.message}`, isError: true };
      }
    }
  };
}
