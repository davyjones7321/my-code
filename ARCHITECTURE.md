# Architecture

## Project Structure
- `src/cli`: CLI entrypoint using Commander.js.
- `src/config`: Configuration management using TOML.
- `src/logger.ts`: Centralized structured logging.
- `tests`: Test suites mirroring `src`.

## Key Decisions
- **Runtime**: Bun for fast execution, native TypeScript support, and SQLite ecosystem.
- **Config**: TOML format (via `smol-toml`) for human-readable configuration files.
- **CLI**: `commander` for robust command line argument parsing.
- **Testing**: `bun:test` to avoid external test runners.

## Known Deviations
None.

## Phase 2 Design
### Provider Abstraction Layer
The Provider architecture abstracts specific LLMs using a uniform API contract:
- `OpenAIProvider`: Implements standard Chat Completions.
- `OllamaProvider`: Reuses `OpenAIProvider` with default localhost endpoint.
- `ProviderRegistry`: Centralized registry for initializing providers from `HarnessConfig`.
- **Contract Tests**: Ensures that all providers (Anthropic, OpenAI, Ollama) normalize tool uses, mixed messages, and simple texts identically.

## Phase 1 Design
### Core Agent Loop
The core agent loop (`src/agent/loop.ts`) uses an `AsyncGenerator<LoopEvent>` to yield events (tool calls, results, responses, errors). This stream-like architecture allows the consumer (like the CLI or a web UI) to react to agent events in real-time.

### Provider Interface
The `Provider` interface (`src/providers/base.ts`) abstracts out the specific LLM API. Adapters (e.g., `AnthropicProvider`) convert standardized `Message[]` inputs to provider-specific formats and normalize their responses into `ContentBlock[]`.

### Message Types
Provider-agnostic types (`src/agent/types.ts`) define `Message`, `ContentBlock` (`TextContent`, `ToolUseContent`, `ToolResultContent`), and `ToolDefinition`. All providers must conform to this schema, ensuring the agent loop logic is agnostic to the LLM backend.  
### Phase 3 - Tool Registry  
- Tool Registry implemented for managing tools.  
- Built-in tools added: File read/write/edit, glob, grep, shell.  
- Basic MCP client added for stdio JSON-RPC tool discovery. 
