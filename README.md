<div align="center">
  <img src="docs/assets/logo.svg" width="68" height="68" alt="whatsloaded logo" />
  <h1>whatsloaded</h1>
  <p>
    <strong>See what your AI coding agents actually load, what it costs in context tokens, what's broken, and what you haven't used in 30 days.</strong>
  </p>
  <p>
    One local-first dashboard, TUI, and CLI for <strong>Claude Code</strong>, <strong>Codex CLI</strong>, <strong>Kiro</strong>, <strong>opencode</strong>, and the shared <code>~/.agents</code> store — with lossless diffs and instant undo.
  </p>
  <p>
    <a href="https://github.com/bvamc/whatsloaded/actions/workflows/ci.yml"><img src="https://github.com/bvamc/whatsloaded/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-f2a93b.svg" alt="License: Apache-2.0" /></a>
    <img src="https://img.shields.io/badge/node-%3E%3D22.12-93d48c.svg" alt="Node >= 22.12" />
    <img src="https://img.shields.io/badge/127.0.0.1-local--only%20%C2%B7%20zero%20telemetry-74d4d2.svg" alt="Local-First" />
  </p>
  <p>
    <a href="#-quick-start">Quick Start</a> ·
    <a href="#-why-whatsloaded">Why whatsloaded?</a> ·
    <a href="#-web-dashboard">Web Dashboard</a> ·
    <a href="#-cli-tour">CLI Tour</a> ·
    <a href="#-safety-model">Safety Model</a> ·
    <a href="#-extending-whatsloaded">Extending</a>
  </p>
</div>

<br />

<p align="center">
  <img src="docs/assets/hero-dashboard.svg" width="100%" alt="whatsloaded Web UI dashboard preview" />
</p>

---

## 💡 Why `whatsloaded`?

If you use more than one AI coding assistant—or even just one across a few repositories—your configuration quickly fragments across dozens of hidden files:

- **Claude Code** reads `~/.claude.json`, `.mcp.json`, `~/.claude/{skills,agents,commands,rules}`, `.claude/...`, plugins, and `CLAUDE.md`.
- **Codex CLI** reads `~/.codex/config.toml`, `.codex/config.toml`, `{~,.}/.codex/skills`, plugins, and `AGENTS.md`.
- **Kiro** reads `~/.kiro/settings/mcp.json`, `.kiro/settings/mcp.json`, and `{~,.}/.kiro/{skills,steering,agents}` (including MCP servers embedded inside individual agent JSON profiles).
- **opencode** reads `~/.config/opencode/opencode.json[c]`, `opencode.json[c]`, and `skills/`.
- **Shared Store** lives in `~/.agents/skills` and `.agents/skills`.

Within a few weeks of normal work, three problems quietly compound:

1. **Silent Context Window Bloat**: You install 10 MCP servers and 20 skills over two months. Before you even type your first prompt, **20,000+ tokens** of your context window are already consumed by tool schemas and instruction files you aren't using today.
2. **Cross-Tool Configuration Drift**: You have `github` or `playwright` configured in Claude Code, Codex, and Kiro—each launching slightly different arguments, one with a stale flag, and two spawning redundant background processes.
3. **Invisible Breakage**: A subagent references `mcp__jira__search` or `@linear/issue`, or a config points to a binary from a Node version you uninstalled last month—and fails silently mid-task.

**`whatsloaded` gives you a single pane of glass across every tool and every scope (`managed`, `user`, `project`, `local`, `plugin`, `agent`, `store`), backed by an AST-preserving change engine where every edit is previewed as a diff and reversible with a single `undo`.**

---

## ⚡ Quick Start

Requires **Node.js `>= 22.12`**.

```bash
git clone https://github.com/bvamc/whatsloaded.git
cd whatsloaded
npm install && npm run build && npm link
```

Then pick how you want to explore:

```bash
# 1. Open the local Web Dashboard (127.0.0.1:4319)
whatsloaded ui

# 2. Launch the interactive Terminal UI (TUI)
whatsloaded tui

# 3. Run a full health & drift check in your terminal
whatsloaded doctor
```

> [!TIP]
> By default, `whatsloaded` inspects your global user configurations. Pass `--here` (or `-C <dir>`) to include the project configuration of your current working directory:
> ```bash
> whatsloaded ls --here
> whatsloaded ui --here
> ```

---

## 🖥️ Web Dashboard

```bash
whatsloaded ui                  # opens http://127.0.0.1:4319
whatsloaded ui --no-open -p 5000
```

A fast, zero-telemetry local dashboard designed for clarity:

- **Per-Tool Load & Context Budget**: See exactly how many MCP servers, skills, subagents, commands, and instruction files (`CLAUDE.md`, `AGENTS.md`) each tool loads—and the approximate token cost before your first message.
- **What You Actually Use (30-Day Telemetry)**: Scans local session transcripts (tool names only, never prompt content; cached by file mtime) to show which servers and skills you actually used in the last 30 days—with a one-click **"Not used in the last 30 days"** trim panel.
- **Profiles Bar**: Snapshot your current setup—or only what you actually used—under a named profile (`lean`, `frontend`, `review`) and switch any tool to it in two clicks.
- **Discover & Install**: Browse the official MCP Registry, `skills.sh`, and your configured plugin marketplaces, and install directly into the tools you pick.
- **Review Diff + Instant Undo**: Every toggle, sync, copy, or removal opens a review dialog with the exact file diff before a single byte is written, followed by an **Undo** toast.
- **Keyboard-First**: Press <kbd>⌘K</kbd> for the command palette or <kbd>/</kbd> to filter any view.

---

## 💻 CLI Tour

<p align="center">
  <img src="docs/assets/hero-cli.svg" width="100%" alt="whatsloaded CLI output preview" />
</p>

### 1. See the Cross-Tool Matrix (`matrix` & `ls`)

See where every MCP server (or skill, agent, rule, plugin) is defined across your tools at a glance:

```console
$ whatsloaded matrix
NAME                 claude  kiro  codex  opencode
acme-tools           ·       u a   u      ·
local-only           l       ·     ·      ·
notes-mcp            u       u     ·      u
npm:@playwright/mcp  ·       ·     u      ·
proj-mcp             p       ·     ·      ·
search-mcp           pl      ·     ·      ·

u=user p=project l=local a=agent pl=plugin s=store m=managed · green=on dim/-=off yellow=mixed
```

List every item with its harness, scope, enabled state, and launch summary:

```console
$ whatsloaded ls --here
KIND    NAME                 HARNESS   SCOPE                   STATE  DETAIL
mcp     acme-tools           codex     user                    on     acme-tools --include-tools *
mcp     acme-tools           kiro      user                    on     acme-tools --old
mcp     acme-tools           kiro      agent@reviewer          on     [Acme Sync] acme-tools
mcp     notes-mcp            claude    user                    on     notes-mcp
mcp     search-mcp           claude    plugin@kit@acme-market  on     [plugin] search-mcp
skill   architect            agents    store                   on     Designs things
skill   architect            claude    user                    on     → ~/.agents/skills/architect
skill   local-skill          claude    user                    on     Only in Claude
agent   reviewer             kiro      user                    on     [Acme Sync] Code review agent
```

---

### 2. Trace an MCP Server End-to-End (`where`)

`whatsloaded where <server>` separates **Installed** (binary resolution on `PATH`), **Configured** (grouped by role: _yours_, _from plugins_, _agent profiles_, or _policy_), **Variants** (how your configurations differ), and **Used by** (which agents reference its tools):

```console
$ whatsloaded where acme-tools
acme-tools
  1 install · 3 configurations (2 yours · 1 agent profile) · used by 1 agent

Installed
  ● ~/bin/acme-tools → ~/.local/bin/acme-tools  (3 configurations)

Configured
  yours (2)
    codex user                                                 on   ~/.codex/config.toml
    kiro user                                                  on   ~/.kiro/settings/mcp.json
  agent profiles (1)
    kiro agent@reviewer                                        on   by Acme Sync  ~/.kiro/agents/reviewer.json
  agent profiles are launch settings an agent carries for itself; they only apply while that agent runs

Variants (your configurations only)
  A ×1  acme-tools --include-tools *
  B ×1  acme-tools --old

Used by (1 agents)
  kiro (1)
    reviewer                                         own entry  search
```

---

### 3. Diagnose Drift, Missing Runtimes & Broken References (`doctor`)

```console
$ whatsloaded doctor --here
error runtime-not-found      proj-mcp: `proj-mcp` is not installed or not on PATH (1 configuration launches it)
warn  mcp-drift              acme-tools: your 2 configurations launch it 2 different ways (codex user vs kiro user). See: whatsloaded where acme-tools
warn  reference-unconfigured 1 claude agent uses search-mcp tools, but they name it mcp__search-mcp__…, while Claude registers it only through plugins as mcp__plugin_kit_search-mcp__…: helper
warn  reference-unconfigured 1 kiro agent uses notes-mcp tools, but they have no entry of their own and do not declare that they load the shared kiro configuration: reviewer
info  unshared-skill         local-skill exists as 1 standalone copy (claude:user/skill/local-skill); share one copy with: whatsloaded adopt claude:user/skill/local-skill
```

`doctor` checks for:

- **`runtime-not-found`**: Server commands missing from `PATH` (with hints when a binary is pinned to an older Node/Homebrew version that was upgraded away).
- **`mcp-drift`**: Your configurations of the same server launch it with different commands, arguments, URLs, or environment variables.
- **`reference-unconfigured`**: Kiro agents (`@server/tool`) or Claude subagents (`mcp__server__tool`) referencing servers that are not configured or visible in their scope.
- **`duplicate-instances`**: Redundant server definitions that spawn duplicate processes.
- **`shadowed`** & **`unshared-skill`**: Narrower scopes shadowing broader ones, or standalone skills that can be deduplicated into `~/.agents/skills`.
- **`broken-link`** & **`parse-error`**: Dangling symlinks and malformed JSON/TOML/YAML frontmatter.

---

### 4. Measure Real MCP Context Token Cost (`measure`)

MCP servers inject every tool's name, description, and JSON Schema into the model's context on startup. Measure the exact token footprint of any server:

```bash
whatsloaded measure github
```

- Displays the exact command first and asks for confirmation before starting the server once.
- Reads the full paginated `tools/list` response over stdio or HTTP/SSE (bounded by a strict 15s timeout).
- Caches only tool names and byte sizes in `~/.whatsloaded/cache/tools/`—never tool descriptions or secret values.

---

### 5. Save & Switch Profiles (`profile`)

```bash
# Save everything Claude Code currently loads as a named profile
whatsloaded profile save full-work --from claude

# Or save ONLY what you actually used in the last 30 days
whatsloaded profile save lean --from claude --used

# Switch any tool to that profile (previews the exact diff first)
whatsloaded profile apply lean --to claude

# List or remove saved profiles
whatsloaded profile ls
whatsloaded profile rm lean
```

---

### 6. Safe Cross-Tool Mutations & Instant Undo

Every mutating command prints the plan with a unified diff and asks before writing (`-n/--dry-run` stops at the preview, `-y` skips confirmation):

| Command                                                           | What it does                                                                                                                                                                                                                                             |
| :---------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `whatsloaded enable <query...>` / `disable <query...>`            | Uses the harness's native toggle where one exists (Kiro `disabled`, Codex `enabled`, opencode `enabled`, Claude `disabledMcpjsonServers`/`enabledPlugins`); otherwise safely **parks** the item in `~/.whatsloaded/parked/` and restores it on `enable`. |
| `whatsloaded sync <name> --from <ref>`                            | Rewrites your other configurations of an MCP server to match one source while preserving each tool's enabled state and harness-specific fields (e.g. Kiro `autoApprove`, Codex timeouts).                                                                |
| `whatsloaded cp <query> <target...>`                              | Copies an MCP server to other harnesses/scopes (translating JSON ↔ TOML formats automatically); skills are **symlinked**.                                                                                                                                |
| `whatsloaded mv <query> <target>`                                 | Copies to target and removes from source in one atomic change set.                                                                                                                                                                                       |
| `whatsloaded adopt <skill>`                                       | Moves a harness-local skill into `~/.agents/skills` and leaves a relative symlink behind so every tool shares one copy.                                                                                                                                  |
| `whatsloaded add-mcp <name> --to <targets...> -- <cmd> [args...]` | Adds a new MCP server to multiple tools at once (supports `--url`, `-e KEY=VAL`, `--header K=V`).                                                                                                                                                        |
| `whatsloaded rm <query...>`                                       | Removes items (files are moved into `~/.whatsloaded/backups/`, never permanently deleted).                                                                                                                                                               |
| `whatsloaded backups` / `whatsloaded undo [id]`                   | Lists applied change sets and reverts the most recent change set (or a specific backup ID) byte-for-byte.                                                                                                                                                |

#### Query & Target Shorthand

- **Queries** can be a full ref (`kiro:agent@reviewer/mcp/github`) or a short pattern (`github`, `git*`, `kiro/github`, `mcp/github`) narrowed with `-H <harness>`, `-s <scope>`, `-k <kind>`.
- **Targets** are `harness[:scope]`, such as `kiro`, `codex:user`, `claude:project`, or `claude:local`.

---

## 🛡️ Safety Model

- **Plans are transforms, not snapshots.** Each edit is re-evaluated against the live file on disk at apply time, so active coding agent sessions rewriting files like `~/.claude.json` between plan and apply won't get clobbered.
- **Minimal, lossless diffs.** JSON edits splice at syntax-tree offsets in the file's existing indentation style, preserving comments, key order, and spacing. TOML edits patch only the affected lines, then re-parse and verify AST equivalence before writing.
- **Atomic backups & reversible undo.** Every apply writes `~/.whatsloaded/backups/<id>/manifest.json` with full before-images. Removed files and directories are moved into the backup folder—never unlinked. `whatsloaded undo` replays the manifest in reverse.
- **Ownership guards.** Items owned by plugins, enterprise policy (`managed-mcp.json`), or an enforcing provider require `--force` to modify.
- **Secrets stay local.** `env` and HTTP header values are masked in `ls`, `show`, diffs, and Web UI responses unless you explicitly pass `--reveal` in the CLI.
- **Hardened loopback server.** `whatsloaded ui` binds `127.0.0.1` only, rejects foreign `Host` headers with `421` (DNS rebinding guard), requires same-origin `Origin` + JSON bodies on `POST` (CSRF guard), and executes plans strictly by server-generated ID. See [SECURITY.md](SECURITY.md).

---

## 🗂️ Supported Harnesses & Scopes

| Harness        | MCP Servers                                                                                                                                   | Skills, Agents, Commands & Rules                                                                              |
| :------------- | :-------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------ |
| **`claude`**   | `managed` (`managed-mcp.json`) · `user` (`~/.claude.json`) · `local` (`~/.claude.json projects[<path>]`) · `project` (`.mcp.json`) · `plugin` | `~/.claude/{skills,agents,commands,rules}`, `.claude/...`, plugin directories, `CLAUDE.md`, `CLAUDE.local.md` |
| **`kiro`**     | `user` (`~/.kiro/settings/mcp.json`) · `project` (`.kiro/settings/mcp.json`) · `agent` (embedded in `agents/*.json`)                          | `{~,.}/.kiro/{skills,steering,agents}`                                                                        |
| **`codex`**    | `user` (`~/.codex/config.toml`) · `project` (`.codex/config.toml`)                                                                            | `{~,.}/.codex/skills`, `[plugins]`, `AGENTS.md`                                                               |
| **`opencode`** | `user` (`~/.config/opencode/opencode.json[c]`) · `project` (`opencode.json[c]`)                                                               | `skill/` or `skills/` directories, `AGENTS.md`                                                                |
| **`agents`**   | _N/A_                                                                                                                                         | `~/.agents/skills` (`store`) · `.agents/skills` (`project`)                                                   |

---

## 🔌 Extending `whatsloaded`

Extensions are standard ES modules in `~/.whatsloaded/` that default-export an adapter or provider object. Because they run with your user privileges, `whatsloaded` refuses any file or directory writable by other users, lists loaded extensions in `whatsloaded adapters`, and skips them all with `--no-extensions` (or `WHATSLOADED_NO_EXTENSIONS=1`). TypeScript types and helpers are exported from `whatsloaded/sdk`.

### Providers: Attribution & Policy (`~/.whatsloaded/providers/*.mjs`)

A provider teaches `whatsloaded` about an organization's internal installer or sync tool. It can claim items (`installed by`), mark them enforced (requiring `--force` to mutate), group them into packages, and add custom doctor findings:

```js
// ~/.whatsloaded/providers/acme-sync.mjs
import { defineProvider } from 'whatsloaded/sdk';

export default defineProvider({
  id: 'acme-sync',
  label: 'Acme Sync',
  apiVersion: 1,
  detect: (h) => h.exists(h.join(h.ctx.home, '.acme-sync')),
  claim(item) {
    if (item.description?.includes('[acme-sync]')) {
      return {
        by: 'Acme Sync',
        enforces: true,
        description: item.description.replace('[acme-sync]', '').trim(),
      };
    }
    if (item.kind === 'plugin' && item.origin === 'acme-market') {
      return { by: 'Acme Sync', note: 'Acme Sync may re-enable it on its next sync' };
    }
  },
});
```

### Adapters: Adding a New Harness (`~/.whatsloaded/adapters/*.mjs`)

An adapter teaches `whatsloaded` a new coding tool. Only `id`, `label`, `detect`, and `discover` are required; optional mutation methods (`toggle`, `remove`, `writeMcp`, `writable`) return `Change[]` plans while the core engine handles diff preview, backup, and undo:

```js
// ~/.whatsloaded/adapters/my-editor.mjs
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineAdapter } from 'whatsloaded/sdk';

const file = (ctx) => join(ctx.home, '.my-editor', 'mcp.json');

export default defineAdapter({
  id: 'my-editor',
  label: 'My Editor',
  detect: (ctx) => existsSync(file(ctx)),
  discover(ctx) {
    const servers = JSON.parse(readFileSync(file(ctx), 'utf8')).mcpServers ?? {};
    return {
      problems: [],
      items: Object.entries(servers).map(([name, s]) => ({
        kind: 'mcp',
        name,
        enabled: !s.disabled,
        scope: { harness: 'my-editor', level: 'user' },
        location: { file: file(ctx), path: ['mcpServers', name] },
        mcp: s.url ? { transport: 'http', url: s.url } : { transport: 'stdio', command: s.command, args: s.args, env: s.env },
      })),
    };
  },
});
```

---

## 🧑‍💻 Development

```bash
npm run ci          # Biome lint + TypeScript typecheck (src, tests, web) + Vitest + build
npm test            # Run Vitest suite against isolated fake $HOME fixtures
npm run dev -- ls   # Run CLI directly from TypeScript source
npm run dev:api     # Start API server on 127.0.0.1:4319
npm run dev:web     # Start Vite dev server on 127.0.0.1:5173 with hot reload
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for architecture details and engineering principles.

## 📄 License

[Apache-2.0](LICENSE)
