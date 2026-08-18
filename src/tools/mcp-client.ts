import { type Subprocess, spawn } from "bun";
import type { Tool, ToolResult } from "./registry.ts";

export class MCPClient {
	private proc: Subprocess | null = null;
	private messageId = 1;
	private pendingRequests: Map<
		number,
		{ resolve: (val: any) => void; reject: (err: any) => void }
	> = new Map();
	private buffer = "";

	constructor(
		private command: string[],
		private cwd: string,
	) {}

	async start(): Promise<void> {
		this.proc = spawn(this.command, {
			cwd: this.cwd,
			stdin: "pipe",
			stdout: "pipe",
			stderr: "ignore", // ignoring stderr for simplicity
		});

		this.readStdout();
	}

	private async readStdout() {
		if (!this.proc || !this.proc.stdout) return;

		try {
			const stream = this.proc.stdout as unknown as ReadableStream;
			const reader = stream.getReader();
			const decoder = new TextDecoder();

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				this.buffer += decoder.decode(value, { stream: true });

				let newlineIndex;
				while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
					const line = this.buffer.slice(0, newlineIndex).trim();
					this.buffer = this.buffer.slice(newlineIndex + 1);

					if (line) {
						try {
							const msg = JSON.parse(line);
							this.handleMessage(msg);
						} catch (e) {
							console.error("Failed to parse MCP message:", e);
						}
					}
				}
			}
		} catch (e) {
			// Stream closed or error
		}
	}

	private handleMessage(msg: any) {
		if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
			const { resolve, reject } = this.pendingRequests.get(msg.id)!;
			this.pendingRequests.delete(msg.id);

			if (msg.error) {
				reject(msg.error);
			} else {
				resolve(msg.result);
			}
		}
	}

	private async request(method: string, params: any = {}): Promise<any> {
		if (!this.proc || !this.proc.stdin) throw new Error("MCP Client not started");

		return new Promise((resolve, reject) => {
			const id = this.messageId++;
			this.pendingRequests.set(id, { resolve, reject });

			const msg = {
				jsonrpc: "2.0",
				id,
				method,
				params,
			};

			(this.proc!.stdin as any).write(JSON.stringify(msg) + "\n");
		});
	}

	private notify(method: string, params: any = {}): void {
		if (!this.proc || !this.proc.stdin) return;

		const msg = {
			jsonrpc: "2.0",
			method,
			params,
		};

		(this.proc.stdin as any).write(JSON.stringify(msg) + "\n");
	}

	async initialize(): Promise<void> {
		await this.request("initialize", {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: { name: "my-harness", version: "0.1.0" },
		});

		this.notify("notifications/initialized");
	}

	async listTools(): Promise<any[]> {
		const res = await this.request("tools/list");
		return res.tools || [];
	}

	async callTool(name: string, args: any): Promise<any> {
		return await this.request("tools/call", { name, arguments: args });
	}

	close(): void {
		if (this.proc) {
			this.proc.kill();
			this.proc = null;
		}
	}

	getTools(): Tool[] {
		// This would typically return a promise, but for a synchronous sync,
		// we would need to know the tools beforehand or create a factory.
		// Since MCP listTools is async, we expose a helper below.
		return [];
	}
}

export async function createMCPTools(
	command: string[],
	cwd: string,
): Promise<{ tools: Tool[]; client: MCPClient }> {
	const client = new MCPClient(command, cwd);
	await client.start();
	await client.initialize();

	const mcpTools = await client.listTools();

	const tools: Tool[] = mcpTools.map((t) => ({
		name: t.name,
		description: t.description,
		inputSchema: t.inputSchema,
		execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
			try {
				const result = await client.callTool(t.name, input);
				const textContent = result.content?.map((c: any) => c.text).join("\n") || "";
				return { result: textContent, isError: result.isError || false };
			} catch (err: any) {
				return { result: `Error calling MCP tool: ${err.message || String(err)}`, isError: true };
			}
		},
	}));

	return { tools, client };
}
