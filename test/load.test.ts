import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { toolLoads } from '../src/core/load.js';
import { jsonSet } from '../src/io/jsonEdit.js';
import { inv, makeHome, read } from './fixture.js';

let h: ReturnType<typeof makeHome>;
beforeEach(() => {
  h = makeHome();
});

const load = async (harness: string) => toolLoads(await inv(h.ctx)).find((t) => t.harness === harness)!;

describe('what each tool loads', () => {
  it('counts what Claude starts here, grouped by the switch that controls it', async () => {
    const t = await load('claude');
    // notes-mcp (yours) + local-only (yours, this project) + proj-mcp (repo) + search-mcp (plugin)
    expect(t.loaded.mcp).toBe(4);
    expect(t.sources.map((s) => s.id)).toEqual(['you', 'local', 'project', 'plugin:kit@acme-market']);
    const plugin = t.sources.find((s) => s.kind === 'plugin')!;
    expect(plugin.plugin?.name).toBe('kit@acme-market');
    expect(plugin.items.map((i) => i.name).sort()).toEqual(['finder', 'search-mcp']);
    expect(t.contextTokens).toBeGreaterThan(0);
  });

  it('drops everything a plugin brings when the plugin is off', async () => {
    const f = join(h.home, '.claude/settings.json');
    writeFileSync(f, jsonSet(read(f), ['enabledPlugins', 'kit@acme-market'], false));
    const t = await load('claude');
    expect(t.loaded.mcp).toBe(3);
    expect(t.loaded.agent).toBe(1); // helper only; finder came with the plugin
  });

  it('reports servers started more than once', async () => {
    const kit2 = join(h.home, '.claude/plugins/cache/acme-market/kit2/1.0.0');
    mkdirSync(kit2, { recursive: true });
    writeFileSync(join(kit2, '.mcp.json'), JSON.stringify({ mcpServers: { 'search-mcp': { command: 'search-mcp' } } }));
    const f = join(h.home, '.claude/plugins/installed_plugins.json');
    writeFileSync(f, jsonSet(read(f), ['plugins', 'kit2@acme-market'], [{ scope: 'user', installPath: kit2 }]));
    expect((await load('claude')).duplicates).toEqual([{ name: 'search-mcp', count: 2 }]);
  });

  it('treats Kiro agents as modes: listed with their own servers, not loaded together', async () => {
    const t = await load('kiro');
    expect(t.agentsAre).toBe('modes');
    expect(t.loaded.agent).toBeUndefined();
    expect(t.loaded.mcp).toBe(2); // acme-tools + notes-mcp from your settings; the agent's own copy is separate
    expect(t.agents.map((a) => [a.item.name, a.servers.length])).toEqual([['reviewer', 1]]);
  });

  it('does not count the shared skill store as a tool', async () => {
    expect(toolLoads(await inv(h.ctx)).map((t) => t.harness)).not.toContain('agents');
  });
});
