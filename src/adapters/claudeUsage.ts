/**
 * What you actually used in Claude Code, from its local session transcripts
 * (~/.claude/projects/<project>/<session>.jsonl) and lifetime counters in ~/.claude.json.
 *
 * Only tool *names* are read: MCP calls (`mcp__<server>__<tool>`), the Skill tool's `skill`
 * argument and the Agent/Task tool's `subagent_type`. Message content is never parsed or kept.
 * Per-file results are cached by (mtime, size) in ~/.whatsloaded/cache, so only new or changed
 * transcripts are read again.
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Ctx } from '../core/context.js';
import type { Item, UsageReport } from '../core/model.js';
import { ref } from '../core/model.js';
import { isRecord, readJson } from '../io/fsx.js';
import { claudePluginServerKey, claudeServerKey } from './references.js';

type Counts = Record<string, [count: number, last: number]>;
interface FileUsage {
  mtimeMs: number;
  size: number;
  mcp: Counts;
  skill: Counts;
  agent: Counts;
}
interface Cache {
  version: 1;
  files: Record<string, FileUsage>;
}

const cacheFile = (ctx: Ctx) => join(ctx.dataDir, 'cache', 'claude-usage.json');

function bump(c: Counts, key: string, at: number): void {
  const cur = c[key];
  if (cur) {
    cur[0]++;
    cur[1] = Math.max(cur[1], at);
  } else c[key] = [1, at];
}

/** Transcript files modified since `since`, searched two levels deep (sessions and their subagents). */
function transcripts(root: string, since: number): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const n of names) {
      const p = join(dir, n);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (depth < 3) walk(p, depth + 1);
      } else if (n.endsWith('.jsonl') && st.mtimeMs >= since) out.push(p);
    }
  };
  walk(root, 0);
  return out;
}

/** Extract tool usage from one transcript. Lines without a tool_use are skipped before parsing. */
export function scanTranscript(text: string): Omit<FileUsage, 'mtimeMs' | 'size'> {
  const u = { mcp: {} as Counts, skill: {} as Counts, agent: {} as Counts };
  for (const line of text.split('\n')) {
    if (!line.includes('"tool_use"')) continue;
    let o: unknown;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(o) || !isRecord(o.message) || !Array.isArray(o.message.content)) continue;
    const at = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) || 0 : 0;
    for (const c of o.message.content) {
      if (!isRecord(c) || c.type !== 'tool_use' || typeof c.name !== 'string') continue;
      const input = isRecord(c.input) ? c.input : {};
      if (c.name.startsWith('mcp__')) {
        const rest = c.name.slice(5);
        const sep = rest.indexOf('__');
        bump(u.mcp, sep < 0 ? rest : rest.slice(0, sep), at);
      } else if (c.name === 'Skill' && typeof input.skill === 'string') {
        bump(u.skill, input.skill, at);
      } else if ((c.name === 'Agent' || c.name === 'Task') && typeof input.subagent_type === 'string') {
        bump(u.agent, input.subagent_type, at);
      }
    }
  }
  return u;
}

function loadCache(ctx: Ctx): Cache {
  const r = readJson(cacheFile(ctx));
  return r.ok && isRecord(r.value) && r.value.version === 1 && isRecord(r.value.files)
    ? (r.value as unknown as Cache)
    : { version: 1, files: {} };
}

function saveCache(ctx: Ctx, cache: Cache): void {
  const f = cacheFile(ctx);
  mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(cache), { mode: 0o600 });
  renameSync(tmp, f);
}

/** Usage keys under which Claude records each item. */
function keysOf(i: Item): string[] {
  const plugin = i.scope.level === 'plugin' ? i.scope.owner : undefined;
  const pluginName = plugin?.split('@')[0];
  if (i.kind === 'mcp') return [plugin ? claudePluginServerKey(plugin, i.name) : claudeServerKey(i.name)];
  if (i.kind === 'skill' || i.kind === 'agent') return [pluginName ? `${pluginName}:${i.name}` : i.name];
  return [];
}

export function claudeUsage(ctx: Ctx, items: Item[], since: number): UsageReport {
  const cache = loadCache(ctx);
  const files = transcripts(join(ctx.home, '.claude', 'projects'), since);
  const live: Record<string, FileUsage> = {};
  let dirty = false;
  for (const f of files) {
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(f);
    } catch {
      continue;
    }
    const hit = cache.files[f];
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
      live[f] = hit;
      continue;
    }
    try {
      live[f] = { mtimeMs: st.mtimeMs, size: st.size, ...scanTranscript(readFileSync(f, 'utf8')) };
      dirty = true;
    } catch {
      // unreadable transcript: skip it
    }
  }
  if (dirty || Object.keys(cache.files).length !== Object.keys(live).length) {
    try {
      saveCache(ctx, { version: 1, files: live });
    } catch {
      // cache is an optimisation only
    }
  }

  const total = { mcp: {} as Counts, skill: {} as Counts, agent: {} as Counts };
  for (const u of Object.values(live)) {
    for (const k of ['mcp', 'skill', 'agent'] as const) {
      for (const [key, [n, last]] of Object.entries(u[k])) {
        if (last && last < since) continue;
        const cur = total[k][key];
        total[k][key] = cur ? [cur[0] + n, Math.max(cur[1], last)] : [n, last];
      }
    }
  }
  // Lifetime counters from ~/.claude.json fill in skills used before the window's transcripts.
  const cj = readJson(join(ctx.home, '.claude.json'));
  const lifetime = cj.ok && isRecord(cj.value) && isRecord(cj.value.skillUsage) ? cj.value.skillUsage : {};
  const pluginUsage = cj.ok && isRecord(cj.value) && isRecord(cj.value.pluginUsage) ? cj.value.pluginUsage : {};

  const byRef: UsageReport['byRef'] = {};
  for (const i of items) {
    if (i.kind === 'plugin') {
      const pu = pluginUsage[i.name];
      const last = isRecord(pu) && typeof pu.lastUsedAt === 'number' ? pu.lastUsedAt : undefined;
      if (last && last >= since) byRef[ref(i)] = { count: isRecord(pu) && typeof pu.usageCount === 'number' ? pu.usageCount : 1, last };
      continue;
    }
    const k = i.kind === 'mcp' ? 'mcp' : i.kind === 'skill' ? 'skill' : i.kind === 'agent' ? 'agent' : undefined;
    if (!k) continue;
    for (const key of keysOf(i)) {
      const t = total[k][key];
      const lt = k === 'skill' ? lifetime[key] : undefined;
      const lifeLast = isRecord(lt) && typeof lt.lastUsedAt === 'number' ? lt.lastUsedAt : 0;
      if (t) byRef[ref(i)] = { count: t[0], last: t[1] || undefined };
      else if (lifeLast >= since)
        byRef[ref(i)] = { count: isRecord(lt) && typeof lt.usageCount === 'number' ? lt.usageCount : 1, last: lifeLast };
    }
  }
  return { since, sessions: files.length, byRef };
}
