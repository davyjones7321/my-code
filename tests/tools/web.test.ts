import { describe, expect, it } from "bun:test";
import { fetchUrlTool, searchWebTool } from "../../src/tools/web.ts";

describe("Web Search & HTML Parser Suite (node-html-parser)", () => {
	it("should have search_web and fetch_url tools defined", () => {
		expect(searchWebTool.name).toBe("search_web");
		expect(fetchUrlTool.name).toBe("fetch_url");
	});

	it("should execute web search and return structured output", async () => {
		const res = await searchWebTool.execute({ query: "Bun JavaScript runtime", limit: 2 });
		expect(res.isError).toBe(false);
		expect(res.result).toContain("Web Search Results");
	});

	it("should fetch URL and convert HTML to markdown in milliseconds", async () => {
		const res = await fetchUrlTool.execute({ url: "https://example.com" });
		expect(res.isError).toBe(false);
		expect(res.result).toContain("Example Domain");
	});
});
