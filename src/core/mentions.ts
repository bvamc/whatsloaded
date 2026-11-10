/**
 * Skills and instruction files that name an MCP server in their text. A skill that says
 * "use docs-mcp's SearchDocs tool" relies on that server even though nothing configures the link,
 * so removing the server quietly breaks it.
 *
 * Matching is deliberately strict to avoid noise from common words:
 * - `mcp__<server>__<tool>` (the tool prefix Claude uses) always counts (`@<server>/` is not used:
 *   in prose it is usually an npm scope such as `@playwright/cli`);
 * - the bare name counts when it contains "mcp", or is followed by "MCP" (e.g. "playwright MCP").
 * Tool names are reported only alongside a server match.
 */
import { join } from 'node:path';
import { readText } from '../io/fsx.js';
import type { Item, Mention, Reference } from './model.js';
import { ref } from './model.js';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function textOf(i: Item): string | null {
  if (i.kind === 'skill') return readText(join(i.location.file, 'SKILL.md'));
  if (i.kind === 'rule') return readText(i.location.file);
  return null;
}

interface Matcher {
  server: string;
  hit: RegExp;
  tools: { name: string; re: RegExp }[];
}

function matcher(server: string, toolNames: Set<string>): Matcher {
  const n = esc(server);
  const word = `(?<![\\w-])${n}(?![\\w-])`;
  const parts = [`mcp__${n}__`, /mcp/i.test(server) ? word : `${word}[ -]?(?:MCP|mcp)\\b`];
  return {
    server,
    hit: new RegExp(parts.join('|')),
    // Short or all-lowercase tool names ("read", "search") are too common to report.
    tools: [...toolNames]
      .filter((t) => t.length >= 6 && /[A-Z_]/.test(t.slice(1)))
      .map((t) => ({ name: t, re: new RegExp(`(?<![\\w-])${esc(t)}(?![\\w-])`) })),
  };
}

export function findMentions(items: Item[], references: Reference[]): Mention[] {
  const tools = new Map<string, Set<string>>();
  for (const i of items) {
    if (i.kind !== 'mcp') continue;
    const set = tools.get(i.name) ?? new Set<string>();
    for (const t of i.tools?.names ?? []) set.add(t);
    tools.set(i.name, set);
  }
  for (const r of references) for (const t of r.tools) if (t !== '*') tools.get(r.server)?.add(t);
  if (!tools.size) return [];
  const matchers = [...tools].map(([s, t]) => matcher(s, t));

  const out: Mention[] = [];
  for (const i of items) {
    if (i.kind !== 'skill' && i.kind !== 'rule') continue;
    const text = textOf(i);
    if (!text) continue;
    for (const m of matchers) {
      if (!m.hit.test(text)) continue;
      out.push({
        server: m.server,
        by: ref(i),
        harness: i.scope.harness,
        tools: m.tools.filter((t) => t.re.test(text)).map((t) => t.name),
      });
    }
  }
  return out;
}
