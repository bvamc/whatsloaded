/**
 * Install and uninstall jobs: commands an installer runs, planned on the server from the catalog
 * entry itself (never from argv the browser sends), confirmed by the person, run one job at a
 * time, and checked afterwards against each tool's own files.
 */
import { randomUUID } from 'node:crypto';
import type { Ctx } from '../core/context.js';
import { collect, type Inventory } from '../core/inventory.js';
import { commandText, runCommand } from '../io/run.js';
import { installedIn } from './index.js';
import type { CatalogEntry, Job, JobAction, JobPlan } from './wire.js';

export type { Job, JobAction, JobPlan, JobStep } from './wire.js';

const PLAN_TTL_MS = 10 * 60_000;
const STEP_TIMEOUT_MS = 10 * 60_000;
const plans = new Map<string, { plan: JobPlan; argvs: string[][]; env: Record<string, string>[]; expires: number }>();
const jobs = new Map<string, Job>();
let running: string | undefined;

export class JobError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export function planJob(inv: Inventory, entry: CatalogEntry, action: JobAction, tools?: string[]): JobPlan {
  const commands = entry.install.filter((m) => m.type === 'command');
  if (!commands.length) throw new JobError(409, `${entry.name} has no ${action} command; add it to your tools instead`, 'unsupported');
  // Installers that take a list of tools get the ones you picked (default: every tool it supports that you have).
  const have = new Set(inv.active.map((a) => a.id));
  let chosen: string[] | undefined;
  const expand = (m: (typeof commands)[number], argv: string[] | undefined) => {
    if (!argv || !m.toolArg) return argv;
    chosen = (tools ?? entry.tools).filter((t) => m.toolArg![t] && (tools || have.has(t)));
    if (!chosen.length) throw new JobError(400, 'pick at least one tool', 'bad-request');
    return argv.flatMap((w) => (w === '{tools}' ? chosen!.map((t) => m.toolArg![t]!) : [w]));
  };
  const argvs = commands.map((m) => expand(m, action === 'install' ? m.argv : m.uninstall)).filter((a): a is string[] => !!a);
  if (!argvs.length) throw new JobError(409, `${entry.source} gives no uninstall command for ${entry.name}`, 'unsupported');
  const warnings: string[] = [];
  if (action === 'install' && entry.trust === 'unreviewed')
    warnings.push(`${entry.source} has not reviewed ${entry.name}. Nothing stops the install; decide whether you trust its publisher.`);
  const before = installedIn(inv, entry);
  if (action === 'install' && before.length) warnings.push(`Already in ${before.join(', ')}; installing again may update it.`);
  const id = randomUUID();
  const now = Date.now();
  for (const [k, p] of plans) if (p.expires < now) plans.delete(k);
  const plan: JobPlan = {
    id,
    action,
    entry: { id: entry.id, name: entry.name, kind: entry.kind, source: entry.source, trust: entry.trust, tools: entry.tools },
    steps: commands.flatMap((m, i) =>
      argvs[i]
        ? [
            {
              label: action === 'install' ? m.label : m.label.replace(/^Install\b/, 'Uninstall'),
              text: `${Object.entries(m.env ?? {})
                .map(([k, v]) => `${k}=${v} `)
                .join('')}${commandText(argvs[i])}`,
            },
          ]
        : [],
    ),
    before,
    warnings,
    chosen,
  };
  plans.set(id, { plan, argvs, env: commands.map((m) => m.env ?? {}), expires: now + PLAN_TTL_MS });
  return plan;
}

/** Start a confirmed plan. One job runs at a time; the plan id works once. */
export function startJob(ctx: Ctx, planId: string): Job {
  const p = plans.get(planId);
  plans.delete(planId);
  if (!p || p.expires < Date.now()) throw new JobError(410, 'this plan expired; review it again', 'expired');
  if (running && jobs.get(running)?.status === 'running') throw new JobError(429, 'another install is still running', 'busy');
  const job: Job = {
    ...p.plan,
    status: 'running',
    startedAt: Date.now(),
    steps: p.plan.steps.map((s, i) => ({ ...s, argv: p.argvs[i]!, env: p.env[i], status: 'waiting' })),
  };
  jobs.set(job.id, job);
  running = job.id;
  void execute(ctx, job);
  return job;
}

async function execute(ctx: Ctx, job: Job): Promise<void> {
  const env = { ...process.env, ...ctx.env, HOME: ctx.home };
  for (const step of job.steps) {
    if (job.status === 'failed') {
      step.status = 'skipped';
      continue;
    }
    step.status = 'running';
    step.output = '';
    const r = await runCommand(step.argv, {
      cwd: ctx.home,
      env: { ...env, ...step.env },
      timeoutMs: STEP_TIMEOUT_MS,
      onOutput: (s) => {
        step.output = `${step.output ?? ''}${s}`.slice(-16_384);
      },
    });
    Object.assign(step, { code: r.code, output: r.output.slice(-16_384), ms: r.ms });
    step.status = r.code === 0 && !r.timedOut ? 'done' : 'failed';
    if (r.timedOut) step.output = `${step.output}\n(stopped after ${STEP_TIMEOUT_MS / 60_000} minutes)`;
    if (step.status === 'failed') job.status = 'failed';
  }
  try {
    job.after = installedIn(await collect(ctx), {
      kind: job.entry.kind,
      name: job.entry.name,
      installName: job.entry.id.split(':').slice(2).join(':'),
    });
  } catch {
    job.after = undefined;
  }
  if (job.status !== 'failed') job.status = 'done';
  job.endedAt = Date.now();
  if (running === job.id) running = undefined;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}
