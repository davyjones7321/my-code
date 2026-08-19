import { beforeEach, describe, expect, it } from "bun:test";
import { SubagentTypeRegistry } from "../../src/subagents/registry.ts";

describe("Subagent Type Registry & Role Definitions", () => {
	let registry: SubagentTypeRegistry;

	beforeEach(() => {
		registry = new SubagentTypeRegistry();
	});

	describe("Built-in Archetypes", () => {
		it("DEF-01: verifies built-in research subagent definition", () => {
			const def = registry.get("research");
			expect(def).toBeDefined();
			expect(def?.name).toBe("research");
			expect(def?.isBuiltin).toBe(true);
			expect(def?.mode).toBe("plan");
			expect(def?.allowedTools).toContain("read_file");
			expect(def?.allowedTools).toContain("glob_files");
			expect(def?.allowedTools).toContain("grep_search");
			expect(def?.disallowedTools).toContain("write_file");
			expect(def?.disallowedTools).toContain("run_command");
			expect(def?.maxIterations).toBe(25);
		});

		it("DEF-02: verifies built-in code-reviewer subagent definition", () => {
			const def = registry.get("code-reviewer");
			expect(def).toBeDefined();
			expect(def?.name).toBe("code-reviewer");
			expect(def?.isBuiltin).toBe(true);
			expect(def?.mode).toBe("plan");
			expect(def?.systemPrompt).toContain("Code Reviewer");
			expect(def?.allowedTools).toContain("read_file");
			expect(def?.disallowedTools).toContain("write_file");
			expect(def?.maxIterations).toBe(20);
		});

		it("DEF-03: verifies built-in test-engineer subagent definition", () => {
			const def = registry.get("test-engineer");
			expect(def).toBeDefined();
			expect(def?.name).toBe("test-engineer");
			expect(def?.isBuiltin).toBe(true);
			expect(def?.mode).toBe("build");
			expect(def?.allowedTools).toContain("write_file");
			expect(def?.allowedTools).toContain("edit_file");
			expect(def?.allowedTools).toContain("run_command");
			expect(def?.maxIterations).toBe(30);
		});

		it("DEF-04: enforces protection against overwriting built-ins without explicit overwrite flag", () => {
			expect(() => {
				registry.register({
					name: "research",
					description: "Hacked research agent",
					systemPrompt: "Do whatever you want",
				});
			}).toThrow(/Cannot overwrite built-in subagent type/);
		});

		it("DEF-04b: allows overwriting built-in when overwrite is true", () => {
			registry.register(
				{
					name: "research",
					description: "Customized research agent",
					systemPrompt: "Custom prompt",
					maxIterations: 50,
				},
				true,
			);

			const def = registry.get("research");
			expect(def?.description).toBe("Customized research agent");
			expect(def?.maxIterations).toBe(50);
		});

		it("DEF-05: prevents unregistering built-in roles", () => {
			expect(() => {
				registry.unregister("code-reviewer");
			}).toThrow(/Cannot unregister built-in subagent type/);
		});
	});

	describe("Dynamic Custom Subagent Types", () => {
		it("DEF-06: registers dynamic custom subagent successfully", () => {
			registry.register({
				name: "security-auditor",
				description: "Audits security vulnerabilities and injection risks",
				systemPrompt: "You are a Security Auditor. Inspect code for OWASP Top 10 risks.",
				allowedTools: ["read_file", "grep_search"],
				mode: "plan",
				maxIterations: 15,
			});

			expect(registry.has("security-auditor")).toBe(true);
			const def = registry.get("security-auditor");
			expect(def?.name).toBe("security-auditor");
			expect(def?.isBuiltin).toBe(false);
			expect(def?.mode).toBe("plan");
			expect(def?.maxIterations).toBe(15);
		});

		it("DEF-07: unregisters custom subagent types cleanly", () => {
			registry.register({
				name: "temporary-helper",
				description: "Temp helper",
				systemPrompt: "Helper",
			});

			expect(registry.has("temporary-helper")).toBe(true);
			const removed = registry.unregister("temporary-helper");
			expect(removed).toBe(true);
			expect(registry.has("temporary-helper")).toBe(false);
			expect(registry.get("temporary-helper")).toBeUndefined();
		});

		it("DEF-08: applies sensible default fallbacks for optional fields", () => {
			registry.register({
				name: "minimal-agent",
				description: "Minimal description",
				systemPrompt: "Minimal prompt",
			});

			const def = registry.get("minimal-agent");
			expect(def?.maxIterations).toBe(25);
			expect(def?.isBuiltin).toBe(false);
		});
	});

	describe("Schema Validation & Error Handling", () => {
		it("DEF-09: rejects invalid names with special characters or spaces", () => {
			expect(() => {
				registry.register({
					name: "my agent with spaces",
					description: "desc",
					systemPrompt: "prompt",
				});
			}).toThrow(/Invalid subagent name/);

			expect(() => {
				registry.register({
					name: "agent@special!",
					description: "desc",
					systemPrompt: "prompt",
				});
			}).toThrow(/Invalid subagent name/);
		});

		it("DEF-10: rejects definitions with empty description or systemPrompt", () => {
			expect(() => {
				registry.register({
					name: "valid-name",
					description: "  ",
					systemPrompt: "prompt",
				});
			}).toThrow(/description cannot be empty/);

			expect(() => {
				registry.register({
					name: "valid-name",
					description: "desc",
					systemPrompt: "",
				});
			}).toThrow(/systemPrompt cannot be empty/);
		});

		it("DEF-11: querying unknown type returns undefined without throwing", () => {
			expect(registry.get("non-existent-agent")).toBeUndefined();
			expect(registry.has("non-existent-agent")).toBe(false);
		});

		it("DEF-12: resetToDefaults restores standard built-in roles", () => {
			registry.register({
				name: "custom-1",
				description: "desc",
				systemPrompt: "prompt",
			});
			registry.register({
				name: "custom-2",
				description: "desc",
				systemPrompt: "prompt",
			});

			expect(registry.list().length).toBe(5);

			registry.resetToDefaults();
			expect(registry.list().length).toBe(3);
			expect(registry.has("custom-1")).toBe(false);
			expect(registry.has("research")).toBe(true);
			expect(registry.has("code-reviewer")).toBe(true);
			expect(registry.has("test-engineer")).toBe(true);
		});
	});
});
