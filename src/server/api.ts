import { randomUUID } from 'node:crypto';
import { UnsupportedError } from '../adapters/types.js';
import { availableSources, type CatalogQuery, findEntry, installedIn } from '../catalog/index.js';
import { getJob, type Job, type JobAction, JobError, type JobPlan, planJob, startJob } from '../catalog/jobs.js';
import type { Ctx } from '../core/context.js';
import { diagnose, mcpVariants } from '../core/doctor.js';
import { collect, groupBy, type Inventory } from '../core/inventory.js';
import { toolLoads } from '../core/load.js';
import type { Item, McpSpec } from '../core/model.js';
import { KINDS, ref } from '../core/model.js';
import {
  ManagedError,
  type Plan,
  planAdopt,
  planCopy,
  planMove,
  planRemove,
  planServer,
  planSync,
  planToggle,
  type ServerAction,
} from '../core/ops.js';
import {
  deleteProfile,
  loadProfiles,
  planProfile,
  profileFromCurrent,
  profileFromUsage,
  saveProfile,
  validProfileName,
} from '../core/profiles.js';
import { redactSpec, redactText } from '../core/redact.js';
import { parseTarget } from '../core/select.js';
import { describeLaunch, type Launch, type MeasureOutcome, measure } from '../core/tools/measure.js';
import { isComparable } from '../core/where.js';
import { apply, type Change, listBackups, preview, restore } from '../io/changeset.js';
import type { ApiError, CatalogPageDTO, CatalogSourceDTO, ItemDTO, PlanDTO, PlanRequest, StateDTO } from './types.js';

type ApiErrorCode = ApiError['code'];

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.error);
  }
}

const tilde = (p: string, ctx: Ctx) => (p === ctx.home ? '~' : p.startsWith(`${ctx.home}/`) ? `~${p.slice(ctx.home.length)}` : p);

function toDTO(i: Item, ctx: Ctx, variant?: { index: number; count: number }): ItemDTO {
  return {
    ref: ref(i),
    kind: i.kind,
    name: i.name,
    harness: i.scope.harness,
    level: i.scope.level,
    owner: i.scope.owner,
    enabled: i.enabled,
    parked: !!i.parked,
    managedBy: i.managedBy,
    origin: i.origin,
    description: i.description,
    link: i.link && { target: tilde(i.link.target, ctx), broken: i.link.broken },
    location: { file: tilde(i.location.file, ctx), path: i.location.path },
    mcp: i.mcp && redactSpec(i.mcp),
    role: i.role ?? 'owned',
    usage: i.usage,
    locked: i.locked,
    source: i.provenance?.source && { repo: i.provenance.source.repo, url: i.provenance.source.url, path: i.provenance.source.path },
    installedAt: i.provenance?.installedAt,
    updatedAt: i.provenance?.updatedAt,
    skill: i.skill && { userOnly: i.skill.userOnly, bodyTokens: Math.round(i.skill.bodyChars / 4) },
    installer: i.installer,
    package: i.package,
    onDemand: i.onDemand,
    tools: i.tools,
    installedBy: i.provenance?.by,
    runtime: i.runtime && {
      ...i.runtime,
      resolved: i.runtime.resolved && tilde(i.runtime.resolved, ctx),
      realpath: i.runtime.realpath && tilde(i.runtime.realpath, ctx),
    },
    variant: variant?.index,
    variants: variant?.count,
  };
}

export const USAGE_DAYS = 30;

export async function state(ctx: Ctx): Promise<StateDTO> {
  const inv = await collect(ctx, undefined, { usageDays: USAGE_DAYS });
  const variantOf = new Map<Item, { index: number; count: number }>();
  // Variants only among your own entries: plugins and agent profiles tailor theirs on purpose.
  for (const [, copies] of groupBy(
    inv.items.filter((i) => i.kind === 'mcp' && isComparable(i) && !i.parked),
    (i) => i.name,
  )) {
    const vs = mcpVariants(copies, inv.config.compare);
    for (const [index, v] of vs.entries()) for (const i of v) variantOf.set(i, { index, count: vs.length });
  }
  return {
    home: ctx.home,
    project: ctx.project && tilde(ctx.project, ctx),
    adapters: inv.adapters.map((a) => ({
      id: a.id,
      label: a.label,
      detected: inv.active.includes(a),
      writable: Object.fromEntries(KINDS.map((k) => [k, a.writable(k, ctx)]).filter(([, l]) => l!.length)),
    })),
    items: inv.items.map((i) => toDTO(i, ctx, variantOf.get(i))),
    references: inv.references.map((r) => ({ ...r, file: tilde(r.file, ctx) })),
    mentions: inv.mentions,
    packages: inv.packages,
    usage: inv.usage && { days: inv.usage.days, tracked: inv.usage.tracked },
    profiles: loadProfiles(ctx),
    tools: toolLoads(inv).map((t) => ({
      harness: t.harness,
      label: t.label,
      sources: t.sources.map((s) => ({
        id: s.id,
        kind: s.kind,
        label: s.label,
        by: s.by,
        pluginRef: s.plugin && ref(s.plugin),
        enabled: s.plugin ? s.plugin.enabled : true,
        refs: s.items.map(ref),
        tokens: s.tokens,
        used: s.used,
      })),
      loaded: t.loaded,
      contextTokens: t.contextTokens,
      unmeasuredServers: t.unmeasuredServers,
      toolTokens: t.toolTokens,
      duplicates: t.duplicates,
      tracked: t.tracked,
      used: t.used,
      trim: { plugins: t.trim.plugins.map(ref), items: t.trim.items.map(ref), tokens: t.trim.tokens, servers: t.trim.servers },
      agentsAre: t.agentsAre,
      agents: t.agents.map((x) => ({ ref: ref(x.item), name: x.item.name, by: x.item.provenance?.by, servers: x.servers.map(ref) })),
    })),
    problems: diagnose(inv),
    backups: listBackups(ctx).map((b) => ({
      id: b.id,
      createdAt: b.createdAt,
      label: b.label,
      steps: b.steps.length,
      restoredAt: b.restoredAt,
    })),
  };
}

// Plans are built server-side and applied by id, so the browser never sends file edits.
const PLAN_TTL_MS = 10 * 60_000;
const plans = new Map<string, { changes: Change[]; label: string; expires: number }>();

function find(inv: Inventory, r: string): Item {
  const hit = inv.items.find((i) => ref(i) === r);
  if (!hit) throw new ApiFailure(404, { error: `no item ${r}`, code: 'not-found' });
  return hit;
}

/** Validate a browser-supplied MCP definition before it is planned into any config file. */
function newServer(req: PlanRequest): Item {
  const name = req.name?.trim() ?? '';
  if (!/^[\w@.:/-]{1,80}$/.test(name))
    throw new ApiFailure(400, { error: 'name must be 1-80 letters, digits or @ . : / - _', code: 'bad-request' });
  const s = req.spec;
  if (!s || !['stdio', 'http', 'sse'].includes(s.transport))
    throw new ApiFailure(400, { error: 'spec.transport must be stdio, http or sse', code: 'bad-request' });
  const strings = (v: unknown) => v === undefined || (Array.isArray(v) && v.every((x) => typeof x === 'string'));
  const record = (v: unknown) =>
    v === undefined || (typeof v === 'object' && v !== null && Object.values(v).every((x) => typeof x === 'string'));
  if (!strings(s.args) || !record(s.env) || !record(s.headers))
    throw new ApiFailure(400, { error: 'args, env and headers must be strings', code: 'bad-request' });
  if (s.transport === 'stdio' && !s.command?.trim()) throw new ApiFailure(400, { error: 'a command is required', code: 'bad-request' });
  if (s.transport !== 'stdio' && !/^https?:\/\/\S+$/.test(s.url ?? ''))
    throw new ApiFailure(400, { error: 'a valid http(s) URL is required', code: 'bad-request' });
  const spec: McpSpec =
    s.transport === 'stdio'
      ? { transport: 'stdio', command: s.command!.trim(), args: s.args, env: s.env }
      : { transport: s.transport, url: s.url, headers: s.headers };
  return {
    kind: 'mcp',
    name,
    scope: { harness: 'whatsloaded', level: 'user' },
    enabled: true,
    mcp: spec,
    location: { file: '(web form)' },
  };
}

function profilePlan(inv: Inventory, req: PlanRequest): { plan: Plan; label: string } | undefined {
  const name = req.name?.trim() ?? '';
  if (!req.action.startsWith('profile-')) return undefined;
  if (!validProfileName(name)) throw new ApiFailure(400, { error: 'profile names are 1-40 letters, digits, . - _', code: 'bad-request' });
  if (req.action === 'profile-delete')
    return { plan: { changes: [deleteProfile(inv.ctx, name)], warnings: [] }, label: `delete profile ${name}` };
  const t = toolLoads(inv).find((x) => x.harness === req.harness);
  if (!t) throw new ApiFailure(400, { error: `unknown tool ${String(req.harness)}`, code: 'bad-request' });
  if (req.action === 'profile-save') {
    if (req.from === 'used' && !t.tracked) throw new ApiFailure(409, { error: `${t.label} does not record usage`, code: 'unsupported' });
    const p = req.from === 'used' ? profileFromUsage(t, name, inv.usage?.days ?? USAGE_DAYS) : profileFromCurrent(t, name);
    const k = p.keep;
    return {
      plan: {
        changes: [saveProfile(inv.ctx, p)],
        warnings: [`keeps ${k.mcp.length} servers, ${k.skill.length} skills, ${k.agent.length} agents, ${k.plugin.length} plugins`],
      },
      label: `save profile ${name} from ${t.label}`,
    };
  }
  const p = loadProfiles(inv.ctx).find((x) => x.name === name);
  if (!p) throw new ApiFailure(404, { error: `no profile named ${name}`, code: 'not-found' });
  return { plan: planProfile(inv, p, t.harness, !!req.force), label: `apply profile ${name} to ${t.label}` };
}

function build(inv: Inventory, req: PlanRequest): { plan: Plan; label: string } {
  const prof = profilePlan(inv, req);
  if (prof) return prof;
  if (req.action === 'server-off' || req.action === 'server-on' || req.action === 'server-remove') {
    const name = req.name ?? '';
    const action = req.action.slice(7) as ServerAction;
    if (req.plugins && !(Array.isArray(req.plugins) && req.plugins.every((p) => typeof p === 'string'))) {
      throw new ApiFailure(400, { error: 'plugins must be a list of refs', code: 'bad-request' });
    }
    return {
      plan: planServer(inv, name, action, { plugins: req.plugins, force: !!req.force, only: req.refs.length ? req.refs : undefined }),
      label: `${action === 'remove' ? 'uninstall' : `turn ${action}`} ${name} everywhere`,
    };
  }
  if (req.action === 'add') {
    const item = newServer(req);
    if (!req.targets?.length) throw new ApiFailure(400, { error: 'pick at least one tool', code: 'bad-request' });
    return { plan: planCopy(inv, item, req.targets.map(parseTarget)), label: `add ${item.name} → ${req.targets.join(', ')}` };
  }
  const items = req.refs.map((r) => find(inv, r));
  const first = items[0];
  if (!first) throw new ApiFailure(400, { error: 'refs is empty', code: 'bad-request' });
  const targets = (req.targets ?? []).map(parseTarget);
  const force = !!req.force;
  switch (req.action) {
    case 'enable':
    case 'disable':
      return { plan: planToggle(inv, items, req.action === 'enable', force), label: `${req.action} ${req.refs.join(', ')}` };
    case 'remove':
      return { plan: planRemove(inv, items, force), label: `rm ${req.refs.join(', ')}` };
    case 'copy':
      return { plan: planCopy(inv, first, targets, { overwrite: req.overwrite }), label: `cp ${first.name} → ${req.targets?.join(', ')}` };
    case 'move':
      if (targets.length !== 1) throw new ApiFailure(400, { error: 'move needs exactly one target', code: 'bad-request' });
      return { plan: planMove(inv, first, targets[0]!, force), label: `mv ${ref(first)} → ${req.targets![0]}` };
    case 'sync':
      return { plan: planSync(inv, first, force), label: `sync ${first.name} from ${ref(first)}` };
    case 'adopt':
      return { plan: planAdopt(inv, first, force), label: `adopt ${ref(first)}` };
    default:
      throw new ApiFailure(400, { error: `unknown action ${String(req.action)}`, code: 'bad-request' });
  }
}

export async function makePlan(ctx: Ctx, req: PlanRequest): Promise<PlanDTO> {
  // Usage is only needed to save a "what I used" profile.
  const inv = await collect(ctx, undefined, req.action === 'profile-save' && req.from === 'used' ? { usageDays: USAGE_DAYS } : {});
  let built: { plan: Plan; label: string };
  try {
    built = build(inv, req);
  } catch (e) {
    if (e instanceof ManagedError) throw new ApiFailure(409, { error: e.message, code: 'managed' });
    if (e instanceof UnsupportedError) throw new ApiFailure(409, { error: e.message, code: 'unsupported' });
    if (e instanceof ApiFailure) throw e;
    throw new ApiFailure(400, { error: (e as Error).message, code: 'bad-request' });
  }
  const now = Date.now();
  for (const [k, p] of plans) if (p.expires < now) plans.delete(k);
  const id = randomUUID();
  plans.set(id, { changes: built.plan.changes, label: built.label, expires: now + PLAN_TTL_MS });
  const changes = preview(built.plan.changes).map((p) => ({
    describe: p.change.describe.replaceAll(ctx.home, '~'),
    diff:
      p.diff &&
      redactText(p.diff)
        .split('\n')
        .filter((l) => !l.startsWith('---') && !l.startsWith('+++') && !l.startsWith('\\'))
        .join('\n'),
    error: p.error,
  }));
  return {
    id,
    label: built.label,
    warnings: built.plan.warnings,
    changes,
    applicable: changes.length > 0 && !changes.some((c) => c.error),
  };
}

export function applyPlan(ctx: Ctx, id: string): { backupId: string; steps: number } {
  const p = plans.get(id);
  plans.delete(id);
  if (!p || p.expires < Date.now()) throw new ApiFailure(410, { error: 'plan expired; review it again', code: 'expired' });
  const m = apply(p.changes, ctx, p.label);
  return { backupId: m.id, steps: m.steps.length };
}

export function undo(ctx: Ctx, id?: string): { id: string; label: string } {
  const target = id ? listBackups(ctx).find((b) => b.id === id) : listBackups(ctx).find((b) => !b.restoredAt);
  if (!target) throw new ApiFailure(404, { error: id ? `no backup ${id}` : 'nothing to undo', code: 'not-found' });
  try {
    restore(target.id, ctx);
  } catch (e) {
    throw new ApiFailure(409, { error: (e as Error).message, code: 'unsupported' });
  }
  return { id: target.id, label: target.label };
}

// ── measuring tool definitions: plan (show what would run) → run (single use) ─────────

const MEASURE_TTL_MS = 5 * 60_000;
const measures = new Map<string, { refs: string[]; expires: number }>();

export interface MeasurePlanDTO {
  id: string;
  launches: Launch[];
  refused: { ref: string; reason: string }[];
}

export async function planMeasure(ctx: Ctx, refs: string[]): Promise<MeasurePlanDTO> {
  if (!refs.length || refs.length > 60) throw new ApiFailure(400, { error: 'pick 1-60 servers', code: 'bad-request' });
  const inv = await collect(ctx);
  const launches: Launch[] = [];
  const refused: { ref: string; reason: string }[] = [];
  for (const r of refs) {
    const d = describeLaunch(find(inv, r), ctx);
    if ('refused' in d) refused.push({ ref: d.ref, reason: d.refused });
    else launches.push({ ...d, cwd: d.cwd && tilde(d.cwd, ctx) });
  }
  const now = Date.now();
  for (const [k, m] of measures) if (m.expires < now) measures.delete(k);
  const id = randomUUID();
  measures.set(id, { refs: launches.map((l) => l.ref), expires: now + MEASURE_TTL_MS });
  return { id, launches, refused };
}

export async function runMeasure(ctx: Ctx, id: string): Promise<{ results: ({ ref: string } & MeasureOutcome)[] }> {
  const m = measures.get(id);
  measures.delete(id);
  if (!m || m.expires < Date.now()) throw new ApiFailure(410, { error: 'expired; review what will run again', code: 'expired' });
  const inv = await collect(ctx);
  const results: ({ ref: string } & MeasureOutcome)[] = [];
  // Two at a time: quick enough, without starting dozens of processes at once.
  const queue = [...m.refs];
  const worker = async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      const item = inv.items.find((i) => ref(i) === r);
      results.push({
        ref: r,
        ...(item ? await measure(item, ctx) : { ok: false as const, code: 'refused' as const, message: 'no longer configured' }),
      });
    }
  };
  await Promise.all([worker(), worker()]);
  return { results };
}

// ── catalogs: browse sources, then install by the installer's own command (plan → confirm → run) ──

export function catalogSources(ctx: Ctx): CatalogSourceDTO[] {
  return availableSources(ctx).map(({ id, label, description, kinds, access, url }) => ({ id, label, description, kinds, access, url }));
}

export async function catalogPage(ctx: Ctx, sourceId: string, q: CatalogQuery): Promise<{ page: CatalogPageDTO }> {
  const source = availableSources(ctx).find((s) => s.id === sourceId);
  if (!source) throw new ApiFailure(404, { error: `no catalog source ${sourceId}`, code: 'not-found' });
  const [page, inv] = await Promise.all([source.search(ctx, q), collect(ctx)]);
  return { page: { ...page, entries: page.entries.map((e) => ({ ...e, installedIn: installedIn(inv, e) })) } };
}

export async function planInstall(ctx: Ctx, entryId: string, action: JobAction, tools?: string[]): Promise<JobPlan> {
  const entry = await findEntry(ctx, availableSources(ctx), entryId);
  if (!entry) throw new ApiFailure(404, { error: 'that entry is no longer in its catalog', code: 'not-found' });
  try {
    return planJob(await collect(ctx), entry, action, tools);
  } catch (e) {
    if (e instanceof JobError) throw new ApiFailure(e.status, { error: e.message, code: e.code as ApiErrorCode });
    throw e;
  }
}

export function runInstall(ctx: Ctx, planId: string): Job {
  try {
    return startJob(ctx, planId);
  } catch (e) {
    if (e instanceof JobError) throw new ApiFailure(e.status, { error: e.message, code: e.code as ApiErrorCode });
    throw e;
  }
}

export function jobStatus(id: string): Job {
  const job = getJob(id);
  if (!job) throw new ApiFailure(404, { error: 'no such job', code: 'not-found' });
  return { ...job, steps: job.steps.map(({ argv: _argv, env: _env, ...s }) => s) as Job['steps'] };
}
