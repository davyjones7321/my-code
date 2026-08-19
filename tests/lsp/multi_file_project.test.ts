import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { LSPDiagnosticsEngine } from "../../src/lsp/index.ts";

describe("LSP Multi-File Project & Graph Scenarios (multi_file_project.test.ts)", () => {
	let tmpDir: string;
	let engine: LSPDiagnosticsEngine;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "harness-lsp-multifile-test-"),
		);
		engine = new LSPDiagnosticsEngine({ projectRoot: tmpDir });
	});

	afterEach(() => {
		engine.dispose();
		try {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		} catch {
			// ignore cleanup errors
		}
	});

	it("manages a clean multi-file architecture with 0 diagnostics", async () => {
		engine.updateFile(
			"src/types/user.ts",
			`
export interface Identifiable {
  id: string;
}

export interface User extends Identifiable {
  name: string;
  email: string;
  role: "admin" | "user";
}
`,
		);

		engine.updateFile(
			"src/utils/validator.ts",
			`
export function isValidEmail(email: string): boolean {
  return email.includes("@") && email.includes(".");
}
`,
		);

		engine.updateFile(
			"src/services/user_service.ts",
			`
import type { User } from "../types/user.ts";
import { isValidEmail } from "../utils/validator.ts";

export class UserService {
  private users: Map<string, User> = new Map();

  public register(user: User): boolean {
    if (!isValidEmail(user.email)) {
      return false;
    }
    this.users.set(user.id, user);
    return true;
  }

  public getById(id: string): User | undefined {
    return this.users.get(id);
  }
}
`,
		);

		engine.updateFile(
			"src/index.ts",
			`
import { UserService } from "./services/user_service.ts";
import type { User } from "./types/user.ts";

export const service = new UserService();
const admin: User = {
  id: "adm_1",
  name: "Admin Alice",
  email: "alice@example.com",
  role: "admin",
};

service.register(admin);
`,
		);

		const diags = await engine.getDiagnostics();
		expect(diags).toEqual([]);
	});

	it("accurately detects and propagates cascading errors when a core interface changes", async () => {
		// Base setup
		engine.updateFile(
			"src/types.ts",
			"export interface User {\n  id: string;\n  name: string;\n}\n",
		);
		engine.updateFile(
			"src/service.ts",
			'import type { User } from "./types.ts";\nexport function createUser(id: string, name: string): User {\n  return { id, name };\n}\n',
		);
		engine.updateFile(
			"src/main.ts",
			'import { createUser } from "./service.ts";\nconst u = createUser("1", "Alice");\n',
		);

		// Initial clean check
		let diags = await engine.getDiagnostics();
		expect(diags).toEqual([]);

		// Modify interface in types.ts: add required 'age' property
		engine.updateFile(
			"src/types.ts",
			"export interface User {\n  id: string;\n  name: string;\n  age: number;\n}\n",
		);

		// Diagnostics should now detect that createUser in service.ts is missing 'age' property
		diags = await engine.getDiagnostics();
		expect(diags.length).toBeGreaterThan(0);

		const ageError = diags.find((d) =>
			d.message.includes("Property 'age' is missing in type"),
		);
		expect(ageError).toBeDefined();
		expect(ageError?.filePath).toContain("service.ts");

		// Fix service.ts to return age
		engine.updateFile(
			"src/service.ts",
			'import type { User } from "./types.ts";\nexport function createUser(id: string, name: string, age: number): User {\n  return { id, name, age };\n}\n',
		);

		// Now main.ts has argument mismatch (expected 3 args, got 2)
		diags = await engine.getDiagnostics();
		expect(diags.length).toBe(1);
		expect(diags[0].code).toBe(2554); // Expected 3 arguments, but got 2

		// Fix main.ts
		engine.updateFile(
			"src/main.ts",
			'import { createUser } from "./service.ts";\nconst u = createUser("1", "Alice", 30);\n',
		);

		// Back to 0 errors
		diags = await engine.getDiagnostics();
		expect(diags).toEqual([]);
	});

	it("handles circular module imports without infinite recursion or crashes", async () => {
		engine.updateFile(
			"src/node_a.ts",
			`
import { createNodeB, type NodeB } from "./node_b.ts";

export interface NodeA {
  name: string;
  sibling?: NodeB;
}

export function createNodeA(name: string): NodeA {
  return { name };
}
`,
		);

		engine.updateFile(
			"src/node_b.ts",
			`
import { createNodeA, type NodeA } from "./node_a.ts";

export interface NodeB {
  tag: string;
  parent?: NodeA;
}

export function createNodeB(tag: string): NodeB {
  return { tag };
}
`,
		);

		const diags = await engine.getDiagnostics();
		expect(diags).toEqual([]);

		// Verify definition navigation works across circular imports
		const defs = await engine.getDefinition("src/node_a.ts", 2, 15);
		expect(defs.length).toBeGreaterThan(0);
		expect(defs[0].filePath).toContain("node_b.ts");
	});

	it("enforces generic type constraints across modules", async () => {
		engine.updateFile(
			"src/repo.ts",
			`
export interface Identifiable {
  id: string;
}

export class Repository<T extends Identifiable> {
  private items: T[] = [];
  public add(item: T): void {
    this.items.push(item);
  }
}
`,
		);

		// Valid instantiation
		engine.updateFile(
			"src/valid.ts",
			`
import { Repository, type Identifiable } from "./repo.ts";
interface Item extends Identifiable { id: string; name: string; }
const repo = new Repository<Item>();
`,
		);

		const validDiags = await engine.getDiagnostics("src/valid.ts");
		expect(validDiags).toEqual([]);

		// Invalid instantiation (number does not extend Identifiable)
		engine.updateFile(
			"src/invalid.ts",
			`
import { Repository } from "./repo.ts";
const badRepo = new Repository<number>();
`,
		);

		const invalidDiags = await engine.getDiagnostics("src/invalid.ts");
		expect(invalidDiags.length).toBeGreaterThan(0);
		const constraintDiag = invalidDiags.find((d) => d.code === 2344);
		expect(constraintDiag).toBeDefined();
	});

	it("dynamically integrates new files into project compilation graph", async () => {
		engine.updateFile(
			"src/config.ts",
			"export const PORT = 8080;\nexport const HOST = 'localhost';\n",
		);

		expect(engine.getProjectFiles().length).toBe(1);

		// Add a new consumer file
		engine.updateFile(
			"src/server.ts",
			'import { PORT, HOST } from "./config.ts";\nexport function start() { return `${HOST}:${PORT}`; }\n',
		);

		expect(engine.getProjectFiles().length).toBe(2);

		const diags = await engine.getDiagnostics();
		expect(diags).toEqual([]);

		// Cross-file references from server to config (1 def + 1 import + 1 usage = 3)
		const refs = await engine.findReferences("src/server.ts", 1, 10);
		expect(refs.length).toBe(3);
	});
});
