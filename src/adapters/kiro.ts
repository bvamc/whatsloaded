import { existsSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import type { Ctx } from '../core/context.js';
import type { Discovery, Item, Problem, Scope } from '../core/model.js';
import { ref } from '../core/model.js';
import { isRecord, lexists, readFrontmatter, readJson } from '../io/fsx.js';
import { kiroCodec } from './codecs.js';
import { brokenLinkProblems, type DirSpec, parkPathToggle, scanDir } from './common.js';
import { putJsonMcp, readJsonMcps, removeJsonEntry, toggleJsonMcp } from './jsonMcp.js';
import { kiroAgentReferences } from './references.js';
import { type HarnessAdapter, UnsupportedError } from './types.js';

const H = 'kiro';

function roots(ctx: Ctx): { root: string; scope: Scope }[] {
  const out = [{ root: join(ctx.home, '.kiro'), scope: { harness: H, level: 'user' } as Scope }];
  if (ctx.project) out.push({ root: join(ctx.project, '.kiro'), scope: { harness: H, level: 'project', project: ctx.project } });
  return out;
}

const rootFor = (ctx: Ctx, level: string) => roots(ctx).find((r) => r.scope.level === level)?.root;

/** Kiro powers, read-only: Kiro installs, updates and activates them itself. */
function powers(ctx: Ctx): Item[] {
  const root = join(ctx.home, '.kiro', 'powers');
  const r = readJson(join(root, 'installed.json'));
  if (!r.ok || !isRecord(r.value) || !Array.isArray(r.value.installedPowers)) return [];
  const out: Item[] = [];
  for (const p of r.value.installedPowers) {
    if (!isRecord(p) || typeof p.name !== 'string') continue;
    const dir = join(root, 'installed', p.name);
    const fm = readFrontmatter(join(dir, 'POWER.md'));
    const by = 'Kiro power';
    const provenance = {
      channel: 'harness-plugin' as const,
      by,
      source: { type: 'marketplace' as const, id: String(p.registryId ?? '') },
      evidence: [join(root, 'installed.json')],
    };
    const owner: Scope = { harness: H, level: 'plugin', owner: p.name };
    out.push({
      kind: 'plugin',
      name: p.name,
      scope: { harness: H, level: 'user' },
      enabled: true,
      description: typeof fm.description === 'string' ? fm.description : typeof fm.displayName === 'string' ? fm.displayName : undefined,
      location: { file: dir },
      provenance,
      locked: 'Kiro manages powers; install, update or remove them in Kiro',
      onDemand: 'Kiro activates powers when your request matches them',
    });
    const onDemand = 'Loads only while Kiro has this power active';
    for (const m of readJsonMcps(join(dir, 'mcp.json'), ['mcpServers'], owner, kiroCodec, {
      managedBy: `power:${p.name}`,
      onDemand,
      provenance,
    }).items)
      out.push(m);
    if (lexists(join(dir, 'POWER.md'))) {
      out.push({
        kind: 'rule',
        name: `${p.name}/POWER.md`,
        scope: owner,
        enabled: true,
        location: { file: join(dir, 'POWER.md') },
        managedBy: `power:${p.name}`,
        onDemand,
        provenance,
      });
    }
  }
  return out;
}

export const kiro: HarnessAdapter = {
  id: H,
  label: 'Kiro / Kiro CLI',
  agentsAre: 'modes',

  detect: (ctx) => existsSync(join(ctx.home, '.kiro')),

  discover(ctx) {
    const items: Item[] = [];
    const problems: Problem[] = [];
    const add = (d: Discovery) => {
      items.push(...d.items);
      problems.push(...d.problems);
    };

    for (const { root, scope } of roots(ctx)) {
      add(readJsonMcps(join(root, 'settings', 'mcp.json'), ['mcpServers'], scope, kiroCodec));
      const specs: DirSpec[] = [
        { dir: join(root, 'skills'), kind: 'skill', scope, mode: 'skill-dirs' },
        { dir: join(root, 'steering'), kind: 'rule', scope, mode: 'md-tree' },
        { dir: join(root, 'agents'), kind: 'agent', scope, mode: 'json-files' },
      ];
      for (const s of specs) items.push(...scanDir(s, ctx));
    }

    // Kiro agents embed their own MCP servers: surface them as agent-scoped items.
    for (const agent of items.filter((i) => i.kind === 'agent' && !i.parked)) {
      const scope: Scope = { harness: H, level: 'agent', owner: agent.name, project: agent.scope.project };
      add(readJsonMcps(agent.location.file, ['mcpServers'], scope, kiroCodec));
    }

    // Powers: bundles of an MCP server plus instructions (POWER.md) that Kiro activates when relevant.
    items.push(...powers(ctx));

    // Usage: which servers each agent's tool lists refer to.
    const known = new Set(items.filter((i) => i.kind === 'mcp' && i.scope.level !== 'agent').map((i) => i.name));
    const references = items.filter((i) => i.kind === 'agent' && !i.parked).flatMap((a) => kiroAgentReferences(a, known));

    problems.push(...brokenLinkProblems(items));
    return { items, problems, references };
  },

  writable(kind, ctx) {
    if (kind !== 'mcp' && kind !== 'skill') return [];
    return ctx.project ? ['user', 'project'] : ['user'];
  },

  setEnabled(item, enabled, ctx) {
    if (item.enabled === enabled) return [];
    if (item.kind === 'mcp') return [toggleJsonMcp(item, kiroCodec, enabled)];
    return parkPathToggle(ctx, item, enabled, (i) => decodeURIComponent(basename(i.location.file)));
  },

  remove(item) {
    if (item.kind === 'mcp') return [removeJsonEntry(item)];
    return [{ op: 'trash', path: item.location.file, describe: `remove ${ref(item)} (kept in backup)` }];
  },

  putMcp(name, spec, level, ctx, opts = {}) {
    if (level === 'agent') {
      // Agent-embedded servers can be updated in place (sync), not created from scratch.
      if (!opts.existing) throw new UnsupportedError('agent-scoped servers can only be updated in place');
      const file = opts.existing.location.file;
      return [putJsonMcp(file, ['mcpServers', name], kiroCodec, spec, opts.enabled ?? true, `update ${ref(opts.existing)} in ${file}`)];
    }
    const root = rootFor(ctx, level);
    if (!root) throw new UnsupportedError(`cannot write MCP servers at ${H}:${level}`);
    const file = join(root, 'settings', 'mcp.json');
    return [putJsonMcp(file, ['mcpServers', name], kiroCodec, spec, opts.enabled ?? true, `write ${H}:${level}/mcp/${name} to ${file}`)];
  },

  linkSkill(name, source, level, ctx) {
    const root = rootFor(ctx, level);
    if (!root) throw new UnsupportedError(`cannot install skills at ${H}:${level}`);
    const at = join(root, 'skills', name);
    return [{ op: 'symlink', path: at, target: relative(dirname(at), source), describe: `link ${H}:${level}/skill/${name} -> ${source}` }];
  },
};
