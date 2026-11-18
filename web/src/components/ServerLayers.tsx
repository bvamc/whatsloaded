import { AlertTriangle, ChevronDown, Lock } from 'lucide-react';
import { useState } from 'react';
import type { ItemDTO, Role, StateDTO } from '../api';
import { ROLE_SHORT } from '../lib/group';
import { cn, harnessMeta, refName, scopeText } from '../lib/meta';
import { programsOf } from '../lib/serverMap';
import { useUi } from '../store';
import { HarnessDot, StateDot } from './atoms';
import { MeasureButton } from './Measure';
import { serverWhole } from './ServerControl';
import { Badge, SectionLabel, Tip } from './ui';

const VARIANT = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ROLE_ORDER: Role[] = ['owned', 'bundled', 'policy', 'agent-profile'];
const ROLE_NOTE: Record<Role, string> = {
  owned: 'You maintain these. Differences between them are drift.',
  bundled: 'Shipped by plugins, each with its own settings. Toggle the plugin to change them.',
  policy: 'Set by your organisation.',
  'agent-profile': 'Launch settings an agent carries for itself. Only used while that agent runs.',
};

function EntryRow({ e, current, onSelect }: { e: ItemDTO; current: boolean; onSelect: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn('flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-white/4', current && 'bg-lume/6')}
      >
        {e.variant !== undefined && (e.variants ?? 1) > 1 ? (
          <span
            className={cn(
              'inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded font-mono text-[10.5px]',
              e.variant === 0 ? 'bg-white/8 text-paper-2' : 'bg-lume/15 text-lume',
            )}
          >
            {VARIANT[e.variant]}
          </span>
        ) : (
          <span className="w-[18px] shrink-0" />
        )}
        <HarnessDot id={e.harness} dim={!e.enabled} />
        <span className="w-16 shrink-0 font-mono text-[12px] text-paper-2">{e.harness}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-paper-3">{e.owner ?? scopeText(e)}</span>
        {e.installedBy && <span className="shrink-0 font-mono text-[10.5px] text-paper-4">by {e.installedBy}</span>}
        {e.managedBy && <Lock className="h-3 w-3 shrink-0 text-paper-4" />}
        <StateDot item={e} />
      </button>
    </li>
  );
}

/** Installed / Configured / Used by: the three layers of one MCP server, never mixed. */
export function ServerLayers({ item, state }: { item: ItemDTO; state: StateDTO }) {
  const { select } = useUi();
  const [expanded, setExpanded] = useState<Set<Role>>(new Set(['owned', 'policy']));
  const entries = state.items.filter((i) => i.kind === 'mcp' && i.name === item.name);
  const installs = programsOf(entries);
  const users = state.references.filter((r) => r.server === item.name);
  const blind = users.filter((u) => !u.ownEntry && !(u.includesGlobal === true && u.resolved));
  const whole = serverWhole(item.name, state);
  const byHarness = [...new Set(users.map((u) => u.harness))].map((h) => ({ h, refs: users.filter((u) => u.harness === h) }));

  return (
    <>
      <section>
        <SectionLabel right={<span className="font-mono text-[11px] text-paper-4">what actually runs</span>}>Installed</SectionLabel>
        <ul className="space-y-1.5">
          {installs.map((x) => (
            <li key={x.key} className="flex items-start gap-2.5 font-mono text-[12px]">
              <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', x.ok ? 'bg-ok' : 'bg-bad')} />
              <div className="min-w-0 flex-1">
                <div className={cn('break-all', x.ok ? 'text-paper-2' : 'text-bad')}>{x.label}</div>
                {x.detail && <div className="break-all text-[11px] text-paper-4">{x.detail}</div>}
                {x.about && <div className="text-[11.5px] text-paper-3">{x.about}</div>}
                {x.by && (
                  <div className="text-[11.5px] text-paper-3">
                    installed by {x.by}
                    {x.uninstall && (
                      <>
                        {' '}
                        · remove with <code className="rounded bg-ink-3 px-1 font-mono text-paper-2">{x.uninstall}</code>
                      </>
                    )}
                  </div>
                )}
              </div>
              <span className="shrink-0 text-[11px] text-paper-4">
                {x.entries} config{x.entries === 1 ? '' : 's'}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {whole.packages.length > 0 && (
        <section>
          <SectionLabel right={<span className="font-mono text-[11px] text-paper-4">its switch also turns off what else it contains</span>}>
            Also turned on by plugins
          </SectionLabel>
          <ul className="space-y-2">
            {whole.packages.map(({ plugin, brings }) => (
              <li key={plugin.ref} className="rounded-lg border border-white/6 px-3 py-2">
                <button type="button" onClick={() => select(plugin.ref)} className="flex items-center gap-2 text-left">
                  <HarnessDot id={plugin.harness} dim={!plugin.enabled} />
                  <span className="font-mono text-[12.5px] text-paper">{plugin.name.split('@')[0]}</span>
                  {plugin.installedBy && <span className="font-mono text-[10.5px] text-paper-4">by {plugin.installedBy}</span>}
                  {!plugin.enabled && <span className="text-[11px] text-paper-4">off</span>}
                </button>
                <p className="mt-1 text-[12px] text-paper-3">
                  {brings.length ? (
                    <>
                      the plugin also contains{' '}
                      {(['skill', 'agent', 'command', 'rule', 'mcp'] as const)
                        .map((k) => [k, brings.filter((b) => b.kind === k)] as const)
                        .filter(([, l]) => l.length)
                        .map(([k, l]) => `${l.length} ${k === 'mcp' ? 'other server' : k}${l.length === 1 ? '' : 's'}`)
                        .join(', ')}
                      :{' '}
                      <span className="text-paper-4">
                        {brings
                          .slice(0, 6)
                          .map((b) => b.name)
                          .join(', ')}
                        {brings.length > 6 ? ', …' : ''}
                      </span>
                    </>
                  ) : (
                    'nothing else'
                  )}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <SectionLabel right={<MeasureButton label={item.tools ? 'Measure again' : 'Measure'} refs={[item.ref]} />}>
          Tools it offers
        </SectionLabel>
        {item.tools ? (
          <>
            <p className="mb-2 text-[12.5px] text-paper-3">
              {item.tools.count} tools · ≈{item.tools.tokens.toLocaleString()} tokens of definitions in every session · measured{' '}
              {new Date(item.tools.measuredAt).toLocaleDateString()}
            </p>
            <div className="flex flex-wrap gap-1">
              {item.tools.names.map((n) => (
                <code key={n} className="rounded bg-ink-3 px-1.5 py-0.5 font-mono text-[11px] text-paper-2">
                  {n}
                </code>
              ))}
            </div>
          </>
        ) : (
          <p className="text-[12.5px] text-paper-4">Not measured yet. Measuring starts the server once to read its tool list.</p>
        )}
      </section>

      <section>
        <SectionLabel right={<span className="font-mono text-[11px] text-paper-4">how each tool launches it</span>}>
          Configured · {entries.length}
        </SectionLabel>
        <div className="space-y-3">
          {ROLE_ORDER.map((role) => {
            const list = entries.filter((e) => e.role === role);
            if (!list.length) return null;
            const open = expanded.has(role) || list.length <= 4;
            const shown = open ? list : list.slice(0, 3);
            return (
              <div key={role}>
                <button
                  type="button"
                  onClick={() =>
                    setExpanded((s) => {
                      const n = new Set(s);
                      if (n.has(role)) n.delete(role);
                      else n.add(role);
                      return n;
                    })
                  }
                  className="mb-1 flex w-full items-center gap-2 text-left"
                >
                  <span className="text-[12.5px] text-paper">{ROLE_SHORT[role]}</span>
                  <Badge>{list.length}</Badge>
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-paper-4">{ROLE_NOTE[role]}</span>
                  {list.length > 4 && <ChevronDown className={cn('h-3.5 w-3.5 text-paper-4 transition-transform', open && 'rotate-180')} />}
                </button>
                <ul className="divide-y divide-white/5 overflow-hidden rounded-lg border border-white/6">
                  {shown.map((e) => (
                    <EntryRow key={e.ref} e={e} current={e.ref === item.ref} onSelect={() => select(e.ref)} />
                  ))}
                  {!open && (
                    <li className="px-3 py-1.5 font-mono text-[11px] text-paper-4">
                      … {list.length - shown.length} more ({[...new Set(list.map((e) => e.installedBy ?? 'unknown'))].join(', ')})
                    </li>
                  )}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      {users.length > 0 && (
        <section>
          <SectionLabel right={<span className="font-mono text-[11px] text-paper-4">agents that call its tools</span>}>
            Used by · {new Set(users.map((u) => u.by)).size}
          </SectionLabel>
          {blind.length > 0 && (
            <div className="mb-2 flex items-start gap-2 rounded-md border border-lume/25 bg-lume/6 px-3 py-2 text-[12px] text-paper-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lume" />
              <span>
                {blind.length} agent{blind.length === 1 ? '' : 's'} cannot see a configuration for it
                {blind[0]?.hint ? `: ${blind[0].hint}` : '.'}
              </span>
            </div>
          )}
          <div className="space-y-1.5">
            {byHarness.map(({ h, refs }) => (
              <div key={h} className="flex flex-wrap items-center gap-1.5">
                <span className="flex w-20 items-center gap-1.5 font-mono text-[12px] text-paper-2">
                  <HarnessDot id={h} size={6} /> {harnessMeta(h).label.split(' ')[0]}
                </span>
                {refs.slice(0, 12).map((r) => {
                  const sees = r.ownEntry || (r.includesGlobal === true && r.resolved);
                  return (
                    <Tip
                      key={r.by}
                      content={`${r.by}\n${r.ownEntry ? 'own entry' : sees ? 'uses shared configuration' : 'no configuration visible'} · ${r.tools.slice(0, 6).join(', ')}`}
                    >
                      <button
                        type="button"
                        onClick={() => select(r.by)}
                        className={cn(
                          'h-6 rounded-full border px-2 font-mono text-[11px]',
                          sees ? 'border-white/8 text-paper-3 hover:text-paper' : 'border-lume/40 text-lume',
                        )}
                      >
                        {refName(r.by)}
                      </button>
                    </Tip>
                  );
                })}
                {refs.length > 12 && <span className="font-mono text-[11px] text-paper-4">+{refs.length - 12}</span>}
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
