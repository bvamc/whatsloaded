import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { diagnose } from '../src/core/doctor.js';
import { ref } from '../src/core/model.js';
import { planSync } from '../src/core/ops.js';
import { serverReport, summaryLine } from '../src/core/where.js';
import { jsonSet } from '../src/io/jsonEdit.js';
import { inv, makeHome, read } from './fixture.js';

let h: ReturnType<typeof makeHome>;
beforeEach(() => {
  h = makeHome();
});

const item = async (r: string) => (await inv(h.ctx)).items.find((i) => ref(i) === r)!;

describe('roles: what a configuration entry is', () => {
  it('derives a role from scope', async () => {
    expect((await item('kiro:user/mcp/acme-tools')).role).toBe('owned');
    expect((await item('kiro:agent@reviewer/mcp/acme-tools')).role).toBe('agent-profile');
    expect((await item('claude:plugin@kit@acme-market/mcp/search-mcp')).role).toBe('bundled');
  });

  it('resolves commands on PATH without running them', async () => {
    const acme = await item('kiro:user/mcp/acme-tools');
    expect(acme.runtime).toMatchObject({ command: 'acme-tools', found: true, resolved: join(h.home, 'bin', 'acme-tools') });
    expect((await item('claude:project/mcp/proj-mcp')).runtime?.found).toBe(false);
  });
});

describe('where: installed / configured / used by', () => {
  it('separates one install from its configurations and its users', async () => {
    const r = serverReport(await inv(h.ctx), 'acme-tools')!;
    expect(r.installs).toHaveLength(1);
    expect(r.installs[0]).toMatchObject({ kind: 'executable', entries: 3 });
    expect(r.configs.map((c) => [c.role, c.items.length])).toEqual([
      ['owned', 2],
      ['agent-profile', 1],
    ]);
    expect(r.usedBy.map((u) => u.by)).toEqual(['kiro:user/agent/reviewer']);
    expect(summaryLine(r)).toBe('1 install · 3 configurations (2 yours · 1 agent profile) · used by 1 agent');
  });

  it('compares only your own configurations for drift', async () => {
    const i = await inv(h.ctx);
    const drift = diagnose(i).find((p) => p.code === 'mcp-drift' && p.message.startsWith('acme-tools'))!;
    expect(drift.message).toContain('your 2 configurations');
    expect(drift.refs).not.toContain('kiro:agent@reviewer/mcp/acme-tools');
    // The agent profile (no args) differs from both, but that is not drift.
    expect(serverReport(i, 'acme-tools')!.variants).toHaveLength(2);
  });
});

describe('references: usage is not configuration', () => {
  it('ignores Kiro @builtin tools', async () => {
    expect((await inv(h.ctx)).references.some((r) => r.server === 'builtin')).toBe(false);
  });

  it('resolves Claude tool names, including a plugin agent naming its own plugin server', async () => {
    const refs = (await inv(h.ctx)).references.filter((r) => r.harness === 'claude');
    const helper = (s: string) => refs.find((r) => r.by === 'claude:user/agent/helper' && r.server === s);
    expect(helper('notes-mcp')).toMatchObject({ resolved: true, tools: ['search'] });
    expect(helper('ghost')).toMatchObject({ resolved: false });
    expect(helper('search-mcp')).toMatchObject({ resolved: false });
    expect(helper('search-mcp')?.hint).toContain('mcp__plugin_kit_search-mcp__');
    expect(refs.find((r) => r.by.endsWith('/agent/finder'))).toMatchObject({ server: 'search-mcp', resolved: true });
  });

  it('reports agents that cannot see a configuration, grouped per server', async () => {
    const found = diagnose(await inv(h.ctx)).filter((p) => p.code === 'reference-unconfigured');
    const msgs = found.map((p) => p.message);
    expect(msgs.some((m) => m.startsWith('1 kiro agent uses notes-mcp tools') && m.includes('do not declare'))).toBe(true);
    expect(msgs.some((m) => m.startsWith('1 claude agent uses ghost tools') && m.includes('no claude configuration named ghost'))).toBe(
      true,
    );
    expect(msgs.some((m) => m.includes('search-mcp') && m.includes('only through plugins'))).toBe(true);
    expect(msgs.some((m) => m.includes('finder'))).toBe(false);
  });
});

describe('runtime findings', () => {
  it('flags commands that are not installed, as errors for your own entries', async () => {
    const p = diagnose(await inv(h.ctx)).find((x) => x.code === 'runtime-not-found' && x.message.startsWith('proj-mcp'))!;
    expect(p.severity).toBe('error');
  });

  it('explains a command pinned to a version that was upgraded away', async () => {
    mkdirSync(join(h.home, 'tools/foo/2.0.0/bin'), { recursive: true });
    const f = join(h.home, '.kiro/settings/mcp.json');
    writeFileSync(f, jsonSet(read(f), ['mcpServers', 'foo'], { command: join(h.home, 'tools/foo/1.0.0/bin/foo') }));
    const p = diagnose(await inv(h.ctx)).find((x) => x.code === 'runtime-not-found' && x.message.startsWith('foo'))!;
    expect(p.message).toContain('points at version 1.0.0, which is no longer installed (installed: 2.0.0)');
  });
});

describe('sync respects roles', () => {
  it('rewrites only your configurations by default', async () => {
    const i = await inv(h.ctx);
    const plan = planSync(i, i.items.find((x) => ref(x) === 'codex:user/mcp/acme-tools')!);
    expect(plan.changes.map((c) => (c.op === 'edit' ? c.file : ''))).toEqual([join(h.home, '.kiro/settings/mcp.json')]);
    expect(plan.warnings.join()).toContain('left 1 agent profile(s) unchanged');
  });

  it('includes agent profiles when asked (and forced past their owner)', async () => {
    const i = await inv(h.ctx);
    const plan = planSync(i, i.items.find((x) => ref(x) === 'codex:user/mcp/acme-tools')!, true, { includeAgentProfiles: true });
    expect(plan.changes.some((c) => c.op === 'edit' && c.file.endsWith('reviewer.json'))).toBe(true);
  });
});

describe('refName', () => {
  it('keeps slashes that belong to the name', async () => {
    const { refName } = await import('../src/core/model.js');
    expect(refName('codex:user/mcp/npm:@playwright/mcp')).toBe('npm:@playwright/mcp');
    expect(refName('claude:plugin@kit@acme-market/agent/finder')).toBe('finder');
  });
});

describe('installer detection', () => {
  it('never blames the interpreter for a script server', async () => {
    const { detectInstaller } = await import('../src/core/runtime/installer.js');
    const i = {
      kind: 'mcp' as const,
      name: 'x',
      scope: { harness: 'kiro', level: 'user' as const },
      enabled: true,
      location: { file: '/f' },
      mcp: { transport: 'stdio' as const, command: 'node', args: ['/srv/x.cjs'] },
      runtime: {
        command: 'node',
        found: true,
        resolved: '/opt/homebrew/bin/node',
        realpath: '/opt/homebrew/Cellar/node@24/24.0.0/bin/node',
      },
    };
    expect(detectInstaller(i)).toEqual({ by: 'a node script (/srv/x.cjs)' });
    expect(
      detectInstaller({ ...i, mcp: { transport: 'stdio', command: 'gh-mcp' }, runtime: { ...i.runtime, command: 'gh-mcp' } }),
    ).toMatchObject({
      by: 'Homebrew',
      uninstall: 'brew uninstall node@24',
    });
  });
});
