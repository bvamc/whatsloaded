import type { Env } from "./env.js";
import type { Artifact, ProviderId, ResolvedContext } from "./types.js";

export interface Detection {
  installed: boolean;
  version?: string;
  configRoots: string[];
}

export interface ScopeQuery {
  dir: string;
}

export interface Provider {
  id: ProviderId;
  displayName: string;
  detect(env: Env): Promise<Detection>;
  discover(env: Env, scope: ScopeQuery): Promise<Artifact[]>;
  resolve(env: Env, dir: string, artifacts: Artifact[]): ResolvedContext;
  rulesVersion: string;
  appliesToVersions?: string;
}

export class ProviderRegistry {
  private providers = new Map<ProviderId, Provider>();

  register(provider: Provider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: ProviderId): Provider | undefined {
    return this.providers.get(id);
  }

  list(): Provider[] {
    return Array.from(this.providers.values());
  }
}
