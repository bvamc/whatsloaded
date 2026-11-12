#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { Command, Option } from 'commander';
import pc from 'picocolors';
import { UnsupportedError } from './adapters/types.js';
import { itemRows, planText, problemLines, showItem, table, tilde, whereText } from './commands/render.js';
import { type Ctx, makeCtx } from './core/context.js';
import { diagnose } from './core/doctor.js';
import { byKind, collect, type Inventory } from './core/inventory.js';
import { toolLoads } from './core/load.js';
import type { Item, McpSpec } from './core/model.js';
import { KINDS, ref } from './core/model.js';
import { ManagedError, type Plan, planAdopt, planCopy, planMove, planRemove, planSync, planToggle } from './core/ops.js';
import {
  deleteProfile,
  loadProfiles,
  planProfile,
  profileFromCurrent,
  profileFromUsage,
  saveProfile,
  validProfileName,
} from './core/profiles.js';
import { redactSpec } from './core/redact.js';
import { type Filters, parseTarget, select } from './core/select.js';
import { describeLaunch, measure } from './core/tools/measure.js';
import { serverReport, summaryLine } from './core/where.js';
import { apply, listBackups, preview, restore } from './io/changeset.js';

const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

const program = new Command('whatsloaded')
  .description('See and manage MCP servers, skills, agents and rules across AI coding tools and scopes')
  .version(PKG.version)
  .option('-C, --project <dir>', 'also include this project (its .mcp.json, .claude/, .kiro/ ...); default: global settings only')
  .option('--here', 'also include the project that contains the current directory')
  .option('--no-extensions', 'do not load adapters/providers from ~/.whatsloaded')
  .addOption(new Option('--home <dir>', 'override $HOME (testing)').hideHelp());

interface GlobalOpts {
  project?: string;
  here?: boolean;
  home?: string;
  extensions: boolean;
}

function ctx(): Ctx {
  const o = program.opts<GlobalOpts>();
  return makeCtx({ home: o.home, project: o.project, here: o.here, extensions: o.extensions === false ? false : undefined });
}

async function inventory(): Promise<Inventory> {
  return collect(ctx());
}

const json = (v: unknown) => console.log(JSON.stringify(v, null, 2));

function fail(msg: string): never {
  console.error(pc.red(`error: ${msg}`));
  process.exit(1);
}

function filtersOf(o: { harness?: string; level?: string; kind?: string }): Filters {
  return { harness: o.harness, level: o.level, kind: o.kind };
}

function resolveMany(inv: Inventory, queries: string[], f: Filters, allMatches: boolean): Item[] {
  const harnesses = inv.adapters.map((a) => a.id);
  const out: Item[] = [];
  for (const q of queries) {
    const hits = select(inv.items, q, f, harnesses);
    if (!hits.length) fail(`nothing matches "${q}"`);
    if (hits.length > 1 && !allMatches) {
      console.error(`"${q}" matches ${hits.length} items:\n${hits.map((h) => `  ${ref(h)}`).join('\n')}`);
      fail('narrow it with a full ref, --harness/--level/--kind, or pass --all-matches');
    }
    out.push(...hits);
  }
  return out;
}

function resolveOne(inv: Inventory, query: string, f: Filters = {}): Item {
  return resolveMany(inv, [query], f, false)[0]!;
}

interface ApplyOpts {
  yes?: boolean;
  dryRun?: boolean;
  reveal?: boolean;
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question(`${question} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(a.trim());
}

async function run(c: Ctx, label: string, build: () => Plan, o: ApplyOpts): Promise<void> {
  let plan: Plan;
  try {
    plan = build();
  } catch (e) {
    if (e instanceof ManagedError || e instanceof UnsupportedError) fail(e.message);
    throw e;
  }
  console.log(planText(plan, c, !!o.reveal));
  if (!plan.changes.length) return void console.log(pc.dim('nothing to do'));
  if (preview(plan.changes).some((p) => p.error)) fail('plan has changes that cannot be applied; nothing was written');
  if (o.dryRun) return void console.log(pc.dim(`dry run: ${plan.changes.length} change(s) not applied`));
  if (!o.yes && !(await confirm(`Apply ${plan.changes.length} change(s)?`))) {
    return void console.log(process.stdin.isTTY ? 'aborted' : pc.yellow('not a terminal: re-run with --yes to apply'));
  }
  const m = apply(plan.changes, c, label);
  console.log(pc.green(`✓ applied ${m.steps.length} change(s)`) + pc.dim(`  backup ${m.id}, undo with: whatsloaded undo`));
  console.log(pc.dim('  running agent sessions pick this up on restart'));
}

const mutating = (cmd: Command) =>
  cmd
    .option('-y, --yes', 'apply without prompting')
    .option('-n, --dry-run', 'show the plan and diff only')
    .option('--reveal', 'show secret values in diffs')
    .option('--force', 'also modify items owned by plugins, policy or other tools');

const filtering = (cmd: Command) =>
  cmd
    .option('-H, --harness <id>', 'only this harness (claude, kiro, codex, opencode, agents, ...)')
    .option('-s, --level <level>', 'only this scope (user, project, local, plugin, agent, store, managed)')
    .option('-k, --kind <kind>', `only this kind (${KINDS.join(', ')})`);

// ── read-only ────────────────────────────────────────────────────────────────

filtering(
  program
    .command('ls')
    .description('list everything whatsloaded can see')
    .argument('[kind]', `filter by kind (${KINDS.join(', ')})`)
    .option('-a, --all', 'include items contributed by plugins')
    .option('--json', 'machine-readable output'),
).action(async (kind: string | undefined, o) => {
  const inv = await inventory();
  let items = byKind(inv.items, (kind ?? o.kind) as Item['kind']).filter(
    (i) => (!o.harness || i.scope.harness === o.harness) && (!o.level || i.scope.level === o.level),
  );
  // Plugin MCP servers are real running servers, so they always show; the bulk of plugin
  // content (skills, agents, commands) stays behind --all.
  const bulk = (i: Item) => i.scope.level === 'plugin' && i.kind !== 'mcp';
  const hidden = o.all || o.level === 'plugin' ? 0 : items.filter(bulk).length;
  if (hidden) items = items.filter((i) => !bulk(i));
  if (o.json) return json(items.map((i) => ({ ref: ref(i), ...i, mcp: i.mcp && redactSpec(i.mcp) })));
  if (!items.length) return console.log(pc.dim('nothing found'));
  console.log(table(['KIND', 'NAME', 'HARNESS', 'SCOPE', 'STATE', 'DETAIL'], itemRows(items, inv.ctx)));
  const proj = inv.ctx.project ? `project ${tilde(inv.ctx.project, inv.ctx)}` : 'no project';
  console.log(pc.dim(`\n${items.length} items · ${proj}${hidden ? ` · ${hidden} plugin skills/agents/commands hidden (--all)` : ''}`));
});

program
  .command('matrix')
  .description('show which harnesses and scopes define each item (default: MCP servers)')
  .argument('[kind]', 'kind to chart', 'mcp')
  .option('-a, --all', 'include plugin-provided items')
  .option('--json', 'machine-readable output')
  .action(async (kind: string, o) => {
    const inv = await inventory();
    const items = byKind(inv.items, kind as Item['kind']).filter((i) => o.all || i.kind === 'mcp' || i.scope.level !== 'plugin');
    const harnesses = inv.active.map((a) => a.id).filter((h) => items.some((i) => i.scope.harness === h));
    const names = [...new Set(items.map((i) => i.name))].sort();
    const ABBR: Record<string, string> = { user: 'u', project: 'p', local: 'l', plugin: 'pl', agent: 'a', managed: 'm', store: 's' };
    const cell = (name: string, h: string) => {
      const hits = items.filter((i) => i.name === name && i.scope.harness === h);
      const by = new Map<string, Item[]>();
      for (const i of hits) by.set(i.scope.level, [...(by.get(i.scope.level) ?? []), i]);
      return [...by]
        .map(([lvl, xs]) => {
          const tok = ABBR[lvl]! + (xs.length > 1 ? `×${xs.length}` : '');
          return xs.every((x) => x.enabled) ? pc.green(tok) : xs.some((x) => x.enabled) ? pc.yellow(tok) : pc.dim(`${tok}-`);
        })
        .join(' ');
    };
    if (o.json)
      return json(
        Object.fromEntries(
          names.map((n) => [
            n,
            Object.fromEntries(harnesses.map((h) => [h, items.filter((i) => i.name === n && i.scope.harness === h).map(ref)])),
          ]),
        ),
      );
    console.log(
      table(
        ['NAME', ...harnesses],
        names.map((n) => [n, ...harnesses.map((h) => cell(n, h) || pc.dim('·'))]),
      ),
    );
    console.log(pc.dim('\nu=user p=project l=local a=agent pl=plugin s=store m=managed · green=on dim/-=off yellow=mixed'));
  });

filtering(
  program
    .command('show')
    .description('show full details for matching items')
    .argument('<query>')
    .option('--reveal', 'show env/header values')
    .option('--json'),
).action(async (q: string, o) => {
  const inv = await inventory();
  const hits = select(
    inv.items,
    q,
    filtersOf(o),
    inv.adapters.map((a) => a.id),
  );
  if (!hits.length) fail(`nothing matches "${q}"`);
  if (o.json) return json(hits.map((i) => ({ ref: ref(i), ...i, mcp: i.mcp && redactSpec(i.mcp, o.reveal) })));
  console.log(hits.map((i) => showItem(i, inv.ctx, !!o.reveal)).join('\n\n'));
});

program
  .command('where')
  .description('where an MCP server is installed, every configuration of it (by role), and which agents use it')
  .argument('<name>', 'MCP server name')
  .option('-a, --all', 'list every configuration and agent')
  .option('--json')
  .action(async (name: string, o) => {
    const inv = await inventory();
    const r = serverReport(inv, name);
    if (!r) {
      const names = [...new Set(inv.items.filter((i) => i.kind === 'mcp').map((i) => i.name))];
      const near = names.filter((n) => n.includes(name) || name.includes(n)).slice(0, 5);
      fail(`no MCP server named "${name}"${near.length ? `; did you mean: ${near.join(', ')}?` : ''}`);
    }
    if (o.json) {
      return json({
        ...r,
        configs: r.configs.map((c) => ({ role: c.role, refs: c.items.map(ref) })),
        variants: r.variants.map((v) => v.map(ref)),
        summary: summaryLine(r),
      });
    }
    console.log(whereText(r, inv.ctx, !!o.all));
  });

filtering(
  program
    .command('measure')
    .description('start MCP servers once to measure what their tool definitions cost in context (runs their commands; asks first)')
    .argument('<queries...>', 'servers to measure, e.g. github or claude:user/mcp/github')
    .option('--all-matches', 'measure every server a query matches')
    .option('-y, --yes', 'run without asking')
    .option('--timeout <seconds>', 'give up on a server after this long', '15'),
).action(async (qs: string[], o) => {
  const inv = await inventory();
  const items = resolveMany(inv, qs, { ...filtersOf(o), kind: 'mcp' }, !!o.allMatches);
  const runnable: Item[] = [];
  for (const i of items) {
    const d = describeLaunch(i, inv.ctx);
    if ('refused' in d) {
      console.log(`${pc.dim('skip')} ${ref(i)}  ${pc.yellow(d.refused)}`);
      continue;
    }
    runnable.push(i);
    console.log(`${pc.bold('run ')} ${ref(i)}`);
    console.log(
      `     ${d.commandLine ?? d.url}${d.cwd ? pc.dim(`  (in ${tilde(d.cwd, inv.ctx)})`) : ''}${d.envKeys.length ? pc.dim(`  with ${d.envKeys.join(', ')}`) : ''}`,
    );
    for (const w of d.warnings) console.log(`     ${pc.yellow(`! ${w}`)}`);
  }
  if (!runnable.length) return;
  if (!o.yes && !(await confirm(`Start ${runnable.length} server(s) to read their tool lists?`)))
    return void console.log('nothing was started');
  for (const i of runnable) {
    const r = await measure(i, inv.ctx, { timeoutMs: Number(o.timeout) * 1000, version: PKG.version });
    console.log(
      r.ok
        ? `${pc.green('✓')} ${ref(i)}  ${r.measure.count} tools · ≈${r.measure.tokens} tokens`
        : `${pc.red('✗')} ${ref(i)}  ${r.message}`,
    );
  }
});

program
  .command('doctor')
  .description('find drift, duplicates, shadowing, broken links and parse errors')
  .option('--json')
  .option('-q, --quiet', 'errors and warnings only')
  .action(async (o) => {
    const inv = await inventory();
    const ps = diagnose(inv).filter((p) => !o.quiet || p.severity !== 'info');
    if (o.json) return json(ps);
    console.log(ps.length ? problemLines(ps) : pc.green('✓ no problems found'));
    if (ps.some((p) => p.severity === 'error')) process.exitCode = 1;
  });

program
  .command('adapters')
  .description('list harness adapters and providers, and whether each harness was detected')
  .action(async () => {
    const inv = await inventory();
    console.log(
      table(
        ['ID', 'HARNESS', 'DETECTED', 'ITEMS'],
        inv.adapters.map((a) => [
          a.id,
          a.label,
          inv.active.includes(a) ? pc.green('yes') : pc.dim('no'),
          String(inv.items.filter((i) => i.scope.harness === a.id).length),
        ]),
      ),
    );
    if (inv.providers.length) {
      console.log(
        '\n' +
          table(
            ['PROVIDER', 'LABEL'],
            inv.providers.map((p) => [p.id, p.label]),
          ),
      );
    }
    const loadErrors = inv.problems.filter((p) => /^(adapter|provider)-load$|^extension-unsafe$/.test(p.code));
    if (loadErrors.length) console.log(`\n${problemLines(loadErrors)}`);
    if (!inv.ctx.extensions) console.log(pc.dim('\nextensions disabled (--no-extensions)'));
  });

// ── mutating ─────────────────────────────────────────────────────────────────

for (const [name, enabled] of [
  ['enable', true],
  ['disable', false],
] as const) {
  mutating(
    filtering(
      program
        .command(name)
        .description(`${name} items (native toggle where the harness has one, otherwise whatsloaded parks the item)`)
        .argument('<queries...>')
        .option('--all-matches', 'act on every item a query matches'),
    ),
  ).action(async (qs: string[], o) => {
    const inv = await inventory();
    const items = resolveMany(inv, qs, filtersOf(o), !!o.allMatches);
    await run(inv.ctx, `${name} ${qs.join(' ')}`, () => planToggle(inv, items, enabled, o.force), o);
  });
}

mutating(
  filtering(
    program
      .command('rm')
      .description('remove items (removed files are kept in the backup)')
      .argument('<queries...>')
      .option('--all-matches'),
  ),
).action(async (qs: string[], o) => {
  const inv = await inventory();
  const items = resolveMany(inv, qs, filtersOf(o), !!o.allMatches);
  await run(inv.ctx, `rm ${qs.join(' ')}`, () => planRemove(inv, items, o.force), o);
});

mutating(
  filtering(
    program
      .command('cp')
      .description('copy an MCP server or skill to other harnesses/scopes (skills are symlinked)')
      .argument('<query>')
      .argument('<targets...>', 'e.g. kiro:user codex claude:project')
      .option('--overwrite', 'replace existing items with the same name'),
  ),
).action(async (q: string, targets: string[], o) => {
  const inv = await inventory();
  const item = resolveOne(inv, q, filtersOf(o));
  await run(
    inv.ctx,
    `cp ${ref(item)} ${targets.join(' ')}`,
    () => planCopy(inv, item, targets.map(parseTarget), { overwrite: o.overwrite }),
    o,
  );
});

mutating(
  filtering(
    program.command('mv').description('move an MCP server or skill to another harness/scope').argument('<query>').argument('<target>'),
  ),
).action(async (q: string, target: string, o) => {
  const inv = await inventory();
  const item = resolveOne(inv, q, filtersOf(o));
  await run(inv.ctx, `mv ${ref(item)} ${target}`, () => planMove(inv, item, parseTarget(target), o.force), o);
});

mutating(
  filtering(
    program
      .command('sync')
      .description('make your and plugin configurations of an MCP server match one source')
      .argument('<name>')
      .requiredOption('--from <ref>', 'the configuration to treat as correct')
      .option('--include-agents', 'also rewrite agent profiles (agents that carry their own launch settings)'),
  ),
).action(async (name: string, o) => {
  const inv = await inventory();
  const source = resolveOne(inv, o.from);
  if (source.name !== name) fail(`--from resolves to ${ref(source)}, which is not named ${name}`);
  await run(
    inv.ctx,
    `sync ${name} from ${ref(source)}`,
    () => planSync(inv, source, o.force, { includeAgentProfiles: o.includeAgents }),
    o,
  );
});

mutating(
  filtering(
    program.command('adopt').description('move a harness-local skill into ~/.agents/skills and leave a symlink').argument('<query>'),
  ),
).action(async (q: string, o) => {
  const inv = await inventory();
  const item = resolveOne(inv, q, { ...filtersOf(o), kind: 'skill' });
  await run(inv.ctx, `adopt ${ref(item)}`, () => planAdopt(inv, item, o.force), o);
});

function kv(list: string[] | undefined): Record<string, string> | undefined {
  if (!list?.length) return undefined;
  return Object.fromEntries(
    list.map((s) => {
      const at = s.indexOf('=');
      if (at < 1) fail(`expected KEY=VALUE, got "${s}"`);
      return [s.slice(0, at), s.slice(at + 1)];
    }),
  );
}

const collectList = (v: string, prev: string[] = []) => [...prev, v];

mutating(
  program
    .command('add-mcp')
    .description('add an MCP server to one or more harnesses, e.g. add-mcp foo --to kiro claude -- npx -y foo-mcp')
    .argument('<name>')
    .argument('[command...]', 'stdio command and args (after --)')
    .requiredOption('--to <targets...>', 'targets, e.g. kiro:user codex claude:project')
    .option('--url <url>', 'remote server URL (http transport)')
    .option('--sse', 'use SSE instead of streamable HTTP for --url')
    .option('-e, --env <KEY=VALUE>', 'environment variable (repeatable)', collectList)
    .option('--header <KEY=VALUE>', 'HTTP header (repeatable)', collectList)
    .option('--disabled', 'add it switched off'),
).action(async (name: string, command: string[], o) => {
  if (!o.url && !command.length) fail('give a command after -- or a --url');
  const spec: McpSpec = o.url
    ? { transport: o.sse ? 'sse' : 'http', url: o.url, headers: kv(o.header) }
    : { transport: 'stdio', command: command[0], args: command.slice(1), env: kv(o.env) };
  const inv = await inventory();
  const virtual: Item = {
    kind: 'mcp',
    name,
    scope: { harness: 'whatsloaded', level: 'user' },
    enabled: !o.disabled,
    mcp: spec,
    location: { file: '(command line)' },
  };
  await run(inv.ctx, `add-mcp ${name}`, () => planCopy(inv, virtual, (o.to as string[]).map(parseTarget)), o);
});

const profile = program.command('profile').description('named sets of what to keep in a tool: save, apply, list, delete');

profile
  .command('ls')
  .description('list saved profiles')
  .option('--json')
  .action((o) => {
    const ps = loadProfiles(ctx());
    if (o.json) return json(ps);
    if (!ps.length) return console.log(pc.dim('no profiles yet: whatsloaded profile save <name> --from <tool> [--used]'));
    console.log(
      table(
        ['NAME', 'KEEPS', 'ABOUT'],
        ps.map((p) => [
          p.name,
          `${p.keep.mcp.length} servers · ${p.keep.skill.length} skills · ${p.keep.agent.length} agents · ${p.keep.plugin.length} plugins`,
          p.description ?? '',
        ]),
      ),
    );
  });

mutating(
  profile
    .command('save')
    .description('save what a tool loads now (or with --used, only what you used in the last 30 days) as a profile')
    .argument('<name>')
    .requiredOption('--from <tool>', 'claude, kiro, codex, opencode, ...')
    .option('--used', 'keep only what was used in the last 30 days'),
).action(async (name: string, o) => {
  if (!validProfileName(name)) fail('profile names are 1-40 letters, digits, . - _');
  const inv = await collect(ctx(), undefined, o.used ? { usageDays: 30 } : {});
  const t = toolLoads(inv).find((x) => x.harness === o.from) ?? fail(`unknown tool ${o.from}`);
  if (o.used && !t.tracked) fail(`${t.label} does not record usage`);
  const p = o.used ? profileFromUsage(t, name, 30) : profileFromCurrent(t, name);
  await run(
    inv.ctx,
    `save profile ${name}`,
    () => ({
      changes: [saveProfile(inv.ctx, p)],
      warnings: [
        `keeps ${p.keep.mcp.length} servers, ${p.keep.skill.length} skills, ${p.keep.agent.length} agents, ${p.keep.plugin.length} plugins`,
      ],
    }),
    o,
  );
});

mutating(
  profile
    .command('apply')
    .description('switch a tool to a profile: everything the profile does not keep is turned off, kept items back on')
    .argument('<name>')
    .requiredOption('--to <tool>', 'claude, kiro, codex, opencode, ...'),
).action(async (name: string, o) => {
  const inv = await inventory();
  const p = loadProfiles(inv.ctx).find((x) => x.name === name) ?? fail(`no profile named ${name}`);
  await run(inv.ctx, `apply profile ${name} to ${o.to}`, () => planProfile(inv, p, o.to, o.force), o);
});

mutating(profile.command('rm').description('delete a profile').argument('<name>')).action(async (name: string, o) => {
  const c = ctx();
  if (!loadProfiles(c).some((x) => x.name === name)) fail(`no profile named ${name}`);
  await run(c, `delete profile ${name}`, () => ({ changes: [deleteProfile(c, name)], warnings: [] }), o);
});

program
  .command('backups')
  .description('list change sets whatsloaded has applied')
  .action(() => {
    const c = ctx();
    const bs = listBackups(c);
    if (!bs.length) return console.log(pc.dim('no backups yet'));
    console.log(
      table(
        ['ID', 'STEPS', 'STATUS', 'WHAT'],
        bs.map((b) => [b.id, String(b.steps.length), b.restoredAt ? pc.dim('restored') : pc.green('applied'), b.label]),
      ),
    );
  });

program
  .command('undo')
  .description('revert the most recent change set, or a specific backup id')
  .argument('[id]')
  .option('-y, --yes')
  .action(async (id: string | undefined, o) => {
    const c = ctx();
    const target = id ? listBackups(c).find((b) => b.id === id) : listBackups(c).find((b) => !b.restoredAt);
    if (!target) fail(id ? `no backup ${id}` : 'nothing to undo');
    console.log(`${target.id}  ${target.label}  (${target.steps.length} step(s))`);
    if (!o.yes && !(await confirm('Revert it?'))) return void console.log('aborted');
    restore(target.id, c);
    console.log(pc.green('✓ reverted'));
  });

program
  .command('tui')
  .description('interactive browser')
  .action(async () => {
    const { runTui } = await import('./tui/App.js');
    await runTui(ctx());
  });

program
  .command('ui')
  .description('open the web dashboard (served on 127.0.0.1 only)')
  .option('-p, --port <port>', 'port to listen on (falls back to a free port if taken)', '4319')
  .option('--no-open', 'do not open a browser')
  .action(async (o: { port: string; open: boolean }) => {
    const { startServer } = await import('./server/http.js');
    const { execFile } = await import('node:child_process');
    const { existsSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const candidates = [new URL('./web', import.meta.url), new URL('../dist/web', import.meta.url)].map((u) => fileURLToPath(u));
    const webRoot = candidates.find((d) => existsSync(d)) ?? candidates[0]!;
    // The server is global; a project chosen with -C/--here is only the page's starting selection.
    const c = ctx();
    const { url } = await startServer({ ...c, project: undefined }, { port: Number(o.port), webRoot });
    const page = c.project ? `${url}/?project=${encodeURIComponent(c.project)}` : url;
    console.log(`${pc.bold('whatsloaded')} ${pc.cyan(page)}  ${pc.dim('(loopback only · Ctrl-C to stop)')}`);
    if (o.open) execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [page], () => {});
  });

program.parseAsync().catch((e: Error) => fail(e.message));
