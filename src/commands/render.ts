import pc from 'picocolors';
import type { Ctx } from '../core/context.js';
import { groupBy } from '../core/inventory.js';
import type { Item, Problem } from '../core/model.js';
import { ref, refName, scopeLabel } from '../core/model.js';
import type { Plan } from '../core/ops.js';
import { redactSpec, redactText } from '../core/redact.js';
import { type ServerReport, summaryLine } from '../core/where.js';
import { preview } from '../io/changeset.js';

export const tilde = (p: string, ctx: Ctx) => (p === ctx.home ? '~' : p.startsWith(`${ctx.home}/`) ? `~${p.slice(ctx.home.length)}` : p);

const width = () => process.stdout.columns || 140;

// Display width ignoring ANSI color codes.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching the ESC byte of ANSI sequences is the point
const visible = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '').length;

export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, c) => Math.max(visible(h), ...rows.map((r) => visible(r[c] ?? ''))));
  const fixed = widths.slice(0, -1).reduce((a, b) => a + b + 2, 0);
  widths[widths.length - 1] = Math.max(20, Math.min(widths.at(-1)!, width() - fixed));
  const line = (cells: string[]) =>
    cells
      .map((cell, c) => {
        const w = widths[c]!;
        const v = visible(cell);
        if (c === cells.length - 1) return v > w ? `${cell.slice(0, w - 1)}…` : cell;
        return cell + ' '.repeat(Math.max(0, w - v));
      })
      .join('  ');
  return [pc.bold(line(headers)), ...rows.map(line)].join('\n');
}

export function stateCell(i: Item): string {
  if (i.parked) return pc.yellow('parked');
  return i.enabled ? pc.green('on') : pc.dim('off');
}

export function detail(i: Item, ctx: Ctx, reveal = false): string {
  const tags = [i.managedBy && pc.magenta(`[${i.managedBy.replace(/^plugin:.*/, 'plugin')}]`), i.link?.broken && pc.red('[broken link]')]
    .filter(Boolean)
    .join(' ');
  let body = '';
  if (i.mcp) {
    const s = redactSpec(i.mcp, reveal);
    body = s.transport === 'stdio' ? [s.command, ...(s.args ?? [])].join(' ') : `${s.transport} ${s.url}`;
  } else if (i.link) body = `→ ${tilde(i.link.target, ctx)}`;
  else body = i.description ?? '';
  return [tags, body.replace(/\s+/g, ' ')].filter(Boolean).join(' ');
}

export function itemRows(items: Item[], ctx: Ctx, reveal = false): string[][] {
  return items.map((i) => [i.kind, i.name, i.scope.harness, scopeLabel(i.scope), stateCell(i), detail(i, ctx, reveal)]);
}

export function showItem(i: Item, ctx: Ctx, reveal: boolean): string {
  const lines = [
    pc.bold(ref(i)),
    `  state     ${stateCell(i)}`,
    `  location  ${tilde(i.location.file, ctx)}${i.location.path ? pc.dim(` → ${i.location.path.join('.')}`) : ''}`,
  ];
  if (i.scope.project) lines.push(`  project   ${tilde(i.scope.project, ctx)}`);
  if (i.managedBy) lines.push(`  managed   ${pc.magenta(i.managedBy)}`);
  if (i.origin) lines.push(`  origin    ${i.origin}`);
  if (i.link) lines.push(`  link      → ${tilde(i.link.target, ctx)}${i.link.broken ? pc.red(' (missing)') : ''}`);
  if (i.description) lines.push(`  about     ${i.description.replace(/\s+/g, ' ').slice(0, 200)}`);
  if (i.mcp) {
    const spec = JSON.stringify(redactSpec(i.mcp, reveal), null, 2).replace(/\n/g, '\n            ');
    lines.push(`  spec      ${spec}`);
  }
  return lines.join('\n');
}

const SEV = { error: pc.red('error'), warn: pc.yellow('warn '), info: pc.cyan('info ') };

export function problemLines(ps: Problem[]): string {
  return ps.map((p) => `${SEV[p.severity]} ${pc.dim(p.code.padEnd(20))} ${p.message}`).join('\n');
}

export function planText(plan: Plan, ctx: Ctx, reveal: boolean): string {
  const out: string[] = [];
  for (const w of plan.warnings) out.push(pc.yellow(`! ${w}`));
  for (const p of preview(plan.changes)) {
    out.push(pc.bold(`• ${p.change.describe.replaceAll(ctx.home, '~')}`));
    if (p.error) out.push(pc.red(`  cannot apply: ${p.error}`));
    if (p.diff) {
      const body = redactText(p.diff, reveal)
        .split('\n')
        .filter((l) => l && !l.startsWith('\\') && !l.startsWith('---') && !l.startsWith('+++'))
        .map((l) => (l.startsWith('+') ? pc.green(l) : l.startsWith('-') ? pc.red(l) : l.startsWith('@@') ? pc.cyan(l) : pc.dim(l)))
        .map((l) => `    ${l}`);
      out.push(...body.slice(0, 60), ...(body.length > 60 ? [pc.dim(`    … ${body.length - 60} more lines`)] : []));
    }
  }
  return out.join('\n');
}

// ── where ────────────────────────────────────────────────────────────────────

const ROLE_HEAD: Record<string, string> = { owned: 'yours', bundled: 'from plugins', policy: 'policy', 'agent-profile': 'agent profiles' };

function entryLine(i: Item, ctx: Ctx): string {
  const by = i.provenance?.by ? pc.magenta(` by ${i.provenance.by}`) : '';
  const where = i.scope.owner ? `${i.scope.harness} ${i.scope.level}@${i.scope.owner}` : `${i.scope.harness} ${i.scope.level}`;
  return `    ${where.padEnd(58)} ${stateCell(i).padEnd(15)}${by}  ${pc.dim(tilde(i.location.file, ctx))}`;
}

export function whereText(r: ServerReport, ctx: Ctx, all: boolean): string {
  const out: string[] = [pc.bold(r.name), `  ${summaryLine(r)}`, ''];
  const cap = (n: number) => (all ? n : Math.min(n, 6));

  out.push(pc.bold('Installed'));
  for (const x of r.installs) {
    const n = pc.dim(`(${x.entries} configuration${x.entries === 1 ? '' : 's'})`);
    if (x.kind === 'executable') {
      const real = x.realpath && x.realpath !== x.resolved ? pc.dim(` → ${tilde(x.realpath, ctx)}`) : '';
      out.push(`  ${pc.green('●')} ${tilde(x.resolved!, ctx)}${real}  ${n}`);
    } else if (x.kind === 'remote') out.push(`  ${pc.cyan('◆')} ${x.url}  ${pc.dim('remote')}  ${n}`);
    else if (x.kind === 'unresolved') out.push(`  ${pc.yellow('?')} ${x.command}  ${pc.dim('contains variables; cannot resolve')}  ${n}`);
    else out.push(`  ${pc.red('✗')} ${x.command}  ${pc.red('not found on PATH')}  ${n}`);
  }

  out.push('', pc.bold('Configured'));
  for (const g of r.configs) {
    out.push(`  ${ROLE_HEAD[g.role]} ${pc.dim(`(${g.items.length})`)}`);
    const show = g.items.slice(0, cap(g.items.length));
    for (const i of show) out.push(entryLine(i, ctx));
    if (show.length < g.items.length) out.push(pc.dim(`    … ${g.items.length - show.length} more (--all)`));
  }
  if (r.configs.some((g) => g.role === 'agent-profile')) {
    out.push(pc.dim('  agent profiles are launch settings an agent carries for itself; they only apply while that agent runs'));
  }

  if (r.variants.length > 1) {
    out.push('', `${pc.bold('Variants')} ${pc.dim('(your configurations only)')}`);
    r.variants.forEach((v, n) => {
      const s = v[0]!.mcp!;
      const line = s.transport === 'stdio' ? [s.command, ...(s.args ?? [])].join(' ') : `${s.transport} ${s.url}`;
      out.push(`  ${pc.yellow('ABCDEFGHIJKLMNOPQRSTUVWXYZ'[n] ?? '?')} ×${v.length}  ${line.slice(0, 100)}`);
    });
  }

  if (r.usedBy.length) {
    const agents = new Set(r.usedBy.map((u) => u.by));
    out.push('', `${pc.bold('Used by')} ${pc.dim(`(${agents.size} agents)`)}`);
    for (const [harness, refs] of groupBy(r.usedBy, (u) => u.harness)) {
      const blind = refs.filter((u) => !u.ownEntry && !(u.includesGlobal === true && u.resolved));
      const hint = blind.find((u) => u.hint)?.hint;
      out.push(
        `  ${harness} ${pc.dim(`(${refs.length})`)}${blind.length ? pc.yellow(`  ${blind.length} cannot see a configuration`) : ''}`,
      );
      if (hint) out.push(pc.yellow(`    ${hint}`));
      const show = refs.slice(0, cap(refs.length));
      for (const u of show) {
        const name = refName(u.by);
        const sees = u.ownEntry || (u.includesGlobal === true && u.resolved);
        const how = u.ownEntry ? pc.dim('own entry') : sees ? pc.dim('shared config') : pc.yellow('no config visible');
        out.push(`    ${name!.padEnd(48)} ${how}  ${pc.dim(u.tools.slice(0, 3).join(', ') + (u.tools.length > 3 ? ', …' : ''))}`);
      }
      if (show.length < refs.length) out.push(pc.dim(`    … ${refs.length - show.length} more (--all)`));
    }
  }
  return out.join('\n');
}
