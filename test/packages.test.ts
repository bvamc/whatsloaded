import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { inv, makeHome } from './fixture.js';

let h: ReturnType<typeof makeHome>;
beforeEach(() => {
  h = makeHome();
});

const skill = (name: string, body: string) => {
  mkdirSync(join(h.home, '.claude/skills', name), { recursive: true });
  writeFileSync(join(h.home, '.claude/skills', name, 'SKILL.md'), `---\ndescription: ${name}\n---\n${body}\n`);
};

describe('installer packages', () => {
  it('groups everything a provider says one package installed, and tags each item', async () => {
    const i = await inv(h.ctx);
    const kit = i.packages.find((p) => p.id === 'acme-sync:kit')!;
    expect(kit).toMatchObject({ name: 'Acme Kit', by: 'Acme Sync', uninstall: 'acme uninstall kit' });
    expect(kit.members).toContain('claude:user/plugin/kit@acme-market');
    expect(kit.members.some((r) => r.startsWith('claude:plugin@kit@acme-market/'))).toBe(true);
    const member = i.items.find((x) => x.kind === 'plugin' && x.name === 'kit@acme-market')!;
    expect(member.package).toBe('acme-sync:kit');
    expect(i.items.filter((x) => !x.package).length).toBeGreaterThan(0);
  });
});

describe('skills that name a server', () => {
  it('counts tool prefixes and "<name> MCP", not bare common words or npm scopes', async () => {
    skill('uses-prefix', 'Call mcp__acme-tools__fetch_url to read pages.');
    skill('uses-phrase', 'Needs the acme-tools MCP server.');
    skill('bare-word', 'The acme-tools folder has scripts.');
    skill('npm-scope', 'Run npm i -g @acme-tools/cli first.');
    skill('mcp-name', 'Search with search-mcp.');
    const by = (await inv(h.ctx)).mentions.map((m) => `${m.by.split('/').at(-1)}>${m.server}`);
    expect(by).toEqual(expect.arrayContaining(['uses-prefix>acme-tools', 'uses-phrase>acme-tools', 'mcp-name>search-mcp']));
    expect(by.some((x) => x.startsWith('bare-word>') || x.startsWith('npm-scope>'))).toBe(false);
  });
});
