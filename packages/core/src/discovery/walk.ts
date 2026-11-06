import path from "node:path";
import type { ReadonlyFs } from "../env.js";

export const DEFAULT_IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "target",
  ".venv",
  "venv",
  "__pycache__",
  ".turbo",
  ".cache",
]);

/**
 * Returns all ancestor directory paths up to the filesystem root,
 * starting with root down to the target directory.
 */
export function getAncestors(targetDir: string): string[] {
  const result: string[] = [];
  let cur = path.resolve(targetDir);
  while (true) {
    result.unshift(cur);
    const parent = path.dirname(cur);
    if (parent === cur) {
      break;
    }
    cur = parent;
  }
  return result;
}

export interface WalkDescendantsOptions {
  maxDirs?: number;
  ignoreDirNames?: Set<string>;
}

export interface WalkResult {
  directories: string[];
  files: string[];
  limitExceeded: boolean;
}

/**
 * Bounded descendant walk ignoring common build/dependency artifacts.
 */
export async function walkDescendants(
  fs: ReadonlyFs,
  startDir: string,
  options: WalkDescendantsOptions = {},
): Promise<WalkResult> {
  const maxDirs = options.maxDirs ?? 2000;
  const ignore = options.ignoreDirNames ?? DEFAULT_IGNORE_DIRS;

  const directories: string[] = [];
  const files: string[] = [];
  let limitExceeded = false;
  let dirCount = 0;

  async function walk(currentDir: string): Promise<void> {
    if (dirCount >= maxDirs) {
      limitExceeded = true;
      return;
    }

    const entries = await fs.readdir(currentDir);
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (ignore.has(entry.name)) {
          continue;
        }
        dirCount++;
        directories.push(fullPath);
        if (dirCount >= maxDirs) {
          limitExceeded = true;
          return;
        }
        await walk(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  await walk(path.resolve(startDir));
  return { directories, files, limitExceeded };
}
