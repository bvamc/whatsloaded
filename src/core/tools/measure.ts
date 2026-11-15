/**
 * Measure what an MCP server's tool definitions cost in context, by starting it once and
 * asking for its tool list. This RUNS the configured command (or contacts the configured URL),
 * so it only ever happens on an explicit request, after showing exactly what will run.
 *
 * The only module that imports the MCP SDK, so a future SDK change touches one file.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Ctx } from '../context.js';
import type { Item, ToolsMeasure } from '../model.js';
import { ref } from '../model.js';

export interface Launch {
  ref: string;
  /** What will run, as you would type it. Env values are never included. */
  commandLine?: string;
  url?: string;
  cwd?: string;
  envKeys: string[];
  warnings: string[];
}

export type MeasureOutcome =
  | { ok: true; measure: ToolsMeasure }
  | { ok: false; code: 'refused' | 'timeout' | 'failed' | 'auth-required'; message: string };

/** Cache identity: what decides the tool list, without any secret values. */
export function measureKey(i: Item): string {
  const s = i.mcp!;
  const id = {
    transport: s.transport,
    command: s.command ?? null,
    args: s.args ?? [],
    url: s.url ?? null,
    env: Object.keys(s.env ?? {}).sort(),
    headers: Object.keys(s.headers ?? {}).sort(),
  };
  return createHash('sha256').update(JSON.stringify(id)).digest('hex').slice(0, 32);
}

const cacheDir = (ctx: Ctx) => join(ctx.dataDir, 'cache', 'tools');

export function cachedMeasure(ctx: Ctx, i: Item): ToolsMeasure | undefined {
  if (i.kind !== 'mcp' || !i.mcp) return undefined;
  try {
    const v = JSON.parse(readFileSync(join(cacheDir(ctx), `${measureKey(i)}.json`), 'utf8')) as ToolsMeasure & { schema?: number };
    return v.schema === 1 ? { count: v.count, tokens: v.tokens, measuredAt: v.measuredAt, names: v.names } : undefined;
  } catch {
    return undefined;
  }
}

function saveMeasure(ctx: Ctx, i: Item, m: ToolsMeasure): void {
  mkdirSync(cacheDir(ctx), { recursive: true });
  const f = join(cacheDir(ctx), `${measureKey(i)}.json`);
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ schema: 1, ...m }), { mode: 0o600 });
  renameSync(tmp, f);
}

const quote = (a: string) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);

/** Describe what measuring would do, or why it is refused, without doing it. */
export function describeLaunch(i: Item, ctx: Ctx): Launch | { ref: string; refused: string } {
  const r = ref(i);
  const s = i.mcp;
  if (i.kind !== 'mcp' || !s) return { ref: r, refused: 'not an MCP server' };
  const warnings: string[] = [];
  if (i.scope.level === 'project') warnings.push('defined by the project repo: only run it if you trust this repo');
  if (s.transport === 'stdio') {
    if (!s.command) return { ref: r, refused: 'no command configured' };
    if (i.runtime?.unresolved) return { ref: r, refused: 'the command uses variables whatsloaded cannot expand' };
    if (i.runtime && !i.runtime.found) return { ref: r, refused: `\`${s.command}\` is not installed` };
    if ([s.command, ...(s.args ?? [])].some((a) => /\$\{input:/.test(a))) return { ref: r, refused: 'needs interactive input' };
    if ((s.args ?? []).some((a) => /@latest\b/.test(a)) || s.command === 'npx' || s.command === 'uvx') {
      warnings.push('downloads and runs a package; the version may change between runs');
    }
    return {
      ref: r,
      commandLine: [s.command, ...(s.args ?? [])].map(quote).join(' '),
      cwd: ctx.project ?? ctx.home,
      envKeys: Object.keys(s.env ?? {}),
      warnings,
    };
  }
  if (!s.url || !/^https?:\/\//.test(s.url)) return { ref: r, refused: 'no http(s) URL configured' };
  warnings.push(`connects to ${new URL(s.url).host}${s.headers ? ' with the configured headers' : ''}`);
  return { ref: r, url: s.url, envKeys: Object.keys(s.headers ?? {}), warnings };
}

async function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          onTimeout();
          reject(Object.assign(new Error(`no answer within ${ms / 1000}s`), { code: 'timeout' }));
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Start the server, list its tools, stop it. Caches the result (names and sizes only). */
export async function measure(i: Item, ctx: Ctx, opts: { timeoutMs?: number; version?: string } = {}): Promise<MeasureOutcome> {
  const launch = describeLaunch(i, ctx);
  if ('refused' in launch) return { ok: false, code: 'refused', message: launch.refused };
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const s = i.mcp!;
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const client = new Client({ name: 'whatsloaded', version: opts.version ?? '0' }, { capabilities: {} });
  let transport: { close(): Promise<void>; pid?: number | null };
  if (s.transport === 'stdio') {
    const { StdioClientTransport, getDefaultEnvironment } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    transport = new StdioClientTransport({
      command: i.runtime?.resolved ?? s.command!,
      args: s.args ?? [],
      // A minimal environment plus what the configuration sets, as harnesses do.
      env: { ...getDefaultEnvironment(), ...(s.env ?? {}) },
      cwd: launch.cwd,
      stderr: 'ignore',
    });
  } else if (s.transport === 'sse') {
    const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');
    transport = new SSEClientTransport(new URL(s.url!), { requestInit: { headers: s.headers } });
  } else {
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    transport = new StreamableHTTPClientTransport(new URL(s.url!), { requestInit: { headers: s.headers } });
  }
  const stop = () => {
    // Read the pid before close(): the SDK forgets it while closing.
    const pid = transport.pid;
    void transport.close().catch(() => {});
    if (pid) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
  };
  const started = Date.now();
  try {
    const tools = await withTimeout(
      (async () => {
        await client.connect(transport as Parameters<typeof client.connect>[0]);
        const all: { name: string; description?: string; inputSchema?: unknown }[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < 50; page++) {
          const res = await client.listTools(cursor ? { cursor } : {});
          all.push(...res.tools);
          cursor = res.nextCursor;
          if (!cursor) break;
        }
        return all;
      })(),
      timeoutMs,
      stop,
    );
    const chars = tools.reduce(
      (n, t) => n + JSON.stringify({ name: t.name, description: t.description, inputSchema: t.inputSchema }).length,
      0,
    );
    const m: ToolsMeasure = {
      count: tools.length,
      tokens: Math.round(chars / 4),
      measuredAt: new Date(started).toISOString(),
      names: tools.map((t) => t.name),
    };
    saveMeasure(ctx, i, m);
    return { ok: true, measure: m };
  } catch (e) {
    const err = e as Error & { code?: unknown };
    if (err.code === 'timeout') return { ok: false, code: 'timeout', message: err.message };
    if (/\b401\b|unauthori[sz]ed/i.test(err.message))
      return { ok: false, code: 'auth-required', message: 'the server asked for sign-in; whatsloaded does not sign in' };
    return { ok: false, code: 'failed', message: err.message.split('\n')[0]!.slice(0, 200) };
  } finally {
    stop();
  }
}
