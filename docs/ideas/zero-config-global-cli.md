# Zero-Config Global `my-code` CLI Onboarding & Key Management

## Problem Statement
*How Might We create a zero-friction, single-setup global developer CLI experience for `my-code` where any developer can install it once, have API keys auto-detected across all directories (`~/.harness/.env`, local `.env`, environment variables), and receive interactive first-run onboarding when no key is found?*

## Recommended Direction

Implement a 3-tier configuration & credential manager into `my-code`:

1. **Automatic 3-Tier `.env` & TOML Resolution**:
   - **Tier 1 (Environment & Flags)**: `$env:OPENROUTER_API_KEY`, `$env:ANTHROPIC_API_KEY`, `$env:OPENAI_API_KEY`, or `--api-key`.
   - **Tier 2 (Project Level)**: `./.harness/config.toml` or `./.env` in current project folder.
   - **Tier 3 (Global User Home Fallback)**: `C:\Users\<Username>\.harness\.env` or `~/.harness/.env`.

2. **Interactive First-Run Wizard**:
   - When a user types `my-code` for the first time without any API keys configured, `my-code` automatically creates `~/.harness/.env` and presents an interactive CLI prompt:
     ```text
     🔑 Welcome to my-code! No API key detected.
     Select your provider:
       > 1. OpenRouter (Recommended - 100+ models)
         2. Anthropic (Claude 3.7 Sonnet)
         3. OpenAI (GPT-4o)
         4. Ollama (Local)
     Paste your API key: [ sk-or-v1-... ]
     ✔️ Key saved to ~/.harness/.env! Starting agent REPL...
     ```

3. **Interactive Setup Command (`my-code setup`)**:
   - Users can type `my-code setup` at any time to re-configure their default provider, model, or API keys interactively.

---

## Key Assumptions to Validate

- [ ] **Assumption 1**: Users prefer saving keys once in `~/.harness/.env` rather than setting environment variables in PowerShell profiles.
  - *Validation*: Test automatic `.env` loading from `~/.harness/.env` on clean PowerShell/CMD sessions.
- [ ] **Assumption 2**: Interactive readline prompts work seamlessly inside non-TTY or TTY terminal windows without breaking REPL startup.
  - *Validation*: Verify `readline` prompt handles Ctrl+C and fast inputs cleanly.
- [ ] **Assumption 3**: Automatic `.env` template creation does not overwrite existing user `.env` files.
  - *Validation*: Only create `~/.harness/.env` if `fs.existsSync()` returns `false`.

---

## MVP Scope

### Included (In Scope)
- 3-Tier `.env` loader (`~/.harness/.env`, `./.env`, `process.env`).
- Automatic `~/.harness/.env` template generation on first run.
- Interactive first-run onboarding prompt if no provider/key is configured.
- `my-code setup` CLI subcommand for quick interactive key management.
- Unit & integration tests in `tests/cli/setup.test.ts`.

### Excluded (Not Doing & Why)
- **OAuth Web Login Redirects**: Require hosting a dedicated auth server; API key input is faster, safer, and zero-infrastructure for open-source binaries.
- **System Keychain / Credential Manager Integration**: Adds heavy native C++ binary dependencies (like `keytar`); plain-text `.env` in `~/.harness/.env` with strict file permissions (`0600`) matches standard tools like `aider` and `docker`.

---

## Not Doing (and Why)

- **Not Doing Custom Encodings**: Avoid custom encrypted key formats that prevent users from opening `~/.harness/.env` in VS Code or text editors.
- **Not Doing Forced Cloud Account Requirement**: Keep `my-code` 100% local and model-agnostic (OpenRouter, Anthropic, OpenAI, Ollama).

---

## Open Questions

- Should `my-code setup` also allow selecting default models (`claude-3-7-sonnet`, `gpt-4o`, `dots-studio/dots-3-note-preview:free`)? -> *Yes, present a quick model picker during setup.*
