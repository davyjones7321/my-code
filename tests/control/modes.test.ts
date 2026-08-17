import { describe, it, expect } from 'bun:test';
import { ModeController } from '../../src/control/modes.js';
import { Tool } from '../../src/control/sandbox.js';

describe('ModeController', () => {
  it('Default mode is build', () => {
    const controller = new ModeController();
    expect(controller.getMode()).toBe('build');
  });

  it('Plan mode allows read tools only', () => {
    const controller = new ModeController();
    controller.setMode('plan');
    expect(controller.isToolAllowed('read_file')).toBe(true);
    expect(controller.isToolAllowed('glob_files')).toBe(true);
    expect(controller.isToolAllowed('grep_search')).toBe(true);
  });

  it('Plan mode rejects write_file', () => {
    const controller = new ModeController();
    controller.setMode('plan');
    expect(controller.isToolAllowed('write_file')).toBe(false);
  });

  it('Plan mode rejects run_command', () => {
    const controller = new ModeController();
    controller.setMode('plan');
    expect(controller.isToolAllowed('run_command')).toBe(false);
  });

  it('Build mode allows all tools', () => {
    const controller = new ModeController();
    expect(controller.getMode()).toBe('build');
    expect(controller.isToolAllowed('write_file')).toBe(true);
    expect(controller.isToolAllowed('run_command')).toBe(true);
    expect(controller.isToolAllowed('read_file')).toBe(true);
  });

  it('Toggle switches between modes', () => {
    const controller = new ModeController();
    expect(controller.getMode()).toBe('build');
    controller.toggle();
    expect(controller.getMode()).toBe('plan');
    controller.toggle();
    expect(controller.getMode()).toBe('build');
  });

  it('filterTools returns correct subset', () => {
    const controller = new ModeController();
    controller.setMode('plan');
    const tools: Tool[] = [
      { name: 'read_file', description: '', inputSchema: {}, execute: async () => {} },
      { name: 'write_file', description: '', inputSchema: {}, execute: async () => {} },
      { name: 'run_command', description: '', inputSchema: {}, execute: async () => {} }
    ];
    const filtered = controller.filterTools(tools);
    expect(filtered.length).toBe(1);
    expect(filtered[0].name).toBe('read_file');
  });
});
