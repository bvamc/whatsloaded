import { describe, expect, it } from 'vitest';
import { compareMcp } from '../src/core/compare.js';
import type { McpSpec } from '../src/core/model.js';

const base: McpSpec = { transport: 'stdio', command: 'notes-mcp', args: ['--port', '1'], env: { A: '1', B: '2' } };

describe('compareMcp', () => {
  it.each<[string, McpSpec, McpSpec, ReturnType<typeof compareMcp>]>([
    ['same spec', base, { ...base }, 'identical'],
    ['missing vs empty args', { transport: 'stdio', command: 'x' }, { transport: 'stdio', command: 'x', args: [] }, 'cosmetic'],
    ['missing vs empty env', { transport: 'stdio', command: 'x' }, { transport: 'stdio', command: 'x', env: {} }, 'cosmetic'],
    ['env key order', base, { ...base, env: { B: '2', A: '1' } }, 'identical'],
    ['only disabledTools differs', base, { ...base, disabledTools: ['delete_all'] }, 'cosmetic'],
    ['different command', base, { ...base, command: 'other' }, 'drift'],
    ['different args', base, { ...base, args: ['--port', '2'] }, 'drift'],
    ['arg order matters', base, { ...base, args: ['1', '--port'] }, 'drift'],
    ['different env value', base, { ...base, env: { A: '1', B: '3' } }, 'drift'],
    ['extra env key', base, { ...base, env: { A: '1', B: '2', C: '3' } }, 'drift'],
    ['different url', { transport: 'http', url: 'https://a' }, { transport: 'http', url: 'https://b' }, 'drift'],
    ['different transport', { transport: 'http', url: 'https://a' }, { transport: 'sse', url: 'https://a' }, 'drift'],
  ])('%s', (_label, a, b, want) => {
    expect(compareMcp(a, b)).toBe(want);
    expect(compareMcp(b, a)).toBe(want);
  });

  it('ignores env keys matching configured globs', () => {
    const kiroish = { ...base, env: { ...base.env, CALLBACK_URL_KIRO: 'http://x' } };
    expect(compareMcp(base, kiroish)).toBe('drift');
    expect(compareMcp(base, kiroish, { ignoreEnvKeys: ['*_KIRO'] })).toBe('cosmetic');
  });
});
