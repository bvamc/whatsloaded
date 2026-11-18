import type {
  ApiError,
  CatalogKind,
  CatalogPageDTO,
  CatalogSourceDTO,
  Job,
  JobPlan,
  PlanDTO,
  PlanRequest,
  StateDTO,
} from '../../src/server/types';

export type * from '../../src/server/types';

export class ApiErr extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiError['code'],
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const init: RequestInit =
    body === undefined
      ? { headers: { Accept: 'application/json' } }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const res = await fetch(path, init);
  const json = (await res.json().catch(() => ({}))) as Partial<ApiError>;
  if (!res.ok) throw new ApiErr(res.status, json.code ?? 'internal', json.error ?? res.statusText);
  return json as T;
}

/** The project included in every request; none means global (your settings everywhere). */
let currentProject: string | undefined = new URLSearchParams(location.search).get('project') ?? undefined;
export const getProject = () => currentProject;

/** Switch project and keep it in the URL, so a refresh or a shared link shows the same view. */
export function setProjectParam(p?: string): void {
  currentProject = p;
  const u = new URL(location.href);
  if (p) u.searchParams.set('project', p);
  else u.searchParams.delete('project');
  history.replaceState(null, '', u);
}

export interface KnownProject {
  path: string;
  seenBy: string[];
  last?: number;
}

export const api = {
  state: () => call<StateDTO>(`/api/state${currentProject ? `?project=${encodeURIComponent(currentProject)}` : ''}`),
  projects: () => call<{ projects: KnownProject[] }>('/api/projects'),
  plan: (r: PlanRequest) => call<PlanDTO>('/api/plan', { ...r, project: currentProject }),
  apply: (id: string) => call<{ backupId: string; steps: number }>('/api/apply', { id }),
  undo: (id?: string) => call<{ id: string; label: string }>('/api/undo', id ? { id } : {}),
  measurePlan: (refs: string[]) => call<MeasurePlan>('/api/measure/plan', { refs, project: currentProject }),
  measureRun: (id: string) => call<{ results: MeasureResult[] }>('/api/measure/run', { id, project: currentProject }),
  catalogSources: () => call<{ sources: CatalogSourceDTO[] }>('/api/catalog/sources'),
  catalogPage: (source: string, q: string, kind?: CatalogKind, cursor?: string, limit = 50) => {
    const p = new URLSearchParams({ source, q, limit: String(limit) });
    if (kind) p.set('kind', kind);
    if (cursor) p.set('cursor', cursor);
    return call<{ page: CatalogPageDTO }>(`/api/catalog?${p}`);
  },
  installPlan: (entry: string, action: 'install' | 'uninstall', tools?: string[]) =>
    call<JobPlan>('/api/install/plan', { entry, action, tools }),
  installRun: (id: string) => call<Job>('/api/install/run', { id }),
  job: (id: string) => call<Job>(`/api/job?id=${encodeURIComponent(id)}`),
};

export interface Launch {
  ref: string;
  commandLine?: string;
  url?: string;
  cwd?: string;
  envKeys: string[];
  warnings: string[];
}

export interface MeasurePlan {
  id: string;
  launches: Launch[];
  refused: { ref: string; reason: string }[];
}

export type MeasureResult = { ref: string } & (
  | { ok: true; measure: { count: number; tokens: number } }
  | { ok: false; code: string; message: string }
);
