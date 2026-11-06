import { describe, expect, it } from "vitest";
import { resolveContext } from "../src/resolve/resolver.js";
import type { Artifact, PrecedenceRule } from "../src/types.js";

describe("core resolver", () => {
  it("resolves overrides and records shadow edges", () => {
    const artifacts: Artifact[] = [
      {
        id: "art:user:skill:pdf",
        provider: "claude-code",
        consumers: ["claude-code"],
        kind: "skill",
        logicalKey: "skill:pdf",
        name: "pdf",
        scope: { kind: "user" },
        source: { path: "/home/.claude/skills/pdf/SKILL.md" },
        data: {},
        findings: [],
      },
      {
        id: "art:project:skill:pdf",
        provider: "claude-code",
        consumers: ["claude-code"],
        kind: "skill",
        logicalKey: "skill:pdf",
        name: "pdf",
        scope: { kind: "project", projectRoot: "/app" },
        source: { path: "/app/.claude/skills/pdf/SKILL.md" },
        data: {},
        findings: [],
      },
    ];

    const rules: PrecedenceRule[] = [
      {
        id: "claude.skills.personal-over-project",
        kind: "skill",
        strategy: "override",
        order: ["user", "project"],
        confidence: "documented",
        docUrl: "https://code.claude.com",
      },
    ];

    const ctx = resolveContext(artifacts, {
      provider: "claude-code",
      dir: "/app",
      rulesVersion: "2026-11",
      rules,
    });

    expect(ctx.effective).toHaveLength(1);
    expect(ctx.effective[0].artifactId).toBe("art:user:skill:pdf");
    expect(ctx.shadowed).toHaveLength(1);
    expect(ctx.shadowed[0].winner).toBe("art:user:skill:pdf");
    expect(ctx.shadowed[0].loser).toBe("art:project:skill:pdf");
    expect(ctx.shadowed[0].ruleId).toBe("claude.skills.personal-over-project");
  });
});
