import path from "node:path";
import {
  type Artifact,
  type Env,
  type Provider,
  type ResolvedContext,
  type ScopeQuery,
  expandMarkdownImports,
  getAncestors,
  hashContent,
  parseFrontmatter,
  parseJsonc,
  resolveContext,
  walkDescendants,
} from "@whatsloaded/core";
import { detectClaudeCode } from "./detect.js";
import { getClaudeConfigDir, getManagedConfigDir } from "./paths.js";
import { CLAUDE_PRECEDENCE_RULES, CLAUDE_RULES_VERSION } from "./rules.js";

export class ClaudeCodeProvider implements Provider {
  readonly id = "claude-code";
  readonly displayName = "Claude Code";
  readonly rulesVersion = CLAUDE_RULES_VERSION;
  readonly appliesToVersions = "^2.1.0";

  async detect(env: Env) {
    return detectClaudeCode(env);
  }

  async discover(env: Env, scope: ScopeQuery): Promise<Artifact[]> {
    const artifacts: Artifact[] = [];
    const targetDir = path.resolve(scope.dir);
    const configDir = getClaudeConfigDir(env);
    const managedDir = getManagedConfigDir(env);

    // 1. Memory / Instructions
    // Managed CLAUDE.md
    if (managedDir) {
      const managedClaude = path.join(managedDir, "CLAUDE.md");
      if (await env.fs.exists(managedClaude)) {
        await this.addInstructionArtifact(env, artifacts, managedClaude, "managed");
      }
    }

    // User CLAUDE.md
    const userClaude = path.join(configDir, "CLAUDE.md");
    if (await env.fs.exists(userClaude)) {
      await this.addInstructionArtifact(env, artifacts, userClaude, "user");
    }

    // Ancestor CLAUDE.md files
    const ancestors = getAncestors(targetDir);
    for (const d of ancestors) {
      const isTarget = d === targetDir;
      const scopeKind = isTarget ? "project" : "ancestor";

      const cand1 = path.join(d, "CLAUDE.md");
      if (await env.fs.exists(cand1)) {
        await this.addInstructionArtifact(env, artifacts, cand1, scopeKind);
      }

      const cand2 = path.join(d, ".claude", "CLAUDE.md");
      if (await env.fs.exists(cand2)) {
        await this.addInstructionArtifact(env, artifacts, cand2, scopeKind);
      }

      const candLocal = path.join(d, "CLAUDE.local.md");
      if (await env.fs.exists(candLocal)) {
        await this.addInstructionArtifact(env, artifacts, candLocal, "local");
      }
    }

    // Rules (.claude/rules/**/*.md)
    await this.discoverRules(env, artifacts, path.join(configDir, "rules"), "user");
    await this.discoverRules(env, artifacts, path.join(targetDir, ".claude", "rules"), "project");

    // Descendant lazy CLAUDE.md files
    const descendants = await walkDescendants(env.fs, targetDir, { maxDirs: 500 });
    for (const f of descendants.files) {
      if (f.endsWith("CLAUDE.md") && f !== path.join(targetDir, "CLAUDE.md")) {
        await this.addInstructionArtifact(env, artifacts, f, "descendant", {
          type: "lazy-subdir",
          value: path.dirname(f),
        });
      }
    }

    // 2. Skills
    await this.discoverSkills(env, artifacts, path.join(configDir, "skills"), "user");
    await this.discoverSkills(env, artifacts, path.join(targetDir, ".claude", "skills"), "project");

    // 3. Subagents
    await this.discoverSubagents(env, artifacts, path.join(configDir, "agents"), "user");
    await this.discoverSubagents(
      env,
      artifacts,
      path.join(targetDir, ".claude", "agents"),
      "project",
    );

    // 4. MCP Servers
    await this.discoverMcpServers(env, artifacts, targetDir, configDir, managedDir);

    // 5. Settings
    await this.discoverSettings(env, artifacts, targetDir, configDir, managedDir);

    return artifacts;
  }

  resolve(env: Env, dir: string, artifacts: Artifact[]): ResolvedContext {
    return resolveContext(artifacts, {
      provider: this.id,
      dir,
      rulesVersion: this.rulesVersion,
      rules: CLAUDE_PRECEDENCE_RULES,
      unobservable: [
        {
          what: "CLI flags (--disallowed-tools, --setting-sources)",
          why: "Passed ephemerally per process run, not persisted on disk",
        },
        {
          what: "Claude.ai connectors",
          why: "Managed on remote Claude cloud workspace",
        },
      ],
    });
  }

  private async addInstructionArtifact(
    env: Env,
    sink: Artifact[],
    filePath: string,
    scopeKind: Artifact["scope"]["kind"],
    condition?: { type: "lazy-subdir"; value: string },
  ) {
    const text = (await env.fs.readText(filePath)) ?? "";
    const stat = await env.fs.stat(filePath);
    const expansion = await expandMarkdownImports(env.fs, filePath, env.home);

    sink.push({
      id: `art:${scopeKind}:instruction:${filePath}`,
      provider: this.id,
      consumers: [this.id],
      kind: "instruction",
      logicalKey: `instruction:${filePath}`,
      name: path.basename(filePath),
      scope: { kind: scopeKind },
      source: {
        path: filePath,
        sizeBytes: stat?.size ?? text.length,
        sha256: hashContent(text),
      },
      data: {
        bytes: stat?.size ?? text.length,
        approxTokens: Math.round((stat?.size ?? text.length) / 4),
        imports: expansion.edges,
        condition,
      },
      findings: [],
    });
  }

  private async discoverRules(
    env: Env,
    sink: Artifact[],
    rulesDir: string,
    scopeKind: Artifact["scope"]["kind"],
  ) {
    if (!(await env.fs.exists(rulesDir))) return;
    const entries = await env.fs.readdir(rulesDir);
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        const fullPath = path.join(rulesDir, entry.name);
        const text = (await env.fs.readText(fullPath)) ?? "";
        const stat = await env.fs.stat(fullPath);
        const { frontmatter } = parseFrontmatter<{ paths?: string | string[] }>(text);
        const condition = frontmatter?.paths
          ? {
              type: "glob" as const,
              value: Array.isArray(frontmatter.paths)
                ? frontmatter.paths.join(", ")
                : frontmatter.paths,
            }
          : undefined;

        sink.push({
          id: `art:${scopeKind}:rule:${fullPath}`,
          provider: this.id,
          consumers: [this.id],
          kind: "rule",
          logicalKey: `rule:${entry.name}`,
          name: entry.name,
          scope: { kind: scopeKind },
          source: {
            path: fullPath,
            sizeBytes: stat?.size ?? text.length,
            sha256: hashContent(text),
          },
          data: {
            bytes: stat?.size ?? text.length,
            approxTokens: Math.round((stat?.size ?? text.length) / 4),
            imports: [],
            condition,
          },
          findings: [],
        });
      }
    }
  }

  private async discoverSkills(
    env: Env,
    sink: Artifact[],
    skillsDir: string,
    scopeKind: Artifact["scope"]["kind"],
  ) {
    if (!(await env.fs.exists(skillsDir))) return;
    const entries = await env.fs.readdir(skillsDir);
    for (const entry of entries) {
      const skillPath = path.join(skillsDir, entry.name);
      const skillMd = path.join(skillPath, "SKILL.md");
      if (await env.fs.exists(skillMd)) {
        const text = (await env.fs.readText(skillMd)) ?? "";
        const { frontmatter } = parseFrontmatter<{
          name?: string;
          description?: string;
        }>(text);
        const name = frontmatter?.name ?? entry.name;

        sink.push({
          id: `art:${scopeKind}:skill:${name}`,
          provider: this.id,
          consumers: [this.id],
          kind: "skill",
          logicalKey: `skill:${name}`,
          name,
          scope: { kind: scopeKind },
          source: { path: skillMd },
          data: {
            declaredName: frontmatter?.name,
            description: frontmatter?.description,
            dirName: entry.name,
          },
          findings: [],
        });
      }
    }
  }

  private async discoverSubagents(
    env: Env,
    sink: Artifact[],
    agentsDir: string,
    scopeKind: Artifact["scope"]["kind"],
  ) {
    if (!(await env.fs.exists(agentsDir))) return;
    const entries = await env.fs.readdir(agentsDir);
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        const fullPath = path.join(agentsDir, entry.name);
        const text = (await env.fs.readText(fullPath)) ?? "";
        const { frontmatter } = parseFrontmatter<{
          name?: string;
          description?: string;
        }>(text);
        const name = frontmatter?.name ?? entry.name.replace(/\.md$/, "");

        sink.push({
          id: `art:${scopeKind}:subagent:${name}`,
          provider: this.id,
          consumers: [this.id],
          kind: "subagent",
          logicalKey: `subagent:${name}`,
          name,
          scope: { kind: scopeKind },
          source: { path: fullPath },
          data: {
            declaredName: frontmatter?.name,
            description: frontmatter?.description,
          },
          findings: [],
        });
      }
    }
  }

  private async discoverMcpServers(
    env: Env,
    sink: Artifact[],
    targetDir: string,
    configDir: string,
    managedDir: string | null,
  ) {
    // 1. Local scope: ~/.claude.json projects[targetDir].mcpServers
    const claudeJsonPath = path.join(env.home, ".claude.json");
    let claudeJsonData: {
      mcpServers?: Record<string, unknown>;
      projects?: Record<string, { mcpServers?: Record<string, unknown> }>;
    } = {};

    if (await env.fs.exists(claudeJsonPath)) {
      const text = (await env.fs.readText(claudeJsonPath)) ?? "{}";
      claudeJsonData = parseJsonc<typeof claudeJsonData>(text).data ?? {};
    }

    const localServers = claudeJsonData.projects?.[targetDir]?.mcpServers ?? {};
    for (const [name, def] of Object.entries(localServers)) {
      sink.push({
        id: `art:local:mcp-server:${name}`,
        provider: this.id,
        consumers: [this.id],
        kind: "mcp-server",
        logicalKey: `mcp-server:${name}`,
        name,
        scope: { kind: "local" },
        source: { path: `${claudeJsonPath}#projects[${targetDir}]` },
        data: def,
        findings: [],
      });
    }

    // 2. Project scope: <targetDir>/.mcp.json
    const projectMcpPath = path.join(targetDir, ".mcp.json");
    if (await env.fs.exists(projectMcpPath)) {
      const text = (await env.fs.readText(projectMcpPath)) ?? "{}";
      const parsed = parseJsonc<{ mcpServers?: Record<string, unknown> }>(text).data;
      for (const [name, def] of Object.entries(parsed?.mcpServers ?? {})) {
        sink.push({
          id: `art:project:mcp-server:${name}`,
          provider: this.id,
          consumers: [this.id],
          kind: "mcp-server",
          logicalKey: `mcp-server:${name}`,
          name,
          scope: { kind: "project" },
          source: { path: projectMcpPath },
          data: def,
          findings: [],
        });
      }
    }

    // 3. User scope: ~/.claude.json top-level mcpServers
    const userServers = claudeJsonData.mcpServers ?? {};
    for (const [name, def] of Object.entries(userServers)) {
      sink.push({
        id: `art:user:mcp-server:${name}`,
        provider: this.id,
        consumers: [this.id],
        kind: "mcp-server",
        logicalKey: `mcp-server:${name}`,
        name,
        scope: { kind: "user" },
        source: { path: `${claudeJsonPath}#mcpServers` },
        data: def,
        findings: [],
      });
    }
  }

  private async discoverSettings(
    env: Env,
    sink: Artifact[],
    targetDir: string,
    configDir: string,
    managedDir: string | null,
  ) {
    const layers: { path: string; scope: "managed" | "local" | "project" | "user" }[] = [
      { path: path.join(configDir, "settings.json"), scope: "user" },
      { path: path.join(targetDir, ".claude", "settings.json"), scope: "project" },
      { path: path.join(targetDir, ".claude", "settings.local.json"), scope: "local" },
    ];

    if (managedDir) {
      layers.unshift({
        path: path.join(managedDir, "managed-settings.json"),
        scope: "managed",
      });
    }

    for (const layer of layers) {
      if (await env.fs.exists(layer.path)) {
        const text = (await env.fs.readText(layer.path)) ?? "{}";
        const parsed = parseJsonc<Record<string, unknown>>(text).data ?? {};

        sink.push({
          id: `art:${layer.scope}:setting:${layer.path}`,
          provider: this.id,
          consumers: [this.id],
          kind: "setting",
          logicalKey: `setting:${layer.scope}`,
          name: path.basename(layer.path),
          scope: { kind: layer.scope },
          source: { path: layer.path },
          data: parsed,
          findings: [],
        });
      }
    }
  }
}
