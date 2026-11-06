import crypto from "node:crypto";
import path from "node:path";
import type { ReadonlyFs } from "../env.js";

/**
 * Computes sha256 of text or buffer.
 */
export function hashContent(content: Buffer | string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Computes content hash of a directory tree deterministically.
 */
export async function hashDirectoryTree(fs: ReadonlyFs, dirPath: string): Promise<string> {
  const hash = crypto.createHash("sha256");

  async function walk(d: string, rel: string) {
    const entries = await fs.readdir(d);
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const full = path.join(d, entry.name);
      const entryRel = rel ? `${rel}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        hash.update(`dir:${entryRel}\n`);
        await walk(full, entryRel);
      } else if (entry.isFile()) {
        const content = await fs.readFile(full);
        if (content) {
          hash.update(`file:${entryRel}:${hashContent(content)}\n`);
        }
      }
    }
  }

  await walk(path.resolve(dirPath), "");
  return hash.digest("hex");
}
