#!/usr/bin/env node
import { CORE_VERSION } from "@whatsloaded/core";
import { Command } from "commander";
import pc from "picocolors";

const program = new Command();

program
  .name("whatsloaded")
  .description("See what your AI coding agents actually load — and why.")
  .version(CORE_VERSION);

program
  .command("scan")
  .description("Scan for installed AI coding tools and configurations")
  .action(() => {
    console.log(pc.bold(pc.cyan("whatsloaded scan")), `v${CORE_VERSION}`);
  });

program
  .command("explain")
  .description("Explain effective context for an agent and directory")
  .argument("[dir]", "Target directory", process.cwd())
  .action((dir) => {
    console.log(pc.bold(pc.green("whatsloaded explain")), "for", dir);
  });

program.parse();
