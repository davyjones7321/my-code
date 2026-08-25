import type { Provider, ProviderCallConfig } from "../providers/base.ts";
import type { AgentLoopConfig, ContentBlock, LoopEvent, Message } from "./types.ts";

export interface ToolExecutor {
	name: string;
	execute(input: Record<string, unknown>): Promise<{ result: string; isError: boolean }>;
}

export function getSystemEnvironmentPrompt(): string {
	const platform = process.platform;
	const isWindows = platform === "win32";
	const osName = isWindows ? "Windows" : platform === "darwin" ? "macOS" : "Linux";
	const shellName = isWindows ? "cmd.exe / PowerShell" : "bash/sh";

	return `You are an expert autonomous AI coding assistant running on ${osName} (Shell: ${shellName}).

CRITICAL ENVIRONMENT GUIDANCE:
1. PREFER BUILT-IN TOOLS FOR FILE CREATION & EDITING:
   - Always use the 'write_file' tool directly to create files and folders. It automatically creates parent directories as needed.
   - Use 'edit_file' to modify existing files.
   - Use 'read_file' to view file contents.
2. RUNNING SHELL COMMANDS:
   - You are running on ${osName}. ${isWindows ? "Do NOT use Linux bash commands like 'mkdir -p' or 'ls'. On Windows, use 'write_file' directly for file creation, or native commands like 'dir'." : "Use standard bash/posix commands."}
3. BE DECISIVE AND AUTONOMOUS:
   - When asked to create code, HTML, CSS, or multi-file projects, invoke 'write_file' to create all required files.`;
}

export async function* runAgentLoop(
	provider: Provider,
	prompt: string,
	tools: ToolExecutor[],
	config: AgentLoopConfig,
	callConfigOverrides: Partial<ProviderCallConfig> = {},
): AsyncGenerator<LoopEvent> {
	const messages: Message[] = [{ role: "user", content: [{ type: "text", text: prompt }] }];

	let iterations = 0;

	while (iterations < config.maxIterations) {
		iterations++;

		const envPrompt = getSystemEnvironmentPrompt();
		const baseSystemPrompt = config.systemPrompt ? `${config.systemPrompt}\n\n${envPrompt}` : envPrompt;

		const callConfig: ProviderCallConfig = {
			model: callConfigOverrides.model || "",
			systemPrompt: baseSystemPrompt,
			...callConfigOverrides,
		};

		const response = await provider.chat(messages, config.tools, callConfig);

		// Append assistant response to message history
		messages.push({ role: "assistant", content: response.content });

		const toolUseBlocks = response.content.filter((block) => block.type === "tool_use");

		if (toolUseBlocks.length === 0) {
			// Yield response event
			const textBlocks = response.content.filter((b) => b.type === "text");
			const text = textBlocks.map((b) => ("text" in b ? b.text : "")).join("\n");
			yield { type: "response", text };
			yield { type: "done", totalIterations: iterations };
			return;
		}

		const toolResults: ContentBlock[] = [];

		for (const block of toolUseBlocks) {
			if (block.type !== "tool_use") continue; // Type guard

			yield {
				type: "tool_call",
				toolName: block.name,
				toolInput: block.input,
				toolUseId: block.id,
			};

			const executor = tools.find((t) => t.name === block.name);
			let resultStr = "";
			let isError = false;

			if (!executor) {
				resultStr = `Tool not found: ${block.name}`;
				isError = true;
			} else {
				try {
					const res = await executor.execute(block.input);
					resultStr = res.result;
					isError = res.isError;
				} catch (err: any) {
					resultStr = `Error executing tool: ${err.message}`;
					isError = true;
				}
			}

			yield {
				type: "tool_result",
				toolUseId: block.id,
				result: resultStr,
				isError,
			};

			toolResults.push({
				type: "tool_result",
				toolUseId: block.id,
				content: resultStr,
				isError,
			});
		}

		messages.push({ role: "tool", content: toolResults });
	}

	yield { type: "error", error: new Error(`Max iterations (${config.maxIterations}) reached`) };
}
