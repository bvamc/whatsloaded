import type { Env, ReadonlyFs } from "@whatsloaded/core";
import { describe, expect, it } from "vitest";
import { ClaudeCodeProvider } from "../../src/claude-code/index.js";

describe("ClaudeCodeProvider", () => {
  it("discovers memory, skills, and resolves personal over project skills", async () => {
    const memoryFiles: Record<string, string> = {
      "/user/.claude/CLAUDE.md": "User memory",
      "/app/CLAUDE.md": "App memory",
      "/user/.claude/skills/pdf/SKILL.md": "---\nname: pdf\ndescription: personal pdf\n---\nbody",
      "/app/.claude/skills/pdf/SKILL.md": "---\nname: pdf\ndescription: project pdf\n---\nbody",
    };

    const mockFs: ReadonlyFs = {
      stat: async (p) => {
        if (memoryFiles[p]) {
          return {
            isDirectory: () => false,
            isFile: () => true,
            isSymbolicLink: () => false,
            size: memoryFiles[p].length,
            mtimeMs: 1000,
          };
        }
        if (
          [
            "/user/.claude",
            "/user/.claude/skills",
            "/user/.claude/skills/pdf",
            "/app",
            "/app/.claude",
            "/app/.claude/skills",
            "/app/.claude/skills/pdf",
          ].includes(p)
        ) {
          return {
            isDirectory: () => true,
            isFile: () => false,
            isSymbolicLink: () => false,
            size: 100,
            mtimeMs: 1000,
          };
        }
        return null;
      },
      lstat: async (p) => null,
      readFile: async (p) => (memoryFiles[p] ? Buffer.from(memoryFiles[p]) : null),
      readText: async (p) => memoryFiles[p] ?? null,
      readdir: async (p) => {
        if (p === "/user/.claude/skills" || p === "/app/.claude/skills") {
          return [
            {
              name: "pdf",
              isDirectory: () => true,
              isFile: () => false,
              isSymbolicLink: () => false,
            },
          ];
        }
        return [];
      },
      readlink: async () => null,
      realpath: async (p) => p,
      exists: async (p) =>
        Boolean(
          memoryFiles[p] ||
            [
              "/user/.claude/skills",
              "/app/.claude/skills",
              "/user/.claude/skills/pdf/SKILL.md",
              "/app/.claude/skills/pdf/SKILL.md",
            ].includes(p),
        ),
    };

    const env: Env = {
      home: "/user",
      platform: "darwin",
      vars: {},
      cwd: "/app",
      fs: mockFs,
      which: async (cmd) => (cmd === "claude" ? "/usr/local/bin/claude" : null),
      exec: async () => ({ stdout: "2.1.239\n", code: 0 }),
    };

    const provider = new ClaudeCodeProvider();
    const detection = await provider.detect(env);
    expect(detection.installed).toBe(true);
    expect(detection.version).toBe("2.1.239");

    const artifacts = await provider.discover(env, { dir: "/app" });
    expect(artifacts.length).toBeGreaterThan(0);

    const resolved = provider.resolve(env, "/app", artifacts);
    expect(resolved.provider).toBe("claude-code");

    // Check personal over project skill shadowing
    const shadowedSkill = resolved.shadowed.find((s) => s.logicalKey === "skill:pdf");
    expect(shadowedSkill).toBeDefined();
    expect(shadowedSkill?.winner).toContain("user");
    expect(shadowedSkill?.loser).toContain("project");
  });
});
