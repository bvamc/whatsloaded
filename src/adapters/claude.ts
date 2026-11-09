import { existsSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import type { Ctx } from '../core/context.js';
import type { Discovery, Item, Kind, Level, McpSpec, Problem, Scope } from '../core/model.js';
import { ref } from '../core/model.js';
import type { Change } from '../io/changeset.js';
import { isRecord, readJson } from '../io/fsx.js';
import { jsonGet, jsonSet } from '../io/jsonEdit.js';
import { claudeUsage } from './claudeUsage.js';
import { claudeCodec } from './codecs.js';
import {
  brokenLinkProblems,
  type DirSpec,
  instructionFile,
  listParkedEntries,
  parkEntry,
  parkedEntriesFile,
  parkPathToggle,
  scanDir,
  unparkEntry,
} from './common.js';
import { putJsonMcp, readJsonMcps, readPluginMcps, removeJsonEntry } from './jsonMcp.js';
import { claudeAgentReferences, claudePluginServerKey, claudeServerKey } from './references.js';
import { type HarnessAdapter, UnsupportedError } from './types.js';

const H = 'claude';

const paths = (ctx: Ctx) => ({
  json: join(ctx.home, '.claude.json'),
  dir: join(ctx.home, '.claude'),
  userSettings: join(ctx.home, '.claude', 'settings.json'),
  installed: join(ctx.home, '.claude', 'plugins', 'installed_plugins.json'),
  managedMcp: join(ctx.managedDir, 'managed-mcp.json'),
  project: ctx.project
    ? {
        mcp: join(ctx.project, '.mcp.json'),
        dir: join(ctx.project, '.claude'),
        settings: join(ctx.project, '.claude', 'settings.json'),
        local: join(ctx.project, '.claude', 'settings.local.json'),
      }
    : undefined,
});

/** Content directories, per scope root. */
function dirSpecs(root: string, scope: Scope): DirSpec[] {
  return [
    { dir: join(root, 'skills'), kind: 'skill', scope, mode: 'skill-dirs' },
    { dir: join(root, 'agents'), kind: 'agent', scope, mode: 'md-files' },
    { dir: join(root, 'commands'), kind: 'command', scope, mode: 'md-tree' },
    { dir: join(root, 'rules'), kind: 'rule', scope, mode: 'md-tree' },
  ];
}

const KIND_DIR: Partial<Record<Kind, string>> = { skill: 'skills', agent: 'agents', command: 'commands', rule: 'rules' };

function settingsList(file: string, key: string): string[] {
  const r = readJson(file);
  const v = r.ok && isRecord(r.value) ? r.value[key] : undefined;
  return Array.isArray(v) ? v.map(String) : [];
}

function settingsValue(files: string[], path: string[]): unknown {
  for (const f of files) {
    const r = readJson(f);
    if (!r.ok) continue;
    const v = jsonGet(r.text, path);
    if (v !== undefined) return v;
  }
  return undefined;
}

interface InstalledPlugin {
  id: string;
  installPath: string;
  version?: string;
  level: 'user' | 'project';
}

function installedPlugins(ctx: Ctx): InstalledPlugin[] {
  const r = readJson(paths(ctx).installed);
  if (!r.ok || !isRecord(r.value) || !isRecord(r.value.plugins)) return [];
  const out: InstalledPlugin[] = [];
  for (const [id, entries] of Object.entries(r.value.plugins)) {
    for (const e of Array.isArray(entries) ? entries : [entries]) {
      if (!isRecord(e) || typeof e.installPath !== 'string') continue;
      const projectScoped = e.scope === 'project' || e.scope === 'local';
      if (projectScoped && e.projectPath !== ctx.project) continue;
      out.push({
        id,
        installPath: e.installPath,
        version: typeof e.version === 'string' ? e.version : undefined,
        level: projectScoped ? 'project' : 'user',
      });
      break;
    }
  }
  return out;
}

export const claude: HarnessAdapter = {
  id: H,
  label: 'Claude Code',

  usage: claudeUsage,

  detect: (ctx) => existsSync(paths(ctx).dir) || existsSync(paths(ctx).json),

  discover(ctx) {
    const p = paths(ctx);
    const items: Item[] = [];
    const problems: Problem[] = [];
    const add = (d: Discovery) => {
      items.push(...d.items);
      problems.push(...d.problems);
    };
    const user: Scope = { harness: H, level: 'user' };

    // MCP servers: managed > local > project > user (Claude's precedence).
    add(readJsonMcps(p.managedMcp, ['mcpServers'], { harness: H, level: 'managed' }, claudeCodec, { managedBy: 'enterprise' }));
    add(readJsonMcps(p.json, ['mcpServers'], user, claudeCodec));
    if (ctx.project && p.project) {
      add(readJsonMcps(p.json, ['projects', ctx.project, 'mcpServers'], { harness: H, level: 'local', project: ctx.project }, claudeCodec));
      const proj = readJsonMcps(p.project.mcp, ['mcpServers'], { harness: H, level: 'project', project: ctx.project }, claudeCodec);
      const cj = readJson(p.json);
      const disabled = new Set([
        ...[p.project.local, p.project.settings, p.userSettings].flatMap((f) => settingsList(f, 'disabledMcpjsonServers')),
        ...((jsonGet(cj.ok ? cj.text : null, ['projects', ctx.project, 'disabledMcpjsonServers']) as string[] | undefined) ?? []),
      ]);
      for (const i of proj.items) i.enabled = !disabled.has(i.name);
      add(proj);
    }
    // MCP entries whatsloaded parked out of ~/.claude.json.
    for (const e of listParkedEntries(ctx)) {
      if (e.file !== p.json) continue;
      const level: Level | undefined =
        e.path[0] === 'mcpServers' ? 'user' : e.path[0] === 'projects' && e.path[1] === ctx.project ? 'local' : undefined;
      const d = level && claudeCodec.decode(e.value);
      if (!d) continue;
      items.push({
        kind: 'mcp',
        name: e.path.at(-1)!,
        scope: { harness: H, level, project: level === 'local' ? ctx.project : undefined },
        enabled: false,
        parked: true,
        mcp: d.spec,
        location: { file: parkedEntriesFile(ctx), path: e.path },
      });
    }

    // Instruction files Claude loads whole: user, project (shared) and project-local.
    for (const [file, scope, name] of [
      [join(p.dir, 'CLAUDE.md'), user, 'CLAUDE.md'],
      ...(ctx.project
        ? ([
            [join(ctx.project, 'CLAUDE.md'), { harness: H, level: 'project', project: ctx.project }, 'CLAUDE.md'],
            [join(ctx.project, '.claude', 'CLAUDE.md'), { harness: H, level: 'project', project: ctx.project }, '.claude/CLAUDE.md'],
            [join(ctx.project, 'CLAUDE.local.md'), { harness: H, level: 'local', project: ctx.project }, 'CLAUDE.local.md'],
          ] as const)
        : []),
    ] as [string, Scope, string][]) {
      const it = instructionFile(file, scope, name);
      if (it) items.push(it);
    }

    // Skills, agents, commands, rules.
    const specs = [
      ...dirSpecs(p.dir, user),
      ...(p.project ? dirSpecs(p.project.dir, { harness: H, level: 'project', project: ctx.project }) : []),
    ];
    for (const s of specs) items.push(...scanDir(s, ctx));

    // Plugins and everything they contribute.
    const settingsFiles = [p.project?.local, p.project?.settings, p.userSettings].filter((f): f is string => !!f);
    for (const pl of installedPlugins(ctx)) {
      const setting = settingsValue(settingsFiles, ['enabledPlugins', pl.id]);
      const enabled = setting === undefined ? true : setting === true;
      const manifest = readJson(join(pl.installPath, '.claude-plugin', 'plugin.json'));
      const description =
        manifest.ok && isRecord(manifest.value) && typeof manifest.value.description === 'string' ? manifest.value.description : undefined;
      items.push({
        kind: 'plugin',
        name: pl.id,
        scope: { harness: H, level: pl.level, project: pl.level === 'project' ? ctx.project : undefined },
        enabled,
        description,
        origin: pl.id.split('@')[1],
        location: { file: p.userSettings, path: ['enabledPlugins', pl.id] },
      });
      const scope: Scope = { harness: H, level: 'plugin', owner: pl.id };
      add(readPluginMcps(pl.installPath, scope, pl.id, enabled, claudeCodec));
      for (const s of dirSpecs(pl.installPath, scope)) {
        for (const it of scanDir(s, ctx)) items.push({ ...it, enabled, managedBy: `plugin:${pl.id}` });
      }
    }

    // Usage: agents whose frontmatter lists MCP tools.
    const keys = new Map<string, string>();
    for (const i of items) {
      if (i.kind !== 'mcp') continue;
      keys.set(
        i.scope.level === 'plugin' && i.scope.owner ? claudePluginServerKey(i.scope.owner, i.name) : claudeServerKey(i.name),
        i.name,
      );
    }
    const references = items.filter((i) => i.kind === 'agent' && !i.parked).flatMap((a) => claudeAgentReferences(a, keys));

    problems.push(...brokenLinkProblems(items));
    return { items, problems, references };
  },

  writable(kind, ctx) {
    const proj = !!ctx.project;
    if (kind === 'mcp') return proj ? ['user', 'local', 'project'] : ['user'];
    if (kind in KIND_DIR) return proj ? ['user', 'project'] : ['user'];
    return [];
  },

  setEnabled(item, enabled, ctx) {
    const p = paths(ctx);
    if (item.enabled === enabled) return [];
    if (item.kind === 'plugin') {
      return [
        {
          op: 'edit',
          file: p.userSettings,
          describe: `${enabled ? 'enable' : 'disable'} plugin ${item.name}`,
          transform: (t) => jsonSet(t, ['enabledPlugins', item.name], enabled),
        },
      ];
    }
    if (item.scope.level === 'plugin')
      throw new UnsupportedError(`${ref(item)} comes from plugin ${item.scope.owner}; toggle the plugin instead`);
    if (item.scope.level === 'managed') throw new UnsupportedError(`${ref(item)} is enterprise-managed`);

    if (item.kind === 'mcp' && item.scope.level === 'project') {
      const local = p.project!.local;
      const name = item.name;
      const edit = (key: string, add: boolean): Change => ({
        op: 'edit',
        file: local,
        describe: `${add ? 'add' : 'remove'} ${name} ${add ? 'to' : 'from'} ${key} in ${local}`,
        transform: (t) => {
          const cur = (jsonGet(t, [key]) as string[] | undefined) ?? [];
          const next = add ? [...new Set([...cur, name])] : cur.filter((n) => n !== name);
          return jsonSet(t, [key], next);
        },
      });
      const changes = enabled
        ? [edit('disabledMcpjsonServers', false), edit('enabledMcpjsonServers', true)]
        : [edit('enabledMcpjsonServers', false), edit('disabledMcpjsonServers', true)];
      if (enabled) {
        changes.push({
          op: 'edit',
          file: p.json,
          describe: `clear ${name} from projects[${ctx.project}].disabledMcpjsonServers in ${p.json}`,
          transform: (t) => {
            const path = ['projects', ctx.project!, 'disabledMcpjsonServers'];
            const cur = jsonGet(t, path) as string[] | undefined;
            return cur?.includes(name)
              ? jsonSet(
                  t,
                  path,
                  cur.filter((n) => n !== name),
                )
              : (t ?? '');
          },
        });
      }
      return changes;
    }

    if (item.kind === 'mcp') {
      // Claude has no "disabled" flag for user/local servers: park the entry instead.
      if (!enabled) return parkEntry(ctx, item);
      const entry = listParkedEntries(ctx).find((e) => e.file === p.json && e.path.join('/') === item.location.path!.join('/'));
      if (!entry) throw new UnsupportedError(`no parked entry found for ${ref(item)}`);
      return unparkEntry(ctx, item, entry);
    }

    return parkPathToggle(ctx, item, enabled, (i) => decodeURIComponent(basename(i.location.file)));
  },

  remove(item, ctx) {
    if (item.scope.level === 'plugin' || item.scope.level === 'managed')
      throw new UnsupportedError(`${ref(item)} is not owned by you; uninstall the plugin or change policy instead`);
    if (item.kind === 'plugin') throw new UnsupportedError(`uninstall plugins with \`claude plugin uninstall ${item.name}\``);
    if (item.kind === 'mcp' && item.parked) {
      const p = paths(ctx);
      return [
        {
          op: 'edit',
          file: parkedEntriesFile(ctx),
          describe: `drop parked ${ref(item)}`,
          transform: (t) => jsonSet(t, [`${p.json}#${item.location.path!.join('/')}`], undefined),
        },
      ];
    }
    if (item.kind === 'mcp') return [removeJsonEntry(item)];
    return [{ op: 'trash', path: item.location.file, describe: `remove ${ref(item)} (kept in backup)` }];
  },

  putMcp(name, spec: McpSpec, level, ctx, opts = {}) {
    const p = paths(ctx);
    const enabled = opts.enabled ?? true;
    if ((level === 'local' || level === 'project') && !ctx.project)
      throw new UnsupportedError(`${level} scope needs a project (run inside one or pass --project)`);
    if (level === 'user' || level === 'local') {
      const path = level === 'user' ? ['mcpServers', name] : ['projects', ctx.project!, 'mcpServers', name];
      if (enabled) return [putJsonMcp(p.json, path, claudeCodec, spec, true, `write ${H}:${level}/mcp/${name} to ${p.json}`)];
      return [
        {
          op: 'edit',
          file: parkedEntriesFile(ctx),
          describe: `write ${H}:${level}/mcp/${name} as parked (disabled)`,
          transform: (t) => jsonSet(t, [`${p.json}#${path.join('/')}`], { file: p.json, path, value: claudeCodec.encode(spec, true) }),
        },
      ];
    }
    if (level === 'project') {
      const changes = [
        putJsonMcp(p.project!.mcp, ['mcpServers', name], claudeCodec, spec, true, `write ${H}:project/mcp/${name} to ${p.project!.mcp}`),
      ];
      if (!enabled)
        changes.push(
          ...this.setEnabled(
            { kind: 'mcp', name, scope: { harness: H, level }, enabled: true, location: { file: p.project!.mcp } },
            false,
            ctx,
          ),
        );
      return changes;
    }
    throw new UnsupportedError(`cannot write MCP servers at ${H}:${level}`);
  },

  linkSkill(name, source, level, ctx) {
    const root = level === 'user' ? paths(ctx).dir : level === 'project' && ctx.project ? join(ctx.project, '.claude') : undefined;
    if (!root) throw new UnsupportedError(`cannot install skills at ${H}:${level}`);
    const at = join(root, 'skills', name);
    return [{ op: 'symlink', path: at, target: relative(dirname(at), source), describe: `link ${H}:${level}/skill/${name} -> ${source}` }];
  },
};
