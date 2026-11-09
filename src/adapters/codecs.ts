/**
 * MCP entry codecs: native config object <-> canonical McpSpec.
 *
 * `encode` takes the existing native entry (if any) and carries over every field the
 * canonical spec doesn't model (Kiro `autoApprove`, Codex `startup_timeout_sec`, ...), so
 * syncing a server's command/args never silently drops harness-specific tuning.
 */
import type { McpSpec, Transport } from '../core/model.js';
import { isRecord, strArray, strRecord } from '../io/fsx.js';

export interface Decoded {
  spec: McpSpec;
  enabled: boolean;
}

export interface McpCodec {
  decode(raw: unknown): Decoded | undefined;
  encode(spec: McpSpec, enabled: boolean, existing?: unknown): Record<string, unknown>;
}

function compact(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

function merge(fresh: Record<string, unknown>, existing: unknown, owned: string[]): Record<string, unknown> {
  const extras = isRecord(existing) ? Object.fromEntries(Object.entries(existing).filter(([k]) => !owned.includes(k))) : {};
  return compact({ ...fresh, ...extras });
}

function transportOf(type: unknown, url: unknown, command: unknown): Transport {
  if (type === 'sse') return 'sse';
  if (type === 'http' || type === 'streamable-http' || type === 'remote') return 'http';
  return typeof url === 'string' && typeof command !== 'string' ? 'http' : 'stdio';
}

const nonEmpty = <T extends object>(v: T | undefined) => (v && Object.keys(v).length ? v : undefined);

export const claudeCodec: McpCodec = {
  decode(raw) {
    if (!isRecord(raw)) return undefined;
    return {
      enabled: true,
      spec: compact({
        transport: transportOf(raw.type, raw.url, raw.command),
        command: typeof raw.command === 'string' ? raw.command : undefined,
        args: strArray(raw.args),
        env: nonEmpty(strRecord(raw.env)),
        url: typeof raw.url === 'string' ? raw.url : undefined,
        headers: nonEmpty(strRecord(raw.headers)),
      }) as unknown as McpSpec,
    };
  },
  encode(spec, _enabled, existing) {
    const fresh =
      spec.transport === 'stdio'
        ? { type: 'stdio', command: spec.command, args: spec.args ?? [], env: spec.env }
        : { type: spec.transport, url: spec.url, headers: spec.headers };
    return merge(fresh, existing, ['type', 'command', 'args', 'env', 'url', 'headers']);
  },
};

export const kiroCodec: McpCodec = {
  decode(raw) {
    if (!isRecord(raw)) return undefined;
    return {
      enabled: raw.disabled !== true,
      spec: compact({
        transport: transportOf(raw.type, raw.url, raw.command),
        command: typeof raw.command === 'string' ? raw.command : undefined,
        args: strArray(raw.args),
        env: nonEmpty(strRecord(raw.env)),
        url: typeof raw.url === 'string' ? raw.url : undefined,
        headers: nonEmpty(strRecord(raw.headers)),
        disabledTools: strArray(raw.disabledTools),
      }) as unknown as McpSpec,
    };
  },
  encode(spec, enabled, existing) {
    const fresh =
      spec.transport === 'stdio'
        ? { command: spec.command, args: spec.args ?? [], env: spec.env }
        : { type: spec.transport, url: spec.url, headers: spec.headers };
    return merge({ ...fresh, disabled: enabled ? undefined : true, disabledTools: spec.disabledTools }, existing, [
      'type',
      'command',
      'args',
      'env',
      'url',
      'headers',
      'disabled',
      'disabledTools',
    ]);
  },
};

export const codexCodec: McpCodec = {
  decode(raw) {
    if (!isRecord(raw)) return undefined;
    return {
      enabled: raw.enabled !== false,
      spec: compact({
        transport: typeof raw.url === 'string' ? 'http' : 'stdio',
        command: typeof raw.command === 'string' ? raw.command : undefined,
        args: strArray(raw.args),
        env: nonEmpty(strRecord(raw.env)),
        url: typeof raw.url === 'string' ? raw.url : undefined,
        headers: nonEmpty(strRecord(raw.http_headers)),
        disabledTools: strArray(raw.disabled_tools),
      }) as unknown as McpSpec,
    };
  },
  encode(spec, enabled, existing) {
    const fresh =
      spec.transport === 'stdio'
        ? { command: spec.command, args: spec.args, env: spec.env }
        : { url: spec.url, http_headers: spec.headers };
    return merge({ ...fresh, enabled: enabled ? undefined : false, disabled_tools: spec.disabledTools }, existing, [
      'command',
      'args',
      'env',
      'url',
      'http_headers',
      'enabled',
      'disabled_tools',
    ]);
  },
};

export const opencodeCodec: McpCodec = {
  decode(raw) {
    if (!isRecord(raw)) return undefined;
    const cmd = strArray(raw.command);
    return {
      enabled: raw.enabled !== false,
      spec: compact({
        transport: raw.type === 'remote' ? 'http' : 'stdio',
        command: cmd?.[0],
        args: cmd && cmd.length > 1 ? cmd.slice(1) : undefined,
        env: nonEmpty(strRecord(raw.environment)),
        url: typeof raw.url === 'string' ? raw.url : undefined,
        headers: nonEmpty(strRecord(raw.headers)),
      }) as unknown as McpSpec,
    };
  },
  encode(spec, enabled, existing) {
    const fresh =
      spec.transport === 'stdio'
        ? { type: 'local', command: [spec.command ?? '', ...(spec.args ?? [])], environment: spec.env }
        : { type: 'remote', url: spec.url, headers: spec.headers };
    return merge({ ...fresh, enabled: enabled ? undefined : false }, existing, [
      'type',
      'command',
      'environment',
      'url',
      'headers',
      'enabled',
    ]);
  },
};

/** Fields a codec cannot represent, reported as warnings when copying across harnesses. */
export function lossyFields(spec: McpSpec, target: 'claude' | 'kiro' | 'codex' | 'opencode'): string[] {
  const lost: string[] = [];
  if (spec.disabledTools?.length && (target === 'claude' || target === 'opencode')) lost.push('disabledTools');
  if (spec.transport === 'sse' && (target === 'codex' || target === 'opencode')) lost.push('sse transport (written as http)');
  return lost;
}
