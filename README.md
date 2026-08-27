# 🤖 `my-code` — Autonomous AI Agent CLI & Harness

`my-code` is a powerful, autonomous, model-agnostic AI coding assistant and agentic harness built for Windows, macOS, and Linux.

---

## ⚡ 1-Minute Quick Installation Guide

### 1️⃣ Install Prerequisites (Bun & Git)
Make sure **[Bun](https://bun.sh)** and **Git** are installed on your computer.

If you don't have Bun installed yet, run:
- **Windows (PowerShell)**:
  ```powershell
  powershell -c "irm bun.sh/install.ps1 | iex"
  ```
- **macOS / Linux**:
  ```bash
  curl -fsSL https://bun.sh/install | bash
  ```

---

### 2️⃣ Clone & Build `my-code`

Open your terminal and run:

```bash
# 1. Clone the repository
git clone https://github.com/davyjones7321/my-code.git
cd my-code

# 2. Install dependencies
bun install

# 3. Compile standalone executable binary
bun run build:binary
```

---

### 3️⃣ Add to PATH (Global Command Execution)

To run `my-code` from any project folder in your terminal:

#### 🪟 Windows (PowerShell)
```powershell
Copy-Item dist\my-code.exe C:\Users\$env:USERNAME\.bun\bin\my-code.exe -Force
```

#### 🍎 macOS / 🐧 Linux
```bash
cp dist/harness-darwin-x64 ~/.bun/bin/my-code   # macOS
# OR
cp dist/harness-linux-x64 ~/.bun/bin/my-code    # Linux

chmod +x ~/.bun/bin/my-code
```

---

### 4️⃣ Initial Provider & Key Configuration

Run the interactive setup wizard:

```bash
my-code setup
```

The wizard guides you through selecting your preferred LLM provider:
1. **Cloudflare Workers AI** *(Free neurons, no rate limits! Default model: `@cf/google/gemma-4-26b-a4b-it`)*
2. **OpenRouter**
3. **OpenAI**
4. **Anthropic**
5. **Ollama** *(Local offline LLMs)*

---

## 🌟 Complete Feature Suite & Architecture

### 🧠 1. Agentic Brain System
- **Self-Learning Memory**: Stores learned rules, project coding standards, and past bug fixes in human-readable Markdown (`~/.harness/brain/learnings.md` and `./.harness/brain/learnings.md`).
- **Auto Prompt Injection**: Automatically injects active learned experience into the agent's prompt on every turn so it never repeats a mistake.
- **Commands**: `/learn <rule>` to teach new lessons, `/brain` to inspect active rules.

### ✂️ 2. Ponytail Anti-Overengineering Engine
- **Strict Simplicity**: Channels a senior dev enforcing YAGNI (You Aren't Gonna Need It), standard library usage first, and minimal code footprints.
- **Intensity Levels**: Supports `lite`, `full` (default), and `ultra`.
- **Commands**: `/ponytail [lite|full|ultra]`, `/ponytail-review`, `/ponytail-audit`.

### 📂 3. Dynamic Repository & Workspace Switching
- **Multi-Repo Management**: Switch active working directories inside a running session without restarting the CLI.
- **Status Bar Display**: Prominently displays the active repository name in the terminal status bar (`[Repo: my-project | ...]`).
- **Commands & Flags**: `/cd <path>`, `/pwd`, and launch flag `--dir <path>`.

### 🌐 4. Ultra-Fast Web Search & Multi-Page Crawler
- **`search_web`**: Real-time web search with DuckDuckGo (zero config required).
- **`fetch_url`**: Powered by `node-html-parser` (<2MB RAM, **20x faster** than `jsdom`), converting web pages to clean Markdown.
- **`crawl_site`**: Recursively crawls multi-page documentation trees up to a custom depth and page limit.

### 🛡️ 5. Security Governance, Injection Defense & Guardrails
- **Prompt Injection Defense**: Scans web content and inputs to neutralize payload attacks (`Ignore all previous instructions`, `<system_message>`, zero-width steganography).
- **Command Guardrails**: Intercepts shell commands to block destructive operations (`git reset --hard`, `git push --force`, `rm -rf`, disk formatting).
- **Audit Logger**: Appends security events to `~/.harness/audit.log`.
- **Commands**: `/security`, `/guardrails [on|off]`.

### 🔄 6. Interactive File Edit Diffs & `/undo` Rollback
- **Colorized Unified Diffs**: Outputs green/red diff previews for every file modified by `write_file` or `edit_file`.
- **`/undo` Command**: Rollback file edits instantly to restore previous file backups.

### 🩺 7. LSP Typecheck & Verification Gate
- **`/check` Command**: Runs TypeScript type checking (`tsc --noEmit`) and LSP diagnostics to catch type/syntax errors before completing tasks.

---

## 💻 Interactive Slash Commands Reference

| Slash Command | Description |
|---|---|
| `/pwd` | Display current active repository name and directory path |
| `/cd <path>` | Switch active repository inside a running session |
| `/learn <rule>` | Teach a new rule or coding standard to the Agentic Brain |
| `/brain` | Inspect active learned rules in the Agentic Brain |
| `/ponytail [level]` | Set anti-overengineering intensity (`lite`, `full`, `ultra`, `off`) |
| `/ponytail-review` | Review code changes for over-engineering and complexity |
| `/ponytail-audit` | Audit whole repository for bloat and dead code |
| `/security` | Inspect prompt injection defense status and audit log |
| `/guardrails [on\|off]` | Toggle OS & Git destructive command safety guardrails |
| `/undo` | Rollback the last set of file edits made by the agent |
| `/check` | Run TypeScript typecheck (`tsc --noEmit`) and LSP diagnostics |
| `/help` | List all available slash commands |
| `/clear` | Clear terminal output screen |
| `/reset` | Reset active conversation history |

---

## 🛠️ CLI Launch Options

```bash
# Launch interactive REPL in current folder
my-code

# Launch interactive REPL in a specific directory
my-code --dir D:\projects\my-app

# Specify LLM provider and model on launch
my-code --provider cloudflare --model @cf/google/gemma-4-26b-a4b-it

# Run in read-only plan mode
my-code --plan
```

---

## 🧪 Developer & Testing Guide

Run the full automated unit test suite:

```bash
# Run all unit tests
bun test

# Run type check
bun x tsc --noEmit
```

---

## 📄 License

MIT License. Designed and built with ❤️.
