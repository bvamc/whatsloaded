/**
 * Cross-harness operations. Each returns a Plan (changes + warnings); nothing touches disk
 * until the CLI hands the plan to `apply` after preview/confirmation.
 */
import { dirname, join, relative } from 'node:path';
import { storeDir } from '../adapters/agentsStore.js';
import { lossyFields } from '../adapters/codecs.js';
import { UnsupportedError } from '../adapters/types.js';
import type { PlanActionName } from '../extensions/provider.js';
import type { Change } from '../io/changeset.js';
import { lexists, linkInfo } from '../io/fsx.js';
import { compareMcp } from './compare.js';
import { adapterFor, type Inventory } from './inventory.js';
import type { Item } from './model.js';
import { ref, refName } from './model.js';
import type { Target } from './select.js';

export interface Plan {
  changes: Change[];
  warnings: string[];
}

export class ManagedError extends Error {}

const empty = (): Plan => ({ changes: [], warnings: [] });

/** Notes from the item's owner claim plus any provider-specific warnings for this action. */
function providerWarnings(inv: Inventory, item: Item, action: PlanActionName): string[] {
  const out: string[] = [];
  const note = item.provenance?.owner?.note;
  if (note) out.push(`${ref(item)}: ${note}`);
  for (const p of inv.providers) {
    try {
      out.push(...(p.planWarnings?.(item, action, inv.helpers) ?? []));
    } catch (e) {
      out.push(`provider ${p.id} failed: ${(e as Error).message}`);
    }
  }
  return out;
}

function guard(item: Item, force: boolean): void {
  if (item.locked) throw new UnsupportedError(`${ref(item)}: ${item.locked}`);
  if (item.managedBy && !force) {
    throw new ManagedError(
      `${ref(item)} is managed by ${item.managedBy}; its owner may overwrite your change. Re-run with --force to do it anyway.`,
    );
  }
}

/** Run `fn`, turning UnsupportedError into a warning so one bad item doesn't sink a batch. */
function attempt(plan: Plan, label: string, fn: () => Change[]): void {
  try {
    plan.changes.push(...fn());
  } catch (e) {
    if (e instanceof UnsupportedError) plan.warnings.push(`skipped ${label}: ${e.message}`);
    else throw e;
  }
}

/** Collapse identical provider notes (the same "may re-enable it" twenty times) into one line per note. */
function mergeNotes(warnings: string[]): string[] {
  const byNote = new Map<string, string[]>();
  const rest: string[] = [];
  for (const w of warnings) {
    const m = w.match(/^(\S+?): (.+)$/);
    if (m && /^[\w-]+:[\w@-]+\/\w+\//.test(m[1]!)) byNote.set(m[2]!, [...(byNote.get(m[2]!) ?? []), m[1]!]);
    else rest.push(w);
  }
  const merged = [...byNote].map(([note, refs]) =>
    refs.length === 1
      ? `${refs[0]}: ${note}`
      : `${refs.length} items: ${note} (${refs
          .map((r) => refName(r))
          .slice(0, 4)
          .join(', ')}${refs.length > 4 ? ', …' : ''})`,
  );
  return [...merged, ...rest];
}

export function planToggle(inv: Inventory, items: Item[], enabled: boolean, force = false): Plan {
  const plan = empty();
  for (const i of items) {
    if (i.enabled === enabled) {
      plan.warnings.push(`${ref(i)} is already ${enabled ? 'enabled' : 'disabled'}`);
      continue;
    }
    guard(i, force);
    plan.warnings.push(...providerWarnings(inv, i, enabled ? 'enable' : 'disable'));
    attempt(plan, ref(i), () => adapterFor(inv, i.scope.harness).setEnabled(i, enabled, inv.ctx));
  }
  plan.warnings = mergeNotes(plan.warnings);
  return plan;
}

export function planRemove(inv: Inventory, items: Item[], force = false): Plan {
  const plan = empty();
  for (const i of items) {
    guard(i, force);
    plan.warnings.push(...providerWarnings(inv, i, 'remove'));
    attempt(plan, ref(i), () => adapterFor(inv, i.scope.harness).remove(i, inv.ctx));
  }
  return plan;
}

const findAt = (inv: Inventory, kind: Item['kind'], name: string, t: Target) =>
  inv.items.find((i) => i.kind === kind && i.name === name && i.scope.harness === t.harness && i.scope.level === t.level);

/** Resolve a skill item to the real directory it represents. */
function skillSource(item: Item): string {
  if (item.link) {
    if (item.link.broken) throw new UnsupportedError(`${ref(item)} is a broken symlink`);
    return item.link.target;
  }
  return item.location.file;
}

export function planCopy(inv: Inventory, item: Item, targets: Target[], opts: { overwrite?: boolean } = {}): Plan {
  const plan = empty();
  for (const t of targets) {
    const label = `${t.harness}:${t.level}`;
    if (t.harness === item.scope.harness && t.level === item.scope.level) {
      plan.warnings.push(`skipped ${label}: same as source`);
      continue;
    }
    const adapter = adapterFor(inv, t.harness);
    if (!adapter.writable(item.kind, inv.ctx).includes(t.level)) {
      plan.warnings.push(
        `skipped ${label}: ${adapter.label} cannot hold ${item.kind}s at ${t.level} scope${t.level !== 'user' && !inv.ctx.project ? ' (no project selected: pass -C <dir> or pick one in the UI)' : ''}`,
      );
      continue;
    }
    const existing = findAt(inv, item.kind, item.name, t);

    if (item.kind === 'mcp') {
      const spec = item.mcp!;
      if (existing && !opts.overwrite) {
        const d = compareMcp(spec, existing.mcp!, inv.config.compare);
        plan.warnings.push(
          `skipped ${label}: ${item.name} already exists there (${d})${d === 'drift' ? '; use --overwrite or `sync`' : ''}`,
        );
        continue;
      }
      if (existing) guard(existing, false);
      const lost = lossyFields(spec, t.harness as 'claude');
      if (lost.length) plan.warnings.push(`${label}: cannot represent ${lost.join(', ')}`);
      attempt(plan, label, () => adapter.putMcp(item.name, spec, t.level, inv.ctx, { enabled: item.enabled, existing }));
    } else if (item.kind === 'skill') {
      const source = skillSource(item);
      if (existing) {
        const sameTarget = (existing.link?.target ?? existing.location.file) === source;
        if (sameTarget) {
          plan.warnings.push(`skipped ${label}: already linked to ${source}`);
          continue;
        }
        if (!opts.overwrite) {
          plan.warnings.push(`skipped ${label}: a different ${item.name} already exists there (use --overwrite)`);
          continue;
        }
        guard(existing, false);
        plan.changes.push({ op: 'trash', path: existing.location.file, describe: `replace ${ref(existing)} (kept in backup)` });
      }
      attempt(plan, label, () => adapter.linkSkill(item.name, source, t.level, inv.ctx));
    } else {
      plan.warnings.push(`skipped ${label}: copying ${item.kind}s between harnesses is not supported yet`);
    }
  }
  return plan;
}

export function planMove(inv: Inventory, item: Item, target: Target, force = false): Plan {
  guard(item, force);
  const copy = planCopy(inv, item, [target]);
  if (!copy.changes.length) return copy;
  const rm = planRemove(inv, [item], force);
  return { changes: [...copy.changes, ...rm.changes], warnings: [...copy.warnings, ...rm.warnings] };
}

/**
 * Make your other configurations of an MCP server match `source`, keeping each entry's enabled
 * state and harness-only fields. Plugin-bundled entries are never touched; agent profiles only
 * with `includeAgentProfiles` (an agent carrying its own launch settings usually means it).
 */
export function planSync(inv: Inventory, source: Item, force = false, opts: { includeAgentProfiles?: boolean } = {}): Plan {
  const plan = empty();
  if (source.kind !== 'mcp') throw new UnsupportedError('sync currently supports MCP servers only');
  const all = inv.items.filter((i) => i.kind === 'mcp' && i.name === source.name && i !== source);
  const others = all.filter((i) => i.role === 'owned' || (opts.includeAgentProfiles && i.role === 'agent-profile'));
  const profiles = all.filter((i) => i.role === 'agent-profile').length;
  const bundled = all.filter((i) => i.role === 'bundled').length;
  if (profiles && !opts.includeAgentProfiles) {
    plan.warnings.push(
      `left ${profiles} agent profile(s) unchanged (they customize ${source.name} per agent; --include-agents rewrites them too)`,
    );
  }
  if (bundled) plan.warnings.push(`left ${bundled} plugin configuration(s) unchanged (owned by their plugins)`);
  for (const o of others) {
    const d = compareMcp(source.mcp!, o.mcp!, inv.config.compare);
    if (d !== 'drift') continue;
    if (o.parked) {
      plan.warnings.push(`skipped ${ref(o)}: parked (enable it first)`);
      continue;
    }
    if (o.managedBy && !force) {
      plan.warnings.push(`skipped ${ref(o)}: managed by ${o.managedBy} (use --force)`);
      continue;
    }
    plan.warnings.push(...providerWarnings(inv, o, 'sync'));
    attempt(plan, ref(o), () =>
      adapterFor(inv, o.scope.harness).putMcp(o.name, source.mcp!, o.scope.level, inv.ctx, { enabled: o.enabled, existing: o }),
    );
  }
  if (!plan.changes.length && !plan.warnings.length) plan.warnings.push(`every copy of ${source.name} already matches ${ref(source)}`);
  return plan;
}

/**
 * Move a harness-local skill directory into the shared store and leave a symlink behind,
 * so other harnesses can link the same copy instead of keeping divergent duplicates.
 */
export function planAdopt(inv: Inventory, item: Item, force = false): Plan {
  if (item.kind !== 'skill') throw new UnsupportedError('only skills can be adopted into the shared store');
  if (item.scope.harness === 'agents') throw new UnsupportedError(`${ref(item)} is already in the shared store`);
  if (item.scope.level === 'plugin') throw new UnsupportedError(`${ref(item)} belongs to a plugin`);
  if (item.parked) throw new UnsupportedError(`${ref(item)} is parked; enable it first`);
  guard(item, force);
  const store = join(storeDir(inv.ctx), item.name);
  const here = item.location.file;
  if (item.link) {
    if (item.link.target === store) return { changes: [], warnings: [`${ref(item)} already links to the shared store`] };
    throw new UnsupportedError(`${ref(item)} is a symlink to ${item.link.target}; adopt the target instead`);
  }
  if (lexists(store)) {
    const what = linkInfo(store) ? 'a symlink' : 'a skill';
    throw new UnsupportedError(`the shared store already has ${what} named ${item.name}; compare them and remove one first`);
  }
  return {
    changes: [
      { op: 'move', from: here, to: store, describe: `move ${ref(item)} into the shared store` },
      { op: 'symlink', path: here, target: relative(dirname(here), store), describe: `link ${here} -> ${store}` },
    ],
    warnings: [],
  };
}

export type ServerAction = 'off' | 'on' | 'remove';

/**
 * One server as a whole: turn it off, back on, or uninstall it everywhere you control.
 *   - your own configurations and the entries in your own agents are switched / removed
 *   - plugins that bring it are switched only when listed in `plugins` (they also bring other things)
 *   - entries owned by an installer are left alone unless `force`
 *   - `remove` deletes configuration only; the program itself is removed with its installer's
 *     command, which the plan lists as a next step
 */
export function planServer(
  inv: Inventory,
  name: string,
  action: ServerAction,
  opts: { plugins?: string[]; force?: boolean; only?: string[] } = {},
): Plan {
  const entries = inv.items.filter((i) => i.kind === 'mcp' && i.name === name);
  if (!entries.length) throw new UnsupportedError(`no MCP server named ${name}`);
  const force = !!opts.force;
  const eligible = entries.filter((i) => (i.role === 'owned' || i.role === 'agent-profile') && !i.locked && (force || !i.managedBy));
  // `only`: the entries you ticked; the rest of yours are left as they are.
  const mine = opts.only?.length ? eligible.filter((i) => opts.only!.includes(ref(i))) : eligible;
  const left = entries.filter((i) => i.role !== 'bundled' && !eligible.includes(i));
  const plugins = inv.items.filter((i) => i.kind === 'plugin' && (opts.plugins ?? []).includes(ref(i)));
  const isOn = (i: Item) => i.enabled && !i.parked;
  const parts: Plan[] = [];
  if (action === 'remove') parts.push(planRemove(inv, mine, force));
  else
    parts.push(
      planToggle(
        inv,
        mine.filter((i) => isOn(i) !== (action === 'on')),
        action === 'on',
        force,
      ),
    );
  const pluginsToSwitch = plugins.filter((p) => p.enabled !== (action === 'on'));
  if (pluginsToSwitch.length) parts.push(planToggle(inv, pluginsToSwitch, action === 'on', force));
  const plan: Plan = { changes: parts.flatMap((p) => p.changes), warnings: parts.flatMap((p) => p.warnings) };
  if (left.length)
    plan.warnings.push(
      `left ${left.length} configuration(s) owned by installers unchanged (${left.map((i) => i.managedBy ?? i.scope.owner ?? i.scope.level).join(', ')})`,
    );
  const bundledElsewhere = entries.filter(
    (i) => i.role === 'bundled' && !plugins.some((p) => p.name === i.scope.owner && p.scope.harness === i.scope.harness),
  );
  if (bundledElsewhere.length && action !== 'on') {
    plan.warnings.push(`${bundledElsewhere.length} plugin(s) still bring ${name}; turn them off too to stop it completely`);
  }
  if (action === 'remove') {
    const cmds = [...new Set(entries.flatMap((i) => (i.installer?.uninstall ? [i.installer.uninstall] : [])))];
    for (const c of cmds) plan.warnings.push(`to remove the program itself, run: ${c}`);
    const users = new Set(inv.references.filter((r) => r.server === name).map((r) => r.by));
    if (users.size) plan.warnings.push(`${users.size} agent(s) use ${name}'s tools and will lose them`);
  }
  return plan;
}
