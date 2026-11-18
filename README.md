# whatsloaded

**See, diagnose, and safely manage the MCP servers, skills, agents, rules, and plugins configured across your AI coding tools.**

Works seamlessly across **Claude Code**, **Codex CLI**, **Kiro**, **opencode**, and the shared `~/.agents` skill store.

---

## The Problem

Every AI coding assistant uses its own configuration files and conventions:

- Claude Code uses `~/.claude.json`, `.mcp.json`, and `.claude/`
- Codex CLI uses `~/.codex/config.toml` and `.codex/`
- Kiro uses `~/.kiro/settings/mcp.json` and agent definitions
- opencode uses `opencode.json`

When you work across multiple tools, configuration quickly drifts: you have duplicate MCP server processes, broken symlinks, unused skills consuming thousands of tokens of context window, and no easy way to share setups across tools.

**`whatsloaded` provides one unified dashboard and CLI to see everything, fix issues, and manage configs safely with automatic backups and instant undo.**

---

## ⚡ Quick Start

### 1. Installation

```bash
git clone https://github.com/bvamc/whatsloaded.git
cd whatsloaded
npm install && npm run build && npm link
```

_This installs the `whatsloaded` command globally on your system._

### 2. Launch the Web Dashboard

```bash
whatsloaded ui
```

Opens an interactive local dashboard at `http://127.0.0.1:4319`.

### 3. Or use the CLI right away

```bash
# See everything configured across all your tools
whatsloaded ls

# Run diagnostics to find broken configs or drift
whatsloaded doctor

# Measure how many tokens an MCP server costs in context
whatsloaded measure github
```

---

## 🖥️ Three Ways to Use

### 1. Web Dashboard (`whatsloaded ui`)

A fast, modern local dashboard with:

- **Matrix View**: Cross-tool grid showing where each MCP server and skill is defined.
- **Inspector**: Detailed breakdown with syntax diffs between tools and secret masking.
- **Safe Review Dialog**: Shows the exact diff before any file is touched, with a one-click Undo toast.
- **Doctor View**: Surface shadowing, broken links, duplicate processes, and configuration drift.

### 2. Interactive Terminal UI (`whatsloaded tui`)

Prefer staying in the terminal? Run `whatsloaded tui` for an interactive, keyboard-driven browser:

- `↑` / `↓` to navigate
- `Space` to toggle enable/disable
- `Enter` to inspect details
- `/` to live-filter items

### 3. Command-Line Interface (`whatsloaded <command>`)

Scriptable, fast, and pipeable CLI for everyday terminal workflows.

---

## 🚀 Common Commands & Workflows

### 🔍 Explore & Inspect

| Command                            | What it does                                                        |
| :--------------------------------- | :------------------------------------------------------------------ |
| `whatsloaded ls`                   | List every configured MCP server, skill, agent, rule, and plugin.   |
| `whatsloaded matrix`               | Grid view displaying which tools configure each server or skill.    |
| `whatsloaded where <server>`       | See everywhere an MCP server is configured and which agents use it. |
| `whatsloaded show <name>`          | Show complete configuration details (secrets masked by default).    |
| `whatsloaded show <name> --reveal` | Show details with environment variables and headers unmasked.       |

### 🩺 Health & Diagnostics

```bash
whatsloaded doctor
```

Scans your entire environment and reports:

- **Configuration Drift**: The same server configured differently across tools.
- **Missing Commands**: MCP servers pointing to binaries that are not installed on your PATH.
- **Orphaned References**: Agents configured to use servers they cannot access.
- **Duplicate Processes**: Multiple configurations spawning redundant server processes.
- **Unshared Skills**: Standalone skills that could be shared across tools via `whatsloaded adopt`.

### 📏 Measure Context Overhead

MCP tool schemas consume tokens _before you even send your first prompt_. Check their cost:

```bash
whatsloaded measure <server>
```

Starts the server safely once, reads its tool schemas, and calculates the exact tool count and context token footprint.

### ✏️ Manage & Sync Configurations

All modifying commands preview the exact plan and ask for confirmation before writing.

```bash
# Add a new MCP server to multiple tools at once
whatsloaded add-mcp fetch --to claude kiro -- npx -y @modelcontextprotocol/server-fetch

# Toggle servers or skills on/off
whatsloaded disable github
whatsloaded enable github

# Share a tool-specific skill across all tools via ~/.agents/skills
whatsloaded adopt my-skill

# Sync a server configuration from one tool to your other tools
whatsloaded sync github --from claude

# Copy an MCP server or skill to another tool
whatsloaded cp github kiro
```

### ⚡ Profiles & Usage Optimization

Save what you actually use and switch profiles when starting a new workflow:

```bash
# Save only what was used in the last 30 days as a lightweight preset
whatsloaded profile save lean --from claude --used

# Apply that profile to another tool
whatsloaded profile apply lean --to codex

# List all saved profiles
whatsloaded profile ls
```

### ↩️ Undo & Safety

Every change is tracked in an atomic backup manifest:

```bash
# Revert the most recent change
whatsloaded undo

# View backup history
whatsloaded backups
```

---

## 🛡️ Safe by Design

- **Transform-Based Planning**: Edits re-evaluate against current file state at apply time, so background agent sessions writing configs won't cause race conditions.
- **Lossless AST Editing**: Edits splice at syntax-tree offsets; comments, indentation, key ordering, and whitespace are fully preserved.
- **Atomic Operations**: Files are written via isolated temporary files and swapped atomically.
- **Automatic Backups**: Before-images and manifests are saved to `~/.whatsloaded/backups/`. Any change can be reverted with `whatsloaded undo`.
- **Zero Secrets Leaked**: Secrets in `env` and headers are masked by default in CLI output and web UI, and never leave your local machine.
- **Loopback-Only Server**: The Web UI binds strictly to `127.0.0.1` with DNS rebinding protection and CSRF guards.

---

## 🗂️ Supported Harnesses & Scopes

| Harness          | MCP Servers                                                                           | Skills, Prompts & Rules                                       |
| :--------------- | :------------------------------------------------------------------------------------ | :------------------------------------------------------------ |
| **Claude Code**  | Managed (`managed-mcp.json`), User (`~/.claude.json`), Project (`.mcp.json`), Plugins | `~/.claude/{skills,agents,commands,rules}`, `.claude/...`     |
| **Codex CLI**    | User (`~/.codex/config.toml`), Project (`.codex/config.toml`)                         | `{~,.}/.codex/skills`, `[plugins]`                            |
| **Kiro**         | User (`~/.kiro/settings/mcp.json`), Project, Agent-embedded                           | `{~,.}/.kiro/{skills,steering,agents}`                        |
| **opencode**     | User (`~/.config/opencode/opencode.json[c]`), Project                                 | `skill/`, `skills/`                                           |
| **Shared Store** | _N/A_                                                                                 | `~/.agents/skills` (Global store), `.agents/skills` (Project) |

---

## 🔌 Extending `whatsloaded`

You can extend `whatsloaded` with custom adapters and providers by dropping standard ES modules into `~/.whatsloaded/`:

- **`~/.whatsloaded/adapters/*.mjs`**: Teach `whatsloaded` how to read and manage configs for a new tool.
- **`~/.whatsloaded/providers/*.mjs`**: Add installer attribution or custom enterprise policies.

Types and helper functions are exported via `whatsloaded/sdk`:

```js
// ~/.whatsloaded/providers/custom-installer.mjs
export default {
  id: 'custom-installer',
  label: 'Custom Installer',
  apiVersion: 1,
  detect: (h) => h.exists(h.join(h.ctx.home, '.custom-installer')),
  claim(item) {
    if (item.description?.includes('[managed]')) {
      return { by: 'Custom Installer', enforces: true };
    }
  },
};
```

Run with `--no-extensions` at any time to bypass external extensions.

---

## 🧑‍💻 Contributing & Development

```bash
# Run test suite
npm test

# Typecheck and linting
npm run typecheck
npm run lint

# Build CLI and Web dashboard
npm run build

# Run everything in CI mode
npm run ci
```

---

## 📄 License

Apache-2.0
