import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { toolLoads } from '../src/core/load.js';
import { ref } from '../src/core/model.js';
import { planToggle } from '../src/core/ops.js';
import { loadProfiles, type Profile, planProfile, profileFromCurrent, saveProfile } from '../src/core/profiles.js';
import { apply } from '../src/io/changeset.js';
import { startServer, type UiServer } from '../src/server/http.js';
import { inv, makeHome } from './fixture.js';

let h: ReturnType<typeof makeHome>;
beforeEach(() => {
  h = makeHome();
});

const claudeLoad = async () => toolLoads(await inv(h.ctx)).find((t) => t.harness === 'claude')!;
const lean: Profile = { name: 'lean', keep: { mcp: ['notes-mcp'], skill: [], agent: [], plugin: [] }, createdAt: '' };

describe('profiles', () => {
  it('saves what a tool loads now, through the change engine', async () => {
    const t = await claudeLoad();
    apply([saveProfile(h.ctx, profileFromCurrent(t, 'full'))], h.ctx, 'save');
    const [p] = loadProfiles(h.ctx);
    expect(p).toMatchObject({
      name: 'full',
      keep: { mcp: ['local-only', 'notes-mcp', 'proj-mcp', 'search-mcp'], plugin: ['kit@acme-market'] },
    });
  });

  it('switches a tool to a lean profile and back', async () => {
    const before = await claudeLoad();
    apply([saveProfile(h.ctx, profileFromCurrent(before, 'full'))], h.ctx, 'save');

    const plan = planProfile(await inv(h.ctx), lean, 'claude');
    // Only the plugin owner's note: nothing unexpected.
    expect(plan.warnings).toEqual(['claude:user/plugin/kit@acme-market: Acme Sync may re-enable it on its next sync']);
    apply(plan.changes, h.ctx, 'lean');
    const after = await claudeLoad();
    expect(after.loaded).toEqual({ mcp: 1 }); // only notes-mcp; the plugin and your other items are off

    apply(planProfile(await inv(h.ctx), loadProfiles(h.ctx)[0]!, 'claude').changes, h.ctx, 'full');
    expect((await claudeLoad()).loaded).toEqual(before.loaded);
  });

  it('warns about kept names the tool cannot provide', async () => {
    const p: Profile = { name: 'x', keep: { mcp: ['ghost', 'search-mcp'], skill: [], agent: [], plugin: [] }, createdAt: '' };
    const w = planProfile(await inv(h.ctx), p, 'claude').warnings.join('\n');
    expect(w).toContain('ghost is in the profile');
    expect(w).toContain('search-mcp only comes from plugins (kit)');
  });

  it('leaves items owned by installers alone', async () => {
    const p: Profile = { name: 'none', keep: { mcp: [], skill: [], agent: [], plugin: [] }, createdAt: '' };
    const plan = planProfile(await inv(h.ctx), p, 'kiro');
    const files = plan.changes.map((c) => (c.op === 'edit' ? c.file : ''));
    expect(files.some((f) => f.endsWith('reviewer.json'))).toBe(false); // the Acme Sync agent's own servers
  });
});

describe('instruction files', () => {
  it('counts CLAUDE.md in context but refuses to switch it', async () => {
    writeFileSync(join(h.project, 'CLAUDE.md'), `# Rules\n${'Always write tests. '.repeat(50)}`);
    const i = await inv(h.ctx);
    const md = i.items.find((x) => ref(x) === 'claude:project/rule/CLAUDE.md')!;
    expect(md.locked).toMatch(/edit the file/);
    expect((await claudeLoad()).contextTokens).toBeGreaterThan(200);
    expect(() => planToggle(i, [md], false)).toThrow(/edit the file/);
  });
});

describe('measure API', () => {
  let s: UiServer;
  let home: ReturnType<typeof makeHome>;
  beforeAll(async () => {
    home = makeHome();
    s = await startServer(home.ctx, { port: 0, webRoot: '/nonexistent' });
  });
  afterAll(() => s.server.close());
  const post = (path: string, body: object) =>
    fetch(`${s.url}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: s.url },
      body: JSON.stringify(body),
    });

  it('shows what would run, refuses what it cannot run, and runs once per plan', async () => {
    const plan = await (
      await post('/api/measure/plan', { refs: ['kiro:user/mcp/notes-mcp', 'claude:project/mcp/proj-mcp'], project: home.project })
    ).json();
    expect(plan.launches.map((l: { ref: string }) => l.ref)).toEqual(['kiro:user/mcp/notes-mcp']);
    expect(plan.refused[0]).toMatchObject({ ref: 'claude:project/mcp/proj-mcp', reason: expect.stringContaining('not installed') });
    const run = await (await post('/api/measure/run', { id: plan.id })).json();
    // The fixture "server" is a script that exits at once, so the measurement fails cleanly.
    expect(run.results[0]).toMatchObject({ ref: 'kiro:user/mcp/notes-mcp', ok: false });
    expect((await post('/api/measure/run', { id: plan.id })).status).toBe(410);
  });

  it('rejects measuring from another origin', async () => {
    const res = await fetch(`${s.url}/api/measure/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://attacker.example' },
      body: JSON.stringify({ refs: ['kiro:user/mcp/notes-mcp'] }),
    });
    expect(res.status).toBe(403);
  });
});
