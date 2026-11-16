/**
 * Plugin marketplaces you have already added to Claude Code or Codex. Both tools keep each
 * marketplace's catalog on disk in the same `marketplace.json` format, so browsing what is
 * available needs no network, and installing uses the tool's own plugin command.
 */
import { join, resolve } from 'node:path';
import { parse } from 'smol-toml';
import type { Ctx } from '../core/context.js';
import { isDir, isRecord, listEntries, readJson, readText } from '../io/fsx.js';
import { type CatalogEntry, type CatalogSource, entryId, httpUrl, matches, page, rank, type Trust } from './types.js';

interface Marketplace {
  name: string;
  /** Folder holding the marketplace (its catalog and, for local sources, the plugins). */
  root: string;
  /** e.g. "github:anthropics/claude-plugins-official" or a local path. */
  origin: string;
}

const MANIFESTS = ['.claude-plugin/marketplace.json', '.agents/plugins/marketplace.json', 'marketplace.json'];

/** Plugins whose catalog belongs to the tool's own maker are "official"; everything else is listed, not reviewed. */
function trustOf(origin: string, officialOwners: string[]): Trust {
  return officialOwners.some((o) => origin.startsWith(`github:${o}/`)) ? 'official' : 'community';
}

/** What a plugin folder contains: skills, agents, commands and MCP servers, by name. */
function contentsOf(dir: string): CatalogEntry['contents'] {
  if (!isDir(dir)) return undefined;
  const out: NonNullable<CatalogEntry['contents']> = [];
  const skills = listEntries(join(dir, 'skills')).filter((n) => isDir(join(dir, 'skills', n)));
  if (skills.length) out.push({ kind: 'skill', names: skills });
  const md = (sub: string) =>
    listEntries(join(dir, sub))
      .filter((n) => n.endsWith('.md'))
      .map((n) => n.slice(0, -3));
  const agents = md('agents');
  if (agents.length) out.push({ kind: 'agent', names: agents });
  const commands = md('commands');
  if (commands.length) out.push({ kind: 'command', names: commands });
  const mcp = readJson(join(dir, '.mcp.json'));
  if (mcp.ok && isRecord(mcp.value)) {
    const servers = isRecord(mcp.value.mcpServers) ? mcp.value.mcpServers : mcp.value;
    const names = Object.keys(servers).filter((k) => isRecord(servers[k]));
    if (names.length) out.push({ kind: 'mcp', names });
  }
  return out.length ? out : undefined;
}

function readMarketplace(m: Marketplace, tool: 'claude' | 'codex', sourceId: string, officialOwners: string[]): CatalogEntry[] {
  const file = MANIFESTS.map((f) => join(m.root, f)).find((f) => readText(f) !== null);
  if (!file) return [];
  const r = readJson(file);
  if (!r.ok || !isRecord(r.value) || !Array.isArray(r.value.plugins)) return [];
  const owner = isRecord(r.value.owner) && typeof r.value.owner.name === 'string' ? r.value.owner.name : undefined;
  const trust = trustOf(m.origin, officialOwners);
  const cmd = tool === 'claude' ? ['claude', 'plugin'] : ['codex', 'plugin'];
  const out: CatalogEntry[] = [];
  for (const p of r.value.plugins) {
    if (!isRecord(p) || typeof p.name !== 'string') continue;
    const id = `${p.name}@${m.name}`;
    const src = typeof p.source === 'string' ? resolve(m.root, p.source) : undefined;
    const author = isRecord(p.author) && typeof p.author.name === 'string' ? p.author.name : undefined;
    const repo = isRecord(p.source) && typeof p.source.repo === 'string' ? `https://github.com/${p.source.repo}` : undefined;
    out.push({
      id: entryId(sourceId, 'plugin', id),
      source: sourceId,
      kind: 'plugin',
      name: p.name,
      installName: id,
      description: typeof p.description === 'string' ? p.description : undefined,
      publisher: author ?? owner,
      version: typeof p.version === 'string' ? p.version : undefined,
      trust,
      url: httpUrl(p.homepage) ?? httpUrl(p.repository) ?? repo,
      tools: [tool],
      install: [
        {
          type: 'command',
          harness: tool,
          label: `Install with ${tool === 'claude' ? 'Claude Code' : 'Codex'}'s plugin manager`,
          // Claude Code: user scope, so it applies in every project (like everything global here).
          argv: tool === 'claude' ? [...cmd, 'install', id, '--scope', 'user'] : [...cmd, 'add', id],
          uninstall: tool === 'claude' ? [...cmd, 'uninstall', id, '--scope', 'user'] : [...cmd, 'remove', id],
        },
      ],
      facts: [['Marketplace', m.name], ...(typeof p.category === 'string' ? ([['Category', p.category]] as [string, string][]) : [])],
      // Only folders inside the marketplace are read; a plugin fetched from elsewhere shows its contents after install.
      contents: src !== undefined && (src === m.root || src.startsWith(`${m.root}/`)) ? contentsOf(src) : undefined,
    });
  }
  return out;
}

function claudeMarketplaces(ctx: Ctx): Marketplace[] {
  const r = readJson(join(ctx.home, '.claude/plugins/known_marketplaces.json'));
  if (!r.ok || !isRecord(r.value)) return [];
  const out: Marketplace[] = [];
  for (const [name, v] of Object.entries(r.value)) {
    if (!isRecord(v)) continue;
    const s = isRecord(v.source) ? v.source : {};
    const root =
      typeof v.installLocation === 'string'
        ? v.installLocation
        : typeof s.path === 'string'
          ? s.path
          : join(ctx.home, '.claude/plugins/marketplaces', name);
    const origin =
      typeof s.repo === 'string' ? `github:${s.repo}` : typeof s.url === 'string' ? s.url : typeof s.path === 'string' ? s.path : name;
    out.push({ name, root, origin });
  }
  return out;
}

function codexMarketplaces(ctx: Ctx): Marketplace[] {
  const text = readText(join(ctx.home, '.codex/config.toml'));
  if (!text) return [];
  let doc: Record<string, unknown>;
  try {
    doc = parse(text) as Record<string, unknown>;
  } catch {
    return [];
  }
  const m = isRecord(doc.marketplaces) ? doc.marketplaces : {};
  const out: Marketplace[] = [];
  for (const [name, v] of Object.entries(m)) {
    if (!isRecord(v) || typeof v.source !== 'string') continue;
    // Local sources are read in place; Git sources are read from Codex's snapshot when it has one.
    const root = v.source_type === 'local' ? v.source : join(ctx.home, '.codex/plugins/marketplaces', name);
    out.push({ name, root, origin: v.source_type === 'git' ? v.source.replace(/^https:\/\/github\.com\//, 'github:') : v.source });
  }
  return out;
}

function marketplaceSource(
  id: string,
  tool: 'claude' | 'codex',
  label: string,
  list: (ctx: Ctx) => Marketplace[],
  officialOwners: string[],
): CatalogSource {
  return {
    id,
    label,
    description: `Plugin marketplaces you added to ${label.replace(/ marketplaces$/, '')}, read from disk`,
    kinds: ['plugin'],
    access: 'local',
    detect: (ctx) => list(ctx).length > 0,
    async search(ctx, q) {
      if (q.kind && q.kind !== 'plugin') return { entries: [], total: 0 };
      const all = list(ctx).flatMap((m) => readMarketplace(m, tool, id, officialOwners));
      return page(
        rank(
          all.filter((e) => matches(e, q.text)),
          q.text,
        ),
        q,
      );
    },
  };
}

export const claudeMarketplacesSource = marketplaceSource('claude-marketplaces', 'claude', 'Claude Code marketplaces', claudeMarketplaces, [
  'anthropics',
]);
export const codexMarketplacesSource = marketplaceSource('codex-marketplaces', 'codex', 'Codex marketplaces', codexMarketplaces, [
  'openai',
]);
