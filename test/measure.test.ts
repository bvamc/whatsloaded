import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Item } from '../src/core/model.js';
import { cachedMeasure, describeLaunch, measure } from '../src/core/tools/measure.js';
import { makeHome } from './fixture.js';

const server = (name: string) => fileURLToPath(new URL(`./fixtures/servers/${name}`, import.meta.url));
const item = (args: string[], env?: Record<string, string>): Item => ({
  kind: 'mcp',
  name: 'notes',
  scope: { harness: 'kiro', level: 'user' },
  enabled: true,
  location: { file: '/x' },
  mcp: { transport: 'stdio', command: process.execPath, args, env },
  runtime: { command: process.execPath, found: true, resolved: process.execPath },
});

describe('measuring tool definitions', () => {
  it('lists every tool across pages and caches names and sizes only', async () => {
    const h = makeHome();
    const i = item([server('tools-server.mjs')], { API_TOKEN: 's3cret-value' });
    const r = await measure(i, h.ctx);
    expect(r).toMatchObject({ ok: true, measure: { count: 2, names: ['search', 'write'] } });
    expect(r.ok && r.measure.tokens).toBeGreaterThan(10);
    expect(cachedMeasure(h.ctx, i)?.count).toBe(2);
    const dir = join(h.home, '.whatsloaded/cache/tools');
    const cached = readFileSync(join(dir, readdirSync(dir)[0]!), 'utf8');
    expect(cached).not.toContain('s3cret-value');
    expect(cached).not.toContain('Search notes');
  });

  it('times out and kills a server that never answers', async () => {
    const h = makeHome();
    const pidFile = join(h.home, 'hang.pid');
    const r = await measure(item([server('hang-server.mjs'), pidFile]), h.ctx, { timeoutMs: 1500 });
    expect(r).toMatchObject({ ok: false, code: 'timeout' });
    await new Promise((res) => setTimeout(res, 300));
    const pid = Number(readFileSync(pidFile, 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it('refuses what it cannot run safely, and says why', () => {
    const h = makeHome();
    const missing: Item = { ...item(['x']), runtime: { command: 'nope', found: false } };
    expect(describeLaunch(missing, h.ctx)).toMatchObject({ refused: expect.stringContaining('not installed') });
    const project: Item = { ...item(['x']), scope: { harness: 'claude', level: 'project', project: h.project } };
    expect(describeLaunch(project, h.ctx)).toMatchObject({ warnings: [expect.stringContaining('trust this repo')] });
  });
});
