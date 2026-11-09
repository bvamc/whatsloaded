import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse } from 'smol-toml';
import type { Ctx } from '../core/context.js';
import type { Item, Problem, Scope } from '../core/model.js';
import { ref } from '../core/model.js';
import type { Change } from '../io/changeset.js';
import { isDir, isRecord, listEntries, readText } from '../io/fsx.js';
import { appendTable, removeTable, setTableKey, verifiedEdit } from '../io/tomlEdit.js';
import { claudeCodec, codexCodec } from './codecs.js';
import { brokenLinkProblems, instructionFile, parkPathToggle, parseProblem, scanDir } from './common.js';
import { readPluginMcps } from './jsonMcp.js';
import { type HarnessAdapter, UnsupportedError } from './types.js';

const H = 'codex';

function roots(ctx: Ctx): { root: string; scope: Scope }[] {
  const out = [{ root: join(ctx.home, '.codex'), scope: { harness: H, level: 'user' } as Scope }];
  if (ctx.project) out.push({ root: join(ctx.project, '.codex'), scope: { harness: H, level: 'project', project: ctx.project } });
  return out;
}

const configFor = (ctx: Ctx, level: string) => {
  const r = roots(ctx).find((x) => x.scope.level === level);
  return r && join(r.root, 'config.toml');
};

/** Newest cached version of `name@marketplace` under ~/.codex/plugins/cache/<marketplace>/<name>/. */
function pluginDir(ctx: Ctx, id: string): string | undefined {
  const at = id.lastIndexOf('@');
  if (at < 1) return undefined;
  const base = join(ctx.home, '.codex', 'plugins', 'cache', id.slice(at + 1), id.slice(0, at));
  const versions = listEntries(base).filter((v) => isDir(join(base, v)));
  const num = (v: string) => v.split(/[.-]/).map((x) => Number(x) || 0);
  versions.sort((a, b) => {
    const [x, y] = [num(a), num(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
    return 0;
  });
  const latest = versions.at(-1);
  return latest && join(base, latest);
}

type Doc = Record<string, Record<string, Record<string, unknown>>>;

function tomlEdit(file: string, describe: string, edit: (t: string) => string, expect: (doc: Doc) => void): Change {
  return { op: 'edit', file, describe, transform: (t) => verifiedEdit(t ?? '', edit, expect as (d: Record<string, unknown>) => void) };
}

export const codex: HarnessAdapter = {
  id: H,
  label: 'Codex',

  detect: (ctx) => existsSync(join(ctx.home, '.codex')),

  discover(ctx) {
    const items: Item[] = [];
    const problems: Problem[] = [];
    for (const { root, scope } of roots(ctx)) {
      const file = join(root, 'config.toml');
      const text = readText(file);
      if (text !== null) {
        let doc: Record<string, unknown> = {};
        try {
          doc = parse(text) as Record<string, unknown>;
        } catch (e) {
          problems.push(parseProblem(file, (e as Error).message.split('\n')[0]!));
        }
        if (isRecord(doc.mcp_servers)) {
          for (const [name, raw] of Object.entries(doc.mcp_servers)) {
            const d = codexCodec.decode(raw);
            if (d)
              items.push({ kind: 'mcp', name, scope, enabled: d.enabled, mcp: d.spec, location: { file, path: ['mcp_servers', name] } });
          }
        }
        if (isRecord(doc.plugins)) {
          for (const [name, raw] of Object.entries(doc.plugins)) {
            const enabled = !isRecord(raw) || raw.enabled !== false;
            items.push({ kind: 'plugin', name, scope, enabled, origin: name.split('@')[1], location: { file, path: ['plugins', name] } });
            // Plugin contents: MCP servers, skills and agents bundled in the cached plugin.
            const dir = pluginDir(ctx, name);
            if (!dir) continue;
            const pscope: Scope = { harness: H, level: 'plugin', owner: name };
            const d = readPluginMcps(dir, pscope, name, enabled, claudeCodec);
            items.push(...d.items);
            problems.push(...d.problems);
            for (const spec of [
              { dir: join(dir, 'skills'), kind: 'skill', scope: pscope, mode: 'skill-dirs' },
              { dir: join(dir, 'agents'), kind: 'agent', scope: pscope, mode: 'md-files' },
            ] as const) {
              for (const it of scanDir(spec, ctx)) items.push({ ...it, enabled, managedBy: `plugin:${name}` });
            }
          }
        }
      }
      items.push(...scanDir({ dir: join(root, 'skills'), kind: 'skill', scope, mode: 'skill-dirs' }, ctx));
      // Codex reads AGENTS.md from ~/.codex and from the project root.
      const agentsMd = instructionFile(join(scope.level === 'user' ? root : ctx.project!, 'AGENTS.md'), scope, 'AGENTS.md');
      if (agentsMd) items.push(agentsMd);
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
    if (item.kind === 'mcp' || item.kind === 'plugin') {
      const [table, name] = item.location.path as [string, string];
      const value = enabled ? (item.kind === 'plugin' ? true : undefined) : false;
      return [
        tomlEdit(
          item.location.file,
          `${enabled ? 'enable' : 'disable'} [${table}.${name}] in ${item.location.file}`,
          (t) => setTableKey(t, [table, name], 'enabled', value),
          (doc) => {
            const entry = doc[table]![name]!;
            if (value === undefined) delete entry.enabled;
            else entry.enabled = value;
          },
        ),
      ];
    }
    return parkPathToggle(ctx, item, enabled, (i) => decodeURIComponent(basename(i.location.file)));
  },

  remove(item) {
    if (item.kind === 'plugin') throw new UnsupportedError(`manage Codex plugins with codex itself`);
    if (item.kind === 'mcp') {
      const name = item.name;
      return [
        tomlEdit(
          item.location.file,
          `remove [mcp_servers.${name}] from ${item.location.file}`,
          (t) => removeTable(t, ['mcp_servers', name]),
          (doc) => void delete doc.mcp_servers![name],
        ),
      ];
    }
    return [{ op: 'trash', path: item.location.file, describe: `remove ${ref(item)} (kept in backup)` }];
  },

  putMcp(name, spec, level, ctx, opts = {}) {
    const file = configFor(ctx, level);
    if (!file) throw new UnsupportedError(`cannot write MCP servers at ${H}:${level}`);
    const enabled = opts.enabled ?? true;
    return [
      {
        op: 'edit',
        file,
        describe: `write [mcp_servers.${name}] to ${file}${opts.existing ? ' (replaces the table; comments inside it are dropped)' : ''}`,
        transform: (t) => {
          const before = t ?? '';
          const cur = (parse(before) as Doc).mcp_servers?.[name];
          const value = codexCodec.encode(spec, enabled, cur);
          return verifiedEdit(
            before,
            (x) => appendTable(cur ? removeTable(x, ['mcp_servers', name]) : x, ['mcp_servers', name], value),
            (doc) => {
              doc.mcp_servers = (doc.mcp_servers as Record<string, unknown>) ?? {};
              (doc.mcp_servers as Record<string, unknown>)[name] = value;
            },
          );
        },
      },
    ];
  },

  linkSkill(name, source, level, ctx) {
    const r = roots(ctx).find((x) => x.scope.level === level);
    if (!r) throw new UnsupportedError(`cannot install skills at ${H}:${level}`);
    // Codex's existing links on this machine are absolute; match that convention.
    return [
      { op: 'symlink', path: join(r.root, 'skills', name), target: source, describe: `link ${H}:${level}/skill/${name} -> ${source}` },
    ];
  },
};
