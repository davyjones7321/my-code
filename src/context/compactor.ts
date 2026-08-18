import type { Message } from "../agent/types.ts";
import type { Provider } from "../providers/base.ts";

export interface CompactorConfig {
	maxTokens: number;
	warningThreshold: number;
	criticalThreshold: number;
	protectedHeadCount: number;
	protectedTailCount: number;
}

export class ContextCompactor {
	constructor(private config: CompactorConfig) {}

	public estimateTokens(messages: Message[]): number {
		let charCount = 0;
		for (const msg of messages) {
			for (const block of msg.content) {
				if (block.type === "text") {
					charCount += block.text.length;
				} else if (block.type === "tool_use") {
					charCount += block.name.length;
					charCount += JSON.stringify(block.input).length;
				} else if (block.type === "tool_result") {
					charCount += (block.content || "").length;
				}
			}
		}
		return Math.ceil(charCount / 4);
	}

	public needsCompaction(messages: Message[]): "none" | "warning" | "critical" {
		const tokens = this.estimateTokens(messages);
		if (tokens >= this.config.maxTokens * this.config.criticalThreshold) {
			return "critical";
		}
		if (tokens >= this.config.maxTokens * this.config.warningThreshold) {
			return "warning";
		}
		return "none";
	}

	public async compact(messages: Message[], summaryProvider?: Provider): Promise<Message[]> {
		const { protectedHeadCount, protectedTailCount } = this.config;

		if (messages.length <= protectedHeadCount + protectedTailCount) {
			return messages;
		}

		const head = messages.slice(0, protectedHeadCount);
		const tail = messages.slice(messages.length - protectedTailCount);
		const middle = messages.slice(protectedHeadCount, messages.length - protectedTailCount);

		let summaryText = "";

		if (summaryProvider) {
			// Stub: in real world, use summaryProvider to summarize `middle`
			summaryText = this.mechanicalSummary(middle);
		} else {
			summaryText = this.mechanicalSummary(middle);
		}

		const summaryMessage: Message = {
			role: "system",
			content: [{ type: "text", text: `[COMPACTED HISTORY SUMMARY]\n${summaryText}` }],
		};

		return [...head, summaryMessage, ...tail];
	}

	private mechanicalSummary(messages: Message[]): string {
		let summary = "";

		for (const msg of messages) {
			if (msg.role === "assistant") {
				for (const block of msg.content) {
					if (block.type === "text") {
						summary += `- Assistant: ${block.text.substring(0, 100).replace(/\n/g, " ")}...\n`;
					} else if (block.type === "tool_use") {
						summary += `- Tool called: ${block.name} with input: ${JSON.stringify(block.input).substring(0, 50)}...\n`;
					}
				}
			}
		}

		if (!summary) {
			summary = "Various conversation turns.";
		}
		return summary.trim();
	}
}
