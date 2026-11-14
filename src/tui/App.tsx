import { Box, render, Text, useApp, useInput, useStdout } from 'ink';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { UnsupportedError } from '../adapters/types.js';
import { detail, planText, problemLines, showItem, stateCell, tilde } from '../commands/render.js';
import type { Ctx } from '../core/context.js';
import { diagnose } from '../core/doctor.js';
import { collect, type Inventory } from '../core/inventory.js';
import { type Item, KINDS, type Kind, ref, scopeLabel } from '../core/model.js';
import { ManagedError, type Plan, planToggle } from '../core/ops.js';
import { apply, listBackups, restore } from '../io/changeset.js';

type Mode = { t: 'list' } | { t: 'filter' } | { t: 'detail' } | { t: 'doctor' } | { t: 'confirm'; plan: Plan; label: string };

const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));

function App({ ctx }: { ctx: Ctx }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [inv, setInv] = useState<Inventory | null>(null);
  const [kind, setKind] = useState<Kind>('mcp');
  const [cursor, setCursor] = useState(0);
  const [filter, setFilter] = useState('');
  const [showPlugins, setShowPlugins] = useState(false);
  const [mode, setMode] = useState<Mode>({ t: 'list' });
  const [status, setStatus] = useState('');

  const reload = useCallback(async () => setInv(await collect(ctx)), [ctx]);
  useEffect(() => void reload(), [reload]);

  const items = useMemo(
    () =>
      (inv?.items ?? []).filter(
        (i) =>
          i.kind === kind &&
          (showPlugins || i.scope.level !== 'plugin' || i.kind === 'mcp') &&
          (!filter || ref(i).toLowerCase().includes(filter.toLowerCase())),
      ),
    [inv, kind, filter, showPlugins],
  );
  const sel: Item | undefined = items[Math.min(cursor, items.length - 1)];
  const height = Math.max(5, ((stdout as NodeJS.WriteStream).rows || 30) - 7);
  const cols = (stdout as NodeJS.WriteStream).columns || 120;

  const propose = (label: string, build: () => Plan) => {
    try {
      const plan = build();
      if (!plan.changes.length) return setStatus(plan.warnings.join('; ') || 'nothing to do');
      setMode({ t: 'confirm', plan, label });
    } catch (e) {
      if (e instanceof ManagedError || e instanceof UnsupportedError)
        setStatus(e.message.replace('Re-run with --force to do it anyway.', 'Press F to force.'));
      else throw e;
    }
  };

  useInput((input, key) => {
    if (mode.t === 'filter') {
      if (key.escape) {
        setFilter('');
        setMode({ t: 'list' });
      } else if (key.return) setMode({ t: 'list' });
      else if (key.backspace || key.delete) setFilter((f) => f.slice(0, -1));
      else if (input && !key.ctrl && !key.meta) {
        setFilter((f) => f + input);
        setCursor(0);
      }
      return;
    }
    if (mode.t === 'confirm') {
      if (input === 'y') {
        try {
          const m = apply(mode.plan.changes, ctx, mode.label);
          setStatus(`✓ applied ${m.steps.length} change(s) · backup ${m.id} · press u to undo`);
        } catch (e) {
          setStatus(`✗ ${(e as Error).message}`);
        }
        setMode({ t: 'list' });
        void reload();
      } else if (input === 'n' || key.escape) {
        setMode({ t: 'list' });
        setStatus('cancelled');
      }
      return;
    }
    if (mode.t !== 'list') {
      if (key.escape || key.return || input === 'q') setMode({ t: 'list' });
      return;
    }
    if (input === 'q' || key.escape) return exit();
    if (key.upArrow || input === 'k') setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow || input === 'j') setCursor((c) => Math.min(items.length - 1, c + 1));
    if (key.pageDown) setCursor((c) => Math.min(items.length - 1, c + height));
    if (key.pageUp) setCursor((c) => Math.max(0, c - height));
    if (key.rightArrow || key.leftArrow || key.tab) {
      const d = key.leftArrow ? -1 : 1;
      setKind((k) => KINDS[(KINDS.indexOf(k) + d + KINDS.length) % KINDS.length]!);
      setCursor(0);
    }
    if (/^[1-6]$/.test(input)) {
      setKind(KINDS[Number(input) - 1]!);
      setCursor(0);
    }
    if (input === '/') setMode({ t: 'filter' });
    if (input === 'a') setShowPlugins((s) => !s);
    if (input === 'r') {
      void reload();
      setStatus('reloaded');
    }
    if (input === 'd') setMode({ t: 'doctor' });
    if (key.return && sel) setMode({ t: 'detail' });
    if ((input === ' ' || input === 'F') && sel && inv) {
      propose(`${sel.enabled ? 'disable' : 'enable'} ${ref(sel)}`, () => planToggle(inv, [sel], !sel.enabled, input === 'F'));
    }
    if (input === 'u') {
      const last = listBackups(ctx).find((b) => !b.restoredAt);
      if (!last) return setStatus('nothing to undo');
      try {
        restore(last.id, ctx);
        setStatus(`↶ reverted: ${last.label}`);
        void reload();
      } catch (e) {
        setStatus(`✗ ${(e as Error).message}`);
      }
    }
  });

  if (!inv) return <Text dimColor>scanning…</Text>;

  const tabs = (
    <Box>
      <Text bold color="cyan">
        whatsloaded{' '}
      </Text>
      {KINDS.map((k, n) => {
        const count = inv.items.filter((i) => i.kind === k && (showPlugins || i.scope.level !== 'plugin')).length;
        return (
          <Text key={k} inverse={k === kind}>
            {` ${n + 1}:${k} ${count} `}
          </Text>
        );
      })}
      <Text dimColor>{`  ${ctx.project ? tilde(ctx.project, ctx) : 'no project'}${showPlugins ? ' · +plugins' : ''}`}</Text>
    </Box>
  );

  const footer = (
    <Box flexDirection="column">
      <Text dimColor>
        {mode.t === 'confirm'
          ? 'y apply · n cancel'
          : '↑↓ move · ←→ kind · / filter · space toggle · F force-toggle · ⏎ details · d doctor · a plugins · u undo · r reload · q quit'}
      </Text>
      <Text color={status.startsWith('✗') ? 'red' : status.startsWith('✓') ? 'green' : 'yellow'} wrap="truncate">
        {mode.t === 'filter' ? `/${filter}█` : filter ? `filter: ${filter}  ${status}` : status}
      </Text>
    </Box>
  );

  let body: ReactNode;
  if (mode.t === 'detail' && sel) body = <Text>{showItem(sel, ctx, false)}</Text>;
  else if (mode.t === 'doctor') {
    const lines = problemLines(diagnose(inv)).split('\n');
    body = (
      <Text wrap="truncate">
        {lines.slice(0, height).join('\n') + (lines.length > height ? `\n… ${lines.length - height} more (whatsloaded doctor)` : '')}
      </Text>
    );
  } else if (mode.t === 'confirm') {
    const lines = planText(mode.plan, ctx, false).split('\n');
    body = (
      <Box flexDirection="column">
        <Text bold>{mode.label}</Text>
        <Text>{lines.slice(0, height - 2).join('\n')}</Text>
      </Box>
    );
  } else {
    const start = Math.max(0, Math.min(cursor - Math.floor(height / 2), items.length - height));
    const nameW = Math.min(36, Math.max(10, ...items.map((i) => i.name.length)));
    body = (
      <Box flexDirection="column">
        {items.length === 0 && <Text dimColor>nothing here</Text>}
        {items.slice(start, start + height).map((i, n) => {
          const isSel = start + n === cursor;
          return (
            <Text key={ref(i)} inverse={isSel} wrap="truncate">
              {`${pad(i.name, nameW)}  ${pad(i.scope.harness, 8)}  ${pad(scopeLabel(i.scope), 22)}  ${stateCell(i).padEnd(16)}  ${detail(i, ctx).slice(0, Math.max(0, cols - nameW - 60))}`}
            </Text>
          );
        })}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {tabs}
      <Box marginY={1} flexDirection="column" height={height}>
        {body}
      </Box>
      {footer}
    </Box>
  );
}

export async function runTui(ctx: Ctx): Promise<void> {
  const app = render(<App ctx={ctx} />);
  await app.waitUntilExit();
}
