import { existsSync, readlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { beforeEach, describe, expect, it } from 'vitest';
import { diagnose } from '../src/core/doctor.js';
import { collect } from '../src/core/inventory.js';
import { ref } from '../src/core/model.js';
import { ManagedError, planAdopt, planCopy, planSync, planToggle } from '../src/core/ops.js';
import { select } from '../src/core/select.js';
import { apply, listBackups, restore } from '../src/io/changeset.js';
import { jsonSet } from '../src/io/jsonEdit.js';
import { inv, makeHome, read, snapshot } from './fixture.js';

let h: ReturnType<typeof makeHome>;
beforeEach(() => {
  h = makeHome();
});

const one = async (q: string) => {
  const i = await inv(h.ctx);
  const hits = select(
    i.items,
    q,
    {},
    i.adapters.map((a) => a.id),
  );
  expect(hits, `query ${q}`).toHaveLength(1);
  return { inv: i, item: hits[0]! };
};

describe('discovery', () => {
  it('finds items across harnesses and scopes', async () => {
    const refs = (await inv(h.ctx)).items.map(ref);
    expect(refs).toEqual(
      expect.arrayContaining([
        'claude:user/mcp/notes-mcp',
        'claude:local/mcp/local-only',
        'claude:project/mcp/proj-mcp',
        'claude:user/skill/architect',
        'kiro:user/mcp/acme-tools',
        'kiro:agent@reviewer/mcp/acme-tools',
        'codex:user/mcp/acme-tools',
        'codex:user/mcp/npm:@playwright/mcp',
        'codex:user/plugin/toolkit@acme-market',
        'opencode:user/mcp/notes-mcp',
        'agents:store/skill/architect',
      ]),
    );
  });

  it('applies provider claims to agents and the servers embedded in them', async () => {
    const agent = (await one('kiro:user/agent/reviewer')).item;
    expect(agent).toMatchObject({ managedBy: 'Acme Sync', description: 'Code review agent' });
    expect(agent.provenance).toMatchObject({ by: 'Acme Sync', owner: { provider: 'acme-sync', enforces: true } });
    const { item } = await one('kiro:agent@reviewer/mcp/acme-tools');
    expect(item.managedBy).toBe('Acme Sync');
  });

  it('turns provider notes into plan warnings', async () => {
    const { inv: i, item } = await one('codex:user/plugin/toolkit@acme-market');
    expect(planToggle(i, [item], false).warnings.join()).toContain('may re-enable it');
  });

  it('runs without extensions when asked', async () => {
    const i = await collect({ ...h.ctx, extensions: false });
    const agent = i.items.find((x) => ref(x) === 'kiro:user/agent/reviewer');
    expect(agent?.managedBy).toBeUndefined();
    expect(i.providers).toHaveLength(0);
  });
});

describe('enable / disable', () => {
  it('parks a Claude user MCP and restores it exactly', async () => {
    const before = read(join(h.home, '.claude.json'));
    let { inv: i, item } = await one('claude:user/mcp/notes-mcp');
    apply(planToggle(i, [item], false).changes, h.ctx, 't');
    expect(JSON.parse(read(join(h.home, '.claude.json'))).mcpServers['notes-mcp']).toBeUndefined();

    ({ inv: i, item } = await one('claude:user/mcp/notes-mcp'));
    expect(item).toMatchObject({ enabled: false, parked: true });

    apply(planToggle(i, [item], true).changes, h.ctx, 't');
    expect(read(join(h.home, '.claude.json'))).toBe(before);
  });

  it('keeps relative skill symlinks resolvable while parked', async () => {
    let { inv: i, item } = await one('claude:user/skill/architect');
    apply(planToggle(i, [item], false).changes, h.ctx, 't');
    ({ inv: i, item } = await one('claude:user/skill/architect'));
    expect(item.parked).toBe(true);
    expect(item.link?.broken).toBe(false);
    apply(planToggle(i, [item], true).changes, h.ctx, 't');
    expect(readlinkSync(join(h.home, '.claude/skills/architect'))).toBe('../../.agents/skills/architect');
  });

  it('uses native flags for Kiro and Codex, preserving TOML comments', async () => {
    const i = await inv(h.ctx);
    const items = select(i.items, 'acme-tools', { level: 'user' });
    apply(planToggle(i, items, false).changes, h.ctx, 't');
    expect(JSON.parse(read(join(h.home, '.kiro/settings/mcp.json'))).mcpServers['acme-tools'].disabled).toBe(true);
    const toml = read(join(h.home, '.codex/config.toml'));
    expect((parse(toml) as any).mcp_servers['acme-tools'].enabled).toBe(false);
    expect(toml).toContain('# keep this comment');
  });

  it('disables project .mcp.json servers via settings.local.json', async () => {
    const { inv: i, item } = await one('claude:project/mcp/proj-mcp');
    apply(planToggle(i, [item], false).changes, h.ctx, 't');
    expect(JSON.parse(read(join(h.project, '.claude/settings.local.json'))).disabledMcpjsonServers).toEqual(['proj-mcp']);
    expect((await one('claude:project/mcp/proj-mcp')).item.enabled).toBe(false);
  });

  it('refuses managed items without --force', async () => {
    const { inv: i, item } = await one('kiro:agent@reviewer/mcp/acme-tools');
    expect(() => planToggle(i, [item], false)).toThrow(ManagedError);
    expect(planToggle(i, [item], false, true).changes).toHaveLength(1);
  });
});

describe('copy / sync / adopt', () => {
  it('translates an MCP server between harness formats', async () => {
    const { inv: i, item } = await one('kiro:user/mcp/acme-tools');
    const plan = planCopy(i, item, [
      { harness: 'opencode', level: 'user' },
      { harness: 'claude', level: 'user' },
    ]);
    expect(plan.warnings.join()).toContain('disabledTools');
    apply(plan.changes, h.ctx, 't');
    expect(JSON.parse(read(join(h.home, '.config/opencode/opencode.json'))).mcp['acme-tools']).toEqual({
      type: 'local',
      command: ['acme-tools', '--old'],
    });
    expect(JSON.parse(read(join(h.home, '.claude.json'))).mcpServers['acme-tools']).toEqual({
      type: 'stdio',
      command: 'acme-tools',
      args: ['--old'],
    });
  });

  it('skips existing targets unless overwriting', async () => {
    const { inv: i, item } = await one('kiro:user/mcp/acme-tools');
    const plan = planCopy(i, item, [{ harness: 'codex', level: 'user' }]);
    expect(plan.changes).toHaveLength(0);
    expect(plan.warnings[0]).toContain('already exists');
  });

  it('syncs your drifting configurations, keeps harness extras, and leaves agent profiles alone', async () => {
    const { inv: i, item } = await one('codex:user/mcp/acme-tools');
    const plan = planSync(i, item);
    expect(plan.warnings.join()).toContain('left 1 agent profile(s) unchanged');
    apply(plan.changes, h.ctx, 't');
    const kiro = JSON.parse(read(join(h.home, '.kiro/settings/mcp.json'))).mcpServers['acme-tools'];
    expect(kiro.args).toEqual(['--include-tools', '*']);
    expect(kiro.autoApprove).toEqual(['fetch_url']);
  });

  it('adopts a standalone skill into the shared store', async () => {
    const { inv: i, item } = await one('claude:user/skill/local-skill');
    apply(planAdopt(i, item).changes, h.ctx, 't');
    expect(existsSync(join(h.home, '.agents/skills/local-skill/SKILL.md'))).toBe(true);
    expect(readlinkSync(join(h.home, '.claude/skills/local-skill'))).toBe('../../.agents/skills/local-skill');
    const again = await one('claude:user/skill/local-skill');
    expect(again.item.link?.broken).toBe(false);
  });

  it('links a store skill into other harnesses', async () => {
    const { inv: i, item } = await one('agents:store/skill/architect');
    apply(
      planCopy(i, item, [
        { harness: 'kiro', level: 'user' },
        { harness: 'codex', level: 'user' },
      ]).changes,
      h.ctx,
      't',
    );
    expect(readlinkSync(join(h.home, '.kiro/skills/architect'))).toBe('../../.agents/skills/architect');
    expect(readlinkSync(join(h.home, '.codex/skills/architect'))).toBe(join(h.home, '.agents/skills/architect'));
  });
});

describe('safety', () => {
  it('undo restores every file and link byte-for-byte', async () => {
    const before = snapshot(h.home);
    const i = await inv(h.ctx);
    const items = i.items.filter((x) => !x.managedBy && x.enabled && ['mcp', 'skill'].includes(x.kind) && x.scope.harness !== 'agents');
    apply(planToggle(i, items, false).changes, h.ctx, 'disable everything');
    expect(snapshot(h.home)).not.toEqual(before);
    restore(listBackups(h.ctx)[0]!.id, h.ctx);
    expect(snapshot(h.home)).toEqual(before);
  });

  it('re-applies edits to the live file, keeping concurrent writes from other tools', async () => {
    const { inv: i, item } = await one('claude:user/mcp/notes-mcp');
    const plan = planToggle(i, [item], false);
    // Simulate a running Claude session updating ~/.claude.json between plan and apply.
    const f = join(h.home, '.claude.json');
    writeFileSync(f, jsonSet(read(f), ['numStartups'], 4));
    apply(plan.changes, h.ctx, 't');
    const after = JSON.parse(read(f));
    expect(after.numStartups).toBe(4);
    expect(after.mcpServers['notes-mcp']).toBeUndefined();
  });

  it('doctor reports drift between harnesses', async () => {
    const drift = diagnose(await inv(h.ctx)).filter((p) => p.code === 'mcp-drift');
    expect(drift.some((p) => p.message.startsWith('acme-tools:'))).toBe(true);
  });
});
