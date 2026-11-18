import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, FolderGit2, Globe } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useState } from 'react';
import { api } from '../api';
import { cn } from '../lib/meta';
import { useStateQuery, useUi } from '../store';

/** Global (your settings everywhere) by default; pick a project to also see what its files add. */
export function ProjectPicker() {
  const ui = useUi();
  const { data: state } = useStateQuery();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const { data } = useQuery({ queryKey: ['projects'], queryFn: api.projects, enabled: open, staleTime: 60_000 });
  const home = state?.home ?? '';
  const short = (p: string) => (home && p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p);
  const pick = (p?: string) => {
    ui.setProject(p);
    setOpen(false);
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md border border-white/6 bg-ink-2/60 px-2.5 py-2 text-left hover:border-white/14"
        >
          {ui.project ? <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-lume" /> : <Globe className="h-3.5 w-3.5 shrink-0 text-paper-4" />}
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-paper-2" title={ui.project}>
            {ui.project ? short(ui.project) : 'Global: all projects'}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-paper-4" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          className="z-[60] w-[340px] animate-pop rounded-xl border border-white/10 bg-ink-2/95 p-1.5 shadow-2xl backdrop-blur-xl"
        >
          <button
            type="button"
            onClick={() => pick(undefined)}
            className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-white/5"
          >
            <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0 text-paper-3" />
            <span className="flex-1">
              <span className="block text-[12.5px] text-paper">Global</span>
              <span className="block text-[11.5px] text-paper-4">Your settings and plugins, in every project</span>
            </span>
            {!ui.project && <Check className="h-3.5 w-3.5 text-lume" />}
          </button>
          <p className="px-2.5 pt-2 pb-1 text-[10px] tracking-[0.16em] text-paper-4 uppercase">Include a project</p>
          <form
            className="flex items-center gap-1.5 px-1.5 pb-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const v = typed.trim().replace(/^~(?=\/|$)/, home);
              if (v) pick(v);
            }}
          >
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="or type a folder: ~/code/my-repo"
              className="h-7 flex-1 rounded-md border border-white/10 bg-ink-1 px-2 font-mono text-[11.5px] text-paper placeholder:text-paper-4 focus:border-lume/50 focus:outline-none"
            />
          </form>
          <div className="scroll-thin max-h-72 overflow-y-auto">
            {!data && <p className="px-2.5 py-2 text-[12px] text-paper-4">loading…</p>}
            {data?.projects.length === 0 && (
              <p className="px-2.5 py-2 text-[12px] text-paper-4">None of your tools has opened a project yet.</p>
            )}
            {data?.projects.map((p) => (
              <button
                type="button"
                key={p.path}
                onClick={() => pick(p.path)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left hover:bg-white/5',
                  ui.project === p.path && 'bg-lume/10',
                )}
              >
                <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-paper-4" />
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-paper-2" title={p.path}>
                  {short(p.path)}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-paper-4">{p.seenBy.join(' · ')}</span>
                {ui.project === p.path && <Check className="h-3.5 w-3.5 text-lume" />}
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
