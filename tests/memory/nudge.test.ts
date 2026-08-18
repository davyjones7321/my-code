import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryNudge } from "../../src/memory/nudge.ts";

describe("MemoryNudge", () => {
	let nudge: MemoryNudge;

	beforeEach(() => {
		nudge = new MemoryNudge({ intervalTurns: 3 });
	});

	it("tick returns null before interval", () => {
		expect(nudge.tick()).toBeNull();
		expect(nudge.tick()).toBeNull();
	});

	it("tick returns nudge message at interval", () => {
		nudge.tick();
		nudge.tick();
		const msg = nudge.tick();
		expect(msg).not.toBeNull();
		expect(msg).toContain("completed 3 turns");
	});

	it("tick returns nudge again at 2x interval", () => {
		nudge.tick();
		nudge.tick();
		nudge.tick();
		expect(nudge.tick()).toBeNull();
		expect(nudge.tick()).toBeNull();
		const msg = nudge.tick();
		expect(msg).not.toBeNull();
		expect(msg).toContain("completed 6 turns");
	});

	it("disabled nudge never returns message", () => {
		const disabledNudge = new MemoryNudge({ intervalTurns: 1, enabled: false });
		expect(disabledNudge.tick()).toBeNull();
		expect(disabledNudge.tick()).toBeNull();
	});

	it("reset clears turn counter", () => {
		nudge.tick();
		nudge.tick();
		nudge.reset();
		nudge.tick();
		nudge.tick();
		const msg = nudge.tick();
		expect(msg).not.toBeNull();
		expect(msg).toContain("completed 3 turns");
	});
});
