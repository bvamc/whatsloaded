/**
 * Resolve an MCP server's command to the executable that would run, without running it:
 * absolute paths are checked for existence, bare names are searched on PATH (honouring
 * PATHEXT on Windows), and symlinks are followed to the real installed file.
 */
import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import type { Runtime } from '../model.js';

function executable(p: string): boolean {
  try {
    if (!statSync(p).isFile()) return false;
    if (process.platform !== 'win32') accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function real(p: string): string | undefined {
  try {
    return realpathSync(p);
  } catch {
    return undefined;
  }
}

export type Resolver = (command: string) => Runtime;

/** A memoized resolver over one PATH value (one per inventory collection). */
export function makeResolver(
  pathValue: string | undefined = process.env.PATH,
  pathExt: string | undefined = process.env.PATHEXT,
): Resolver {
  const dirs = (pathValue ?? '').split(delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? ['', ...(pathExt ?? '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.toLowerCase())] : [''];
  const cache = new Map<string, Runtime>();
  return (command) => {
    const hit = cache.get(command);
    if (hit) return hit;
    let out: Runtime;
    if (/\$\{|\$[A-Z_]|%[A-Z_]+%/i.test(command)) {
      out = { command, found: false, unresolved: true };
    } else if (isAbsolute(command)) {
      out = executable(command) ? { command, found: true, resolved: command, realpath: real(command) } : { command, found: false };
    } else if (command.includes('/') || command.includes('\\')) {
      out = { command, found: false, unresolved: true };
    } else {
      out = { command, found: false };
      search: for (const d of dirs) {
        for (const e of exts) {
          const p = join(d, command + e);
          if (executable(p)) {
            out = { command, found: true, resolved: p, realpath: real(p) };
            break search;
          }
        }
      }
    }
    cache.set(command, out);
    return out;
  };
}
