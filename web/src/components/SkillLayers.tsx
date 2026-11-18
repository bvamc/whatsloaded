import { Check, CircleDashed, Copy, Link2, Plus } from 'lucide-react';
import type { ItemDTO, StateDTO } from '../api';
import { cn } from '../lib/meta';
import { usePlans, useUi } from '../store';
import { fmtTokens } from '../views/Home';
import { HarnessDot } from './atoms';
import { Button, SectionLabel } from './ui';

type Status = { kind: 'shared' | 'linked' | 'own' | 'off' | 'missing'; entry?: ItemDTO };

const toolName = (label: string) => label.split(' / ')[0]!;

/**
 * A skill, answered the way you would ask: where did it come from, how does it run, what does it
 * cost, and which of my tools have it (with a button for the ones that do not).
 */
export function SkillLayers({ item, state }: { item: ItemDTO; state: StateDTO }) {
  const { propose } = usePlans();
  const ui = useUi();
  const copies = state.items.filter((i) => i.kind === 'skill' && i.name === item.name && i.level !== 'plugin');
  const store = copies.find((i) => i.harness === 'agents' && i.level === 'store');
  const origin = item.source ? item : (store ?? item);
  const source = store ?? copies.find((i) => !i.link) ?? item;
  const userOnly = (store ?? item).skill?.userOnly;
  const body = (store ?? item).skill?.bodyTokens ?? 0;
  const descTokens = Math.round(((item.description ?? '').length + item.name.length) / 4);

  const status = (harness: string): Status => {
    const entry = copies.find((c) => c.harness === harness);
    if (!entry) return { kind: 'missing' };
    if (!entry.enabled || entry.parked) return { kind: 'off', entry };
    if (entry.link) return { kind: store && entry.link.target === store.location.file ? 'shared' : 'linked', entry };
    return { kind: 'own', entry };
  };
  const tools = state.tools.map((t) => ({
    t,
    s: status(t.harness),
    canAdd: state.adapters.find((a) => a.id === t.harness)?.writable.skill?.includes('user'),
  }));
  const missing = tools.filter((x) => x.s.kind === 'missing' && x.canAdd);
  const claudeUse = copies.find((c) => c.harness === 'claude')?.usage;
  const date = (iso?: string) => (iso ? new Date(iso).toLocaleDateString() : undefined);

  return (
    <>
      <section>
        <SectionLabel>Where it came from</SectionLabel>
        {origin.source ? (
          <div className="space-y-1 text-[13px] text-paper-2">
            <p>
              Installed by <span className="text-paper">{origin.installedBy ?? 'the skills CLI'}</span> from{' '}
              <span className="font-mono text-paper">{origin.source.repo ?? origin.source.url}</span>
              {origin.installedAt && <> on {date(origin.installedAt)}</>}
              {origin.updatedAt && origin.updatedAt !== origin.installedAt && <>, updated {date(origin.updatedAt)}</>}.
            </p>
            {origin.source.path && <p className="font-mono text-[11.5px] text-paper-4">{origin.source.path}</p>}
            <p className="text-[12px] text-paper-4">
              Updates and removal belong to the skills CLI so its records stay right:{' '}
              <code className="rounded bg-ink-3 px-1 font-mono text-paper-3">npx skills check</code>,{' '}
              <code className="rounded bg-ink-3 px-1 font-mono text-paper-3">npx skills update</code>,{' '}
              <code className="rounded bg-ink-3 px-1 font-mono text-paper-3">npx skills remove {item.name}</code>
            </p>
          </div>
        ) : (
          <p className="text-[13px] text-paper-3">
            {item.installedBy ? `Installed by ${item.installedBy}.` : 'No install record: you (or a tool) put it there by hand.'}
          </p>
        )}
      </section>

      <section>
        <SectionLabel>How it runs</SectionLabel>
        <p className="text-[13px] leading-relaxed text-paper-2">
          {userOnly ? (
            <>
              Only when <span className="text-paper">you</span> start it, e.g.{' '}
              <code className="rounded bg-ink-3 px-1 font-mono">/{item.name}</code> in Claude. The model never runs it on its own (
              <span className="font-mono text-[12px]">disable-model-invocation</span>), so “unused” only means you have not typed it.
            </>
          ) : (
            'The model sees its one-line description every session and loads the full instructions when your request matches.'
          )}
        </p>
        <p className="mt-1 text-[12.5px] text-paper-4">
          {userOnly ? 'Nothing per session.' : `≈${descTokens} tokens per session in each tool that has it.`} ≈{fmtTokens(body)} tokens of
          instructions when it runs.
          {claudeUse &&
            ` Claude: ${claudeUse.count ? `used ${claudeUse.count}× in the last ${state.usage?.days ?? 30} days` : `not used in the last ${state.usage?.days ?? 30} days`}.`}
        </p>
      </section>

      <section>
        <SectionLabel
          right={
            missing.length > 1 ? (
              <Button
                size="sm"
                onClick={() => propose({ action: 'copy', refs: [source.ref], targets: missing.map((x) => `${x.t.harness}:user`) })}
              >
                <Plus className="h-3.5 w-3.5" /> Add to all {missing.length}
              </Button>
            ) : undefined
          }
        >
          Available in
        </SectionLabel>
        <ul className="divide-y divide-white/5 overflow-hidden rounded-lg border border-white/6">
          {tools.map(({ t, s, canAdd }) => (
            <li key={t.harness} className="flex items-center gap-3 px-3 py-2">
              <HarnessDot id={t.harness} dim={s.kind === 'missing' || s.kind === 'off'} />
              <span className="w-24 shrink-0 text-[13px] text-paper-2">{toolName(t.label)}</span>
              <span
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-1.5 text-[12.5px]',
                  s.kind === 'shared' || s.kind === 'linked' ? 'text-ok' : s.kind === 'own' ? 'text-lume' : 'text-paper-4',
                )}
              >
                {s.kind === 'shared' && (
                  <>
                    <Check className="h-3.5 w-3.5" /> yes, linked to the shared copy
                  </>
                )}
                {s.kind === 'linked' && (
                  <>
                    <Link2 className="h-3.5 w-3.5" /> yes, linked to {s.entry!.link!.target}
                  </>
                )}
                {s.kind === 'own' && (
                  <>
                    <Copy className="h-3.5 w-3.5" /> yes, its own separate copy{store ? ' (may differ from the shared one)' : ''}
                  </>
                )}
                {s.kind === 'off' && (
                  <>
                    <CircleDashed className="h-3.5 w-3.5" /> turned off
                  </>
                )}
                {s.kind === 'missing' && (
                  <>
                    <CircleDashed className="h-3.5 w-3.5" /> not available
                  </>
                )}
              </span>
              {s.kind === 'missing' && canAdd && (
                <Button size="sm" onClick={() => propose({ action: 'copy', refs: [source.ref], targets: [`${t.harness}:user`] })}>
                  <Plus className="h-3.5 w-3.5" /> Add to {toolName(t.label)}
                </Button>
              )}
              {s.kind === 'off' && s.entry && (
                <Button size="sm" onClick={() => propose({ action: 'enable', refs: [s.entry!.ref] })}>
                  Turn on
                </Button>
              )}
              {s.kind === 'own' && !store && s.entry && (
                <Button size="sm" onClick={() => propose({ action: 'adopt', refs: [s.entry!.ref] })}>
                  Share via ~/.agents
                </Button>
              )}
              {(s.kind === 'shared' || s.kind === 'linked' || s.kind === 'own') && s.entry && s.entry.ref !== item.ref && (
                <Button size="sm" variant="ghost" onClick={() => ui.select(s.entry!.ref)}>
                  Open
                </Button>
              )}
            </li>
          ))}
        </ul>
        {store && (
          <p className="mt-2 text-[12px] text-paper-4">
            One copy lives in <span className="font-mono">~/.agents/skills/{item.name}</span>; each tool links to it, so edits and updates
            reach them all.
          </p>
        )}
      </section>
    </>
  );
}
