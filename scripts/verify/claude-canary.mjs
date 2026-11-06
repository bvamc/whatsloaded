#!/usr/bin/env node
// M0-3: Empirically verify Claude Code context-loading facts using canary tokens.
// Usage: node scripts/verify/claude-canary.mjs [--keep] [--dry-run]
// Requires: a logged-in `claude` CLI. Builds a throwaway fixture under the OS temp dir;
// it never writes to ~/.claude. Note: running `claude -p` makes Claude Code itself record
// the temp project in ~/.claude.json and write a transcript under ~/.claude/projects.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = new Set(process.argv.slice(2));
const ROOT = fs.realpathSync(os.tmpdir()) + "/wl-canary-" + Date.now();
const TOP = ROOT;                      // above the git root
const OUTER = `${ROOT}/outer`;         // ancestor, above the git root
const REPO = `${OUTER}/repo`;          // git root
const CWD = `${REPO}/app`;             // where claude runs
const PERSONAL_SKILL = pickPersonalSkill();

function w(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); }
function skill(dir, name, desc) { w(`${dir}/${name}/SKILL.md`, `---\nname: ${name}\ndescription: ${desc}\n---\n\nBody of ${name}.\n`); }
function pickPersonalSkill() {
  const d = path.join(os.homedir(), ".claude/skills");
  try { return fs.readdirSync(d).find((n) => fs.existsSync(path.join(d, n, "SKILL.md"))) ?? null; } catch { return null; }
}

// Each expectation: token, the fact it tests, and what the docs predict.
const facts = [
  ["CANARY-TOP",          "ancestor walk continues above the git root (2 levels)", "unknown"],
  ["CANARY-OUTER",        "ancestor walk continues above the git root (1 level)",  "unknown"],
  ["CANARY-REPO",         "git-root CLAUDE.md loaded when cwd is a subdir",          "loaded"],
  ["CANARY-REPO-DOTCLAUDE","repo .claude/CLAUDE.md loaded alongside CLAUDE.md",     "loaded"],
  ["CANARY-LOCAL",        "CLAUDE.local.md loaded",                                  "loaded"],
  ["CANARY-CWD",          "cwd CLAUDE.md loaded",                                    "loaded"],
  ["CANARY-NESTED",       "descendant CLAUDE.md NOT loaded at start (lazy)",         "absent"],
  ["CANARY-IMP1",         "@import hop 1",                                           "loaded"],
  ["CANARY-IMP2",         "@import hop 2",                                           "loaded"],
  ["CANARY-IMP3",         "@import hop 3",                                           "loaded"],
  ["CANARY-IMP4",         "@import hop 4",                                           "loaded"],
  ["CANARY-IMP5",         "@import hop 5 (beyond documented max of 4)",              "absent"],
  ["CANARY-CODEBLOCK",    "@import inside a code block is ignored",                  "absent"],
  ["CANARY-RULE-ALWAYS",  ".claude/rules/*.md without paths: loaded",                "loaded"],
  ["CANARY-RULE-SCOPED",  ".claude/rules/*.md with paths: NOT loaded at start",      "absent"],
  ["CANARY-RULE-SYMLINK", "symlinked rule file loaded",                              "unknown"],
  ["CANARY-RULE-CWD",     "cwd-level .claude/rules loaded (not just git root)",      "unknown"],
  ["CANARY-SKILL-ROOT",   "git-root .claude/skills discovered from a subdir cwd",    "loaded"],
  ["CANARY-SKILL-CWD",    "cwd .claude/skills discovered",                           "unknown"],
  ["CANARY-SKILL-NESTED", "descendant .claude/skills NOT discovered at start",       "unknown"],
  ["CANARY-SKILL-SHADOW", `project skill named '${PERSONAL_SKILL}' is shadowed by the personal one`, "absent"],
  ["CANARY-CMD-SHADOW",   "legacy command with the same name as a skill is hidden (skill wins)", "absent"],
  ["CANARY-AGENT-PROJECT","project subagent visible",                                "loaded"],
];

function build() {
  w(`${TOP}/CLAUDE.md`, "CANARY-TOP\n");
  w(`${OUTER}/CLAUDE.md`, "CANARY-OUTER\n");
  fs.mkdirSync(REPO, { recursive: true });
  execFileSync("git", ["init", "-q", REPO]);
  w(`${REPO}/CLAUDE.md`, "CANARY-REPO\n\nSee @docs/imp1.md\n\n```\n@docs/codeblock.md\n```\n");
  w(`${REPO}/.claude/CLAUDE.md`, "CANARY-REPO-DOTCLAUDE\n");
  w(`${REPO}/CLAUDE.local.md`, "CANARY-LOCAL\n");
  for (let i = 1; i <= 5; i++) w(`${REPO}/docs/imp${i}.md`, `CANARY-IMP${i}\n${i < 5 ? `@imp${i + 1}.md\n` : ""}`);
  w(`${REPO}/docs/codeblock.md`, "CANARY-CODEBLOCK\n");
  w(`${REPO}/.claude/rules/always.md`, "CANARY-RULE-ALWAYS\n");
  w(`${REPO}/.claude/rules/scoped.md`, "---\npaths:\n  - \"src/**/*.zig\"\n---\nCANARY-RULE-SCOPED\n");
  w(`${REPO}/shared/linked.md`, "CANARY-RULE-SYMLINK\n");
  fs.symlinkSync("../../shared/linked.md", `${REPO}/.claude/rules/linked.md`);
  w(`${CWD}/CLAUDE.md`, "CANARY-CWD\n");
  w(`${CWD}/.claude/rules/cwd.md`, "CANARY-RULE-CWD\n");
  w(`${CWD}/deep/CLAUDE.md`, "CANARY-NESTED\n");
  skill(`${REPO}/.claude/skills`, "wl-root-skill", "CANARY-SKILL-ROOT test skill.");
  skill(`${CWD}/.claude/skills`, "wl-cwd-skill", "CANARY-SKILL-CWD test skill.");
  skill(`${CWD}/deep/.claude/skills`, "wl-nested-skill", "CANARY-SKILL-NESTED test skill.");
  if (PERSONAL_SKILL) skill(`${REPO}/.claude/skills`, PERSONAL_SKILL, "CANARY-SKILL-SHADOW project copy.");
  w(`${REPO}/.claude/commands/wl-root-skill.md`, "---\ndescription: CANARY-CMD-SHADOW legacy command\n---\nDo nothing.\n");
  w(`${REPO}/.claude/agents/wl-agent.md`, "---\nname: wl-agent\ndescription: CANARY-AGENT-PROJECT test subagent.\n---\nYou are a test agent.\n");
  w(`${REPO}/.mcp.json`, JSON.stringify({ mcpServers: { "wl-unapproved": { command: "true" } } }, null, 2));
}

const PROMPT = [
  "This is an automated configuration test. Do NOT use any tools and do NOT read any files.",
  "1) List every token that starts with CANARY- appearing anywhere in your current context",
  "(system prompt, memory/CLAUDE.md content, rules, skill descriptions, subagent descriptions, command descriptions).",
  "Output each token verbatim on its own line under the heading TOKENS:.",
  "2) Under the heading SKILLS:, list the name of every skill or slash command available to you, one per line.",
  "3) Under the heading AGENTS:, list every subagent type available to you, one per line.",
  "Output nothing else.",
].join(" ");

function run() {
  const r = spawnSync("claude", ["-p", PROMPT, "--max-turns", "1"], { cwd: CWD, encoding: "utf8", timeout: 180_000 });
  const mcp = spawnSync("claude", ["mcp", "list"], { cwd: CWD, encoding: "utf8", timeout: 60_000 });
  return { out: (r.stdout ?? "") + (r.stderr ?? ""), mcp: (mcp.stdout ?? "") + (mcp.stderr ?? "") };
}

build();
console.log(`fixture: ${ROOT}\npersonal skill used for shadow test: ${PERSONAL_SKILL ?? "(none found)"}`);
if (args.has("--dry-run")) process.exit(0);

const version = execFileSync("claude", ["--version"], { encoding: "utf8" }).trim();
const { out, mcp } = run();
if (/not logged in/i.test(out)) { console.error("claude is not logged in. Run `claude` then /login, and retry."); process.exit(3); }
const seen = new Set(out.match(/CANARY-[A-Z0-9-]+/g) ?? []);
const rows = facts.map(([tok, fact, expected]) => {
  const got = seen.has(tok) ? "loaded" : "absent";
  const verdict = expected === "unknown" ? "observed" : got === expected ? "matches docs" : "CONTRADICTS docs";
  return { token: tok, fact, expected, observed: got, verdict };
});
const result = { date: new Date().toISOString(), claudeVersion: version, fixture: ROOT, rows, rawOutput: out, mcpList: mcp };
const outDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "results");
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `claude-${version.split(" ")[0]}-${Date.now()}.json`);
fs.writeFileSync(file, JSON.stringify(result, null, 2));
console.table(rows.map(({ token, observed, verdict }) => ({ token, observed, verdict })));
console.log("\nclaude mcp list:\n" + mcp + `\nSaved ${file}`);
if (!args.has("--keep")) fs.rmSync(ROOT, { recursive: true, force: true });
