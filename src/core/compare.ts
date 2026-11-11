import { isDeepStrictEqual } from 'node:util';
import { type CompareOptions, DEFAULT_CONFIG } from './config.js';
import type { Item, McpSpec } from './model.js';

export type Drift = 'identical' | 'cosmetic' | 'drift';

function globRe(pattern: string): RegExp {
  return new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
}

function canonical(rec: Record<string, string> | undefined, ignore: RegExp[] = []): [string, string][] {
  return Object.entries(rec ?? {})
    .filter(([k]) => !ignore.some((re) => re.test(k)))
    .sort(([a], [b]) => a.localeCompare(b));
}

/** The parts of a spec that decide which process runs and what it can reach. */
function behaviour(s: McpSpec, ignoreEnv: RegExp[]) {
  return {
    transport: s.transport,
    command: s.command ?? null,
    args: s.args ?? [],
    url: s.url ?? null,
    env: canonical(s.env, ignoreEnv),
    headers: canonical(s.headers),
  };
}

/**
 * Classify how two definitions of the same-named MCP server differ.
 *
 *   identical  byte-for-byte the same spec
 *   cosmetic   same process, same reach: differs only in representation (missing vs empty
 *              args/env, env key order), in per-harness tool filtering (disabledTools), or in
 *              env vars the user marked as harness-specific via `compare.ignoreEnvKeys`
 *   drift      different command, args, url, env or headers: the copies behave differently,
 *              so doctor warns and `sync` will rewrite them
 */
export function compareMcp(a: McpSpec, b: McpSpec, opts: CompareOptions = DEFAULT_CONFIG.compare): Drift {
  if (isDeepStrictEqual(a, b)) return 'identical';
  const ignore = opts.ignoreEnvKeys.map(globRe);
  return isDeepStrictEqual(behaviour(a, ignore), behaviour(b, ignore)) ? 'cosmetic' : 'drift';
}

/** Group same-named MCP entries into variants: entries that compare non-drifting share a variant. Most common first. */
export function mcpVariants(entries: Item[], opts: CompareOptions = DEFAULT_CONFIG.compare): Item[][] {
  const variants: Item[][] = [];
  for (const c of entries) {
    const v = variants.find((g) => compareMcp(g[0]!.mcp!, c.mcp!, opts) !== 'drift');
    if (v) v.push(c);
    else variants.push([c]);
  }
  return variants.sort((a, b) => b.length - a.length);
}
