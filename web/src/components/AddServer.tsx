import { Plus } from 'lucide-react';
import { useState } from 'react';
import type { McpSpec, StateDTO } from '../api';
import { cn } from '../lib/meta';
import { usePlans } from '../store';
import { HarnessDot } from './atoms';
import { Button, Input, Modal } from './ui';

/** Split a command line like a shell would for plain words and "quoted strings". */
export function splitCommand(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3]!);
  return out;
}

function pairs(text: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const at = line.indexOf('=');
    if (at > 0) out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return Object.keys(out).length ? out : undefined;
}

const LEVEL_TEXT: Record<string, string> = {
  user: 'all projects',
  project: 'this project (shared with the repo)',
  local: 'this project (only you)',
};

export function AddServerButton({ state, preselect }: { state: StateDTO; preselect?: string }) {
  const { propose } = usePlans();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'command' | 'url'>('command');
  const [command, setCommand] = useState('');
  const [url, setUrl] = useState('');
  const [sse, setSse] = useState(false);
  const [vars, setVars] = useState('');
  const targets = state.adapters
    .filter((a) => a.detected)
    .flatMap((a) =>
      (a.writable.mcp ?? []).map((level) => ({ harness: a.id, label: a.label.split(' / ')[0], level, key: `${a.id}:${level}` })),
    );
  const [picked, setPicked] = useState<Set<string>>(new Set(preselect ? [`${preselect}:user`] : []));

  const words = splitCommand(command);
  const spec: McpSpec | undefined =
    mode === 'command'
      ? words.length
        ? { transport: 'stdio', command: words[0], args: words.slice(1), env: pairs(vars) }
        : undefined
      : url
        ? { transport: sse ? 'sse' : 'http', url, headers: pairs(vars) }
        : undefined;
  const ready = !!name.trim() && !!spec && picked.size > 0;

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" /> Add MCP server
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add an MCP server">
        <div className="space-y-4 p-5">
          <h2 className="font-display text-[22px] italic">Add an MCP server</h2>
          <label className="block space-y-1.5">
            <span className="text-[12px] text-paper-3">Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="github" autoFocus />
          </label>
          <div className="space-y-1.5">
            <span className="text-[12px] text-paper-3">How it runs</span>
            <div className="flex gap-1.5">
              {(['command', 'url'] as const).map((m) => (
                <button
                  type="button"
                  key={m}
                  onClick={() => setMode(m)}
                  className={cn(
                    'h-7 rounded-md border px-3 text-[12.5px]',
                    mode === m ? 'border-lume/50 bg-lume/10 text-paper' : 'border-white/10 text-paper-3',
                  )}
                >
                  {m === 'command' ? 'A command on this machine' : 'A remote URL'}
                </button>
              ))}
            </div>
            {mode === 'command' ? (
              <Input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="npx -y @modelcontextprotocol/server-github"
                className="font-mono"
              />
            ) : (
              <div className="flex items-center gap-3">
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://api.example.com/mcp"
                  className="font-mono"
                />
                <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-paper-3">
                  <input type="checkbox" checked={sse} onChange={(e) => setSse(e.target.checked)} className="accent-[var(--color-lume)]" />{' '}
                  SSE
                </label>
              </div>
            )}
          </div>
          <label className="block space-y-1.5">
            <span className="text-[12px] text-paper-3">
              {mode === 'command' ? 'Environment variables' : 'Headers'} (KEY=value, one per line, optional)
            </span>
            <textarea
              value={vars}
              onChange={(e) => setVars(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-white/10 bg-ink-2/70 px-2.5 py-2 font-mono text-[12px] text-paper focus:border-lume/50 focus:outline-none"
            />
          </label>
          <div className="space-y-1.5">
            <span className="text-[12px] text-paper-3">Add it to</span>
            <div className="grid grid-cols-1 gap-1">
              {targets.map((t) => (
                <label
                  key={t.key}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[12.5px] hover:bg-white/4"
                >
                  <input
                    type="checkbox"
                    checked={picked.has(t.key)}
                    onChange={(e) =>
                      setPicked((cur) => {
                        const n = new Set(cur);
                        if (e.target.checked) n.add(t.key);
                        else n.delete(t.key);
                        return n;
                      })
                    }
                    className="accent-[var(--color-lume)]"
                  />
                  <HarnessDot id={t.harness} />
                  <span className="text-paper-2">{t.label}</span>
                  <span className="text-paper-4">· {LEVEL_TEXT[t.level] ?? t.level}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <footer className="flex justify-end gap-2 border-t border-white/6 bg-ink-0/40 px-5 py-3">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!ready}
            onClick={() => {
              setOpen(false);
              propose({ action: 'add', refs: [], name: name.trim(), spec, targets: [...picked] });
            }}
          >
            Review
          </Button>
        </footer>
      </Modal>
    </>
  );
}
