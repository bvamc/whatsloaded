# Implementation Plan: M0 (Validate) and M1 (Core + Claude Code)

> Companion to [PLAN.md](PLAN.md). Scope: about 4 weeks for one engineer. Each task below maps to a GitHub issue (`M0-x`, `M1-x`).
> Target dates: **M0 by 2026-11-13**, **M1 by 2026-12-04**.

---

## 1. Decisions locked for M0/M1

| Topic | Decision | Why |
|---|---|---|
| Runtime | Node **≥ 22** (develop on 26). ESM only. | `node:sqlite`, `fs.glob`, stable `--experimental-strip-types` are not required, but Node 22 LTS is the floor |
| Workspaces | **npm workspaces** (not pnpm) | Zero extra prerequisites. pnpm/corepack aren't installed on the dev machine, and the benefit is small at this size |
| Language/build | TypeScript `strict`, `module: NodeNext`, **tsup** for the CLI bundle, `tsc -b` for typecheck | Simple and fast |
| Test | **vitest**, golden-file fixtures | Fast, ESM-native |
| Lint/format | **Biome** (single tool) | Replaces eslint + prettier. Less config |
| CLI framework | `commander` + `picocolors` | Small and conventional |
| Parsers | `jsonc-parser`, `yaml`, `smol-toml`, `picomatch`, `ignore` | As in PLAN §7.1 |
| License | Apache-2.0 (already in repo) | |
| UI | **Not in M0/M1.** Decide CLI-only v0.1 at the end of M0 (§3, M0-5) | |

## 2. Verified Claude Code facts (supersedes PLAN §7.4 row for Claude Code)

Verified against code.claude.com docs (2026-11-05) for **Claude Code 2.1.x**. `doc` = documented. `verify` = must confirm empirically in M0-3 using canaries.

### 2.1 Memory / instructions (strategy: `concat`, plus `conditional`)

| Source | Path | Notes | Conf. |
|---|---|---|---|
| Managed policy | macOS `/Library/Application Support/ClaudeCode/CLAUDE.md`, Linux `/etc/claude-code/CLAUDE.md` | Highest, can't be excluded | doc |
| User | `~/.claude/CLAUDE.md` | | doc |
| Project + ancestors | `CLAUDE.md` **or** `.claude/CLAUDE.md` in cwd and **every ancestor** (stop point to verify: `/`, `$HOME`, or git root) | Loaded at start | doc / verify stop point |
| Local | `CLAUDE.local.md` next to project `CLAUDE.md` | Supported (not deprecated). Usually gitignored | doc |
| Nested (descendant) | `<subdir>/CLAUDE.md` below cwd | **Lazy**: loaded when Claude reads files in that subtree → `conditional: lazy-subdir` | doc |
| Rules | `.claude/rules/**/*.md` (project) and `~/.claude/rules/**/*.md` (user) | `paths:` frontmatter (glob string or list) → conditional. No `paths` → always | doc / verify user-level |
| Auto memory | `~/.claude/projects/<encoded-cwd>/memory/MEMORY.md` (+ topic files) | Loaded at start (index file, possibly truncated by line count → verify) | doc / verify |
| Imports | `@path` inside any memory file. Relative to the **containing file**, absolute and `~/` allowed. **Max 4 hops.** Ignored inside code spans/blocks. Escaped spaces `\ `. Quoted paths ignored | | doc |

### 2.2 Skills and legacy commands (strategy: `override` by name, then `namespaced`)

Precedence on name collision, high → low: **managed > personal (`~/.claude/skills`) > project (`.claude/skills`)**. Plugin skills are namespaced `plugin:skill` and never collide.
- **Personal beats project.** This is the opposite of subagents, and a headline `explain` insight.
- Nested `<subdir>/.claude/skills/` are discovered when working in that subtree → `conditional` (verify).
- Legacy commands `~/.claude/commands/*.md`, `.claude/commands/**/*.md` register `/name`. **If a skill has the same name, the skill wins.**
- Frontmatter (all optional): `name` (lowercase, digits, hyphens, ≤ 64), `description`, `license`, `compatibility` (≤ 500), `allowed-tools`, `paths`, `model`, `effort`, `context: fork`, `agent`, `background`, `hooks`, `shell`, `metadata`, `disable-model-invocation`, `user-invocable` (verify last two).
- Skills with `paths:` → conditional. Skills with `disable-model-invocation: true` → "user-invoked only" badge.

### 2.3 Subagents (strategy: `override` by `name`)

High → low: **managed > `--agents` CLI flag > project `.claude/agents/` > user `~/.claude/agents/` > plugin `agents/`**.

### 2.4 MCP servers (strategy: `override` by name, whole definition, no field merge)

High → low: **managed (`managed-mcp.json` next to managed settings) > local (`~/.claude.json` → `projects["<abs path>"].mcpServers`) > project (`.mcp.json` at project root) > user (`~/.claude.json` → top-level `mcpServers`) > plugins & claude.ai connectors**.
- `.mcp.json` servers need approval. State lives in settings (`enabledMcpjsonServers`, `disabledMcpjsonServers`, `enableAllProjectMcpServers`) and/or `~/.claude.json` per-project entries (verify which file is authoritative in 2.1.x). Compute `approval: approved | denied | pending`.
- Managed `allowedMcpServers` / `deniedMcpServers` filter the result (P1).

### 2.5 Settings and hooks

High → low: **managed (`managed-settings.json` + `managed-settings.d/*.json`; macOS also MDM plist `com.anthropic.claudecode`) > CLI flags > `.claude/settings.local.json` > `.claude/settings.json` > `~/.claude/settings.json`**.
- Scalars: `override`. Arrays (permissions allow/deny/ask, etc.): `merge` (accumulate). Hooks: **additive across all layers** (show as "all run"). `allowManagedHooksOnly` (managed) suppresses non-managed hooks.
- Managed paths: macOS `/Library/Application Support/ClaudeCode/`, Linux/WSL `/etc/claude-code/`, Windows `C:\Program Files\ClaudeCode\`.
- `CLAUDE_CONFIG_DIR` relocates `~/.claude` (verify whether it also relocates `~/.claude.json`).

### 2.6 Facts to verify empirically in M0-3

1. Does the ancestor walk for `CLAUDE.md` stop at `$HOME` or the git root, or does it continue to `/`?
2. Are user-level `~/.claude/rules/` supported?
3. MEMORY.md truncation rule.
4. Which file is authoritative for `.mcp.json` approvals.
5. Are nested `.claude/skills` in subdirectories conditional?
6. `CLAUDE_CONFIG_DIR` effect on `~/.claude.json`.
7. Does a symlinked skill dir load? Does a symlinked `CLAUDE.md` load? (The dev machine has 14 symlinked skills.)

**Canary method:** in a temp git repo, put a unique token in each candidate file (`CANARY-<file-id>`). Run `claude -p "List every CANARY- token present in your instructions or memory, verbatim, one per line. Do not read any files."` and compare. Use `--max-turns 1`. Record the results in `docs/providers/claude-code.md` with the date and version. For skills/subagents/MCP, use `claude -p "/<skill>"`-style checks or `claude mcp list` / `claude mcp get`.

## 3. M0: Validate (week 1)

| ID | Task | Output | Done when |
|---|---|---|---|
| **M0-1** | Throwaway prototype `scripts/proto/explain.mjs` (single file, no deps beyond Node). Claude Code only: memory chain (ancestors, local, imports up to 4), rules, skills (personal vs project, shadowing), subagents, MCP (user/project/local + approval), hooks count. Tree output. | `node scripts/proto/explain.mjs [dir]` | Runs on the dev machine in < 1 s and shows at least one non-obvious fact (a shadow, an ancestor file, an unapproved server, or a symlinked skill) |
| **M0-2** | Hands-on teardown of **Loadout** and **gaal** using the same fixture (`fixtures/teardown/`) | `docs/research/teardown.md`: screenshots and a table of "what each shows for shadowing, provenance, conditional rules, approvals" | Clear yes/no on: "Does either tool already answer *why is X loaded in dir D*?" |
| **M0-3** | Empirical verification of §2.6 with canaries against Claude Code 2.1.239 | `docs/providers/claude-code.md` with a facts table: fact → doc URL → verified (date, version) | All 7 items resolved or explicitly marked `inferred` |
| **M0-4** | Validation post: README demo section, screenshot/asciicast of the prototype, posts in 3 communities | Links collected in the issue | Posted. Metrics tracked for 5 days |
| **M0-5** | Go/no-go decision record | `docs/decisions/0001-m0-go-no-go.md` | Decides: go / pivot-to-library, CLI-only v0.1 yes/no, Codex as second provider confirmed |
| **M0-6** | Reserve names: npm placeholder `whatsloaded@0.0.0` (README only), GitHub topics | npm package exists | `npm view whatsloaded` returns our package |

**Go criteria (from PLAN §2.3):** ≥ 30 "found something I didn't know" responses, or ≥ 5 requests for other agents, **and** M0-2 shows that neither competitor resolves precedence/provenance.

## 4. M1: Core + Claude Code provider (weeks 2–4)

### 4.1 Repository layout at end of M1

```
whatsloaded/
  package.json                 # npm workspaces, scripts: build, test, lint, typecheck, bench
  biome.json  tsconfig.base.json  vitest.workspace.ts
  .github/workflows/ci.yml     # ubuntu + macos × node 22/24/26: lint, typecheck, test, build
  packages/
    core/
      src/
        types.ts               # Artifact, SourceRef, Layer, ResolvedContext, Finding, Confidence …
        env.ts                 # Env: home, platform, envVars, cwd, fs (ReadonlyFs), now()
        fs/readonly-fs.ts      # ReadonlyFs interface + NodeReadonlyFs (no write methods exist)
        fs/cache.ts            # (path, mtimeMs, size) → content/hash cache
        discovery/walk.ts      # walkAncestors, walkDescendants (bounded, ignore-aware)
        discovery/symlink.ts   # realpath + loop detection via dev:ino
        discovery/hash.ts      # sha256 file + directory-tree hash
        parse/jsonc.ts         # parse with error locations (line/col)
        parse/frontmatter.ts   # split + YAML parse, with ranges
        parse/md-imports.ts    # @import extraction (code-span/block aware, escapes, quotes)
        parse/toml.ts          # read-only
        resolve/strategies.ts  # override | concat | merge | namespaced | conditional
        resolve/resolver.ts    # layers + artifacts + rule table → ResolvedContext
        redact.ts              # secret key/value detection + masking
        provider.ts            # Provider interface, registry
        index.ts
      test/
    providers/
      src/claude-code/
        index.ts  detect.ts  paths.ts  memory.ts  skills.ts  subagents.ts  mcp.ts  settings.ts
        rules.ts               # declarative precedence table with ruleId + docUrl + confidence
      test/claude-code/*.test.ts
    cli/
      src/index.ts  commands/scan.ts  commands/explain.ts
      src/render/tree.ts  render/json.ts
  fixtures/
    claude/<case>/{home/, root/, case.json, expected.explain.json}
  docs/  PLAN.md  IMPLEMENTATION-M0-M1.md  providers/claude-code.md  NON-GOALS.md
  scripts/proto/explain.mjs   scripts/bench.mjs
```

### 4.2 Key interfaces (M1 subset of PLAN §8)

```ts
// env.ts: everything a provider may touch. Tests inject fixture paths.
export interface Env {
  home: string;                 // fixture: fixtures/claude/<case>/home
  platform: NodeJS.Platform;    // tests override to exercise managed paths
  vars: Readonly<Record<string, string | undefined>>;
  managedRoot?: string;         // override for /Library/Application Support/ClaudeCode etc.
  fs: ReadonlyFs;
  which(cmd: string): Promise<string | null>;
  exec?(cmd: string, args: string[], timeoutMs: number): Promise<{ stdout: string; code: number }>; // version detection only
}

export interface ReadonlyFs {
  stat(p: string): Promise<Stat | null>;
  lstat(p: string): Promise<Stat | null>;
  readFile(p: string): Promise<Buffer>;
  readdir(p: string): Promise<Dirent[]>;
  realpath(p: string): Promise<string>;
}

// rules.ts: precedence as data
export interface PrecedenceRule {
  id: string;                    // 'claude.skills.personal-over-project'
  kind: ArtifactKind;
  strategy: 'override' | 'concat' | 'merge' | 'namespaced' | 'conditional';
  order: ScopeKind[];            // high → low
  confidence: Confidence;
  docUrl: string;
  note?: string;
}
```

### 4.3 Fixture format

```
fixtures/claude/shadowed-subagent/
  case.json        { "cwd": "root/work/api", "platform": "darwin", "vars": {}, "agentVersion": "2.1.239" }
  home/.claude/agents/reviewer.md
  root/work/api/.git/            (empty marker dir)
  root/work/api/.claude/agents/reviewer.md
  expected.explain.json          (golden; regenerate with `npm test -- -u`)
```

Paths in golden output are rewritten to `<HOME>/…` and `<ROOT>/…` so they're portable. Hashes and mtimes are stripped from goldens.

**M1 fixture cases (minimum):** `empty-home`, `memory-ancestors-imports` (AC1), `memory-import-depth-exceeded`, `memory-import-in-codeblock-ignored`, `rules-paths-conditional`, `local-md`, `skills-personal-over-project`, `skill-vs-command-same-name`, `plugin-skill-namespaced`, `shadowed-subagent` (AC2), `mcp-three-scopes` (AC3), `mcp-pending-approval`, `settings-layers-hooks-additive`, `symlinked-skill`, `symlink-loop`, `broken-json`, `managed-policy-darwin`, `provider-missing` (AC6).

### 4.4 CLI contract (M1)

```
whatsloaded scan [--json]
whatsloaded explain [dir] [--agent claude] [--kind instructions|skills|subagents|commands|mcp|hooks|settings] [--json] [--show-secrets]
```

Example `explain` output (human):

```
Claude Code 2.1.239 · ~/work/api · rules claude-code@2026-11

INSTRUCTIONS  (4 files · 9.8 KB · ≈2.5k tokens)
  1 managed   —
  2 user      ~/.claude/CLAUDE.md                      always       documented
    └ @~/notes/style.md                                import d1    documented
  3 ancestor  ~/work/CLAUDE.md                         ancestor     documented
  4 project   ~/work/api/CLAUDE.md                     always       documented
  ~ project   ~/work/api/packages/web/CLAUDE.md        lazy (when files under packages/web are read)
  ~ project   .claude/rules/testing.md                 paths: **/*.test.ts

SKILLS  (12 effective · 1 shadowed)
  pdf-tools        user     ~/.claude/skills/pdf-tools → ~/.agents/skills/pdf-tools (symlink)
  deploy           user     ~/.claude/skills/deploy
  ✗ deploy         project  .claude/skills/deploy     shadowed by user (claude.skills.personal-over-project)

MCP SERVERS
  github           local    ~/.claude.json#projects[~/work/api]      active
  ✗ github         project  .mcp.json                               shadowed by local
  postgres         project  .mcp.json                               pending approval
```

Exit codes: `0` ok, `2` internal error. (`1` is reserved for `doctor` in M2.)

### 4.5 M1 tasks

| ID | Task | Depends | Est. | Done when |
|---|---|---|---|---|
| **M1-1** | Scaffold: npm workspaces, TS strict, tsup, vitest, Biome, CI matrix (ubuntu/macos × node 22/24/26), `NON-GOALS.md`, `CONTRIBUTING.md` | none | 1 d | CI green on an empty test. `npx whatsloaded --version` works from a local pack |
| **M1-2** | Core types + `Env` + `ReadonlyFs` (no write methods by construction) + provider registry | M1-1 | 1 d | Types compile. Registry lists providers |
| **M1-3** | Discovery utils: ancestors/descendants walk (bounded, `.gitignore`/default ignores), symlink resolution and loop detection, hashing, stat cache | M1-2 | 1.5 d | Unit tests incl. loop, a 10k-file tree under 200 ms, max-dir limit produces a `LIMIT_EXCEEDED` signal |
| **M1-4** | Parsers: JSONC with line/col errors, frontmatter with ranges, `@import` extractor (code span/block aware, escapes, quoted ignored, depth tracking), TOML read | M1-2 | 1.5 d | Table-driven tests for each edge case in §2.1 |
| **M1-5** | Resolver framework: strategies, layer ordering, shadow edges, conditional items, ruleId/confidence propagation | M1-2 | 2 d | Pure unit tests with synthetic artifacts for every strategy |
| **M1-6** | Claude: detect (binary, version via `claude --version` with a 2 s timeout, `CLAUDE_CONFIG_DIR`), paths per platform, declarative `rules.ts` with doc URLs | M1-3 | 0.5 d | `scan` shows Claude Code version on the dev machine |
| **M1-7** | Claude memory: managed/user/ancestors/local/nested-lazy/rules/auto-memory + import expansion (max 4) | M1-4, M1-5, M1-6 | 2 d | Fixtures `memory-*`, `rules-*`, `local-md` pass (AC1) |
| **M1-8** | Claude skills + legacy commands + plugin skills (read `enabledPlugins` and the plugin dir; namespacing) | M1-7 | 1.5 d | `skills-*`, `skill-vs-command-same-name`, `plugin-skill-namespaced`, `symlinked-skill` pass |
| **M1-9** | Claude subagents | M1-8 | 0.5 d | `shadowed-subagent` passes (AC2) |
| **M1-10** | Claude MCP: managed/local/project/user/plugin, approval state, redaction | M1-5, M1-6 | 1.5 d | `mcp-three-scopes`, `mcp-pending-approval` pass (AC3). No secret value in any golden |
| **M1-11** | Claude settings & hooks: layered view, additive hooks, `allowManagedHooksOnly` | M1-5 | 1 d | `settings-layers-hooks-additive`, `managed-policy-darwin` pass |
| **M1-12** | CLI `scan` + `explain` with tree and JSON renderers, `--kind`, `--show-secrets` | M1-7…11 | 1.5 d | Output matches §4.4 on fixtures (snapshot tests). JSON validates against an exported TS type |
| **M1-13** | Fixture harness: loader, path normalization, `-u` golden update, **write-guard test** (spy on `fs` write APIs; any call fails the test) | M1-2 | 1 d | All fixture cases run through one parametrized test. Write guard active in the CI suite (AC15 groundwork) |
| **M1-14** | `docs/providers/claude-code.md`: capability matrix, fact table with doc URLs and verification dates (from M0-3) | M0-3 | 0.5 d | Every `rules.ts` entry links to a row |
| **M1-15** | Perf + real-machine smoke: `scripts/bench.mjs` (explain p50 over 20 runs), smoke run on the dev machine's real `$HOME` | M1-12 | 0.5 d | `explain` p50 < 500 ms on the dev machine. No crash on the real `$HOME` |

**Critical path:** M1-1 → M1-2 → (M1-3, M1-4, M1-5 in parallel) → M1-6 → M1-7 → M1-8 → M1-12 → M1-15. About 16 working days.

### 4.6 M1 exit criteria

- PLAN acceptance criteria **AC1, AC2, AC3, AC6** pass as fixture tests in CI on macOS and Linux.
- `npx whatsloaded explain` on the dev machine lists all 66 personal skills (symlinks resolved) and any project-level shadowing, in < 500 ms.
- Zero writes outside the test temp directory (write guard).
- Every precedence claim in the output carries a `ruleId` that resolves to a doc-cited row in `docs/providers/claude-code.md`.

## 5. Out of scope for M0/M1 (tracked for later milestones)

`doctor` and the check catalog (M2), Codex/Gemini/Cursor providers (M2), MCP probe (M4), ChangeSets/snapshots (M5), UI (M3), sessions (M6).
