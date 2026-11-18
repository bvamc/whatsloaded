# whatsloaded

One view of the MCP servers, skills, agents, commands, rules and plugins configured across your AI coding tools (Claude Code, Kiro, Codex, opencode, and the shared `~/.agents` skill store), at every scope, with safe cross-tool management.

```
npm install && npm run build && npm link    # puts `whatsloaded` on PATH
```

## Look

| command                                                                               | what it does                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `whatsloaded ls [kind]`                                                               | everything, with harness / scope / state (`-a` adds plugin-provided items, `--json`)                                                                                                         |
| `whatsloaded matrix [kind]`                                                           | name × harness grid: where each MCP server (or skill...) is defined                                                                                                                          |
| `whatsloaded measure <server>`                                                        | start a server once (after showing the command) to measure what its tool definitions cost in context                                                                                         |
| `whatsloaded profile save <name> --from <tool> [--used]` / `apply <name> --to <tool>` | save a setup (or only what you used) and switch a tool to it later                                                                                                                           |
| `whatsloaded where <server>`                                                          | where an MCP server is installed, every configuration of it (yours / from plugins / agent profiles), and which agents use it                                                                 |
| `whatsloaded show <query>`                                                            | full details, env/headers redacted unless `--reveal`                                                                                                                                         |
| `whatsloaded doctor`                                                                  | drift between your configurations, commands that are not installed, agents using servers they cannot see, duplicate server processes, shadowing, unshared skills, broken links, parse errors |
| `whatsloaded tui`                                                                     | interactive browser: toggle, inspect, doctor, undo                                                                                                                                           |

## Web UI

```
whatsloaded ui            # opens http://127.0.0.1:4319
whatsloaded ui --no-open -p 5000
```

A local dashboard with an overview ("field of view"), per-kind inventories grouped by name, an MCP spectrum matrix, an inspector with variant diffs, Doctor and Backups. Press ⌘K for the command palette and `/` to filter. Every change opens a review dialog with the exact diff before anything is written, and the toast after applying has Undo.

**Exposure.** The server binds `127.0.0.1` only; there is deliberately no host option. To reach it from another machine, use an SSH local port-forward (`ssh -L 4319:127.0.0.1:4319 host`). It has no login: anything running as your user on this machine can reach it, the same as it can edit these files directly. Browser attacks on localhost are blocked: requests with a foreign `Host` (DNS rebinding) get 421, and writes need a same-origin `Origin` and a JSON body (CSRF). Plans are built and kept server-side, so the page can only apply a plan by id, never send file edits. Env/header values are redacted before they leave the process.

Develop the UI with hot reload: `npm run dev:api` and `npm run dev:web` (Vite on 127.0.0.1:5173, proxying `/api`).

## Change

| command                                           | what it does                                                                                                                                                                                                                                         |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enable` / `disable <query...>`                   | native flag where the harness has one (Kiro `disabled`, Codex `enabled`, opencode `enabled`, Claude `disabledMcpjsonServers`/`enabledPlugins`); otherwise the item is **parked** in `~/.whatsloaded/parked/` and restored on enable                  |
| `rm <query...>`                                   | remove (files are moved into the backup, never deleted)                                                                                                                                                                                              |
| `cp <query> <target...>`                          | copy an MCP server to other harnesses, translating formats; skills are **symlinked**                                                                                                                                                                 |
| `mv <query> <target>`                             | copy + remove                                                                                                                                                                                                                                        |
| `sync <name> --from <ref>`                        | rewrite your other configurations of a server to match one source, keeping each one's enabled state and harness-only fields (Kiro `autoApprove`, Codex timeouts, ...). Plugin entries are never touched; agent profiles only with `--include-agents` |
| `adopt <skill>`                                   | move a harness-local skill into `~/.agents/skills` and leave a symlink, so every harness can share one copy                                                                                                                                          |
| `add-mcp <name> --to <target...> -- <cmd> [args]` | add a new server to several harnesses at once (`--url`, `-e K=V`, `--header K=V`)                                                                                                                                                                    |
| `backups` / `undo [id]`                           | every applied change set is reversible                                                                                                                                                                                                               |

Every mutating command prints the plan with a diff and asks before writing. `-n/--dry-run` stops at the plan, `-y` skips the prompt, and `--force` is needed to touch items owned by plugins, enterprise policy or another tool (see Providers).

### Queries and targets

A **ref** names one item: `<harness>:<scope>[@owner]/<kind>/<name>`, e.g. `kiro:agent@reviewer/mcp/github`. Queries can be shorter (`github`, `git*`, `kiro/github`, `mcp/github`) and narrowed with `-H harness`, `-s scope`, `-k kind`. If a query matches more than one item, mutating commands refuse unless you pass `--all-matches`.

A **target** is `harness[:scope]`: `kiro`, `codex:user`, `claude:project`, `claude:local`.

Project and local scopes use the project detected from the current directory (nearest `.git`, `.mcp.json`, `.claude`, `.kiro`, ...). Override with `-C <dir>`, or use `-g` for user scope only.

### Scopes per harness

| harness  | MCP servers                                                                                                                 | skills / content                                                       |
| -------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| claude   | managed `managed-mcp.json` · user `~/.claude.json` · local `~/.claude.json projects[<path>]` · project `.mcp.json` · plugin | `~/.claude/{skills,agents,commands,rules}`, `.claude/...`, plugin dirs |
| kiro     | user `~/.kiro/settings/mcp.json` · project `.kiro/settings/mcp.json` · agent (embedded in `agents/*.json`)                  | `{~,.}/.kiro/{skills,steering,agents}`                                 |
| codex    | user `~/.codex/config.toml` · project `.codex/config.toml`                                                                  | `{~,.}/.codex/skills`; `[plugins]`                                     |
| opencode | `~/.config/opencode/opencode.json[c]` · project `opencode.json[c]`                                                          | `skill/` or `skills/` dirs                                             |
| agents   | n/a                                                                                                                         | `~/.agents/skills` (store) · `.agents/skills` (project)                |

## Safety model

- **Plans are transforms, not snapshots.** Each edit is re-run against the file as it is at apply time, because running agent sessions rewrite files like `~/.claude.json` between plan and apply.
- **Minimal diffs.** JSON edits splice at syntax-tree offsets in the file's own style, so comments, key order and `"key" : value` spacing survive. TOML edits change only the affected lines, then the result is re-parsed and compared with the intended change; anything that doesn't match is refused.
- **Backups.** Every apply writes `~/.whatsloaded/backups/<id>/manifest.json` and keeps the before-images. Removed paths are moved there too. `undo` replays a manifest in reverse.
- **Ownership.** Plugin contents, enterprise policy and anything a provider claims as enforced need `--force`.
- **Secrets.** `env` and header values are masked in `ls`, `show` and diffs unless you pass `--reveal`.

## Extending whatsloaded

Extensions are ES modules in `~/.whatsloaded/` that default-export a plain object. They run with your privileges, so whatsloaded refuses any file or directory that other users can write, lists what it loaded in `whatsloaded adapters`, and skips them all with `--no-extensions` (or `WHATSLOADED_NO_EXTENSIONS=1`). Types live in `whatsloaded/sdk`.

### Providers: who installed it

A provider knows something no harness records, typically an organisation's own installer. It can claim items ("installed by Acme Sync"), mark them as enforced (changing them then needs `--force`), add plan warnings and doctor findings. Providers are read-only: they get helper functions and return data.

```js
// ~/.whatsloaded/providers/acme-sync.mjs
export default {
  id: 'acme-sync',
  label: 'Acme Sync',
  apiVersion: 1,
  detect: (h) => h.exists(h.join(h.ctx.home, '.acme-sync')),
  claim(item) {
    if (item.description?.includes('[acme-sync]')) {
      return { by: 'Acme Sync', enforces: true, description: item.description.replace('[acme-sync]', '').trim() };
    }
    if (item.kind === 'plugin' && item.origin === 'acme-market') {
      return { by: 'Acme Sync', note: 'Acme Sync may re-enable it on its next sync' };
    }
  },
};
```

Servers embedded in a claimed agent definition inherit the agent's owner.

### Adapters: a new harness

An adapter teaches whatsloaded a harness. Only `id`, `label`, `detect` and `discover` are required; anything else you leave out (enable/disable, remove, copy targets) is reported as unsupported. Adapters only _plan_: mutating methods return `Change[]`, and the engine handles preview, confirmation, backup and undo.

```js
// ~/.whatsloaded/adapters/my-editor.mjs
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const file = (ctx) => join(ctx.home, '.my-editor', 'mcp.json');

export default {
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
};
```

### Configuration

`~/.whatsloaded/config.json` (all optional):

```json
{ "compare": { "ignoreEnvKeys": ["*_KIRO"] } }
```

`compare.ignoreEnvKeys` lists env vars that are harness-specific by design, so differences in them never count as drift.

## Known gaps

- Copying agents, rules and commands between harnesses isn't supported, because their formats differ semantically. Only MCP servers and skills copy.
- Codex servers written as inline tables (`mcp_servers.x = { ... }`) are reported but can't be edited. Overwriting a Codex server moves its table to the end of the file and drops comments inside that table.
- Claude's `local` scope is keyed by the exact project path Claude was launched from.
- Kiro powers and Cursor/Gemini are not covered yet (write an adapter).
- Running agent sessions pick up changes on restart.

## Develop

```
npm run ci          # lint (Biome) + typecheck (src, tests, web) + tests + build
npm test            # vitest, against throwaway fake $HOME trees
npm run fix         # apply formatting and safe lint fixes
npm run dev -- ls   # run from source
```

CI also runs `scripts/check-terms.mjs`, which fails on terms listed in the `WHATSLOADED_TERMS` repository secret. The list itself is never committed.
