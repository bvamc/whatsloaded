import { AlertTriangle, FileDiff, Lock, ShieldAlert } from 'lucide-react';
import { usePlans } from '../store';
import { Aperture, UnifiedDiff } from './atoms';
import { Button, Kbd, Modal } from './ui';

/** Every change goes through here: server-built plan, redacted diff, explicit apply. */
export function PlanDialog() {
  const { pending, apply, cancel, propose } = usePlans();
  const open = !!pending;
  const plan = pending?.plan;
  const err = pending?.error;

  return (
    <Modal open={open} onClose={cancel} title="Review changes" wide>
      <header className="flex items-start gap-3 border-b border-white/6 px-5 pt-5 pb-4">
        <div className="mt-0.5 rounded-lg border border-lume/25 bg-lume/8 p-2 text-lume">
          <FileDiff className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[22px] leading-tight italic">Review changes</h2>
          <p className="mt-0.5 truncate font-mono text-[12px] text-paper-3">
            {plan?.label ?? `${pending?.req.action} ${pending?.req.refs.join(', ') ?? ''}`}
          </p>
        </div>
      </header>

      <div className="scroll-thin flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {pending?.busy && !plan && (
          <div className="flex items-center gap-3 py-8 text-paper-3">
            <Aperture busy size={22} /> planning…
          </div>
        )}

        {err && (
          <div className="rounded-lg border border-bad/30 bg-bad/6 p-4">
            <div className="flex items-start gap-2.5 text-[13px] text-bad">
              {err.code === 'managed' ? <Lock className="mt-0.5 h-4 w-4 shrink-0" /> : <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />}
              <p className="leading-relaxed">{err.message}</p>
            </div>
            {err.code === 'managed' && pending && (
              <div className="mt-3 flex items-center gap-3 pl-6.5">
                <Button size="sm" variant="danger" onClick={() => propose({ ...pending.req, force: true })}>
                  Plan it anyway (force)
                </Button>
                <span className="text-[12px] text-paper-4">its owner may overwrite this on its next sync</span>
              </div>
            )}
          </div>
        )}

        {plan?.warnings.map((w, n) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a plan is immutable once fetched; warnings may repeat
          <div key={n} className="flex items-start gap-2 text-[12.5px] text-lume/90">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="leading-relaxed">{w}</span>
          </div>
        ))}

        {plan?.changes.map((c, n) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: change order is the apply order and never changes
          <section key={n} className="animate-rise" style={{ animationDelay: `${n * 40}ms` }}>
            <div className="mb-1.5 flex items-center gap-2 text-[13px]">
              <span className="font-mono text-[11px] text-paper-4">{String(n + 1).padStart(2, '0')}</span>
              <span className="text-paper">{c.describe}</span>
            </div>
            {c.error && <p className="mb-1.5 font-mono text-[12px] text-bad">cannot apply: {c.error}</p>}
            {c.diff && <UnifiedDiff text={c.diff} />}
          </section>
        ))}

        {plan && !plan.changes.length && <p className="py-6 text-center text-paper-3">Nothing to change.</p>}
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-white/6 bg-ink-0/40 px-5 py-3">
        <p className="text-[12px] text-paper-4">Backed up automatically · undo anytime from Backups</p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={cancel}>
            Cancel <Kbd>esc</Kbd>
          </Button>
          <Button variant="primary" disabled={!plan?.applicable || pending?.busy} onClick={() => void apply()}>
            {pending?.busy && plan ? 'Applying…' : `Apply ${plan?.changes.length ?? 0} change${plan?.changes.length === 1 ? '' : 's'}`}
          </Button>
        </div>
      </footer>
    </Modal>
  );
}
