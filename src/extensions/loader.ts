/**
 * Loads built-in adapters plus user extensions from ~/.whatsloaded/{adapters,providers}/*.{js,mjs}.
 *
 * Extensions run with your privileges, so a file is refused when someone other than you could
 * have written it (world-writable file or directory, or owned by another user on POSIX).
 */
import { statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BUILTIN_ADAPTERS } from '../adapters/index.js';
import { type HarnessAdapter, UnsupportedError } from '../adapters/types.js';
import type { Ctx } from '../core/context.js';
import type { Problem } from '../core/model.js';
import { lexists, listEntries, readFrontmatter, readJson, readText } from '../io/fsx.js';
import type { Provider, ProviderHelpers } from './provider.js';

export interface Extensions {
  adapters: HarnessAdapter[];
  providers: Provider[];
  problems: Problem[];
}

export function makeHelpers(ctx: Ctx): ProviderHelpers {
  const modifiedAt = (p: string) => {
    try {
      return statSync(p).mtime.toISOString();
    } catch {
      return undefined;
    }
  };
  return { ctx, readJson, readText, readFrontmatter, exists: lexists, listEntries, join, modifiedAt };
}

/** Why `path` must not be loaded, or undefined when it is safe. */
function unsafeReason(path: string): string | undefined {
  if (process.platform === 'win32') return undefined;
  const st = statSync(path);
  if (st.mode & 0o002) return 'is writable by other users';
  const uid = process.getuid?.();
  if (uid !== undefined && st.uid !== uid && st.uid !== 0) return 'is owned by another user';
  return undefined;
}

const unsupported = (id: string, what: string) => () => {
  throw new UnsupportedError(`${id} does not support ${what}`);
};

/**
 * Fill optional adapter capabilities so core never has to null-check them. Only
 * `id`, `label`, `detect` and `discover` are required; a read-only adapter is four fields.
 */
export function defineAdapter(a: Partial<HarnessAdapter> & Pick<HarnessAdapter, 'id' | 'label' | 'detect' | 'discover'>): HarnessAdapter {
  return {
    writable: () => [],
    setEnabled: unsupported(a.id, 'enabling or disabling items'),
    remove: unsupported(a.id, 'removing items'),
    putMcp: unsupported(a.id, 'writing MCP servers'),
    linkSkill: unsupported(a.id, 'installing skills'),
    ...a,
  } as HarnessAdapter;
}

async function importDefault(file: string): Promise<unknown> {
  const mod = (await import(pathToFileURL(file).href)) as { default?: unknown };
  return mod.default;
}

function validateAdapter(v: unknown, taken: Set<string>): HarnessAdapter {
  const a = v as Partial<HarnessAdapter> | undefined;
  const missing = (['id', 'label', 'detect', 'discover'] as const).filter((k) => !a || a[k] === undefined);
  if (missing.length) throw new Error(`default export is missing: ${missing.join(', ')}`);
  if (taken.has(a!.id!)) throw new Error(`duplicate adapter id "${a!.id}"`);
  for (const k of ['detect', 'discover', 'writable', 'setEnabled', 'remove', 'putMcp', 'linkSkill'] as const) {
    if (a![k] !== undefined && typeof a![k] !== 'function') throw new Error(`"${k}" must be a function`);
  }
  return defineAdapter(a as HarnessAdapter);
}

function validateProvider(v: unknown, taken: Set<string>): Provider {
  const p = v as Partial<Provider> | undefined;
  if (!p || typeof p.id !== 'string' || typeof p.label !== 'string') throw new Error('default export needs string "id" and "label"');
  if (p.apiVersion !== 1) throw new Error(`unsupported apiVersion ${String(p.apiVersion)} (expected 1)`);
  if (taken.has(p.id)) throw new Error(`duplicate provider id "${p.id}"`);
  for (const k of ['detect', 'claim', 'installer', 'packages', 'ownedPaths', 'planWarnings', 'diagnose'] as const) {
    if (p[k] !== undefined && typeof p[k] !== 'function') throw new Error(`"${k}" must be a function`);
  }
  return p as Provider;
}

export async function loadExtensions(ctx: Ctx): Promise<Extensions> {
  const out: Extensions = { adapters: [...BUILTIN_ADAPTERS], providers: [], problems: [] };
  if (!ctx.extensions) return out;

  for (const kind of ['adapters', 'providers'] as const) {
    const dir = join(ctx.dataDir, kind);
    const files = listEntries(dir).filter((n) => /\.m?js$/.test(n));
    if (!files.length) continue;
    const dirIssue = unsafeReason(dir);
    if (dirIssue) {
      out.problems.push({ severity: 'error', code: 'extension-unsafe', message: `not loading ${kind}: ${dir} ${dirIssue}`, file: dir });
      continue;
    }
    const taken = new Set((kind === 'adapters' ? out.adapters : out.providers).map((x) => x.id));
    for (const f of files) {
      const file = join(dir, f);
      try {
        const issue = unsafeReason(file);
        if (issue) throw new Error(`refusing to load: file ${issue}`);
        const v = await importDefault(file);
        if (kind === 'adapters') {
          const a = validateAdapter(v, taken);
          out.adapters.push(a);
          taken.add(a.id);
        } else {
          const p = validateProvider(v, taken);
          out.providers.push(p);
          taken.add(p.id);
        }
      } catch (e) {
        out.problems.push({
          severity: 'error',
          code: `${kind === 'adapters' ? 'adapter' : 'provider'}-load`,
          message: `${basename(file)}: ${(e as Error).message}`,
          file,
        });
      }
    }
  }
  return out;
}
