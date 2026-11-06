import fs from "node:fs";
import { NodeReadonlyFs } from "@whatsloaded/core";
import { describe, expect, it } from "vitest";

describe("Write Guard Test", () => {
  it("ensures NodeReadonlyFs has zero mutating methods", () => {
    const readonlyFs = new NodeReadonlyFs();
    const forbiddenMethods = [
      "writeFile",
      "appendFile",
      "unlink",
      "rm",
      "rmdir",
      "mkdir",
      "copyFile",
      "rename",
      "truncate",
      "chmod",
      "chown",
    ];

    for (const method of forbiddenMethods) {
      expect((readonlyFs as unknown as Record<string, unknown>)[method]).toBeUndefined();
    }
  });

  it("fails if any tests or discovery code invoke mutating fs APIs", () => {
    // Audit that core discovery/parse modules do not import mutating write functions
    const files = [
      "packages/core/src/discovery/walk.ts",
      "packages/core/src/discovery/symlink.ts",
      "packages/core/src/discovery/hash.ts",
      "packages/core/src/discovery/cache.ts",
      "packages/core/src/parse/jsonc.ts",
      "packages/core/src/parse/frontmatter.ts",
      "packages/core/src/parse/md-imports.ts",
      "packages/core/src/parse/toml.ts",
      "packages/core/src/resolve/resolver.ts",
      "packages/providers/src/claude-code/index.ts",
    ];

    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      expect(content).not.toMatch(/fs\.(writeFile|unlink|mkdir|rmdir|rm)\b/);
      expect(content).not.toMatch(/node:fs\/promises.*\b(writeFile|unlink|mkdir|rmdir|rm)\b/);
    }
  });
});
