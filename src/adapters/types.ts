import type { Ctx } from '../core/context.js';
import type { Discovery, HarnessId, Item, Kind, Level, McpSpec, UsageReport } from '../core/model.js';
import type { Change } from '../io/changeset.js';

/**
 * The extension point. One adapter per harness (Claude Code, Kiro, Codex, ...).
 *
 * Adapters are pure planners: `discover` reads, and every mutating method returns Changes
 * without touching disk. The engine previews, confirms, backs up and applies them, so a
 * new adapter gets dry-run, diff, backup and undo for free.
 *
 * Third-party adapters: drop an ES module exporting `default` (a HarnessAdapter) into
 * ~/.whatsloaded/adapters/ and it is loaded at startup.
 */
export interface HarnessAdapter {
  readonly id: HarnessId;
  readonly label: string;
  /**
   * How this harness uses agent definitions: 'subagents' are all offered to the model at once
   * (Claude), 'modes' are alternatives where only the chosen one runs (Kiro). Default: subagents.
   */
  readonly agentsAre?: 'subagents' | 'modes';
  /**
   * Optional: what the user actually used since `since` (epoch ms), read from the harness's own
   * local records. Must read names only, never conversation content.
   */
  usage?(ctx: Ctx, items: Item[], since: number): UsageReport;
  /** Is this harness installed / configured on this machine? */
  detect(ctx: Ctx): boolean;
  discover(ctx: Ctx): Discovery;
  /** Levels this adapter can create items of `kind` at. Empty = unsupported. */
  writable(kind: Kind, ctx: Ctx): Level[];
  setEnabled(item: Item, enabled: boolean, ctx: Ctx): Change[];
  remove(item: Item, ctx: Ctx): Change[];
  /**
   * Create or overwrite an MCP server entry. When `existing` is passed (sync/overwrite),
   * harness-specific fields the canonical spec doesn't model (Kiro autoApprove, Codex
   * timeouts, ...) should be preserved.
   */
  putMcp(name: string, spec: McpSpec, level: Level, ctx: Ctx, opts?: { enabled?: boolean; existing?: Item }): Change[];
  /** Install a skill at `level` by symlinking to `source` (a directory containing SKILL.md). */
  linkSkill(name: string, source: string, level: Level, ctx: Ctx): Change[];
}

export class UnsupportedError extends Error {}
