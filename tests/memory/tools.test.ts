import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { MemoryStore } from '../../src/memory/store.ts';
import { MemoryAPI } from '../../src/memory/api.ts';
import { createRememberTool, createRecallTool } from '../../src/memory/tools.ts';

describe('MemoryTools', () => {
  let dbPath: string;
  let store: MemoryStore;
  let api: MemoryAPI;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `harness-test-tools-${Date.now()}-${Math.random()}.db`);
    store = new MemoryStore(dbPath);
    api = new MemoryAPI(store);
  });

  afterEach(() => {
    try {
      store.close();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      const wal = dbPath + '-wal';
      const shm = dbPath + '-shm';
      if (fs.existsSync(wal)) fs.unlinkSync(wal);
      if (fs.existsSync(shm)) fs.unlinkSync(shm);
    } catch (e) {}
  });

  it('remember_fact tool stores and confirms', async () => {
    const tool = createRememberTool(api);
    const result = await tool.execute({ content: 'test tool fact' });
    expect(result.isError).toBe(false);
    expect(result.result).toContain('successfully remembered');
    
    expect(api.getStore().getFacts().length).toBe(1);
  });

  it('recall_facts tool returns matching facts', async () => {
    api.remember('match me please');
    const tool = createRecallTool(api);
    const result = await tool.execute({ query: 'match' });
    expect(result.isError).toBe(false);
    expect(result.result).toBe('match me please');
  });

  it('recall_facts returns No matching facts when empty', async () => {
    const tool = createRecallTool(api);
    const result = await tool.execute({ query: 'unknown' });
    expect(result.isError).toBe(false);
    expect(result.result).toBe('No matching facts found.');
  });
});
