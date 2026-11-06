/** User configuration: ~/.whatsloaded/config.json. Every field is optional; unknown keys are ignored. */
import { join } from 'node:path';
import { isRecord, readJson } from '../io/fsx.js';
import type { Ctx } from './context.js';
import type { Problem } from './model.js';

export interface CompareOptions {
  /** Env var names (globs, e.g. "*_KIRO") whose presence or value never counts as drift. */
  ignoreEnvKeys: string[];
}

export interface Config {
  compare: CompareOptions;
}

export const DEFAULT_CONFIG: Config = { compare: { ignoreEnvKeys: [] } };

export function loadConfig(ctx: Ctx): { config: Config; problems: Problem[] } {
  const file = join(ctx.dataDir, 'config.json');
  const r = readJson(file);
  if (!r.ok)
    return {
      config: DEFAULT_CONFIG,
      problems: r.missing ? [] : [{ severity: 'error', code: 'config-invalid', message: `${file}: ${r.error}`, file }],
    };
  const v = isRecord(r.value) ? r.value : {};
  const compare = isRecord(v.compare) ? v.compare : {};
  const ignore = Array.isArray(compare.ignoreEnvKeys) ? compare.ignoreEnvKeys.filter((x): x is string => typeof x === 'string') : [];
  return { config: { compare: { ignoreEnvKeys: ignore } }, problems: [] };
}
