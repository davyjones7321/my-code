import { parse } from "node-html-parser";
import type { Tool } from "./registry.ts";

/**
 * High-performance Web Search Tool using DuckDuckGo HTML endpoint
 */
export const searchWebTool: Tool = {
	name: "search_web",
	description: "Search the web for real-time information, documentation, news, and technical facts.",
	inputSchema: {
		type: "object",
		properties: {
			query: {
				type: "string",
				description: "The search query (e.g. 'Cloudflare Workers AI Llama 3.3 models')",
			},
			limit: {
				type: "number",
				description: "Maximum number of results to return (default: 5)",
			},
		},
		required: ["query"],
	},
	async execute(input: { query: string; limit?: number }): Promise<{ result: string; isError: boolean }> {
		try {
			const query = input.query.trim();
			const limit = input.limit || 5;

			const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
			const response = await fetch(url, {
				headers: {
					"User-Agent":
						"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
				},
			});

			if (!response.ok) {
				return {
					result: `Failed to search web: HTTP ${response.status} ${response.statusText}`,
					isError: true,
				};
			}

			const html = await response.text();
			const root = parse(html);

			const results: { title: string; snippet: string; url: string }[] = [];
			const links = root.querySelectorAll(".result__body");

			for (const element of links) {
				if (results.length >= limit) break;

				const titleEl = element.querySelector(".result__title a");
				const snippetEl = element.querySelector(".result__snippet");

				if (titleEl) {
					const title = titleEl.text.trim();
					let rawHref = titleEl.getAttribute("href") || "";

					// Extract actual target URL from DuckDuckGo redirect link
					let targetUrl = rawHref;
					if (rawHref.includes("uddg=")) {
						try {
							const parsedUrl = new URL(`https://duckduckgo.com${rawHref}`);
							targetUrl = decodeURIComponent(parsedUrl.searchParams.get("uddg") || rawHref);
						} catch {
							targetUrl = rawHref;
						}
					}

					const snippet = snippetEl ? snippetEl.text.trim() : "";
					if (title && targetUrl) {
						results.push({ title, snippet, url: targetUrl });
					}
				}
			}

			if (results.length === 0) {
				return {
					result: `No search results found for query: "${query}"`,
					isError: false,
				};
			}

			let output = `🔍 Web Search Results for: "${query}"\n\n`;
			results.forEach((res, i) => {
				output += `${i + 1}. [${res.title}](${res.url})\n   ${res.snippet}\n\n`;
			});

			return { result: output.trim(), isError: false };
		} catch (error: any) {
			return {
				result: `Search web error: ${error.message}`,
				isError: true,
			};
		}
	},
};

/**
 * Ultra-fast, memory-efficient Web Reader Tool using node-html-parser
 */
export const fetchUrlTool: Tool = {
	name: "fetch_url",
	description: "Fetch content from any web URL and convert it into clean, readable Markdown text.",
	inputSchema: {
		type: "object",
		properties: {
			url: {
				type: "string",
				description: "The web URL to fetch (e.g. 'https://docs.cloudflare.com/workers-ai/')",
			},
			maxLength: {
				type: "number",
				description: "Maximum character length of content to extract (default: 8000)",
			},
		},
		required: ["url"],
	},
	async execute(input: { url: string; maxLength?: number }): Promise<{ result: string; isError: boolean }> {
		try {
			const targetUrl = input.url.trim();
			const maxLength = input.maxLength || 8000;

			const response = await fetch(targetUrl, {
				headers: {
					"User-Agent":
						"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
					Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				},
			});

			if (!response.ok) {
				return {
					result: `Failed to fetch URL: HTTP ${response.status} ${response.statusText}`,
					isError: true,
				};
			}

			const html = await response.text();
			const root = parse(html);

			// Remove scripts, styles, navs, footers, and SVG noise for ultra-fast parsing
			root.querySelectorAll("script, style, noscript, svg, nav, footer, iframe").forEach((el) => el.remove());

			const body = root.querySelector("body") || root;

			// Extract title
			const title = root.querySelector("title")?.text.trim() || targetUrl;

			// Convert HTML elements into Markdown blocks
			let markdown = `# ${title}\n\n`;

			const processNode = (element: any): string => {
				let text = "";
				for (const child of element.childNodes) {
					if (child.nodeType === 3) {
						// Text node
						const trimmed = child.text.trim();
						if (trimmed) text += `${trimmed} `;
					} else if (child.nodeType === 1) {
						// Element node
						const tagName = child.tagName?.toLowerCase();
						if (["h1", "h2", "h3", "h4", "h5", "h6"].includes(tagName)) {
							const level = "#".repeat(Number.parseInt(tagName[1], 10));
							text += `\n\n${level} ${child.text.trim()}\n\n`;
						} else if (tagName === "p") {
							text += `\n\n${child.text.trim()}\n\n`;
						} else if (tagName === "li") {
							text += `\n- ${child.text.trim()}`;
						} else if (tagName === "code" || tagName === "pre") {
							text += `\n\`\`\`\n${child.text.trim()}\n\`\`\`\n`;
						} else if (tagName === "a") {
							const href = child.getAttribute("href");
							const linkText = child.text.trim();
							if (href && linkText) {
								text += ` [${linkText}](${href}) `;
							} else if (linkText) {
								text += ` ${linkText} `;
							}
						} else {
							text += processNode(child);
						}
					}
				}
				return text;
			};

			let mainText = processNode(body)
				.replace(/\n{3,}/g, "\n\n")
				.trim();

			// Sanitize prompt injections from web content
			const { globalInjectionScanner } = await import("../security/injection-scanner.ts");
			const { globalAuditLogger } = await import("../security/governance.ts");
			const scanRes = globalInjectionScanner.scan(mainText);

			if (scanRes.hasInjection) {
				globalAuditLogger.logEvent(
					"injection_detected",
					`Prompt injection detected on URL: ${targetUrl} [Matches: ${scanRes.matches.join(", ")}]`,
					"warning",
				);
			}

			mainText = scanRes.sanitizedText;

			if (mainText.length > maxLength) {
				mainText = `${mainText.slice(0, maxLength)}\n\n...[Content truncated at ${maxLength} chars]`;
			}

			return {
				result: mainText || "No main text content found on webpage.",
				isError: false,
			};
		} catch (error: any) {
			return {
				result: `Fetch URL error: ${error.message}`,
				isError: true,
			};
		}
	},
};

/**
 * Multi-Page Documentation Crawler Tool using node-html-parser
 */
export const crawlSiteTool: Tool = {
	name: "crawl_site",
	description: "Recursively crawl a documentation website and extract clean markdown content across multiple pages.",
	inputSchema: {
		type: "object",
		properties: {
			entryUrl: {
				type: "string",
				description: "The root documentation URL to crawl (e.g. 'https://docs.cloudflare.com/workers-ai/')",
			},
			maxDepth: {
				type: "number",
				description: "Maximum link depth to follow (default: 2)",
			},
			maxPages: {
				type: "number",
				description: "Maximum number of pages to crawl (default: 5)",
			},
		},
		required: ["entryUrl"],
	},
	async execute(input: { entryUrl: string; maxDepth?: number; maxPages?: number }): Promise<{ result: string; isError: boolean }> {
		try {
			const entryUrl = input.entryUrl.trim();
			const maxDepth = input.maxDepth || 2;
			const maxPages = input.maxPages || 5;

			const parsedEntry = new URL(entryUrl);
			const baseDomain = parsedEntry.hostname;

			const visited = new Set<string>();
			const queue: { url: string; depth: number }[] = [{ url: entryUrl, depth: 1 }];
			let combinedMarkdown = `# Documentation Crawl Report: ${entryUrl}\n\n`;

			while (queue.length > 0 && visited.size < maxPages) {
				const current = queue.shift();
				if (!current || visited.has(current.url)) continue;
				visited.add(current.url);

				try {
					const res = await fetchUrlTool.execute({ url: current.url, maxLength: 4000 });
					if (!res.isError) {
						combinedMarkdown += `\n---\n## Page ${visited.size}: ${current.url}\n\n${res.result}\n`;
					}

					if (current.depth < maxDepth) {
						const response = await fetch(current.url, {
							headers: { "User-Agent": "Mozilla/5.0" },
						});
						if (response.ok) {
							const html = await response.text();
							const root = parse(html);
							const anchors = root.querySelectorAll("a");

							for (const a of anchors) {
								const href = a.getAttribute("href");
								if (href) {
									try {
										const absolute = new URL(href, current.url).href;
										const parsedAbsolute = new URL(absolute);
										if (parsedAbsolute.hostname === baseDomain && !visited.has(absolute)) {
											queue.push({ url: absolute, depth: current.depth + 1 });
										}
									} catch {
										// Ignore invalid URLs
									}
								}
							}
						}
					}
				} catch {
					// Ignore individual page fetch errors
				}
			}

			return {
				result: combinedMarkdown.trim(),
				isError: false,
			};
		} catch (error: any) {
			return {
				result: `Crawl site error: ${error.message}`,
				isError: true,
			};
		}
	},
};
