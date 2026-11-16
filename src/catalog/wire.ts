/**
 * Catalog and install-job shapes shared by the server and the web UI. Pure data: no Node imports,
 * so the browser build can use these types.
 */
import type { HarnessId, McpSpec } from '../core/model.js';

export type CatalogKind = 'mcp' | 'skill' | 'plugin' | 'package';
export const CATALOG_KINDS: CatalogKind[] = ['package', 'plugin', 'mcp', 'skill'];

/**
 * How much the source vouches for an entry, in its own terms mapped onto one scale:
 * official (made or curated by the source's owner), verified (reviewed or publisher-verified),
 * community (listed, not reviewed), unreviewed (the source says it has not reviewed it).
 */
export type Trust = 'official' | 'verified' | 'community' | 'unreviewed';
export const TRUST_ORDER: Trust[] = ['official', 'verified', 'community', 'unreviewed'];

/** One step of an install, as shown before anything runs. */
export type InstallMethod =
  | {
      type: 'command';
      /** The tool this command installs into, when it is specific to one. */
      harness?: HarnessId;
      /** What it does, e.g. "Install with Claude Code's plugin manager". */
      label: string;
      /** A `{tools}` word expands to the chosen tools' names in this installer's terms (see toolArg). */
      argv: string[];
      uninstall?: string[];
      /** For installers that take a list of tools: whatsloaded tool id → the installer's name for it. */
      toolArg?: Record<HarnessId, string>;
      /** Extra environment for the command, shown with it (e.g. turning off an installer's telemetry). */
      env?: Record<string, string>;
    }
  | {
      /** whatsloaded adds this MCP server to the tools you pick. */
      type: 'mcp';
      spec: McpSpec;
      /** e.g. "Hosted by github.com" or "Run with npx (Node.js)". */
      label: string;
      /** Settings the server needs, e.g. an API key; values are asked for at install time. */
      inputs?: { name: string; description?: string; required: boolean; secret: boolean; where: 'env' | 'header' }[];
    };

export interface CatalogEntry {
  /** `<source>:<kind>:<name>`, stable across reads. */
  id: string;
  source: string;
  kind: CatalogKind;
  name: string;
  /** The name an install command takes, when it differs from `name`. */
  installName?: string;
  description?: string;
  publisher?: string;
  version?: string;
  trust: Trust;
  /** Homepage or repository (http/https only). */
  url?: string;
  /** Tools it can be installed into; empty = any tool that takes this kind. */
  tools: HarnessId[];
  /** Ways to install it, best first. */
  install: InstallMethod[];
  /** Plain facts for the preview, e.g. ["Needs", "an API key"]. */
  facts?: [string, string][];
  /** What you get, when the source says (e.g. a plugin's skills and servers). */
  contents?: { kind: string; names: string[] }[];
}

export type JobAction = 'install' | 'uninstall';

export interface JobStep {
  label: string;
  /** The exact command that runs. */
  text: string;
  argv: string[];
  env?: Record<string, string>;
  status: 'waiting' | 'running' | 'done' | 'failed' | 'skipped';
  code?: number | null;
  output?: string;
  ms?: number;
}

export interface JobPlan {
  id: string;
  action: JobAction;
  entry: Pick<CatalogEntry, 'id' | 'name' | 'kind' | 'source' | 'trust' | 'tools'>;
  steps: Pick<JobStep, 'label' | 'text'>[];
  /** Tools the person picked, for installers that take a list of tools. */
  chosen?: string[];
  /** Tools that already have it, before anything runs. */
  before: string[];
  warnings: string[];
}

export interface Job extends Omit<JobPlan, 'steps'> {
  status: 'running' | 'done' | 'failed';
  steps: JobStep[];
  startedAt: number;
  endedAt?: number;
  /** After it ran: tools that have it now. */
  after?: string[];
}
