import fs from "node:fs/promises";
import type { DirentLike, ReadonlyFs, StatLike } from "../env.js";

export class NodeReadonlyFs implements ReadonlyFs {
  async stat(path: string): Promise<StatLike | null> {
    try {
      const s = await fs.stat(path);
      return {
        isDirectory: () => s.isDirectory(),
        isFile: () => s.isFile(),
        isSymbolicLink: () => s.isSymbolicLink(),
        size: s.size,
        mtimeMs: s.mtimeMs,
        ino: s.ino,
        dev: s.dev,
      };
    } catch {
      return null;
    }
  }

  async lstat(path: string): Promise<StatLike | null> {
    try {
      const s = await fs.lstat(path);
      return {
        isDirectory: () => s.isDirectory(),
        isFile: () => s.isFile(),
        isSymbolicLink: () => s.isSymbolicLink(),
        size: s.size,
        mtimeMs: s.mtimeMs,
        ino: s.ino,
        dev: s.dev,
      };
    } catch {
      return null;
    }
  }

  async readFile(path: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(path);
    } catch {
      return null;
    }
  }

  async readText(path: string): Promise<string | null> {
    try {
      return await fs.readFile(path, "utf8");
    } catch {
      return null;
    }
  }

  async readdir(path: string): Promise<DirentLike[]> {
    try {
      const entries = await fs.readdir(path, { withFileTypes: true });
      return entries.map((e) => ({
        name: e.name,
        isDirectory: () => e.isDirectory(),
        isFile: () => e.isFile(),
        isSymbolicLink: () => e.isSymbolicLink(),
      }));
    } catch {
      return [];
    }
  }

  async readlink(path: string): Promise<string | null> {
    try {
      return await fs.readlink(path);
    } catch {
      return null;
    }
  }

  async realpath(path: string): Promise<string | null> {
    try {
      return await fs.realpath(path);
    } catch {
      return null;
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }
}
