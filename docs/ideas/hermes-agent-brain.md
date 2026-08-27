# Hermes-Style Agentic Brain & Self-Learning System

## Problem Statement
*How Might We equip `my-code` with an autonomous, self-improving "Agentic Brain" (similar to Hermes Agent and AutoGPT) so that the agent reflects on every task, remembers past bug fixes & project rules in `~/.harness/brain/learnings.md`, and automatically injects these lessons into its system prompt so it gets smarter over time and never repeats a mistake?*

## Recommended Direction

Implement a 4-pillar **Brain Architecture** into `my-code`:

1. **Persistent Brain Directory (`~/.harness/brain/`)**:
   - `~/.harness/brain/learnings.md`: Global repository of learned rules, project tips, and past bug fixes.
   - `./.harness/brain/learnings.md`: Project-specific learned rules.

2. **Automatic Post-Task Reflection & Self-Learning (`/reflect`)**:
   - After completing a task or resolving a bug/test failure, the agent automatically reflects:
     *"What lesson did I learn from this turn?"*
   - It appends structured, actionable lessons to `~/.harness/brain/learnings.md`.

3. **Interactive REPL Slash Commands (`/learn` and `/brain`)**:
   - **`/learn <lesson>`**: Instantly saves a new rule to the brain (e.g. `/learn Always run bun test instead of npm test on this repo`).
   - **`/brain`**: Displays all active learned rules, memory count, and brain status in REPL.

4. **Dynamic Brain Context Injector**:
   - On every turn, `getSystemEnvironmentPrompt()` reads `~/.harness/brain/learnings.md` and `SOUL.md`, injecting learned rules directly into the AI's active system prompt.

---

## Key Assumptions to Validate

- [ ] **Assumption 1**: Markdown-based `learnings.md` is faster, more transparent, and easier for users to edit manually than opaque vector databases.
  - *Validation*: Verify users can open `~/.harness/brain/learnings.md` in VS Code, add/edit rules, and have `my-code` pick them up instantly.
- [ ] **Assumption 2**: Auto-reflecting after bug fixes adds minimal token overhead while capturing valuable lessons.
  - *Validation*: Only trigger automatic reflection when a tool error or test failure was successfully resolved.

---

## MVP Scope

### Included (In Scope)
- `BrainManager` class (`src/brain/manager.ts`).
- Storage engine for `~/.harness/brain/learnings.md` and `./.harness/brain/learnings.md`.
- Dynamic prompt injection into `getSystemEnvironmentPrompt()`.
- REPL slash commands: `/learn <text>` and `/brain`.
- Automatic post-task reflection on bug fixes.
- Test suite in `tests/brain/brain.test.ts`.

### Excluded (Not Doing & Why)
- **Opaque Heavy Vector Databases (ChromaDB / Pinecone)**: Would add massive native C++ dependencies and bloat binary size; Markdown + SQLite FTS5 is 100x faster, zero-dependency, and human-readable.

---

## Not Doing (and Why)

- **Not Doing Unchecked Auto-Learning Bloat**: Limit `learnings.md` active rule injection to top 15 most relevant rules to prevent system prompt bloat.

---

## Open Questions

- Should `/learn` allow tagging rules by domain (e.g. `[git]`, `[bun]`, `[ui]`)? -> *Yes, support markdown bullet tags.*
