import type { ItemDTO, Kind, Reference, Role } from '../api';

export interface Group {
  key: string;
  kind: Kind;
  name: string;
  copies: ItemDTO[];
  description?: string;
  variants: number;
  on: number;
  managed: number;
  harnesses: string[];
  /** Configuration count per role (yours / from plugins / agent profiles / policy). */
  roles: Partial<Record<Role, number>>;
  /** Distinct executables or remote URLs the configurations launch. */
  installs: number;
  /** Some enabled configuration launches a command that is not installed. */
  missing: boolean;
  /** Distinct agents that use this server's tools. */
  usedBy: number;
}

export interface Filters {
  harnesses: Set<string>;
  includePlugins: boolean;
  query: string;
}

export function visible(items: ItemDTO[], f: Filters): ItemDTO[] {
  const q = f.query.trim().toLowerCase();
  return items.filter(
    (i) =>
      (f.includePlugins || i.level !== 'plugin' || i.kind === 'mcp') &&
      (f.harnesses.size === 0 || f.harnesses.has(i.harness)) &&
      (!q || i.ref.toLowerCase().includes(q) || (i.description ?? '').toLowerCase().includes(q)),
  );
}

export function groupItems(items: ItemDTO[], references: Reference[] = []): Group[] {
  const by = new Map<string, ItemDTO[]>();
  for (const i of items) {
    const k = `${i.kind}/${i.name}`;
    by.set(k, [...(by.get(k) ?? []), i]);
  }
  const users = new Map<string, Set<string>>();
  for (const r of references) users.set(r.server, (users.get(r.server) ?? new Set()).add(r.by));
  return [...by].map(([key, copies]) => {
    const roles: Partial<Record<Role, number>> = {};
    for (const c of copies) roles[c.role] = (roles[c.role] ?? 0) + 1;
    const installs = new Set(
      copies.flatMap((c) =>
        c.mcp?.transport && c.mcp.transport !== 'stdio' ? [`url:${c.mcp.url}`] : c.runtime?.found ? [`exe:${c.runtime.resolved}`] : [],
      ),
    );
    const first = copies[0]!;
    return {
      key,
      kind: first.kind,
      name: first.name,
      copies,
      description: copies.find((c) => c.description)?.description,
      variants: Math.max(1, ...copies.map((c) => c.variants ?? 1)),
      on: copies.filter((c) => c.enabled).length,
      managed: copies.filter((c) => c.managedBy).length,
      harnesses: [...new Set(copies.map((c) => c.harness))],
      roles,
      installs: installs.size,
      missing: copies.some((c) => c.enabled && c.runtime && !c.runtime.found && !c.runtime.unresolved),
      usedBy: first.kind === 'mcp' ? (users.get(first.name)?.size ?? 0) : 0,
    };
  });
}

export const ROLE_SHORT: Record<Role, string> = { owned: 'yours', bundled: 'plugins', policy: 'policy', 'agent-profile': 'agent profiles' };
const ROLE_ONE: Record<Role, string> = { owned: 'yours', bundled: 'plugin', policy: 'policy', 'agent-profile': 'agent profile' };

/** "1 install · 2 yours · 14 plugins · 62 agent profiles · used by 85 agents" */
export function groupSummary(g: Group): string {
  const parts: string[] = [];
  if (g.kind === 'mcp')
    parts.push(g.installs ? `${g.installs} install${g.installs === 1 ? '' : 's'}` : g.missing ? 'not installed' : 'install unknown');
  for (const role of ['owned', 'bundled', 'policy', 'agent-profile'] as Role[]) {
    const n = g.roles[role];
    if (n) parts.push(`${n} ${n === 1 ? ROLE_ONE[role] : ROLE_SHORT[role]}`);
  }
  if (g.usedBy) parts.push(`used by ${g.usedBy} agent${g.usedBy === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/** Copies of one name in one harness, collapsed by level: e.g. kiro → [user ×1, agent ×62]. */
export function levelsIn(copies: ItemDTO[], harness: string): { level: string; n: number; on: number }[] {
  const by = new Map<string, { n: number; on: number }>();
  for (const c of copies.filter((x) => x.harness === harness)) {
    const e = by.get(c.level) ?? { n: 0, on: 0 };
    e.n++;
    if (c.enabled) e.on++;
    by.set(c.level, e);
  }
  return [...by].map(([level, e]) => ({ level, ...e }));
}
