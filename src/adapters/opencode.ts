import { existsSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import type { Ctx } from '../core/context.js';
import type { Discovery, Item, Problem, Scope } from '../core/model.js';
import { ref } from '../core/model.js';
import { isRecord, readJson } from '../io/fsx.js';
import { opencodeCodec } from './codecs.js';
import { brokenLinkProblems, parkPathToggle, scanDir } from './common.js';
import { putJsonMcp, readJsonMcps, removeJsonEntry, toggleJsonMcp } from './jsonMcp.js';
import { type HarnessAdapter, UnsupportedError } from './types.js';

const H = 'opencode';

interface Root {
  scope: Scope;
  configs: string[];
  skillDirs: string[];
}

function roots(ctx: Ctx): Root[] {
  const user = join(ctx.home, '.config', 'opencode');
  const out: Root[] = [
    {
      scope: { harness: H, level: 'user' },
      configs: [join(user, 'opencode.json'), join(user, 'opencode.jsonc')],
      skillDirs: [join(user, 'skills'), join(user, 'skill')],
    },
  ];
  if (ctx.project) {
    out.push({
      scope: { harness: H, level: 'project', project: ctx.project },
      configs: [join(ctx.project, 'opencode.json'), join(ctx.project, 'opencode.jsonc')],
      skillDirs: [join(ctx.project, '.opencode', 'skills'), join(ctx.project, '.opencode', 'skill')],
    });
  }
  return out;
}

/** Write to whichever config already holds `mcp`, else an existing file, else opencode.json. */
function writeTarget(r: Root): string {
  const withMcp = r.configs.find((f) => {
    const j = readJson(f);
    return j.ok && isRecord(j.value) && isRecord(j.value.mcp);
  });
  return withMcp ?? r.configs.find((f) => existsSync(f)) ?? r.configs[0]!;
}

export const opencode: HarnessAdapter = {
  id: H,
  label: 'opencode',

  detect: (ctx) => existsSync(join(ctx.home, '.config', 'opencode')),

  discover(ctx) {
    const items: Item[] = [];
    const problems: Problem[] = [];
    const add = (d: Discovery) => {
      items.push(...d.items);
      problems.push(...d.problems);
    };
    for (const r of roots(ctx)) {
      for (const f of r.configs) add(readJsonMcps(f, ['mcp'], r.scope, opencodeCodec));
      for (const dir of r.skillDirs) items.push(...scanDir({ dir, kind: 'skill', scope: r.scope, mode: 'skill-dirs' }, ctx));
    }
    problems.push(...brokenLinkProblems(items));
    return { items, problems };
  },

  writable(kind, ctx) {
    if (kind !== 'mcp' && kind !== 'skill') return [];
    return ctx.project ? ['user', 'project'] : ['user'];
  },

  setEnabled(item, enabled, ctx) {
    if (item.enabled === enabled) return [];
    if (item.kind === 'mcp') return [toggleJsonMcp(item, opencodeCodec, enabled)];
    return parkPathToggle(ctx, item, enabled, (i) => decodeURIComponent(basename(i.location.file)));
  },

  remove(item) {
    if (item.kind === 'mcp') return [removeJsonEntry(item)];
    return [{ op: 'trash', path: item.location.file, describe: `remove ${ref(item)} (kept in backup)` }];
  },

  putMcp(name, spec, level, ctx, opts = {}) {
    const r = roots(ctx).find((x) => x.scope.level === level);
    if (!r) throw new UnsupportedError(`cannot write MCP servers at ${H}:${level}`);
    const file = opts.existing?.location.file ?? writeTarget(r);
    return [putJsonMcp(file, ['mcp', name], opencodeCodec, spec, opts.enabled ?? true, `write ${H}:${level}/mcp/${name} to ${file}`)];
  },

  linkSkill(name, source, level, ctx) {
    const r = roots(ctx).find((x) => x.scope.level === level);
    if (!r) throw new UnsupportedError(`cannot install skills at ${H}:${level}`);
    const dir = r.skillDirs.find((d) => existsSync(d)) ?? r.skillDirs[0]!;
    const at = join(dir, name);
    return [{ op: 'symlink', path: at, target: relative(dirname(at), source), describe: `link ${H}:${level}/skill/${name} -> ${source}` }];
  },
};
