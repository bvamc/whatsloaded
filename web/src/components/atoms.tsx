import { diffLines } from 'diff';
import { motion } from 'motion/react';
import type { ItemDTO, McpSpec } from '../api';
import { levelsIn } from '../lib/group';
import { cn, harnessMeta } from '../lib/meta';
import { Tip } from './ui';

/** Six-blade iris; spins while data is loading. */
export function Aperture({ size = 28, busy = false }: { size?: number; busy?: boolean }) {
  const blades = [0, 60, 120, 180, 240, 300];
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      animate={{ rotate: busy ? 360 : 0 }}
      transition={busy ? { repeat: Infinity, duration: 2.4, ease: 'linear' } : { type: 'spring', stiffness: 60, damping: 12 }}
      aria-hidden
    >
      <circle cx="16" cy="16" r="14.5" fill="none" stroke="var(--color-lume)" strokeOpacity=".9" strokeWidth="1.2" />
      <circle cx="16" cy="16" r="11.5" fill="none" stroke="var(--color-paper)" strokeOpacity=".08" strokeWidth="1" />
      {blades.map((a) => (
        <path
          key={a}
          d="M16 3.5 L21.5 13"
          stroke="var(--color-lume)"
          strokeWidth="1.3"
          strokeLinecap="round"
          transform={`rotate(${a} 16 16)`}
          opacity=".85"
        />
      ))}
      <motion.circle
        cx="16"
        cy="16"
        fill="var(--color-lume)"
        animate={{ r: busy ? [2.2, 4, 2.2] : 3 }}
        transition={busy ? { repeat: Infinity, duration: 1.2 } : {}}
      />
    </motion.svg>
  );
}

export function HarnessDot({ id, dim, size = 8 }: { id: string; dim?: boolean; size?: number }) {
  const { color } = harnessMeta(id);
  return (
    <span
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: dim ? 'transparent' : color,
        boxShadow: dim ? `inset 0 0 0 1.5px ${color}88` : `0 0 8px ${color}66`,
      }}
    />
  );
}

export function HarnessTag({ id, className }: { id: string; className?: string }) {
  const m = harnessMeta(id);
  return (
    <span className={cn('inline-flex items-center gap-1.5 font-mono text-[11.5px] text-paper-2', className)}>
      <HarnessDot id={id} />
      {m.label}
    </span>
  );
}

export function StateDot({ item }: { item: Pick<ItemDTO, 'enabled' | 'parked'> }) {
  if (item.parked)
    return (
      <Tip content="parked by whatsloaded (disabled)">
        <span className="inline-block h-2 w-2 rounded-full border border-dashed border-lume" />
      </Tip>
    );
  return item.enabled ? (
    <span className="inline-block h-2 w-2 rounded-full bg-ok shadow-[0_0_8px_rgb(147_212_140/0.8)]" />
  ) : (
    <span className="inline-block h-2 w-2 rounded-full border border-paper-4" />
  );
}

const PLURAL: Record<string, [string, string]> = {
  plugin: ['plugin', 'plugins'],
  agent: ['agent', 'agents'],
  managed: ['policy', 'policies'],
};

/** "user", "project", "6 plugins", "62 agents": scope in words, not abbreviations. */
export function levelWords(level: string, n: number): string {
  const p = PLURAL[level];
  if (p) return n === 1 ? p[0] : `${n} ${p[1]}`;
  return n === 1 ? level : `${level} ×${n}`;
}

/** "kiro · user + 62 agents" pills: where a name is configured, at a glance. */
export function Spectrum({ copies, max = 5 }: { copies: ItemDTO[]; max?: number }) {
  const harnesses = [...new Set(copies.map((c) => c.harness))];
  return (
    <div className="flex flex-wrap items-center gap-1">
      {harnesses.slice(0, max).map((h) => {
        const levels = levelsIn(copies, h);
        const allOff = levels.every((l) => l.on === 0);
        return (
          <Tip key={h} content={levels.map((l) => `${harnessMeta(h).label} · ${l.level}: ${l.on}/${l.n} on`).join('\n')}>
            <span
              className={cn(
                'inline-flex h-[22px] items-center gap-1.5 rounded-full border border-white/8 bg-ink-2/80 pr-2 pl-1.5 font-mono text-[11px]',
                allOff && 'opacity-45',
              )}
            >
              <HarnessDot id={h} dim={allOff} size={7} />
              <span className="text-paper-2">{h}</span>
              <span className="text-paper-4">{levels.map((l) => levelWords(l.level, l.n)).join(' + ')}</span>
            </span>
          </Tip>
        );
      })}
      {harnesses.length > max && <span className="font-mono text-[11px] text-paper-4">+{harnesses.length - max}</span>}
    </div>
  );
}

/** Command line / URL of an MCP spec, tokenized. */
export function SpecLine({ spec, className }: { spec: McpSpec; className?: string }) {
  if (spec.transport !== 'stdio') {
    return (
      <span className={cn('font-mono text-[12px]', className)}>
        <span className="text-coat">{spec.transport}</span> <span className="text-paper-2">{spec.url}</span>
      </span>
    );
  }
  return (
    <span className={cn('font-mono text-[12px]', className)}>
      <span className="text-paper">{spec.command}</span>
      {spec.args?.map((a, n) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: args can repeat and never reorder within a render
        <span key={n} className={a.startsWith('-') ? 'text-lume/90' : 'text-paper-3'}>
          {' '}
          {a}
        </span>
      ))}
    </span>
  );
}

function SpecRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="contents">
      <dt className="pt-0.5 text-paper-4">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function KeyValues({ rec }: { rec: Record<string, string> }) {
  return (
    <span className="flex flex-col gap-0.5">
      {Object.entries(rec).map(([k, v]) => (
        <span key={k}>
          <span className="text-paper-2">{k}</span> <span className="text-paper-4">=</span>{' '}
          <span className="tracking-widest text-paper-4">{v}</span>
        </span>
      ))}
    </span>
  );
}

export function SpecBlock({ spec }: { spec: McpSpec }) {
  const has = (r?: Record<string, string>): r is Record<string, string> => !!r && Object.keys(r).length > 0;
  return (
    <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-2 font-mono text-[12px]">
      <SpecRow label="transport">
        <span className="text-coat">{spec.transport}</span>
      </SpecRow>
      {spec.command && (
        <SpecRow label="command">
          <SpecLine spec={{ ...spec, args: [] }} />
        </SpecRow>
      )}
      {!!spec.args?.length && (
        <SpecRow label="args">
          <span className="flex flex-wrap gap-1">
            {spec.args.map((a, n) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: args can repeat and never reorder within a render
              <code key={n} className="rounded bg-ink-3 px-1.5 py-0.5 text-paper-2">
                {a}
              </code>
            ))}
          </span>
        </SpecRow>
      )}
      {spec.url && (
        <SpecRow label="url">
          <span className="break-all text-paper-2">{spec.url}</span>
        </SpecRow>
      )}
      {has(spec.env) && (
        <SpecRow label="env">
          <KeyValues rec={spec.env} />
        </SpecRow>
      )}
      {has(spec.headers) && (
        <SpecRow label="headers">
          <KeyValues rec={spec.headers} />
        </SpecRow>
      )}
      {!!spec.disabledTools?.length && (
        <SpecRow label="hidden tools">
          <span className="text-paper-3">
            {spec.disabledTools.length}: {spec.disabledTools.slice(0, 8).join(', ')}
            {spec.disabledTools.length > 8 ? ' …' : ''}
          </span>
        </SpecRow>
      )}
    </dl>
  );
}

/** Render a unified diff produced by the server (already redacted). */
export function UnifiedDiff({ text }: { text: string }) {
  const lines = text.split('\n').filter(Boolean);
  return (
    <pre className="scroll-thin overflow-x-auto rounded-md border border-white/6 bg-ink-0/70 py-2 font-mono text-[11.5px] leading-[1.6]">
      {lines.map((l, n) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: diff lines repeat and are rendered once, never reordered
          key={n}
          className={cn(
            'px-3 whitespace-pre',
            l.startsWith('+') && 'bg-ok/8 text-ok',
            l.startsWith('-') && 'bg-bad/8 text-bad',
            l.startsWith('@@') && 'mt-1 text-coat/70 first:mt-0',
            !/^[+\-@]/.test(l) && 'text-paper-4',
          )}
        >
          {l}
        </div>
      ))}
    </pre>
  );
}

/** Client-side comparison of two specs (both already redacted). */
export function SpecDiff({ from, to }: { from: McpSpec; to: McpSpec }) {
  const parts = diffLines(`${JSON.stringify(from, null, 2)}\n`, `${JSON.stringify(to, null, 2)}\n`);
  return (
    <pre className="scroll-thin overflow-x-auto rounded-md border border-white/6 bg-ink-0/70 py-2 font-mono text-[11.5px] leading-[1.6]">
      {parts.flatMap((p, n) =>
        p.value
          .replace(/\n$/, '')
          .split('\n')
          .map((l, m) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: diff lines repeat and are rendered once, never reordered
              key={`${n}-${m}`}
              className={cn(
                'px-3 whitespace-pre',
                p.added && 'bg-ok/8 text-ok',
                p.removed && 'bg-bad/8 text-bad',
                !p.added && !p.removed && 'text-paper-4',
              )}
            >
              {p.added ? '+ ' : p.removed ? '- ' : '  '}
              {l}
            </div>
          )),
      )}
    </pre>
  );
}

/** "used 23×" / "unused": only shown for tools that record usage. */
export function UsageChip({ usage, days }: { usage?: { count: number; last?: number }; days: number }) {
  if (!usage) return null;
  if (usage.count > 0) {
    const ago = usage.last ? Math.max(0, Math.round((Date.now() - usage.last) / 86_400_000)) : undefined;
    return (
      <Tip
        content={
          ago === undefined ? `used ${usage.count} times in the last ${days} days` : `last used ${ago === 0 ? 'today' : `${ago}d ago`}`
        }
      >
        <span className="shrink-0 rounded-full bg-ok/10 px-1.5 py-0.5 font-mono text-[10.5px] text-ok">used {usage.count}×</span>
      </Tip>
    );
  }
  return (
    <Tip content={`not used in the last ${days} days`}>
      <span className="shrink-0 rounded-full border border-white/8 px-1.5 py-0.5 font-mono text-[10.5px] text-paper-4">unused</span>
    </Tip>
  );
}
