/**
 * The shared skill store (~/.agents/skills), as maintained by the `skills` CLI. Harness
 * skill dirs symlink into it, so it's the natural single source of truth for cross-harness
 * skills. We read `.skill-lock.json` to show where each skill came from.
 */
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Ctx } from '../core/context.js';
import type { Item, Scope } from '../core/model.js';
import { ref } from '../core/model.js';
import { type Provenance, stripUserinfo } from '../core/provenance.js';
import { isRecord, readJson } from '../io/fsx.js';
import { brokenLinkProblems, parkPathToggle, scanDir } from './common.js';
import { type HarnessAdapter, UnsupportedError } from './types.js';

const H = 'agents';

export const storeDir = (ctx: Ctx) => join(ctx.home, '.agents', 'skills');

const lockFile = (ctx: Ctx) => join(ctx.home, '.agents', '.skill-lock.json');

/** What the `skills` CLI recorded about each skill it installed. */
function lockProvenance(ctx: Ctx): Record<string, Provenance> {
  const r = readJson(lockFile(ctx));
  if (!r.ok || !isRecord(r.value) || !isRecord(r.value.skills)) return {};
  const out: Record<string, Provenance> = {};
  for (const [name, e] of Object.entries(r.value.skills)) {
    if (!isRecord(e)) continue;
    const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
    const url = str(e.sourceUrl);
    out[name] = {
      channel: 'skills-cli',
      by: 'skills CLI',
      source: {
        type: e.sourceType === 'github' ? 'github' : url ? 'git' : 'local',
        repo: str(e.source),
        url: url && stripUserinfo(url),
        path: str(e.skillPath),
        commit: str(e.skillFolderHash),
      },
      installedAt: str(e.installedAt),
      updatedAt: str(e.updatedAt),
      evidence: [lockFile(ctx)],
    };
  }
  return out;
}

export const agentsStore: HarnessAdapter = {
  id: H,
  label: 'Shared skill store (~/.agents)',

  detect: (ctx) => existsSync(join(ctx.home, '.agents')),

  discover(ctx) {
    const lock = lockProvenance(ctx);
    const scopes: { dir: string; scope: Scope }[] = [{ dir: storeDir(ctx), scope: { harness: H, level: 'store' } }];
    if (ctx.project)
      scopes.push({ dir: join(ctx.project, '.agents', 'skills'), scope: { harness: H, level: 'project', project: ctx.project } });
    const items: Item[] = scopes.flatMap(({ dir, scope }) => scanDir({ dir, kind: 'skill', scope, mode: 'skill-dirs' }, ctx));
    for (const i of items) {
      const p = i.scope.level === 'store' ? lock[i.name] : undefined;
      if (!p) continue;
      i.provenance = p;
      i.origin = `skills-cli:${p.source?.url ?? p.source?.repo ?? ''}`;
    }
    return { items, problems: brokenLinkProblems(items) };
  },

  writable: () => [],

  setEnabled(item, enabled, ctx) {
    return parkPathToggle(ctx, item, enabled, (i) => decodeURIComponent(basename(i.location.file)));
  },

  remove(item) {
    return [{ op: 'trash', path: item.location.file, describe: `remove ${ref(item)} from the shared store (kept in backup)` }];
  },

  putMcp() {
    throw new UnsupportedError('the shared store only holds skills');
  },

  linkSkill() {
    throw new UnsupportedError('use `whatsloaded adopt` to move a skill into the shared store');
  },
};
