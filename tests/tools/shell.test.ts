import { describe, it, expect } from 'bun:test';
import { createShellTool } from '../../src/tools/shell.ts';
import path from 'node:path';

describe('Shell Tool', () => {
  const isWindows = process.platform === 'win32';
  
  it('runs a simple command', async () => {
    const tool = createShellTool(process.cwd());
    const res = await tool.execute({ command: isWindows ? 'echo hello' : 'echo "hello"' });
    expect(res.isError).toBe(false);
    expect(res.result).toContain('hello');
  });

  it('captures exit code on failure', async () => {
    const tool = createShellTool(process.cwd());
    const res = await tool.execute({ command: isWindows ? 'exit 1' : 'exit 1' });
    expect(res.isError).toBe(true);
    expect(res.result).toContain('Exit Code: 1');
  });

  it('timeout kills long-running process', async () => {
    const tool = createShellTool(process.cwd());
    const command = 'powershell.exe -Command "Start-Sleep -Seconds 10"';
    const res = await tool.execute({ command, timeout: 500 });
    expect(res.isError).toBe(true);
    expect(res.result).toContain('timed out');
  });
});
