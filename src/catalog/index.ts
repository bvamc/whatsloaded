/**
 * All catalog sources, searched together, with each entry marked by what this machine already has.
 */
import type { Ctx } from '../core/context.js';
import type { Inventory } from '../core/inventory.js';
import { claudeMarketplacesSource, codexMarketplacesSource } from './marketplaces.js';
import { githubMcpRegistry, officialMcpRegistry } from './mcpRegistry.js';
import { skillsShSource } from './skillsSh.js';
import type { CatalogEntry, CatalogKind, CatalogPage, CatalogQuery, CatalogSource } from './types.js';

export * from './types.js';

export const BUILTIN_SOURCES: CatalogSource[] = [
  claudeMarketplacesSource,
  codexMarketplacesSource,
  githubMcpRegistry,
  skillsShSource,
  officialMcpRegistry,
];

export function availableSources(ctx: Ctx, extra: CatalogSource[] = []): CatalogSource[] {
  return [...BUILTIN_SOURCES, ...extra].filter((s) => {
    try {
      return s.detect(ctx);
    } catch {
      return false;
    }
  });
}

/** Which tools already have an entry, judged from the tools' own files (not the installer's records). */
export function installedIn(inv: Inventory, e: Pick<CatalogEntry, 'kind' | 'name' | 'installName'>): string[] {
  if (e.kind === 'package') {
    const pkg = inv.packages.find((p) => p.name === e.name || p.name === e.installName);
    return pkg ? [...new Set(pkg.members.map((r) => r.split(':')[0]!))] : [];
  }
  const want = e.installName ?? e.name;
  const kind: CatalogKind | 'plugin' = e.kind;
  return [...new Set(inv.items.filter((i) => i.kind === kind && (i.name === want || i.name === e.name)).map((i) => i.scope.harness))];
}

export interface SourceResult {
  source: string;
  page?: CatalogPage;
  error?: string;
}

/** Search the given sources in parallel; one source failing never hides the others. */
export async function searchSources(ctx: Ctx, sources: CatalogSource[], q: CatalogQuery, signal?: AbortSignal): Promise<SourceResult[]> {
  return Promise.all(
    sources.map(async (s): Promise<SourceResult> => {
      if (q.kind && !s.kinds.includes(q.kind)) return { source: s.id, page: { entries: [], total: 0 } };
      try {
        return { source: s.id, page: await s.search(ctx, q, signal) };
      } catch (e) {
        return { source: s.id, error: (e as Error).message };
      }
    }),
  );
}

/** Find one entry again by id, from its own source (never trust an entry the browser sends back). */
export async function findEntry(ctx: Ctx, sources: CatalogSource[], id: string): Promise<CatalogEntry | undefined> {
  const [sourceId, kind, ...rest] = id.split(':');
  const name = rest.join(':');
  const source = sources.find((s) => s.id === sourceId);
  if (!source || !name) return undefined;
  if (source.get) return source.get(ctx, id);
  // Search by the bare name (before any @marketplace), then match the exact id.
  const text = name.split('@')[0];
  for (let cursor: string | undefined, n = 0; n < 20; n++) {
    const page = await source.search(ctx, { text, kind: kind as CatalogKind, cursor, limit: 200 });
    const hit = page.entries.find((e) => e.id === id);
    if (hit || !page.next) return hit;
    cursor = page.next;
  }
  return undefined;
}
