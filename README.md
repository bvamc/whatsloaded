# whatsloaded

**See what your AI coding agents actually load, and why.**

`whatsloaded` is a local-first, open-source CLI (with an optional localhost UI) that explains, diagnoses, and safely manages the configuration of AI coding agents: Claude Code, Codex CLI, Gemini CLI, and Cursor.

Give it an agent and a directory, and it shows:

- which instructions, skills, subagents, commands, MCP servers, hooks and settings apply
- where each one came from (file, scope, the rule that included it)
- what overrides what (shadowing, duplicates, conflicts)
- what's broken (bad imports, invalid configs, missing MCP commands, truncation)
- how confident it is (`documented` / `verified` / `inferred` / `unobservable`)

```bash
npx whatsloaded explain --agent claude   # effective context for this directory
npx whatsloaded doctor                   # findings, CI-friendly exit codes
npx whatsloaded mcp probe github         # start a test instance exactly as the agent would
npx whatsloaded ui                       # localhost UI
```

> [!NOTE]
> Status: **pre-alpha, planning stage.** Nothing is implemented yet. See [docs/PLAN.md](docs/PLAN.md) for the full product and technical blueprint.

## Principles

- Local-first. No account, no telemetry.
- Read-only by default. Every write is previewed, snapshotted, and reversible.
- Honest about what each agent does and doesn't expose.
- A focused utility, not a platform. No sync, no marketplace, no cost tracking.

## License

Apache-2.0
