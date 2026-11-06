import type { Detection, Env } from "@whatsloaded/core";
import { getClaudeConfigDir, getManagedConfigDir } from "./paths.js";

export async function detectClaudeCode(env: Env): Promise<Detection> {
  const configRoots: string[] = [];

  const configDir = getClaudeConfigDir(env);
  if (await env.fs.exists(configDir)) {
    configRoots.push(configDir);
  }

  const managedDir = getManagedConfigDir(env);
  if (managedDir && (await env.fs.exists(managedDir))) {
    configRoots.push(managedDir);
  }

  const binPath = await env.which("claude");
  let version: string | undefined;

  if (binPath && env.exec) {
    try {
      const res = await env.exec("claude", ["--version"], 2000);
      if (res.code === 0 && res.stdout) {
        version = res.stdout.trim();
      }
    } catch {
      // Ignore execution failure
    }
  }

  const installed = Boolean(binPath || configRoots.length > 0);
  return {
    installed,
    version,
    configRoots,
  };
}
