import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { availableSources, findEntry, installedIn, searchSources } from '../src/catalog/index.js';
import { getJob, planJob, startJob } from '../src/catalog/jobs.js';
import type { CatalogEntry } from '../src/catalog/types.js';
import { checkArgv, commandText, fillArgv, UnsafeCommandError } from '../src/io/run.js';
import { inv, makeHome } from './fixture.js';

let h: ReturnType<typeof makeHome>;

function put(rel: string, content: string | object, mode?: number) {
  const p = join(h.home, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
  if (mode) chmodSync(p, mode);
}

beforeEach(() => {
  h = makeHome();
  const market = join(h.home, 'markets/acme');
  put('.claude/plugins/known_marketplaces.json', {
    'acme-market': { source: { source: 'github', repo: 'acme/plugins' }, installLocation: market },
  });
  put('markets/acme/.claude-plugin/marketplace.json', {
    name: 'acme-market',
    owner: { name: 'Acme' },
    plugins: [
      { name: 'demo', description: 'Demo tools for testing', source: './plugins/demo', category: 'testing' },
      { name: 'other', description: 'Something else', source: { source: 'github', repo: 'acme/other' } },
    ],
  });
  put('markets/acme/plugins/demo/skills/hello/SKILL.md', '---\ndescription: hi\n---\n');
  put('markets/acme/plugins/demo/.mcp.json', { mcpServers: { 'demo-mcp': { command: 'demo-mcp' } } });
  // A stand-in for `claude`: "installs" a plugin by recording it where Claude Code keeps installed plugins.
  const installed = JSON.stringify({
    version: 2,
    plugins: {
      'kit@acme-market': [{ scope: 'user', installPath: join(h.home, '.claude/plugins/cache/acme-market/kit/1.0.0') }],
      'demo@acme-market': [{ scope: 'user', installPath: join(market, 'plugins/demo') }],
    },
  });
  put(
    'bin/claude',
    `#!/bin/sh\n[ "$1 $2 $3" = "plugin install demo@acme-market" ] || exit 3\nprintf '%s' '${installed}' > "$HOME/.claude/plugins/installed_plugins.json"\necho installed demo\n`,
    0o755,
  );
});

describe('catalog sources', () => {
  it('lists plugins from marketplaces you added, with what each contains', async () => {
    const sources = availableSources(h.ctx);
    expect(sources.map((s) => s.id)).toContain('claude-marketplaces');
    const [r] = await searchSources(
      h.ctx,
      sources.filter((s) => s.id === 'claude-marketplaces'),
      { text: 'demo' },
    );
    const demo = r!.page!.entries[0]!;
    expect(demo).toMatchObject({ name: 'demo', installName: 'demo@acme-market', trust: 'community', publisher: 'Acme' });
    expect(demo.contents).toEqual([
      { kind: 'skill', names: ['hello'] },
      { kind: 'mcp', names: ['demo-mcp'] },
    ]);
  });

  it('installs with the tool’s own command, then checks the tool’s files', async () => {
    const entry = (await findEntry(h.ctx, availableSources(h.ctx), 'claude-marketplaces:plugin:demo@acme-market'))!;
    const plan = planJob(await inv(h.ctx), entry, 'install');
    expect(plan.steps.map((s) => s.text)).toEqual(['claude plugin install demo@acme-market --scope user']);
    expect(plan.before).toEqual([]);
    const job = startJob(h.ctx, plan.id);
    for (let i = 0; i < 100 && getJob(job.id)!.status === 'running'; i++) await new Promise((r) => setTimeout(r, 30));
    const done = getJob(job.id)!;
    expect(done.status).toBe('done');
    expect(done.steps[0]!.output).toContain('installed demo');
    expect(done.after).toEqual(['claude']);
    expect(() => startJob(h.ctx, plan.id)).toThrow(/expired/); // a plan runs once
  });

  it('warns before installing something its source has not reviewed', async () => {
    const e: CatalogEntry = {
      id: 'x:plugin:risky',
      source: 'x',
      kind: 'plugin',
      name: 'risky',
      trust: 'unreviewed',
      tools: ['claude'],
      install: [{ type: 'command', label: 'install', argv: ['claude', 'plugin', 'install', 'risky@x'] }],
    };
    const i = await inv(h.ctx);
    expect(planJob(i, e, 'install').warnings.join()).toMatch(/has not reviewed risky/);
    expect(installedIn(i, { kind: 'plugin', name: 'kit', installName: 'kit@acme-market' })).toEqual(['claude']);
  });
});

describe('commands', () => {
  it('runs only plain words, so what is shown is what runs', () => {
    expect(commandText(['acme', 'agents', 'install', 'Kit-1.0'])).toBe('acme agents install Kit-1.0');
    for (const bad of [['rm', '-rf', '~'], ['echo', 'a b'], ['x', '$(id)'], ['x', 'a;b'], ['x', 'a‮b'], []])
      expect(() => checkArgv(bad), JSON.stringify(bad)).toThrow(UnsafeCommandError);
  });

  it('never lets a value become an option', () => {
    expect(fillArgv(['tool', 'install', '{name}'], { name: 'pkg@1.0' })).toEqual(['tool', 'install', 'pkg@1.0']);
    expect(() => fillArgv(['tool', 'install', '{name}'], { name: '--force' })).toThrow(UnsafeCommandError);
  });
});
