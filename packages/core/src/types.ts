export type ProviderId =
  | "claude-code"
  | "codex"
  | "gemini-cli"
  | "cursor"
  | "agents-standard"
  | (string & {});

export type Confidence = "documented" | "verified" | "inferred" | "unobservable";

export type ScopeKind =
  | "managed"
  | "cli"
  | "local"
  | "project"
  | "ancestor"
  | "descendant"
  | "user"
  | "plugin"
  | "extension"
  | "builtin";

export type ArtifactKind =
  | "instruction"
  | "rule"
  | "skill"
  | "subagent"
  | "command"
  | "mcp-server"
  | "hook"
  | "setting"
  | "plugin"
  | "extension";

export interface SourceRef {
  path: string;
  linkPath?: string;
  range?: { startLine: number; endLine: number };
  sha256?: string;
  sizeBytes?: number;
  mtimeMs?: number;
}

export interface ImportEdge {
  raw: string;
  resolvedPath?: string;
  ok: boolean;
  depth: number;
  bytes?: number;
}

export interface InstructionData {
  bytes: number;
  approxTokens: number;
  imports: ImportEdge[];
  condition?: {
    type: "glob" | "lazy-subdir" | "agent-requested" | "manual";
    value?: string;
  };
}

export interface SkillData {
  declaredName?: string;
  description?: string;
  dirName: string;
  files?: number;
  contentHash?: string;
  flags?: string[];
}

export interface Secretish {
  redacted: true;
  length: number;
  ref?: string;
}

export interface McpServerDef {
  name: string;
  transport: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  env?: Record<string, Secretish | string>;
  headers?: Record<string, Secretish | string>;
  enabled?: boolean;
  approval?: "approved" | "pending" | "denied" | "n/a";
  defHash?: string;
}

export interface Finding {
  id: string;
  severity: "error" | "warn" | "info";
  provider?: ProviderId;
  artifactIds?: string[];
  location?: SourceRef;
  message: string;
  explanation?: string;
  fix?: { text: string; command?: string };
  docs?: string;
}

export interface Artifact {
  id: string;
  provider: ProviderId;
  consumers: ProviderId[];
  kind: ArtifactKind;
  logicalKey: string;
  name: string;
  scope: {
    kind: ScopeKind;
    depth?: number;
    projectRoot?: string;
    owner?: string;
  };
  source: SourceRef;
  data: InstructionData | SkillData | McpServerDef | unknown;
  findings: Finding[];
}

export interface Layer {
  id: string;
  scope: Artifact["scope"];
  label: string;
  precedence: number;
}

export interface ResolvedItem {
  artifactId: string;
  layerId: string;
  order: number;
  ruleId: string;
  reason: string;
  confidence: Confidence;
}

export interface ShadowEdge {
  winner: string;
  loser: string;
  logicalKey: string;
  ruleId: string;
  definitionsDiffer: boolean;
}

export interface ResolvedContext {
  provider: ProviderId;
  dir: string;
  agentVersion?: string;
  rulesVersion: string;
  layers: Layer[];
  effective: ResolvedItem[];
  conditional: ResolvedItem[];
  shadowed: ShadowEdge[];
  unobservable: { what: string; why: string }[];
  totals: { instructionBytes: number; approxTokens: number };
}

export type StrategyKind = "override" | "concat" | "merge" | "namespaced" | "conditional";

export interface PrecedenceRule {
  id: string;
  kind: ArtifactKind;
  strategy: StrategyKind;
  order: ScopeKind[];
  confidence: Confidence;
  docUrl: string;
  note?: string;
}
