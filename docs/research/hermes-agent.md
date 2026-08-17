# Hermes Agent (NousResearch) — Architecture & Technical Reference

## Executive Summary
**Hermes Agent** is an open-source, model-agnostic, persistent AI agent runtime by Nous Research. Designed as a long-running, self-improving autonomous operating system featuring: persistent cross-session memory, tiered context with lineage-aware compression, agentskills.io-compatible skills engine, multi-platform messaging gateways (Telegram, Discord, Slack, WhatsApp, Signal, Email), cron scheduling, and cross-harness delegation.

## 1. Architecture & Core Event Flow

### Repository Layout
- `agent/`: Core reasoning runtime (AIAgent class, prompt_builder, context_compressor)
- `gateway/`: Platform connectors, multi-user routing, RBAC
- `tools/`: 40-60+ modular tools
- Entry points: CLI (`hermes`), Gateway daemon (`hermes gateway start`), Batch runner, Python API

### Core Agent Loop
1. **Event Reception**: User message from CLI/Gateway, cron tick, subagent return
2. **Session Hydration**: Load from SQLite, pull MEMORY.md/USER.md, FTS5 retrieval
3. **Prompt Assembly**: prompt_builder.py with strict tiered ordering for cache optimization
4. **Model Invocation**: Via LiteLLM (OpenAI, Anthropic, OpenRouter, Gemini, Ollama)
5. **Tool Dispatch**: Validate via Pydantic schemas, execute (local/Docker/Modal/Daytona)
6. **Interrupt Handling**: Mid-execution injection of high-priority messages
7. **State Persistence**: Full trajectory committed to SQLite

## 2. Tiered Context & Lineage Compression

### Three-Tier Architecture
| Tier | Name | Content | Cache |
|---|---|---|---|
| 1 | Stable | Identity, instructions, tool schemas | Static/Hot — never invalidates |
| 2 | Project | MEMORY.md, active SKILL.md, file attachments | Semi-Stable |
| 3 | Volatile | USER.md, timestamps, scratchpad, conversation history | Dynamic — changes every turn |

### Lineage-Based Compression
- **50% threshold**: Summarize older turns into high-density declarative summaries
- **85% threshold**: Emergency aggressive summarization
- **Session Lineage DAG**: Records parent_id/session_id for provenance, checkpoint rollback
- **Pluggable engines**: Default lossy compressor, optional lossless (lcm)

## 3. Memory System

### Frozen Markdown Snapshots (~/.hermes/memories/)
- `MEMORY.md` (~2,200 chars): Project conventions, architecture, lessons learned
- `USER.md` (~1,375 chars): Communication style, preferences, habits
- Auto-rewritten by agent when new facts learned

### FTS5 Full-Text Search
- Past conversations indexed in SQLite FTS5 virtual tables
- On-demand historical query without loading full transcripts

### Dialectic User Modeling (Honcho)
- Three-pass reasoning: Initial Assessment → Self-Audit → Reconciliation
- Builds behavioral model of the user

## 4. Skills System

### agentskills.io Standard
- Directory structure: SKILL.md + scripts/ + references/ + resources/
- YAML frontmatter + markdown instructions

### Progressive Disclosure
1. **Discovery**: Boot — only name/description indexed (~20-40 tokens per skill)
2. **Activation**: Task match — full SKILL.md into Tier 2 context
3. **Execution**: references/ and scripts/ read on demand

### Autonomous Skill Creation
- `/learn` slash command or autonomous post-task reflection
- In-place refinement on edge cases
- Experimental: GEPA/DSPy self-evolution
- Trust tiers: Official → Trusted → Community

## 5. Subagent Spawning
- `delegate_task` tool and `async_delegation` module
- Isolated sessions, separate execution environments
- Non-blocking: parent stays responsive
- Subagents deliver concise structured summaries to parent

## 6. Multi-Platform Gateway
- Telegram, Discord, Slack, WhatsApp, Signal, Email
- RBAC: Owner/Admin/User/Guest tiers
- Unified state across platforms via SQLite
- Gateway daemon: API port 8642, web dashboard 9119

## 7. Cron Scheduler
- Background thread in gateway daemon
- SQLite-persisted jobs
- Standard 5-field cron syntax
- Slash commands: /cron add/list/pause/resume/delete
- Agent tool: `cronjob` for autonomous scheduling
- Results posted to user's preferred channel

## 8. TUI
- Built with prompt_toolkit + rich
- Live status bar: model, tokens/sec, context %, elapsed time, latency
- Slash commands: /new, /reset, /model, /status, /compress, /learn, /cron, /users

## 9. Cross-Harness Delegation
- Orchestrator over specialized CLIs
- Spawns claude, aider, codex as subprocess subagents
- Non-blocking subprocess with stdin/stdout capture
- Skill wrappers for integration

## 10. Tech Stack
- **Runtime**: Python 3.11+
- **Package manager**: uv
- **LLM transport**: LiteLLM
- **Persistence**: sqlite3 + FTS5
- **Validation**: pydantic v2
- **TUI/CLI**: prompt_toolkit, rich, click/typer
- **API/Gateway**: FastAPI, Starlette, Uvicorn
- **Sandboxes**: Local, Docker, SSH, Modal, Daytona

## 11. Strengths & Weaknesses
**Strengths**: True persistence/self-improvement, model agnostic, multi-platform gateway, cache-aware engineering, agentskills.io compatibility
**Weaknesses**: Bleeding-edge instability, security/sandboxing risks, high technical barrier, compression lossiness over long sessions

## Sources
- https://github.com/NousResearch/hermes-agent
- https://hermes-agent.nousresearch.com
- https://agentskills.io
- https://honcho.dev
