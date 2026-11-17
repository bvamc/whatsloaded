import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type UiServer } from '../src/server/http.js';
import { makeHome, read } from './fixture.js';

let h: ReturnType<typeof makeHome>;
let s: UiServer;

beforeAll(async () => {
  h = makeHome();
  s = await startServer(h.ctx, { port: 0, webRoot: join(h.home, 'no-web') });
});
afterAll(() => s.server.close());

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(s.url + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: s.url, ...headers },
    body: JSON.stringify(body),
  });

describe('local UI server', () => {
  it('listens on loopback only', () => {
    const addr = s.server.address();
    expect(typeof addr === 'object' && addr?.address).toBe('127.0.0.1');
  });

  it('serves state without secret values', async () => {
    const res = await fetch(`${s.url}/api/state`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('codex:user/mcp/acme-tools');
    expect(text).not.toContain('s3cret');
  });

  it('rejects foreign Host headers (DNS rebinding)', async () => {
    // fetch() won't let us override Host, so speak raw HTTP.
    const { request } = await import('node:http');
    const status = await new Promise<number>((resolve) => {
      const req = request(`${s.url}/api/state`, { headers: { Host: 'attacker.example' } }, (r) => resolve(r.statusCode!));
      req.end();
    });
    expect(status).toBe(421);
  });

  it('rejects cross-origin and non-JSON writes (CSRF)', async () => {
    expect((await post('/api/undo', {}, { Origin: 'http://attacker.example' })).status).toBe(403);
    expect(
      (await fetch(`${s.url}/api/undo`, { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: s.url }, body: '{}' })).status,
    ).toBe(415);
  });

  it('plans, applies once, and undoes through the API', async () => {
    const plan = await (await post('/api/plan', { action: 'disable', refs: ['kiro:user/mcp/notes-mcp'] })).json();
    expect(plan.applicable).toBe(true);
    const applied = await post('/api/apply', { id: plan.id });
    expect(applied.status).toBe(200);
    expect(JSON.parse(read(join(h.home, '.kiro/settings/mcp.json'))).mcpServers['notes-mcp'].disabled).toBe(true);
    expect((await post('/api/apply', { id: plan.id })).status).toBe(410); // single use
    expect((await post('/api/undo', {})).status).toBe(200);
    expect(JSON.parse(read(join(h.home, '.kiro/settings/mcp.json'))).mcpServers['notes-mcp'].disabled).toBeUndefined();
  });

  it('reports managed items as 409 so the UI can offer force', async () => {
    const res = await post('/api/plan', { action: 'disable', refs: ['kiro:agent@reviewer/mcp/acme-tools'] });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('managed');
  });
});
