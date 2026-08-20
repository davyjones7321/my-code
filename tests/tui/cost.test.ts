import { describe, expect, it } from "bun:test";
import {
	DEFAULT_PRICING,
	FREE_PRICING,
	MODEL_PRICING,
	estimateCost,
	formatCost,
	getModelPricing,
} from "../../src/tui/cost.ts";

describe("TUI Cost & Pricing Subsystem", () => {
	describe("MODEL_PRICING table", () => {
		it("should have correct rate definitions for Anthropic models", () => {
			expect(MODEL_PRICING["claude-3-7-sonnet"]).toEqual({
				inputPerMillion: 3.0,
				outputPerMillion: 15.0,
			});
			expect(MODEL_PRICING["claude-3-5-sonnet"]).toEqual({
				inputPerMillion: 3.0,
				outputPerMillion: 15.0,
			});
			expect(MODEL_PRICING["claude-3-5-haiku"]).toEqual({
				inputPerMillion: 0.8,
				outputPerMillion: 4.0,
			});
			expect(MODEL_PRICING["claude-3-opus"]).toEqual({
				inputPerMillion: 15.0,
				outputPerMillion: 75.0,
			});
			expect(MODEL_PRICING["claude-3-haiku"]).toEqual({
				inputPerMillion: 0.25,
				outputPerMillion: 1.25,
			});
		});

		it("should have correct rate definitions for OpenAI models", () => {
			expect(MODEL_PRICING["gpt-4o"]).toEqual({
				inputPerMillion: 2.5,
				outputPerMillion: 10.0,
			});
			expect(MODEL_PRICING["gpt-4o-mini"]).toEqual({
				inputPerMillion: 0.15,
				outputPerMillion: 0.6,
			});
			expect(MODEL_PRICING["o1"]).toEqual({
				inputPerMillion: 15.0,
				outputPerMillion: 60.0,
			});
			expect(MODEL_PRICING["o1-mini"]).toEqual({
				inputPerMillion: 3.0,
				outputPerMillion: 12.0,
			});
			expect(MODEL_PRICING["o3-mini"]).toEqual({
				inputPerMillion: 1.1,
				outputPerMillion: 4.4,
			});
			expect(MODEL_PRICING["gpt-4-turbo"]).toEqual({
				inputPerMillion: 10.0,
				outputPerMillion: 30.0,
			});
		});

		it("should have zero rate definitions for local/ollama models", () => {
			expect(MODEL_PRICING.ollama).toEqual(FREE_PRICING);
			expect(MODEL_PRICING.local).toEqual(FREE_PRICING);
		});
	});

	describe("getModelPricing resolution", () => {
		it("should resolve exact model names", () => {
			expect(getModelPricing("anthropic", "claude-3-7-sonnet")).toEqual(
				MODEL_PRICING["claude-3-7-sonnet"],
			);
			expect(getModelPricing("openai", "gpt-4o")).toEqual(MODEL_PRICING["gpt-4o"]);
		});

		it("should be case-insensitive and handle whitespace", () => {
			expect(getModelPricing("ANTHROPIC", "  Claude-3-7-Sonnet  ")).toEqual(
				MODEL_PRICING["claude-3-7-sonnet"],
			);
			expect(getModelPricing("OpenAI", "GPT-4O-MINI")).toEqual(MODEL_PRICING["gpt-4o-mini"]);
		});

		it("should resolve models with date suffixes", () => {
			expect(getModelPricing("anthropic", "claude-3-7-sonnet-20250219")).toEqual(
				MODEL_PRICING["claude-3-7-sonnet"],
			);
			expect(getModelPricing("anthropic", "claude-3-5-sonnet-20241022")).toEqual(
				MODEL_PRICING["claude-3-5-sonnet"],
			);
			expect(getModelPricing("anthropic", "claude-3-5-haiku-20241022")).toEqual(
				MODEL_PRICING["claude-3-5-haiku"],
			);
		});

		it("should strip provider prefixes from model strings", () => {
			expect(getModelPricing("openrouter", "anthropic/claude-3-7-sonnet")).toEqual(
				MODEL_PRICING["claude-3-7-sonnet"],
			);
			expect(getModelPricing("openrouter", "openai/gpt-4o")).toEqual(MODEL_PRICING["gpt-4o"]);
		});

		it("should identify local and ollama providers/models as free", () => {
			expect(getModelPricing("ollama", "llama3:latest")).toEqual(FREE_PRICING);
			expect(getModelPricing("local", "qwen2.5-coder")).toEqual(FREE_PRICING);
			expect(getModelPricing("custom", "local")).toEqual(FREE_PRICING);
			expect(getModelPricing("custom", "ollama/deepseek-coder")).toEqual(FREE_PRICING);
		});

		it("should fallback to provider defaults when model is unknown", () => {
			expect(getModelPricing("anthropic", "future-claude-model")).toEqual(
				MODEL_PRICING["claude-3-5-sonnet"],
			);
			expect(getModelPricing("openai", "future-gpt-model")).toEqual(MODEL_PRICING["gpt-4o"]);
		});

		it("should fallback to default pricing for completely unknown models and providers", () => {
			expect(getModelPricing("unknown_provider", "unknown_model")).toEqual(DEFAULT_PRICING);
			expect(getModelPricing(undefined, undefined)).toEqual(DEFAULT_PRICING);
		});
	});

	describe("estimateCost calculation", () => {
		it("should calculate exact cost for standard token counts", () => {
			// claude-3-7-sonnet: $3.00/1M in, $15.00/1M out -> 1M in + 1M out = $18.00
			const cost1 = estimateCost("anthropic", "claude-3-7-sonnet", 1_000_000, 1_000_000);
			expect(cost1).toBeCloseTo(18.0, 5);

			// claude-3-5-sonnet: 1,000 in ($0.003) + 500 out ($0.0075) = $0.0105
			const cost2 = estimateCost("anthropic", "claude-3-5-sonnet", 1_000, 500);
			expect(cost2).toBeCloseTo(0.0105, 6);

			// gpt-4o: 1M in ($2.50) + 1M out ($10.00) = $12.50
			const cost3 = estimateCost("openai", "gpt-4o", 1_000_000, 1_000_000);
			expect(cost3).toBeCloseTo(12.5, 5);

			// gpt-4o-mini: 1M in ($0.15) + 1M out ($0.60) = $0.75
			const cost4 = estimateCost("openai", "gpt-4o-mini", 1_000_000, 1_000_000);
			expect(cost4).toBeCloseTo(0.75, 5);

			// o1: 1M in ($15.00) + 1M out ($60.00) = $75.00
			const cost5 = estimateCost("openai", "o1", 1_000_000, 1_000_000);
			expect(cost5).toBeCloseTo(75.0, 5);
		});

		it("should return 0 for ollama and local models", () => {
			expect(estimateCost("ollama", "llama3", 500_000, 500_000)).toBe(0);
			expect(estimateCost("local", "codellama", 1_000_000, 1_000_000)).toBe(0);
		});

		it("should handle 0 tokens gracefully", () => {
			expect(estimateCost("anthropic", "claude-3-7-sonnet", 0, 0)).toBe(0);
		});

		it("should handle edge cases and invalid inputs (negative, NaN, non-finite)", () => {
			expect(estimateCost("anthropic", "claude-3-7-sonnet", -500, -100)).toBe(0);
			expect(estimateCost("anthropic", "claude-3-7-sonnet", Number.NaN, 1000)).toBeGreaterThan(0);
			expect(estimateCost("anthropic", "claude-3-7-sonnet", 1000, Number.NaN)).toBeGreaterThan(0);
			expect(estimateCost("anthropic", "claude-3-7-sonnet", Number.POSITIVE_INFINITY, 0)).toBe(0);
		});
	});

	describe("formatCost string formatting", () => {
		it("should format zero and negative costs as $0.00", () => {
			expect(formatCost(0)).toBe("$0.00");
			expect(formatCost(-1.5)).toBe("$0.00");
			expect(formatCost(Number.NaN)).toBe("$0.00");
			expect(formatCost(Number.POSITIVE_INFINITY)).toBe("$0.00");
		});

		it("should format sub-cent costs with 4 decimal places", () => {
			expect(formatCost(0.0042)).toBe("$0.0042");
			expect(formatCost(0.0001)).toBe("$0.0001");
			expect(formatCost(0.0099)).toBe("$0.0099");
		});

		it("should format standard dollar costs with 2 decimal places", () => {
			expect(formatCost(1.25)).toBe("$1.25");
			expect(formatCost(12.3456)).toBe("$12.35");
			expect(formatCost(100.0)).toBe("$100.00");
		});
	});
});
