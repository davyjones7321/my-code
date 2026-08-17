# OpenCode — Architecture & Technical Deep Dive

## Executive Summary
**OpenCode** is an open-source, model-agnostic, terminal-first AI coding agent by Anomaly Innovations (creators of SST/OpenAuth). Key differentiators: decoupled Client-Server architecture with OpenAPI 3.1, OpenTUI (Zig-based TUI), deep LSP integration for autonomous self-correction, 75+ LLM providers with hot-swapping, and Plan vs Build dual-agent isolation.

## 1. Architecture

### Client-Server Design
- **Server** (Bun/TypeScript): Sessions, tools, model communication, LSP, SQLite
- **Frontend** (OpenTUI): Zig + TypeScript TUI over OpenAPI endpoints
- Multiple frontends can connect to same server (TUI, VS Code, GitHub bot, headless CLI)

### Agent Loop
1. Session/prompt init — model-specific system prompts, project rules, LSP diagnostics
2. Context compaction — semantic summarization near thresholds
3. Model request — dispatch to provider, stream tokens via Event Bus
4. Tool call parsing — check against mode permission matrix (allow/deny/ask)
5. Tool execution + LSP feedback — file edits trigger didChange → diagnostics → next prompt
6. Continue until final text answer or Esc interrupt

## 2. Provider Abstraction & Hot-Swapping
- Universal interface across OpenAI, Anthropic, Gemini, Ollama, DeepSeek, Bedrock, Mistral, Groq
- OpenCode Zen: optional curated proxy gateway
- Mid-session: `/model` for picker, `/connect` for new APIs
- Context preserved across transitions via SQLite + schema reformatting

## 3. Plan Mode vs Build Mode

| Dimension | Plan Mode | Build Mode |
|---|---|---|
| Focus | Exploration, architecture | Implementation, fixes |
| Toggle | Tab key | Tab key |
| Filesystem | Read-Only (.opencode/plans/ only) | Read-Write |
| Shell | Disabled or ask | Enabled (allow/ask) |
| Tools | read, glob, grep, codesearch, websearch | All tools |

### Subagents
- `@explore`: Lightweight read-only for navigation
- `@general`: Multi-turn reasoning for research
- Permission scoping from opencode.json or agent manifests

## 4. Embeddable SDK

### Server Mode (`opencode serve`)
- HTTP server (port 4096) with full OpenAPI 3.1 spec at `/doc`
- Session, message, tool approval, health/LSP endpoints

### SDKs
- `@opencode-ai/sdk` (TypeScript): Generated from OpenAPI contract
- `ai-sdk-provider-opencode-sdk`: Vercel AI SDK compatible
- GitHub Bot: headless PR/Issue automation
- `opencode --standalone`: one-shot execution

## 5. LSP Integration
- JSON-RPC via vscode-jsonrpc
- Zero-config discovery: vtsls, pyright, gopls, rust-analyzer, clangd, intelephense
- Real-time diagnostics after edits → autonomous self-correction
- Symbol navigation, references, hover type info

## 6. Tool System
| Tool | Description | Safety |
|---|---|---|
| `bash` | Terminal commands | permission.bash |
| `edit` | Search-and-replace with diffs | Restricted in Plan |
| `read` | File contents with line ranges | Read-only |
| `write` | Create/overwrite files | Restricted in Plan |
| `glob` | File pattern matching | Read-only |
| `grep` | Text/regex search | Read-only |
| `websearch` | Web querying (Exa AI/MCP) | External |
| `codesearch` | Semantic code search | Read-only |
| `todowrite` | Task tracking | Internal |
| `question` | User clarification | Blocking |
| `lsp` | Language server queries | Read-only |

Plus MCP integration and npm plugin system.

## 7. TUI & Status Bar
- **OpenTUI**: Zig core, sub-millisecond redraws, zero flicker
- Header: workspace, git branch, health
- Message area: streaming, markdown, collapsible tool blocks, diffs
- Status bar: mode badge, model name, session ID, token/cost counter, context meter
- Multimodal: drag-and-drop images
- Leader key system (Ctrl+X), command palette (Ctrl+P)

## 8. Tech Stack
- **Runtime**: Bun
- **Languages**: TypeScript (agent logic), Zig (OpenTUI)
- **Database**: SQLite (bun:sqlite / better-sqlite3)
- **IPC**: vscode-jsonrpc (LSP), OpenAPI 3.1 (HTTP/REST)

## 9. Configuration
- Project: `./opencode.json` or `.opencode/opencode.json`
- Global: `~/.config/opencode/opencode.json`
- TUI keys: `~/.config/opencode/tui.json`
- Custom agents: `~/.config/opencode/agents/*.md`

## 10. Strengths & Weaknesses
**Strengths**: Model neutrality (75+ models), clean client-server architecture, blazing TUI (Zig), self-correcting LSP loop
**Weaknesses**: Degradation on non-frontier models, SQLite concurrency glitches, MCP security concerns

## Sources
- https://github.com/anomalyco/opencode
- https://opencode.ai/docs
- https://github.com/anomalyco/opentui
- https://www.npmjs.com/package/@opencode-ai/sdk
