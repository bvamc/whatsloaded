import { ChevronRight, RotateCcw, Search, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Problem, StateDTO } from '../api';
import { Badge, Button, SectionLabel } from '../components/ui';
import { cn, relTime } from '../lib/meta';
import { bucketed, fixesFor, PROBLEM_HINT, PROBLEM_TITLE } from '../lib/problems';
import { usePlans, useUi } from '../store';

const SEV_ORDER = { error: 0, warn: 1, info: 2 } as const;

function ProblemGroup({ code, ps, n, state }: { code: string; ps: Problem[]; n: number; state: StateDTO }) {
  const ui = useUi();
  const { propose } = usePlans();
  const sev = ps[0]!.severity;
  return (
    <section className="animate-rise" style={{ animationDelay: `${n * 50}ms` }}>
      <div className="mb-2 flex items-baseline gap-3">
        <span
          className={cn(
            'h-2 w-2 translate-y-[-2px] rounded-full',
            sev === 'error' ? 'bg-bad' : sev === 'warn' ? 'bg-lume shadow-[0_0_10px_var(--color-lume)]' : 'bg-coat/70',
          )}
        />
        <h3 className="text-[15px] text-paper">{PROBLEM_TITLE[code] ?? code}</h3>
        <span className="tabular font-mono text-[12px] text-paper-4">{ps.length}</span>
      </div>
      {PROBLEM_HINT[code] && <p className="mb-2 pl-5 text-[12.5px] text-paper-4">{PROBLEM_HINT[code]}</p>}
      <div className="divide-y divide-white/5 overflow-hidden rounded-xl border border-white/6 bg-ink-1/60">
        {ps.map((p) => (
          <div key={`${p.code}:${p.message}`} className="flex items-start gap-4 px-4 py-3">
            <p className="flex-1 text-[13px] leading-relaxed text-paper-2">{p.message.split('. See: ')[0]}</p>
            <div className="flex shrink-0 items-center gap-1.5">
              {fixesFor(p, state).map((f) => (
                <Button key={f.label} size="sm" onClick={() => propose(f.req)}>
                  <Wrench className="h-3.5 w-3.5" /> {f.label}
                </Button>
              ))}
              {p.refs?.[0] && (
                <Button size="sm" variant="ghost" onClick={() => ui.select(p.refs![0])}>
                  <Search className="h-3.5 w-3.5" /> {code === 'mcp-drift' ? 'Compare' : 'Open'}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function groupByCode(ps: Problem[]): [string, Problem[]][] {
  const by = new Map<string, Problem[]>();
  for (const p of ps) by.set(p.code, [...(by.get(p.code) ?? []), p]);
  return [...by].sort((a, b) => SEV_ORDER[a[1][0]!.severity] - SEV_ORDER[b[1][0]!.severity] || b[1].length - a[1].length);
}

export function Doctor({ state }: { state: StateDTO }) {
  const b = useMemo(() => bucketed(state), [state]);
  const [showOthers, setShowOthers] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  if (!state.problems.length) {
    return (
      <div className="reticle flex h-full flex-col items-center justify-center gap-2">
        <p className="font-display text-[32px] text-ok italic">Sharp focus.</p>
        <p className="text-paper-3">Nothing is broken or out of sync.</p>
      </div>
    );
  }

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-[980px] space-y-10 px-8 py-8">
        <div className="space-y-6">
          <SectionLabel>Yours to fix · {b.yours.length}</SectionLabel>
          {b.yours.length ? (
            groupByCode(b.yours).map(([code, ps], n) => <ProblemGroup key={code} code={code} ps={ps} n={n} state={state} />)
          ) : (
            <p className="rounded-xl border border-ok/20 bg-ok/5 px-4 py-3 text-[13px] text-ok">Nothing of yours needs fixing.</p>
          )}
        </div>

        {b.others.length > 0 && (
          <div className="space-y-4">
            <button type="button" onClick={() => setShowOthers(!showOthers)} className="flex w-full items-center gap-2 text-left">
              <ChevronRight className={cn('h-4 w-4 text-paper-4 transition-transform', showOthers && 'rotate-90')} />
              <span className="text-[10.5px] font-medium tracking-[0.16em] text-paper-4 uppercase">
                Installed by others · {b.others.length}
              </span>
              <span className="text-[12px] text-paper-4">
                These come from plugins or installers. Only their owner can fix them; you can turn the plugin off.
              </span>
            </button>
            {showOthers &&
              groupByCode(b.others).map(([code, ps], n) => <ProblemGroup key={code} code={code} ps={ps} n={n} state={state} />)}
          </div>
        )}

        {b.info.length > 0 && (
          <div className="space-y-4">
            <button type="button" onClick={() => setShowInfo(!showInfo)} className="flex w-full items-center gap-2 text-left">
              <ChevronRight className={cn('h-4 w-4 text-paper-4 transition-transform', showInfo && 'rotate-90')} />
              <span className="text-[10.5px] font-medium tracking-[0.16em] text-paper-4 uppercase">Good to know · {b.info.length}</span>
            </button>
            {showInfo && groupByCode(b.info).map(([code, ps], n) => <ProblemGroup key={code} code={code} ps={ps} n={n} state={state} />)}
          </div>
        )}
      </div>
    </div>
  );
}

export function Backups({ state }: { state: StateDTO }) {
  const { undo } = usePlans();
  if (!state.backups.length) {
    return (
      <div className="reticle flex h-full flex-col items-center justify-center gap-2">
        <p className="font-display text-[28px] italic">No exposures yet.</p>
        <p className="text-paper-3">Every change you apply is recorded here and can be reverted.</p>
      </div>
    );
  }
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-[820px] px-8 py-8">
        <SectionLabel>Change sets · newest first</SectionLabel>
        <ol className="relative mt-4 border-l border-white/8 pl-6">
          {state.backups.map((b, n) => (
            <li key={b.id} className="relative mb-6 animate-rise" style={{ animationDelay: `${n * 40}ms` }}>
              <span
                className={cn(
                  'absolute top-1.5 -left-[29px] h-2.5 w-2.5 rounded-full border-2 border-ink-0',
                  b.restoredAt ? 'bg-paper-4' : 'bg-lume shadow-[0_0_10px_var(--color-lume)]',
                )}
              />
              <div className="flex items-start gap-4">
                <div className="min-w-0 flex-1">
                  <p className={cn('font-mono text-[13px] break-all', b.restoredAt ? 'text-paper-4 line-through' : 'text-paper')}>
                    {b.label}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-paper-4">
                    {relTime(b.createdAt)} · {b.steps} step{b.steps === 1 ? '' : 's'} · {b.id}
                  </p>
                </div>
                {b.restoredAt ? (
                  <Badge>reverted {relTime(b.restoredAt)}</Badge>
                ) : (
                  <Button size="sm" onClick={() => void undo(b.id)}>
                    <RotateCcw className="h-3.5 w-3.5" /> Revert
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
