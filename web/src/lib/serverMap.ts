/**
 * Everything connected to one MCP server, laid out as a left-to-right graph:
 * where it comes from → the server → the tools that turn it on → who relies on it.
 */
import type { ItemDTO, Kind, StateDTO } from '../api';
import { type ServerWhole, serverWhole } from '../components/ServerControl';
import { refName } from './meta';

export interface Program {
  key: string;
  /** Path, command or URL that actually runs. */
  label: string;
  detail?: string;
  ok: boolean;
  entries: number;
  by?: string;
  uninstall?: string;
  about?: string;
  onDemand?: boolean;
}

/** The programs your configurations start, merged by what actually runs. */
export function programsOf(entries: ItemDTO[]): Program[] {
  const by = new Map<string, Program>();
  for (const e of entries) {
    const s = e.mcp;
    if (!s) continue;
    let x: Omit<Program, 'entries'>;
    if (s.transport !== 'stdio') x = { key: `url:${s.url}`, label: s.url ?? '', detail: `remote · ${s.transport}`, ok: true };
    else if (e.runtime?.found) {
      const real = e.runtime.realpath && e.runtime.realpath !== e.runtime.resolved ? `→ ${e.runtime.realpath}` : undefined;
      x = { key: `exe:${e.runtime.resolved}`, label: e.runtime.resolved ?? s.command ?? '', detail: real, ok: true };
    } else if (e.runtime?.unresolved) x = { key: `var:${s.command}`, label: s.command ?? '', detail: 'contains variables', ok: true };
    else x = { key: `missing:${s.command}`, label: s.command ?? '', detail: 'not installed or not on PATH', ok: false };
    const cur = by.get(x.key);
    const inst = e.installer;
    if (cur) {
      cur.entries++;
      cur.by ??= inst?.by;
      cur.uninstall ??= inst?.uninstall;
      cur.about ??= inst?.about;
      cur.onDemand ||= inst?.onDemand;
    } else by.set(x.key, { ...x, by: inst?.by, uninstall: inst?.uninstall, about: inst?.about, onDemand: inst?.onDemand, entries: 1 });
  }
  return [...by.values()].sort((a, b) => b.entries - a.entries);
}

export interface HarnessUse {
  harness: string;
  entries: ItemDTO[];
  on: number;
}

/** An agent, skill or rule that relies on the server, merged across tools by name. */
export interface User {
  key: string;
  kind: 'agent' | 'skill' | 'rule';
  name: string;
  harnesses: string[];
  refs: string[];
  /** Tool names it uses or mentions; ['*'] = all of them. */
  tools: string[];
  /** Plugin or installer it came with. */
  from?: string;
  /** How it reaches the server. */
  how: string;
  /** Set when it cannot see any configuration of the server. */
  warn?: string;
}

/** One thing a package installs, merged across the tools it is installed in. */
export interface BundleItem {
  key: string;
  kind: Kind;
  name: string;
  refs: string[];
  harnesses: string[];
  description?: string;
}

/** A plugin that ships this server, merged by name across tools (the same package in Claude and Codex). */
export interface Bundle {
  key: string;
  name: string;
  by?: string;
  plugins: ItemDTO[];
  harnesses: string[];
  /** Everything else it installs, by kind. */
  contents: { kind: Kind; items: BundleItem[] }[];
}

const BUNDLE_KINDS: Kind[] = ['skill', 'agent', 'mcp', 'command', 'rule'];

const dirOf = (f: string) => f.slice(0, f.lastIndexOf('/'));
const PLUGIN_ROOT = /\$\{?(CLAUDE_PLUGIN_ROOT|PLUGIN_ROOT|extensionPath)\}?/;

/**
 * Whether a plugin actually ships this server, rather than only turning it on. Most plugins
 * that list a server just point at a program something else installed (Toolbox, Homebrew, an
 * internal installer); those belong under "turned on in", and their skills are not the server's.
 * A plugin ships the server when the program lives inside the plugin, when it is a bundle the
 * tool loads as a unit (a Kiro power), or when nothing else provides the server at all.
 */
export function shipsServer(plugin: ItemDTO, entries: ItemDTO[]): boolean {
  const own = entries.filter((e) => e.level === 'plugin' && e.owner === plugin.name && e.harness === plugin.harness);
  if (!own.length) return false;
  const root = dirOf(own[0]!.location.file);
  const inside = own.some((e) => {
    const cmd = [e.mcp?.command ?? '', ...(e.mcp?.args ?? [])].join(' ');
    const run = e.runtime?.realpath ?? e.runtime?.resolved ?? '';
    return PLUGIN_ROOT.test(cmd) || (run !== '' && run.startsWith(`${root}/`)) || !!e.onDemand;
  });
  if (inside) return true;
  // Nothing outside plugins configures or installs it: the plugins are its only source.
  return entries.every((e) => e.level === 'plugin' && !e.installer?.by) && own.every((e) => !e.installer?.by || e.installer.onDemand);
}

export function bundlesOf(whole: ServerWhole): Bundle[] {
  type Acc = Bundle & { all: Map<string, BundleItem> };
  const by = new Map<string, Acc>();
  for (const { plugin, brings } of whole.packages) {
    if (!shipsServer(plugin, whole.entries)) continue;
    const b: Acc = by.get(plugin.name) ?? {
      key: plugin.name,
      name: plugin.name.split('@')[0]!,
      by: plugin.installedBy,
      plugins: [],
      harnesses: [],
      contents: [],
      all: new Map(),
    };
    b.plugins.push(plugin);
    if (!b.harnesses.includes(plugin.harness)) b.harnesses.push(plugin.harness);
    for (const i of brings) {
      const key = `${i.kind}:${i.name}`;
      const x = b.all.get(key) ?? { key, kind: i.kind, name: i.name, refs: [], harnesses: [], description: i.description };
      x.refs.push(i.ref);
      if (!x.harnesses.includes(i.harness)) x.harnesses.push(i.harness);
      b.all.set(key, x);
    }
    by.set(plugin.name, b);
  }
  return [...by.values()].map(({ all, ...b }) => ({
    ...b,
    harnesses: b.harnesses.sort(byHarness),
    contents: BUNDLE_KINDS.map((kind) => ({
      kind,
      items: [...all.values()].filter((i) => i.kind === kind).sort((x, y) => x.name.localeCompare(y.name)),
    })).filter((c) => c.items.length),
  }));
}

export interface ServerMap {
  name: string;
  description?: string;
  whole: ServerWhole;
  programs: Program[];
  harnesses: HarnessUse[];
  bundles: Bundle[];
  /** `use`: how many agents call each tool (directly or through "all tools"). */
  tools: { names: string[]; measured: boolean; tokens?: number; refs: string[]; use: Record<string, number> };
  users: User[];
}

const ORDER = ['claude', 'codex', 'kiro', 'opencode', 'agents'];
const byHarness = (a: string, b: string) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b);

export function serverMap(name: string, state: StateDTO): ServerMap {
  const whole = serverWhole(name, state);
  const entries = whole.entries;
  const items = new Map(state.items.map((i) => [i.ref, i]));

  const harnesses = [...new Set(entries.map((e) => e.harness))].sort(byHarness).map((harness) => {
    const list = entries.filter((e) => e.harness === harness);
    return { harness, entries: list, on: list.filter((e) => e.enabled && !e.parked).length };
  });
  const liveIn = new Set(harnesses.filter((h) => h.on > 0).map((h) => h.harness));

  const measured = entries.find((e) => e.tools)?.tools;
  const refs = state.references.filter((r) => r.server === name);
  const seen = [...new Set(refs.flatMap((r) => r.tools).filter((t) => t !== '*'))].sort();

  const users = new Map<string, User>();
  const add = (kind: User['kind'], ref: string, harness: string, tools: string[], how: string, warn?: string) => {
    const item = items.get(ref);
    const n = item?.name ?? refName(ref);
    const key = `${kind}:${n}`;
    const u = users.get(key) ?? { key, kind, name: n, harnesses: [], refs: [], tools: [], how, from: item?.owner ?? item?.installedBy };
    if (!u.harnesses.includes(harness)) u.harnesses.push(harness);
    u.refs.push(ref);
    u.tools = [...new Set([...u.tools, ...tools])];
    u.warn ??= warn;
    users.set(key, u);
  };
  for (const r of refs) {
    const sees = r.ownEntry || (r.includesGlobal !== false && liveIn.has(r.harness));
    add(
      'agent',
      r.by,
      r.harness,
      r.tools,
      r.ownEntry ? 'carries its own configuration' : 'uses the shared configuration',
      sees ? undefined : (r.hint ?? 'cannot see a configuration that is on'),
    );
  }
  for (const m of state.mentions.filter((x) => x.server === name)) {
    const kind = items.get(m.by)?.kind === 'rule' ? 'rule' : 'skill';
    add(
      kind,
      m.by,
      m.harness,
      m.tools,
      'mentions it in its instructions',
      liveIn.has(m.harness) ? undefined : 'not turned on in this tool',
    );
  }

  return {
    name,
    description: entries.find((e) => e.description)?.description,
    whole,
    programs: programsOf(entries.filter((e) => e.role !== 'bundled' || !entries.some((o) => o.role !== 'bundled'))),
    harnesses,
    bundles: bundlesOf(whole),
    tools: {
      use: Object.fromEntries(
        (measured?.names ?? seen).map((t) => [
          t,
          new Set(refs.filter((r) => r.tools.includes(t) || r.tools.includes('*')).map((r) => r.by)).size,
        ]),
      ),
      names: measured?.names ?? seen,
      measured: !!measured,
      tokens: measured?.tokens,
      refs: entries.filter((e) => e.mcp && e.role !== 'policy').map((e) => e.ref),
    },
    users: [...users.values()].sort(
      (a, b) => a.kind.localeCompare(b.kind) || byHarness(a.harnesses[0]!, b.harnesses[0]!) || a.name.localeCompare(b.name),
    ),
  };
}

export interface Edge {
  from: string;
  to: string;
  /** The target sits to the left of the source (a package and what it installs). */
  leftward?: boolean;
  /** Edges inside one tool's path; traversal from a node of that tool follows only these. */
  harness?: string;
}

/**
 * Nodes on the path through `start`: everything upstream and downstream along the edges,
 * staying within the start node's tools when it belongs to some (a Claude plugin lights up
 * Claude's side of the graph, not Kiro's).
 */
export function pathThrough(start: string, edges: Edge[], harnesses: string[] = []): Set<string> {
  const allowed = (e: Edge) => !harnesses.length || !e.harness || harnesses.includes(e.harness);
  const out = new Set([start]);
  for (const dir of ['down', 'up'] as const) {
    const queue = [start];
    while (queue.length) {
      const n = queue.shift()!;
      for (const e of edges) {
        if (!allowed(e)) continue;
        const [a, b] = dir === 'down' ? [e.from, e.to] : [e.to, e.from];
        if (a === n && !out.has(b)) {
          out.add(b);
          queue.push(b);
        }
      }
    }
  }
  return out;
}
