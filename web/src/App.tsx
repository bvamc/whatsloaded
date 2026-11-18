import { useMemo } from 'react';
import { Toaster } from 'sonner';
import type { Kind } from './api';
import { Aperture } from './components/atoms';
import { Inspector } from './components/Inspector';
import { PlanDialog } from './components/PlanDialog';
import { CommandPalette, Sidebar, Topbar, toolName, viewTitle } from './components/Shell';
import { TipProvider } from './components/ui';
import { groupItems, visible } from './lib/group';
import { KIND_ORDER } from './lib/meta';
import { useStateQuery, useUi } from './store';
import { Discover } from './views/Discover';
import { Backups, Doctor } from './views/Health';
import { Home } from './views/Home';
import { KindView } from './views/KindView';
import { PackageList, PackageView } from './views/Packages';
import { ServerMap } from './views/ServerMap';
import { ToolView } from './views/Tool';

export function App() {
  const ui = useUi();
  const { data, error, isLoading } = useStateQuery();
  const labels = useMemo(() => Object.fromEntries((data?.tools ?? []).map((t) => [t.harness, toolName(t.label)])), [data]);

  const subtitle = useMemo(() => {
    if (!data) return undefined;
    if (ui.view === 'overview') return data.project ? `global settings + ${data.project}` : 'global: your settings in every project';
    if (ui.view === 'doctor') return 'what is broken or out of sync, and who can fix it';
    if (ui.view === 'backups') return `${data.backups.length} change sets · every change can be reverted`;
    if (ui.view === 'discover') return 'find plugins, MCP servers, skills and packages, and install them with their own installers';
    if (ui.view === 'packages') return `${data.packages.length} things you installed as a unit, and what each one added`;
    if (ui.view.startsWith('package:')) return 'everything this package added to your tools';
    if (ui.view.startsWith('server:')) return 'everything this MCP server brings, and everything that relies on it';
    if (ui.view.startsWith('tool:')) return data.project ? `global settings + ${data.project}` : 'global: your settings in every project';
    const gs = groupItems(
      visible(data.items, { ...ui.filters, query: '' }).filter((i) => i.kind === ui.view),
      data.references,
    );
    return `${gs.length} names · ${gs.reduce((n, g) => n + g.copies.length, 0)} configurations · ${gs.filter((g) => g.copies.length > 1).length} configured in more than one place`;
  }, [data, ui.view, ui.filters]);

  return (
    <TipProvider>
      <div className="relative z-[1] flex h-full">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <Topbar title={viewTitle(ui.view, labels)} subtitle={subtitle} />
          <div className="relative min-h-0 flex-1">
            {isLoading && (
              <div className="flex h-full items-center justify-center gap-3 text-paper-3">
                <Aperture busy size={36} />
                <span className="font-display text-[20px] italic">Focusing…</span>
              </div>
            )}
            {error && (
              <div className="flex h-full flex-col items-center justify-center gap-2">
                <p className="font-display text-[24px] text-bad italic">Lost signal</p>
                <p className="font-mono text-[12px] text-paper-3">{(error as Error).message}</p>
                <p className="text-[12.5px] text-paper-4">Is `whatsloaded ui` still running?</p>
              </div>
            )}
            {data && (
              <div key={ui.view} className="h-full animate-fade">
                {ui.view === 'overview' && <Home state={data} />}
                {ui.view.startsWith('tool:') && <ToolView harness={ui.view.slice(5)} state={data} />}
                {ui.view.startsWith('server:') && <ServerMap name={ui.view.slice(7)} state={data} />}
                {ui.view === 'packages' && <PackageList state={data} />}
                {ui.view === 'discover' && <Discover state={data} />}
                {ui.view.startsWith('package:') && <PackageView id={ui.view.slice(8)} state={data} />}
                {ui.view === 'doctor' && <Doctor state={data} />}
                {ui.view === 'backups' && <Backups state={data} />}
                {(KIND_ORDER as string[]).includes(ui.view) && <KindView kind={ui.view as Kind} state={data} />}
              </div>
            )}
          </div>
        </main>
      </div>
      <Inspector />
      <PlanDialog />
      <CommandPalette />
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          classNames: {
            toast: '!bg-ink-2/95 !border-white/10 !text-paper !font-sans backdrop-blur-xl',
            description: '!text-paper-3 !font-mono !text-[11.5px]',
            actionButton: '!bg-lume !text-ink-0',
          },
        }}
      />
    </TipProvider>
  );
}
