import type { ModelPricing } from "./types.ts";

export const DEFAULT_PRICING: ModelPricing = {
	inputPerMillion: 3.0,
	outputPerMillion: 15.0,
};

export const FREE_PRICING: ModelPricing = {
	inputPerMillion: 0.0,
	outputPerMillion: 0.0,
};

/** Exact pricing map per 1M tokens in USD */
export const MODEL_PRICING: Record<string, ModelPricing> = {
	// Anthropic
	"claude-3-7-sonnet": { inputPerMillion: 3.0, outputPerMillion: 15.0 },
	"claude-3-5-sonnet": { inputPerMillion: 3.0, outputPerMillion: 15.0 },
	"claude-3-5-haiku": { inputPerMillion: 0.8, outputPerMillion: 4.0 },
	"claude-3-opus": { inputPerMillion: 15.0, outputPerMillion: 75.0 },
	"claude-3-haiku": { inputPerMillion: 0.25, outputPerMillion: 1.25 },

	// OpenAI
	"gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10.0 },
	"gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
	"o1": { inputPerMillion: 15.0, outputPerMillion: 60.0 },
	"o1-preview": { inputPerMillion: 15.0, outputPerMillion: 60.0 },
	"o1-mini": { inputPerMillion: 3.0, outputPerMillion: 12.0 },
	"o3-mini": { inputPerMillion: 1.1, outputPerMillion: 4.4 },
	"gpt-4-turbo": { inputPerMillion: 10.0, outputPerMillion: 30.0 },
	"gpt-4": { inputPerMillion: 30.0, outputPerMillion: 60.0 },
	"gpt-3.5-turbo": { inputPerMillion: 0.5, outputPerMillion: 1.5 },

	// Ollama / Local
	ollama: { inputPerMillion: 0.0, outputPerMillion: 0.0 },
	local: { inputPerMillion: 0.0, outputPerMillion: 0.0 },

	// Default fallback
	default: { inputPerMillion: 3.0, outputPerMillion: 15.0 },
};

/**
 * Resolves pricing for a given provider and model name.
 * Robust against version dates, namespace prefixes, casing, and custom aliases.
 */
export function getModelPricing(providerName?: string, modelName?: string): ModelPricing {
	const provider = (providerName || "").trim().toLowerCase();
	let model = (modelName || "").trim().toLowerCase();

	// Check if local / free provider or model
	if (
		provider === "ollama" ||
		provider === "local" ||
		provider.includes("ollama") ||
		provider.includes("local") ||
		model === "local" ||
		model.includes("ollama")
	) {
		return FREE_PRICING;
	}

	// Strip provider namespace prefix (e.g. "anthropic/claude-3-7-sonnet" -> "claude-3-7-sonnet")
	if (model.includes("/")) {
		const parts = model.split("/");
		model = parts[parts.length - 1];
	}

	// Direct map lookup
	if (model && MODEL_PRICING[model]) {
		return MODEL_PRICING[model];
	}

	// Pattern matching with precedence
	if (/claude-3[.-]7-sonnet/i.test(model)) {
		return MODEL_PRICING["claude-3-7-sonnet"];
	}
	if (/claude-3[.-]5-sonnet/i.test(model)) {
		return MODEL_PRICING["claude-3-5-sonnet"];
	}
	if (/claude-3[.-]5-haiku/i.test(model)) {
		return MODEL_PRICING["claude-3-5-haiku"];
	}
	if (/claude-3[.-]0?-opus|claude-opus/i.test(model)) {
		return MODEL_PRICING["claude-3-opus"];
	}
	if (/claude-3[.-]0?-haiku|claude-haiku/i.test(model)) {
		return MODEL_PRICING["claude-3-haiku"];
	}
	if (/gpt-4o-mini/i.test(model)) {
		return MODEL_PRICING["gpt-4o-mini"];
	}
	if (/gpt-4o/i.test(model)) {
		return MODEL_PRICING["gpt-4o"];
	}
	if (/o1-mini/i.test(model)) {
		return MODEL_PRICING["o1-mini"];
	}
	if (/o1(-preview)?/i.test(model)) {
		return MODEL_PRICING["o1"];
	}
	if (/o3-mini/i.test(model)) {
		return MODEL_PRICING["o3-mini"];
	}
	if (/gpt-4-turbo|gpt-4-1106|gpt-4-0125/i.test(model)) {
		return MODEL_PRICING["gpt-4-turbo"];
	}
	if (/gpt-4/i.test(model)) {
		return MODEL_PRICING["gpt-4"];
	}
	if (/gpt-3\.5-turbo/i.test(model)) {
		return MODEL_PRICING["gpt-3.5-turbo"];
	}

	// Provider-level defaults when model is unknown or empty
	if (provider === "anthropic" || provider.includes("anthropic")) {
		return MODEL_PRICING["claude-3-5-sonnet"];
	}
	if (provider === "openai" || provider.includes("openai")) {
		return MODEL_PRICING["gpt-4o"];
	}

	return DEFAULT_PRICING;
}

/**
 * Estimates total USD cost given token counts.
 * Handles edge cases: negative tokens, NaN, non-finite values, unknown models.
 */
export function estimateCost(
	providerName: string,
	modelName: string,
	inputTokens: number,
	outputTokens: number,
): number {
	const safeIn = Math.max(
		0,
		typeof inputTokens === "number" && !Number.isNaN(inputTokens) && Number.isFinite(inputTokens)
			? inputTokens
			: 0,
	);
	const safeOut = Math.max(
		0,
		typeof outputTokens === "number" && !Number.isNaN(outputTokens) && Number.isFinite(outputTokens)
			? outputTokens
			: 0,
	);

	if (safeIn === 0 && safeOut === 0) {
		return 0;
	}

	const pricing = getModelPricing(providerName, modelName);
	const cost = (safeIn * pricing.inputPerMillion + safeOut * pricing.outputPerMillion) / 1_000_000;

	return Number.isFinite(cost) ? cost : 0;
}

/**
 * Formats a numeric USD cost to a friendly terminal string.
 */
export function formatCost(cost: number): string {
	if (!cost || cost <= 0 || !Number.isFinite(cost)) {
		return "$0.00";
	}
	if (cost < 0.01) {
		return `$${cost.toFixed(4)}`;
	}
	return `$${cost.toFixed(2)}`;
}
