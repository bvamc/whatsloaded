/**
 * Public API for extension authors (`whatsloaded/sdk`). Adapters teach whatsloaded a new harness;
 * providers annotate items with knowledge no harness records. Both are plain objects; these
 * helpers only add type checking.
 */
export type { HarnessAdapter } from './adapters/types.js';
export { UnsupportedError } from './adapters/types.js';
export type { Ctx } from './core/context.js';
export type { Discovery, Item, Kind, Level, McpSpec, Problem, Scope } from './core/model.js';
export type { Channel, Provenance, SourceRef } from './core/provenance.js';
export { defineAdapter } from './extensions/loader.js';
export type { OwnedPath, PlanActionName, Provider, ProviderClaim, ProviderHelpers } from './extensions/provider.js';
export type { Change } from './io/changeset.js';

import type { Provider } from './extensions/provider.js';

export function defineProvider<P extends Provider>(provider: P): P {
  return provider;
}
