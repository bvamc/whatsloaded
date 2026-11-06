import { describe, expect, it } from "vitest";
import { hashContent } from "../src/discovery/hash.js";
import { resolveSymlinkSafe } from "../src/discovery/symlink.js";
import { getAncestors, walkDescendants } from "../src/discovery/walk.js";
import type { DirentLike, ReadonlyFs, StatLike } from "../src/env.js";

describe("discovery utils", () => {
  it("computes ancestor chain correctly", () => {
    const ancestors = getAncestors("/a/b/c");
    expect(ancestors).toEqual(["/", "/a", "/a/b", "/a/b/c"]);
  });

  it("hashes content deterministically", () => {
    const h1 = hashContent("hello world");
    const h2 = hashContent(Buffer.from("hello world"));
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  it("detects symlink loops safely", async () => {
    const mockFs: ReadonlyFs = {
      stat: async () => null,
      lstat: async (p) => ({
        isDirectory: () => false,
        isFile: () => false,
        isSymbolicLink: () => true,
        size: 10,
        mtimeMs: 1000,
        ino: p.includes("loop1") ? 1 : 2,
        dev: 1,
      }),
      readFile: async () => null,
      readText: async () => null,
      readdir: async () => [],
      readlink: async (p) => (p.includes("loop1") ? "/tmp/loop2" : "/tmp/loop1"),
      realpath: async () => null,
      exists: async () => true,
    };

    const res = await resolveSymlinkSafe(mockFs, "/tmp/loop1");
    expect(res.isLoop).toBe(true);
  });

  it("bounds walkDescendants when limit is exceeded", async () => {
    const mockFs: ReadonlyFs = {
      stat: async () => null,
      lstat: async () => null,
      readFile: async () => null,
      readText: async () => null,
      readdir: async (p) => {
        if (p === "/root") {
          return [
            {
              name: "sub1",
              isDirectory: () => true,
              isFile: () => false,
              isSymbolicLink: () => false,
            },
            {
              name: "sub2",
              isDirectory: () => true,
              isFile: () => false,
              isSymbolicLink: () => false,
            },
          ];
        }
        return [];
      },
      readlink: async () => null,
      realpath: async () => null,
      exists: async () => true,
    };

    const res = await walkDescendants(mockFs, "/root", { maxDirs: 1 });
    expect(res.limitExceeded).toBe(true);
    expect(res.directories.length).toBe(1);
  });
});
