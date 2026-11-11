import { isDir, listEntries } from '../io/fsx.js';
import { mcpVariants } from './compare.js';
import { groupBy, type Inventory } from './inventory.js';
import type { Problem } from './model.js';
import { ref, refName } from './model.js';
import { isComparable } from './where.js';

export { mcpVariants } from './compare.js';

/**
 * For an absolute command inside a versioned install directory (…/tool/1.2.3/bin/tool), say which
 * versions are installed instead, since an upgrade that removed the old one is the usual cause.
 */
function pinnedVersionHint(command: string): string | undefined {
  const parts = command.split(/[\\/]/);
  const at = parts.findIndex((p) => /^v?\d+(\.\d+)+$/.test(p));
  if (at < 1) return undefined;
  const parent = parts.slice(0, at).join('/');
  const installed = listEntries(parent).filter((v) => /^v?\d+(\.\d+)+$/.test(v) && isDir(`${parent}/${v}`));
  if (!installed.length) return `\`${command}\` points into ${parent}, which has no installed versions`;
  return `\`${command}\` points at version ${parts[at]}, which is no longer installed (installed: ${installed.join(', ')})`;
}

export function diagnose(inv: Inventory): Problem[] {
  const out: Problem[] = [...inv.problems];
  const mcps = inv.items.filter((i) => i.kind === 'mcp' && !i.parked);

  // 1. Your own configurations of the same server disagree (e.g. Kiro and Codex launch it differently).
  //    Plugin-bundled entries and agent profiles are tailored by their owners and are not compared.
  for (const [name, entries] of groupBy(mcps.filter(isComparable), (i) => i.name)) {
    if (entries.length < 2) continue;
    const variants = mcpVariants(entries, inv.config.compare);
    if (variants.length < 2) continue;
    out.push({
      severity: 'warn',
      code: 'mcp-drift',
      subject: { kind: 'mcp', name },
      message: `${name}: your ${entries.length} configurations launch it ${variants.length} different ways (${variants.map((v) => v.map((i) => `${i.scope.harness} ${i.scope.level}`).join(' + ')).join(' vs ')}). See: whatsloaded where ${name}`,
      refs: variants.map((v) => ref(v[0]!)),
    });
  }

  // 2b. The command a configuration launches does not exist on this machine.
  const missing = mcps.filter((i) => i.enabled && i.runtime && !i.runtime.found && !i.runtime.unresolved);
  for (const [, entries] of groupBy(missing, (i) => `${i.name}\u0000${i.runtime!.command}`)) {
    const { name } = entries[0]!;
    const command = entries[0]!.runtime!.command;
    const n = entries.length;
    const pinned = pinnedVersionHint(command);
    out.push({
      severity: entries.some((e) => e.role === 'owned') ? 'error' : 'warn',
      code: 'runtime-not-found',
      subject: { kind: 'mcp', name },
      message: `${name}: ${pinned ?? `\`${command}\` is not installed or not on PATH`} (${n} configuration${n === 1 ? '' : 's'} launch it)`,
      refs: entries.map(ref),
    });
  }

  // 2c. Agents use a server's tools but cannot see any configuration for it. One finding per
  //     (harness, server, reason), listing the agents, rather than one per agent.
  const blind = inv.references.filter((r) => !r.ownEntry && !(r.includesGlobal === true && r.resolved));
  const reasonOf = (r: (typeof blind)[number]) =>
    r.hint ??
    (!r.resolved
      ? `no ${r.harness} configuration named ${r.server} exists`
      : r.includesGlobal === false
        ? 'they have no entry of their own and are set not to load the shared configuration'
        : `they have no entry of their own and do not declare that they load the shared ${r.harness} configuration`);
  for (const [, refs] of groupBy(blind, (r) => `${r.harness}\u0000${r.server}\u0000${reasonOf(r)}`)) {
    const r = refs[0]!;
    const names = refs.map((x) => refName(x.by));
    out.push({
      severity: 'warn',
      code: 'reference-unconfigured',
      subject: { kind: 'mcp', name: r.server, harness: r.harness },
      message: `${refs.length} ${r.harness} agent${refs.length === 1 ? ' uses' : 's use'} ${r.server} tools, but ${reasonOf(r)}: ${names.slice(0, 3).join(', ')}${names.length > 3 ? `, +${names.length - 3} more` : ''}`,
      refs: refs.map((x) => x.by),
    });
  }

  // 2. Claude namespaces plugin MCPs, so N plugins bundling the same server start N processes.
  // Agent profiles are excluded: they only start while their agent runs.
  const claudeEnabled = mcps.filter((i) => i.scope.harness === 'claude' && i.enabled && i.role !== 'agent-profile');
  for (const [name, copies] of groupBy(claudeEnabled, (i) => i.name)) {
    if (copies.length < 2) continue;
    out.push({
      severity: 'info',
      code: 'duplicate-instances',
      message: `claude starts ${copies.length} separate ${name} servers (${copies.map((c) => c.scope.owner ?? c.scope.level).join(', ')})`,
      refs: copies.map(ref),
    });
  }

  // 3. Within one harness, a narrower scope silently overrides a broader one.
  const own = mcps.filter((i) => ['user', 'project', 'local'].includes(i.scope.level));
  for (const [, copies] of groupBy(own, (i) => `${i.scope.harness}/${i.name}`)) {
    if (copies.length < 2) continue;
    const [winner, ...shadowed] = copies; // inventory is sorted local > project > user
    out.push({
      severity: 'info',
      code: 'shadowed',
      message: `${ref(winner!)} overrides ${shadowed.map(ref).join(', ')}`,
      refs: copies.map(ref),
    });
  }

  // 4. Skill copies that aren't shared through the store drift independently.
  const skills = inv.items.filter((i) => i.kind === 'skill' && i.scope.level !== 'plugin' && !i.parked);
  for (const [name, copies] of groupBy(skills, (i) => i.name)) {
    const standalone = copies.filter((c) => !c.link && c.scope.harness !== 'agents');
    if (standalone.length > 1 || (standalone.length === 1 && copies.length > 1)) {
      out.push({
        severity: 'info',
        code: 'unshared-skill',
        message: `${name} exists as ${standalone.length} standalone cop${standalone.length === 1 ? 'y' : 'ies'} (${standalone.map(ref).join(', ')}); share one copy with: whatsloaded adopt ${ref(standalone[0]!)}`,
        refs: standalone.map(ref),
      });
    }
  }

  // 5. Store skills no harness links to.
  const store = inv.items.filter((i) => i.scope.harness === 'agents' && i.scope.level === 'store');
  const linked = new Set(inv.items.flatMap((i) => (i.link ? [i.link.target] : [])));
  for (const s of store) {
    if (!linked.has(s.location.file)) {
      out.push({
        severity: 'info',
        code: 'orphan-store-skill',
        message: `${s.name} is in ~/.agents/skills but not linked into any harness`,
        refs: [ref(s)],
      });
    }
  }

  for (const p of inv.providers) {
    try {
      out.push(...(p.diagnose?.(inv, inv.helpers) ?? []));
    } catch (e) {
      out.push({ severity: 'error', code: 'provider-crash', message: `${p.id}: ${(e as Error).message}` });
    }
  }

  const parked = inv.items.filter((i) => i.parked);
  if (parked.length)
    out.push({
      severity: 'info',
      code: 'parked',
      message: `${parked.length} item(s) disabled by whatsloaded: ${parked.map(ref).join(', ')}`,
    });

  const order = { error: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}
