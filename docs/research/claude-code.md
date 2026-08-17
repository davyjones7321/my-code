# Deep Dive: Claude Code (Anthropic CLI Agent) Architecture & Technical Reference

## Executive Summary
**Claude Code** (`@anthropic-ai/claude-code`) is Anthropic's official agentic command-line interface and coding assistant runtime. An autonomous terminal agent designed around a proactive "Gather Context → Take Action → Verify Results" loop. Core engineering shaped by **Anthropic Prompt Caching**, a **React + Ink terminal UI**, an extensible **Hooks and Permissions engine**, **OS-level sandboxing (Seatbelt/Bubblewrap)**, and **dual delegation primitives (Hierarchical Subagents & Peer Agent Teams)**.

## 1. Architecture: The Agent Loop & Tool-Use Flow

### Core Agent Loop
1. **Gather Context**: Inspect workspace via Read, Glob, Grep, Bash (read-only)
2. **Take Action**: Mutations via Edit/FileEdit, Write, Bash, Agent (subagents)
3. **Verify Results**: Evaluate compiler errors, test outputs, diff outputs, self-correct

### Tech Stack
- **UI Layer**: React + Ink (reactive TUI)
- **CLI Parser**: Commander.js
- **Runtime**: Bundled with Bun
- **Streaming**: @anthropic-ai/sdk with HTTP SSE

## 2. Sandboxing

### OS-Native Sandbox
- **macOS**: Seatbelt (`sandbox-exec`) — restricts filesystem writes, system calls, network egress
- **Linux/WSL2**: Bubblewrap (`bwrap`) — unprivileged user namespaces, restricts sensitive host directories
- **Nested Sandboxes**: `enableWeakerNestedSandbox` for Docker/Codespaces environments

### Container/VM-Level
- Dev Containers & Docker patterns provided
- VMs recommended for headless CI/CD with `--dangerously-skip-permissions`

## 3. Permission Model & Approval Gating

### Permission Modes
1. **`manual`** (Default): Explicit user confirmation for all operations
2. **`auto`** (Pro/Team/Max): Background safety classifier auto-approves low-risk ops
3. **`bypassPermissions`** (`--dangerously-skip-permissions`): For isolated containers only

### Configuration Scopes (precedence order)
1. Managed (System/Enterprise)
2. CLI Flags
3. Local Scope (`.claude/settings.local.json`)
4. Project Scope (`.claude/settings.json`)
5. User Scope (`~/.claude/settings.json`)

### Deterministic Hooks System
- Events: `PreToolUse`, `PostToolUse`, `SessionStart`, `UserPromptSubmit`, `Stop`, `Notification`
- Executors: `command` (shell), `prompt` (LLM eval), `http` (webhook), `agent` (subagent), `mcp_tool`
- Blocking: Hook exits non-zero or outputs `{"decision": "deny", "reason": "..."}` → tool call aborted

## 4. Context Management & Prompt Caching

### Prompt Caching (Core Constraint)
- Uses `cache_control: {"type": "ephemeral"}` API
- Static elements (System Prompts, Tool Schemas, CLAUDE.md, past turns) remain prefix-identical
- ~90% cost reduction on cache hits, sub-second response times

### Compaction (`/compact`)
- Automatic or manual trigger
- Auxiliary LLM summarizes older turns into structured summary
- System prompt, project root CLAUDE.md, active skills preserved un-compacted
- `/context` shows token breakdown, `/usage` shows cost

## 5. Built-in Tool System

| Tool | Category | Description |
|---|---|---|
| `Bash` | Execution | Terminal commands with sandboxing |
| `FileEdit`/`Edit` | Mutation | String replacements / surgical diff edits |
| `Read`/`View` | Filesystem | File contents with line-range slicing |
| `Write` | Mutation | Create/overwrite files |
| `Grep` | Search | Regex codebase search (ripgrep) |
| `Glob` | Search | File/directory pattern matching |
| `Agent`/`Task` | Orchestration | Isolated subagent with own context window |
| `WebFetch`/`WebSearch` | Network | Web docs or internet search |
| `AskUserQuestion` | Interaction | Solicit user clarification |
| `NotebookRead`/`NotebookEdit` | Specialized | Jupyter Notebook cells |
| `Todo`/`Memory` | State | Subtask tracking and cross-session knowledge |
| MCP Tools | Extensibility | Dynamically discovered via MCP servers |

## 6. MCP Integration
- Full MCP Client
- CLI: `claude mcp add <name> --transport <stdio|http> <command-or-url>`
- Scoping: `--scope project` (.mcp.json), `--scope user` (~/.claude.json), `--scope local`
- Dynamic tool discovery from connected MCP servers at startup

## 7. SDK & Headless Mode

### Headless CLI (`-p` / `--print`)
- Output formats: `text`, `json`, `stream-json`
- `--bare` flag skips auto-discovery for fast CI startup

### Programmatic SDK
- `query()` for single-shot invocation
- `ClaudeSDKClient` for stateful sessions with custom tool approval callbacks

## 8. Configuration (CLAUDE.md)
- **User Scope** (`~/.claude/CLAUDE.md`): Global developer habits
- **Project Root** (`./CLAUDE.md`): Repository-wide patterns
- **Subdirectory** (`packages/ui/CLAUDE.md`): Modular rules for subtrees
- `.claudeignore` for excluding paths

## 9. Strengths
1. Exceptional reasoning & autonomy (Claude 3.5/3.7 Sonnet)
2. Prompt caching economics (90% cost savings)
3. Terminal-native workflow, zero IDE lock-in
4. Deterministic guardrails (Hooks) — AI cannot bypass
5. Native MCP & subagents

## 10. Weaknesses
1. Token appetite & cold cache costs
2. Approval prompt fatigue in manual mode
3. Sandbox setup friction (Linux/WSL2)
4. Limited diff visualization vs IDE
5. Windows shell translation issues

## Sources
- Anthropic Official Documentation: https://docs.anthropic.com
- NPM: @anthropic-ai/claude-code
- Model Context Protocol: https://modelcontextprotocol.io
