import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, CircleDashed, Loader2, Terminal, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type ApiErr, api, type Job, type JobPlan } from '../api';
import { cn, harnessMeta } from '../lib/meta';
import { HarnessDot } from './atoms';
import { Button, Modal } from './ui';

const toolLabel = (h: string) => harnessMeta(h).label.split(' / ')[0]!;

/**
 * Install or uninstall a catalog entry with its installer's own command: what will run is shown
 * first, nothing runs until you press Run, and afterwards each tool's files are checked.
 */
export function InstallDialog({
  entry,
  action,
  onClose,
}: {
  entry: { id: string; name: string };
  action: 'install' | 'uninstall';
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [plan, setPlan] = useState<JobPlan>();
  const [job, setJob] = useState<Job>();
  const [error, setError] = useState<string>();
  const [tools, setTools] = useState<string[]>();

  // Re-planned whenever the picked tools change, so the command shown always matches.
  useEffect(() => {
    setError(undefined);
    api
      .installPlan(entry.id, action, tools)
      .then(setPlan)
      .catch((e: ApiErr) => setError(e.message));
  }, [entry.id, action, tools]);

  // Follow a running job until it ends, then refresh what the app shows.
  useEffect(() => {
    if (job?.status !== 'running') return;
    const t = setTimeout(() => {
      api
        .job(job.id)
        .then((j) => {
          setJob(j);
          if (j.status !== 'running') {
            void qc.invalidateQueries({ queryKey: ['state'] });
            void qc.invalidateQueries({ queryKey: ['catalog'] });
          }
        })
        .catch((e: ApiErr) => setError(e.message));
    }, 700);
    return () => clearTimeout(t);
  }, [job, qc]);

  const run = () => {
    if (!plan) return;
    setError(undefined);
    api
      .installRun(plan.id)
      .then(setJob)
      .catch((e: ApiErr) => setError(e.message));
  };

  const verb = action === 'install' ? 'Install' : 'Uninstall';
  const shown = plan?.chosen ?? plan?.entry.tools ?? [];
  const after = job?.after;

  return (
    <Modal open onClose={onClose} title={`${verb} ${entry.name}`} wide>
      <div className="scroll-thin max-h-[68vh] space-y-5 overflow-y-auto p-5">
        <h2 className="font-display text-[22px] italic">
          {verb} <span className="font-mono not-italic">{entry.name}</span>
        </h2>

        {plan?.warnings.map((w) => (
          <p key={w} className="flex items-start gap-2 rounded-lg border border-lume/30 bg-lume/6 px-3 py-2 text-[12.5px] text-paper-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lume" /> {w}
          </p>
        ))}

        {plan && (
          <section>
            <p className="mb-1.5 text-[13px] text-paper">
              {job ? 'Running on this computer' : 'This will run on this computer'}
              {!job && <span className="text-paper-4"> · nothing runs until you press Run</span>}
            </p>
            <ul className="space-y-2">
              {(job?.steps ?? plan.steps.map((s) => ({ ...s, status: 'waiting' as const, output: undefined }))).map((s) => (
                <li key={s.text} className="rounded-lg border border-white/8 bg-ink-2/50 px-3 py-2">
                  <p className="flex items-center gap-2 text-[12px] text-paper-3">
                    <StepIcon status={s.status} /> {s.label}
                  </p>
                  <code className="mt-1 flex items-center gap-2 font-mono text-[12.5px] text-paper">
                    <Terminal className="h-3.5 w-3.5 shrink-0 text-paper-4" /> {s.text}
                  </code>
                  {s.output && (
                    <pre className="scroll-thin mt-2 max-h-40 overflow-auto rounded bg-ink-0/70 p-2 font-mono text-[11px] whitespace-pre-wrap text-paper-3">
                      {s.output.trim().split('\n').slice(-30).join('\n')}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {plan?.chosen && !job && (
          <section>
            <p className="mb-1.5 text-[13px] text-paper">Which tools</p>
            <div className="flex flex-wrap gap-2">
              {plan.entry.tools.map((h) => {
                const on = plan.chosen!.includes(h);
                return (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setTools(on ? plan.chosen!.filter((t) => t !== h) : [...plan.chosen!, h])}
                    className={cn(
                      'flex h-8 items-center gap-2 rounded-lg border px-3 text-[12.5px]',
                      on ? 'border-lume/50 bg-lume/10 text-paper' : 'border-white/8 text-paper-3',
                    )}
                  >
                    <HarnessDot id={h} size={7} dim={!on} /> {toolLabel(h)}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {plan && shown.length > 0 && (
          <section>
            <p className="mb-1 text-[13px] text-paper">{job && job.status !== 'running' ? 'Result in each tool' : 'Goes into'}</p>
            <ul className="space-y-1">
              {shown.map((h) => {
                const has = after?.includes(h);
                const done = job && job.status !== 'running' && after;
                return (
                  <li key={h} className="flex items-center gap-2 text-[12.5px] text-paper-2">
                    <HarnessDot id={h} size={7} /> {toolLabel(h)}
                    {plan.before.includes(h) && !done && <span className="text-paper-4">· already has it</span>}
                    {done &&
                      (action === 'install' ? (
                        has ? (
                          <span className="text-ok">· has it now; restart {toolLabel(h)} to use it</span>
                        ) : (
                          <span className="text-bad">· did not get it; see the output above</span>
                        )
                      ) : has ? (
                        <span className="text-bad">· still has it</span>
                      ) : (
                        <span className="text-ok">· removed</span>
                      ))}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {!plan && !error && (
          <p className="flex items-center gap-2 text-[12.5px] text-paper-3">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Preparing…
          </p>
        )}
        {error && <p className="rounded-lg border border-bad/30 bg-bad/8 px-3 py-2 text-[12.5px] text-bad">{error}</p>}
      </div>
      <footer className="flex justify-end gap-2 border-t border-white/6 bg-ink-0/40 px-5 py-3">
        <Button variant="ghost" onClick={onClose}>
          {job && job.status !== 'running' ? 'Close' : 'Cancel'}
        </Button>
        {!job && (
          <Button variant={action === 'uninstall' ? 'danger' : 'primary'} onClick={run} disabled={!plan}>
            Run
          </Button>
        )}
      </footer>
    </Modal>
  );
}

function StepIcon({ status }: { status: string }) {
  if (status === 'running') return <Loader2 className="h-3.5 w-3.5 animate-spin text-lume" />;
  if (status === 'done') return <Check className="h-3.5 w-3.5 text-ok" />;
  if (status === 'failed') return <X className="h-3.5 w-3.5 text-bad" />;
  return <CircleDashed className={cn('h-3.5 w-3.5 text-paper-4')} />;
}
