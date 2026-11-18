import { AlertTriangle, ArrowRight, Copy } from 'lucide-react';
import type { StateDTO, ToolLoadDTO } from '../api';
import { HarnessDot } from '../components/atoms';
import { toolName } from '../components/Shell';
import { Button, SectionLabel } from '../components/ui';
import { cn, harnessMeta } from '../lib/meta';
import { bucketed, PROBLEM_TITLE, problemsFor } from '../lib/problems';
import { useUi } from '../store';

export const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));

/** "24 skills · 22 subagents · 6 rules" — only non-zero kinds, plain words. */
/** "5 of 35 servers" for a kind, or '' when that kind does not load. */
export function usedOf(t: ToolLoadDTO, k: 'mcp' | 'skill' | 'agent'): string {
  const total = t.loaded[k] ?? 0;
  if (!total) return '';
  const label = k === 'mcp' ? 'servers' : k === 'skill' ? 'skills' : 'subagents';
  return `${t.used[k] ?? 0} of ${total} ${label}`;
}

export function offeredLine(t: ToolLoadDTO): string {
  const l = t.loaded;
  const parts = [
    l.skill && `${l.skill} skill${l.skill === 1 ? '' : 's'}`,
    t.agentsAre === 'subagents' && l.agent && `${l.agent} subagent${l.agent === 1 ? '' : 's'}`,
    l.command && `${l.command} command${l.command === 1 ? '' : 's'}`,
    l.rule && `${l.rule} rule${l.rule === 1 ? '' : 's'}`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'no skills, agents or rules';
}

function ToolCard({ t, state, n }: { t: ToolLoadDTO; state: StateDTO; n: number }) {
  const ui = useUi();
  const fix = problemsFor(bucketed(state).yours, t.harness).length;
  const servers = t.loaded.mcp ?? 0;
  const pluginSources = t.sources.filter((s) => s.kind === 'plugin' && s.enabled && s.refs.length);
  const plugins = pluginSources.length;
  const biggest = [...pluginSources].sort((a, b) => b.tokens - a.tokens)[0];
  const { color } = harnessMeta(t.harness);
  return (
    <section
      className="relative animate-rise overflow-hidden rounded-2xl border border-white/7 bg-ink-1/70 p-6"
      style={{ animationDelay: `${80 + n * 60}ms` }}
    >
      <span
        className="absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }}
      />
      <div className="flex items-center gap-2.5">
        <HarnessDot id={t.harness} size={9} />
        <h2 className="text-[15px] font-medium text-paper">{toolName(t.label)}</h2>
        <div className="flex-1" />
        <Button size="sm" onClick={() => ui.go(`tool:${t.harness}`)}>
          See what loads <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      <p className="mt-5 font-display text-[30px] leading-tight">
        <span className="text-lume">{servers}</span> MCP server{servers === 1 ? '' : 's'} start
      </p>
      <p className="mt-1 text-[13.5px] text-paper-2">
        {offeredLine(t)}
        {t.agentsAre === 'modes' && t.agents.length > 0 && <span className="text-paper-3"> · {t.agents.length} agents to choose from</span>}
      </p>
      <p className="mt-1 text-[12.5px] text-paper-4">
        ≈ {fmtTokens(t.contextTokens)} tokens of instructions before your first message
        {servers > 0 && ', plus each server’s tool definitions'}
      </p>
      <p className={cn('mt-3 text-[13px]', t.tracked ? 'text-paper' : 'text-paper-4')}>
        {t.tracked ? (
          <>
            Last {state.usage?.days ?? 30} days: you used <span className="text-ok">{usedOf(t, 'mcp')}</span>
            {usedOf(t, 'skill') && (
              <>
                {' '}
                · <span className="text-ok">{usedOf(t, 'skill')}</span>
              </>
            )}
            {t.agentsAre === 'subagents' && usedOf(t, 'agent') && (
              <>
                {' '}
                · <span className="text-ok">{usedOf(t, 'agent')}</span>
              </>
            )}
          </>
        ) : (
          `${toolName(t.label)} does not record what you use, so whatsloaded cannot tell what is idle.`
        )}
      </p>
      {t.tracked && t.trim.plugins.length + t.trim.items.length > 0 && (
        <button type="button" onClick={() => ui.go(`tool:${t.harness}`)} className="mt-2 text-left text-[12.5px] text-lume hover:underline">
          Trim what you have not used: {t.trim.servers} server{t.trim.servers === 1 ? '' : 's'}, ≈{fmtTokens(t.trim.tokens)} tokens →
        </button>
      )}

      <ul className="mt-5 space-y-1.5 text-[12.5px]">
        {plugins > 0 && (
          <li className="text-paper-3">
            {plugins} plugin{plugins === 1 ? '' : 's'} add to this.
            {biggest && (
              <>
                {' '}
                Largest: <span className="font-mono text-paper-2">{biggest.label}</span> (≈{fmtTokens(biggest.tokens)} tokens).
              </>
            )}
          </li>
        )}
        {t.duplicates.slice(0, 2).map((d) => (
          <li key={d.name} className="flex items-center gap-2 text-lume/90">
            <Copy className="h-3.5 w-3.5 shrink-0" />
            <span>
              <span className="font-mono">{d.name}</span> starts {d.count} times
            </span>
          </li>
        ))}
        {fix > 0 && (
          <li>
            <button type="button" onClick={() => ui.go('doctor')} className="flex items-center gap-2 text-bad hover:underline">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {fix} problem{fix === 1 ? '' : 's'} you can fix
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}

export function Home({ state }: { state: StateDTO }) {
  const ui = useUi();
  const fixable = bucketed(state).yours;
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-[1180px] px-8 pt-8 pb-16">
        <p className="max-w-3xl animate-rise text-[15px] leading-relaxed text-paper-3">
          {state.project ? (
            <>
              What each of your AI tools loads in <span className="font-mono text-paper-2">{state.project}</span>: your global settings plus
              what that project adds.
            </>
          ) : (
            <>
              What each of your AI tools loads everywhere: your global settings and plugins. Pick a project in the sidebar to add what its
              files bring.
            </>
          )}{' '}
          Who put each thing there, and the switch that turns it off. Every change shows a diff first and can be undone.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {state.tools.map((t, n) => (
            <ToolCard key={t.harness} t={t} state={state} n={n} />
          ))}
        </div>

        {fixable.length > 0 && (
          <section className="mt-12 animate-rise" style={{ animationDelay: '360ms' }}>
            <SectionLabel
              right={
                <button type="button" onClick={() => ui.go('doctor')} className="text-[12px] text-paper-4 hover:text-lume">
                  All problems →
                </button>
              }
            >
              Problems you can fix
            </SectionLabel>
            <div className="divide-y divide-white/5 overflow-hidden rounded-xl border border-white/6 bg-ink-1/60">
              {fixable.slice(0, 5).map((p) => (
                <button
                  type="button"
                  key={`${p.code}:${p.message}`}
                  onClick={() => (p.refs?.[0] ? ui.select(p.refs[0]) : ui.go('doctor'))}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-white/3"
                >
                  <span
                    className={
                      p.severity === 'error'
                        ? 'mt-1.5 h-2 w-2 shrink-0 rounded-full bg-bad'
                        : 'mt-1.5 h-2 w-2 shrink-0 rounded-full bg-lume'
                    }
                  />
                  <span className="w-64 shrink-0 text-[13px] text-paper">{PROBLEM_TITLE[p.code] ?? p.code}</span>
                  <span className="line-clamp-1 text-[12.5px] text-paper-3">{p.message}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
