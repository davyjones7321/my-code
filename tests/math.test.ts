import { describe, expect, test } from "bun:test";
import { add, subtract } from "../src/utils/math";

describe("Math utilities", () => {
	test("add adds two numbers correctly", () => {
		expect(add(2, 3)).toBe(5);
		expect(add(-1, 1)).toBe(0);
		expect(add(0, 0)).toBe(0);
	});

	test("subtract subtracts two numbers correctly", () => {
		expect(subtract(5, 3)).toBe(2);
		expect(subtract(1, 1)).toBe(0);
		expect(subtract(0, 5)).toBe(-5);
	});
});
