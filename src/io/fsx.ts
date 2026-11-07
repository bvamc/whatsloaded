import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { type ParseError, parse as parseJsonc } from 'jsonc-parser';
import { parse as parseYaml } from 'yaml';

export function readText(p: string): string | null {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

export function isSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Entry exists as a file, dir, or (possibly broken) symlink. */
export function lexists(p: string): boolean {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

export function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function listEntries(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((n) => !n.startsWith('.'))
      .sort();
  } catch {
    return [];
  }
}

export function linkInfo(p: string): { target: string; broken: boolean } | undefined {
  if (!isSymlink(p)) return undefined;
  const raw = readlinkSync(p);
  const target = resolve(dirname(p), raw);
  return { target, broken: !existsSync(target) };
}

export type JsonRead =
  | { ok: true; value: unknown; text: string }
  | { ok: false; missing: true }
  | { ok: false; missing: false; error: string };

/** Parse JSON or JSONC (comments + trailing commas tolerated, as harnesses do). */
export function readJson(p: string): JsonRead {
  const text = readText(p);
  if (text === null) return { ok: false, missing: true };
  const errors: ParseError[] = [];
  const value = parseJsonc(text, errors, { allowTrailingComma: true });
  if (errors.length) return { ok: false, missing: false, error: `JSON parse error at offset ${errors[0]!.offset}` };
  return { ok: true, value, text };
}

/** Parse YAML frontmatter from a markdown file (SKILL.md, agent .md, rule .md). */
export function readFrontmatter(p: string): Record<string, unknown> {
  const text = readText(p);
  if (!text?.startsWith('---')) return {};
  const end = text.indexOf('\n---', 3);
  if (end < 0) return {};
  try {
    const fm = parseYaml(text.slice(3, end));
    return fm && typeof fm === 'object' ? (fm as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function strRecord(v: unknown): Record<string, string> | undefined {
  if (!isRecord(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v)) out[k] = String(x);
  return out;
}

export function strArray(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.map(String) : undefined;
}
