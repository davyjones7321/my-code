# CUSTOM AGENT HARNESS — BUILD SPECIFICATION
### (Give this entire file to your coding agent as its system/task prompt)

---

## 0. NON-NEGOTIABLE RULES FOR THE BUILDING AGENT

You are building a production-grade AI agent harness. Follow these rules with zero exceptions:

1. **No one-shotting.** Build ONE phase at a time, in the order listed below. Do not skip ahead, do not pre-write later phases "for efficiency."
2. **Test before proceeding.** Every phase has an explicit "Acceptance Tests" section. Write and run those tests before moving to the next phase. Use real unit/integration tests (not manual eyeballing) wherever the phase is testable in isolation.
3. **Report failures honestly.** If a test fails because of an ambiguity, conflict, or gap in these requirements (not a bug you can just fix), STOP and report it to the user in plain terms:
   - what you were testing
   - what failed and why
   - what decision or clarification you need
   Do not silently reinterpret the spec to make a test pass.
4. **Report bugs too**, but only after you've attempted a fix. If a phase's tests fail due to your own implementation bug, fix it, re-run, and only escalate to the user if you are stuck after 2 genuine attempts.
5. **Checkpoint after every phase.** Summarize: what was built, what was tested, what passed/failed, what's next. Wait for user go-ahead if the phase's exit criteria say so.
6. **Keep a running CHANGELOG.md and ARCHITECTURE.md**, updated at the end of every phase — not at the end of the project.
7. **Never hide a design compromise.** If a phase's implementation deviates from spec for a practical reason, log it explicitly in ARCHITECTURE.md under "Known Deviations."

---

## 1. GOAL

Build a state-of-the-art, open, model-agnostic **agent harness** — a CLI + SDK runtime that wraps any LLM with a tool-use loop, and combines the best proven features from four reference systems: **Hermes Agent**, **Claude Code**, **Codex CLI**, and **OpenCode**.

Default tech stack (override only if user specifies otherwise): **TypeScript/Node.js** for the core (fast iteration, npm ecosystem, easy MCP/SDK story), with the option to later port hot paths to Rust/Go if profiling demands it. Confirm this with the user before Phase 0 if not already agreed.

---

## 2. CORE ARCHITECTURE (must underlie every phase)

Four elements are mandatory and everything else is built around them:

1. **Agent Loop** — init → build context → call model → route (tool_call vs final answer) → execute tool → append result → check context overflow → repeat.
2. **Tool Registry / Execution Engine** — uniform interface for file ops, shell, search, sub-agents, MCP tools.
3. **Context Manager** — tiered context (stable / project / volatile) + compaction.
4. **Control Layer** — guardrails, approvals, stop conditions, sandboxing.

Everything else (memory, skills, gateway, scheduler, observability, orchestration) is a layer built on top of these four and must not violate their contracts.

---

## 3. FEATURE SOURCE MAP (what to borrow from where)

| Feature | Source | Phase |
|---|---|---|
| Provider abstraction (any LLM, hot-swap mid-session) | OpenCode | 2 |
| Tiered context (stable/project/volatile) + prompt-injection scan on project files | Hermes | 4 |
| Lineage-based compression (auxiliary model summarizes old turns, protects head/tail) | Hermes | 4 |
| Sandboxed execution + approval gating on dangerous commands | Codex / Claude Code | 5 |
| Plan agent (read-only) vs Build agent (read-write) mode split | OpenCode | 5 |
| Persistent cross-session memory (FTS5 search + LLM summarization) | Hermes | 6 |
| Portable skills system (agentskills.io compatible) + autonomous skill creation | Hermes | 7 |
| Subagent spawning for parallel workstreams | Hermes | 8 |
| LSP integration for code intelligence | OpenCode | 8 |
| TUI with live status bar (model, tokens, cost, time) + slash commands | Hermes / OpenCode | 9 |
| Embeddable SDK | OpenCode | 10 |
| Multi-platform gateway (Discord/Telegram/Slack/WhatsApp/Email) + voice in/out | Hermes | 11 |
| Cron scheduler for unattended automation | Hermes | 12 |
| Delegation-to-other-harness (call Codex/Claude Code as a tool) | Hermes | 8/13 |
| Observability, retry, model-switch on failure | general SOTA practice | 13 |

---

## 4. PHASED BUILD PLAN

For every phase below: **Goal → Deliverables → Acceptance Tests → Exit Criteria.**

### Phase 0 — Scaffolding & Environment
- **Goal:** repo skeleton, package manager, lint/format, CI stub, config system (`~/.harness/config.toml`), basic logging.
- **Deliverables:** repo structure, `harness --version` runs, config load/save round-trip.
- **Acceptance Tests:** unit test for config parse/write; CLI entrypoint smoke test.
- **Exit Criteria:** `harness init` produces a working, empty project; all tests green.

### Phase 1 — Core Agent Loop
- **Goal:** implement the 6-phase loop (init → context build → model call → decide → execute → overflow check) against a single hardcoded provider (e.g. Anthropic Messages API).
- **Deliverables:** loop runs a trivial "echo" tool end to end.
- **Acceptance Tests:** integration test: prompt → model requests tool → tool executes → result appended → model gives final answer. Test loop termination on final answer. Test infinite-loop guard (max iterations).
- **Exit Criteria:** loop completes a 3-turn tool-use task deterministically in tests (mocked model responses).

### Phase 2 — Provider Abstraction Layer
- **Goal:** normalize tool-call formats across providers (Anthropic Messages, OpenAI Responses/Chat Completions, Bedrock, local OpenAI-compatible endpoints).
- **Deliverables:** provider adapter interface; at least 3 real adapters; mid-session model switch.
- **Acceptance Tests:** contract test suite run against every adapter (same fixture conversation must normalize identically); mid-session switch test preserves context.
- **Exit Criteria:** switching providers mid-conversation via `/model` command does not break the loop.

### Phase 3 — Tool Registry & Execution Engine
- **Goal:** unified tool interface: file read/write/glob/grep, shell exec, web search/fetch, MCP client support.
- **Deliverables:** tool registration API; each tool returns structured results; MCP stdio client.
- **Acceptance Tests:** per-tool unit tests (including failure/error-path tests: missing file, permission denied, nonzero exit code); MCP round-trip test against a mock MCP server.
- **Exit Criteria:** agent can read a file, edit it, and run a shell command to verify the edit, fully via tools.

### Phase 4 — Context Manager
- **Goal:** tiered context — stable (system prompt/identity), project (cwd-derived: AGENTS.md/CLAUDE.md/.cursorrules, with prompt-injection scanning before load), volatile (memory snapshots, timestamps, model/provider metadata). Lineage-based compaction: summarize old turns via an auxiliary model call, protect head/tail by token budget.
- **Deliverables:** context tier builder; compaction trigger on overflow; prompt-injection scanner for project files.
- **Acceptance Tests:** unit test tier assembly order; test compaction preserves head+tail and shrinks total tokens below budget; test injection scanner flags a crafted malicious AGENTS.md.
- **Exit Criteria:** a long synthetic conversation (100+ turns) stays under token budget without losing task-critical early instructions.

### Phase 5 — Control Layer: Safety, Sandboxing, Approvals
- **Goal:** approval gate for dangerous operations (destructive shell commands, writes outside project root, config file changes); sandboxed shell execution; Plan mode (read-only) vs Build mode (read-write) toggle.
- **Deliverables:** approval prompt flow (CLI + programmatic hook for SDK use); sandbox wrapper; mode switch command.
- **Acceptance Tests:** test that a destructive command (`rm -rf`) is blocked without approval; test Plan mode rejects any write tool call; test sandbox prevents filesystem access outside allowed root.
- **Exit Criteria:** no write/destructive action can occur without passing through the approval or mode gate — verified by adversarial test cases.

### Phase 6 — Memory System
- **Goal:** persistent cross-session memory: agent-curated facts, periodic "nudge" prompts to record learnings, FTS5 full-text search over session history, LLM summarization for cross-session recall.
- **Deliverables:** memory store (SQLite+FTS5), write/read API, nudge scheduler hook.
- **Acceptance Tests:** test fact persists across simulated session restart; test FTS5 search returns relevant past session on keyword query; test summarization output is bounded in length.
- **Exit Criteria:** starting a new session, the agent correctly recalls a fact stored in a previous session without it being in raw context.

### Phase 7 — Skills System
- **Goal:** portable, agentskills.io-compatible skill format; skill loader; autonomous skill creation after complex tasks (agent proposes new skill, user approves).
- **Deliverables:** skill schema + loader; `/skills` CLI commands; skill-creation proposal flow.
- **Acceptance Tests:** load a sample third-party agentskills.io skill and confirm it triggers correctly; test that a completed complex task can generate a valid skill draft.
- **Exit Criteria:** a hand-authored skill and an agent-authored skill both load and execute correctly.

### Phase 8 — Subagents, Orchestration & Cross-Harness Delegation
- **Goal:** spawn isolated subagents for parallel workstreams (spawn/list/wait/terminate); optional LSP integration for code intelligence; ability to delegate a task out to an external CLI harness (e.g., shell out to `codex` or `claude` binaries) as a callable tool.
- **Deliverables:** subagent manager; LSP client wrapper; external-harness delegation tool.
- **Acceptance Tests:** test two subagents run in parallel without state leakage; test terminate() actually kills a running subagent; test delegation tool correctly shells out and captures output (mocked binary in CI).
- **Exit Criteria:** a task requiring 2 parallel file edits completes correctly via subagents with no race conditions.

### Phase 9 — CLI / TUI
- **Goal:** terminal UI with persistent status bar (model, token usage %, cost, elapsed time, adaptive to terminal width), slash command autocomplete, markdown-stripped final output, shell-mode passthrough.
- **Deliverables:** TUI (e.g. via a Bubble-Tea-like or blessed/ink-based renderer), `/usage`, `/model`, `/skills`, shell `!` passthrough.
- **Acceptance Tests:** snapshot tests for status bar at 3 width breakpoints; test `/usage` output matches actual token/cost accounting; test `!` passthrough respects approval gate from Phase 5.
- **Exit Criteria:** full interactive session usable end-to-end in a real terminal, matching Hermes/OpenCode UX parity on the above features.

### Phase 10 — Embeddable SDK
- **Goal:** expose the harness as a library (not just a CLI) so it can be scripted/embedded, mirroring OpenCode's SDK story.
- **Deliverables:** documented SDK API (init, run task, register tool, hook into events).
- **Acceptance Tests:** integration test scripting a full task via SDK only, no CLI.
- **Exit Criteria:** a standalone Node script can run a full agent task using only the SDK.

### Phase 11 — Multi-Platform Gateway
- **Goal:** single gateway bridging Discord, Telegram, Slack, WhatsApp, Email; voice memo transcription; voice in/out in supported surfaces.
- **Deliverables:** gateway service with pluggable platform adapters; at least 2 real platform adapters working end to end.
- **Acceptance Tests:** integration test sending/receiving a message through each implemented adapter (using test bot accounts); test voice memo transcription accuracy on a fixture audio file.
- **Exit Criteria:** a message sent to the bot on a supported platform triggers a real agent run and a real reply.

### Phase 12 — Scheduler
- **Goal:** cron-style scheduler for unattended automations, running against the gateway or CLI context.
- **Deliverables:** scheduler service, persistence of scheduled jobs, failure/retry handling.
- **Acceptance Tests:** test job fires at scheduled time (accelerated clock in test); test failed job retries per policy and eventually reports failure to user via gateway.
- **Exit Criteria:** a scheduled job survives a process restart and still fires correctly.

### Phase 13 — Observability, Verification & Reliability
- **Goal:** structured logging/tracing of every loop iteration; a verifier step that checks task completion against acceptance criteria before declaring done; retry-with-model-switch on repeated tool failure.
- **Deliverables:** tracing hooks, verifier module, retry/model-switch policy.
- **Acceptance Tests:** test verifier correctly flags an incomplete task as not-done; test retry policy switches model after N consecutive tool failures.
- **Exit Criteria:** a deliberately broken task (unsatisfiable acceptance criteria) is correctly reported as failed, not silently marked done.

### Phase 14 — Integration, Hardening, Docs, Release
- **Goal:** full end-to-end test suite across all phases combined; security review of approval/sandbox layer; documentation; packaging (npm publish / binary release).
- **Deliverables:** full regression suite, README, ARCHITECTURE.md finalized, CHANGELOG.md finalized, release artifact.
- **Acceptance Tests:** full regression suite green; manual adversarial pass on sandbox/approval layer (attempt privilege escalation, path traversal, prompt injection via project files).
- **Exit Criteria:** all phases' acceptance tests still pass together (not just in isolation); no open "Known Deviations" without user sign-off.

---

## 5. REPORTING FORMAT (use this after every phase)

```
PHASE N COMPLETE — <name>
Built: <short list>
Tests: <pass/fail counts>
Failures (if any):
  - What was tested:
  - Why it failed:
  - Requirement gap or bug? 
  - What I need from you:
Deviations logged: <yes/no, link to ARCHITECTURE.md section>
Ready to proceed to Phase N+1? [waiting for go-ahead / proceeding automatically per your instruction]
```

---

## 6. START INSTRUCTION

Begin with Phase 0. Confirm the tech stack choice with the user before writing any code. Do not proceed to Phase 1 until Phase 0's acceptance tests pass and are reported per the format in Section 5.
