import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { scanTranscript } from '../src/adapters/claudeUsage.js';
import { collect } from '../src/core/inventory.js';
import { toolLoads } from '../src/core/load.js';
import { ref } from '../src/core/model.js';
import { startServer, type UiServer } from '../src/server/http.js';
import { makeHome, read } from './fixture.js';

const now = new Date().toISOString();
const toolUse = (name: string, input: object = {}) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: now,
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name, input }] },
  });

function writeTranscript(home: string, name: string, lines: string[], ageDays = 0): string {
  const dir = join(home, '.claude/projects/-work-proj');
  mkdirSync(dir, { recursive: true });
  const f = join(dir, name);
  writeFileSync(f, `${lines.join('\n')}\n`);
  if (ageDays) {
    const t = Date.now() / 1000 - ageDays * 86_400;
    utimesSync(f, t, t);
  }
  return f;
}

let h: ReturnType<typeof makeHome>;
beforeEach(() => {
  h = makeHome();
  writeTranscript(h.home, 'recent.jsonl', [
    JSON.stringify({ type: 'user', timestamp: now, message: { role: 'user', content: 'my password is hunter2, mention "tool_use" here' } }),
    toolUse('mcp__notes-mcp__search', { q: 'secret-query' }),
    toolUse('mcp__notes-mcp__search'),
    toolUse('mcp__plugin_kit_search-mcp__find'),
    toolUse('Skill', { skill: 'architect' }),
    toolUse('Agent', { subagent_type: 'kit:finder', prompt: 'do things' }),
  ]);
  writeTranscript(h.home, 'old.jsonl', [toolUse('mcp__local-only__x')], 90);
});

const usage = async () => collect(h.ctx, undefined, { usageDays: 30 });
const of = async (r: string) => (await usage()).items.find((i) => ref(i) === r)?.usage;

describe('usage from Claude transcripts', () => {
  it('reads tool names only', () => {
    const u = scanTranscript(toolUse('mcp__a__b'));
    expect(Object.keys(u.mcp)).toEqual(['a']);
  });

  it('attributes calls to the configuration that serves them', async () => {
    expect(await of('claude:user/mcp/notes-mcp')).toMatchObject({ count: 2 });
    expect(await of('claude:plugin@kit@acme-market/mcp/search-mcp')).toMatchObject({ count: 1 });
    expect(await of('claude:user/skill/architect')).toMatchObject({ count: 1 });
    expect(await of('claude:plugin@kit@acme-market/agent/finder')).toMatchObject({ count: 1 });
    expect(await of('claude:user/skill/local-skill')).toEqual({ count: 0 });
  });

  it('ignores sessions outside the window', async () => {
    expect(await of('claude:local/mcp/local-only')).toEqual({ count: 0 });
    expect((await usage()).usage?.tracked).toEqual([{ harness: 'claude', sessions: 1 }]);
  });

  it('never stores conversation content in its cache', async () => {
    await usage();
    const cache = read(join(h.home, '.whatsloaded/cache/claude-usage.json'));
    expect(cache).toContain('notes-mcp');
    expect(cache).not.toContain('hunter2');
    expect(cache).not.toContain('secret-query');
    expect(cache).not.toContain('do things');
  });

  it('marks tools without usage records as untracked', async () => {
    const kiro = (await usage()).items.find((i) => ref(i) === 'kiro:user/mcp/notes-mcp');
    expect(kiro?.usage).toBeUndefined();
  });
});

describe('trim: what you have not used', () => {
  it('suggests your unused items and leaves used ones and rules alone', async () => {
    const t = toolLoads(await usage()).find((x) => x.harness === 'claude')!;
    expect(t.tracked).toBe(true);
    expect(t.used.mcp).toBe(2); // notes-mcp + search-mcp
    expect(t.trim.plugins).toEqual([]); // kit was used
    expect(t.trim.items.map(ref).sort()).toEqual([
      'claude:local/mcp/local-only',
      'claude:user/agent/helper',
      'claude:user/skill/local-skill',
    ]);
  });

  it('suggests a whole plugin when nothing it brings was used', async () => {
    writeTranscript(h.home, 'recent.jsonl', [toolUse('mcp__notes-mcp__search')]);
    const t = toolLoads(await usage()).find((x) => x.harness === 'claude')!;
    expect(t.trim.plugins.map((p) => p.name)).toEqual(['kit@acme-market']);
    expect(t.trim.servers).toBeGreaterThanOrEqual(1);
  });
});

describe('adding a server from the web UI', () => {
  let s: UiServer;
  beforeAll(async () => {
    s = await startServer(makeHome().ctx, { port: 0, webRoot: '/nonexistent' });
  });
  afterAll(() => s.server.close());
  const plan = (body: object) =>
    fetch(`${s.url}/api/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: s.url },
      body: JSON.stringify(body),
    });

  it('plans a validated server into the chosen tools', async () => {
    const res = await plan({
      action: 'add',
      refs: [],
      name: 'github',
      spec: { transport: 'stdio', command: 'npx', args: ['-y', 'gh-mcp'] },
      targets: ['kiro:user', 'codex:user'],
    });
    const p = await res.json();
    expect(res.status).toBe(200);
    expect(p.applicable).toBe(true);
    expect(p.changes).toHaveLength(2);
  });

  it.each([
    [{ name: 'bad name!', spec: { transport: 'stdio', command: 'x' } }, /name must be/],
    [{ name: 'x', spec: { transport: 'http', url: 'ftp://nope' } }, /valid http/],
    [{ name: 'x', spec: { transport: 'stdio', command: '' } }, /command is required/],
    [{ name: 'x', spec: { transport: 'stdio', command: 'x', env: { A: 1 } } }, /must be strings/],
  ])('rejects invalid input %#', async (body, msg) => {
    const res = await plan({ action: 'add', refs: [], targets: ['kiro:user'], ...body });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(msg);
  });
});
