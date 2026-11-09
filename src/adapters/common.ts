import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Ctx } from '../core/context.js';
import type { Item, Kind, Problem, Scope } from '../core/model.js';
import { ref } from '../core/model.js';
import type { Change } from '../io/changeset.js';
import { isDir, isRecord, lexists, linkInfo, listEntries, readFrontmatter, readJson, readText } from '../io/fsx.js';
import { jsonGet, jsonSet } from '../io/jsonEdit.js';
import { UnsupportedError } from './types.js';

// ---------------------------------------------------------------------------------------
// Parking: emulates "disabled" for harnesses with no native toggle (Claude skills, user MCPs).
// Path items are moved to ~/.whatsloaded/parked/paths/<encoded original path>, so the original
// location is recoverable from the filename alone, with no index to corrupt.
// Config entries are stashed in ~/.whatsloaded/parked/entries.json keyed by file#jsonPath.
// ---------------------------------------------------------------------------------------

const parkedPathsDir = (ctx: Ctx) => join(ctx.dataDir, 'parked', 'paths');
export const parkedEntriesFile = (ctx: Ctx) => join(ctx.dataDir, 'parked', 'entries.json');

export const parkedPathFor = (ctx: Ctx, original: string) => join(parkedPathsDir(ctx), encodeURIComponent(original));

export function listParkedPaths(ctx: Ctx): { original: string; parked: string }[] {
  try {
    return readdirSync(parkedPathsDir(ctx)).map((n) => ({ original: decodeURIComponent(n), parked: join(parkedPathsDir(ctx), n) }));
  } catch {
    return [];
  }
}

export interface ParkedEntry {
  file: string;
  path: string[];
  value: unknown;
}

const entryKey = (file: string, path: string[]) => `${file}#${path.join('/')}`;

export function listParkedEntries(ctx: Ctx): ParkedEntry[] {
  const r = readJson(parkedEntriesFile(ctx));
  if (!r.ok || !isRecord(r.value)) return [];
  return Object.values(r.value).filter((e): e is ParkedEntry => isRecord(e) && typeof e.file === 'string' && Array.isArray(e.path));
}

/** Changes that move a JSON config entry into the parked store. */
export function parkEntry(ctx: Ctx, item: Item): Change[] {
  const { file, path } = item.location;
  if (!path) throw new UnsupportedError(`${ref(item)} is not a config entry`);
  const value = jsonGet(readText(file), path);
  return [
    {
      op: 'edit',
      file: parkedEntriesFile(ctx),
      describe: `stash ${ref(item)} in whatsloaded parked store`,
      transform: (t) => jsonSet(t, [entryKey(file, path)], { file, path, value }),
    },
    { op: 'edit', file, describe: `remove ${path.join('.')} from ${file}`, transform: (t) => jsonSet(t, path, undefined) },
  ];
}

export function unparkEntry(ctx: Ctx, item: Item, entry: ParkedEntry): Change[] {
  return [
    {
      op: 'edit',
      file: entry.file,
      describe: `restore ${entry.path.join('.')} in ${entry.file}`,
      transform: (t) => jsonSet(t, entry.path, entry.value),
    },
    {
      op: 'edit',
      file: parkedEntriesFile(ctx),
      describe: `drop ${ref(item)} from parked store`,
      transform: (t) => jsonSet(t, [entryKey(entry.file, entry.path)], undefined),
    },
  ];
}

/** Default enable/disable for path-based items: move them in and out of the parked store. */
export function parkPathToggle(ctx: Ctx, item: Item, enabled: boolean, originalPath: (i: Item) => string): Change[] {
  if (item.enabled === enabled) return [];
  if (enabled) {
    if (!item.parked) throw new UnsupportedError(`${ref(item)} is disabled by its harness, not by whatsloaded`);
    return [{ op: 'move', from: item.location.file, to: originalPath(item), describe: `unpark ${ref(item)}` }];
  }
  return [{ op: 'move', from: item.location.file, to: parkedPathFor(ctx, item.location.file), describe: `park ${ref(item)} (disable)` }];
}

// ---------------------------------------------------------------------------------------
// Directory scanning
// ---------------------------------------------------------------------------------------

export type EntryMode =
  /** Each child dir containing SKILL.md is an item (skills). */
  | 'skill-dirs'
  /** Each *.md file directly in dir is an item (Claude agents/commands). */
  | 'md-files'
  /** Every *.md file under dir, recursively; name is the relative path (Kiro steering, rules). */
  | 'md-tree'
  /** Each *.json file directly in dir is an item (Kiro agents). */
  | 'json-files';

export interface DirSpec {
  dir: string;
  kind: Kind;
  scope: Scope;
  mode: EntryMode;
}

function nameFor(mode: EntryMode, dir: string, path: string): string {
  const rel = relative(dir, path).split(sep).join('/');
  return mode === 'skill-dirs' ? rel : rel.replace(/\.(md|json)$/, '');
}

function mdTree(dir: string): string[] {
  const out: string[] = [];
  for (const n of listEntries(dir)) {
    const p = join(dir, n);
    if (isDir(p)) out.push(...mdTree(p));
    else if (n.endsWith('.md')) out.push(p);
  }
  return out;
}

function itemAt(spec: DirSpec, path: string, parkedFrom?: string): Item | undefined {
  const { mode, kind, scope } = spec;
  const link = linkInfo(path);
  const identity = parkedFrom ?? path;
  let description: string | undefined;
  let skill: Item['skill'];
  if (mode === 'skill-dirs') {
    const fm = readFrontmatter(join(path, 'SKILL.md'));
    if (!link?.broken && !lexists(join(path, 'SKILL.md'))) return undefined;
    description = typeof fm.description === 'string' ? fm.description : undefined;
    // `disable-model-invocation: true`: only you start it (e.g. /name); the model never picks it.
    skill = { userOnly: fm['disable-model-invocation'] === true, bodyChars: readText(join(path, 'SKILL.md'))?.length ?? 0 };
  } else if (mode === 'json-files') {
    const r = readJson(path);
    if (r.ok && isRecord(r.value) && typeof r.value.description === 'string') description = r.value.description;
  } else {
    const fm = readFrontmatter(path);
    description = typeof fm.description === 'string' ? fm.description : undefined;
  }
  return {
    kind,
    name: nameFor(mode, spec.dir, identity),
    scope,
    enabled: !parkedFrom,
    parked: parkedFrom ? true : undefined,
    location: { file: path },
    description: description?.trim(),
    link,
    skill,
  };
}

/** Scan a harness directory, including items whatsloaded parked from it. */
export function scanDir(spec: DirSpec, ctx: Ctx): Item[] {
  const { dir, mode } = spec;
  const paths =
    mode === 'md-tree'
      ? mdTree(dir)
      : listEntries(dir)
          .map((n) => join(dir, n))
          .filter((p) => (mode === 'md-files' ? p.endsWith('.md') : mode === 'json-files' ? p.endsWith('.json') : true));
  const items = paths.flatMap((p) => itemAt(spec, p) ?? []);
  for (const { original, parked } of listParkedPaths(ctx)) {
    if (!original.startsWith(dir + sep)) continue;
    const it = itemAt(spec, parked, original);
    if (it) items.push(it);
  }
  return items;
}

export function brokenLinkProblems(items: Item[]): Problem[] {
  return items
    .filter((i) => i.link?.broken)
    .map((i) => ({
      severity: 'error',
      code: 'broken-link',
      message: `${ref(i)} is a symlink to missing ${i.link!.target}`,
      file: i.location.file,
      refs: [ref(i)],
    }));
}

export function parseProblem(file: string, error: string): Problem {
  return { severity: 'error', code: 'parse-error', message: `${file}: ${error}`, file };
}

/**
 * An instruction file the harness loads whole into context (CLAUDE.md, AGENTS.md). Shown and
 * counted, but locked: switching it off would mean moving a file you or your repo maintain.
 */
export function instructionFile(file: string, scope: Scope, name: string): Item | undefined {
  if (!lexists(file)) return undefined;
  return {
    kind: 'rule',
    name,
    scope,
    enabled: true,
    location: { file },
    description: 'Instructions loaded at the start of every session',
    locked: 'Instruction files load whole; edit the file to change what it says',
  };
}
