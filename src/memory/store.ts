import { Database } from "bun:sqlite";
import * as path from "node:path";
import { getConfigDir } from "../config/index.ts";

export interface StoredFact {
	id: number;
	content: string;
	tags: string[];
	sourceSession: string;
	createdAt: string;
}

export interface StoredSession {
	id: string;
	summary: string;
	createdAt: string;
}

export class MemoryStore {
	private db: Database;

	constructor(dbPath?: string) {
		const resolvedPath = dbPath || path.join(getConfigDir(), "memory.db");
		this.db = new Database(resolvedPath);
		this.initialize();
	}

	/** Create tables and FTS5 virtual table */
	private initialize(): void {
		this.db.run("PRAGMA journal_mode=WAL");

		this.db.run(`
      CREATE TABLE IF NOT EXISTS facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        tags TEXT DEFAULT '[]',
        source_session TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

		this.db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        summary TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

		// FTS5 virtual table for full-text search over facts
		this.db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(
        content,
        tags,
        content=facts,
        content_rowid=id
      )
    `);

		// Triggers to keep FTS5 in sync
		this.db.run(`
      CREATE TRIGGER IF NOT EXISTS facts_ai AFTER INSERT ON facts BEGIN
        INSERT INTO facts_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags);
      END
    `);

		this.db.run(`
      CREATE TRIGGER IF NOT EXISTS facts_ad AFTER DELETE ON facts BEGIN
        INSERT INTO facts_fts(facts_fts, rowid, content, tags) VALUES('delete', old.id, old.content, old.tags);
      END
    `);

		this.db.run(`
      CREATE TRIGGER IF NOT EXISTS facts_au AFTER UPDATE ON facts BEGIN
        INSERT INTO facts_fts(facts_fts, rowid, content, tags) VALUES('delete', old.id, old.content, old.tags);
        INSERT INTO facts_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags);
      END
    `);
	}

	/** Store a new fact */
	addFact(content: string, tags: string[] = [], sourceSession = ""): StoredFact {
		const tagsJson = JSON.stringify(tags);
		const query = this.db.query(`
      INSERT INTO facts (content, tags, source_session)
      VALUES (?, ?, ?)
      RETURNING id, content, tags, source_session as sourceSession, created_at as createdAt
    `);
		const result = query.get(content, tagsJson, sourceSession) as any;
		return {
			...result,
			tags: JSON.parse(result.tags),
		};
	}

	/** Search facts using FTS5 full-text search */
	searchFacts(query: string, limit = 10): StoredFact[] {
		const dbQuery = this.db.query(`
      SELECT f.id, f.content, f.tags, f.source_session as sourceSession, f.created_at as createdAt
      FROM facts f
      JOIN facts_fts fts ON f.id = fts.rowid
      WHERE facts_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);
		const results = dbQuery.all(query, limit) as any[];
		return results.map((r) => ({
			...r,
			tags: JSON.parse(r.tags),
		}));
	}

	/** Get all facts (with optional tag filter) */
	getFacts(options?: { tag?: string; limit?: number }): StoredFact[] {
		let sql = `SELECT id, content, tags, source_session as sourceSession, created_at as createdAt FROM facts`;
		const params: any[] = [];

		if (options?.tag) {
			sql += ` WHERE tags LIKE ?`;
			params.push(`%"${options.tag}"%`);
		}

		sql += ` ORDER BY created_at DESC`;

		if (options?.limit) {
			sql += ` LIMIT ?`;
			params.push(options.limit);
		}

		const query = this.db.query(sql);
		const results = query.all(...params) as any[];
		return results.map((r) => ({
			...r,
			tags: JSON.parse(r.tags),
		}));
	}

	/** Delete a fact by ID */
	deleteFact(id: number): boolean {
		const query = this.db.query(`DELETE FROM facts WHERE id = ?`);
		query.run(id);
		return true;
	}

	/** Store a session summary */
	addSession(id: string, summary: string): void {
		const query = this.db.query(`
      INSERT INTO sessions (id, summary)
      VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET summary = excluded.summary
    `);
		query.run(id, summary);
	}

	/** Get a session by ID */
	getSession(id: string): StoredSession | null {
		const query = this.db.query(
			`SELECT id, summary, created_at as createdAt FROM sessions WHERE id = ?`,
		);
		const result = query.get(id) as any;
		return result || null;
	}

	/** Get recent sessions */
	getRecentSessions(limit = 10): StoredSession[] {
		const query = this.db.query(
			`SELECT id, summary, created_at as createdAt FROM sessions ORDER BY created_at DESC LIMIT ?`,
		);
		return query.all(limit) as StoredSession[];
	}

	/** Close the database */
	close(): void {
		this.db.close();
	}
}
