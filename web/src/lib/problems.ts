import type { ItemDTO, PlanRequest, Problem, StateDTO } from '../api';

/** Plain-language titles: what happened, not the internal check name. */
export const PROBLEM_TITLE: Record<string, string> = {
  'runtime-not-found': 'Command not installed',
  'mcp-drift': 'Your tools launch this server differently',
  'broken-link': 'Broken link',
  'parse-error': 'Config file cannot be read',
  'unshared-skill': 'Skill copied instead of shared',
  'reference-unconfigured': 'Agents use tools they cannot reach',
  'duplicate-instances': 'Same server started several times',
  shadowed: 'One setting hides another',
  'orphan-store-skill': 'Shared skill nobody uses',
  parked: 'Turned off by whatsloaded',
  'adapter-load': 'Extension failed to load',
  'provider-load': 'Extension failed to load',
  'extension-unsafe': 'Extension refused (unsafe permissions)',
  'config-invalid': 'whatsloaded settings cannot be read',
};

export type Bucket = 'yours' | 'others' | 'info';

/**
 * Who can act on a problem:
 *   yours   it involves something you own (or a file you can fix)
 *   others  everything involved belongs to a plugin or installer; only its owner can fix it
 *   info    worth knowing, nothing is wrong
 */
export function bucketOf(p: Problem, byRef: Map<string, ItemDTO>): Bucket {
  if (p.severity === 'info') return 'info';
  const items = (p.refs ?? []).map((r) => byRef.get(r)).filter((i): i is ItemDTO => !!i);
  if (!items.length) return 'yours';
  return items.some(isYours) ? 'yours' : 'others';
}

/**
 * Something you can change yourself: your own entry that no installer locks. Files another tool
 * installed (agents, skills, rules) belong to that tool even when unlocked; a config entry such
 * as an MCP server stays yours to switch off even if another tool installed the binary it runs.
 */
export function isYours(i: ItemDTO): boolean {
  // Servers inside your own agent definitions are yours too; those in an installer's agents are not.
  const mine = i.role === 'owned' || (i.role === 'agent-profile' && !i.installedBy);
  return mine && !i.managedBy && (i.kind === 'mcp' || !i.installedBy);
}

export function bucketed(state: StateDTO): Record<Bucket, Problem[]> {
  const byRef = new Map(state.items.map((i) => [i.ref, i]));
  const out: Record<Bucket, Problem[]> = { yours: [], others: [], info: [] };
  for (const p of state.problems) out[bucketOf(p, byRef)].push(p);
  return out;
}

/** Problems that touch a given tool. */
export const problemsFor = (ps: Problem[], harness: string) => ps.filter((p) => p.refs?.some((r) => r.startsWith(`${harness}:`)));

/** One line on what to do about each kind of problem. */
export const PROBLEM_HINT: Record<string, string> = {
  'runtime-not-found': 'Install the command, or turn the entry off so the tool stops trying to start it.',
  'mcp-drift': 'Open it to compare your configurations, then make them match.',
  'reference-unconfigured': 'Give the tool a configuration for this server, or remove those tools from the agents.',
  'broken-link': 'Remove the link, or point it at the right folder.',
  'unshared-skill': 'Move it into ~/.agents/skills so every tool shares one copy.',
  'parse-error': 'Fix the syntax in that file; whatsloaded skips it until then.',
  'duplicate-instances': 'Turn off plugins you do not need; each one starts its own copy.',
  'orphan-store-skill': 'Link it into a tool, or remove it from the shared store.',
};

export interface Fix {
  label: string;
  req: PlanRequest;
}

const toolName = (state: StateDTO, h: string) => state.tools.find((t) => t.harness === h)?.label.split(' / ')[0] ?? h;

/** Concrete one-click fixes, each going through the normal review dialog. */
export function fixesFor(p: Problem, state: StateDTO): Fix[] {
  const byRef = new Map(state.items.map((i) => [i.ref, i]));
  const mine = (i?: ItemDTO): i is ItemDTO => !!i && isYours(i);
  const out: Fix[] = [];
  if (p.code === 'runtime-not-found') {
    const refs = (p.refs ?? [])
      .map((r) => byRef.get(r))
      .filter(mine)
      .filter((i) => i.enabled);
    if (refs.length)
      out.push({
        label: refs.length === 1 ? 'Turn it off' : `Turn off ${refs.length}`,
        req: { action: 'disable', refs: refs.map((i) => i.ref) },
      });
  }
  if (p.code === 'reference-unconfigured' && p.subject?.harness) {
    const { name, harness } = p.subject;
    const writable = state.adapters.find((a) => a.id === harness)?.writable.mcp?.includes('user');
    const hasOwn = state.items.some((i) => i.kind === 'mcp' && i.name === name && i.harness === harness && i.role === 'owned');
    const source = state.items
      .filter((i) => i.kind === 'mcp' && i.name === name && i.harness !== harness && mine(i))
      .sort((a, b) => Number(b.level === 'user') - Number(a.level === 'user'))[0];
    if (writable && !hasOwn && source) {
      out.push({
        label: `Add ${name} to ${toolName(state, harness)}`,
        req: { action: 'copy', refs: [source.ref], targets: [`${harness}:user`] },
      });
    }
  }
  if (p.code === 'unshared-skill' && p.refs?.[0]) out.push({ label: 'Share it', req: { action: 'adopt', refs: [p.refs[0]] } });
  return out;
}
