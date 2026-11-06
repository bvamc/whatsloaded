#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { NodeReadonlyFs } from "@whatsloaded/core";
import { ClaudeCodeProvider } from "@whatsloaded/providers";
import { performance } from "node:perf_hooks";

const RUNS = 20;
const targetDir = process.cwd();
const env = {
  home: os.homedir(),
  platform: process.platform,
  vars: process.env,
  cwd: targetDir,
  fs: new NodeReadonlyFs(),
  which: async () => null,
};
const provider = new ClaudeCodeProvider();

console.log(`Running benchmark on ${targetDir} (${RUNS} iterations)...`);

// Warmup
const warmupArtifacts = await provider.discover(env, { dir: targetDir });
provider.resolve(env, targetDir, warmupArtifacts);

const durations = [];

for (let i = 0; i < RUNS; i++) {
  const start = performance.now();
  const artifacts = await provider.discover(env, { dir: targetDir });
  provider.resolve(env, targetDir, artifacts);
  const end = performance.now();
  durations.push(end - start);
}

durations.sort((a, b) => a - b);
const p50 = durations[Math.floor(RUNS * 0.5)];
const p95 = durations[Math.floor(RUNS * 0.95)];
const min = durations[0];
const max = durations[RUNS - 1];

console.log(`Benchmark Results:`);
console.log(`  p50: ${p50.toFixed(2)} ms`);
console.log(`  p95: ${p95.toFixed(2)} ms`);
console.log(`  min: ${min.toFixed(2)} ms`);
console.log(`  max: ${max.toFixed(2)} ms`);

if (p50 > 500) {
  console.error(`FAILURE: p50 latency exceeded 500ms budget (${p50.toFixed(2)} ms)`);
  process.exit(1);
} else {
  console.log(`SUCCESS: p50 latency is well within budget (< 500 ms)`);
}
