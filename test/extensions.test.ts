import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadExtensions } from '../src/extensions/loader.js';
import { inv, makeHome } from './fixture.js';

let h: ReturnType<typeof makeHome>;
beforeEach(() => {
  h = makeHome();
});

const write = (kind: 'adapters' | 'providers', name: string, body: string) => {
  const dir = join(h.home, '.whatsloaded', kind);
  mkdirSync(dir, { recursive: true });
  const f = join(dir, name);
  writeFileSync(f, body);
  return f;
};

describe('extension loader', () => {
  it('loads the fixture provider', async () => {
    const ext = await loadExtensions(h.ctx);
    expect(ext.providers.map((p) => p.id)).toEqual(['acme-sync']);
    expect(ext.problems).toEqual([]);
  });

  it('reports a broken provider without failing the run', async () => {
    write('providers', 'broken.mjs', 'export default { id: "x" };');
    write('providers', 'syntax.mjs', 'export default {');
    const ext = await loadExtensions(h.ctx);
    expect(ext.providers.map((p) => p.id)).toEqual(['acme-sync']);
    expect(ext.problems.map((p) => p.code)).toEqual(['provider-load', 'provider-load']);
  });

  it('rejects duplicate ids and wrong apiVersion', async () => {
    write('providers', 'zz-dupe.mjs', 'export default { id: "acme-sync", label: "x", apiVersion: 1 };');
    write('providers', 'zz-v2.mjs', 'export default { id: "future", label: "x", apiVersion: 2 };');
    const msgs = (await loadExtensions(h.ctx)).problems.map((p) => p.message);
    expect(msgs.join('\n')).toMatch(/duplicate provider id/);
    expect(msgs.join('\n')).toMatch(/unsupported apiVersion 2/);
  });

  it.skipIf(process.platform === 'win32')('refuses world-writable extension files', async () => {
    const f = write('providers', 'open.mjs', 'export default { id: "open", label: "Open", apiVersion: 1 };');
    chmodSync(f, 0o666);
    const ext = await loadExtensions(h.ctx);
    expect(ext.providers.map((p) => p.id)).not.toContain('open');
    expect(ext.problems[0]?.message).toMatch(/writable by other users/);
  });

  it('accepts a four-field read-only adapter and fills the rest', async () => {
    write(
      'adapters',
      'tiny.mjs',
      `export default {
        id: 'tiny', label: 'Tiny',
        detect: () => true,
        discover: (ctx) => ({ problems: [], items: [{ kind: 'mcp', name: 'hello', enabled: true, scope: { harness: 'tiny', level: 'user' },
          location: { file: ctx.home + '/tiny.json', path: ['mcpServers', 'hello'] }, mcp: { transport: 'stdio', command: 'hello' } }] }),
      };`,
    );
    const i = await inv(h.ctx);
    const tiny = i.adapters.find((a) => a.id === 'tiny')!;
    expect(i.items.some((x) => x.scope.harness === 'tiny' && x.name === 'hello')).toBe(true);
    expect(tiny.writable('mcp', h.ctx)).toEqual([]);
    expect(() => tiny.remove(i.items.find((x) => x.scope.harness === 'tiny')!, h.ctx)).toThrow(/does not support removing/);
  });

  it('loads nothing when extensions are disabled', async () => {
    const ext = await loadExtensions({ ...h.ctx, extensions: false });
    expect(ext.providers).toEqual([]);
    expect(ext.adapters.map((a) => a.id)).toEqual(['claude', 'kiro', 'codex', 'opencode', 'agents']);
  });
});
