import type { HarnessAdapter } from '../adapters/types.js';
import { loadExtensions, makeHelpers } from '../extensions/loader.js';
import type { Provider, ProviderClaim, ProviderHelpers } from '../extensions/provider.js';
import { type Config, loadConfig } from './config.js';
import type { Ctx } from './context.js';
import { findMentions } from './mentions.js';
import type { Item, Kind, Level, Mention, Package, Problem, Reference } from './model.js';
import { KINDS, ref, roleOf } from './model.js';
import { detectInstaller } from './runtime/installer.js';
import { makeResolver } from './runtime/resolve.js';
import { cachedMeasure } from './tools/measure.js';

export interface Inventory {
  ctx: Ctx;
  config: Config;
  adapters: HarnessAdapter[];
  /** Adapters whose harness is present on this machine. */
  active: HarnessAdapter[];
  /** Providers that loaded and detected their subject. */
  providers: Provider[];
  helpers: ProviderHelpers;
  items: Item[];
  /** Agents' references to MCP servers they use (usage, not configuration). */
  references: Reference[];
  /** Skills and instruction files that name an MCP server in their text. */
  mentions: Mention[];
  /** Installer packages (from providers) and the items each one installed. */
  packages: Package[];
  /** Usage window and which harnesses reported usage (only when collected with `usage`). */
  usage?: { days: number; since: number; tracked: { harness: string; sessions: number }[] };
  problems: Problem[];
}

const LEVEL_ORDER: Level[] = ['managed', 'local', 'project', 'user', 'agent', 'plugin', 'store'];

export function sortItems(items: Item[]): Item[] {
  return [...items].sort(
    (a, b) =>
      KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) ||
      a.name.localeCompare(b.name) ||
      a.scope.harness.localeCompare(b.scope.harness) ||
      LEVEL_ORDER.indexOf(a.scope.level) - LEVEL_ORDER.indexOf(b.scope.level) ||
      (a.scope.owner ?? '').localeCompare(b.scope.owner ?? ''),
  );
}

/** Let providers annotate items with what only they know. First claim wins; a throwing provider is reported, not fatal. */
function applyClaims(items: Item[], providers: Provider[], h: ProviderHelpers, problems: Problem[]): void {
  const withClaim = providers.filter((p) => p.claim);
  if (!withClaim.length) return;
  const failed = new Set<string>();
  for (const item of items) {
    for (const p of withClaim) {
      if (failed.has(p.id)) continue;
      let claim: ProviderClaim | undefined;
      try {
        claim = p.claim!(item, h);
      } catch (e) {
        failed.add(p.id);
        problems.push({ severity: 'error', code: 'provider-crash', message: `${p.id}: ${(e as Error).message}` });
        continue;
      }
      if (!claim) continue;
      item.provenance = {
        channel: item.provenance?.channel ?? 'external',
        evidence: item.provenance?.evidence ?? [],
        ...item.provenance,
        by: claim.by,
        source: claim.source ?? item.provenance?.source,
        installedAt: claim.installedAt ?? item.provenance?.installedAt,
        owner: { provider: p.id, label: claim.by, enforces: !!claim.enforces, note: claim.note },
      };
      if (claim.enforces && !item.managedBy) item.managedBy = claim.by;
      if (claim.description !== undefined) item.description = claim.description;
      break;
    }
  }
  // Items embedded in an agent definition (e.g. a Kiro agent's own MCP servers) inherit the
  // agent's owner unless they were claimed directly.
  const agentByFile = new Map(items.filter((i) => i.kind === 'agent' && i.provenance?.owner).map((i) => [i.location.file, i]));
  for (const item of items) {
    if (item.kind === 'agent' || item.provenance?.owner || item.scope.level !== 'agent') continue;
    const agent = agentByFile.get(item.location.file);
    if (!agent) continue;
    item.provenance = { ...agent.provenance!, evidence: [...agent.provenance!.evidence] };
    if (agent.managedBy && !item.managedBy) item.managedBy = agent.managedBy;
  }
}

function providerInstaller(
  providers: Provider[],
  h: ProviderHelpers,
  i: Item,
  problems: Problem[],
): ReturnType<NonNullable<Provider['installer']>> {
  for (const p of providers) {
    if (!p.installer) continue;
    try {
      const r = p.installer(i, h);
      if (r) return r;
    } catch (e) {
      problems.push({ severity: 'error', code: 'provider-crash', message: `${p.id}: ${(e as Error).message}` });
    }
  }
  return undefined;
}

/** Ask providers which packages they installed, and tag each item with the package that contains it. */
function collectPackages(items: Item[], providers: Provider[], h: ProviderHelpers, problems: Problem[]): Package[] {
  const out: Package[] = [];
  for (const p of providers) {
    if (!p.packages) continue;
    try {
      for (const { contains, ...pkg } of p.packages(h)) {
        const id = `${p.id}:${pkg.id}`;
        const members: string[] = [];
        for (const i of items) {
          if (!contains(i)) continue;
          members.push(ref(i));
          i.package ??= id;
        }
        out.push({ ...pkg, id, by: p.label, members });
      }
    } catch (e) {
      problems.push({ severity: 'error', code: 'provider-crash', message: `${p.id}: ${(e as Error).message}` });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export interface Preloaded {
  adapters?: HarnessAdapter[];
  providers?: Provider[];
}

export interface CollectOptions {
  /** Also read what was actually used in the last N days (reads harness session records). */
  usageDays?: number;
}

export async function collect(ctx: Ctx, preloaded?: Preloaded, opts: CollectOptions = {}): Promise<Inventory> {
  const ext = preloaded?.adapters
    ? { adapters: preloaded.adapters, providers: preloaded.providers ?? [], problems: [] }
    : await loadExtensions(ctx);
  const { config, problems: configProblems } = loadConfig(ctx);
  const problems: Problem[] = [...ext.problems, ...configProblems];
  const helpers = makeHelpers(ctx);
  const items: Item[] = [];
  const references: Reference[] = [];
  const active: HarnessAdapter[] = [];
  for (const a of ext.adapters) {
    try {
      if (!a.detect(ctx)) continue;
      active.push(a);
      const d = a.discover(ctx);
      items.push(...d.items);
      problems.push(...d.problems);
      references.push(...(d.references ?? []));
    } catch (e) {
      problems.push({ severity: 'error', code: 'adapter-crash', message: `${a.id}: ${(e as Error).message}` });
    }
  }
  const providers = ext.providers.filter((p) => {
    try {
      return p.detect ? p.detect(helpers) : true;
    } catch (e) {
      problems.push({ severity: 'error', code: 'provider-crash', message: `${p.id}: ${(e as Error).message}` });
      return false;
    }
  });
  applyClaims(items, providers, helpers, problems);
  // A skill linked to another (e.g. ~/.claude/skills/x -> ~/.agents/skills/x) was installed by
  // whoever installed the target.
  const byPath = new Map(items.filter((i) => i.provenance).map((i) => [i.location.file, i]));
  for (const i of items) {
    if (i.provenance || !i.link) continue;
    const target = byPath.get(i.link.target);
    if (target?.provenance) i.provenance = { ...target.provenance, evidence: [...target.provenance.evidence] };
  }
  const resolve = makeResolver(ctx.env.PATH, ctx.env.PATHEXT);
  for (const i of items) {
    i.role ??= roleOf(i.scope.level);
    if (i.kind === 'mcp' && i.mcp?.transport === 'stdio' && i.mcp.command) i.runtime = resolve(i.mcp.command);
    if (i.kind === 'mcp') {
      i.tools = cachedMeasure(ctx, i);
      const fromProvider = providerInstaller(providers, helpers, i, problems);
      if (fromProvider?.description && !i.description) i.description = fromProvider.description;
      i.installer = fromProvider
        ? { by: fromProvider.by, uninstall: fromProvider.uninstall, about: fromProvider.about }
        : detectInstaller(i);
    }
  }
  let usage: Inventory['usage'];
  if (opts.usageDays) {
    const since = Date.now() - opts.usageDays * 86_400_000;
    const tracked: { harness: string; sessions: number }[] = [];
    for (const a of active) {
      if (!a.usage) continue;
      try {
        const r = a.usage(
          ctx,
          items.filter((i) => i.scope.harness === a.id),
          since,
        );
        tracked.push({ harness: a.id, sessions: r.sessions });
        for (const i of items) {
          if (i.scope.harness === a.id) i.usage = r.byRef[ref(i)] ?? { count: 0 };
        }
      } catch (e) {
        problems.push({ severity: 'warn', code: 'usage-unreadable', message: `${a.id}: could not read usage (${(e as Error).message})` });
      }
    }
    usage = { days: opts.usageDays, since, tracked };
  }
  const mentions = findMentions(items, references);
  const packages = collectPackages(items, providers, helpers, problems);
  return {
    ctx,
    config,
    adapters: ext.adapters,
    active,
    providers,
    helpers,
    items: sortItems(items),
    references,
    mentions,
    packages,
    usage,
    problems,
  };
}

export function adapterFor(inv: Inventory, harness: string): HarnessAdapter {
  const a = inv.adapters.find((x) => x.id === harness);
  if (!a) throw new Error(`unknown harness "${harness}" (known: ${inv.adapters.map((x) => x.id).join(', ')})`);
  return a;
}

export function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return m;
}

export const byKind = (items: Item[], kind?: Kind) => (kind ? items.filter((i) => i.kind === kind) : items);
