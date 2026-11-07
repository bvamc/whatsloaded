/**
 * Surgical, line-based TOML editing for `[a.b.c]`-style tables.
 *
 * General-purpose TOML patchers re-emit the document and lose comments/ordering, which is
 * unacceptable for hand-maintained files like ~/.codex/config.toml. Instead we only touch
 * the lines we must, then *prove* the edit by re-parsing and comparing against the intended
 * semantic change (see `verifiedEdit`). Any layout we can't edit safely throws.
 */
import { isDeepStrictEqual } from 'node:util';
import { parse, stringify } from 'smol-toml';

export class TomlLayoutError extends Error {}

type Header = { line: number; path: string[]; array: boolean };

/** Split a dotted TOML key (`a."b.c".'d'`) into segments. */
export function parseDottedKey(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  let cur = '';
  let started = false;
  const s = src.trim();
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === '"') {
      let j = i + 1;
      let buf = '';
      while (j < s.length && s[j] !== '"') {
        if (s[j] === '\\') {
          buf += JSON.parse(`"${s.slice(j, j + 2)}"`);
          j += 2;
        } else buf += s[j++];
      }
      cur += buf;
      started = true;
      i = j + 1;
    } else if (ch === "'") {
      const j = s.indexOf("'", i + 1);
      cur += s.slice(i + 1, j);
      started = true;
      i = j + 1;
    } else if (ch === '.') {
      out.push(cur);
      cur = '';
      started = false;
      i++;
    } else if (ch === ' ' || ch === '\t') {
      i++;
    } else {
      cur += ch;
      started = true;
      i++;
    }
  }
  if (started || cur) out.push(cur);
  return out;
}

export function quoteKey(k: string): string {
  return /^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k);
}

function headers(lines: string[]): Header[] {
  const out: Header[] = [];
  for (const [line, l] of lines.entries()) {
    const arr = l.match(/^\s*\[\[([^\]]+)\]\]\s*(#.*)?$/);
    if (arr) {
      out.push({ line, path: parseDottedKey(arr[1]!), array: true });
      continue;
    }
    const std = l.match(/^\s*\[([^[\]]+)\]\s*(#.*)?$/);
    if (std) out.push({ line, path: parseDottedKey(std[1]!), array: false });
  }
  return out;
}

const startsWith = (p: string[], prefix: string[]) => prefix.every((k, i) => p[i] === k);

/** Line range [start, end) of a table's own body (excluding subtables). */
function tableRange(lines: string[], path: string[]): { start: number; end: number } | undefined {
  const hs = headers(lines);
  const idx = hs.findIndex((h) => !h.array && isDeepStrictEqual(h.path, path));
  if (idx < 0) return undefined;
  const end = hs[idx + 1]?.line ?? lines.length;
  return { start: hs[idx]!.line, end };
}

function valueToToml(v: unknown): string {
  // smol-toml serializes a one-key object as `x = <value>`; take the value side.
  const line = stringify({ x: v }).trim();
  return line.slice(line.indexOf('=') + 1).trim();
}

/** Set or remove (`undefined`) `key` inside the `[path]` table. */
export function setTableKey(text: string, path: string[], key: string, value: unknown): string {
  const lines = text.split('\n');
  const r = tableRange(lines, path);
  if (!r) throw new TomlLayoutError(`table [${path.join('.')}] is not written as a standalone [header]`);
  const keyRe = new RegExp(`^\\s*(${escapeRe(quoteKey(key))}|${escapeRe(JSON.stringify(key))})\\s*=`);
  const at = lines.findIndex((l, i) => i > r.start && i < r.end && keyRe.test(l));
  if (value === undefined) {
    if (at >= 0) lines.splice(at, 1);
  } else {
    const newLine = `${quoteKey(key)} = ${valueToToml(value)}`;
    if (at >= 0) {
      const comment = lines[at]!.match(/\s+#[^"']*$/)?.[0] ?? '';
      lines[at] = newLine + comment;
    } else {
      // Insert after the last non-blank line of the table body.
      let ins = r.end;
      while (ins - 1 > r.start && lines[ins - 1]!.trim() === '') ins--;
      lines.splice(ins, 0, newLine);
    }
  }
  return lines.join('\n');
}

/** Remove `[path]` and every `[path.*]` subtable. */
export function removeTable(text: string, path: string[]): string {
  const lines = text.split('\n');
  const hs = headers(lines);
  const drop = new Set<number>();
  hs.forEach((h, i) => {
    if (!startsWith(h.path, path)) return;
    const end = hs[i + 1]?.line ?? lines.length;
    for (let l = h.line; l < end; l++) drop.add(l);
  });
  if (!drop.size) throw new TomlLayoutError(`table [${path.join('.')}] is not written as a standalone [header]`);
  return lines
    .filter((_, i) => !drop.has(i))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

/** Append `[path]` with scalar keys, and nested objects as `[path.sub]` subtables. */
export function appendTable(text: string, path: string[], obj: Record<string, unknown>): string {
  const block: string[] = [];
  const emit = (p: string[], o: Record<string, unknown>) => {
    block.push(`[${p.map(quoteKey).join('.')}]`);
    const nested: [string, Record<string, unknown>][] = [];
    for (const [k, v] of Object.entries(o)) {
      if (v === undefined) continue;
      if (v && typeof v === 'object' && !Array.isArray(v)) nested.push([k, v as Record<string, unknown>]);
      else block.push(`${quoteKey(k)} = ${valueToToml(v)}`);
    }
    for (const [k, v] of nested) {
      block.push('');
      emit([...p, k], v);
    }
  };
  emit(path, obj);
  const base = text.replace(/\s*$/, '');
  return `${base}${base ? '\n\n' : ''}${block.join('\n')}\n`;
}

/**
 * Run a surgical edit and verify it produced exactly the intended semantic change.
 * `expect` mutates a parsed copy of the original; the edited text must parse to the same value.
 */
export function verifiedEdit(before: string, edit: (text: string) => string, expect: (doc: Record<string, unknown>) => void): string {
  const after = edit(before);
  const want = parse(before) as Record<string, unknown>;
  expect(want);
  const got = parse(after);
  if (!isDeepStrictEqual(JSON.parse(JSON.stringify(got)), JSON.parse(JSON.stringify(want)))) {
    throw new TomlLayoutError('surgical TOML edit did not produce the expected document; refusing to write');
  }
  return after;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
