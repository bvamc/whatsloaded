import { Copy, Lock, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { ItemDTO, StateDTO } from '../api';
import { cn, harnessMeta, KIND_META, scopeText } from '../lib/meta';
import { usePlans } from '../store';
import { HarnessDot } from './atoms';
import { Button, Modal, Switch, Tip } from './ui';

export interface ServerWhole {
  name: string;
  entries: ItemDTO[];
  /** Your own configurations and the entries in your own agents: what one switch controls. */
  mine: ItemDTO[];
  /** Configurations owned by installers (e.g. their agents): left alone. */
  others: ItemDTO[];
  /** Plugins / bundles that ship this server, and what else they bring. */
  packages: { plugin: ItemDTO; brings: ItemDTO[] }[];
  /** The installed program(s): who installed them and how to uninstall. */
  programs: { label: string; by?: string; uninstall?: string; about?: string }[];
  users: number;
  on: boolean;
}

export function serverWhole(name: string, state: StateDTO): ServerWhole {
  const entries = state.items.filter((i) => i.kind === 'mcp' && i.name === name);
  const mine = entries.filter((i) => (i.role === 'owned' || (i.role === 'agent-profile' && !i.installedBy)) && !i.managedBy && !i.locked);
  const others = entries.filter((i) => i.role !== 'bundled' && !mine.includes(i));
  const packages = state.items
    .filter((p) => p.kind === 'plugin')
    .map((plugin) => {
      const contents = state.items.filter((i) => i.level === 'plugin' && i.owner === plugin.name && i.harness === plugin.harness);
      return contents.some((i) => i.kind === 'mcp' && i.name === name)
        ? { plugin, brings: contents.filter((i) => !(i.kind === 'mcp' && i.name === name)) }
        : undefined;
    })
    .filter((p): p is ServerWhole['packages'][number] => !!p);
  const programs = new Map<string, ServerWhole['programs'][number]>();
  for (const e of entries) {
    const label = e.mcp?.transport !== 'stdio' ? (e.mcp?.url ?? '') : (e.runtime?.resolved ?? e.mcp?.command ?? '');
    if (!label) continue;
    const cur = programs.get(label) ?? { label, by: e.installer?.by, uninstall: e.installer?.uninstall, about: e.installer?.about };
    cur.by ??= e.installer?.by;
    cur.uninstall ??= e.installer?.uninstall;
    cur.about ??= e.installer?.about;
    programs.set(label, cur);
  }
  const users = new Set(state.references.filter((r) => r.server === name).map((r) => r.by)).size;
  const on = entries.some((i) => i.enabled && !i.parked && !i.onDemand);
  return { name, entries, mine, others, packages, programs: [...programs.values()], users, on };
}

function brings(items: ItemDTO[]): string {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.kind, (counts.get(i.kind) ?? 0) + 1);
  return (
    [...counts]
      .map(
        ([k, n]) =>
          `${n} ${n === 1 ? KIND_META[k as keyof typeof KIND_META].one : KIND_META[k as keyof typeof KIND_META].label.toLowerCase()}`,
      )
      .join(', ') || 'nothing else'
  );
}

/** One switch and one uninstall button for a server as a whole. */
export function ServerControl({ name, state, size = 'row' }: { name: string; state: StateDTO; size?: 'row' | 'panel' }) {
  const { propose } = usePlans();
  const [mode, setMode] = useState<'off' | 'remove'>();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const w = serverWhole(name, state);
  const chosen = w.mine.filter((e) => !keep.has(e.ref));
  const switchable = w.mine.length > 0 || w.packages.some((p) => !p.plugin.locked);

  const open = (m: 'off' | 'remove') => {
    setPicked(new Set());
    setKeep(new Set());
    setMode(m);
  };
  const review = () => {
    if (!mode) return;
    setMode(undefined);
    // An explicit list only when you unticked some entries; otherwise all of yours.
    const only = chosen.length === w.mine.length ? [] : chosen.map((e) => e.ref);
    propose({ action: mode === 'off' ? 'server-off' : 'server-remove', refs: only, name, plugins: [...picked] });
  };

  return (
    <>
      <span className="flex items-center gap-2">
        <Tip
          content={
            !switchable
              ? 'Everything that starts it belongs to an installer'
              : w.on
                ? `Turn ${name} off everywhere you control`
                : `Turn ${name} back on`
          }
        >
          <span>
            <Switch
              checked={w.on}
              disabled={!switchable}
              onChange={(v) => (v ? propose({ action: 'server-on', refs: [], name }) : open('off'))}
              label={`${name} everywhere`}
            />
          </span>
        </Tip>
        {size === 'panel' ? (
          <Button size="sm" variant="danger" onClick={() => open('remove')} disabled={!w.mine.length && !w.packages.length}>
            <Trash2 className="h-3.5 w-3.5" /> Uninstall…
          </Button>
        ) : (
          <Tip content={`Uninstall ${name}`}>
            <button
              type="button"
              aria-label={`uninstall ${name}`}
              onClick={() => open('remove')}
              disabled={!w.mine.length && !w.packages.length}
              className="rounded p-1 text-paper-4 hover:bg-bad/10 hover:text-bad disabled:opacity-30"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </Tip>
        )}
      </span>

      <Modal open={!!mode} onClose={() => setMode(undefined)} title={mode === 'remove' ? `Uninstall ${name}` : `Turn off ${name}`} wide>
        <div className="scroll-thin max-h-[66vh] space-y-5 overflow-y-auto p-5">
          <h2 className="font-display text-[22px] italic">
            {mode === 'remove' ? 'Uninstall' : 'Turn off'} <span className="font-mono not-italic">{name}</span> everywhere
          </h2>

          <section>
            <p className="mb-1.5 text-[13px] text-paper">
              {mode === 'remove' ? 'Remove' : 'Turn off'} {chosen.length} of your {w.mine.length} configuration
              {w.mine.length === 1 ? '' : 's'}
              <span className="text-paper-4"> · backed up, can be undone · untick any to keep it</span>
            </p>
            <ul className="space-y-0.5 pl-1">
              {w.mine.map((e) => (
                <li key={e.ref}>
                  <label className="flex cursor-pointer items-center gap-2 font-mono text-[12px] text-paper-3">
                    <input
                      type="checkbox"
                      checked={!keep.has(e.ref)}
                      onChange={(ev) =>
                        setKeep((k) => {
                          const n = new Set(k);
                          if (ev.target.checked) n.delete(e.ref);
                          else n.add(e.ref);
                          return n;
                        })
                      }
                      className="accent-[var(--color-lume)]"
                    />
                    <HarnessDot id={e.harness} dim={!e.enabled} size={6} /> {harnessMeta(e.harness).label.split(' / ')[0]} ·{' '}
                    {e.level === 'agent' ? `agent ${e.owner}` : scopeText(e)}
                    {!e.enabled && <span className="text-paper-4">(already off)</span>}
                  </label>
                </li>
              ))}
              {!w.mine.length && <li className="text-[12px] text-paper-4">none: you have no configuration of your own for it</li>}
            </ul>
          </section>

          {w.packages.length > 0 && (
            <section>
              <p className="mb-1 text-[13px] text-paper">Plugins that also turn it on</p>
              <p className="mb-2 text-[12px] text-paper-4">
                A plugin’s entry cannot be switched on its own. Tick a plugin to turn it off too; that also turns off everything else in the
                plugin.
              </p>
              <ul className="divide-y divide-white/5 overflow-hidden rounded-lg border border-white/7">
                {w.packages.map(({ plugin, brings: rest }) => (
                  <li key={plugin.ref} className={cn('flex items-start gap-3 px-3 py-2', plugin.locked && 'opacity-60')}>
                    <input
                      type="checkbox"
                      disabled={!!plugin.locked || !plugin.enabled}
                      checked={picked.has(plugin.ref)}
                      aria-label={`also turn off ${plugin.name}`}
                      onChange={(e) =>
                        setPicked((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.add(plugin.ref);
                          else n.delete(plugin.ref);
                          return n;
                        })
                      }
                      className="mt-1 accent-[var(--color-lume)]"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] text-paper-2">
                        <HarnessDot id={plugin.harness} size={6} /> {harnessMeta(plugin.harness).label.split(' / ')[0]} ·{' '}
                        <span className="font-mono">{plugin.name.split('@')[0]}</span>
                        {plugin.installedBy && <span className="text-paper-4"> · by {plugin.installedBy}</span>}
                        {!plugin.enabled && <span className="text-paper-4"> · already off</span>}
                      </p>
                      <p className="text-[11.5px] text-paper-4">the plugin also contains {brings(rest)}</p>
                    </div>
                    {plugin.locked && (
                      <Tip content={plugin.locked}>
                        <Lock className="mt-1 h-3.5 w-3.5 text-paper-4" />
                      </Tip>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {w.others.length > 0 && (
            <section>
              <p className="text-[13px] text-paper">Left unchanged: {w.others.length} owned by installers</p>
              <p className="text-[12px] text-paper-4">
                {[...new Set(w.others.map((o) => `${o.managedBy ?? o.installedBy ?? 'installer'}`))].join(', ')} manage these; they may put
                back what you change.
              </p>
            </section>
          )}

          {mode === 'remove' && w.programs.length > 0 && (
            <section>
              <p className="mb-1 text-[13px] text-paper">The program itself</p>
              <p className="mb-2 text-[12px] text-paper-4">
                whatsloaded removes configuration only. Remove the program with the tool that installed it:
              </p>
              <ul className="space-y-1.5">
                {w.programs.map((p) => (
                  <li key={p.label} className="rounded-md border border-white/7 bg-ink-2/50 px-3 py-2">
                    <p className="font-mono text-[11.5px] break-all text-paper-3">
                      {p.label}
                      {p.by && <span className="text-paper-4"> · installed by {p.by}</span>}
                    </p>
                    {p.about && <p className="text-[11.5px] text-paper-4">{p.about}</p>}
                    {p.uninstall ? (
                      <p className="mt-1 flex items-center gap-2">
                        <code className="rounded bg-ink-3 px-1.5 py-0.5 font-mono text-[12px] text-paper">{p.uninstall}</code>
                        <button
                          type="button"
                          onClick={() => void navigator.clipboard.writeText(p.uninstall!).then(() => toast('Command copied'))}
                          className="flex items-center gap-1 text-[11px] text-paper-4 hover:text-paper-2"
                        >
                          <Copy className="h-3 w-3" /> copy
                        </button>
                      </p>
                    ) : (
                      <p className="mt-1 text-[11.5px] text-paper-4">nothing to uninstall separately</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {w.users > 0 && (
            <p className="text-[12.5px] text-lume">
              {w.users} agent{w.users === 1 ? '' : 's'} use {name}’s tools and will lose them.
            </p>
          )}
        </div>
        <footer className="flex justify-end gap-2 border-t border-white/6 bg-ink-0/40 px-5 py-3">
          <Button variant="ghost" onClick={() => setMode(undefined)}>
            Cancel
          </Button>
          <Button variant={mode === 'remove' ? 'danger' : 'primary'} onClick={review} disabled={!chosen.length && !picked.size}>
            Review
          </Button>
        </footer>
      </Modal>
    </>
  );
}
