import { describe, expect, it } from 'vitest';
import { jsonGet, jsonReplaceMinimal, jsonSet } from '../src/io/jsonEdit.js';

const HAND = `{
  "mcp" : {
    "notes-mcp" : {
      "type" : "local",
      "command" : [ "notes-mcp" ]
    },
    "other" : { "type" : "local" }
  }
}
`;

describe('minimal JSON edits', () => {
  it('adds one property in the file’s own style without touching neighbours', () => {
    const out = jsonSet(HAND, ['mcp', 'notes-mcp', 'enabled'], false);
    expect(out).toBe(HAND.replace('"command" : [ "notes-mcp" ]', '"command" : [ "notes-mcp" ],\n      "enabled" : false'));
  });

  it('appends inline into single-line objects', () => {
    expect(jsonSet(HAND, ['mcp', 'other', 'enabled'], false)).toContain('{ "type" : "local", "enabled" : false }');
  });

  it('replaces a value in place', () => {
    const out = jsonSet(HAND, ['mcp', 'notes-mcp', 'type'], 'remote');
    expect(out).toBe(HAND.replace('"type" : "local",', '"type" : "remote",'));
  });

  it('removes first, middle, last and only properties cleanly', () => {
    const t = '{\n  "a": 1,\n  "b": 2,\n  "c": 3\n}\n';
    expect(jsonSet(t, ['a'], undefined)).toBe('{\n  "b": 2,\n  "c": 3\n}\n');
    expect(jsonSet(t, ['b'], undefined)).toBe('{\n  "a": 1,\n  "c": 3\n}\n');
    expect(jsonSet(t, ['c'], undefined)).toBe('{\n  "a": 1,\n  "b": 2\n}\n');
    expect(jsonSet('{\n  "a": 1\n}\n', ['a'], undefined)).toBe('{}\n');
  });

  it('creates missing parents and files', () => {
    const out = jsonSet(null, ['mcpServers', 'x'], { command: 'x' });
    expect(JSON.parse(out)).toEqual({ mcpServers: { x: { command: 'x' } } });
    const nested = jsonSet('{\n  "projects": {}\n}\n', ['projects', '/p', 'mcpServers', 'y'], { command: 'y' });
    expect(jsonGet(nested, ['projects', '/p', 'mcpServers', 'y', 'command'])).toBe('y');
  });

  it('keeps comments in JSONC', () => {
    const t = '{\n  // my servers\n  "mcp": {\n    "a": { "command": ["a"] } // pinned\n  }\n}\n';
    const out = jsonSet(t, ['mcp', 'b'], { command: ['b'] });
    expect(out).toContain('// my servers');
    expect(out).toContain('// pinned');
    expect(jsonGet(out, ['mcp', 'b', 'command'])).toEqual(['b']);
  });

  it('replaceMinimal touches only changed keys', () => {
    const out = jsonReplaceMinimal(HAND, ['mcp', 'notes-mcp'], { type: 'local', command: ['notes-mcp'], enabled: false });
    expect(out.split('\n').length).toBe(HAND.split('\n').length + 1);
  });
});
