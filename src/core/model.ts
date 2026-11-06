import type { Provenance } from './provenance.js';

/**
 * Core data model. Every harness adapter translates its native config into these types,
 * so commands (ls, doctor, cp, sync, the TUI) never need to know harness-specific formats.
 */

/** Open string type so third-party adapters can add harnesses without touching core. */
export type HarnessId = string;

export const KINDS = ['mcp', 'skill', 'agent', 'command', 'rule', 'plugin'] as const;
export type Kind = (typeof KINDS)[number];

/**
 * Where an item lives, from the harness's point of view.
 * - managed: enterprise/admin policy files (always read-only)
 * - user:    applies to every project for this user
 * - project: checked into a repo, shared with collaborators
 * - local:   per-project but private to this user (Claude's ~/.claude.json projects[...])
 * - plugin:  contributed by an installed plugin bundle
 * - agent:   embedded inside one agent definition (Kiro agents carry their own mcpServers)
 * - store:   shared canonical store (~/.agents/skills) that harness dirs symlink into
 */
export const LEVELS = ['managed', 'user', 'project', 'local', 'plugin', 'agent', 'store'] as const;
export type Level = (typeof LEVELS)[number];

export interface Scope {
  harness: HarnessId;
  level: Level;
  /** Absolute project root for project/local scopes. */
  project?: string;
  /** Plugin id or agent name for plugin/agent scopes. */
  owner?: string;
}

export type Transport = 'stdio' | 'http' | 'sse';

/** Harness-neutral MCP server definition. */
export interface McpSpec {
  transport: Transport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  /** Tools hidden from the model (Kiro `disabledTools`, Codex `disabled_tools`). */
  disabledTools?: string[];
}

export interface Location {
  /** Config file holding the entry, or the skill/agent/rule path on disk. */
  file: string;
  /** Key path inside `file` for config-entry items (e.g. ['mcpServers', 'github']). */
  path?: string[];
}

export interface Item {
  kind: Kind;
  name: string;
  scope: Scope;
  enabled: boolean;
  location: Location;
  description?: string;
  /** Set when another tool owns this item (a plugin, policy, or a provider claim); mutations require --force. */
  managedBy?: string;
  /** Marketplace or source id (e.g. a plugin marketplace, 'skills-cli:github.com/x/y'). Superseded by `provenance`. */
  origin?: string;
  /** Who installed this and how; see core/provenance.ts. */
  provenance?: Provenance;
  /** For symlinked skills/rules. */
  link?: { target: string; broken: boolean };
  mcp?: McpSpec;
  /** True when whatsloaded parked this item to emulate "disabled" for a harness without a native toggle. */
  parked?: boolean;
  /** Why this entry exists; derived from its scope (see roleOf). */
  role?: Role;
  /** For stdio MCP servers: which executable the command resolves to. Never executed. */
  runtime?: Runtime;
  /** How often it was used in the usage window (only for harnesses that record usage). */
  usage?: UsageCount;
  /** Why it cannot be switched or removed here (e.g. a checked-in instruction file), if so. */
  locked?: string;
  /** For skills: how the skill is meant to run and how big its instructions are. */
  skill?: { userOnly: boolean; bodyChars: number };
  /** For MCP servers: who installed the program it runs, and how to uninstall it. */
  installer?: Installer;
  /** Loaded only when the harness decides it is relevant (e.g. a Kiro power), not every session. */
  onDemand?: string;
  /** Id of the installer package that put it here, when a provider knows (see Package). */
  package?: string;
  /** For MCP servers measured with `whatsloaded tools --measure`: what their tool definitions cost. */
  tools?: ToolsMeasure;
}

/** Who installed an MCP server's program, what it is, and how to remove it. */
export interface Installer {
  by: string;
  uninstall?: string;
  /** Started fresh on every launch (npx, uvx, docker, remote URL): nothing stays installed. */
  onDemand?: boolean;
  /** What the program is, in plain words, e.g. "connects to https://host/mcp". */
  about?: string;
}

export interface ToolsMeasure {
  count: number;
  /** Rough tokens of the tool names, descriptions and input schemas the model receives. */
  tokens: number;
  measuredAt: string;
  names: string[];
}

export interface UsageCount {
  count: number;
  /** Epoch ms of the last use. */
  last?: number;
}

/** What a harness recorded as used since `since`; items missing from `byRef` were not used. */
export interface UsageReport {
  since: number;
  /** Number of sessions the report covers. */
  sessions: number;
  byRef: Record<string, UsageCount>;
}

/**
 * What a config entry *is*, independent of harness:
 * - owned:         you maintain it (user / project / local scope, or the shared store)
 * - bundled:       a plugin or extension ships it; edit by toggling the plugin
 * - agent-profile: an agent definition carries its own launch settings; only used while that agent runs
 * - policy:        enterprise / managed configuration
 */
export type Role = 'owned' | 'bundled' | 'agent-profile' | 'policy';

export function roleOf(level: Level): Role {
  if (level === 'plugin') return 'bundled';
  if (level === 'agent') return 'agent-profile';
  if (level === 'managed') return 'policy';
  return 'owned';
}

export interface Runtime {
  /** The command as configured. */
  command: string;
  /** False when it is not an absolute path that exists and is not on PATH. */
  found: boolean;
  /** Where it was found (PATH entry or absolute path). */
  resolved?: string;
  /** `resolved` with symlinks followed: the actual installed file. */
  realpath?: string;
  /** Set when the command contains variables whatsloaded cannot expand, so `found` is unknown. */
  unresolved?: boolean;
}

/**
 * Usage, not configuration: an agent that refers to an MCP server's tools. A reference never
 * starts anything by itself; it needs a configuration the agent can see.
 */
export interface Reference {
  /** MCP server name as configured, or the raw key when it could not be resolved. */
  server: string;
  /** True when `server` matched a known configuration name. */
  resolved: boolean;
  /** Ref of the agent item that uses it. */
  by: string;
  harness: HarnessId;
  /** Tool names referenced, or ['*'] for the whole server. */
  tools: string[];
  /** Whether the agent carries its own entry for this server. */
  ownEntry: boolean;
  /** Whether the agent also loads the harness-wide configuration (undefined = not declared). */
  includesGlobal?: boolean;
  /** Explanation when the reference cannot match, e.g. the server exists only under a different tool prefix. */
  hint?: string;
  file: string;
}

/** Something an installer put on the machine as one unit (e.g. an agent package): many items across tools. */
export interface Package {
  /** `<provider>:<id>`, unique across providers. */
  id: string;
  name: string;
  /** The installer, e.g. a provider's label. */
  by: string;
  version?: string;
  installedAt?: string;
  /** The command that installed it, when known. */
  installedWith?: string;
  uninstall?: string;
  description?: string;
  /** Refs of the items it installed that are on this machine. */
  members: string[];
}

/** A skill or instruction file that names an MCP server in its text (it likely relies on it). */
export interface Mention {
  server: string;
  /** Ref of the skill or rule. */
  by: string;
  harness: HarnessId;
  /** The server's known tool names that appear in the text. */
  tools: string[];
}

export interface Problem {
  severity: 'error' | 'warn' | 'info';
  code: string;
  message: string;
  file?: string;
  refs?: string[];
  /** What the problem is about, so interfaces can offer a fix without parsing `message`. */
  subject?: { kind: Kind; name: string; harness?: HarnessId };
}

export interface Discovery {
  items: Item[];
  problems: Problem[];
  /** Optional: agents' references to MCP servers they use. */
  references?: Reference[];
}

export function scopeLabel(s: Scope): string {
  return s.owner ? `${s.level}@${s.owner}` : s.level;
}

/** The name part of a ref. Names may contain '/', e.g. `npm:@playwright/mcp`. */
export const refName = (r: string): string => r.split('/').slice(2).join('/');

/** Stable, human-typeable reference: `<harness>:<level>[@owner]/<kind>/<name>`. */
export function ref(i: Pick<Item, 'kind' | 'name' | 'scope'>): string {
  return `${i.scope.harness}:${scopeLabel(i.scope)}/${i.kind}/${i.name}`;
}
