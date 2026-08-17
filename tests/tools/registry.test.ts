import { describe, it, expect } from 'bun:test';
import { ToolRegistry, type Tool, type ToolResult } from '../../src/tools/registry.ts';

describe('ToolRegistry', () => {
  const dummyTool: Tool = {
    name: 'test_tool',
    description: 'A test tool',
    inputSchema: { type: 'object', properties: {} },
    execute: async (): Promise<ToolResult> => ({ result: 'success', isError: false })
  };

  it('registers and gets a tool', () => {
    const registry = new ToolRegistry();
    registry.register(dummyTool);
    
    expect(registry.get('test_tool')).toBe(dummyTool);
    expect(registry.get('non_existent')).toBeUndefined();
    expect(registry.list()).toEqual(['test_tool']);
  });

  it('getDefinitions returns correct format', () => {
    const registry = new ToolRegistry();
    registry.register(dummyTool);
    
    const defs = registry.getDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0]).toEqual({
      name: 'test_tool',
      description: 'A test tool',
      inputSchema: { type: 'object', properties: {} }
    });
  });

  it('getExecutors returns working executors', async () => {
    const registry = new ToolRegistry();
    registry.register(dummyTool);
    
    const executors = registry.getExecutors();
    expect(executors).toHaveLength(1);
    expect(executors[0].name).toBe('test_tool');
    
    const result = await executors[0].execute({});
    expect(result).toEqual({ result: 'success', isError: false });
  });
});
