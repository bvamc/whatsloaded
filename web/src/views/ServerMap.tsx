import { AlertTriangle, ArrowLeft, Copy, Lock, Wrench } from 'lucide-react';
import { type ReactNode, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { ItemDTO, StateDTO } from '../api';
import { HarnessDot, StateDot } from '../components/atoms';
import { MeasureButton } from '../components/Measure';
import { ServerControl } from '../components/ServerControl';
import { Switch } from '../components/ui';
import { cn, harnessMeta, KIND_META, scopeText } from '../lib/meta';
import { type Edge, type HarnessUse, pathThrough, serverMap, type User } from '../lib/serverMap';
import { usePlans, useUi } from '../store';

const SERVER = 'server';
const AGENTS = 'users:agent';
const SKILLS = 'users:skill';
const toolLabel = (h: string) => harnessMeta(h).label.split(' / ')[0]!;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function entryLabel(e: ItemDTO): string {
  if (e.level === 'agent') return `in agent ${e.owner}`;
  if (e.level === 'plugin') return `from plugin ${e.owner?.split('@')[0]}`;
  if (e.role === 'owned') return `your ${e.level} settings`;
  return scopeText(e);
}

const kindTitle = (k: string, n: number) => {
  if (k === 'mcp') return plural(n, 'other MCP server');
  const m = KIND_META[k as keyof typeof KIND_META];
  return `${n} ${n === 1 ? m.one : m.label.toLowerCase()}`;
};

/**
 * One MCP server at a glance: a small overview (installed by → server → tools that turn it on →
 * what relies on it) where each box opens its details below. Nothing is listed until asked for.
 */
export function ServerMap({ name, state }: { name: string; state: StateDTO }) {
  const { go } = useUi();
  const map = useMemo(() => serverMap(name, state), [name, state]);
  const { whole, programs, harnesses, users, bundles } = map;
  const agents = useMemo(() => users.filter((u) => u.kind === 'agent'), [users]);
  const readers = useMemo(() => users.filter((u) => u.kind !== 'agent'), [users]);
  const [picked, setPicked] = useState<string>(SERVER);
  const [hover, setHover] = useState<{ id: string; harnesses: string[] }>();

  const boxes = useRef(new Map<string, HTMLElement>());
  const canvas = useRef<HTMLDivElement>(null);
  const reg = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) boxes.current.set(id, el);
      else boxes.current.delete(id);
    },
    [],
  );

  const edges = useMemo<Edge[]>(() => {
    const out: Edge[] = [];
    for (const p of programs) out.push({ from: `prog:${p.key}`, to: SERVER });
    for (const b of bundles) out.push({ from: `pkg:${b.key}`, to: SERVER });
    for (const h of harnesses) {
      out.push({ from: SERVER, to: `tool:${h.harness}`, harness: h.harness });
      if (agents.some((u) => u.harnesses.includes(h.harness))) out.push({ from: `tool:${h.harness}`, to: AGENTS, harness: h.harness });
      if (readers.some((u) => u.harnesses.includes(h.harness))) out.push({ from: `tool:${h.harness}`, to: SKILLS, harness: h.harness });
    }
    return out;
  }, [programs, bundles, harnesses, agents, readers]);

  const lit = useMemo(() => (hover ? pathThrough(hover.id, edges, hover.harnesses) : undefined), [hover, edges]);

  const [paths, setPaths] = useState<{ d: string; edge: Edge }[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const root = canvas.current;
    if (!root) return;
    const draw = () => {
      const c = root.getBoundingClientRect();
      // Only re-render when something moved, or this effect would loop.
      setSize((s) => (s.w === c.width && s.h === c.height ? s : { w: c.width, h: c.height }));
      const next: { d: string; edge: Edge }[] = [];
      for (const e of edges) {
        const a = boxes.current.get(e.from)?.getBoundingClientRect();
        const b = boxes.current.get(e.to)?.getBoundingClientRect();
        if (!a || !b) continue;
        const x1 = a.right - c.left;
        const y1 = a.top + a.height / 2 - c.top;
        const x2 = b.left - c.left;
        const y2 = b.top + b.height / 2 - c.top;
        const dx = Math.max(24, (x2 - x1) / 2);
        next.push({ edge: e, d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}` });
      }
      setPaths((cur) => (cur.length === next.length && cur.every((p, i) => p.d === next[i]!.d) ? cur : next));
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(root);
    for (const el of boxes.current.values()) ro.observe(el);
    return () => ro.disconnect();
  }, [edges]);

  const box = (id: string, harnessesOf: string[] = []) => ({
    ref: reg(id),
    onHover: (on: boolean) => setHover(on ? { id, harnesses: harnessesOf } : undefined),
    onClick: () => setPicked(id),
    picked: picked === id,
    dim: !!lit && !lit.has(id),
  });

  if (!whole.entries.length)
    return (
      <div className="flex h-full items-center justify-center text-paper-3">
        <p>
          No MCP server named <span className="font-mono">{name}</span>.
        </p>
      </div>
    );

  const onIn = harnesses.filter((h) => h.on);
  const blind = agents.filter((u) => u.warn).length;
  const program = programs[0];
  const answer = [
    program?.by ? `Installed by ${program.by}.` : bundles[0] ? `Comes in the plugin ${bundles[0].name}.` : 'Installer unknown.',
    onIn.length ? `On in ${onIn.map((h) => toolLabel(h.harness)).join(', ')}.` : 'Off everywhere.',
    users.length
      ? `${[agents.length && plural(agents.length, 'agent'), readers.length && plural(readers.length, 'skill')].filter(Boolean).join(' and ')} rely on it.`
      : 'Nothing names it.',
  ].join(' ');

  return (
    <div className="scroll-thin h-full overflow-auto">
      <header className="flex flex-wrap items-start justify-between gap-6 px-8 pt-6 pb-2">
        <div className="min-w-0 max-w-[780px]">
          <button
            type="button"
            onClick={() => go('mcp')}
            className="mb-2 flex items-center gap-1.5 text-[12px] text-paper-4 hover:text-paper-2"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> MCP servers
          </button>
          <h1 className="font-mono text-[26px] text-paper">{name}</h1>
          <p className="mt-1 text-[14px] text-paper-2">{answer}</p>
          {map.description && <p className="mt-1 line-clamp-1 text-[12.5px] text-paper-4">{map.description}</p>}
        </div>
        <div className="flex items-center gap-2 pt-7 text-[12.5px] text-paper-3">
          Everywhere: <ServerControl name={name} state={state} size="panel" />
        </div>
      </header>

      <div className="px-8 pb-10">
        <div className="mt-4 mb-2 grid grid-cols-4 gap-x-14 text-[10.5px] tracking-[0.14em] text-paper-4 uppercase">
          <span>Installed by</span>
          <span>The server</span>
          <span>Turned on in</span>
          <span>Relies on it</span>
        </div>
        <div ref={canvas} className="relative grid grid-cols-4 items-center gap-x-14">
          <svg className="pointer-events-none absolute inset-0" width={size.w} height={size.h} aria-hidden="true">
            {paths.map(({ d, edge }) => {
              const on = lit ? lit.has(edge.from) && lit.has(edge.to) : undefined;
              return (
                <path
                  key={`${edge.from}>${edge.to}`}
                  d={d}
                  fill="none"
                  stroke={on ? 'var(--color-lume)' : edge.harness ? harnessMeta(edge.harness).color : '#9a9890'}
                  strokeWidth={on ? 1.8 : 1.3}
                  strokeOpacity={on === undefined ? 0.45 : on ? 0.95 : 0.1}
                  className="transition-[stroke-opacity] duration-200"
                />
              );
            })}
          </svg>

          <Column>
            {programs.map((p) => (
              <Box key={p.key} {...box(`prog:${p.key}`)}>
                <p className="text-[14px] text-paper">{p.by ?? (p.onDemand ? 'downloaded on start' : 'unknown')}</p>
                <p className={cn('mt-0.5 truncate font-mono text-[11px]', p.ok ? 'text-paper-4' : 'text-bad')}>
                  {p.ok ? p.label : 'not installed'}
                </p>
              </Box>
            ))}
            {bundles.map((b) => (
              <Box key={b.key} {...box(`pkg:${b.key}`)}>
                <p className="text-[11px] text-paper-4">comes in plugin</p>
                <p className="truncate font-mono text-[12.5px] text-paper">{b.name}</p>
              </Box>
            ))}
          </Column>

          <Column>
            <Box {...box(SERVER)} className="border-lume/30 bg-ink-2/80 py-3.5 shadow-[0_0_36px_-14px_var(--color-lume)]">
              <p className="truncate font-mono text-[15px] text-paper">{name}</p>
              <p className="mt-0.5 text-[12px] text-paper-3">
                {map.tools.names.length ? plural(map.tools.names.length, 'tool') : 'tools not measured'} ·{' '}
                {whole.on ? <span className="text-ok">on</span> : 'off'}
              </p>
            </Box>
          </Column>

          <Column>
            {harnesses.map((h) => (
              <Box key={h.harness} {...box(`tool:${h.harness}`, [h.harness])}>
                <p className="flex items-center gap-2 text-[13px] text-paper">
                  <HarnessDot id={h.harness} dim={!h.on} /> {toolLabel(h.harness)}
                  <span className={cn('ml-auto text-[11.5px]', h.on ? 'text-ok' : 'text-paper-4')}>
                    {h.on === h.entries.length ? 'on' : h.on ? `${h.on} of ${h.entries.length} on` : 'off'}
                  </span>
                </p>
              </Box>
            ))}
          </Column>

          <Column>
            {agents.length > 0 && (
              <Box {...box(AGENTS)}>
                <p className="text-[13px] text-paper">{plural(agents.length, 'agent')}</p>
                {blind > 0 ? (
                  <p className="mt-0.5 flex items-center gap-1 text-[11.5px] text-lume">
                    <AlertTriangle className="h-3 w-3" /> {blind} can’t see it
                  </p>
                ) : (
                  <p className="mt-0.5 text-[11.5px] text-paper-4">call its tools</p>
                )}
              </Box>
            )}
            {readers.length > 0 && (
              <Box {...box(SKILLS)}>
                <p className="text-[13px] text-paper">{plural(readers.length, 'skill')}</p>
                <p className="mt-0.5 text-[11.5px] text-paper-4">name it in their instructions</p>
              </Box>
            )}
            {!users.length && <p className="text-[12px] text-paper-4">Nothing names it.</p>}
          </Column>
        </div>

        <section className="mt-8 rounded-xl border border-white/8 bg-ink-1/60">
          <Details
            picked={picked}
            map={map}
            agents={agents}
            readers={readers}
            harness={harnesses.find((h) => picked === `tool:${h.harness}`)}
          />
        </section>
      </div>
    </div>
  );
}

function Column({ children }: { children: ReactNode }) {
  return <div className="relative z-[1] flex min-w-0 flex-col gap-2.5">{children}</div>;
}

function Box({
  ref,
  onHover,
  onClick,
  picked,
  dim,
  className,
  children,
}: {
  ref: (el: HTMLElement | null) => void;
  onHover: (on: boolean) => void;
  onClick: () => void;
  picked: boolean;
  dim: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      aria-pressed={picked}
      className={cn(
        'w-full rounded-xl border bg-ink-1/90 px-3.5 py-2.5 text-left backdrop-blur transition-[opacity,border-color] duration-200 hover:border-white/20',
        picked ? 'border-lume/60 ring-1 ring-lume/30' : 'border-white/8',
        dim && 'opacity-35',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** What the picked box holds, in plain lists. */
function Details({
  picked,
  map,
  agents,
  readers,
  harness,
}: {
  picked: string;
  map: ReturnType<typeof serverMap>;
  agents: User[];
  readers: User[];
  harness?: HarnessUse;
}) {
  const { select, go } = useUi();
  const { propose } = usePlans();

  if (picked === SERVER)
    return (
      <Panel
        title={map.tools.names.length ? `${plural(map.tools.names.length, 'tool')} it gives your agents` : 'Tools'}
        right={<MeasureButton label={map.tools.measured ? 'Measure again' : 'Measure'} refs={map.tools.refs.slice(0, 1)} />}
        note={
          map.tools.measured
            ? `≈${map.tools.tokens?.toLocaleString()} tokens of tool definitions in every session where it is on.`
            : map.tools.names.length
              ? 'Seen in agents’ tool lists. Measure starts it once to read the full list and what it costs.'
              : 'Not measured yet. Measure starts it once to read its tool list.'
        }
      >
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-x-6 gap-y-0.5">
          {map.tools.names.map((t) => (
            <li key={t} className="flex items-center gap-2 py-0.5 font-mono text-[12px] text-paper-2">
              <Wrench className="h-3 w-3 shrink-0 text-paper-4" />
              <span className="min-w-0 flex-1 truncate" title={t}>
                {t}
              </span>
              {map.tools.use[t] ? <span className="shrink-0 text-[11px] text-paper-4">{plural(map.tools.use[t]!, 'agent')}</span> : null}
            </li>
          ))}
        </ul>
      </Panel>
    );

  if (harness)
    return (
      <Panel
        title={`In ${toolLabel(harness.harness)}: ${plural(harness.entries.length, 'configuration')}`}
        note="Each place that turns it on. Plugin and installer entries follow their owner; switch the plugin to change them."
      >
        <ul className="divide-y divide-white/5">
          {harness.entries.map((e) => {
            const switchable = e.role === 'owned' && !e.managedBy && !e.locked;
            return (
              <li key={e.ref} className="flex items-center gap-3 py-1.5">
                <StateDot item={e} />
                <button
                  type="button"
                  onClick={() => select(e.ref)}
                  className="min-w-0 flex-1 truncate text-left text-[12.5px] text-paper-2 hover:text-paper"
                >
                  {entryLabel(e)}
                  <span className="ml-2 font-mono text-[11px] text-paper-4">{e.location.file}</span>
                </button>
                {e.installedBy && <span className="shrink-0 text-[11px] text-paper-4">by {e.installedBy}</span>}
                {switchable ? (
                  <Switch
                    checked={e.enabled}
                    onChange={(v) => propose({ action: v ? 'enable' : 'disable', refs: [e.ref] })}
                    label={`toggle ${e.ref}`}
                  />
                ) : (
                  <Lock className="h-3.5 w-3.5 shrink-0 text-paper-4" />
                )}
              </li>
            );
          })}
        </ul>
      </Panel>
    );

  if (picked === AGENTS || picked === SKILLS) {
    const list = picked === AGENTS ? agents : readers;
    return (
      <Panel
        title={picked === AGENTS ? `${plural(list.length, 'agent')} call its tools` : `${plural(list.length, 'skill')} name it`}
        note={
          picked === AGENTS
            ? 'They lose these tools if you turn it off or remove it.'
            : 'Their instructions mention it, so they likely stop working without it.'
        }
      >
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-x-6">
          {list.map((u) => (
            <li key={u.key} className="py-1">
              <button type="button" onClick={() => select(u.refs[0]!)} className="flex w-full items-center gap-2 text-left">
                <span className="flex gap-0.5">
                  {u.harnesses.map((h) => (
                    <HarnessDot key={h} id={h} size={6} />
                  ))}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-paper-2 hover:text-paper" title={u.name}>
                  {u.name}
                </span>
                <span className="shrink-0 text-[11px] text-paper-4">
                  {u.tools.includes('*') ? 'all tools' : u.tools.length ? plural(u.tools.length, 'tool') : ''}
                </span>
              </button>
              {u.warn && (
                <p className="flex items-center gap-1 pl-4 text-[11px] text-lume">
                  <AlertTriangle className="h-3 w-3 shrink-0" /> {u.warn}
                </p>
              )}
            </li>
          ))}
        </ul>
      </Panel>
    );
  }

  const program = map.programs.find((p) => picked === `prog:${p.key}`);
  if (program)
    return (
      <Panel title={`The program: installed by ${program.by ?? 'unknown'}`}>
        <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
          <dt className="text-paper-4">Runs</dt>
          <dd className={cn('font-mono text-[12px] [overflow-wrap:anywhere]', program.ok ? 'text-paper-2' : 'text-bad')}>
            {program.label}
            {program.detail && <span className="block text-[11px] text-paper-4">{program.detail}</span>}
          </dd>
          {program.about && (
            <>
              <dt className="text-paper-4">What it is</dt>
              <dd className="text-paper-2">{program.about}</dd>
            </>
          )}
          <dt className="text-paper-4">Started by</dt>
          <dd className="text-paper-2">{plural(program.entries, 'configuration')}</dd>
          <dt className="text-paper-4">To remove it</dt>
          <dd>
            {program.uninstall ? (
              <CopyCmd cmd={program.uninstall} />
            ) : (
              <span className="text-paper-3">
                {program.onDemand ? 'nothing to remove: it is fetched on each start' : 'no uninstall command known'}
              </span>
            )}
          </dd>
        </dl>
        <p className="mt-3 text-[11.5px] text-paper-4">
          Uninstall… above removes the configurations (backed up). The command removes the program itself.
        </p>
      </Panel>
    );

  const bundle = map.bundles.find((b) => picked === `pkg:${b.key}`);
  if (bundle)
    return (
      <Panel title={`The plugin ${bundle.name} ships it`} note="Turning the plugin off removes all of these from that tool.">
        <div className="grid gap-4 md:grid-cols-2">
          {bundle.contents.map((c) => (
            <div key={c.kind}>
              <p className="mb-1 text-[12px] text-paper-3">{kindTitle(c.kind, c.items.length)}</p>
              <div className="flex flex-wrap gap-1">
                {c.items.map((i) => (
                  <button
                    key={i.key}
                    type="button"
                    onClick={() => (i.kind === 'mcp' ? go(`server:${i.name}`) : select(i.refs[0]!))}
                    className="rounded bg-ink-3 px-1.5 py-0.5 font-mono text-[11px] text-paper-3 hover:text-paper"
                  >
                    {i.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    );

  return null;
}

function Panel({ title, note, right, children }: { title: string; note?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="animate-fade p-5">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[14px] text-paper">{title}</h2>
          {note && <p className="mt-0.5 text-[12px] text-paper-4">{note}</p>}
        </div>
        {right}
      </div>
      <div className="scroll-thin max-h-[420px] overflow-y-auto pr-1">{children}</div>
    </div>
  );
}

function CopyCmd({ cmd }: { cmd: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <code className="rounded bg-ink-3 px-1.5 py-0.5 font-mono text-[12px] text-paper">{cmd}</code>
      <button
        type="button"
        aria-label="copy uninstall command"
        onClick={() => void navigator.clipboard.writeText(cmd).then(() => toast('Command copied'))}
        className="flex items-center gap-1 text-[11px] text-paper-4 hover:text-paper-2"
      >
        <Copy className="h-3 w-3" /> copy
      </button>
    </span>
  );
}
