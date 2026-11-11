/**
 * Providers: optional, user-installed extensions that know things no harness records, such
 * as an organisation's own installer. Drop an ES module that default-exports a Provider into
 * ~/.whatsloaded/providers/ and it is loaded at startup (skip with --no-extensions).
 *
 * Providers are pure and read-only: they receive items and helper functions and return
 * claims. They cannot write files through this interface.
 */
import type { Ctx } from '../core/context.js';
import type { Item, Problem } from '../core/model.js';
import type { SourceRef } from '../core/provenance.js';
import type { JsonRead } from '../io/fsx.js';

export type PlanActionName = 'enable' | 'disable' | 'remove' | 'sync';

export interface ProviderClaim {
  /** "Installed by" label, e.g. "Acme Sync". */
  by: string;
  /** The owner reverts or rewrites edits; changing the item requires --force. */
  enforces?: boolean;
  /** Warning attached to plans that touch the item. */
  note?: string;
  /** Display description override (e.g. to strip an installer banner). */
  description?: string;
  source?: SourceRef;
  version?: string;
  installedAt?: string;
}

/** A key path inside a config file that another tool owns (enforced from v0.3). */
export interface OwnedPath {
  file: string;
  path: (string | number)[];
  owner: string;
  reason?: string;
}

/** Passed to providers, because modules in ~/.whatsloaded cannot import whatsloaded itself. */
export interface ProviderHelpers {
  readonly ctx: Readonly<Ctx>;
  readJson(p: string): JsonRead;
  readText(p: string): string | null;
  readFrontmatter(p: string): Record<string, unknown>;
  exists(p: string): boolean;
  listEntries(dir: string): string[];
  join(...parts: string[]): string;
  /** Last-modified time of a path (ISO), or undefined when it does not exist. */
  modifiedAt(p: string): string | undefined;
}

/** A unit an installer manages as a whole, e.g. an agent package that adds agents, plugins and servers to several tools. */
export interface ProviderPackage {
  id: string;
  name: string;
  version?: string;
  installedAt?: string;
  installedWith?: string;
  uninstall?: string;
  description?: string;
  /** Whether this package installed `item`. Called for every discovered item. */
  contains(item: Readonly<Item>): boolean;
}

export interface ReadonlyInventory {
  readonly items: readonly Readonly<Item>[];
}

export interface Provider {
  readonly id: string;
  readonly label: string;
  readonly apiVersion: 1;
  /** Is the thing this provider knows about present on this machine? Default: yes. */
  detect?(h: ProviderHelpers): boolean;
  claim?(item: Readonly<Item>, h: ProviderHelpers): ProviderClaim | undefined;
  /**
   * Who installed an MCP server's program (e.g. an internal package manager), how to uninstall it,
   * and optionally what it is (`about`) and a description when the configuration has none.
   */
  installer?(
    item: Readonly<Item>,
    h: ProviderHelpers,
  ): { by: string; uninstall?: string; about?: string; description?: string } | undefined;
  /** Packages this installer put on the machine, and which items belong to each. */
  packages?(h: ProviderHelpers): ProviderPackage[];
  ownedPaths?(h: ProviderHelpers): OwnedPath[];
  planWarnings?(item: Readonly<Item>, action: PlanActionName, h: ProviderHelpers): string[];
  diagnose?(inv: ReadonlyInventory, h: ProviderHelpers): Problem[];
}
