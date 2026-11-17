/** Wire types shared by the local API server and the web UI (type-only imports on both sides). */
import type {
  Installer,
  Kind,
  Level,
  McpSpec,
  Mention,
  Package,
  Problem,
  Reference,
  Role,
  Runtime,
  ToolsMeasure,
  UsageCount,
} from '../core/model.js';

export type { CatalogEntry, CatalogKind, InstallMethod, Job, JobPlan, JobStep, Trust } from '../catalog/wire.js';
export type { Installer, Kind, Level, McpSpec, Mention, Package, Problem, Reference, Role, Runtime, ToolsMeasure, UsageCount };

export interface CatalogSourceDTO {
  id: string;
  label: string;
  description: string;
  kinds: import('../catalog/wire.js').CatalogKind[];
  access: 'local' | 'network' | 'command';
  url?: string;
}

export interface CatalogPageDTO {
  note?: string;
  entries: (import('../catalog/wire.js').CatalogEntry & { installedIn: string[] })[];
  next?: string;
  total?: number;
}

export interface ItemDTO {
  ref: string;
  kind: Kind;
  name: string;
  harness: string;
  level: Level;
  owner?: string;
  enabled: boolean;
  parked: boolean;
  managedBy?: string;
  origin?: string;
  description?: string;
  link?: { target: string; broken: boolean };
  /** Display path (with ~) and key path inside it. */
  location: { file: string; path?: string[] };
  /** Always redacted: env/header values never leave the server. */
  mcp?: McpSpec;
  /** owned (yours) / bundled (from a plugin) / agent-profile / policy. */
  role: Role;
  /** Who installed it, when known. */
  installedBy?: string;
  /** For stdio MCP servers: the executable the command resolves to (paths shown with ~). */
  runtime?: Runtime;
  /** Uses in the usage window; absent when the tool does not record usage. */
  usage?: UsageCount;
  /** Why it cannot be switched here, if so. */
  locked?: string;
  /** Where it came from, when known (repo/URL, install time). */
  source?: { repo?: string; url?: string; path?: string };
  installedAt?: string;
  updatedAt?: string;
  /** For skills: whether only you can start it, and the size of its instructions. */
  skill?: { userOnly: boolean; bodyTokens: number };
  /** For MCP servers: who installed the program and how to uninstall it. */
  installer?: Installer;
  onDemand?: string;
  /** Measured cost of the server's tool definitions, if measured. */
  tools?: ToolsMeasure;
  /** Id of the installer package that put it here. */
  package?: string;
  /** For your own MCP configurations: index of this entry's variant among your same-named entries (0 = most common). */
  variant?: number;
  variants?: number;
}

export interface AdapterDTO {
  id: string;
  label: string;
  detected: boolean;
  writable: Partial<Record<Kind, Level[]>>;
}

export interface BackupDTO {
  id: string;
  createdAt: string;
  label: string;
  steps: number;
  restoredAt?: string;
}

export interface LoadSourceDTO {
  id: string;
  kind: 'you' | 'project' | 'plugin' | 'policy';
  label: string;
  by?: string;
  /** Ref of the plugin whose switch controls this source. */
  pluginRef?: string;
  enabled: boolean;
  refs: string[];
  tokens: number;
  used?: number;
}

export interface ToolLoadDTO {
  harness: string;
  label: string;
  sources: LoadSourceDTO[];
  loaded: Partial<Record<Kind, number>>;
  contextTokens: number;
  unmeasuredServers: number;
  toolTokens: number;
  duplicates: { name: string; count: number }[];
  agentsAre: 'subagents' | 'modes';
  agents: { ref: string; name: string; by?: string; servers: string[] }[];
  tracked: boolean;
  used: Partial<Record<Kind, number>>;
  trim: { plugins: string[]; items: string[]; tokens: number; servers: number };
}

export interface StateDTO {
  home: string;
  project?: string;
  adapters: AdapterDTO[];
  items: ItemDTO[];
  /** Agents' references to MCP servers (usage, not configuration). */
  references: Reference[];
  /** Skills and instruction files that name an MCP server in their text. */
  mentions: Mention[];
  /** Installer packages and the items each one installed. */
  packages: Package[];
  /** Per tool: what it loads in this project, grouped by the switch that controls it. */
  tools: ToolLoadDTO[];
  /** Saved profiles (named sets of what to keep). */
  profiles: ProfileDTO[];
  /** Usage window: how far back "used" looks, and which tools report usage. */
  usage?: { days: number; tracked: { harness: string; sessions: number }[] };
  problems: Problem[];
  backups: BackupDTO[];
}

export type PlanAction =
  | 'enable'
  | 'disable'
  | 'remove'
  | 'copy'
  | 'move'
  | 'sync'
  | 'adopt'
  | 'add'
  | 'server-off'
  | 'server-on'
  | 'server-remove'
  | 'profile-save'
  | 'profile-apply'
  | 'profile-delete';

export interface PlanRequest {
  action: PlanAction;
  refs: string[];
  /** `harness:level` targets for copy/move. */
  targets?: string[];
  overwrite?: boolean;
  force?: boolean;
  /** For `add`: the new MCP server's name and definition. For profile actions: the profile name. */
  name?: string;
  spec?: McpSpec;
  /** For profile actions: which tool. */
  harness?: string;
  /** For `profile-save`: keep what loads now, or only what was used in the usage window. */
  from?: 'current' | 'used';
  /** For server actions: plugin refs to switch as well (they bring other things too). */
  plugins?: string[];
}

export interface ProfileDTO {
  name: string;
  description?: string;
  keep: { mcp: string[]; skill: string[]; agent: string[]; plugin: string[] };
  createdAt: string;
}

export interface PlanDTO {
  id: string;
  label: string;
  warnings: string[];
  changes: { describe: string; diff?: string; error?: string }[];
  applicable: boolean;
}

export interface ApiError {
  error: string;
  code: 'managed' | 'unsupported' | 'not-found' | 'bad-request' | 'expired' | 'busy' | 'internal';
}
