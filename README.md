# 🚀 `my-code` — Autonomous AI Agent CLI & Harness

`my-code` is an autonomous, model-agnostic AI coding assistant and agent harness built for Windows, macOS, and Linux.

---

## ⚡ Quick Installation Guide (For You & Friends)

### 1️⃣ Install Prerequisites
Make sure **[Bun](https://bun.sh)** (or Node.js) and **Git** are installed on your computer.

If you don't have Bun installed yet, run in PowerShell (Windows):
```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```
Or on macOS/Linux:
```bash
curl -fsSL https://bun.sh/install | bash
```

---

### 2️⃣ Clone & Install `my-code`

Open your terminal and run:

```bash
# 1. Clone the repository
git clone https://github.com/davyjones7321/my-code.git
cd my-code

# 2. Install dependencies
bun install

# 3. Build standalone binary
bun run build:binary
```

---

### 3️⃣ Add to PATH (Global Terminal Command)

To run `my-code` from any folder in your terminal:

#### 🪟 Windows (PowerShell)
```powershell
Copy-Item dist\my-code.exe C:\Users\$env:USERNAME\.bun\bin\my-code.exe -Force
```

#### 🍎 macOS / 🐧 Linux
```bash
cp dist/harness-darwin-x64 ~/.bun/bin/my-code  # macOS
# OR
cp dist/harness-linux-x64 ~/.bun/bin/my-code   # Linux

chmod +x ~/.bun/bin/my-code
```

---

### 4️⃣ Initial Setup & Provider Key Configuration

Run the interactive setup wizard:

```bash
my-code setup
```

Follow the prompts to select your AI provider:
- **Cloudflare Workers AI** (Free neurons, no rate limit)
- **OpenRouter**
- **OpenAI**
- **Anthropic**
- **Ollama** (Local LLM)

---

## 🛠️ Essential Slash Commands

| Command | Description |
|---|---|
| `my-code` | Launches interactive REPL agent in active directory |
| `my-code --dir D:\path\to\repo` | Target launch in any specific project folder |
| `/pwd` | Display active repository and folder path |
| `/cd <path>` | Switch active repository inside a running session |
| `/learn <rule>` | Teach the agent a new coding rule or standard |
| `/brain` | Inspect active learned rules in Hermes Agentic Brain |
| `/ponytail [lite\|full\|ultra]` | Set anti-overengineering intensity level |
| `/security` | View prompt injection defense status & audit trail |
| `/guardrails [on\|off]` | Toggle OS & Git destructive command safety |
| `/undo` | Rollback the last set of file edits made by the agent |
| `/check` | Run TypeScript typecheck (`tsc --noEmit`) and LSP diagnostics |

---

## 🧠 Key Features Included

- **Hermes Agentic Brain**: Self-learning memory ledger stored in `~/.harness/brain/learnings.md`.
- **Ponytail Anti-Overengineering Engine**: Forces minimal code, YAGNI, and standard library usage first.
- **Ultra-Fast Web Suite**: `search_web` and `fetch_url` powered by `node-html-parser` (<2MB RAM).
- **Multi-Page Site Crawler**: `crawl_site` recursively builds documentation guides from URLs.
- **Prompt Injection & Guardrails Suite**: Neutralizes malicious web payloads and blocks `git reset --hard` / `git push --force`.
- **Interactive File Diffs & Rollback**: Unified colorized diffs on file edits with instant 1-click `/undo`.
