#!/usr/bin/env node
import path from "node:path";
import { CORE_VERSION, ProviderRegistry } from "@whatsloaded/core";
import { ClaudeCodeProvider } from "@whatsloaded/providers";
import { Command } from "commander";
import pc from "picocolors";
import { createNodeEnv } from "./env-node.js";
import { renderJson } from "./render/json.js";
import { renderTree } from "./render/tree.js";

const registry = new ProviderRegistry();
registry.register(new ClaudeCodeProvider());

const program = new Command();

program
  .name("whatsloaded")
  .description("See what your AI coding agents actually load — and why.")
  .version(CORE_VERSION);

program
  .command("scan")
  .description("Scan for installed AI coding tools and configurations")
  .option("--json", "Output results as JSON")
  .action(async (options) => {
    const env = createNodeEnv();
    const results = [];

    for (const provider of registry.list()) {
      const detection = await provider.detect(env);
      results.push({
        id: provider.id,
        name: provider.displayName,
        rulesVersion: provider.rulesVersion,
        ...detection,
      });
    }

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    console.log(pc.bold(pc.cyan("Installed AI Coding Environments:")));
    for (const res of results) {
      const status = res.installed ? pc.green("detected") : pc.dim("not found");
      const ver = res.version ? pc.dim(`(${res.version})`) : "";
      console.log(`  ${pc.bold(res.name)}: ${status} ${ver}`);
      if (res.configRoots.length > 0) {
        for (const r of res.configRoots) {
          console.log(`    ${pc.dim("config:")} ${r}`);
        }
      }
    }
  });

program
  .command("explain")
  .description("Explain effective context for an agent and directory")
  .argument("[dir]", "Target directory", process.cwd())
  .option("--agent <agent>", "Target agent", "claude-code")
  .option("--json", "Output results as JSON")
  .option("--show-secrets", "Do not redact secrets in output", false)
  .action(async (dir, options) => {
    const targetDir = path.resolve(dir);
    const env = createNodeEnv(targetDir);
    const provider = registry.get(options.agent);

    if (!provider) {
      console.error(pc.red(`Error: Unknown agent provider '${options.agent}'.`));
      console.error(
        `Available: ${registry
          .list()
          .map((p) => p.id)
          .join(", ")}`,
      );
      process.exit(2);
    }

    const artifacts = await provider.discover(env, { dir: targetDir });
    const resolved = provider.resolve(env, targetDir, artifacts);

    if (options.json) {
      console.log(renderJson(resolved, options.showSecrets));
    } else {
      console.log(renderTree(resolved));
    }
  });

program.parse();
