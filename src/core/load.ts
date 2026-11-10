/**
 * "What does this tool load when I start it here?" — the question users actually ask.
 *
 * For each harness, everything that applies in the current project is grouped by *source*,
 * meaning the lever that controls it: your own settings, this project, one plugin, or policy.
 * Plugin contents can only be switched off by switching off the plugin, so a plugin is one
 * source with one switch. Agent profiles (Kiro agents' own servers) only load while that
 * agent runs, so they are listed per agent rather than counted in the default load.
 */
import { join } from 'node:path';
import { isRecord, readFrontmatter, readJson, readText } from '../io/fsx.js';
import type { Inventory } from './inventory.js';
import type { Item, Kind } from './model.js';
import { ref } from './model.js';

export type SourceKind = 'you' | 'project' | 'plugin' | 'policy';

export interface LoadSource {
  id: string;
  kind: SourceKind;
  label: string;
  /** Who installed it, when known (plugins, provider claims). */
  by?: string;
  /** For plugin sources: the plugin item, whose switch controls everything listed. */
  plugin?: Item;
  items: Item[];
  /** Rough context size of this source's enabled items. */
  tokens: number;
  /** How many of its enabled items were used in the usage window (undefined = usage not tracked). */
  used?: number;
}

export interface ToolLoad {
  harness: string;
  label: string;
  sources: LoadSource[];
  /** What starts / is offered to the model with current settings. */
  loaded: Partial<Record<Kind, number>>;
  /** Rough size of text placed in context before the first message (skills, agents, commands, rules). */
  contextTokens: number;
  /** MCP servers whose tool definitions have not been measured yet (their cost is not in contextTokens). */
  unmeasuredServers: number;
  /** Tokens of tool definitions from servers that were measured (included in contextTokens). */
  toolTokens: number;
  /** MCP servers started more than once (e.g. several plugins bundling the same one). */
  duplicates: { name: string; count: number }[];
  /** How agents work in this tool; for 'modes' only the chosen agent runs. */
  agentsAre: 'subagents' | 'modes';
  /** For 'modes': each agent and the servers it brings, which load only while it runs. */
  agents: { item: Item; servers: Item[] }[];
  /** Whether this tool reports usage; when false, nothing below is known. */
  tracked: boolean;
  /** Of what loads, how much was used in the window. */
  used: Partial<Record<Kind, number>>;
  /** Unused in the window and safe for you to switch off: whole plugins, and your own items. */
  trim: { plugins: Item[]; items: Item[]; tokens: number; servers: number };
}

const CONTENT_KINDS: Kind[] = ['mcp', 'skill', 'agent', 'command', 'rule'];

/**
 * Characters of instruction text an item puts in the model's context. Skills, agents and
 * commands contribute their name and description (the body loads on demand); rules load whole.
 */
export function contextChars(i: Item): number {
  if (i.kind === 'mcp') return (i.tools?.tokens ?? 0) * 4;
  try {
    if (i.kind === 'skill') {
      // Skills only you can start are not described to the model.
      if (i.skill?.userOnly) return 0;
      const fm = readFrontmatter(join(i.location.file, 'SKILL.md'));
      return i.name.length + String(fm.description ?? '').length;
    }
    if (i.kind === 'agent' || i.kind === 'command') {
      if (i.location.file.endsWith('.json')) {
        const r = readJson(i.location.file);
        return i.name.length + (r.ok && isRecord(r.value) ? String(r.value.description ?? '').length : 0);
      }
      return i.name.length + String(readFrontmatter(i.location.file).description ?? '').length;
    }
    if (i.kind === 'rule') {
      const fm = readFrontmatter(i.location.file);
      // Kiro steering with `inclusion: manual | fileMatch` is not always in context.
      if (typeof fm.inclusion === 'string' && fm.inclusion !== 'always') return 0;
      return readText(i.location.file)?.length ?? 0;
    }
  } catch {
    return 0;
  }
  return 0;
}

function sourceOf(i: Item, plugins: Map<string, Item>): Omit<LoadSource, 'items' | 'tokens'> | undefined {
  switch (i.scope.level) {
    case 'user':
    case 'store':
      return { id: 'you', kind: 'you', label: 'Your settings (all projects)' };
    case 'local':
      return { id: 'local', kind: 'you', label: 'Your settings (this project only)' };
    case 'project':
      return { id: 'project', kind: 'project', label: 'This project (shared with the repo)' };
    case 'managed':
      return { id: 'policy', kind: 'policy', label: 'Organisation policy' };
    case 'plugin': {
      const owner = i.scope.owner ?? '?';
      const plugin = plugins.get(owner);
      return { id: `plugin:${owner}`, kind: 'plugin', label: owner.split('@')[0]!, by: plugin?.provenance?.by ?? i.provenance?.by, plugin };
    }
    default:
      return undefined;
  }
}

const SOURCE_ORDER: SourceKind[] = ['you', 'project', 'plugin', 'policy'];

export function toolLoads(inv: Pick<Inventory, 'items' | 'active'>): ToolLoad[] {
  const out: ToolLoad[] = [];
  for (const a of inv.active) {
    // The shared skill store is not a tool; its skills reach tools through links.
    if (a.id === 'agents') continue;
    const mine = inv.items.filter((i) => i.scope.harness === a.id);
    const plugins = new Map(mine.filter((i) => i.kind === 'plugin').map((p) => [p.name, p]));
    const sources = new Map<string, LoadSource>();
    for (const p of plugins.values()) {
      const s = sourceOf({ ...p, scope: { ...p.scope, level: 'plugin', owner: p.name } }, plugins)!;
      sources.set(s.id, { ...s, items: [], tokens: 0 });
    }
    for (const i of mine) {
      if (!CONTENT_KINDS.includes(i.kind) || i.scope.level === 'agent') continue;
      const s = sourceOf(i, plugins);
      if (!s) continue;
      if (!sources.has(s.id)) sources.set(s.id, { ...s, items: [], tokens: 0 });
      sources.get(s.id)!.items.push(i);
    }
    const modes = a.agentsAre === 'modes';
    // Agents that are modes are alternatives, not all loaded at once.
    const live = [...sources.values()].flatMap((s) =>
      s.plugin && !s.plugin.enabled ? [] : s.items.filter((i) => i.enabled && !i.parked && !i.onDemand && !(modes && i.kind === 'agent')),
    );
    const loaded: Partial<Record<Kind, number>> = {};
    for (const i of live) loaded[i.kind] = (loaded[i.kind] ?? 0) + 1;
    const sizes = new Map(live.map((i) => [i, contextChars(i)]));
    for (const s of sources.values()) s.tokens = Math.round(s.items.reduce((n, i) => n + (sizes.get(i) ?? 0), 0) / 4);
    // Your own settings first; then the biggest levers (largest context, then most items).
    const list = [...sources.values()].sort(
      (x, y) =>
        SOURCE_ORDER.indexOf(x.kind) - SOURCE_ORDER.indexOf(y.kind) ||
        y.tokens - x.tokens ||
        y.items.length - x.items.length ||
        x.label.localeCompare(y.label),
    );
    const tracked = live.some((i) => i.usage !== undefined) || mine.some((i) => i.kind === 'plugin' && i.usage !== undefined);
    const isUsed = (i: Item) => (i.usage?.count ?? 0) > 0;
    const used: Partial<Record<Kind, number>> = {};
    if (tracked) for (const i of live) if (isUsed(i)) used[i.kind] = (used[i.kind] ?? 0) + 1;
    const trim: ToolLoad['trim'] = { plugins: [], items: [], tokens: 0, servers: 0 };
    if (tracked) {
      for (const s of sources.values()) {
        const liveHere = s.items.filter((i) => live.includes(i));
        s.used = liveHere.filter(isUsed).length;
        if (s.plugin) {
          if (s.plugin.enabled && liveHere.length && !s.used && !isUsed(s.plugin) && !s.plugin.managedBy && !s.plugin.locked) {
            trim.plugins.push(s.plugin);
            trim.tokens += s.tokens;
            trim.servers += liveHere.filter((i) => i.kind === 'mcp').length;
          }
        } else if (s.kind === 'you') {
          for (const i of liveHere) {
            // Only what you own and can switch; rules are instructions you wrote on purpose.
            if (i.kind === 'rule' || isUsed(i) || i.managedBy || (i.kind !== 'mcp' && i.provenance?.by)) continue;
            trim.items.push(i);
            trim.tokens += Math.round((sizes.get(i) ?? 0) / 4);
            if (i.kind === 'mcp') trim.servers++;
          }
        }
      }
    }
    const servers = live.filter((i) => i.kind === 'mcp');
    const counts = new Map<string, number>();
    for (const s of servers) counts.set(s.name, (counts.get(s.name) ?? 0) + 1);
    const agentServers = mine.filter((i) => i.kind === 'mcp' && i.scope.level === 'agent');
    out.push({
      harness: a.id,
      label: a.label,
      sources: list,
      loaded,
      contextTokens: Math.round([...sizes.values()].reduce((n, c) => n + c, 0) / 4),
      unmeasuredServers: servers.filter((i) => !i.tools).length,
      toolTokens: servers.reduce((n, i) => n + (i.tools?.tokens ?? 0), 0),
      duplicates: [...counts]
        .filter(([, n]) => n > 1)
        .map(([name, count]) => ({ name, count }))
        .sort((x, y) => y.count - x.count),
      tracked,
      used,
      trim,
      agentsAre: modes ? 'modes' : 'subagents',
      agents: modes
        ? mine.filter((i) => i.kind === 'agent').map((item) => ({ item, servers: agentServers.filter((s) => s.scope.owner === item.name) }))
        : [],
    });
  }
  return out;
}

export const sourceRefs = (s: LoadSource) => s.items.map(ref);
