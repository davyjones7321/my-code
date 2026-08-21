import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Provider, ProviderResponse } from "../../src/providers/base.ts";
import { Harness } from "../../src/sdk/harness.ts";
import { createCustomCheck } from "../../src/verifier/checks/custom.ts";
import { SelfHealingCoordinator } from "../../src/verifier/self-healing.ts";

describe("SelfHealingCoordinator Suite", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-self-healing-test-"));
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("should pass on round 1 if all verification checks pass", async () => {
		const passCheck = createCustomCheck("pass-check", "echo pass");
		const coordinator = new SelfHealingCoordinator({
			projectRoot: tempDir,
			checks: [passCheck],
			maxRounds: 3,
		});

		const mockProvider: Provider = {
			name: "mock-heal-provider",
			async chat(): Promise<ProviderResponse> {
				return {
					content: [{ type: "text", text: "Task completed cleanly." }],
					usage: { inputTokens: 10, outputTokens: 10 },
				};
			},
		};

		const harness = new Harness({ loadDiskConfig: false, provider: mockProvider, projectRoot: tempDir });
		const session = harness.createSession();

		const result = await coordinator.runSelfHealingLoop(session, "Write a clean file");
		expect(result.success).toBe(true);
		expect(result.totalRounds).toBe(1);
		expect(result.repaired).toBe(false);
	});

	it("should execute iterative repair turn when verification check fails and succeed on round 2", async () => {
		const flagFile = path.join(tempDir, "healed.txt");

		// Custom check fails if flagFile does NOT exist
		const flakinessCheck = {
			name: "flaky-file-check",
			description: "Check if flagFile exists",
			async run() {
				try {
					await fs.access(flagFile);
					return { name: "flaky-file-check", passed: true, durationMs: 1, diagnostics: [] };
				} catch {
					return { name: "flaky-file-check", passed: false, durationMs: 1, diagnostics: [{ message: "flagFile missing", severity: "error" as const }] };
				}
			},
		};

		const coordinator = new SelfHealingCoordinator({
			projectRoot: tempDir,
			checks: [flakinessCheck],
			maxRounds: 3,
		});

		let chatCalls = 0;
		const mockProvider: Provider = {
			name: "mock-repair-provider",
			async chat(): Promise<ProviderResponse> {
				chatCalls++;
				if (chatCalls >= 2) {
					// Round 2: repair turn creates flagFile
					await fs.writeFile(flagFile, "repaired");
				}
				return {
					content: [{ type: "text", text: `Turn ${chatCalls} completed.` }],
					usage: { inputTokens: 10, outputTokens: 10 },
				};
			},
		};

		const harness = new Harness({ loadDiskConfig: false, provider: mockProvider, projectRoot: tempDir });
		const session = harness.createSession();

		const result = await coordinator.runSelfHealingLoop(session, "Create healed file");
		expect(result.success).toBe(true);
		expect(result.totalRounds).toBe(2);
		expect(result.repaired).toBe(true);
		expect(result.roundHistory.length).toBe(2);
	});
});
