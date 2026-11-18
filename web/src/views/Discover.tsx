import { useQueries, useQuery } from '@tanstack/react-query';
import { Check, ExternalLink, Globe, HardDrive, Search, ShieldCheck, Terminal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, type CatalogEntry, type CatalogKind, type CatalogSourceDTO, type StateDTO, type Trust } from '../api';
import { HarnessDot } from '../components/atoms';
import { CatalogMcpDialog } from '../components/CatalogMcpDialog';
import { InstallDialog } from '../components/InstallDialog';
import { Button } from '../components/ui';
import { cn, harnessMeta, KIND_META } from '../lib/meta';

type Entry = CatalogEntry & { installedIn: string[] };

const toolLabel = (h: string) => harnessMeta(h).label.split(' / ')[0]!;
const KINDS: { id: CatalogKind | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'package', label: 'Packages' },
  { id: 'plugin', label: 'Plugins' },
  { id: 'mcp', label: 'MCP servers' },
  { id: 'skill', label: 'Skills' },
];
const TRUST: Record<Trust, { label: string; note: string }> = {
  official: { label: 'Official', note: 'made or curated by the source’s owner' },
  verified: { label: 'Verified', note: 'reviewed, or from a verified publisher' },
  community: { label: 'Community', note: 'listed by its source, not reviewed' },
  unreviewed: { label: 'Not reviewed', note: 'the source says it has not reviewed these' },
};
const TRUST_ORDER: Trust[] = ['official', 'verified', 'community', 'unreviewed'];
const ACCESS_ICON = { local: HardDrive, network: Globe, command: Terminal };
const kindWord = (k: string) =>
  k === 'mcp' ? 'MCP server' : k === 'package' ? 'package' : (KIND_META[k as keyof typeof KIND_META]?.one ?? k);

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

/** Find something new to add to your tools, from every catalog you can reach. */
export function Discover({ state }: { state: StateDTO }) {
  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), 250);
  const [kind, setKind] = useState<CatalogKind | 'all'>('all');
  const [off, setOff] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<string>();
  const [dialog, setDialog] = useState<{ entry: Entry; action: 'install' | 'uninstall' | 'add' }>();
  const [limit, setLimit] = useState(50);
  // A new search or filter starts from the first page again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the search changes
  useEffect(() => setLimit(50), [q, kind]);

  const sources = useQuery({ queryKey: ['catalog-sources'], queryFn: api.catalogSources, staleTime: 60_000 }).data?.sources ?? [];
  const on = sources.filter((s) => !off.has(s.id) && (kind === 'all' || s.kinds.includes(kind)));
  const pages = useQueries({
    queries: on.map((s) => ({
      queryKey: ['catalog', s.id, q, kind, limit],
      queryFn: () => api.catalogPage(s.id, q, kind === 'all' ? undefined : kind, undefined, limit),
      placeholderData: (prev: unknown) => prev as never,
      staleTime: 5 * 60_000,
    })),
  });

  const entries = useMemo(() => pages.flatMap((p) => p.data?.page.entries ?? []), [pages]);
  const totals = new Map(on.map((s, i) => [s.id, pages[i]?.data?.page.total]));
  const errors = on.map((s, i) => [s, pages[i]?.error] as const).filter(([, e]) => e);
  const notes = pages.map((p) => p.data?.page.note).filter((n): n is string => !!n);
  const loading = pages.some((p) => p.isLoading);
  const more = pages.some((p) => p.data?.page.next);
  // MCP servers can go into any tool that takes MCP servers; other kinds name their tools.
  const mcpTools = state.adapters.filter((a) => a.detected && (a.writable.mcp ?? []).includes('user')).map((a) => a.id);
  const toolsOf = (e: Entry) => (e.tools.length ? e.tools : e.kind === 'mcp' ? mcpTools : []);
  const selected = entries.find((e) => e.id === picked) ?? entries[0];

  const sections = TRUST_ORDER.map((t) => ({ trust: t, list: entries.filter((e) => e.trust === t) })).filter((s) => s.list.length);

  return (
    <div className="flex h-full min-h-0">
      <div className="scroll-thin min-w-0 flex-1 overflow-y-auto px-8 py-5">
        <label className="flex h-11 items-center gap-2.5 rounded-xl border border-white/10 bg-ink-1/70 px-4 focus-within:border-lume/50">
          <Search className="h-4 w-4 text-paper-4" />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search plugins, MCP servers, skills and packages…"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-paper outline-none placeholder:text-paper-4"
            // biome-ignore lint/a11y/noAutofocus: search is the point of this page
            autoFocus
          />
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => setKind(k.id)}
              className={cn(
                'h-7 rounded-full border px-3 text-[12px]',
                kind === k.id ? 'border-lume/50 bg-lume/12 text-paper' : 'border-white/8 text-paper-3 hover:text-paper',
              )}
            >
              {k.label}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-white/10" />
          {sources.map((s) => (
            <SourceChip
              key={s.id}
              s={s}
              on={!off.has(s.id)}
              total={totals.get(s.id)}
              onToggle={() =>
                setOff((o) => {
                  const n = new Set(o);
                  if (n.has(s.id)) n.delete(s.id);
                  else n.add(s.id);
                  return n;
                })
              }
            />
          ))}
        </div>

        {errors.map(([s, e]) => (
          <p key={s.id} className="mt-3 rounded-lg border border-bad/30 bg-bad/8 px-3 py-2 text-[12.5px] text-bad">
            {s.label} could not be read: {(e as Error).message}
          </p>
        ))}

        {notes.length > 0 && <p className="mt-2 text-[12px] text-paper-4">{notes.join(' ')}</p>}

        {!sources.length && (
          <p className="mt-10 text-center text-[13px] text-paper-3">
            No catalogs found. Add a plugin marketplace to Claude Code or Codex, or a catalog in ~/.whatsloaded/installers.
          </p>
        )}

        <div className="mt-5 space-y-6">
          {sections.map(({ trust, list }) => (
            <section key={trust}>
              <p className="mb-2 flex items-baseline gap-2">
                <span className="text-[10.5px] tracking-[0.14em] text-paper-3 uppercase">{TRUST[trust].label}</span>
                <span className="font-mono text-[11px] text-paper-4">{list.length}</span>
                <span className="text-[11.5px] text-paper-4">· {TRUST[trust].note}</span>
              </p>
              <ul className="divide-y divide-white/5 overflow-hidden rounded-xl border border-white/8">
                {list.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => setPicked(e.id)}
                      className={cn(
                        'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/[0.03]',
                        selected?.id === e.id && 'bg-lume/6',
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="flex items-baseline gap-2">
                          <span className="truncate font-mono text-[13px] text-paper">{e.name}</span>
                          <span className="shrink-0 text-[11px] text-paper-4">
                            {kindWord(e.kind)}
                            {e.publisher && ` · ${e.publisher}`}
                            {e.installName?.includes('@') && ` · ${e.installName.split('@').at(-1)}`}
                          </span>
                        </p>
                        {e.description && <p className="mt-0.5 truncate text-[12px] text-paper-3">{e.description}</p>}
                      </div>
                      <span className="flex shrink-0 items-center gap-1">
                        {toolsOf(e).map((h) => (
                          <HarnessDot key={h} id={h} size={7} dim={!e.installedIn.includes(h)} />
                        ))}
                      </span>
                      {e.installedIn.length > 0 && (
                        <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-ok">
                          <Check className="h-3.5 w-3.5" /> installed
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {more && (
            <div className="flex justify-center">
              <Button variant="ghost" onClick={() => setLimit((l) => l + 100)}>
                Show more
              </Button>
            </div>
          )}
          {!loading && sources.length > 0 && !entries.length && (
            <p className="py-10 text-center text-[13px] text-paper-3">
              {q ? `Nothing matches “${q}”.` : 'Type what you are looking for, e.g. “github”, “pdf” or “browser”.'}
            </p>
          )}
        </div>
      </div>

      <aside className="scroll-thin hidden w-[400px] shrink-0 overflow-y-auto border-l border-white/6 bg-ink-1/40 p-6 lg:block">
        {selected ? (
          <Preview
            e={selected}
            tools={toolsOf(selected)}
            source={sources.find((s) => s.id === selected.source)}
            onAction={(action) => setDialog({ entry: selected, action })}
          />
        ) : (
          <p className="text-[13px] text-paper-4">Pick something to see what it is and what installing it does.</p>
        )}
      </aside>

      {dialog?.action === 'add' && <CatalogMcpDialog entry={dialog.entry} state={state} onClose={() => setDialog(undefined)} />}
      {dialog && dialog.action !== 'add' && (
        <InstallDialog entry={dialog.entry} action={dialog.action} onClose={() => setDialog(undefined)} />
      )}
    </div>
  );
}

function SourceChip({ s, on, total, onToggle }: { s: CatalogSourceDTO; on: boolean; total?: number; onToggle: () => void }) {
  const Icon = ACCESS_ICON[s.access];
  return (
    <button
      type="button"
      onClick={onToggle}
      title={`${s.description}${s.access === 'network' && s.url ? ` · ${s.url}` : ''}`}
      className={cn(
        'flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px]',
        on ? 'border-white/12 text-paper-2' : 'border-dashed border-white/8 text-paper-4 line-through',
      )}
    >
      <Icon className="h-3 w-3" /> {s.label}
      {on && total !== undefined && <span className="font-mono text-[10.5px] text-paper-4">{total}</span>}
    </button>
  );
}

function Preview({
  e,
  tools,
  source,
  onAction,
}: {
  e: Entry;
  tools: string[];
  source?: CatalogSourceDTO;
  onAction: (a: 'install' | 'uninstall' | 'add') => void;
}) {
  const commands = e.install.filter((m) => m.type === 'command');
  const configs = e.install.filter((m) => m.type === 'mcp');
  const canUninstall = e.installedIn.length > 0 && commands.some((m) => m.uninstall);
  const missing = tools.filter((t) => !e.installedIn.includes(t));
  return (
    <div className="space-y-5">
      <div>
        <p className="flex items-center gap-1.5 text-[11px] tracking-wide text-paper-4 uppercase">
          <ShieldCheck className="h-3.5 w-3.5" /> {TRUST[e.trust].label} {kindWord(e.kind)}
          {source && ` · ${source.label}`}
        </p>
        <h2 className="mt-1 font-mono text-[20px] break-all text-paper">{e.name}</h2>
        {e.publisher && <p className="text-[12.5px] text-paper-3">by {e.publisher}</p>}
        {e.description && <p className="mt-2 text-[13px] leading-relaxed text-paper-2">{e.description}</p>}
        {e.url && (
          <a
            href={e.url}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-2 inline-flex items-center gap-1 text-[12px] text-lume hover:underline"
          >
            <ExternalLink className="h-3 w-3" /> {e.url.replace(/^https?:\/\//, '')}
          </a>
        )}
      </div>

      <section>
        <p className="mb-1.5 text-[12px] text-paper-4">Where it goes</p>
        <ul className="space-y-1">
          {tools.map((h) => (
            <li key={h} className="flex items-center gap-2 text-[12.5px] text-paper-2">
              <HarnessDot id={h} size={7} dim={!e.installedIn.includes(h)} /> {toolLabel(h)}
              <span className={e.installedIn.includes(h) ? 'text-ok' : 'text-paper-4'}>
                · {e.installedIn.includes(h) ? 'installed' : 'not installed'}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {e.contents && (
        <section>
          <p className="mb-1.5 text-[12px] text-paper-4">What you get</p>
          <div className="space-y-2">
            {e.contents.map((c) => (
              <div key={c.kind}>
                <p className="text-[12px] text-paper-3">
                  {c.names.length} {c.kind === 'mcp' ? 'MCP server' : kindWord(c.kind)}
                  {c.names.length === 1 ? '' : 's'}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {c.names.map((n) => (
                    <code key={n} className="rounded bg-ink-3 px-1.5 py-0.5 font-mono text-[10.5px] text-paper-3">
                      {n}
                    </code>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {e.facts && e.facts.length > 0 && (
        <dl className="grid grid-cols-[100px_1fr] gap-x-3 gap-y-1 text-[12px]">
          {e.facts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-paper-4">{k}</dt>
              <dd className="text-paper-2">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="flex flex-wrap gap-2">
        {commands.length > 0 && (missing.length > 0 || !e.tools.length) && <Button onClick={() => onAction('install')}>Install…</Button>}
        {configs.length > 0 && (
          <Button onClick={() => onAction('add')}>{e.installedIn.length ? 'Add to more tools…' : 'Add to my tools…'}</Button>
        )}
        {canUninstall && (
          <Button variant="danger" onClick={() => onAction('uninstall')}>
            Uninstall…
          </Button>
        )}
      </div>
      {configs.length > 0 && !commands.length && (
        <p className="text-[11.5px] text-paper-4">
          whatsloaded writes it into the tools you pick. You review the exact change first, and can undo it.
        </p>
      )}
      {commands.length > 0 && (
        <p className="text-[11.5px] text-paper-4">
          Installs with {commands.map((c) => c.label.replace(/^Install with /, '')).join(' and ')}. You see the exact command before it
          runs.
        </p>
      )}
    </div>
  );
}
