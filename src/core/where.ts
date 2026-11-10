/**
 * The three layers of one MCP server, kept separate on purpose:
 *   installed   the executable (or remote URL) that actually runs: usually one
 *   configured  config entries that tell a harness how to launch it, grouped by role
 *   used by     agents that refer to its tools (references are not configuration)
 */

import { mcpVariants } from './compare.js';
import { type CompareOptions, DEFAULT_CONFIG } from './config.js';
import type { Inventory } from './inventory.js';
import type { Item, Reference, Role } from './model.js';

export const ROLE_ORDER: Role[] = ['owned', 'bundled', 'policy', 'agent-profile'];
export const ROLE_LABEL: Record<Role, string> = {
  owned: 'yours',
  bundled: 'from plugins',
  policy: 'policy',
  'agent-profile': 'agent profiles',
};
const ROLE_ONE: Record<Role, string> = { owned: 'yours', bundled: 'from a plugin', policy: 'policy', 'agent-profile': 'agent profile' };

/**
 * Roles whose entries you maintain as "the same server", so differences between them are drift.
 * Plugin-bundled entries and agent profiles are tailored by their owner on purpose (e.g. each
 * plugin passes its own tool filter) and you cannot edit them, so they are reported, not compared.
 */
export const COMPARABLE_ROLES: ReadonlySet<Role> = new Set(['owned', 'policy']);
export const isComparable = (i: Item) => COMPARABLE_ROLES.has(i.role ?? 'owned');

export interface Install {
  /** Stable identity: the resolved executable, the URL, or the bare command when not found. */
  key: string;
  kind: 'executable' | 'remote' | 'missing' | 'unresolved';
  /** Who installed the program and how to remove it, when known. */
  by?: string;
  uninstall?: string;
  command?: string;
  resolved?: string;
  realpath?: string;
  url?: string;
  entries: number;
}

/** A plugin (or similar bundle) that ships this server, and everything else it brings along. */
export interface Package {
  plugin: Item;
  /** Items the package also brings (not this server). */
  brings: Item[];
}

export interface ServerReport {
  name: string;
  installs: Install[];
  packages: Package[];
  configs: { role: Role; items: Item[] }[];
  /** Variants among your own (and policy) entries only. */
  variants: Item[][];
  usedBy: Reference[];
  total: number;
}

export function installsOf(items: Item[]): Install[] {
  const by = new Map<string, Install>();
  for (const i of items) {
    const s = i.mcp;
    if (!s) continue;
    let inst: Omit<Install, 'entries'>;
    if (s.transport !== 'stdio') inst = { key: `url:${s.url}`, kind: 'remote', url: s.url };
    else if (i.runtime?.found)
      inst = {
        key: `exe:${i.runtime.resolved}`,
        kind: 'executable',
        command: s.command,
        resolved: i.runtime.resolved,
        realpath: i.runtime.realpath,
      };
    else if (i.runtime?.unresolved) inst = { key: `var:${s.command}`, kind: 'unresolved', command: s.command };
    else inst = { key: `missing:${s.command}`, kind: 'missing', command: s.command };
    const cur = by.get(inst.key);
    if (cur) {
      cur.entries++;
      cur.by ??= i.installer?.by;
      cur.uninstall ??= i.installer?.uninstall;
    } else by.set(inst.key, { ...inst, by: i.installer?.by, uninstall: i.installer?.uninstall, entries: 1 });
  }
  return [...by.values()].sort((a, b) => b.entries - a.entries);
}

export function serverReport(
  inv: Pick<Inventory, 'items' | 'references'> & { config?: { compare: CompareOptions } },
  name: string,
): ServerReport | undefined {
  const items = inv.items.filter((i) => i.kind === 'mcp' && i.name === name);
  if (!items.length) return undefined;
  const configs = ROLE_ORDER.map((role) => ({ role, items: items.filter((i) => (i.role ?? 'owned') === role) })).filter(
    (g) => g.items.length,
  );
  const comparable = items.filter((i) => isComparable(i) && !i.parked);
  const plugins = inv.items.filter((i) => i.kind === 'plugin');
  const packages = plugins
    .map((plugin) => {
      const contents = inv.items.filter(
        (i) => i.scope.level === 'plugin' && i.scope.owner === plugin.name && i.scope.harness === plugin.scope.harness,
      );
      return contents.some((i) => i.kind === 'mcp' && i.name === name)
        ? { plugin, brings: contents.filter((i) => !(i.kind === 'mcp' && i.name === name)) }
        : undefined;
    })
    .filter((p): p is Package => !!p);
  return {
    name,
    installs: installsOf(items),
    packages,
    configs,
    variants: comparable.length > 1 ? mcpVariants(comparable, inv.config?.compare ?? DEFAULT_CONFIG.compare) : [comparable],
    usedBy: inv.references.filter((r) => r.server === name),
    total: items.length,
  };
}

/** "1 install · 78 configurations (2 yours · 14 from plugins · 62 agent profiles) · used by 88 agents" */
export function summaryLine(r: ServerReport): string {
  const installs = r.installs.filter((x) => x.kind === 'executable' || x.kind === 'remote').length;
  const missing = r.installs.filter((x) => x.kind === 'missing').length;
  const parts = [installs ? `${installs} install${installs === 1 ? '' : 's'}` : missing ? 'not installed' : 'install unknown'];
  if (installs && missing) parts.push(`${missing} missing`);
  const roles = r.configs.map((c) => `${c.items.length} ${c.items.length === 1 ? ROLE_ONE[c.role] : ROLE_LABEL[c.role]}`).join(' · ');
  parts.push(`${r.total} configuration${r.total === 1 ? '' : 's'} (${roles})`);
  const agents = new Set(r.usedBy.map((u) => u.by)).size;
  if (agents) parts.push(`used by ${agents} agent${agents === 1 ? '' : 's'}`);
  return parts.join(' · ');
}
