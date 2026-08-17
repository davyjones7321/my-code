# OpenAI Codex CLI Agent Architecture & Design

## Executive Summary
The **OpenAI Codex CLI** (`openai/codex`, workspace `codex-rs`) is a high-performance, terminal-native autonomous coding agent built in native **Rust**. Features a decoupled ReAct engine, native OS-level sandboxing (Bubblewrap on Linux, Seatbelt on macOS, Restricted Tokens/Dedicated Users on Windows), JSON-RPC IDE integration, and first-class MCP support.

## 1. Architecture: ReAct Agent Loop
1. **Context Initialization**: Read user input, workspace metadata, AGENTS.md/CODEX.md, session history
2. **Model Invocation (Think)**: Dispatch to OpenAI models via Responses API with SSE streaming
3. **Tool Call Deserialization**: Capture structured tool calls (bash, apply_patch, read_file)
4. **Safety & Policy Verification**: Check via approval_manager against sandbox/policies
5. **Sandboxed Execution**: Tool runs in OS-level isolation
6. **Observation Ingestion**: Format results as observation messages, append to context
7. **Iterate**: Until final completion or user clarification needed

### Multi-Crate Rust Workspace
- `codex-core`: Agent threads, sessions, prompts, model client, tools, sandboxing
- `codex-cli`: CLI entry point and dispatcher
- `codex-tui`: Interactive TUI (ratatui + crossterm)
- `codex-exec`: Headless batch runner for CI/CD
- `codex-app-server`: JSON-RPC daemon for IDE extensions
- `codex-mcp`: MCP integration layer
- `codex-config`: Configuration loader
- `windows-sandbox-rs`: Windows sandboxing primitives

## 2. Sandboxing
- **Linux**: Bubblewrap (bwrap) + Landlock LSM
- **macOS**: Seatbelt (sandbox-exec) with custom profiles
- **Windows**: Dedicated sandbox users + Restricted Tokens + ACLs + Job Objects + WFP firewall
- **Modes**: `read-only`, `workspace-write` (default), `danger-full-access`

## 3. Safety Model & Approval Policies
- **`on-request`** (Default): Autonomous within sandbox, prompts for out-of-bounds
- **`untrusted`**: Zero-trust, confirm everything
- **`never`**: Fully autonomous/headless for CI
- Granular `[[rules]]` system for command prefix allow/deny

## 4. Tool System
- `bash`: Shell with OS sandbox
- `apply_patch`: Deterministic unified diff patching (not full-file rewrites)
- `read_file`/`view_image`: File reading with line ranges + multimodal
- `list_directory`: Fast directory traversal
- MCP integration via `codex-mcp` crate

## 5. Context Management
- Token budget ~258k
- `AGENTS.md`/`CODEX.md` as persistent behavioral guides
- Auto-compaction at ~95% threshold
- SQLite for state storage (state_5.sqlite / orbit.db)

## 6. Provider Support
- Default: OpenAI (GPT-4o, o1, o3, o4-mini) via Responses API
- Custom base URLs via config
- Local models via `requires_openai_auth = false` (Ollama, vLLM)
- Community translators: codex-relay, open-codex

## 7. Tech Stack
| Component | Technology |
|---|---|
| Language | Rust (Edition 2021/2024) |
| Async | tokio |
| TUI | ratatui + crossterm |
| Serialization | serde / serde_json / toml |
| Network | reqwest / hyper |
| IPC | JSON-RPC 2.0 (stdio) |
| Build | cargo + just |
| Distribution | Standalone binaries, npm, Homebrew |

## 8. Configuration (5-tier cascade)
1. CLI Flags
2. Project Config (.codex/config.toml)
3. Profile Config (~/.codex/profile.config.toml)
4. User Global Config (~/.codex/config.toml)
5. Built-in System Defaults

## 9. Key Design Decisions
1. Native Rust binary — instant startup, minimal RAM
2. Decoupled engine + app server via JSON-RPC
3. OS-level primitives over Docker
4. Structured hunk patching (apply_patch) — deterministic, minimal tokens
5. Standardized AGENTS.md behavioral interface

## 10. Strengths & Weaknesses
**Strengths**: Blazing fast, robust multi-OS sandboxing, unified architecture, atomic patches, MCP + AGENTS.md
**Weaknesses**: OpenAI protocol coupling, Windows sandbox complexity, compaction loops, strict sandbox friction

## Sources
- https://github.com/openai/codex
- https://chatgpt.com/codex
- https://modelcontextprotocol.io
- https://ratatui.rs
