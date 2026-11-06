import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export interface Ctx {
  home: string;
  /** Project root for project/local scopes; undefined when not inside a project. */
  project: string | undefined;
  /** whatsloaded's own state: backups, parked items, external adapters. */
  dataDir: string;
  /** Platform path for enterprise-managed Claude config (overridable for tests). */
  managedDir: string;
  /** Load user adapters/providers from dataDir (off with --no-extensions or WHATSLOADED_NO_EXTENSIONS=1). */
  extensions: boolean;
  /** Environment used to resolve commands (never to run them). */
  env: { PATH?: string; PATHEXT?: string };
}

const PROJECT_MARKERS = ['.git', '.mcp.json', '.claude', '.kiro', '.codex', '.agents', 'opencode.json', 'opencode.jsonc'];

/** Walk upward from `start` to the nearest directory that looks like a project root (never $HOME itself). */
export function findProjectRoot(start: string, home: string): string | undefined {
  let dir = resolve(start);
  while (dir !== dirname(dir)) {
    if (dir === home) return undefined;
    if (PROJECT_MARKERS.some((m) => existsSync(join(dir, m)))) return dir;
    dir = dirname(dir);
  }
  return undefined;
}

/**
 * Global by default: only user-level settings and plugins. A project is included only when one
 * is asked for, either explicitly (`project`) or as "the project containing `cwd`" (`here`), so
 * whatsloaded shows the same thing wherever it is started from.
 */
export function makeCtx(
  opts: { home?: string; cwd?: string; project?: string | false; here?: boolean; extensions?: boolean; env?: Ctx['env'] } = {},
): Ctx {
  const home = resolve(opts.home ?? process.env.WHATSLOADED_TEST_HOME ?? homedir());
  const project = opts.project ? resolve(opts.project) : opts.here ? findProjectRoot(opts.cwd ?? process.cwd(), home) : undefined;
  return {
    home,
    project,
    dataDir: process.env.WHATSLOADED_HOME ?? join(home, '.whatsloaded'),
    managedDir: process.env.WHATSLOADED_MANAGED_DIR ?? '/Library/Application Support/ClaudeCode',
    extensions: opts.extensions ?? !['1', 'true'].includes(process.env.WHATSLOADED_NO_EXTENSIONS ?? ''),
    env: opts.env ?? { PATH: process.env.PATH, PATHEXT: process.env.PATHEXT },
  };
}
