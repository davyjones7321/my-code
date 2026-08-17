import { describe, it, expect } from 'bun:test';
import { PathSandbox, Tool } from '../../src/control/sandbox.js';
import path from 'path';

describe('PathSandbox', () => {
  const root = path.resolve('/test/root');
  const sandbox = new PathSandbox(root);

  it('Allows paths within project root', () => {
    const res = sandbox.validatePath(path.resolve(root, 'src/file.ts'));
    expect(res.valid).toBe(true);
  });

  it('Blocks path traversal (../../etc/passwd)', () => {
    const res = sandbox.validatePath('../../etc/passwd');
    expect(res.valid).toBe(false);
    expect(res.reason).toContain('outside sandbox root');
  });

  it('Blocks absolute paths outside root (C:\\Windows\\System32 or /etc)', () => {
    const res = sandbox.validatePath('/etc/passwd');
    expect(res.valid).toBe(false);
  });

  it('Resolves relative paths correctly', () => {
    const res = sandbox.validatePath('src/file.ts');
    expect(res.valid).toBe(true);
    expect(res.resolvedPath).toBe(path.resolve(root, 'src/file.ts'));
  });

  it('wrapTool blocks tool execution on invalid path', async () => {
    const dummyTool: Tool = {
      name: 'test_tool',
      description: 'test',
      inputSchema: {},
      execute: async () => ({ success: true })
    };
    const wrapped = sandbox.wrapTool(dummyTool);
    const result = await wrapped.execute({ path: '../../etc/passwd' });
    expect(result.isError).toBe(true);
    expect(result.result).toContain('Error:');
  });

  it('wrapTool allows tool execution on valid path', async () => {
    const dummyTool: Tool = {
      name: 'test_tool',
      description: 'test',
      inputSchema: {},
      execute: async (input) => ({ success: true, input })
    };
    const wrapped = sandbox.wrapTool(dummyTool);
    const result = await wrapped.execute({ path: 'src/file.ts' });
    expect(result.success).toBe(true);
    expect(result.input.path).toBe(path.resolve(root, 'src/file.ts'));
  });
});
