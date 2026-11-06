# Contributing to whatsloaded

Welcome! We prioritize visibility, safety, and strict reproducibility.

## Monorepo Architecture

- `packages/core`: Type models, filesystem discovery, parsing (JSONC, YAML frontmatter, TOML, Markdown imports), precedence resolution strategies, and diagnostics.
- `packages/providers`: Provider adapters (`claude-code`, `codex`, `gemini-cli`, `cursor`, `agents-standard`). Each provider lives in its own subdirectory with verified docs citations.
- `packages/cli`: The command-line interface entry point (`whatsloaded scan`, `whatsloaded explain`).

## Development

```bash
npm install
npm run build
npm run typecheck
npm run lint
npm test
```

## Engineering Principles

1. **Read-Only by Default**: Inspection commands must never write to target projects or user directories.
2. **Deterministic Precedence**: All precedence logic must be pure functions accompanied by golden-file tests.
3. **Honest Confidence**: Rules must be tagged `documented`, `verified`, `inferred`, or `unobservable`.
