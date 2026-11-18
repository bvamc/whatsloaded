import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Gauge } from 'lucide-react';
import { useState } from 'react';
import { api, type MeasurePlan, type MeasureResult } from '../api';
import { refName } from '../lib/meta';
import { fmtTokens } from '../views/Home';
import { Aperture } from './atoms';
import { Button, Modal } from './ui';

/**
 * Measure what servers' tool definitions cost. Starting a server runs its command, so the
 * dialog shows every command first and nothing starts until you press Run.
 */
export function MeasureButton({ refs, label, size = 'sm' }: { refs: string[]; label: string; size?: 'sm' | 'md' }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<MeasurePlan>();
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<MeasureResult[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const start = async () => {
    setOpen(true);
    setPlan(undefined);
    setResults(undefined);
    setError(undefined);
    try {
      setPlan(await api.measurePlan(refs));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const run = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const keep = plan.launches.filter((l) => !skip.has(l.ref)).map((l) => l.ref);
      // Re-plan with only the chosen servers so the server-side list matches what you saw.
      const chosen = keep.length === plan.launches.length ? plan : await api.measurePlan(keep);
      setResults((await api.measureRun(chosen.id)).results);
      await qc.invalidateQueries({ queryKey: ['state'] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const name = refName;
  const where = (r: string) => r.split('/')[0];
  const count = plan ? plan.launches.filter((l) => !skip.has(l.ref)).length : 0;

  return (
    <>
      <Button size={size} onClick={() => void start()} disabled={!refs.length}>
        <Gauge className="h-3.5 w-3.5" /> {label}
      </Button>
      <Modal open={open} onClose={() => !busy && setOpen(false)} title="Measure tool definitions" wide>
        <div className="scroll-thin max-h-[64vh] space-y-4 overflow-y-auto p-5">
          <h2 className="font-display text-[22px] italic">Measure what these servers cost</h2>
          <p className="text-[13px] leading-relaxed text-paper-3">
            Each server is started once, asked for its tool list, then stopped (15 s limit). Only tool names and sizes are kept. This runs
            the commands below on your machine, the same way your AI tool would.
          </p>
          {error && <p className="text-[13px] text-bad">{error}</p>}
          {!plan && !error && (
            <p className="flex items-center gap-2 text-paper-3">
              <Aperture busy size={18} /> preparing…
            </p>
          )}
          {plan && !results && (
            <ul className="divide-y divide-white/5 overflow-hidden rounded-lg border border-white/7">
              {plan.launches.map((l) => (
                <li key={l.ref} className="flex items-start gap-3 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={!skip.has(l.ref)}
                    aria-label={`measure ${name(l.ref)}`}
                    onChange={(e) =>
                      setSkip((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.delete(l.ref);
                        else n.add(l.ref);
                        return n;
                      })
                    }
                    className="mt-1 accent-[var(--color-lume)]"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] text-paper">
                      <span className="font-mono">{name(l.ref)}</span> <span className="text-paper-4">· {where(l.ref)}</span>
                    </p>
                    <p className="font-mono text-[11.5px] break-all text-paper-3">{l.commandLine ?? l.url}</p>
                    {l.envKeys.length > 0 && <p className="font-mono text-[11px] text-paper-4">with {l.envKeys.join(', ')}</p>}
                    {l.warnings.map((w) => (
                      <p key={w} className="flex items-center gap-1.5 text-[11.5px] text-lume">
                        <AlertTriangle className="h-3 w-3" /> {w}
                      </p>
                    ))}
                  </div>
                </li>
              ))}
              {plan.refused.map((r) => (
                <li key={r.ref} className="flex gap-3 px-3 py-2 text-[12px] text-paper-4">
                  <span className="w-[13px]" />
                  <span className="font-mono">{name(r.ref)}</span> skipped: {r.reason}
                </li>
              ))}
            </ul>
          )}
          {results && (
            <ul className="divide-y divide-white/5 overflow-hidden rounded-lg border border-white/7">
              {results.map((r) => (
                <li key={r.ref} className="flex items-center gap-3 px-3 py-2 text-[12.5px]">
                  <span className={r.ok ? 'text-ok' : 'text-bad'}>{r.ok ? '✓' : '✗'}</span>
                  <span className="w-56 truncate font-mono text-paper-2">{name(r.ref)}</span>
                  <span className="text-paper-3">
                    {r.ok ? `${r.measure.count} tools · ≈${fmtTokens(r.measure.tokens)} tokens` : r.message}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <footer className="flex justify-end gap-2 border-t border-white/6 bg-ink-0/40 px-5 py-3">
          <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
            {results ? 'Done' : 'Cancel'}
          </Button>
          {!results && (
            <Button variant="primary" disabled={!count || busy} onClick={() => void run()}>
              {busy ? 'Measuring…' : `Run ${count} server${count === 1 ? '' : 's'}`}
            </Button>
          )}
        </footer>
      </Modal>
    </>
  );
}
