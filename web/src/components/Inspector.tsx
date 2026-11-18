import {
  ArrowRightLeft,
  Copy,
  FolderInput,
  GitMerge,
  Link2,
  Lock,
  Package as PackageIcon,
  PowerOff,
  Trash2,
  Waypoints,
} from 'lucide-react';
import { Popover } from 'radix-ui';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { ItemDTO, StateDTO } from '../api';
import { cn, harnessMeta, KIND_META, scopeText } from '../lib/meta';
import { isYours } from '../lib/problems';
import { usePlans, useStateQuery, useUi } from '../store';
import { HarnessDot, HarnessTag, SpecBlock, SpecDiff, StateDot } from './atoms';
import { ServerControl } from './ServerControl';
import { ServerLayers } from './ServerLayers';
import { SkillLayers } from './SkillLayers';
import { Badge, Button, Checkbox, SectionLabel, Sheet, Switch } from './ui';

const VARIANT = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function Inspector() {
  const { selected, select } = useUi();
  const { data } = useStateQuery();
  const item = data?.items.find((i) => i.ref === selected);
  return (
    <Sheet open={!!item} onClose={() => select(undefined)} title={item?.name ?? 'item'}>
      {item && data && <Body key={item.ref} item={item} state={data} />}
    </Sheet>
  );
}

function Body({ item, state }: { item: ItemDTO; state: StateDTO }) {
  const { propose } = usePlans();
  const { select, go } = useUi();
  const [force, setForce] = useState(false);
  const siblings = useMemo(() => state.items.filter((i) => i.kind === item.kind && i.name === item.name), [state, item]);
  const canonical = siblings.find((s) => s.variant === 0);
  const meta = KIND_META[item.kind];
  const ownedElsewhere = item.level === 'plugin' || item.level === 'managed';
  const copyable = item.kind === 'mcp' || item.kind === 'skill';
  const canAdopt = item.kind === 'skill' && !item.link && item.harness !== 'agents' && item.level !== 'plugin' && !item.parked;
  // Your own enabled copies of this name across tools: one switch for "off everywhere".
  const everywhere = siblings.filter((i) => i.enabled && isYours(i));
  const canSync = item.kind === 'mcp' && (item.variants ?? 1) > 1 && !item.parked;
  const act = (action: 'enable' | 'disable' | 'remove' | 'sync' | 'adopt') => propose({ action, refs: [item.ref], force });

  return (
    <div className="flex h-full flex-col">
      <header className="relative overflow-hidden border-b border-white/6 px-6 pt-6 pb-5">
        <div
          className="pointer-events-none absolute -top-24 -right-24 h-56 w-56 rounded-full opacity-30 blur-3xl"
          style={{ background: harnessMeta(item.harness).color }}
        />
        <div className="flex items-center gap-2 text-[10.5px] tracking-[0.16em] text-paper-4 uppercase">
          <meta.icon className="h-3.5 w-3.5" /> {meta.one}
        </div>
        <h2 className="mt-2 pr-8 font-mono text-[22px] leading-tight break-all text-paper">{item.name}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <HarnessTag id={item.harness} />
          <span className="font-mono text-[11.5px] text-paper-3">{scopeText(item)}</span>
          <span className="flex items-center gap-2 font-mono text-[11.5px] text-paper-3">
            <StateDot item={item} />
            {item.parked ? 'parked' : item.enabled ? 'on' : 'off'}
          </span>
          <div className="ml-auto">
            <Switch
              checked={item.enabled}
              disabled={ownedElsewhere && item.kind !== 'plugin'}
              onChange={(v) => act(v ? 'enable' : 'disable')}
              label="enabled"
            />
          </div>
        </div>
        {item.package && <PackageLink id={item.package} />}
        {item.managedBy && (
          <div className="mt-4 flex items-center gap-3 rounded-lg border border-lume/25 bg-lume/6 px-3 py-2.5">
            <Lock className="h-4 w-4 shrink-0 text-lume" />
            <p className="flex-1 text-[12.5px] leading-snug text-paper-2">
              Managed by <span className="font-mono text-lume">{item.managedBy}</span>. Edits need force and its owner may overwrite them.
            </p>
            {!ownedElsewhere && (
              <Checkbox checked={force} onChange={setForce}>
                force
              </Checkbox>
            )}
          </div>
        )}
      </header>

      <div className="scroll-thin flex-1 space-y-7 overflow-y-auto px-6 py-6">
        {item.description && <p className="font-display text-[17px] leading-relaxed text-paper-2 italic">{item.description}</p>}

        {item.mcp && (
          <section>
            <SectionLabel
              right={
                item.variants && item.variants > 1 ? (
                  <Badge tone="lume">
                    variant {VARIANT[item.variant ?? 0]} of {item.variants}
                  </Badge>
                ) : undefined
              }
            >
              Definition
            </SectionLabel>
            <div className="rounded-lg border border-white/6 bg-ink-2/50 p-4">
              <SpecBlock spec={item.mcp} />
            </div>
            <p className="mt-2 text-[11.5px] text-paper-4">Secret values never leave the whatsloaded process.</p>
          </section>
        )}

        {item.mcp && canonical?.mcp && item.variant !== 0 && (
          <section>
            <SectionLabel>
              {item.role === 'owned' ? 'Versus your most common configuration (A)' : 'Versus your configuration (A)'}
            </SectionLabel>
            <SpecDiff from={canonical.mcp} to={item.mcp} />
          </section>
        )}

        {item.link && item.kind !== 'skill' && (
          <section>
            <SectionLabel>Symlink</SectionLabel>
            <div className={cn('flex items-center gap-2 font-mono text-[12px]', item.link.broken ? 'text-bad' : 'text-paper-2')}>
              <Link2 className="h-3.5 w-3.5" /> {item.link.target} {item.link.broken && '(missing)'}
            </div>
          </section>
        )}

        <section>
          <SectionLabel
            right={
              <button
                type="button"
                className="flex items-center gap-1 text-[11px] text-paper-4 hover:text-paper-2"
                onClick={() => void navigator.clipboard.writeText(item.location.file).then(() => toast('Path copied'))}
              >
                <Copy className="h-3 w-3" /> copy path
              </button>
            }
          >
            {item.kind === 'mcp' ? 'Configured in' : item.kind === 'skill' ? 'Folder' : 'File'}
          </SectionLabel>
          <p className="font-mono text-[12px] break-all text-paper-2">{item.location.file}</p>
          {item.location.path && <p className="mt-1 font-mono text-[11.5px] text-paper-4">→ {item.location.path.join(' › ')}</p>}
          {item.kind === 'mcp' && (
            <p className="mt-1 text-[11.5px] text-paper-4">
              {item.role === 'agent-profile'
                ? `An entry inside the ${item.owner} agent's definition: it starts this server while that agent runs.`
                : 'The entry that tells the tool how to start this server. Where the program itself lives is under Installed.'}
            </p>
          )}
          {item.origin && <p className="mt-1 font-mono text-[11.5px] text-paper-4">origin {item.origin}</p>}
        </section>

        {item.kind === 'mcp' ? (
          <ServerLayers item={item} state={state} />
        ) : item.kind === 'skill' ? (
          <SkillLayers item={item} state={state} />
        ) : (
          siblings.length > 1 && (
            <section>
              <SectionLabel>
                {siblings.length} configurations of {item.name}
              </SectionLabel>
              <ul className="divide-y divide-white/5 overflow-hidden rounded-lg border border-white/6">
                {siblings.map((s) => (
                  <li key={s.ref}>
                    <button
                      type="button"
                      onClick={() => select(s.ref)}
                      className={cn(
                        'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-white/4',
                        s.ref === item.ref && 'bg-lume/6',
                      )}
                    >
                      <HarnessDot id={s.harness} dim={!s.enabled} />
                      <span className="w-16 shrink-0 font-mono text-[12px] text-paper-2">{s.harness}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-paper-3">{scopeText(s)}</span>
                      {s.managedBy && <Lock className="h-3 w-3 text-paper-4" />}
                      <StateDot item={s} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-white/6 bg-ink-0/40 px-6 py-3">
        {copyable && <TargetPicker item={item} state={state} mode="copy" />}
        {copyable && !ownedElsewhere && <TargetPicker item={item} state={state} mode="move" />}
        {canSync && (
          <Button size="sm" onClick={() => act('sync')}>
            <GitMerge className="h-3.5 w-3.5" /> Make all copies match
          </Button>
        )}
        {item.kind === 'mcp' && (
          <Button
            size="sm"
            onClick={() => {
              select(undefined);
              go(`server:${item.name}`);
            }}
          >
            <Waypoints className="h-3.5 w-3.5" /> Open map
          </Button>
        )}
        {item.kind === 'mcp' ? (
          <span className="flex items-center gap-2 text-[12.5px] text-paper-3">
            Everywhere: <ServerControl name={item.name} state={state} size="panel" />
          </span>
        ) : (
          everywhere.length > 1 && (
            <Button size="sm" onClick={() => propose({ action: 'disable', refs: everywhere.map((e) => e.ref), force })}>
              <PowerOff className="h-3.5 w-3.5" /> Turn off in all {everywhere.length} of your tools
            </Button>
          )
        )}
        {canAdopt && (
          <Button size="sm" onClick={() => act('adopt')}>
            <FolderInput className="h-3.5 w-3.5" /> Share via ~/.agents
          </Button>
        )}
        <div className="flex-1" />
        {!ownedElsewhere && item.kind !== 'plugin' && (
          <Button size="sm" variant="danger" onClick={() => act('remove')}>
            <Trash2 className="h-3.5 w-3.5" /> Remove from {harnessMeta(item.harness).label.split(' / ')[0]}
          </Button>
        )}
      </footer>
    </div>
  );
}

function TargetPicker({ item, state, mode }: { item: ItemDTO; state: StateDTO; mode: 'copy' | 'move' }) {
  const { propose } = usePlans();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [overwrite, setOverwrite] = useState(false);
  const targets = state.adapters
    .filter((a) => a.detected)
    .flatMap((a) => (a.writable[item.kind] ?? []).map((level) => ({ harness: a.id, level, key: `${a.id}:${level}` })))
    .filter((t) => !(t.harness === item.harness && t.level === item.level));
  const exists = (t: { harness: string; level: string }) =>
    state.items.some((i) => i.kind === item.kind && i.name === item.name && i.harness === t.harness && i.level === t.level);
  const toggle = (k: string) => setPicked((p) => (mode === 'move' ? [k] : p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button size="sm" disabled={!targets.length}>
          {mode === 'copy' ? <Copy className="h-3.5 w-3.5" /> : <ArrowRightLeft className="h-3.5 w-3.5" />}
          {mode === 'copy' ? (item.kind === 'skill' ? 'Link to…' : 'Copy to…') : 'Move to…'}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          className="z-[60] w-72 animate-pop rounded-xl border border-white/10 bg-ink-2/95 p-2 shadow-2xl backdrop-blur-xl"
        >
          <p className="px-2 pt-1 pb-2 text-[10.5px] tracking-[0.16em] text-paper-4 uppercase">
            {mode === 'copy' ? 'Targets' : 'Destination'}
          </p>
          <ul className="max-h-64 overflow-y-auto">
            {targets.map((t) => {
              const on = picked.includes(t.key);
              return (
                <li key={t.key}>
                  <button
                    type="button"
                    onClick={() => toggle(t.key)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-white/5',
                      on && 'bg-lume/10',
                    )}
                  >
                    <span className={cn('h-3.5 w-3.5 rounded-[4px] border', on ? 'border-lume bg-lume' : 'border-white/20')} />
                    <HarnessDot id={t.harness} />
                    <span className="font-mono text-paper-2">{t.harness}</span>
                    <span className="font-mono text-paper-4">{t.level}</span>
                    {exists(t) && <Badge className="ml-auto">exists</Badge>}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 flex items-center justify-between border-t border-white/6 px-2 pt-2.5 pb-1">
            {mode === 'copy' ? (
              <Checkbox checked={overwrite} onChange={setOverwrite}>
                overwrite
              </Checkbox>
            ) : (
              <span />
            )}
            <Button
              size="sm"
              variant="primary"
              disabled={!picked.length}
              onClick={() => {
                setOpen(false);
                propose({ action: mode, refs: [item.ref], targets: picked, overwrite });
                setPicked([]);
              }}
            >
              Review
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** "Part of <package>": jump to everything installed with it. */
function PackageLink({ id }: { id: string }) {
  const { go, select } = useUi();
  const { data } = useStateQuery();
  const pkg = data?.packages.find((p) => p.id === id);
  if (!pkg) return null;
  return (
    <button
      type="button"
      onClick={() => {
        select(undefined);
        go(`package:${id}`);
      }}
      className="mt-3 flex items-center gap-2 text-left text-[12.5px] text-paper-3 hover:text-paper"
    >
      <PackageIcon className="h-3.5 w-3.5 text-paper-4" /> Part of the package <span className="font-mono text-paper-2">{pkg.name}</span>
      <span className="text-paper-4">(by {pkg.by}) · see everything it installed →</span>
    </button>
  );
}
