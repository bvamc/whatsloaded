import { Bot, type LucideIcon, Puzzle, ScrollText, Server, Sparkles, SquareTerminal } from 'lucide-react';
import type { ItemDTO, Kind } from '../api';

export interface HarnessMeta {
  label: string;
  color: string;
}

const HARNESS: Record<string, HarnessMeta> = {
  claude: { label: 'Claude Code', color: '#e07a57' },
  kiro: { label: 'Kiro', color: '#a993f8' },
  codex: { label: 'Codex', color: '#dcd8cc' },
  opencode: { label: 'opencode', color: '#e8c25f' },
  agents: { label: 'Shared store', color: '#74d4d2' },
};

export const harnessMeta = (id: string): HarnessMeta => HARNESS[id] ?? { label: id, color: '#9a9890' };

export const LEVEL_LABEL: Record<string, string> = {
  managed: 'managed',
  user: 'user',
  project: 'project',
  local: 'local',
  plugin: 'plugin',
  agent: 'agent',
  store: 'store',
};

export const LEVEL_ABBR: Record<string, string> = {
  user: 'u',
  project: 'p',
  local: 'l',
  plugin: 'pl',
  agent: 'a',
  managed: 'm',
  store: 's',
};

export const KIND_META: Record<Kind, { label: string; one: string; icon: LucideIcon }> = {
  mcp: { label: 'MCP servers', one: 'MCP server', icon: Server },
  skill: { label: 'Skills', one: 'skill', icon: Sparkles },
  agent: { label: 'Agents', one: 'agent', icon: Bot },
  command: { label: 'Commands', one: 'command', icon: SquareTerminal },
  rule: { label: 'Rules', one: 'rule', icon: ScrollText },
  plugin: { label: 'Plugins', one: 'plugin', icon: Puzzle },
};

export const KIND_ORDER: Kind[] = ['mcp', 'skill', 'agent', 'command', 'rule', 'plugin'];

export const PROBLEM_LABEL: Record<string, string> = {
  'mcp-drift': 'Definition drift',
  'duplicate-instances': 'Duplicate server processes',
  shadowed: 'Shadowed by a narrower scope',
  'unshared-skill': 'Unshared skill copies',
  'orphan-store-skill': 'Store skills nobody links',
  'broken-link': 'Broken symlinks',
  'parse-error': 'Unreadable config',
  'adapter-load': 'Adapter failed to load',
  'adapter-crash': 'Adapter crashed',
  parked: 'Parked by whatsloaded',
};

export function scopeText(i: Pick<ItemDTO, 'level' | 'owner'>): string {
  return i.owner ? `${i.level} · ${i.owner}` : i.level;
}

export function cn(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(' ');
}

export function relTime(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** The name part of a ref (`<harness>:<scope>/<kind>/<name>`); names may contain '/'. */
export const refName = (r: string): string => r.split('/').slice(2).join('/');
