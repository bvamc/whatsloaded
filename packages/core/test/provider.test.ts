import { describe, expect, it } from "vitest";
import { NodeReadonlyFs, ProviderRegistry } from "../src/index.js";

describe("core Env & ProviderRegistry", () => {
  it("initializes NodeReadonlyFs without mutating methods", () => {
    const fs = new NodeReadonlyFs();
    expect(fs).toBeDefined();
    const fsObj = fs as unknown as Record<string, unknown>;
    expect(fsObj.writeFile).toBeUndefined();
    expect(fsObj.unlink).toBeUndefined();
    expect(fsObj.mkdir).toBeUndefined();
  });

  it("registers and lists providers", () => {
    const registry = new ProviderRegistry();
    const mockProvider = {
      id: "claude-code",
      displayName: "Claude Code",
      detect: async () => ({ installed: true, configRoots: [] }),
      discover: async () => [],
      resolve: () => ({
        provider: "claude-code",
        dir: "/",
        rulesVersion: "2026-11",
        layers: [],
        effective: [],
        conditional: [],
        shadowed: [],
        unobservable: [],
        totals: { instructionBytes: 0, approxTokens: 0 },
      }),
      rulesVersion: "2026-11",
    };

    registry.register(mockProvider);
    expect(registry.get("claude-code")).toBe(mockProvider);
    expect(registry.list()).toEqual([mockProvider]);
  });
});
