import { describe, it, expect } from 'bun:test';
import { ControlLayer } from '../../src/control/index.js';
import path from 'path';

describe('ControlLayer Integration', () => {
  const root = path.resolve('/test/project');

  it('ControlLayer blocks write_file in plan mode', async () => {
    const control = new ControlLayer({ approvalMode: 'auto', projectRoot: root });
    control.getModeController().setMode('plan');
    
    const result = await control.checkToolCall('write_file', { path: 'src/file.ts' });
    expect(result.permitted).toBe(false);
    expect(result.reason).toContain('not allowed in plan mode');
  });

  it('ControlLayer blocks rm -rf in auto mode build', async () => {
    const control = new ControlLayer({ approvalMode: 'auto', projectRoot: root });
    const result = await control.checkToolCall('run_command', { command: 'rm -rf /' });
    expect(result.permitted).toBe(false);
    expect(result.reason).toContain('denied by safety policies');
  });

  it('ControlLayer allows read_file in both modes', async () => {
    const control = new ControlLayer({ approvalMode: 'auto', projectRoot: root });
    
    // build mode
    let result = await control.checkToolCall('read_file', { path: 'src/file.ts' });
    expect(result.permitted).toBe(true);
    
    // plan mode
    control.getModeController().setMode('plan');
    result = await control.checkToolCall('read_file', { path: 'src/file.ts' });
    expect(result.permitted).toBe(true);
  });

  it('ControlLayer validates paths before approval check', async () => {
    const control = new ControlLayer({ approvalMode: 'auto', projectRoot: root });
    const result = await control.checkToolCall('read_file', { path: '../../etc/passwd' });
    expect(result.permitted).toBe(false);
    expect(result.reason).toContain('outside sandbox root');
  });

  it('Path traversal blocked even in yolo mode', async () => {
    const control = new ControlLayer({ approvalMode: 'yolo', projectRoot: root });
    const result = await control.checkToolCall('read_file', { path: '../../etc/passwd' });
    expect(result.permitted).toBe(false);
    expect(result.reason).toContain('outside sandbox root');
  });
});
