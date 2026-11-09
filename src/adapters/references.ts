/**
 * Parsers for how agents refer to MCP servers they use. These are references (usage), not
 * configuration: they say "this agent wants tools from server X", not how X is launched.
 */
import type { Item, Reference } from '../core/model.js';
import { ref } from '../core/model.js';
import { isRecord, readFrontmatter, readJson } from '../io/fsx.js';

/** Group `server → tools` while preserving first-seen order. */
function collect(pairs: [string, string][]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [server, tool] of pairs) {
    const tools = out.get(server) ?? [];
    if (!tools.includes(tool)) tools.push(tool);
    out.set(server, tools);
  }
  return out;
}

/**
 * Kiro agent JSON: `tools` / `allowedTools` entries like `@server` or `@server/tool`, plus the
 * agent's own `mcpServers` entries (an agent that defines a server uses it).
 */
export function kiroAgentReferences(agent: Item, knownServers: Set<string>): Reference[] {
  const r = readJson(agent.location.file);
  if (!r.ok || !isRecord(r.value)) return [];
  const a = r.value;
  const lists = [a.tools, a.allowedTools].flatMap((l) => (Array.isArray(l) ? l : []));
  const pairs: [string, string][] = [];
  for (const t of lists) {
    const m = typeof t === 'string' ? t.match(/^@([^/]+)(?:\/(.+))?$/) : null;
    // `@builtin` is how Kiro names its own built-in tools, not an MCP server.
    if (m && m[1] !== 'builtin') pairs.push([m[1]!, m[2] ?? '*']);
  }
  const own = isRecord(a.mcpServers) ? Object.keys(a.mcpServers) : [];
  for (const s of own) if (!pairs.some(([p]) => p === s)) pairs.push([s, '*']);
  const includesGlobal = typeof a.includeMcpJson === 'boolean' ? a.includeMcpJson : undefined;
  return [...collect(pairs)].map(([server, tools]) => ({
    server,
    resolved: own.includes(server) || knownServers.has(server),
    by: ref(agent),
    harness: agent.scope.harness,
    tools,
    ownEntry: own.includes(server),
    includesGlobal,
    file: agent.location.file,
  }));
}

/** Claude's tool-name prefix for a server: `mcp__<name>` with every char outside [A-Za-z0-9_-] replaced by `_`. */
export const claudeServerKey = (name: string) => name.replace(/[^A-Za-z0-9_-]/g, '_');

/** Key for a server bundled in a plugin: `plugin_<pluginName>_<server>` (plugin id without @marketplace). */
export const claudePluginServerKey = (pluginId: string, name: string) =>
  `plugin_${claudeServerKey(pluginId.split('@')[0]!)}_${claudeServerKey(name)}`;

function toolsField(fm: Record<string, unknown>): string[] {
  const t = fm.tools ?? fm['allowed-tools'];
  if (Array.isArray(t)) return t.map(String);
  if (typeof t === 'string') return t.split(/[,\s]+/).filter(Boolean);
  return [];
}

/**
 * Claude agent / command markdown: frontmatter `tools` entries like `mcp__<key>__<tool>` or
 * `mcp__<key>`. `keys` maps every known server key (see claudeServerKey) to its server name.
 */
export function claudeAgentReferences(agent: Item, keys: Map<string, string>): Reference[] {
  const fm = readFrontmatter(agent.location.file);
  const pairs: [string, string][] = [];
  for (const t of toolsField(fm)) {
    if (!t.startsWith('mcp__')) continue;
    const rest = t.slice(5);
    const sep = rest.indexOf('__');
    const key = sep < 0 ? rest : rest.slice(0, sep);
    const tool = sep < 0 ? '*' : rest.slice(sep + 2) || '*';
    pairs.push([key, tool]);
  }
  const ownPlugin = agent.scope.level === 'plugin' ? agent.scope.owner : undefined;
  return [...collect(pairs)].map(([key, tools]) => {
    // Assumption (unverified against Claude Code internals): an agent shipped in a plugin may name
    // its own plugin's servers without the plugin prefix. Treat that as resolved rather than flag it.
    const samePlugin = ownPlugin ? claudePluginServerKey(ownPlugin, key) : undefined;
    if (samePlugin && keys.has(samePlugin)) {
      return {
        server: keys.get(samePlugin)!,
        resolved: true,
        by: ref(agent),
        harness: agent.scope.harness,
        tools,
        ownEntry: false,
        includesGlobal: true,
        file: agent.location.file,
      };
    }
    const resolved = keys.has(key);
    // Tools of plugin-bundled servers are prefixed per plugin, so a bare `mcp__<server>__` name
    // only matches when the server is also configured outside plugins.
    const pluginKeys = resolved ? [] : [...keys.keys()].filter((k) => k.startsWith('plugin_') && k.endsWith(`_${key}`));
    return {
      server: keys.get(key) ?? keys.get(pluginKeys[0] ?? '') ?? key,
      resolved,
      by: ref(agent),
      harness: agent.scope.harness,
      tools,
      ownEntry: false,
      // Claude subagents see the session's MCP servers.
      includesGlobal: true,
      hint: pluginKeys.length
        ? `they name it mcp__${key}__…, while Claude registers it only through plugins as mcp__${pluginKeys[0]}__…${pluginKeys.length > 1 ? ` (and ${pluginKeys.length - 1} more)` : ''}`
        : undefined,
      file: agent.location.file,
    };
  });
}
