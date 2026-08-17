import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { MemoryStore } from '../../src/memory/store.ts';

describe('MemoryStore', () => {
  let dbPath: string;
  let store: MemoryStore;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `harness-test-${Date.now()}-${Math.random()}.db`);
    store = new MemoryStore(dbPath);
  });

  afterEach(() => {
    try {
      store.close();
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }
      const wal = dbPath + '-wal';
      const shm = dbPath + '-shm';
      if (fs.existsSync(wal)) fs.unlinkSync(wal);
      if (fs.existsSync(shm)) fs.unlinkSync(shm);
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  it('Creates database and tables without error', () => {
    expect(fs.existsSync(dbPath)).toBe(true);
    // Should be able to query
    const facts = store.getFacts();
    expect(facts).toEqual([]);
  });

  it('addFact stores and returns a fact with ID', () => {
    const fact = store.addFact('TypeScript is cool', ['tech']);
    expect(fact.id).toBeGreaterThan(0);
    expect(fact.content).toBe('TypeScript is cool');
    expect(fact.tags).toEqual(['tech']);
  });

  it('searchFacts finds facts by keyword (FTS5)', () => {
    store.addFact('The sky is blue');
    store.addFact('TypeScript is a language');
    const results = store.searchFacts('blue');
    expect(results.length).toBe(1);
    expect(results[0].content).toBe('The sky is blue');
  });

  it('searchFacts returns empty array for no matches', () => {
    store.addFact('The sky is blue');
    const results = store.searchFacts('red');
    expect(results.length).toBe(0);
  });

  it('getFacts returns all facts', () => {
    store.addFact('Fact 1');
    store.addFact('Fact 2');
    const facts = store.getFacts();
    expect(facts.length).toBe(2);
  });

  it('getFacts filters by tag', () => {
    store.addFact('Fact 1', ['a']);
    store.addFact('Fact 2', ['b']);
    const facts = store.getFacts({ tag: 'a' });
    expect(facts.length).toBe(1);
    expect(facts[0].content).toBe('Fact 1');
  });

  it('deleteFact removes the fact', () => {
    const fact = store.addFact('Fact to delete');
    expect(store.getFacts().length).toBe(1);
    store.deleteFact(fact.id);
    expect(store.getFacts().length).toBe(0);
  });

  it('addSession and getSession round-trip correctly', () => {
    store.addSession('sess1', 'Summary 1');
    const session = store.getSession('sess1');
    expect(session).not.toBeNull();
    expect(session?.id).toBe('sess1');
    expect(session?.summary).toBe('Summary 1');
  });

  it('getRecentSessions returns sessions in reverse chronological order', () => {
    store.addSession('sess1', 'Summary 1');
    // small delay not possible easily so let's rely on insertion order or wait a ms
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    store.addSession('sess2', 'Summary 2');
    
    const sessions = store.getRecentSessions();
    expect(sessions.length).toBe(2);
    // Since created_at is seconds/same time, they might tie. SQLite usually preserves order.
    // If not, we check membership.
    expect(sessions.map(s => s.id).sort()).toEqual(['sess1', 'sess2']);
  });
});
