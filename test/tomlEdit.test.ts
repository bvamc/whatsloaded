import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import { appendTable, parseDottedKey, removeTable, setTableKey, TomlLayoutError, verifiedEdit } from '../src/io/tomlEdit.js';
import { CODEX_TOML } from './fixture.js';

describe('surgical TOML edits', () => {
  it('parses quoted dotted keys', () => {
    expect(parseDottedKey('mcp_servers."npm:@playwright/mcp"')).toEqual(['mcp_servers', 'npm:@playwright/mcp']);
    expect(parseDottedKey(`a.'b.c'.d`)).toEqual(['a', 'b.c', 'd']);
  });

  it('adds a key inside a table without disturbing comments', () => {
    const out = setTableKey(CODEX_TOML, ['mcp_servers', 'acme-tools'], 'enabled', false);
    expect(out).toContain('# Codex config, hand-written');
    expect(out).toContain('command = "acme-tools" # the main one');
    expect((parse(out) as any).mcp_servers['acme-tools'].enabled).toBe(false);
    expect((parse(out) as any).mcp_servers['acme-tools'].env.TOKEN).toBe('s3cret');
  });

  it('replaces an existing key and keeps its trailing comment', () => {
    const out = setTableKey(CODEX_TOML, ['mcp_servers', 'acme-tools'], 'command', 'other');
    expect(out).toContain('command = "other" # the main one');
  });

  it('removes a table with its subtables, leaving the rest intact', () => {
    const out = removeTable(CODEX_TOML, ['mcp_servers', 'acme-tools']);
    const doc = parse(out) as any;
    expect(doc.mcp_servers['acme-tools']).toBeUndefined();
    expect(doc.mcp_servers['npm:@playwright/mcp'].command).toBe('npm-playwright-mcp');
    expect(out).toContain('model = "gpt" # keep this comment');
  });

  it('appends tables with nested env as a subtable and quotes odd keys', () => {
    const out = appendTable(CODEX_TOML, ['mcp_servers', 'a/b'], { command: 'x', args: ['1'], env: { K: 'v' } });
    expect(out).toContain('[mcp_servers."a/b"]');
    expect(out).toContain('[mcp_servers."a/b".env]');
    expect((parse(out) as any).mcp_servers['a/b']).toEqual({ command: 'x', args: ['1'], env: { K: 'v' } });
  });

  it('refuses edits whose result differs from the intended change', () => {
    expect(() =>
      verifiedEdit(
        CODEX_TOML,
        (t) => t.replace('model = "gpt"', 'model = "x"'),
        () => {},
      ),
    ).toThrow(TomlLayoutError);
  });

  it('refuses to edit tables written inline', () => {
    expect(() => setTableKey('mcp_servers.a = { command = "a" }\n', ['mcp_servers', 'a'], 'enabled', false)).toThrow(TomlLayoutError);
  });
});
