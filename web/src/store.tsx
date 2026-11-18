import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ApiErr, api, getProject, type Kind, type PlanDTO, type PlanRequest, type StateDTO, setProjectParam } from './api';
import type { Filters } from './lib/group';
import { harnessMeta, KIND_ORDER } from './lib/meta';

/** `tool:<harness>` is one tool's page, `server:<name>` one MCP server's map; the rest are fixed pages. */
export type View =
  | 'overview'
  | Kind
  | 'doctor'
  | 'backups'
  | 'packages'
  | 'discover'
  | `tool:${string}`
  | `server:${string}`
  | `package:${string}`;
const VIEWS: string[] = ['overview', ...KIND_ORDER, 'doctor', 'backups', 'packages', 'discover'];

function readHash(): View {
  const h = location.hash.replace(/^#\/?/, '');
  if (h.startsWith('tool/') && h.length > 5) return `tool:${h.slice(5)}`;
  if (h.startsWith('server/') && h.length > 7) return `server:${decodeURIComponent(h.slice(7))}`;
  if (h.startsWith('package/') && h.length > 8) return `package:${decodeURIComponent(h.slice(8))}`;
  return VIEWS.includes(h) ? (h as View) : 'overview';
}

export const viewHash = (v: View) =>
  v.startsWith('tool:')
    ? `/tool/${v.slice(5)}`
    : v.startsWith('server:')
      ? `/server/${encodeURIComponent(v.slice(7))}`
      : v.startsWith('package:')
        ? `/package/${encodeURIComponent(v.slice(8))}`
        : `/${v}`;

interface Ui {
  /** Included project; undefined = global. */
  project?: string;
  setProject: (p?: string) => void;
  view: View;
  go: (v: View) => void;
  selected?: string;
  select: (ref?: string) => void;
  filters: Filters;
  setQuery: (q: string) => void;
  toggleHarness: (id: string) => void;
  clearHarnesses: () => void;
  setIncludePlugins: (v: boolean) => void;
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
}

interface Plans {
  propose: (req: PlanRequest) => void;
  undo: (id?: string) => Promise<void>;
  pending: { req: PlanRequest; plan?: PlanDTO; error?: ApiErr; busy: boolean } | null;
  apply: () => Promise<void>;
  cancel: () => void;
}

const UiCtx = createContext<Ui | null>(null);
const PlanCtx = createContext<Plans | null>(null);

export function useStateQuery() {
  const { project } = useUi();
  return useQuery<StateDTO>({ queryKey: ['state', project ?? ''], queryFn: api.state, refetchOnWindowFocus: true, staleTime: 5_000 });
}

export function useUi(): Ui {
  const v = useContext(UiCtx);
  if (!v) throw new Error('useUi outside provider');
  return v;
}

export function usePlans(): Plans {
  const v = useContext(PlanCtx);
  if (!v) throw new Error('usePlans outside provider');
  return v;
}

export function Providers({ children }: { children: ReactNode }) {
  const [view, setView] = useState<View>(readHash);
  const [selected, select] = useState<string | undefined>();
  const [query, setQuery] = useState('');
  const [harnesses, setHarnesses] = useState<Set<string>>(new Set());
  const [includePlugins, setIncludePlugins] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [project, setProjectState] = useState<string | undefined>(getProject());
  const setProject = useCallback((p?: string) => {
    setProjectParam(p);
    setProjectState(p);
  }, []);
  const [pending, setPending] = useState<Plans['pending']>(null);
  const qc = useQueryClient();

  useEffect(() => {
    const on = () => setView(readHash());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);

  const go = useCallback((v: View) => {
    location.hash = viewHash(v);
    setView(v);
  }, []);

  const toggleHarness = useCallback(
    (id: string) =>
      setHarnesses((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      }),
    [],
  );

  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ['state'] }), [qc]);

  const undo = useCallback(
    async (id?: string) => {
      try {
        const r = await api.undo(id);
        toast(`Reverted`, { description: r.label });
      } catch (e) {
        toast.error((e as Error).message);
      }
      await refresh();
    },
    [refresh],
  );

  const propose = useCallback(async (req: PlanRequest) => {
    setPending({ req, busy: true });
    try {
      setPending({ req, plan: await api.plan(req), busy: false });
    } catch (e) {
      setPending({ req, error: e instanceof ApiErr ? e : new ApiErr(0, 'internal', (e as Error).message), busy: false });
    }
  }, []);

  const apply = useCallback(async () => {
    const plan = pending?.plan;
    if (!plan) return;
    setPending((p) => p && { ...p, busy: true });
    try {
      const r = await api.apply(plan.id);
      setPending(null);
      const tools = [
        ...new Set(
          [...(pending?.req.refs ?? []), ...(pending?.req.targets ?? [])].map((x) => x.split(':')[0]!).filter((h) => h && h !== 'agents'),
        ),
      ].map((h) => harnessMeta(h).label);
      toast.success(`Applied ${r.steps} change${r.steps === 1 ? '' : 's'}`, {
        description: tools.length ? `Restart ${tools.join(' and ')} to pick this up. ${plan.label}` : plan.label,
        action: { label: 'Undo', onClick: () => void undo(r.backupId) },
        duration: 9000,
      });
    } catch (e) {
      setPending((p) => p && { ...p, busy: false, error: e as ApiErr });
    }
    await refresh();
  }, [pending, refresh, undo]);

  const ui = useMemo<Ui>(
    () => ({
      project,
      setProject,
      view,
      go,
      selected,
      select,
      filters: { query, harnesses, includePlugins },
      setQuery,
      toggleHarness,
      clearHarnesses: () => setHarnesses(new Set()),
      setIncludePlugins,
      paletteOpen,
      setPaletteOpen,
    }),
    [project, setProject, view, go, selected, query, harnesses, includePlugins, toggleHarness, paletteOpen],
  );

  const plans = useMemo<Plans>(() => ({ propose, undo, pending, apply, cancel: () => setPending(null) }), [propose, undo, pending, apply]);

  return (
    <UiCtx.Provider value={ui}>
      <PlanCtx.Provider value={plans}>{children}</PlanCtx.Provider>
    </UiCtx.Provider>
  );
}
