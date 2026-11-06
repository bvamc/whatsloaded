import type {
  Artifact,
  Layer,
  PrecedenceRule,
  ResolvedContext,
  ResolvedItem,
  ScopeKind,
  ShadowEdge,
} from "../types.js";

export interface ResolveOptions {
  provider: string;
  dir: string;
  agentVersion?: string;
  rulesVersion: string;
  rules: PrecedenceRule[];
  unobservable?: { what: string; why: string }[];
}

/**
 * Pure precedence resolver.
 * Maps discovered artifacts and precedence rules into a deterministic ResolvedContext.
 */
export function resolveContext(artifacts: Artifact[], options: ResolveOptions): ResolvedContext {
  const { provider, dir, agentVersion, rulesVersion, rules, unobservable = [] } = options;

  const ruleMap = new Map<string, PrecedenceRule>();
  for (const r of rules) {
    ruleMap.set(r.kind, r);
  }

  // Extract unique layers
  const scopePrecedenceMap: Record<ScopeKind, number> = {
    managed: 100,
    cli: 90,
    local: 80,
    project: 70,
    descendant: 60,
    ancestor: 50,
    user: 40,
    plugin: 30,
    extension: 20,
    builtin: 10,
  };

  const layers: Layer[] = [];
  const layerIds = new Set<string>();

  for (const art of artifacts) {
    const scopeKind = art.scope.kind;
    const layerId = `layer:${scopeKind}:${art.scope.projectRoot ?? ""}`;
    if (!layerIds.has(layerId)) {
      layerIds.add(layerId);
      layers.push({
        id: layerId,
        scope: art.scope,
        label: `${scopeKind} scope`,
        precedence: scopePrecedenceMap[scopeKind] ?? 0,
      });
    }
  }

  layers.sort((a, b) => b.precedence - a.precedence);

  const effective: ResolvedItem[] = [];
  const conditional: ResolvedItem[] = [];
  const shadowed: ShadowEdge[] = [];

  // Group artifacts by kind
  const byKind = new Map<string, Artifact[]>();
  for (const art of artifacts) {
    const group = byKind.get(art.kind) ?? [];
    group.push(art);
    byKind.set(art.kind, group);
  }

  let orderCounter = 1;

  for (const [kind, kindArtifacts] of byKind.entries()) {
    const rule = ruleMap.get(kind);
    const strategy = rule?.strategy ?? "override";
    const scopeOrder = rule?.order ?? ["managed", "local", "project", "user"];

    if (strategy === "override") {
      // Sort by defined precedence order in rule
      const sorted = [...kindArtifacts].sort((a, b) => {
        const idxA = scopeOrder.indexOf(a.scope.kind);
        const idxB = scopeOrder.indexOf(b.scope.kind);
        const orderA = idxA === -1 ? 999 : idxA;
        const orderB = idxB === -1 ? 999 : idxB;
        return orderA - orderB;
      });

      const winnersByKey = new Map<string, Artifact>();

      for (const art of sorted) {
        const winner = winnersByKey.get(art.logicalKey);
        if (winner) {
          shadowed.push({
            winner: winner.id,
            loser: art.id,
            logicalKey: art.logicalKey,
            ruleId: rule?.id ?? `${provider}.${kind}.override`,
            definitionsDiffer: winner.source.path !== art.source.path,
          });
        } else {
          winnersByKey.set(art.logicalKey, art);
          effective.push({
            artifactId: art.id,
            layerId: `layer:${art.scope.kind}:${art.scope.projectRoot ?? ""}`,
            order: orderCounter++,
            ruleId: rule?.id ?? `${provider}.${kind}.override`,
            reason: `active in ${art.scope.kind} scope`,
            confidence: rule?.confidence ?? "documented",
          });
        }
      }
    } else if (strategy === "concat") {
      for (const art of kindArtifacts) {
        const item: ResolvedItem = {
          artifactId: art.id,
          layerId: `layer:${art.scope.kind}:${art.scope.projectRoot ?? ""}`,
          order: orderCounter++,
          ruleId: rule?.id ?? `${provider}.${kind}.concat`,
          reason: `concatenated in ${art.scope.kind} scope`,
          confidence: rule?.confidence ?? "documented",
        };

        const instructionData = art.data as { condition?: unknown } | undefined;
        if (instructionData?.condition) {
          conditional.push(item);
        } else {
          effective.push(item);
        }
      }
    } else if (strategy === "namespaced") {
      for (const art of kindArtifacts) {
        effective.push({
          artifactId: art.id,
          layerId: `layer:${art.scope.kind}:${art.scope.projectRoot ?? ""}`,
          order: orderCounter++,
          ruleId: rule?.id ?? `${provider}.${kind}.namespaced`,
          reason: "namespaced plugin/extension",
          confidence: rule?.confidence ?? "documented",
        });
      }
    }
  }

  // Calculate instruction totals
  let instructionBytes = 0;
  for (const art of artifacts) {
    if (art.kind === "instruction" || art.kind === "rule") {
      instructionBytes += art.source.sizeBytes ?? 0;
    }
  }

  return {
    provider,
    dir,
    agentVersion,
    rulesVersion,
    layers,
    effective,
    conditional,
    shadowed,
    unobservable,
    totals: {
      instructionBytes,
      approxTokens: Math.round(instructionBytes / 4),
    },
  };
}
