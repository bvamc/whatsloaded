# Changelog

## 0.2.0 (unreleased)

### Added

- **What you actually use.** Usage from Claude Code's local transcripts (tool names only, never content; cached per file): each tool page says what you used in the last 30 days, and a "Not used in the last 30 days" panel turns idle plugins and servers off in one reviewed, undoable change.
- **Measure tool definitions.** `whatsloaded measure <server>` and a Measure button start a server once (after showing the exact command), read its tool list and record the count and token cost, so "≈ tokens before your first message" includes MCP tool definitions. Project-defined servers are flagged; 15 s limit; only names and sizes are cached.
- **Profiles.** Save what a tool loads (or only what you used) under a name and switch any tool to it later: `whatsloaded profile save|apply|ls|rm`, and a Profiles bar on each tool page.
- **Instruction files** (CLAUDE.md, CLAUDE.local.md, AGENTS.md) are counted in context; they are locked from toggling.
- Web: add an MCP server to several tools from a form; turn a server off in all your tools at once; the toast after applying says which tools to restart.

- **Installed vs configured vs used.** Every configuration entry now has a role: _yours_ (user/project/local), _from plugins_, _agent profile_ (launch settings an agent carries for itself), or _policy_. `whatsloaded where <name>` shows the install(s) a server's command resolves to (PATH lookup, nothing is executed), every configuration grouped by role, and which agents use its tools.
- Usage references: Kiro agent `tools`/`allowedTools` (`@server/tool`, ignoring `@builtin`) and Claude agent frontmatter `tools` (`mcp__server__tool`, including plugin-prefixed names).
- Doctor: `runtime-not-found` (with a hint when a command is pinned to a version that was upgraded away) and `reference-unconfigured` (agents using a server's tools with no configuration they can see), grouped per server.

- **Providers**: user-installed extensions (`~/.whatsloaded/providers/*.mjs`) that claim items ("installed by"), mark them enforced, and add plan warnings and doctor findings. Servers embedded in a claimed agent inherit its owner.
- `--no-extensions` flag and `WHATSLOADED_NO_EXTENSIONS=1` to run without user adapters or providers.
- `~/.whatsloaded/config.json` with `compare.ignoreEnvKeys`.
- `whatsloaded/sdk` entry point with types and `defineAdapter` / `defineProvider` helpers.
- Biome linting and formatting, typechecked tests, CI workflow, term-leak check.

### Changed

- Drift compares only _your_ configurations. Plugin-bundled entries and agent profiles are tailored by their owners and are reported, not compared. `sync` rewrites only your configurations; `--include-agents` also rewrites agent profiles.
- "Copies" are now called configurations everywhere.

- MCP drift rule: missing vs empty `args`/`env`, env key order and `disabledTools`-only differences are no longer drift.
- External adapters need only `id`, `label`, `detect` and `discover`; missing capabilities report as unsupported.
- Extension files writable by other users are refused.
- Package renamed to `whatsloaded`; both `whatsloaded` and `whatsloaded` binaries are installed.

### Removed

- Built-in knowledge of any specific organisation's installer. Install a provider to restore it.
