# Claude Code Provider Specification

Provider ID: `claude-code`  
Ruleset Version: `claude-code@2026-11`  
Verified Compatible Versions: `^2.1.0`

## Precedence Rules Matrix

| Rule ID | Artifact Kind | Strategy | Scope Priority (High → Low) | Confidence | Primary Documentation Source |
|---|---|---|---|---|---|
| `claude.instructions.concat` | `instruction` | `concat` | managed > user > ancestor > project > local > descendant | documented | [code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory) |
| `claude.rules.conditional` | `rule` | `conditional` | managed > project > user | documented | [code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory) |
| `claude.skills.managed>personal>project` | `skill` | `override` | managed > user > project > descendant | documented | [code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills) |
| `claude.subagents.project>user` | `subagent` | `override` | managed > cli > project > user > plugin | documented | [code.claude.com/docs/en/sub-agents](https://code.claude.com/docs/en/sub-agents) |
| `claude.mcp.managed>local>project>user` | `mcp-server` | `override` | managed > local > project > user > plugin | documented | [code.claude.com/docs/en/mcp](https://code.claude.com/docs/en/mcp) |

## Key Architectural Invariants

1. **Skills vs. Subagents Precedence Inversion**:
   - Skills resolve with Personal/User scope taking precedence over Project scope (`user > project`).
   - Subagents resolve with Project scope taking precedence over User scope (`project > user`).
2. **MCP Scopes**:
   - Local scope in `~/.claude.json#projects[path].mcpServers` overrides repository `.mcp.json`.
   - Project `.mcp.json` overrides global `~/.claude.json#mcpServers`.
   - Whole-definition override: lower-scope fields are not merged into higher-scope definitions.
3. **Import Limits**:
   - `@import` syntax is restricted to a maximum recursion depth of 4 hops.
   - Quoted directives and directives within code blocks are skipped.
