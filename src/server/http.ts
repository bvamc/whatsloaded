/**
 * Local-only HTTP server for the web UI.
 *
 * Exposure model: the listener binds 127.0.0.1 and nothing else (no host option, by design;
 * reach it remotely with an SSH local port-forward). Because it can rewrite agent configs,
 * every request is also checked against browser-borne attacks on localhost services:
 *  - Host must be this loopback origin, which defeats DNS rebinding.
 *  - Mutating requests must carry a same-origin Origin and a JSON body, which defeats CSRF
 *    (a cross-site page can't send application/json without a CORS preflight, and we never
 *    answer preflights).
 * Secrets never leave the process: MCP env/header values are redacted in every response.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import type { CatalogKind } from '../catalog/index.js';
import type { Ctx } from '../core/context.js';
import { knownProjects } from '../core/projects.js';
import { isDir } from '../io/fsx.js';
import {
  ApiFailure,
  applyPlan,
  catalogPage,
  catalogSources,
  jobStatus,
  makePlan,
  planInstall,
  planMeasure,
  runInstall,
  runMeasure,
  state,
  undo,
} from './api.js';
import type { PlanRequest } from './types.js';

export const LOOPBACK = '127.0.0.1';
const MAX_BODY = 64 * 1024;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new ApiFailure(413, { error: 'request too large', code: 'bad-request' });
    chunks.push(c as Buffer);
  }
  try {
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  } catch {
    throw new ApiFailure(400, { error: 'invalid JSON', code: 'bad-request' });
  }
}

function isPlanRequest(v: unknown): v is PlanRequest {
  const o = v as PlanRequest;
  return (
    !!o &&
    typeof o.action === 'string' &&
    Array.isArray(o.refs) &&
    o.refs.every((r) => typeof r === 'string') &&
    (o.targets === undefined || (Array.isArray(o.targets) && o.targets.every((t) => typeof t === 'string')))
  );
}

/**
 * Each request may ask to include one project. Global (no project) unless asked; the path must
 * be an existing absolute directory and not the home directory itself.
 */
function withProject(base: Ctx, project: unknown): Ctx {
  if (project === undefined || project === null || project === '') return { ...base, project: undefined };
  if (typeof project !== 'string' || !isAbsolute(project))
    throw new ApiFailure(400, { error: 'project must be an absolute path', code: 'bad-request' });
  const p = resolve(project);
  if (p === base.home || !isDir(p))
    throw new ApiFailure(400, { error: 'project must be an existing folder (not your home folder)', code: 'bad-request' });
  return { ...base, project: p };
}

export interface UiServer {
  server: Server;
  url: string;
}

export function startServer(ctx: Ctx, opts: { port: number; webRoot: string }): Promise<UiServer> {
  const root = resolve(opts.webRoot);
  let origin = '';
  let allowedHosts = new Set<string>();

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      // DNS-rebinding guard: only our own loopback authority is acceptable.
      if (!allowedHosts.has(req.headers.host ?? '')) return send(res, 421, { error: 'unexpected Host header', code: 'bad-request' });
      const url = new URL(req.url ?? '/', origin);
      const method = req.method ?? 'GET';

      if (url.pathname.startsWith('/api/')) {
        if (method !== 'GET') {
          if (req.headers.origin !== origin) return send(res, 403, { error: 'cross-origin request refused', code: 'bad-request' });
          if (!(req.headers['content-type'] ?? '').startsWith('application/json'))
            return send(res, 415, { error: 'expected application/json', code: 'bad-request' });
        }
        const route = `${method} ${url.pathname}`;
        switch (route) {
          case 'GET /api/state':
            return send(res, 200, await state(withProject(ctx, url.searchParams.get('project'))));
          case 'GET /api/projects':
            return send(res, 200, { projects: knownProjects(ctx) });
          case 'POST /api/plan': {
            const body = await readJson(req);
            if (!isPlanRequest(body)) return send(res, 400, { error: 'invalid plan request', code: 'bad-request' });
            return send(res, 200, await makePlan(withProject(ctx, (body as { project?: unknown }).project), body));
          }
          case 'POST /api/apply': {
            const body = (await readJson(req)) as { id?: unknown };
            if (typeof body.id !== 'string') return send(res, 400, { error: 'missing plan id', code: 'bad-request' });
            return send(res, 200, applyPlan(ctx, body.id));
          }
          case 'POST /api/measure/plan': {
            const body = (await readJson(req)) as { refs?: unknown; project?: unknown };
            if (!Array.isArray(body.refs) || !body.refs.every((r) => typeof r === 'string')) {
              return send(res, 400, { error: 'refs must be a list of strings', code: 'bad-request' });
            }
            return send(res, 200, await planMeasure(withProject(ctx, body.project), body.refs as string[]));
          }
          case 'POST /api/measure/run': {
            const body = (await readJson(req)) as { id?: unknown; project?: unknown };
            if (typeof body.id !== 'string') return send(res, 400, { error: 'missing id', code: 'bad-request' });
            return send(res, 200, await runMeasure(withProject(ctx, body.project), body.id));
          }
          case 'GET /api/catalog/sources':
            return send(res, 200, { sources: catalogSources(ctx) });
          case 'GET /api/catalog': {
            const p = url.searchParams;
            const kind = p.get('kind');
            if (kind && !['mcp', 'skill', 'plugin', 'package'].includes(kind))
              return send(res, 400, { error: 'unknown kind', code: 'bad-request' });
            return send(
              res,
              200,
              await catalogPage(ctx, p.get('source') ?? '', {
                text: (p.get('q') ?? '').slice(0, 200),
                kind: (kind || undefined) as CatalogKind | undefined,
                cursor: p.get('cursor') ?? undefined,
                limit: Math.min(Number.parseInt(p.get('limit') ?? '50', 10) || 50, 500),
              }),
            );
          }
          case 'POST /api/install/plan': {
            const body = (await readJson(req)) as { entry?: unknown; action?: unknown; tools?: unknown };
            if (typeof body.entry !== 'string' || (body.action !== 'install' && body.action !== 'uninstall'))
              return send(res, 400, { error: 'entry and action (install or uninstall) are required', code: 'bad-request' });
            const tools =
              Array.isArray(body.tools) && body.tools.every((t) => typeof t === 'string') ? (body.tools as string[]) : undefined;
            return send(res, 200, await planInstall(ctx, body.entry, body.action, tools));
          }
          case 'POST /api/install/run': {
            const body = (await readJson(req)) as { id?: unknown };
            if (typeof body.id !== 'string') return send(res, 400, { error: 'missing plan id', code: 'bad-request' });
            return send(res, 200, runInstall(ctx, body.id));
          }
          case 'GET /api/job':
            return send(res, 200, jobStatus(url.searchParams.get('id') ?? ''));
          case 'POST /api/undo': {
            const body = (await readJson(req)) as { id?: unknown };
            return send(res, 200, undo(ctx, typeof body.id === 'string' ? body.id : undefined));
          }
          default:
            return send(res, 404, { error: 'no such endpoint', code: 'not-found' });
        }
      }

      if (method !== 'GET' && method !== 'HEAD') return send(res, 405, { error: 'method not allowed', code: 'bad-request' });
      // Static assets, with traversal protection and SPA fallback.
      const rel = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '');
      let file = resolve(root, rel);
      if (file !== root && !file.startsWith(root + sep)) return send(res, 403, { error: 'forbidden', code: 'bad-request' });
      if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
      if (!existsSync(file)) return send(res, 503, { error: 'web UI not built; run `npm run build`', code: 'internal' });
      const ext = extname(file);
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Cache-Control': file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-store',
      });
      if (method === 'HEAD') return res.end();
      createReadStream(file).pipe(res);
    } catch (e) {
      if (e instanceof ApiFailure) return send(res, e.status, e.body);
      send(res, 500, { error: (e as Error).message, code: 'internal' });
    }
  };

  const server = createServer((req, res) => void handler(req, res));
  return new Promise((resolvePromise, reject) => {
    const listen = (port: number) => {
      server.once('error', (e: NodeJS.ErrnoException) => {
        if (e.code === 'EADDRINUSE' && port !== 0) listen(0);
        else reject(e);
      });
      server.listen(port, LOOPBACK, () => {
        const addr = server.address();
        const actual = typeof addr === 'object' && addr ? addr.port : port;
        origin = `http://${LOOPBACK}:${actual}`;
        allowedHosts = new Set([`${LOOPBACK}:${actual}`, `localhost:${actual}`]);
        resolvePromise({ server, url: origin });
      });
    };
    listen(opts.port);
  });
}
