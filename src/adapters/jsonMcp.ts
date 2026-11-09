import type { Ctx } from '../core/context.js';
import type { Discovery, Item, McpSpec, Scope } from '../core/model.js';
import type { Change } from '../io/changeset.js';
import { isRecord, readJson } from '../io/fsx.js';
import { jsonGet, jsonReplaceMinimal, jsonSet } from '../io/jsonEdit.js';
import type { McpCodec } from './codecs.js';
import { parseProblem } from './common.js';

/** Read every MCP entry under `container` (e.g. ['mcpServers']) in a JSON/JSONC file. */
export function readJsonMcps(file: string, container: string[], scope: Scope, codec: McpCodec, extra?: Partial<Item>): Discovery {
  const r = readJson(file);
  if (!r.ok) return { items: [], problems: r.missing ? [] : [parseProblem(file, r.error)] };
  let node: unknown = r.value;
  for (const k of container) node = isRecord(node) ? node[k] : undefined;
  if (!isRecord(node)) return { items: [], problems: [] };
  const items: Item[] = [];
  for (const [name, raw] of Object.entries(node)) {
    const d = codec.decode(raw);
    if (!d) continue;
    items.push({ kind: 'mcp', name, scope, enabled: d.enabled, mcp: d.spec, location: { file, path: [...container, name] }, ...extra });
  }
  return { items, problems: [] };
}

/** Upsert an MCP entry, re-encoding against whatever is in the file at apply time. */
export function putJsonMcp(file: string, path: string[], codec: McpCodec, spec: McpSpec, enabled: boolean, describe: string): Change {
  return {
    op: 'edit',
    file,
    describe,
    transform: (t) => jsonReplaceMinimal(t, path, codec.encode(spec, enabled, jsonGet(t, path))),
  };
}

/** Flip a native enabled/disabled flag by decoding and re-encoding the live entry. */
export function toggleJsonMcp(item: Item, codec: McpCodec, enabled: boolean): Change {
  const { file, path } = item.location;
  return {
    op: 'edit',
    file,
    describe: `${enabled ? 'enable' : 'disable'} ${path!.join('.')} in ${file}`,
    transform: (t) => {
      const raw = jsonGet(t, path!);
      const d = codec.decode(raw);
      if (!d) throw new Error(`${path!.join('.')} no longer exists in ${file}`);
      return jsonReplaceMinimal(t, path!, codec.encode(d.spec, enabled, raw));
    },
  };
}

export function removeJsonEntry(item: Item): Change {
  const { file, path } = item.location;
  return { op: 'edit', file, describe: `remove ${path!.join('.')} from ${file}`, transform: (t) => jsonSet(t, path!, undefined) };
}

export type { Ctx };

/**
 * MCP servers bundled in a plugin's `.mcp.json` (Claude and Codex plugins share the format:
 * either `{ "mcpServers": {...} }` or a bare name → server map). They inherit the plugin's
 * enabled state and are owned by the plugin.
 */
export function readPluginMcps(pluginDir: string, scope: Scope, pluginId: string, enabled: boolean, codec: McpCodec): Discovery {
  const file = `${pluginDir}/.mcp.json`;
  const r = readJson(file);
  if (!r.ok || !isRecord(r.value)) return { items: [], problems: r.ok || r.missing ? [] : [parseProblem(file, r.error)] };
  const container = isRecord(r.value.mcpServers) ? ['mcpServers'] : [];
  const d = readJsonMcps(file, container, scope, codec, { managedBy: `plugin:${pluginId}` });
  for (const i of d.items) i.enabled = enabled;
  return d;
}
