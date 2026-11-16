/**
 * Reading public catalogs over HTTPS: only when Discover asks, with a deadline, a size cap, and a
 * short in-memory cache so typing and paging do not hammer anyone's registry.
 */
const TTL_MS = 15 * 60_000;
const TIMEOUT_MS = 15_000;
const MAX_BYTES = 16 * 1024 * 1024;
const cache = new Map<string, { at: number; value: unknown }>();

export class FetchError extends Error {}

export async function fetchJson(url: string, opts: { ttlMs?: number; signal?: AbortSignal } = {}): Promise<unknown> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < (opts.ttlMs ?? TTL_MS)) return hit.value;
  const host = new URL(url).host;
  const signals = [AbortSignal.timeout(TIMEOUT_MS), ...(opts.signal ? [opts.signal] : [])];
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'whatsloaded' },
      signal: AbortSignal.any(signals),
      redirect: 'follow',
    });
  } catch (e) {
    const name = (e as Error).name;
    throw new FetchError(name === 'TimeoutError' ? `${host} did not answer in time` : `could not reach ${host}`);
  }
  if (!res.ok) throw new FetchError(`${host} answered ${res.status}${res.status === 429 ? ' (too many requests; try again soon)' : ''}`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new FetchError(`${host} sent more than ${MAX_BYTES / 1024 / 1024} MB`);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new FetchError(`${host} did not send JSON`);
  }
  cache.set(url, { at: Date.now(), value });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return value;
}
