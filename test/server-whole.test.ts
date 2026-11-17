import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { beforeEach, describe, expect, it } from 'vitest';
import { toolLoads } from '../src/core/load.js';
import { ref } from '../src/core/model.js';
import { planServer } from '../src/core/ops.js';
import { planProfile } from '../src/core/profiles.js';
import { serverReport } from '../src/core/where.js';
import { apply } from '../src/io/changeset.js';
import { inv, makeHome, read } from './fixture.js';

let h: ReturnType<typeof makeHome>;
beforeEach(() => {
  h = makeHome();
});

const files = (p: { changes: { op: string; file?: string; path?: string }[] }) => p.changes.map((c) => c.file ?? c.path);

describe('a server as a whole', () => {
  it('turns off your configurations everywhere and leaves installer-owned ones alone', async () => {
    const plan = planServer(await inv(h.ctx), 'acme-tools', 'off');
    expect(files(plan).sort()).toEqual([join(h.home, '.codex/config.toml'), join(h.home, '.kiro/settings/mcp.json')]);
    expect(plan.warnings.join()).toContain('left 1 configuration(s) owned by installers unchanged (Acme Sync)');
    apply(plan.changes, h.ctx, 'off');
    expect(JSON.parse(read(join(h.home, '.kiro/settings/mcp.json'))).mcpServers['acme-tools'].disabled).toBe(true);
    expect((parse(read(join(h.home, '.codex/config.toml'))) as any).mcp_servers['acme-tools'].enabled).toBe(false);

    apply(planServer(await inv(h.ctx), 'acme-tools', 'on').changes, h.ctx, 'on');
    expect(JSON.parse(read(join(h.home, '.kiro/settings/mcp.json'))).mcpServers['acme-tools'].disabled).toBeUndefined();
  });

  it('switches plugins that bring it only when asked, and says so otherwise', async () => {
    const i = await inv(h.ctx);
    const without = planServer(i, 'search-mcp', 'off');
    expect(without.changes).toEqual([]);
    expect(without.warnings.join()).toContain('1 plugin(s) still bring search-mcp');
    const kit = i.items.find((x) => x.kind === 'plugin' && x.name === 'kit@acme-market')!;
    const withKit = planServer(i, 'search-mcp', 'off', { plugins: [ref(kit)] });
    expect(files(withKit)).toEqual([join(h.home, '.claude/settings.json')]);
  });

  it('uninstalls configuration, names the next step, and warns about agents that lose it', async () => {
    const plan = planServer(await inv(h.ctx), 'acme-tools', 'remove');
    apply(plan.changes, h.ctx, 'rm');
    expect(JSON.parse(read(join(h.home, '.kiro/settings/mcp.json'))).mcpServers['acme-tools']).toBeUndefined();
    expect(plan.warnings.join()).toContain("agent(s) use acme-tools's tools");
  });

  it('acts only on the entries you keep ticked', async () => {
    const plan = planServer(await inv(h.ctx), 'acme-tools', 'remove', { only: ['kiro:user/mcp/acme-tools'] });
    expect(files(plan)).toEqual([join(h.home, '.kiro/settings/mcp.json')]); // the Codex entry is kept
  });

  it('lists what bundling plugins also bring', async () => {
    const r = serverReport(await inv(h.ctx), 'search-mcp')!;
    expect(r.packages.map((p) => [p.plugin.name, p.brings.map((b) => b.name)])).toEqual([['kit@acme-market', ['finder']]]);
  });
});

describe('Kiro powers', () => {
  beforeEach(() => {
    const root = join(h.home, '.kiro/powers');
    mkdirSync(join(root, 'installed/figma'), { recursive: true });
    writeFileSync(
      join(root, 'installed.json'),
      JSON.stringify({ version: 1, installedPowers: [{ name: 'figma', registryId: 'kiro-recommended' }] }),
    );
    writeFileSync(
      join(root, 'installed/figma/mcp.json'),
      JSON.stringify({ mcpServers: { figma: { url: 'https://mcp.figma.example/mcp' } } }),
    );
    writeFileSync(join(root, 'installed/figma/POWER.md'), '---\nname: figma\ndescription: Design to code\n---\nSteps\n');
  });

  it('shows a power as a read-only bundle that loads on demand', async () => {
    const i = await inv(h.ctx);
    const power = i.items.find((x) => ref(x) === 'kiro:user/plugin/figma')!;
    expect(power.locked).toMatch(/Kiro manages powers/);
    const server = i.items.find((x) => ref(x) === 'kiro:plugin@figma/mcp/figma')!;
    expect(server).toMatchObject({ role: 'bundled', onDemand: expect.stringContaining('active') });
    expect(toolLoads(i).find((t) => t.harness === 'kiro')!.loaded.mcp).toBe(2); // the power's server is not counted
    expect(serverReport(i, 'figma')!.packages[0]!.brings.map((b) => b.name)).toEqual(['figma/POWER.md']);
  });

  it('is skipped by profiles instead of failing them', async () => {
    const p = planProfile(await inv(h.ctx), { name: 'x', keep: { mcp: [], skill: [], agent: [], plugin: [] }, createdAt: '' }, 'kiro');
    expect(files(p).some((f) => f?.includes('powers'))).toBe(false);
  });
});
