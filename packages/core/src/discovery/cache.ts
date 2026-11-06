import type { ReadonlyFs, StatLike } from "../env.js";

interface CacheEntry {
  mtimeMs: number;
  size: number;
  content: string;
}

/**
 * In-memory cache for file text content based on (path, mtimeMs, size).
 */
export class FileContentCache {
  private cache = new Map<string, CacheEntry>();

  async readText(fs: ReadonlyFs, filePath: string, stat?: StatLike): Promise<string | null> {
    const s = stat ?? (await fs.stat(filePath));
    if (!s || !s.isFile()) {
      return null;
    }

    const cached = this.cache.get(filePath);
    if (cached && cached.mtimeMs === s.mtimeMs && cached.size === s.size) {
      return cached.content;
    }

    const content = await fs.readText(filePath);
    if (content !== null) {
      this.cache.set(filePath, {
        mtimeMs: s.mtimeMs,
        size: s.size,
        content,
      });
    }

    return content;
  }

  clear(): void {
    this.cache.clear();
  }
}
