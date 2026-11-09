import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { type Ctx, makeCtx } from '../src/core/context.js';
import { collect, type Inventory } from '../src/core/inventory.js';

export const CODEX_TOML = `# Codex config, hand-written
model = "gpt" # keep this comment

[mcp_servers.acme-tools]
command = "acme-tools" # the main one
args = ["--include-tools", "*"]

[mcp_servers.acme-tools.env]
TOKEN = "s3cret"

[mcp_servers."npm:@playwright/mcp"]
command = "npm-playwright-mcp"

[plugins."toolkit@acme-market"]
enabled = true
`;

/**
 * A generic stand-in for an organisation's installer: claims items whose description carries
 * its marker (and enforces ownership), and annotates plugins from its marketplace.
 */
export const MARKER_PROVIDER = `export default {
  id: 'acme-sync',
  label: 'Acme Sync',
  apiVersion: 1,
  claim(item) {
    if (item.description?.includes('(installed by acme-sync)'))
      return { by: 'Acme Sync', enforces: true, description: item.description.replace(' (installed by acme-sync)', '') };
    if (item.kind === 'plugin' && item.origin === 'acme-market') return { by: 'Acme Sync', note: 'Acme Sync may re-enable it on its next sync' };
  },
  packages: () => [
    {
      id: 'kit',
      name: 'Acme Kit',
      installedWith: 'acme install kit',
      uninstall: 'acme uninstall kit',
      contains: (item) => (item.kind === 'plugin' && item.origin === 'acme-market') || !!item.scope.owner?.endsWith('@acme-market'),
    },
  ],
};
`;

function put(root: string, rel: string, content: string | object): void {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
}

/** A fake $HOME with every harness configured, plus a project. */
const created: string[] = [];

/** Remove every fake home made by this test file (wired up in test/setup.ts). */
export function cleanupHomes(): void {
  for (const h of created.splice(0)) rmSync(h, { recursive: true, force: true });
}

export function makeHome(): { home: string; project: string; ctx: Ctx } {
  const home = mkdtempSync(join(tmpdir(), 'whatsloaded-home-'));
  created.push(home);
  const project = join(home, 'work', 'proj');
  mkdirSync(join(project, '.git'), { recursive: true });

  put(home, '.claude.json', {
    numStartups: 3,
    mcpServers: { 'notes-mcp': { type: 'stdio', command: 'notes-mcp', args: [] } },
    projects: { [project]: { mcpServers: { 'local-only': { command: 'local-mcp' } } } },
  });
  put(home, '.claude/settings.json', { enabledPlugins: {} });
  put(home, '.agents/skills/architect/SKILL.md', '---\nname: architect\ndescription: Designs things\n---\n');
  mkdirSync(join(home, '.claude/skills'), { recursive: true });
  symlinkSync('../../.agents/skills/architect', join(home, '.claude/skills/architect'));
  put(home, '.claude/skills/local-skill/SKILL.md', '---\ndescription: Only in Claude\n---\n');
  put(project, '.mcp.json', { mcpServers: { 'proj-mcp': { command: 'proj-mcp' } } });

  put(home, '.kiro/settings/mcp.json', {
    mcpServers: {
      'acme-tools': { command: 'acme-tools', args: ['--old'], autoApprove: ['fetch_url'], disabledTools: ['Delegate'] },
      'notes-mcp': { command: 'notes-mcp', args: [] },
    },
  });
  put(home, '.kiro/agents/reviewer.json', {
    name: 'reviewer',
    description: 'Code review agent (installed by acme-sync)',
    mcpServers: { 'acme-tools': { command: 'acme-tools' } },
    tools: ['@builtin/fs_read', '@acme-tools/search', '@notes-mcp'],
  });

  // A Claude plugin bundling a server, an agent inside it, and a user agent that uses tools.
  const kit = join(home, '.claude/plugins/cache/acme-market/kit/1.0.0');
  put(home, '.claude/plugins/installed_plugins.json', {
    version: 2,
    plugins: { 'kit@acme-market': [{ scope: 'user', installPath: kit, version: '1.0.0' }] },
  });
  put(kit, '.mcp.json', { mcpServers: { 'search-mcp': { command: 'search-mcp' } } });
  put(kit, 'agents/finder.md', '---\ndescription: Finds things\ntools: Read, mcp__search-mcp__find\n---\n');
  put(
    home,
    '.claude/agents/helper.md',
    '---\ndescription: Helps\ntools: Read, mcp__notes-mcp__search, mcp__search-mcp__find, mcp__ghost__x\n---\n',
  );

  // Executables the configurations launch. `local-mcp` and `proj-mcp` are deliberately missing.
  const bin = join(home, 'bin');
  for (const exe of ['acme-tools', 'notes-mcp', 'npm-playwright-mcp', 'search-mcp']) {
    put(bin, exe, '#!/bin/sh\n');
    chmodSync(join(bin, exe), 0o755);
  }

  put(home, '.codex/config.toml', CODEX_TOML);
  put(home, '.config/opencode/opencode.json', { mcp: { 'notes-mcp': { type: 'local', command: ['notes-mcp'] } } });

  put(home, '.whatsloaded/providers/acme-sync.mjs', MARKER_PROVIDER);

  return { home, project, ctx: makeCtx({ home, project, env: { PATH: join(home, 'bin') } }) };
}

/** Inventory through the real extension loader, so the fixture's provider is exercised too. */
export const inv = (ctx: Ctx): Promise<Inventory> => collect(ctx);

export const read = (p: string) => readFileSync(p, 'utf8');

/** Snapshot every file (content) and symlink (raw target) under root, for byte-exact undo checks. */
export function snapshot(root: string, skip = '.whatsloaded'): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (n === skip) continue;
      const st = lstatSync(p);
      if (st.isSymbolicLink()) out[p] = `-> ${readlinkSync(p)}`;
      else if (st.isDirectory()) walk(p);
      else out[p] = readFileSync(p, 'utf8');
    }
  };
  walk(root);
  return out;
}
