/** Projects your tools already know about, from their own records (read-only). */
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'smol-toml';
import { isRecord, readJson, readText } from '../io/fsx.js';
import type { Ctx } from './context.js';

export interface KnownProject {
  path: string;
  /** Tools that have used it. */
  seenBy: string[];
  /** Epoch ms of the last session there, when a tool records it. */
  last?: number;
}

export function knownProjects(ctx: Ctx): KnownProject[] {
  const by = new Map<string, KnownProject>();
  const add = (path: string, tool: string, last?: number) => {
    const p = resolve(path);
    // Not projects: the filesystem root, home itself, and tools' own folders like ~/.claude.
    if (p === '/' || p === ctx.home || p.startsWith(`${ctx.home}/.`) || !existsSync(p) || !statSync(p).isDirectory()) return;
    const cur = by.get(p) ?? { path: p, seenBy: [] };
    if (!cur.seenBy.includes(tool)) cur.seenBy.push(tool);
    if (last && (!cur.last || last > cur.last)) cur.last = last;
    by.set(p, cur);
  };
  const cj = readJson(join(ctx.home, '.claude.json'));
  if (cj.ok && isRecord(cj.value) && isRecord(cj.value.projects)) {
    for (const [p, v] of Object.entries(cj.value.projects)) {
      const nums = isRecord(v) ? [v.lastSessionModified, v.lastStartTime].filter((x): x is number => typeof x === 'number') : [];
      const last = nums.length ? Math.max(...nums) : undefined;
      add(p, 'claude', last);
    }
  }
  const codex = readText(join(ctx.home, '.codex', 'config.toml'));
  if (codex) {
    try {
      const doc = parse(codex) as Record<string, unknown>;
      if (isRecord(doc.projects)) for (const p of Object.keys(doc.projects)) add(p, 'codex');
    } catch {
      // unreadable config is reported elsewhere
    }
  }
  return [...by.values()].sort((a, b) => (b.last ?? 0) - (a.last ?? 0) || a.path.localeCompare(b.path));
}
