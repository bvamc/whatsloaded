/**
 * skills.sh, the open directory behind the `skills` CLI. Search uses the same endpoint the CLI
 * does; installing runs the CLI itself (pinned to its major version, telemetry off), which puts
 * the skill into each tool you pick.
 */
import { isRecord } from '../io/fsx.js';
import { fetchJson } from './net.js';
import { type CatalogEntry, type CatalogSource, entryId, type Trust } from './types.js';

/** whatsloaded tool id → the skills CLI's name for it. */
const AGENTS: Record<string, string> = {
  claude: 'claude-code',
  codex: 'codex',
  kiro: 'kiro-cli',
  opencode: 'opencode',
  cursor: 'cursor',
  gemini: 'gemini-cli',
};

/** Publishers that make the coding tools themselves. */
const VENDORS = new Set(['anthropics', 'openai', 'vercel-labs', 'github', 'microsoft', 'google-gemini', 'cursor']);

const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9._-]+)?$/;

export function skillEntry(s: Record<string, unknown>): CatalogEntry | undefined {
  const source = typeof s.source === 'string' ? s.source : undefined;
  const skill = typeof s.skillId === 'string' ? s.skillId : typeof s.name === 'string' ? s.name : undefined;
  if (!source || !skill || !SAFE.test(source) || !SAFE.test(skill)) return undefined;
  const owner = source.split('/')[0]!;
  const trust: Trust = VENDORS.has(owner) ? 'verified' : 'community';
  const cli = ['npx', '-y', 'skills@1'];
  return {
    id: entryId('skills-sh', 'skill', `${source}/${skill}`),
    source: 'skills-sh',
    kind: 'skill',
    name: skill,
    installName: `${source}@${skill}`,
    publisher: owner,
    trust,
    url: `https://github.com/${source}`,
    tools: Object.keys(AGENTS),
    install: [
      {
        type: 'command',
        label: 'Install with the skills CLI',
        argv: [...cli, 'add', source, '--skill', skill, '--global', '--yes', '--agent', '{tools}'],
        uninstall: [...cli, 'remove', skill, '--global', '--yes', '--agent', '{tools}'],
        toolArg: AGENTS,
        env: { DISABLE_TELEMETRY: '1' },
      },
    ],
    facts: [
      ['Repository', source],
      ...(typeof s.installs === 'number' ? ([['Installs', s.installs.toLocaleString()]] as [string, string][]) : []),
    ],
  };
}

export const skillsShSource: CatalogSource = {
  id: 'skills-sh',
  label: 'skills.sh',
  description: 'The open directory of agent skills used by the skills CLI',
  kinds: ['skill'],
  access: 'network',
  url: 'https://skills.sh',
  detect: () => true,
  async search(_ctx, q, signal) {
    if (q.kind && q.kind !== 'skill') return { entries: [] };
    const text = q.text?.trim() ?? '';
    if (text.length < 2) return { entries: [], note: 'Type at least 2 letters to search skills.sh.' };
    const body = await fetchJson(`https://skills.sh/api/search?${new URLSearchParams({ q: text })}`, { signal });
    const list = isRecord(body) && Array.isArray(body.skills) ? body.skills.filter(isRecord) : [];
    const entries = list.map(skillEntry).filter((e): e is CatalogEntry => !!e);
    const start = q.cursor ? Number.parseInt(q.cursor, 10) || 0 : 0;
    const limit = q.limit ?? 50;
    return {
      entries: entries.slice(start, start + limit),
      total: entries.length,
      next: start + limit < entries.length ? String(start + limit) : undefined,
    };
  },
};
