/**
 * MCP registries that speak the open registry API (`/v0.1/servers`): GitHub's curated registry
 * (the one VS Code and Copilot use) and the official MCP Registry. Entries carry structured
 * packages (npm, PyPI, Docker) and hosted endpoints, so whatsloaded can write the configuration
 * itself, into the tools you pick, with a diff first.
 */
import type { McpSpec } from '../core/model.js';
import { isRecord } from '../io/fsx.js';
import { fetchJson } from './net.js';
import { type CatalogEntry, type CatalogSource, entryId, httpUrl, type InstallMethod, type Trust } from './types.js';

type Rec = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);
const arr = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter(isRecord) : []);

/** `io.github.octo/thing` → "octo"; `com.example/thing` → "example.com". */
export function publisherOf(name: string): string {
  const ns = name.split('/')[0] ?? name;
  if (ns.startsWith('io.github.')) return ns.slice('io.github.'.length);
  return ns.split('.').reverse().join('.');
}

type Input = NonNullable<Extract<InstallMethod, { type: 'mcp' }>['inputs']>[number];

function envInputs(vars: Rec[]): Input[] {
  return vars.flatMap((v) => {
    const name = str(v.name);
    return name
      ? [{ name, description: str(v.description), required: v.isRequired === true, secret: v.isSecret === true, where: 'env' as const }]
      : [];
  });
}

/** Fixed arguments only; an argument the person would have to fill in is left to them. */
function fixedArgs(args: Rec[]): string[] {
  return args.flatMap((a) => {
    const value = str(a.value) ?? str(a.default);
    if (!value || /\{\w+\}/.test(value)) return [];
    return a.type === 'named' && str(a.name) ? [str(a.name)!, value] : [value];
  });
}

const RUNNERS: Record<string, { label: string; build: (id: string, version?: string) => { command: string; args: string[] } }> = {
  npm: { label: 'Run with npx (Node.js)', build: (id, v) => ({ command: 'npx', args: ['-y', v ? `${id}@${v}` : id] }) },
  pypi: { label: 'Run with uvx (Python)', build: (id, v) => ({ command: 'uvx', args: [v ? `${id}==${v}` : id] }) },
  oci: { label: 'Run in Docker', build: (id) => ({ command: 'docker', args: ['run', '-i', '--rm', id] }) },
};

export function methodsOf(server: Rec): InstallMethod[] {
  const out: InstallMethod[] = [];
  for (const r of arr(server.remotes)) {
    const url = httpUrl(r.url);
    if (!url || /\{\w+\}/.test(url) || /smithery/i.test(new URL(url).host)) continue;
    const headers = arr(r.headers);
    out.push({
      type: 'mcp',
      label: `Hosted by ${new URL(url).host}`,
      spec: { transport: r.type === 'sse' ? 'sse' : 'http', url },
      inputs: headers.flatMap((h) => {
        const name = str(h.name);
        return name
          ? [
              {
                name,
                description: str(h.description),
                required: h.isRequired === true,
                secret: h.isSecret === true,
                where: 'header' as const,
              },
            ]
          : [];
      }),
    });
  }
  for (const p of arr(server.packages)) {
    const runner = RUNNERS[String(p.registryType)];
    const id = str(p.identifier);
    const transport = isRecord(p.transport) ? p.transport.type : 'stdio';
    if (!runner || !id || transport !== 'stdio') continue;
    const vars = arr(p.environmentVariables);
    const { command, args } = runner.build(id, str(p.version));
    const env = vars.map((v) => str(v.name)).filter((n): n is string => !!n);
    const spec: McpSpec = {
      transport: 'stdio',
      command,
      // Docker passes each setting into the container by name.
      args:
        p.registryType === 'oci'
          ? [...args.slice(0, -1), ...env.flatMap((n) => ['-e', n]), args.at(-1)!, ...fixedArgs(arr(p.packageArguments))]
          : [...args, ...fixedArgs(arr(p.packageArguments))],
    };
    out.push({ type: 'mcp', label: runner.label, spec, inputs: envInputs(vars) });
  }
  return out;
}

interface RegistryOptions {
  id: string;
  label: string;
  description: string;
  base: string;
  trust: (server: Rec, meta: Rec) => Trust;
  /** Shortest search the registry answers (the official one needs 3 letters). */
  minQuery: number;
}

function toEntry(o: RegistryOptions, item: Rec): CatalogEntry | undefined {
  const server = isRecord(item.server) ? item.server : undefined;
  const meta = isRecord(item._meta) ? item._meta : {};
  const name = str(server?.name);
  if (!server || !name) return undefined;
  const official = isRecord(meta['io.modelcontextprotocol.registry/official']) ? meta['io.modelcontextprotocol.registry/official'] : {};
  if (official.status && official.status !== 'active') return undefined;
  if (name.startsWith('ai.smithery/')) return undefined; // the hosting it points at has shut down
  const install = methodsOf(server);
  // Publisher-provided facts sit in the server's own _meta (GitHub's registry), or beside it.
  const key = 'io.modelcontextprotocol.registry/publisher-provided';
  const inner = isRecord(server._meta) ? server._meta : {};
  const provided = isRecord(inner[key]) ? inner[key] : isRecord(meta[key]) ? meta[key] : {};
  const gh = isRecord(provided.github) ? provided.github : {};
  const short = name.split('/').at(-1) ?? name;
  const secrets = install.flatMap((m) => (m.type === 'mcp' ? (m.inputs ?? []).filter((i) => i.secret).map((i) => i.name) : []));
  const facts: [string, string][] = [];
  if (typeof gh.stargazerCount === 'number') facts.push(['Stars', gh.stargazerCount.toLocaleString()]);
  if (str(gh.license)) facts.push(['License', str(gh.license)!]);
  if (install.length) facts.push(['Runs', install.map((m) => m.label).join(' · ')]);
  if (secrets.length) facts.push(['Needs', [...new Set(secrets)].join(', ')]);
  return {
    id: entryId(o.id, 'mcp', name),
    source: o.id,
    kind: 'mcp',
    name: short,
    installName: name,
    description: str(server.description),
    publisher: publisherOf(name),
    version: str(server.version),
    trust: o.trust(server, gh),
    url: httpUrl(isRecord(server.repository) ? server.repository.url : undefined) ?? httpUrl(server.websiteUrl),
    tools: [],
    install,
    facts,
  };
}

export function registrySource(o: RegistryOptions): CatalogSource {
  return {
    id: o.id,
    label: o.label,
    description: o.description,
    kinds: ['mcp'],
    access: 'network',
    url: o.base,
    detect: () => true,
    async search(_ctx, q, signal) {
      if (q.kind && q.kind !== 'mcp') return { entries: [] };
      const text = q.text?.trim() ?? '';
      if (text.length < o.minQuery) return { entries: [], note: `Type at least ${o.minQuery} letters to search ${o.label}.` };
      const p = new URLSearchParams({ limit: String(Math.min(q.limit ?? 50, 100)), version: 'latest' });
      if (text) p.set('search', text);
      if (q.cursor) p.set('cursor', q.cursor);
      const body = await fetchJson(`${o.base}/v0.1/servers?${p}`, { signal });
      if (!isRecord(body)) return { entries: [] };
      const meta = isRecord(body.metadata) ? body.metadata : {};
      const entries = arr(body.servers)
        .map((s) => toEntry(o, s))
        .filter((e): e is CatalogEntry => !!e);
      return { entries, next: str(meta.nextCursor), total: typeof meta.total === 'number' ? meta.total : undefined };
    },
    async get(_ctx, id) {
      const name = id.split(':').slice(2).join(':');
      const body = await fetchJson(`${o.base}/v0.1/servers/${encodeURIComponent(name)}/versions/latest`);
      return isRecord(body) ? toEntry(o, body) : undefined;
    },
  };
}

export const githubMcpRegistry = registrySource({
  id: 'github-mcp',
  label: 'GitHub MCP Registry',
  description: 'MCP servers curated by GitHub, the list VS Code and Copilot use',
  base: 'https://api.mcp.github.com',
  // Curated by GitHub; an organisation's own repository counts as verified.
  trust: (_s, gh) => (gh.isInOrganization === true ? 'verified' : 'community'),
  minQuery: 0,
});

export const officialMcpRegistry = registrySource({
  id: 'mcp-registry',
  label: 'MCP Registry',
  description: 'Every server published to the official MCP Registry; publishers prove they own their namespace, nothing more',
  base: 'https://registry.modelcontextprotocol.io',
  trust: () => 'unreviewed',
  minQuery: 3,
});
