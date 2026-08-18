import type { Message } from "../agent/types.ts";
import type { Provider } from "../providers/base.ts";
import { MemoryStore } from "./store.ts";

export class MemoryAPI {
	private store: MemoryStore;

	constructor(store?: MemoryStore) {
		this.store = store || new MemoryStore();
	}

	/** Remember a fact for future sessions */
	remember(content: string, tags?: string[]): { id: number; message: string } {
		const fact = this.store.addFact(content, tags);
		return {
			id: fact.id,
			message: `Fact successfully remembered with ID ${fact.id}`,
		};
	}

	/** Recall facts matching a query using FTS5 */
	recall(query: string, limit?: number): string[] {
		const facts = this.store.searchFacts(query, limit);
		return facts.map((f) => f.content);
	}

	/** Summarize a session's conversation using an LLM */
	async summarizeSession(
		sessionId: string,
		messages: Message[],
		provider?: Provider,
	): Promise<string> {
		let summary = "";

		if (provider) {
			const systemMsg: Message = {
				role: "system",
				content: [
					{
						type: "text",
						text: "Summarize this conversation in 2-3 sentences, focusing on key decisions, files changed, and important outcomes.",
					},
				],
			};
			const result = await provider.chat([systemMsg, ...messages], [], { model: "default" });
			const textBlock = result.content.find((c) => c.type === "text");
			summary = textBlock && textBlock.type === "text" ? textBlock.text : "";
		} else {
			const userCount = messages.filter((m) => m.role === "user").length;
			const assistantCount = messages.filter((m) => m.role === "assistant").length;

			const toolCalls = messages
				.filter((m) => m.role === "assistant")
				.flatMap((m) =>
					m.content
						.filter((c) => c.type === "tool_use")
						.map((c) => (c.type === "tool_use" ? c.name : "")),
				);
			const uniqueTools = [...new Set(toolCalls)];

			const firstUser = messages
				.find((m) => m.role === "user")
				?.content.find((c) => c.type === "text");
			const firstUserText = firstUser && firstUser.type === "text" ? firstUser.text : "";
			const lastUser = [...messages]
				.reverse()
				.find((m) => m.role === "user")
				?.content.find((c) => c.type === "text");
			const lastUserText = lastUser && lastUser.type === "text" ? lastUser.text : "";

			summary = `Session with ${userCount} user messages and ${assistantCount} assistant messages. Tools used: ${uniqueTools.join(", ")}. First message: "${firstUserText}". Last message: "${lastUserText}".`;
		}

		summary = summary.substring(0, 500);
		this.store.addSession(sessionId, summary);
		return summary;
	}

	/** Get relevant context facts for the current conversation */
	getContextFacts(currentPrompt: string, limit?: number): string[] {
		return this.recall(currentPrompt, limit);
	}

	/** Get the underlying store (for testing) */
	getStore(): MemoryStore {
		return this.store;
	}
}
