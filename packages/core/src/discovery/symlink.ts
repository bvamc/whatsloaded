import path from "node:path";
import type { ReadonlyFs } from "../env.js";

export interface ResolvedSymlink {
  target: string;
  isLoop: boolean;
  broken: boolean;
}

/**
 * Safely resolves symlinks with cycle detection using device and inode tracking.
 */
export async function resolveSymlinkSafe(
  fs: ReadonlyFs,
  filePath: string,
  maxHops = 32,
): Promise<ResolvedSymlink> {
  let current = path.resolve(filePath);
  const seen = new Set<string>();

  for (let hop = 0; hop < maxHops; hop++) {
    const lstat = await fs.lstat(current);
    if (!lstat) {
      return { target: current, isLoop: false, broken: true };
    }

    if (lstat.dev !== undefined && lstat.ino !== undefined) {
      const devIno = `${lstat.dev}:${lstat.ino}`;
      if (seen.has(devIno)) {
        return { target: current, isLoop: true, broken: false };
      }
      seen.add(devIno);
    }

    if (!lstat.isSymbolicLink()) {
      return { target: current, isLoop: false, broken: false };
    }

    const rawLink = await fs.readlink(current);
    if (!rawLink) {
      return { target: current, isLoop: false, broken: true };
    }

    current = path.isAbsolute(rawLink)
      ? path.resolve(rawLink)
      : path.resolve(path.dirname(current), rawLink);
  }

  return { target: current, isLoop: true, broken: false };
}
