/**
 * Catalogs: places you can discover and install MCP servers, skills, plugins and packages from.
 *
 * A source is read-only. It lists entries and says how each one installs: either by a command
 * its own installer runs (shown to you exactly, run only after you confirm) or by a
 * configuration whatsloaded writes itself through the changeset engine (diff first, undoable).
 */
import type { Ctx } from '../core/context.js';

import { type CatalogEntry, type CatalogKind, TRUST_ORDER } from './wire.js';

export type { CatalogEntry, CatalogKind, InstallMethod, Trust } from './wire.js';
export { CATALOG_KINDS, TRUST_ORDER } from './wire.js';

export interface CatalogQuery {
  text?: string;
  kind?: CatalogKind;
  cursor?: string;
  limit?: number;
}

export interface CatalogPage {
  entries: CatalogEntry[];
  /** Why nothing is listed yet, e.g. "type at least 3 letters". */
  note?: string;
  /** Pass back to get the next page; absent at the end. */
  next?: string;
  total?: number;
}

export interface CatalogSource {
  id: string;
  label: string;
  /** One line on what it is, for the source picker. */
  description: string;
  kinds: CatalogKind[];
  /** local: files already on this machine. network: fetched from a URL. command: runs a program. */
  access: 'local' | 'network' | 'command';
  /** Shown before the first network or command read. */
  url?: string;
  /** Is it available on this machine (e.g. the tool it belongs to is installed)? */
  detect(ctx: Ctx): boolean;
  search(ctx: Ctx, q: CatalogQuery, signal?: AbortSignal): Promise<CatalogPage>;
  /** Look one entry up directly (faster and exact for network sources). */
  get?(ctx: Ctx, id: string): Promise<CatalogEntry | undefined>;
}

export const entryId = (source: string, kind: CatalogKind, name: string) => `${source}:${kind}:${name}`;

/** Simple case-insensitive match over name, description and publisher, for local catalogs. */
export function matches(e: Pick<CatalogEntry, 'name' | 'description' | 'publisher'>, text?: string): boolean {
  const t = text?.trim().toLowerCase();
  if (!t) return true;
  return t.split(/\s+/).every((w) => `${e.name} ${e.description ?? ''} ${e.publisher ?? ''}`.toLowerCase().includes(w));
}

/** Best match first: exact name, then prefix, then the rest by trust and name. */
export function rank(entries: CatalogEntry[], text?: string): CatalogEntry[] {
  const t = text?.trim().toLowerCase() ?? '';
  const score = (e: CatalogEntry) => {
    const n = e.name.toLowerCase();
    return n === t ? 0 : t && n.startsWith(t) ? 1 : t && n.includes(t) ? 2 : 3;
  };
  return [...entries].sort(
    (a, b) => score(a) - score(b) || TRUST_ORDER.indexOf(a.trust) - TRUST_ORDER.indexOf(b.trust) || a.name.localeCompare(b.name),
  );
}

/** Pages a fully loaded list. Cursors are offsets. */
export function page(all: CatalogEntry[], q: CatalogQuery): CatalogPage {
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 500);
  const start = q.cursor ? Math.max(0, Number.parseInt(q.cursor, 10) || 0) : 0;
  const entries = all.slice(start, start + limit);
  return { entries, total: all.length, next: start + limit < all.length ? String(start + limit) : undefined };
}

export const httpUrl = (u: unknown): string | undefined => (typeof u === 'string' && /^https?:\/\/[^\s]+$/i.test(u) ? u : undefined);
