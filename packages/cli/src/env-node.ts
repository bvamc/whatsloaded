import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { type Env, NodeReadonlyFs } from "@whatsloaded/core";

export function createNodeEnv(cwd: string = process.cwd()): Env {
  return {
    home: os.homedir(),
    platform: process.platform,
    vars: process.env,
    cwd: path.resolve(cwd),
    fs: new NodeReadonlyFs(),
    which: async (cmd: string) => {
      const paths = (process.env.PATH ?? "").split(path.delimiter);
      const fs = new NodeReadonlyFs();
      for (const p of paths) {
        const full = path.join(p, cmd);
        if (await fs.exists(full)) {
          return full;
        }
      }
      return null;
    },
    exec: (cmd: string, args: string[], timeoutMs: number) => {
      return new Promise((resolve) => {
        const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
        let stdout = "";
        const timer = setTimeout(() => {
          child.kill();
          resolve({ stdout: "", code: 124 });
        }, timeoutMs);

        child.stdout?.on("data", (d) => {
          stdout += d.toString();
        });

        child.on("close", (code) => {
          clearTimeout(timer);
          resolve({ stdout, code: code ?? 0 });
        });

        child.on("error", () => {
          clearTimeout(timer);
          resolve({ stdout: "", code: 1 });
        });
      });
    },
  };
}
