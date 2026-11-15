/**
 * Profiles: named sets of what to keep ("lean": two servers you rely on). Applying one to a tool
 * turns everything else off in a single reviewable, undoable plan, and turns kept items back on.
 *
 * Profiles are stored in ~/.whatsloaded/profiles.json and saved through the change engine, so
 * creating or deleting one also shows a diff and can be undone.
 */
import { join } from 'node:path';
import type { Change } from '../io/changeset.js';
import { isRecord, readJson } from '../io/fsx.js';
import { jsonSet } from '../io/jsonEdit.js';
import type { Ctx } from './context.js';
import type { Inventory } from './inventory.js';
import { type ToolLoad, toolLoads } from './load.js';
import type { Item } from './model.js';
import { type Plan, planToggle } from './ops.js';

export interface Keep {
  mcp: string[];
  skill: string[];
  agent: string[];
  /** Plugin ids, e.g. "toolkit@acme-market". */
  plugin: string[];
}

export interface Profile {
  name: string;
  description?: string;
  keep: Keep;
  createdAt: string;
}

const KEEP_KINDS = ['mcp', 'skill', 'agent'] as const;
export const profilesFile = (ctx: Ctx) => join(ctx.dataDir, 'profiles.json');

export function loadProfiles(ctx: Ctx): Profile[] {
  const r = readJson(profilesFile(ctx));
  if (!r.ok || !isRecord(r.value) || !isRecord(r.value.profiles)) return [];
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return Object.entries(r.value.profiles).flatMap(([name, p]) => {
    if (!isRecord(p) || !isRecord(p.keep)) return [];
    const k = p.keep;
    return [
      {
        name,
        description: typeof p.description === 'string' ? p.description : undefined,
        keep: { mcp: list(k.mcp), skill: list(k.skill), agent: list(k.agent), plugin: list(k.plugin) },
        createdAt: typeof p.createdAt === 'string' ? p.createdAt : '',
      },
    ];
  });
}

export function validProfileName(name: string): boolean {
  return /^[\w.-]{1,40}$/.test(name);
}

export function saveProfile(ctx: Ctx, p: Profile): Change {
  const { name, ...body } = p;
  return {
    op: 'edit',
    file: profilesFile(ctx),
    describe: `save profile "${name}"`,
    transform: (t) => jsonSet(t, ['profiles', name], body),
  };
}

export function deleteProfile(ctx: Ctx, name: string): Change {
  return {
    op: 'edit',
    file: profilesFile(ctx),
    describe: `delete profile "${name}"`,
    transform: (t) => jsonSet(t, ['profiles', name], undefined),
  };
}

/** Items a profile is allowed to switch: your own, unlocked, and never files inside a repo. */
function switchable(i: Item): boolean {
  if (i.role !== 'owned' || i.managedBy || i.locked) return false;
  if (!(KEEP_KINDS as readonly string[]).includes(i.kind)) return false;
  return i.scope.level !== 'project' || i.kind === 'mcp';
}

const live = (t: ToolLoad) =>
  t.sources.flatMap((s) => (s.plugin && !s.plugin.enabled ? [] : s.items.filter((i) => i.enabled && !i.parked)));

/** A profile that keeps what currently loads in a tool. */
export function profileFromCurrent(t: ToolLoad, name: string, now = new Date()): Profile {
  const items = live(t);
  const keep: Keep = { mcp: [], skill: [], agent: [], plugin: [] };
  for (const k of KEEP_KINDS) keep[k] = [...new Set(items.filter((i) => i.kind === k).map((i) => i.name))].sort();
  keep.plugin = t.sources.flatMap((s) => (s.plugin?.enabled ? [s.plugin.name] : [])).sort();
  return { name, description: `What ${t.label} loaded on ${now.toISOString().slice(0, 10)}`, keep, createdAt: now.toISOString() };
}

/** A profile that keeps only what was used in the usage window (and the plugins it came from). */
export function profileFromUsage(t: ToolLoad, name: string, days: number, now = new Date()): Profile {
  const used = live(t).filter((i) => (i.usage?.count ?? 0) > 0);
  const keep: Keep = { mcp: [], skill: [], agent: [], plugin: [] };
  for (const k of KEEP_KINDS) keep[k] = [...new Set(used.filter((i) => i.kind === k).map((i) => i.name))].sort();
  keep.plugin = t.sources
    .filter((s) => s.plugin && (s.items.some((i) => (i.usage?.count ?? 0) > 0) || (s.plugin.usage?.count ?? 0) > 0))
    .map((s) => s.plugin!.name)
    .sort();
  return {
    name,
    description: `What you used in ${t.label} in the ${days} days before ${now.toISOString().slice(0, 10)}`,
    keep,
    createdAt: now.toISOString(),
  };
}

/** Plan applying `profile` to one tool: switch off what it does not keep, back on what it does. */
export function planProfile(inv: Inventory, profile: Profile, harness: string, force = false): Plan {
  const t = toolLoads(inv).find((x) => x.harness === harness);
  if (!t) return { changes: [], warnings: [`${harness} is not installed`] };
  const off: Item[] = [];
  const on: Item[] = [];
  const warnings: string[] = [];
  for (const s of t.sources) {
    if (s.plugin) {
      // Bundles the harness manages itself (e.g. Kiro powers) cannot be switched from here.
      if (s.plugin.locked) continue;
      const want = profile.keep.plugin.includes(s.plugin.name);
      if (want !== s.plugin.enabled) (want ? on : off).push(s.plugin);
      continue;
    }
    for (const i of s.items.filter(switchable)) {
      const want = profile.keep[i.kind as (typeof KEEP_KINDS)[number]].includes(i.name);
      const isOn = i.enabled && !i.parked;
      if (want !== isOn) (want ? on : off).push(i);
    }
  }
  // Kept names this tool cannot provide, so the user is not surprised later.
  const provided = new Set(t.sources.flatMap((s) => s.items.map((i) => `${i.kind}/${i.name}`)));
  for (const k of KEEP_KINDS) {
    for (const name of profile.keep[k]) {
      if (!provided.has(`${k}/${name}`))
        warnings.push(`${name} is in the profile but ${t.label} has no ${k === 'mcp' ? 'server' : k} by that name`);
    }
  }
  for (const name of profile.keep.mcp) {
    const via = t.sources.filter((s) => s.plugin && s.items.some((i) => i.kind === 'mcp' && i.name === name));
    const direct = t.sources.some((s) => !s.plugin && s.items.some((i) => i.kind === 'mcp' && i.name === name));
    if (via.length && !direct && !via.some((s) => profile.keep.plugin.includes(s.plugin!.name))) {
      warnings.push(`${name} only comes from plugins (${via.map((s) => s.label).join(', ')}); keep one of them or it will stop loading`);
    }
  }
  const a = planToggle(inv, off, false, force);
  const b = planToggle(inv, on, true, force);
  return { changes: [...a.changes, ...b.changes], warnings: [...warnings, ...a.warnings, ...b.warnings] };
}
