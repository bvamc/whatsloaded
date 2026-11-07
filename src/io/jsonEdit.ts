/**
 * Minimal-diff JSON/JSONC editing.
 *
 * jsonc-parser's `modify()` re-formats every line an edit touches, which rewrites
 * hand-formatted neighbours (e.g. `"command" : [ "x" ]`). Instead we splice text at exact
 * syntax-tree offsets and mimic the file's own indentation and `key: value` separator.
 */
import { isDeepStrictEqual } from 'node:util';
import { findNodeAtLocation, type JSONPath, type Node, parse, parseTree } from 'jsonc-parser';

function indentUnit(text: string): string {
  const ws = text.match(/\n([ \t]+)\S/)?.[1];
  if (!ws) return '  ';
  return ws.startsWith('\t') ? '\t' : ws;
}

function lineIndent(text: string, offset: number): string {
  const start = text.lastIndexOf('\n', offset - 1) + 1;
  return text.slice(start).match(/^[ \t]*/)![0];
}

/** The separator between key and value in an existing property, e.g. ': ' or ' : '. */
function separatorOf(text: string, prop: Node | undefined): string {
  const [k, v] = prop?.children ?? [];
  if (!k || !v) return ': ';
  const sep = text.slice(k.offset + k.length, v.offset);
  return /^\s*:\s*$/.test(sep) && !sep.includes('\n') ? sep : ': ';
}

function serialize(value: unknown, unit: string, baseIndent: string, sep: string): string {
  let s = JSON.stringify(value, null, unit);
  if (sep !== ': ') s = s.replace(/^(\s*"(?:[^"\\]|\\.)*"): /gm, `$1${sep}`);
  return s.replace(/\n/g, `\n${baseIndent}`);
}

function tree(text: string): Node {
  const root = parseTree(text, [], { allowTrailingComma: true });
  if (!root) throw new Error('file is not valid JSON');
  return root;
}

function removeNode(text: string, node: Node): string {
  const parent = node.parent!;
  const kids = parent.children!;
  const i = kids.indexOf(node);
  if (kids.length === 1) return text.slice(0, parent.offset + 1) + text.slice(parent.offset + parent.length - 1);
  if (i > 0) {
    const prev = kids[i - 1]!;
    return text.slice(0, prev.offset + prev.length) + text.slice(node.offset + node.length);
  }
  return text.slice(0, node.offset) + text.slice(kids[1]!.offset);
}

function insertProperty(text: string, obj: Node, key: string, value: unknown): string {
  const unit = indentUnit(text);
  const kids = obj.children ?? [];
  const last = kids.at(-1);
  if (last) {
    const indent = lineIndent(text, last.offset);
    const sep = separatorOf(text, last);
    const inline = !text.slice(obj.offset, last.offset).includes('\n');
    const at = last.offset + last.length;
    return (
      text.slice(0, at) +
      (inline ? ', ' : `,\n${indent}`) +
      JSON.stringify(key) +
      sep +
      serialize(value, unit, indent, sep) +
      text.slice(at)
    );
  }
  const outer = lineIndent(text, obj.offset);
  const inner = outer + unit;
  const open = obj.offset + 1;
  const close = obj.offset + obj.length - 1;
  return `${text.slice(0, open)}\n${inner}${JSON.stringify(key)}: ${serialize(value, unit, inner, ': ')}\n${outer}${text.slice(close)}`;
}

/** Set (or with `undefined`, remove) the value at `path`, creating parent objects as needed. */
export function jsonSet(text: string | null, path: JSONPath, value: unknown): string {
  const base = text?.trim() ? text : '{}\n';
  const root = tree(base);
  const node = findNodeAtLocation(root, path);
  if (node) {
    const holder = node.parent?.type === 'property' ? node.parent : node;
    if (value === undefined) return removeNode(base, holder);
    const indent = lineIndent(base, holder.offset);
    return (
      base.slice(0, node.offset) +
      serialize(value, indentUnit(base), indent, separatorOf(base, holder)) +
      base.slice(node.offset + node.length)
    );
  }
  if (value === undefined) return base;
  const parentPath = path.slice(0, -1);
  const parent = parentPath.length ? findNodeAtLocation(root, parentPath) : root;
  if (!parent) return jsonSet(base, parentPath, { [String(path.at(-1))]: value });
  if (parent.type !== 'object') throw new Error(`cannot set ${path.join('.')}: parent is not an object`);
  return insertProperty(base, parent, String(path.at(-1)), value);
}

export function jsonGet(text: string | null, path: JSONPath): unknown {
  if (!text) return undefined;
  let cur: unknown = parse(text, [], { allowTrailingComma: true });
  for (const k of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[k];
  }
  return cur;
}

/**
 * Replace the object at `path` with `next`, rewriting only keys whose values changed, so
 * toggling `enabled` inserts one line instead of re-emitting the whole entry.
 */
export function jsonReplaceMinimal(text: string | null, path: JSONPath, next: unknown): string {
  const cur = jsonGet(text, path);
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!isObj(cur) || !isObj(next)) return jsonSet(text, path, next);
  let t = text ?? '';
  for (const k of Object.keys(cur)) if (!(k in next)) t = jsonSet(t, [...path, k], undefined);
  for (const [k, v] of Object.entries(next)) if (!isDeepStrictEqual(cur[k], v)) t = jsonSet(t, [...path, k], v);
  return t;
}
