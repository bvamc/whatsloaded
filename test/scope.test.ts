import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeCtx } from '../src/core/context.js';
import { startServer, type UiServer } from '../src/server/http.js';
import { makeHome } from './fixture.js';

describe('global by default', () => {
  it('ignores the current directory unless asked', () => {
    const h = makeHome();
    expect(makeCtx({ home: h.home, cwd: h.project }).project).toBeUndefined();
    expect(makeCtx({ home: h.home, cwd: join(h.project, 'sub'), here: true }).project).toBe(h.project);
    expect(makeCtx({ home: h.home, project: h.project }).project).toBe(h.project);
  });
});

describe('server: project per request', () => {
  let s: UiServer;
  let h: ReturnType<typeof makeHome>;
  beforeAll(async () => {
    h = makeHome();
    s = await startServer({ ...h.ctx, project: undefined }, { port: 0, webRoot: '/nonexistent' });
  });
  afterAll(() => s.server.close());
  const refs = async (q = '') =>
    ((await (await fetch(`${s.url}/api/state${q}`)).json()) as { items: { ref: string }[] }).items.map((i) => i.ref);

  it('shows only global settings without a project', async () => {
    const r = await refs();
    expect(r).toContain('claude:user/mcp/notes-mcp');
    expect(r).not.toContain('claude:project/mcp/proj-mcp');
  });

  it('adds what a chosen project brings', async () => {
    expect(await refs(`?project=${encodeURIComponent(h.project)}`)).toContain('claude:project/mcp/proj-mcp');
  });

  it.each([['relative/path'], ['/definitely/not/here'], ['HOME']])('rejects project %s', async (p) => {
    const res = await fetch(`${s.url}/api/state?project=${encodeURIComponent(p === 'HOME' ? h.home : p)}`);
    expect(res.status).toBe(400);
  });

  it('lists projects the tools know about', async () => {
    const { projects } = (await (await fetch(`${s.url}/api/projects`)).json()) as { projects: { path: string; seenBy: string[] }[] };
    expect(projects).toContainEqual(expect.objectContaining({ path: h.project, seenBy: ['claude'] }));
  });
});
