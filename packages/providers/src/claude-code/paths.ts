import path from "node:path";
import type { Env } from "@whatsloaded/core";

export function getClaudeConfigDir(env: Env): string {
  if (env.vars.CLAUDE_CONFIG_DIR) {
    return path.resolve(env.vars.CLAUDE_CONFIG_DIR);
  }
  return path.join(env.home, ".claude");
}

export function getManagedConfigDir(env: Env): string | null {
  if (env.managedRoot) {
    return env.managedRoot;
  }
  switch (env.platform) {
    case "darwin":
      return "/Library/Application Support/ClaudeCode";
    case "linux":
      return "/etc/claude-code";
    case "win32":
      return "C:\\Program Files\\ClaudeCode";
    default:
      return null;
  }
}
