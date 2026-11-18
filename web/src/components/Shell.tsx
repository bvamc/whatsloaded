import { Command } from 'cmdk';
import { Activity, Compass, History, Home, Package, RefreshCw, Search, Undo2 } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { visible } from '../lib/group';
import { cn, KIND_META, KIND_ORDER, scopeText } from '../lib/meta';
import { bucketed } from '../lib/problems';
import { usePlans, useStateQuery, useUi, type View } from '../store';
import { Aperture, HarnessDot } from './atoms';
import { ProjectPicker } from './ProjectPicker';
import { Kbd, Tip } from './ui';

const TITLES: Record<string, string> = {
  overview: 'Home',
  doctor: 'Problems',
  backups: 'History',
  packages: 'Packages',
  discover: 'Discover',
};

/** Page title; tool pages are titled by the tool's name. */
export function viewTitle(v: View, labels: Record<string, string> = {}): string {
  if (v.startsWith('tool:')) return labels[v.slice(5)] ?? v.slice(5);
  if (v.startsWith('server:')) return 'Server map';
  if (v.startsWith('package:')) return v.slice(v.indexOf(':', 8) + 1) || 'Package';
  return TITLES[v] ?? KIND_META[v as keyof typeof KIND_META].label;
}

/** Short tool names for navigation ("Kiro / Kiro CLI" → "Kiro"). */
export const toolName = (label: string) => label.split(' / ')[0]!;

function NavItem({
  active,
  onClick,
  icon: Icon,
  dot,
  label,
  count,
  hint,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  icon?: typeof Activity;
  dot?: string;
  label: string;
  count?: number;
  hint?: string;
  tone?: 'lume';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors',
        active ? 'bg-white/6 text-paper' : 'text-paper-3 hover:bg-white/3 hover:text-paper-2',
      )}
    >
      {active && <span className="absolute top-1.5 bottom-1.5 left-0 w-[2px] rounded-full bg-lume shadow-[0_0_10px_var(--color-lume)]" />}
      {Icon && <Icon className={cn('h-4 w-4', active ? 'text-lume' : 'text-paper-4 group-hover:text-paper-3')} strokeWidth={1.75} />}
      {dot && <HarnessDot id={dot} />}
      <span className="flex-1 truncate text-left">{label}</span>
      {hint && <span className="font-mono text-[10.5px] text-paper-4">{hint}</span>}
      {count !== undefined && (
        <span className={cn('tabular font-mono text-[11px]', tone === 'lume' && count > 0 ? 'text-lume' : 'text-paper-4')}>{count}</span>
      )}
    </button>
  );
}

export function Sidebar() {
  const ui = useUi();
  const { data } = useStateQuery();
  const items = data ? visible(data.items, { ...ui.filters, query: '' }) : [];
  const fixable = data ? bucketed(data).yours.length : 0;

  return (
    <aside className="relative z-10 flex h-full w-[248px] shrink-0 flex-col border-r border-white/6 bg-ink-1/60 backdrop-blur-xl">
      <div className="flex items-center gap-2.5 px-5 pt-5 pb-6">
        <Aperture size={30} />
        <div>
          <div className="font-display text-[23px] leading-none tracking-tight italic">whatsloaded</div>
          <div className="mt-1 font-mono text-[10px] tracking-wider text-paper-4">127.0.0.1 · local only</div>
        </div>
      </div>

      <nav className="scroll-thin flex-1 space-y-5 overflow-y-auto px-3">
        <div className="space-y-0.5">
          <NavItem active={ui.view === 'overview'} onClick={() => ui.go('overview')} icon={Home} label="Home" />
          <NavItem active={ui.view === 'discover'} onClick={() => ui.go('discover')} icon={Compass} label="Discover" />
          <NavItem
            active={ui.view === 'doctor'}
            onClick={() => ui.go('doctor')}
            icon={Activity}
            label="Problems to fix"
            count={fixable}
            tone="lume"
          />
        </div>
        <div className="space-y-0.5">
          <p className="px-2.5 pb-1.5 text-[10px] tracking-[0.18em] text-paper-4 uppercase">Your tools</p>
          {(data?.tools ?? []).map((t) => (
            <NavItem
              key={t.harness}
              active={ui.view === `tool:${t.harness}`}
              onClick={() => ui.go(`tool:${t.harness}`)}
              dot={t.harness}
              label={toolName(t.label)}
              hint={`${t.loaded.mcp ?? 0} servers`}
            />
          ))}
        </div>
        <div className="space-y-0.5">
          <p className="px-2.5 pb-1.5 text-[10px] tracking-[0.18em] text-paper-4 uppercase">Browse everything</p>
          {(data?.packages.length ?? 0) > 0 && (
            <NavItem
              active={ui.view === 'packages' || ui.view.startsWith('package:')}
              onClick={() => ui.go('packages')}
              icon={Package}
              label="Packages"
              count={data?.packages.length}
            />
          )}
          {KIND_ORDER.map((k) => (
            <NavItem
              key={k}
              active={ui.view === k || (k === 'mcp' && ui.view.startsWith('server:'))}
              onClick={() => ui.go(k)}
              icon={KIND_META[k].icon}
              label={KIND_META[k].label}
              count={new Set(items.filter((i) => i.kind === k).map((i) => i.name)).size}
            />
          ))}
          <NavItem
            active={ui.view === 'backups'}
            onClick={() => ui.go('backups')}
            icon={History}
            label="History"
            count={data?.backups.length}
          />
        </div>
      </nav>

      <div className="border-t border-white/6 px-4 pt-3 pb-4">
        <p className="pb-1.5 text-[10px] tracking-[0.18em] text-paper-4 uppercase">Showing</p>
        <ProjectPicker />
      </div>
    </aside>
  );
}

export function Topbar({ title, subtitle }: { title: string; subtitle?: string }) {
  const ui = useUi();
  const q = useStateQuery();
  return (
    <header className="relative z-10 flex h-[72px] shrink-0 items-center gap-4 border-b border-white/6 px-8">
      <div className="min-w-0 flex-1">
        <h1 key={ui.view} className="animate-rise font-display text-[28px] leading-none tracking-tight italic">
          {title}
        </h1>
        {subtitle && <p className="mt-1.5 truncate font-mono text-[11.5px] text-paper-4">{subtitle}</p>}
      </div>
      <button
        type="button"
        onClick={() => ui.setPaletteOpen(true)}
        className="flex h-8 w-64 items-center gap-2 rounded-md border border-white/8 bg-ink-2/70 px-2.5 text-[12.5px] text-paper-4 transition-colors hover:border-white/15 hover:text-paper-3"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="flex-1 text-left">Find a server, skill, agent…</span>
        <Kbd>⌘K</Kbd>
      </button>
      <Tip content="Re-read all config files">
        <button
          type="button"
          onClick={() => void q.refetch()}
          className="rounded-md p-2 text-paper-4 hover:bg-white/5 hover:text-paper-2"
          aria-label="Rescan"
        >
          <RefreshCw className={cn('h-4 w-4', q.isFetching && 'animate-spin')} />
        </button>
      </Tip>
    </header>
  );
}

export function CommandPalette() {
  const ui = useUi();
  const { undo } = usePlans();
  const { data } = useStateQuery();
  const items = useMemo(() => (data ? visible(data.items, { ...ui.filters, query: '' }) : []), [data, ui.filters]);
  const labels = Object.fromEntries((data?.tools ?? []).map((t) => [t.harness, toolName(t.label)]));

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ui.setPaletteOpen(!ui.paletteOpen);
      }
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [ui]);

  const run = (fn: () => void) => {
    ui.setPaletteOpen(false);
    fn();
  };

  return (
    <Command.Dialog
      open={ui.paletteOpen}
      onOpenChange={ui.setPaletteOpen}
      label="Command palette"
      overlayClassName="fixed inset-0 z-[70] bg-ink-0/70 backdrop-blur-sm animate-fade"
      contentClassName="fixed top-[14vh] left-1/2 z-[71] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 animate-pop overflow-hidden rounded-xl border border-white/10 bg-ink-1/95 shadow-[0_40px_120px_-20px_rgb(0_0_0/0.9)] backdrop-blur-xl"
    >
      <div className="flex items-center gap-2.5 border-b border-white/6 px-4">
        <Search className="h-4 w-4 text-paper-4" />
        <Command.Input
          placeholder="Jump to a server, skill, agent… or run a command"
          className="h-12 flex-1 bg-transparent text-[14px] text-paper placeholder:text-paper-4 focus:outline-none"
        />
        <Kbd>esc</Kbd>
      </div>
      <Command.List className="scroll-thin max-h-[52vh] overflow-y-auto p-1.5">
        <Command.Empty className="py-10 text-center text-paper-4">Nothing in focus.</Command.Empty>
        <Command.Group heading="Go to">
          {(['overview', 'doctor', ...(data?.tools ?? []).map((t) => `tool:${t.harness}` as View), ...KIND_ORDER, 'backups'] as View[]).map(
            (v) => (
              <Command.Item
                key={v}
                value={`go ${viewTitle(v, labels)}`}
                onSelect={() => run(() => ui.go(v))}
                className="flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-3 text-[13px] text-paper-2"
              >
                <span className="text-paper-4">→</span> {viewTitle(v, labels)}
              </Command.Item>
            ),
          )}
        </Command.Group>
        <Command.Group heading="Actions">
          <Command.Item
            value="undo last change"
            onSelect={() => run(() => void undo())}
            className="flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-3 text-[13px] text-paper-2"
          >
            <Undo2 className="h-3.5 w-3.5 text-paper-4" /> Undo last change
          </Command.Item>
          <Command.Item
            value="toggle plugin items"
            onSelect={() => run(() => ui.setIncludePlugins(!ui.filters.includePlugins))}
            className="flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-3 text-[13px] text-paper-2"
          >
            <span className="text-paper-4">◐</span> {ui.filters.includePlugins ? 'Hide' : 'Show'} plugin-provided skills, agents &amp;
            commands
          </Command.Item>
        </Command.Group>
        <Command.Group heading="Packages">
          {(data?.packages ?? []).map((p) => (
            <Command.Item
              key={p.id}
              value={`package ${p.name}`}
              onSelect={() => run(() => ui.go(`package:${p.id}`))}
              className="flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-3"
            >
              <Package className="h-3.5 w-3.5 shrink-0 text-paper-4" strokeWidth={1.75} />
              <span className="truncate font-mono text-[12.5px] text-paper">{p.name}</span>
              <span className="ml-auto font-mono text-[11px] text-paper-4">by {p.by}</span>
            </Command.Item>
          ))}
        </Command.Group>
        <Command.Group heading="Items">
          {items.map((i) => {
            const Icon = KIND_META[i.kind].icon;
            return (
              <Command.Item
                key={i.ref}
                value={i.ref}
                onSelect={() => run(() => ui.select(i.ref))}
                className="flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-3"
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-paper-4" strokeWidth={1.75} />
                <span className="truncate font-mono text-[12.5px] text-paper">{i.name}</span>
                <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-paper-4">
                  <HarnessDot id={i.harness} dim={!i.enabled} size={6} /> {i.harness} · {scopeText(i)}
                </span>
              </Command.Item>
            );
          })}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
