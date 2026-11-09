import type { Item, Kind, Level } from './model.js';
import { KINDS, LEVELS, ref, scopeLabel } from './model.js';

export interface Filters {
  harness?: string;
  level?: string;
  kind?: string;
}

function glob(pattern: string): RegExp {
  return new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
}

function applyFilters(items: Item[], f: Filters): Item[] {
  return items.filter(
    (i) =>
      (!f.harness || i.scope.harness === f.harness) &&
      (!f.level || i.scope.level === f.level || scopeLabel(i.scope) === f.level) &&
      (!f.kind || i.kind === f.kind),
  );
}

/**
 * Resolve a user query to items. Accepted forms, most specific first:
 *   claude:user/mcp/github        exact ref
 *   github | git*                 name or glob
 *   mcp/github                    kind/name
 *   kiro/github                   harness/name
 *   kiro:agent@reviewer/github    harness:scope/name (scope may include @owner)
 * Names may themselves contain ':' and '/', e.g. `npm:@playwright/mcp`.
 */
export function select(items: Item[], query: string, f: Filters = {}, harnesses: string[] = []): Item[] {
  const pool = applyFilters(items, f);
  const exact = pool.filter((i) => ref(i) === query);
  if (exact.length) return exact;

  const nameRe = glob(query);
  const byName = pool.filter((i) => nameRe.test(i.name));
  if (byName.length) return byName;

  const m = query.match(/^(?:([\w-]+)(?::([\w-]+(?:@[^/]+)?))?\/)?(?:([a-z]+)\/)?(.+)$/);
  if (!m) return [];
  const [, h, scope, kind, name] = m;
  if (h && !harnesses.includes(h) && !(KINDS as readonly string[]).includes(h)) return [];
  // `mcp/foo` parses with h='mcp': treat a kind-looking head as the kind.
  const isKindHead = h && !scope && (KINDS as readonly string[]).includes(h) && !harnesses.includes(h);
  const want = {
    harness: isKindHead ? undefined : h,
    scope,
    kind: (isKindHead ? h : kind) as Kind | undefined,
    name: glob(name!),
  };
  if (want.kind && !(KINDS as readonly string[]).includes(want.kind)) return [];
  return pool.filter(
    (i) =>
      (!want.harness || i.scope.harness === want.harness) &&
      (!want.scope || scopeLabel(i.scope) === want.scope || i.scope.level === want.scope) &&
      (!want.kind || i.kind === want.kind) &&
      want.name.test(i.name),
  );
}

export interface Target {
  harness: string;
  level: Level;
}

/** Parse `kiro`, `kiro:user`, `claude:project` into write targets. */
export function parseTarget(s: string): Target {
  const [harness, level = 'user'] = s.split(':');
  if (!harness) throw new Error(`invalid target "${s}"`);
  if (!(LEVELS as readonly string[]).includes(level))
    throw new Error(`invalid scope "${level}" in "${s}" (use one of: ${LEVELS.join(', ')})`);
  return { harness, level: level as Level };
}
