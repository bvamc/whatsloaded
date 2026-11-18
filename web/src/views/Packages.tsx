import { ArrowLeft, Copy, Package as PackageIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { ItemDTO, Kind, Package, StateDTO } from '../api';
import { HarnessDot } from '../components/atoms';
import { cn, harnessMeta, KIND_META, relTime } from '../lib/meta';
import { useUi } from '../store';

const toolLabel = (h: string) => harnessMeta(h).label.split(' / ')[0]!;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ROWS: Kind[] = ['agent', 'skill', 'mcp', 'plugin', 'command', 'rule'];
const ORDER = ['claude', 'codex', 'kiro', 'opencode', 'agents'];

interface Contents {
  /** Distinct names per kind, and per kind × tool. */
  byKind: Map<Kind, Map<string, ItemDTO[]>>;
  harnesses: string[];
}

function contentsOf(pkg: Package, state: StateDTO): Contents {
  const refs = new Set(pkg.members);
  const items = state.items.filter((i) => refs.has(i.ref));
  const byKind = new Map<Kind, Map<string, ItemDTO[]>>();
  // Tools name the same thing differently ("Pkg-agent" in one, "agent" in another): merge on the bare name.
  const prefix = `${pkg.name}-`;
  for (const i of items) {
    const names = byKind.get(i.kind) ?? new Map<string, ItemDTO[]>();
    const name = i.name.startsWith(prefix) ? i.name.slice(prefix.length) : i.name;
    names.set(name, [...(names.get(name) ?? []), i]);
    byKind.set(i.kind, names);
  }
  const harnesses = [...new Set(items.map((i) => i.harness))].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  return { byKind, harnesses };
}

function kindWords(k: Kind, n: number): string {
  if (k === 'mcp') return plural(n, 'MCP server');
  const m = KIND_META[k];
  return `${n} ${n === 1 ? m.one : m.label.toLowerCase()}`;
}

function summaryOf(c: Contents): string {
  const parts = ROWS.filter((k) => c.byKind.get(k)?.size).map((k) => kindWords(k, c.byKind.get(k)!.size));
  return `${parts.join(', ')}${c.harnesses.length ? ` in ${c.harnesses.map(toolLabel).join(', ')}` : ''}`;
}

/** Everything an installer put on this machine as one unit, e.g. an agent package. */
export function PackageList({ state }: { state: StateDTO }) {
  const { go } = useUi();
  if (!state.packages.length)
    return (
      <div className="mx-auto max-w-xl px-8 py-16 text-center text-paper-3">
        <p className="font-display text-[22px] text-paper-2 italic">No packages known</p>
        <p className="mt-2 text-[13px]">
          Packages come from installer providers in ~/.whatsloaded/providers. Without one, every item still appears under Browse everything.
        </p>
      </div>
    );
  return (
    <div className="scroll-thin h-full overflow-auto px-8 py-6">
      <p className="mb-4 max-w-3xl text-[13px] text-paper-3">
        A package is something you installed with one command that put many things into your tools. Open one to see everything it added and
        where.
      </p>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(360px,1fr))] gap-3">
        {state.packages.map((p) => {
          const c = contentsOf(p, state);
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => go(`package:${p.id}`)}
                className="w-full rounded-xl border border-white/8 bg-ink-1/70 px-4 py-3 text-left transition-colors hover:border-white/20"
              >
                <p className="flex items-center gap-2">
                  <PackageIcon className="h-4 w-4 shrink-0 text-paper-4" />
                  <span className="truncate font-mono text-[14px] text-paper">{p.name}</span>
                  <span className="ml-auto flex shrink-0 gap-1">
                    {c.harnesses.map((h) => (
                      <HarnessDot key={h} id={h} size={7} />
                    ))}
                  </span>
                </p>
                <p className="mt-1 text-[12.5px] text-paper-3">{p.members.length ? summaryOf(c) : 'nothing of it found in your tools'}</p>
                <p className="mt-1 font-mono text-[11px] text-paper-4">
                  by {p.by}
                  {p.version && ` · ${p.version}`}
                  {p.installedAt && ` · updated ${relTime(p.installedAt)}`}
                </p>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One package: a table of what it added to which tool, and the items behind any cell. */
export function PackageView({ id, state }: { id: string; state: StateDTO }) {
  const { go, select } = useUi();
  const pkg = state.packages.find((p) => p.id === id);
  const c = useMemo(() => (pkg ? contentsOf(pkg, state) : undefined), [pkg, state]);
  const rows = c ? ROWS.filter((k) => c.byKind.get(k)?.size) : [];
  const [cell, setCell] = useState<{ kind: Kind; harness?: string }>();
  const shown = cell ?? (rows[0] ? { kind: rows[0] } : undefined);

  if (!pkg || !c)
    return (
      <div className="flex h-full items-center justify-center text-paper-3">
        <p>
          No package <span className="font-mono">{id}</span>.
        </p>
      </div>
    );

  const list = shown
    ? [...(c.byKind.get(shown.kind) ?? new Map<string, ItemDTO[]>())]
        .map(([name, items]) => ({ name, items: shown.harness ? items.filter((i) => i.harness === shown.harness) : items }))
        .filter((x) => x.items.length)
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  return (
    <div className="scroll-thin h-full overflow-auto">
      <header className="px-8 pt-6 pb-2">
        <button
          type="button"
          onClick={() => go('packages')}
          className="mb-2 flex items-center gap-1.5 text-[12px] text-paper-4 hover:text-paper-2"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Packages
        </button>
        <h1 className="font-mono text-[26px] text-paper">{pkg.name}</h1>
        <p className="mt-1 text-[14px] text-paper-2">
          Installed by {pkg.by}. It added {summaryOf(c)}.
        </p>
        <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-[12.5px]">
          {pkg.installedWith && <Cmd label="Installed with" cmd={pkg.installedWith} />}
          {pkg.uninstall && <Cmd label="Remove it with" cmd={pkg.uninstall} />}
          {pkg.version && (
            <span className="text-paper-4">
              Version <span className="font-mono text-paper-3">{pkg.version}</span>
              {pkg.installedAt && ` · updated ${relTime(pkg.installedAt)}`}
            </span>
          )}
        </div>
      </header>

      <div className="px-8 pt-4 pb-10">
        <table className="w-full max-w-[880px] border-separate border-spacing-0 overflow-hidden rounded-xl border border-white/8 text-[12.5px]">
          <thead>
            <tr className="bg-ink-1/60 text-left text-[10.5px] tracking-[0.12em] text-paper-4 uppercase">
              <th className="px-4 py-2 font-normal">What</th>
              {c.harnesses.map((h) => (
                <th key={h} className="px-4 py-2 font-normal">
                  <span className="flex items-center gap-1.5">
                    <HarnessDot id={h} size={6} /> {toolLabel(h)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((k) => {
              const names = c.byKind.get(k)!;
              return (
                <tr key={k} className="border-t border-white/5">
                  <td className="border-t border-white/5 px-4 py-1.5">
                    <CellButton on={shown?.kind === k && !shown.harness} onClick={() => setCell({ kind: k })}>
                      {kindWords(k, names.size)}
                    </CellButton>
                  </td>
                  {c.harnesses.map((h) => {
                    const n = [...names.values()].filter((items) => items.some((i) => i.harness === h)).length;
                    return (
                      <td key={h} className="border-t border-white/5 px-4 py-1.5 font-mono">
                        {n ? (
                          <CellButton on={shown?.kind === k && shown.harness === h} onClick={() => setCell({ kind: k, harness: h })}>
                            {n}
                          </CellButton>
                        ) : (
                          <span className="px-2 text-paper-4">·</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {c.byKind.get('mcp')?.size ? (
          <p className="mt-2 max-w-[880px] text-[11.5px] text-paper-4">
            MCP servers here are the ones its agents and plugins turn on; a server is only installed by this package if its own page says
            so.
          </p>
        ) : null}

        {shown && (
          <section className="mt-6 max-w-[880px] rounded-xl border border-white/8 bg-ink-1/60 p-5">
            <h2 className="text-[14px] text-paper">
              {kindWords(shown.kind, list.length)}
              {shown.harness ? ` in ${toolLabel(shown.harness)}` : ''}
            </h2>
            <ul className="scroll-thin mt-3 grid max-h-[460px] grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-x-6 gap-y-0.5 overflow-y-auto pr-1">
              {list.map(({ name, items }) => (
                <li key={name}>
                  <button
                    type="button"
                    title={items[0]!.description ?? name}
                    onClick={() => (shown.kind === 'mcp' ? go(`server:${name}`) : select(items[0]!.ref))}
                    className="flex w-full items-center gap-2 py-0.5 text-left"
                  >
                    <span className="flex gap-0.5">
                      {[...new Set(items.map((i) => i.harness))].map((h) => (
                        <HarnessDot key={h} id={h} size={6} dim={!items.some((i) => i.harness === h && i.enabled)} />
                      ))}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-paper-2 hover:text-paper">{name}</span>
                    {items.length > 1 && <span className="shrink-0 text-[11px] text-paper-4">×{items.length}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function CellButton({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('rounded px-2 py-0.5 text-left hover:bg-white/6 hover:text-paper', on ? 'bg-lume/15 text-paper' : 'text-paper-2')}
    >
      {children}
    </button>
  );
}

function Cmd({ label, cmd }: { label: string; cmd: string }) {
  return (
    <span className="flex items-center gap-2 text-paper-4">
      {label}
      <code className="rounded bg-ink-3 px-1.5 py-0.5 font-mono text-[12px] text-paper-2">{cmd}</code>
      <button
        type="button"
        aria-label={`copy ${cmd}`}
        onClick={() => void navigator.clipboard.writeText(cmd).then(() => toast('Command copied'))}
        className="text-paper-4 hover:text-paper-2"
      >
        <Copy className="h-3 w-3" />
      </button>
    </span>
  );
}
