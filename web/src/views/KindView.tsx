import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronRight, Lock, Search, Waypoints } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ItemDTO, Kind, StateDTO } from '../api';
import { AddServerButton } from '../components/AddServer';
import { HarnessDot, SpecLine, Spectrum, StateDot } from '../components/atoms';
import { ServerControl } from '../components/ServerControl';
import { Badge, Checkbox, Input, Kbd, Switch, Tip } from '../components/ui';
import { type Group, groupItems, groupSummary, visible } from '../lib/group';
import { cn, KIND_META, scopeText } from '../lib/meta';
import { usePlans, useUi } from '../store';

type Row = { t: 'group'; g: Group; open: boolean } | { t: 'copy'; i: ItemDTO; last: boolean };

export function KindView({ kind, state }: { kind: Kind; state: StateDTO }) {
  const ui = useUi();
  const { propose } = usePlans();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [driftOnly, setDriftOnly] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => {
    const gs = groupItems(
      visible(state.items, ui.filters).filter((i) => i.kind === kind),
      state.references,
    );
    return gs.filter((g) => !driftOnly || g.variants > 1).sort((a, b) => a.name.localeCompare(b.name));
  }, [state, ui.filters, kind, driftOnly]);

  const rows = useMemo<Row[]>(
    () =>
      groups.flatMap((g) => {
        const isOpen = open.has(g.key) && g.copies.length > 1;
        const head: Row = { t: 'group', g, open: isOpen };
        return isOpen ? [head, ...g.copies.map((i, n) => ({ t: 'copy' as const, i, last: n === g.copies.length - 1 }))] : [head];
      }),
    [groups, open],
  );

  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (n) => (rows[n]!.t === 'group' ? 58 : 40),
    overscan: 12,
  });

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        search.current?.focus();
      }
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, []);

  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const copies = groups.reduce((a, g) => a + g.copies.length, 0);
  const Icon = KIND_META[kind].icon;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-4 px-8 pt-5 pb-4">
        <div className="relative w-80">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-paper-4" />
          <Input
            ref={search}
            value={ui.filters.query}
            onChange={(e) => ui.setQuery(e.target.value)}
            placeholder={`Filter ${KIND_META[kind].label.toLowerCase()}…`}
            className="pl-8"
          />
          <span className="absolute top-1/2 right-2 -translate-y-1/2">
            <Kbd>/</Kbd>
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {state.tools.map((t) => {
            const on = ui.filters.harnesses.has(t.harness);
            return (
              <button
                type="button"
                key={t.harness}
                onClick={() => ui.toggleHarness(t.harness)}
                className={cn(
                  'flex h-7 items-center gap-1.5 rounded-full border px-2.5 font-mono text-[11.5px] transition-colors',
                  on ? 'border-lume/50 bg-lume/10 text-paper' : 'border-white/8 text-paper-3 hover:text-paper-2',
                )}
              >
                <HarnessDot id={t.harness} size={6} /> {t.harness}
              </button>
            );
          })}
        </div>
        {kind === 'mcp' ? (
          <Checkbox checked={driftOnly} onChange={setDriftOnly}>
            only where your tools differ
          </Checkbox>
        ) : (
          <Checkbox checked={ui.filters.includePlugins} onChange={ui.setIncludePlugins}>
            include plugin contents
          </Checkbox>
        )}
        <span className="ml-auto font-mono text-[11.5px] text-paper-4">
          {groups.length} names · {copies} configurations
        </span>
        {kind === 'mcp' && <AddServerButton state={state} />}
      </div>

      <div className="grid grid-cols-[minmax(260px,1.3fr)_minmax(240px,1fr)_168px_156px] gap-4 border-y border-white/6 bg-ink-1/40 px-8 py-2 text-[10.5px] tracking-[0.14em] text-paper-4 uppercase">
        <span>name</span>
        <span>where</span>
        <span>needs attention</span>
        <span className="text-right">on</span>
      </div>

      <div ref={scroller} className="scroll-thin relative flex-1 overflow-y-auto">
        {!rows.length && (
          <div className="reticle flex h-full flex-col items-center justify-center gap-3 text-paper-4">
            <Icon className="h-8 w-8" strokeWidth={1.25} />
            <p className="font-display text-[20px] italic">Nothing in focus</p>
            <p className="text-[12.5px]">Try clearing filters, or show plugin items.</p>
          </div>
        )}
        <div style={{ height: v.getTotalSize() }} className="relative">
          {v.getVirtualItems().map((vi) => {
            const row = rows[vi.index]!;
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={v.measureElement}
                className="absolute inset-x-0"
                style={{ transform: `translateY(${vi.start}px)` }}
              >
                {row.t === 'group' ? (
                  <GroupRow
                    g={row.g}
                    state={state}
                    open={row.open}
                    onToggle={() => (row.g.copies.length > 1 ? toggle(row.g.key) : ui.select(row.g.copies[0]!.ref))}
                  />
                ) : (
                  <CopyRow
                    i={row.i}
                    last={row.last}
                    onOpen={() => ui.select(row.i.ref)}
                    onToggle={(on) => propose({ action: on ? 'enable' : 'disable', refs: [row.i.ref] })}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function GroupRow({ g, open, onToggle, state }: { g: Group; open: boolean; onToggle: () => void; state: StateDTO }) {
  const multi = g.copies.length > 1;
  const first = g.copies[0]!;
  return (
    <div
      className={cn(
        'grid w-full grid-cols-[minmax(260px,1.3fr)_minmax(240px,1fr)_168px_156px] items-center gap-4 border-b border-white/4 px-8 transition-colors hover:bg-white/[0.025]',
        open && 'bg-white/[0.02]',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="col-span-3 grid grid-cols-[minmax(260px,1.3fr)_minmax(240px,1fr)_168px] items-center gap-4 py-2.5 text-left"
      >
        <div className="flex min-w-0 items-start gap-2">
          <ChevronRight
            className={cn('mt-0.5 h-3.5 w-3.5 shrink-0 text-paper-4 transition-transform', open && 'rotate-90', !multi && 'opacity-0')}
          />
          <div className="min-w-0">
            <div className="truncate font-mono text-[13px] text-paper">{g.name}</div>
            <div className="mt-0.5 truncate text-[12px] text-paper-4">
              {first.kind === 'mcp' ? (
                <span className="font-mono text-[11.5px]">{groupSummary(g)}</span>
              ) : (
                (g.description ?? first.location.file)
              )}
            </div>
          </div>
        </div>
        <Spectrum copies={g.copies} />
        <div className="flex flex-wrap items-center gap-1">
          {g.missing && (
            <Tip content="the program it starts does not exist on this machine">
              <span>
                <Badge tone="bad">not installed</Badge>
              </span>
            </Tip>
          )}
          {g.variants > 1 && (
            <Tip content="your own configurations launch it in different ways">
              <span>
                <Badge tone="lume">{g.variants} variants</Badge>
              </span>
            </Tip>
          )}
          {g.managed > 0 && (
            <Tip content={`${g.managed} of its configurations belong to an installer or plugin; changing them needs force`}>
              <span>
                <Badge>
                  <Lock className="h-2.5 w-2.5" />
                  {g.managed}
                </Badge>
              </span>
            </Tip>
          )}
          {g.copies.some((c) => c.link?.broken) && (
            <Tip content="a link points to a folder that no longer exists">
              <span>
                <Badge tone="bad">broken</Badge>
              </span>
            </Tip>
          )}
          {g.copies.some((c) => c.parked) && (
            <Tip content="turned off by whatsloaded; turn it on to restore it">
              <span>
                <Badge tone="coat">parked</Badge>
              </span>
            </Tip>
          )}
        </div>
      </button>
      <div className="flex items-center justify-end gap-2.5">
        <Tip content={`${g.on} of ${g.copies.length} configurations are on`}>
          <span
            className={cn(
              'tabular text-right font-mono text-[12px]',
              g.on === g.copies.length ? 'text-ok' : g.on === 0 ? 'text-paper-4' : 'text-lume',
            )}
          >
            {g.on}/{g.copies.length}
          </span>
        </Tip>
        {g.kind === 'mcp' && <MapButton name={g.name} />}
        {g.kind === 'mcp' && <ServerControl name={g.name} state={state} />}
      </div>
    </div>
  );
}

function MapButton({ name }: { name: string }) {
  const { go } = useUi();
  return (
    <Tip content={`See everything ${name} brings and what relies on it`}>
      <button
        type="button"
        aria-label={`map of ${name}`}
        onClick={() => go(`server:${name}`)}
        className="rounded p-1 text-paper-4 hover:bg-white/6 hover:text-paper"
      >
        <Waypoints className="h-3.5 w-3.5" />
      </button>
    </Tip>
  );
}

function CopyRow({ i, last, onOpen, onToggle }: { i: ItemDTO; last: boolean; onOpen: () => void; onToggle: (on: boolean) => void }) {
  return (
    <div
      className={cn(
        'group grid grid-cols-[minmax(260px,1.3fr)_minmax(240px,1fr)_168px_156px] items-center gap-4 bg-ink-1/30 px-8 py-2 transition-colors hover:bg-white/[0.03]',
        last && 'border-b border-white/6',
      )}
    >
      <button type="button" onClick={onOpen} className="flex min-w-0 items-center gap-2.5 pl-5.5 text-left">
        <span className="h-4 w-px bg-white/10" />
        <HarnessDot id={i.harness} dim={!i.enabled} />
        <span className="font-mono text-[12px] text-paper-2">{i.harness}</span>
        <span className="truncate font-mono text-[12px] text-paper-4">{scopeText(i)}</span>
      </button>
      <button type="button" onClick={onOpen} className="truncate text-left font-mono text-[11.5px] text-paper-4 group-hover:text-paper-3">
        {i.mcp ? <SpecLine spec={i.mcp} className="text-[11.5px]" /> : i.link ? `→ ${i.link.target}` : i.location.file}
      </button>
      <div className="flex items-center gap-1">
        {i.variant !== undefined && (i.variants ?? 1) > 1 && (
          <Badge tone={i.variant === 0 ? 'muted' : 'lume'}>{'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[i.variant]}</Badge>
        )}
        {i.managedBy && <Lock className="h-3 w-3 text-paper-4" />}
        <StateDot item={i} />
      </div>
      <div className="flex justify-end">
        <Switch
          checked={i.enabled}
          disabled={i.level === 'plugin' || i.level === 'managed'}
          onChange={onToggle}
          label={`toggle ${i.ref}`}
        />
      </div>
    </div>
  );
}
