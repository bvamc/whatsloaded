import type { PrecedenceRule } from "@whatsloaded/core";

export const CLAUDE_RULES_VERSION = "claude-code@2026-11";

/**
 * Declarative precedence rules for Claude Code v2.1.x
 * Derived from official documentation citations in docs/providers/claude-code.md.
 */
export const CLAUDE_PRECEDENCE_RULES: PrecedenceRule[] = [
  {
    id: "claude.instructions.concat",
    kind: "instruction",
    strategy: "concat",
    order: ["managed", "user", "ancestor", "project", "local", "descendant"],
    confidence: "documented",
    docUrl: "https://code.claude.com/docs/en/memory",
    note: "All memory files are concatenated in hierarchy order.",
  },
  {
    id: "claude.rules.conditional",
    kind: "rule",
    strategy: "conditional",
    order: ["managed", "project", "user"],
    confidence: "documented",
    docUrl: "https://code.claude.com/docs/en/memory",
    note: "Rules under .claude/rules/ are applied always or conditionally based on paths frontmatter.",
  },
  {
    id: "claude.skills.managed>personal>project",
    kind: "skill",
    strategy: "override",
    order: ["managed", "user", "project", "descendant"],
    confidence: "documented",
    docUrl: "https://code.claude.com/docs/en/skills",
    note: "Personal skills override project skills on name collisions.",
  },
  {
    id: "claude.subagents.project>user",
    kind: "subagent",
    strategy: "override",
    order: ["managed", "cli", "project", "user", "plugin"],
    confidence: "documented",
    docUrl: "https://code.claude.com/docs/en/sub-agents",
    note: "Project subagents override user subagents on name collisions.",
  },
  {
    id: "claude.mcp.managed>local>project>user",
    kind: "mcp-server",
    strategy: "override",
    order: ["managed", "local", "project", "user", "plugin"],
    confidence: "documented",
    docUrl: "https://code.claude.com/docs/en/mcp",
    note: "Higher-scope MCP definitions completely override lower-scope definitions.",
  },
];
