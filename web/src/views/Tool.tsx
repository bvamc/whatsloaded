import { ChevronRight, Copy, Info, Lock, Scissors } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ItemDTO, Kind, LoadSourceDTO, StateDTO, ToolLoadDTO } from '../api';
import { AddServerButton } from '../components/AddServer';
import { SpecLine, StateDot, UsageChip } from '../components/atoms';
import { MeasureButton } from '../components/Measure';
import { ProfilesBar } from '../components/Profiles';
import { toolName } from '../components/Shell';
import { Badge, Button, SectionLabel, Switch, Tip } from '../components/ui';
import { cn, KIND_META } from '../lib/meta';
import { usePlans, useUi } from '../store';
import { fmtTokens, offeredLine, usedOf } from './Home';

const KINDS: Kind[] = ['mcp', 'skill', 'agent', 'command', 'rule'];
const SOURCE_HELP: Record<LoadSourceDTO['kind'], string> = {
  you: 'Settings in your home folder. You can turn each item on or off.',
  project: 'Checked into this repo, so everyone who opens it gets them.',
  plugin: 'Everything a plugin brings comes and goes with the plugin’s switch.',
  policy: 'Set by your organisation; you cannot change these here.',
};

/** Items you can switch individually: your own entries that no installer enforces. */
const selectable = (i: ItemDTO) => i.role === 'owned' && !i.managedBy && !i.locked && i.level !== 'plugin';

function counts(items: ItemDTO[], modes: boolean): string {
  return KINDS.map((k) => {
    const n = items.filter((i) => i.kind === k && !(modes && k === 'agent')).length;
    if (!n) return '';
    const label = k === 'mcp' ? 'server' : k === 'agent' ? 'subagent' : k;
    return `${n} ${label}${n === 1 ? '' : 's'}`;
  })
    .filter(Boolean)
    .join(' · ');
}

function ItemRow({
  i,
  checked,
  onCheck,
  onToggle,
  lockedReason,
  days,
}: {
  i: ItemDTO;
  days: number;
  checked: boolean;
  onCheck?: (v: boolean) => void;
  onToggle?: (on: boolean) => void;
  lockedReason?: string;
}) {
  const ui = useUi();
  const missing = i.kind === 'mcp' && i.runtime && !i.runtime.found && !i.runtime.unresolved;
  return (
    <li className={cn('group flex items-center gap-3 px-4 py-2 hover:bg-white/[0.025]', !i.enabled && 'opacity-55')}>
      {onCheck ? (
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheck(e.target.checked)}
          aria-label={`select ${i.name}`}
          className="h-3.5 w-3.5 shrink-0 accent-[var(--color-lume)]"
        />
      ) : (
        <span className="w-3.5 shrink-0" />
      )}
      <button
        type="button"
        onClick={() => ui.select(i.ref)}
        className="w-60 shrink-0 truncate text-left font-mono text-[12.5px] text-paper hover:text-lume"
      >
        {i.name}
      </button>
      <span className="min-w-0 flex-1 truncate text-[12px] text-paper-4">
        {missing ? (
          <span className="text-bad">not installed: {i.runtime!.command}</span>
        ) : i.mcp && (i.mcp.transport !== 'stdio' || i.mcp.command !== i.name || i.mcp.args?.length) ? (
          <SpecLine spec={i.mcp} className="text-[11.5px]" />
        ) : i.runtime?.resolved ? (
          <span className="font-mono text-[11.5px]">runs {i.runtime.resolved}</span>
        ) : (
          (i.description ?? '')
        )}
      </span>
      {i.tools && (
        <Tip content={`${i.tools.names.slice(0, 12).join(', ')}${i.tools.names.length > 12 ? ', …' : ''}`}>
          <span className="shrink-0 font-mono text-[10.5px] text-paper-3">
            {i.tools.count} tools · ≈{fmtTokens(i.tools.tokens)}
          </span>
        </Tip>
      )}
      <UsageChip usage={i.usage} days={days} />
      {i.installedBy && (
        <Tip
          content={
            i.kind === 'mcp' && i.role === 'owned'
              ? `${i.installedBy} installed this server; the entry is in your settings`
              : `Installed by ${i.installedBy}`
          }
        >
          <span className="shrink-0 font-mono text-[10.5px] text-paper-4">by {i.installedBy}</span>
        </Tip>
      )}
      {lockedReason ? (
        <Tip content={lockedReason}>
          <span className="flex shrink-0 items-center gap-1.5">
            <Lock className="h-3 w-3 text-paper-4" />
            <StateDot item={i} />
          </span>
        </Tip>
      ) : (
        onToggle && <Switch checked={i.enabled} onChange={onToggle} label={`turn ${i.name} ${i.enabled ? 'off' : 'on'}`} />
      )}
    </li>
  );
}

function SourceCard({
  s,
  t,
  max,
  days,
  byRef,
  selected,
  setSelected,
}: {
  s: LoadSourceDTO;
  t: ToolLoadDTO;
  /** Largest source's token count, for the size bar. */
  max: number;
  /** Usage window in days. */
  days: number;
  byRef: Map<string, ItemDTO>;
  selected: Set<string>;
  setSelected: (fn: (s: Set<string>) => Set<string>) => void;
}) {
  const { propose } = usePlans();
  const ui = useUi();
  const [open, setOpen] = useState(false);
  const items = s.refs.map((r) => byRef.get(r)).filter((i): i is ItemDTO => !!i);
  const modes = t.agentsAre === 'modes';
  const plugin = s.pluginRef ? byRef.get(s.pluginRef) : undefined;
  const summary = (counts(items, modes) || 'nothing') + (s.used !== undefined && s.enabled ? ` · ${s.used} used` : '');
  const check = (ref: string, v: boolean) =>
    setSelected((cur) => {
      const n = new Set(cur);
      if (v) n.add(ref);
      else n.delete(ref);
      return n;
    });

  return (
    <section className={cn('overflow-hidden rounded-xl border border-white/7 bg-ink-1/60', !s.enabled && 'opacity-60')}>
      <header className="flex items-center gap-3 px-4 py-3">
        <button type="button" onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <ChevronRight className={cn('h-4 w-4 shrink-0 text-paper-4 transition-transform', open && 'rotate-90')} />
          <span className="truncate text-[14px] text-paper">{s.kind === 'plugin' ? `Plugin: ${s.label}` : s.label}</span>
          {s.by && <Badge>by {s.by}</Badge>}
        </button>
        <span className="shrink-0 font-mono text-[11.5px] text-paper-3">{s.enabled ? summary : 'off · loads nothing'}</span>
        <Tip content="Share of the instructions this tool puts in context">
          <span className="flex w-28 shrink-0 items-center gap-2">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/6">
              <span
                className="block h-full rounded-full bg-lume/70"
                style={{ width: `${s.enabled && max ? Math.max(2, (s.tokens / max) * 100) : 0}%` }}
              />
            </span>
            <span className="w-10 text-right font-mono text-[11px] text-paper-4">{s.enabled ? fmtTokens(s.tokens) : '0'}</span>
          </span>
        </Tip>
        {plugin &&
          (plugin.locked ? (
            <Tip content={plugin.locked}>
              <Lock className="h-3.5 w-3.5 text-paper-4" />
            </Tip>
          ) : (
            <Tip content={s.enabled ? 'Turn the plugin off: everything it brings stops loading' : 'Turn the plugin back on'}>
              <span>
                <Switch
                  checked={s.enabled}
                  onChange={(v) => propose({ action: v ? 'enable' : 'disable', refs: [plugin.ref] })}
                  label={`plugin ${s.label}`}
                />
              </span>
            </Tip>
          ))}
      </header>
      {open && (
        <div className="border-t border-white/5">
          <p className="flex items-center gap-1.5 px-4 pt-2.5 text-[11.5px] text-paper-4">
            <Info className="h-3 w-3" /> {SOURCE_HELP[s.kind]}
            {plugin && (
              <button
                type="button"
                onClick={() => ui.select(plugin.ref)}
                className="ml-1 text-paper-3 underline decoration-white/20 hover:text-paper"
              >
                plugin details
              </button>
            )}
          </p>
          {KINDS.map((k) => {
            const list = items.filter((i) => i.kind === k && !(modes && k === 'agent'));
            if (!list.length) return null;
            return (
              <div key={k} className="pb-1">
                <p className="px-4 pt-3 pb-1 text-[10.5px] tracking-[0.14em] text-paper-4 uppercase">
                  {k === 'agent' ? 'Subagents' : KIND_META[k].label} · {list.length}
                </p>
                <ul>
                  {list.map((i) => {
                    const can = selectable(i);
                    const lockedReason = !can
                      ? i.locked
                        ? i.locked
                        : i.level === 'plugin'
                          ? `Comes with the ${s.label} plugin: use the plugin switch above`
                          : i.managedBy
                            ? `Managed by ${i.managedBy}; open it to change with force`
                            : 'Set by policy'
                      : undefined;
                    return (
                      <ItemRow
                        key={i.ref}
                        i={i}
                        days={days}
                        checked={selected.has(i.ref)}
                        onCheck={can ? (v) => check(i.ref, v) : undefined}
                        onToggle={can ? (on) => propose({ action: on ? 'enable' : 'disable', refs: [i.ref] }) : undefined}
                        lockedReason={lockedReason}
                      />
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Everything idle in the usage window that you can switch off, pre-selected, one review. */
function TrimPanel({ t, byRef, days }: { t: ToolLoadDTO; byRef: Map<string, ItemDTO>; days: number }) {
  const { propose } = usePlans();
  const candidates = [...t.trim.plugins, ...t.trim.items].map((r) => byRef.get(r)).filter((i): i is ItemDTO => !!i);
  // Pre-select the heavy, low-regret items (whole plugins, servers); skills and agents you added
  // yourself are listed but left for you to tick.
  const [off, setOff] = useState<Set<string>>(
    () => new Set(candidates.filter((i) => i.kind === 'plugin' || i.kind === 'mcp').map((i) => i.ref)),
  );
  const [all, setAll] = useState(false);
  if (!candidates.length) {
    return (
      <p className="mt-5 rounded-xl border border-ok/20 bg-ok/5 px-4 py-3 text-[13px] text-ok">
        Everything that loads was used in the last {days} days. Nothing to trim.
      </p>
    );
  }
  const plugins = candidates.filter((i) => i.kind === 'plugin');
  const own = candidates.filter((i) => i.kind !== 'plugin');
  const shown = all ? candidates : candidates.slice(0, 8);
  const source = (i: ItemDTO) => t.sources.find((s) => s.pluginRef === i.ref);
  const picked = candidates.filter((i) => off.has(i.ref));
  return (
    <section className="mt-5 overflow-hidden rounded-xl border border-lume/30 bg-lume/[0.04]">
      <header className="flex items-center gap-3 px-4 pt-3 pb-2">
        <Scissors className="h-4 w-4 text-lume" />
        <div className="flex-1">
          <p className="text-[14px] text-paper">Not used in the last {days} days</p>
          <p className="text-[12px] text-paper-3">
            {plugins.length} plugin{plugins.length === 1 ? '' : 's'} and {own.length} of your own item{own.length === 1 ? '' : 's'}. Turning
            them off stops {t.trim.servers} server{t.trim.servers === 1 ? '' : 's'} and saves ≈{fmtTokens(t.trim.tokens)} tokens. Everything
            can be undone.
          </p>
        </div>
        <Button variant="primary" disabled={!picked.length} onClick={() => propose({ action: 'disable', refs: picked.map((i) => i.ref) })}>
          Review: turn off {picked.length}
        </Button>
      </header>
      <ul className="border-t border-white/5">
        {shown.map((i) => {
          const s = source(i);
          return (
            <li key={i.ref} className="flex items-center gap-3 px-4 py-1.5">
              <input
                type="checkbox"
                checked={off.has(i.ref)}
                aria-label={`trim ${i.name}`}
                onChange={(e) =>
                  setOff((cur) => {
                    const n = new Set(cur);
                    if (e.target.checked) n.add(i.ref);
                    else n.delete(i.ref);
                    return n;
                  })
                }
                className="h-3.5 w-3.5 accent-[var(--color-lume)]"
              />
              <span className="w-20 shrink-0 text-[11.5px] text-paper-4">
                {i.kind === 'plugin' ? 'plugin' : i.kind === 'mcp' ? 'your server' : `your ${i.kind}`}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-paper-2">
                {i.kind === 'plugin' ? i.name.split('@')[0] : i.name}
              </span>
              {s && (
                <span className="shrink-0 font-mono text-[11px] text-paper-4">
                  {s.refs.length} items · ≈{fmtTokens(s.tokens)}
                </span>
              )}
              {i.installedBy && <span className="shrink-0 font-mono text-[10.5px] text-paper-4">by {i.installedBy}</span>}
            </li>
          );
        })}
      </ul>
      {candidates.length > 8 && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="w-full border-t border-white/5 px-4 py-1.5 text-left text-[12px] text-paper-4 hover:text-paper-2"
        >
          {all ? 'Show fewer' : `Show all ${candidates.length}`}
        </button>
      )}
    </section>
  );
}

export function ToolView({ harness, state }: { harness: string; state: StateDTO }) {
  const ui = useUi();
  const { propose } = usePlans();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const t = state.tools.find((x) => x.harness === harness);
  const byRef = useMemo(() => new Map(state.items.map((i) => [i.ref, i])), [state]);
  if (!t) return <p className="p-8 text-paper-3">{harness} is not installed on this machine.</p>;
  const servers = t.loaded.mcp ?? 0;
  const maxTokens = Math.max(1, ...t.sources.map((s) => s.tokens));
  const days = state.usage?.days ?? 30;
  const sel = [...selected].map((r) => byRef.get(r)).filter((i): i is ItemDTO => !!i);

  return (
    <div className="relative flex h-full flex-col">
      <div className="scroll-thin flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1100px] px-8 pt-7 pb-28">
          <div className="animate-rise">
            <p className="font-display text-[34px] leading-tight">
              <span className="text-lume">{servers}</span> MCP server{servers === 1 ? '' : 's'} start when you open {toolName(t.label)}
              {state.project ? ' in this project' : ', in any project'}
            </p>
            <p className="mt-1 text-[14px] text-paper-2">
              The model is also offered {offeredLine(t)} · ≈ {fmtTokens(t.contextTokens)} tokens of instructions
              {t.toolTokens > 0 && <> (including ≈{fmtTokens(t.toolTokens)} measured from servers’ tool definitions)</>}
            </p>
            {t.unmeasuredServers > 0 && (
              <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-paper-3">
                {t.unmeasuredServers} of {servers} servers not measured yet; their tool definitions add more.
                <MeasureButton
                  label={`Measure ${t.unmeasuredServers}`}
                  refs={t.sources
                    .filter((s) => s.enabled)
                    .flatMap((s) => s.refs)
                    .map((r) => byRef.get(r))
                    .filter((i): i is ItemDTO => !!i && i.kind === 'mcp' && i.enabled && !i.tools)
                    .map((i) => i.ref)}
                />
              </p>
            )}
            <p className={cn('mt-1 text-[13.5px]', t.tracked ? 'text-paper-3' : 'text-paper-4')}>
              {t.tracked
                ? `In the last ${days} days you used ${[usedOf(t, 'mcp'), usedOf(t, 'skill'), t.agentsAre === 'subagents' ? usedOf(t, 'agent') : ''].filter(Boolean).join(', ')}.`
                : `${toolName(t.label)} does not record what you use, so there is no usage data for it.`}
            </p>
            {t.agentsAre === 'modes' && (
              <p className="mt-3 flex items-start gap-2 rounded-lg border border-white/7 bg-ink-2/50 px-3 py-2 text-[12.5px] text-paper-3">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {toolName(t.label)} runs one agent at a time. Below is what every session gets; each agent can add its own servers (see
                Agents at the bottom).
              </p>
            )}
          </div>

          <ProfilesBar t={t} state={state} />

          {t.tracked && <TrimPanel t={t} byRef={byRef} days={days} />}

          {t.duplicates.length > 0 && (
            <div className="mt-5 rounded-xl border border-lume/25 bg-lume/6 px-4 py-3 text-[13px]">
              <p className="flex items-center gap-2 text-lume">
                <Copy className="h-4 w-4" /> Some servers start more than once, because several plugins each bring their own copy:
              </p>
              <p className="mt-1.5 pl-6 font-mono text-[12px] text-paper-2">
                {t.duplicates.map((d) => `${d.name} ×${d.count}`).join('   ')}
              </p>
            </div>
          )}

          <div className="mt-6 space-y-3">
            <SectionLabel
              right={
                <span className="flex items-center gap-3">
                  <span className="font-mono text-[11px] text-paper-4">largest first · click to see and switch items</span>
                  <AddServerButton state={state} preselect={harness} />
                </span>
              }
            >
              Where it comes from · {t.sources.filter((s) => s.refs.length).length} sources
            </SectionLabel>
            {t.sources
              .filter((s) => s.refs.length)
              .map((s) => (
                <SourceCard
                  key={s.id}
                  s={s}
                  t={t}
                  max={maxTokens}
                  days={days}
                  byRef={byRef}
                  selected={selected}
                  setSelected={setSelected}
                />
              ))}
          </div>

          {t.agentsAre === 'modes' && t.agents.length > 0 && (
            <section className="mt-10">
              <SectionLabel>Agents · pick one per session · {t.agents.length}</SectionLabel>
              <div className="divide-y divide-white/5 overflow-hidden rounded-xl border border-white/7 bg-ink-1/60">
                {t.agents.map((a) => (
                  <button
                    type="button"
                    key={a.ref}
                    onClick={() => ui.select(a.ref)}
                    className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-white/[0.025]"
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-paper">{a.name}</span>
                    {a.by && <span className="font-mono text-[10.5px] text-paper-4">by {a.by}</span>}
                    <span className="w-40 text-right font-mono text-[11.5px] text-paper-3">
                      {a.servers.length ? `+${a.servers.length} own server${a.servers.length === 1 ? '' : 's'}` : 'no extra servers'}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      {sel.length > 0 && (
        <div className="absolute inset-x-0 bottom-0 animate-rise border-t border-white/8 bg-ink-1/95 px-8 py-3 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[1100px] items-center gap-3">
            <span className="text-[13px] text-paper">{sel.length} selected</span>
            <span className="truncate font-mono text-[11.5px] text-paper-4">{sel.map((i) => i.name).join(', ')}</span>
            <div className="flex-1" />
            <Button variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
            {sel.some((i) => !i.enabled) && (
              <Button onClick={() => propose({ action: 'enable', refs: sel.filter((i) => !i.enabled).map((i) => i.ref) })}>Turn on</Button>
            )}
            {sel.some((i) => i.enabled) && (
              <Button
                variant="primary"
                onClick={() => propose({ action: 'disable', refs: sel.filter((i) => i.enabled).map((i) => i.ref) })}
              >
                Turn off {sel.filter((i) => i.enabled).length}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
