# Contributing to whatsloaded

Thank you for your interest in contributing to **whatsloaded**! We prioritize visibility, lossless configuration editing, and strict local-first safety.

## Architecture Overview

- `src/core/`: Domain models (`Item`, `Scope`, `Kind`, `Problem`), unified inventory loader, cross-harness drift comparison, doctor diagnostics, context token estimation, MCP tool schema measurement, and profile management.
- `src/io/`: Lossless AST-preserving JSON (`jsonEdit.ts`) and TOML (`tomlEdit.ts`) editors, atomic file writes, backup manifests, and reversible change sets (`changeset.ts`).
- `src/adapters/`: Built-in harness adapters (`claude.ts`, `codex.ts`, `kiro.ts`, `opencode.ts`, `agentsStore.ts`) and local transcript usage analysis (`claudeUsage.ts`).
- `src/extensions/`: Dynamic loader and contract for user-installed adapters and providers (`~/.whatsloaded/{adapters,providers}/`), plus the public SDK (`src/sdk.ts`).
- `src/catalog/`: Discovery integrations for the official MCP Registry, `skills.sh`, and plugin marketplaces.
- `src/server/`: Loopback-only (`127.0.0.1`) HTTP API server with DNS rebinding and CSRF guards.
- `src/tui/`: Interactive terminal UI built with Ink and React.
- `src/cli.ts`: Commander CLI entry point.
- `web/`: React 19 + Tailwind CSS v4 + Radix UI localhost web dashboard.
- `test/`: Vitest suite running against isolated, throwaway `$HOME` fixture trees.

## Development Workflow

Requires **Node.js >= 22.12**.

```bash
# Install dependencies
npm install

# Run the CLI directly from TypeScript source
npm run dev -- ls
npm run dev -- doctor

# Develop the Web UI with hot reload (runs API on :4319 and Vite on :5173)
npm run dev:api
npm run dev:web

# Run full verification (Biome lint + TypeScript typecheck across src/test/web + Vitest + production build)
npm run ci
```

## Core Engineering Principles

1. **Read-Only by Default**: Discovery, `doctor`, `ls`, `matrix`, `where`, and `show` never mutate user or project files.
2. **Plans are Transforms, Not Snapshots**: Mutating operations return `Change[]` functions that re-evaluate against live disk content at apply time, preventing race conditions with running coding agents.
3. **Lossless Edits & Reversibility**: Always use `jsonEdit` or `tomlEdit` so comments, key order, and formatting survive. Every apply creates a backup manifest in `~/.whatsloaded/backups/` that `whatsloaded undo` can reverse byte-for-byte.
4. **Zero Secret Leakage**: Environment variables and HTTP headers must be redacted before leaving the process unless `--reveal` is explicitly passed in the CLI.
