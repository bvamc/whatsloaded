#!/usr/bin/env node
// M0-1 THROWAWAY PROTOTYPE: `whatsloaded explain` for Claude Code only.
// Zero dependencies. Read-only. Not the real architecture (see docs/IMPLEMENTATION-M0-M1.md §4).
// Usage: node scripts/proto/explain.mjs [dir] [--json] [--no-color]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const target = path.resolve(argv.find((a) => !a.startsWith("--")) ?? process.cwd());
const color = !flags.has("--no-color") && !flags.has("--json") && process.stdout.isTTY;
const c = (n) => (s) => (color ? `\x1b[${n}m${s}\x1b[0m` : String(s));
const dim = c(2), bold = c(1), red = c(31), yellow = c(33), green = c(32), cyan = c(36), strike = c(9);

// ---------- env ----------
const HOME = os.homedir();
const CONFIG = process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR) : path.join(HOME, ".claude");
const CLAUDE_JSON = [path.join(CONFIG, ".claude.json"), path.join(HOME, ".claude.json")].find(exists) ?? path.join(HOME, ".claude.json");
const MANAGED = { darwin: "/Library/Application Support/ClaudeCode", linux: "/etc/claude-code", win32: "C:\\Program Files\\ClaudeCode" }[process.platform];
const tilde = (p) => {
  if (!p) return p;
  if (root !== "/" && p.startsWith(root + path.sep)) return "./" + path.relative(root, p);
  return p.startsWith(HOME) ? "~" + p.slice(HOME.length) : p;
};
const findings = [];
const finding = (sev, id, msg, target) => findings.push({ sev, id, msg, target });

// ---------- fs helpers (read-only) ----------
function exists(p) { try { fs.statSync(p); return true; } catch { return false; } }
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function read(p) { try { return fs.readFileSync(p, "utf8"); } catch { return null; } }
function ls(p) { try { return fs.readdirSync(p, { withFileTypes: true }); } catch { return []; } }
function linkInfo(p) {
  try { if (fs.lstatSync(p).isSymbolicLink()) return { link: fs.readlinkSync(p), real: safeReal(p) }; } catch {}
  return null;
}
function safeReal(p) { try { return fs.realpathSync(p); } catch { return null; } }
function readJson(p, label) {
  const s = read(p);
  if (s == null) return null;
  try { return JSON.parse(s); } catch (e) { finding("error", "PARSE_ERROR", `${label ?? tilde(p)}: ${e.message}`); return null; }
}
function mdFiles(dir) {
  const out = [];
  const walk = (d) => { for (const e of ls(d)) { const p = path.join(d, e.name); if (isDir(p)) walk(p); else if (e.name.endsWith(".md")) out.push(p); } };
  walk(dir);
  return out.sort();
}
function ancestors(dir) { const out = []; let d = dir; for (;;) { out.unshift(d); const up = path.dirname(d); if (up === d) break; d = up; } return out; }
function gitRoot(dir) { for (const d of ancestors(dir).reverse()) if (exists(path.join(d, ".git"))) return d; return null; }

// ---------- tiny frontmatter parser (key: value, inline/block lists) ----------
function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text ?? "");
  if (!m) return { fm: null, body: text ?? "" };
  const fm = {}; let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    const li = /^\s*-\s+(.*)$/.exec(line);
    if (li && key) { (fm[key] = Array.isArray(fm[key]) ? fm[key] : []).push(unq(li[1])); continue; }
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) { key = kv[1]; const v = kv[2].trim(); fm[key] = v === "" ? [] : v.startsWith("[") ? v.slice(1, -1).split(",").map(unq).filter(Boolean) : unq(v); }
  }
  return { fm, body: text.slice(m[0].length) };
}
const unq = (s) => s.trim().replace(/^["']|["']$/g, "");

// ---------- @import expansion (docs: relative to containing file, max 4 hops, ignored in code) ----------
const MAX_IMPORT_DEPTH = 4;
function imports(text) {
  const stripped = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  const out = [];
  for (const m of stripped.matchAll(/(?:^|\s)@((?:\\ |[^\s"'`])+)/g)) {
    const raw = m[1].replace(/\\ /g, " ").replace(/[.,;:)]+$/, "");
    if (/^[\w.-]+@/.test(raw) || raw.includes("://")) continue;
    if (!/[/.~]/.test(raw)) continue; // skip @mentions like @alice
    out.push(raw);
  }
  return out;
}
function expandImports(file, depth, seen, sink) {
  const text = read(file) ?? "";
  for (const raw of imports(text)) {
    const p = raw.startsWith("~/") ? path.join(HOME, raw.slice(2)) : path.resolve(path.dirname(file), raw);
    if (depth + 1 > MAX_IMPORT_DEPTH) { sink.push({ path: p, depth: depth + 1, status: "too-deep" }); finding("warn", "IMPORT_DEPTH_EXCEEDED", `${tilde(file)} imports @${raw} beyond ${MAX_IMPORT_DEPTH} hops (not loaded)`); continue; }
    if (!exists(p)) { sink.push({ path: p, depth: depth + 1, status: "broken" }); finding("error", "IMPORT_BROKEN", `${tilde(file)}: @${raw} does not exist`); continue; }
    if (seen.has(p)) continue;
    seen.add(p);
    const bytes = Buffer.byteLength(read(p) ?? "");
    sink.push({ path: p, depth: depth + 1, status: "ok", bytes });
    expandImports(p, depth + 1, seen, sink);
  }
}

// ---------- discovery ----------
const root = gitRoot(target) ?? target;
const chain = ancestors(target);                           // / … target
const projectDirs = chain.filter((d) => d.startsWith(root)); // gitRoot … target

// Instructions (concat)
const instructions = [];
function addInstr(file, scope, reason, confidence = "documented") {
  if (!exists(file)) return;
  const bytes = Buffer.byteLength(read(file) ?? "");
  const imp = []; expandImports(file, 0, new Set([file]), imp);
  instructions.push({ path: file, scope, reason, confidence, bytes, imports: imp, link: linkInfo(file), mode: "always" });
}
if (MANAGED) addInstr(path.join(MANAGED, "CLAUDE.md"), "managed", "managed policy");
addInstr(path.join(CONFIG, "CLAUDE.md"), "user", "user memory");
for (const d of chain) {
  const scope = d === target ? "cwd" : d.startsWith(root) && root !== target ? (d === root ? "project-root" : "ancestor") : "ancestor";
  const conf = d.startsWith(root) ? "documented" : "inferred";
  addInstr(path.join(d, "CLAUDE.md"), scope, d === target ? "in working directory" : `ancestor of cwd${d.startsWith(root) ? "" : " (above git root)"}`, conf);
  addInstr(path.join(d, ".claude", "CLAUDE.md"), scope, "ancestor .claude/CLAUDE.md", conf);
  addInstr(path.join(d, "CLAUDE.local.md"), scope, "local (personal, usually gitignored)", conf);
}
// Rules
const rules = [];
function addRules(dir, scope, confidence) {
  for (const f of mdFiles(dir)) {
    const { fm } = frontmatter(read(f));
    const paths = fm?.paths ? [].concat(fm.paths) : null;
    rules.push({ path: f, scope, confidence, bytes: Buffer.byteLength(read(f) ?? ""), mode: paths ? `when editing ${paths.join(", ")}` : "always", link: linkInfo(f) });
  }
}
addRules(path.join(CONFIG, "rules"), "user", "inferred");
for (const d of projectDirs) addRules(path.join(d, ".claude", "rules"), d === root ? "project" : "subdir", d === root ? "documented" : "inferred");
// Auto memory: ~/.claude/projects/<cwd with non-alphanumerics → '-'>/memory/MEMORY.md
for (const d of new Set([target, root])) addInstr(path.join(CONFIG, "projects", d.replace(/[^A-Za-z0-9]/g, "-"), "memory", "MEMORY.md"), "auto-memory", "auto memory index (written by Claude)", "inferred");
// Lazy descendants
const lazy = [];
(function scan(d, budget = { n: 0 }) {
  if (budget.n++ > 3000) { finding("info", "LIMIT_EXCEEDED", `stopped scanning descendants of ${tilde(target)} after 3000 dirs`); return; }
  for (const e of ls(d)) {
    if (!e.isDirectory() || ["node_modules", ".git", "dist", "build", ".venv", "target", ".next"].includes(e.name)) continue;
    const sub = path.join(d, e.name);
    for (const n of ["CLAUDE.md", ".claude/CLAUDE.md"]) if (exists(path.join(sub, n))) lazy.push(path.join(sub, n));
    scan(sub, budget);
  }
})(target);

// Skills + commands (override: managed > personal > project; skill beats same-name command)
function readSkills(dir, scope, confidence = "documented") {
  return ls(dir).filter((e) => isDir(path.join(dir, e.name)) || e.isSymbolicLink()).map((e) => {
    const p = path.join(dir, e.name), file = path.join(p, "SKILL.md");
    const link = linkInfo(p);
    if (link && !link.real) { finding("error", "SKILL_BROKEN_SYMLINK", `skill '${e.name}' is ignored: ${tilde(p)} → ${tilde(link.link)} (target missing)`, link.link); return null; }
    if (!isDir(p)) return null;
    const fileLink = linkInfo(file);
    if (fileLink && !fileLink.real) { finding("error", "SKILL_BROKEN_SYMLINK", `skill '${e.name}' is ignored: SKILL.md → ${tilde(fileLink.link)} (target missing)`, fileLink.link); return null; }
    if (!exists(file)) { finding("warn", "SKILL_NO_SKILL_MD", `${tilde(p)} has no SKILL.md (ignored by Claude Code)`); return null; }
    const { fm } = frontmatter(read(file));
    const name = fm?.name || e.name;
    if (!fm?.description) finding("error", "SKILL_MISSING_FRONTMATTER", `${tilde(file)} lacks a description (it can't be auto-invoked)`);
    if (fm?.name && fm.name !== e.name) finding("warn", "SKILL_NAME_MISMATCH", `${tilde(file)}: name '${fm.name}' ≠ dir '${e.name}'`);
    return { kind: "skill", name, scope, confidence, path: file, link, desc: fm?.description ?? "", flags: [fm?.paths && "conditional: paths", fm?.["disable-model-invocation"] === "true" && "user-invoked only"].filter(Boolean) };
  }).filter(Boolean);
}
function readCommands(dir, scope) {
  return mdFiles(dir).map((f) => ({ kind: "command", name: path.relative(dir, f).replace(/\.md$/, "").split(path.sep).join(":"), scope, confidence: "documented", path: f, link: linkInfo(f), desc: frontmatter(read(f)).fm?.description ?? "" }));
}
const skillCandidates = [
  ...(MANAGED ? readSkills(path.join(MANAGED, ".claude", "skills"), "managed", "inferred") : []),
  ...readSkills(path.join(CONFIG, "skills"), "user"),
  ...projectDirs.slice().reverse().flatMap((d) => readSkills(path.join(d, ".claude", "skills"), d === root ? "project" : "subdir", d === root ? "documented" : "inferred")),
];
const commandCandidates = [readCommands(path.join(CONFIG, "commands"), "user"), ...projectDirs.map((d) => readCommands(path.join(d, ".claude", "commands"), "project"))].flat();
const SKILL_ORDER = ["managed", "user", "project", "subdir"];
const skills = resolveOverride(skillCandidates, SKILL_ORDER, "claude.skills.managed>personal>project");
for (const cmd of commandCandidates) {
  const sk = skills.effective.find((s) => s.name === cmd.name);
  if (sk) skills.shadowed.push({ ...cmd, by: sk, rule: "claude.commands.skill-wins" });
  else skills.effective.push(cmd);
}
// Subagents (override: managed > project > user)
function readAgents(dir, scope) {
  return mdFiles(dir).map((f) => { const { fm } = frontmatter(read(f)); return { kind: "subagent", name: fm?.name || path.basename(f, ".md"), scope, confidence: "documented", path: f, link: linkInfo(f), desc: fm?.description ?? "" }; });
}
const agents = resolveOverride([
  ...(MANAGED ? readAgents(path.join(MANAGED, ".claude", "agents"), "managed") : []),
  ...projectDirs.flatMap((d) => readAgents(path.join(d, ".claude", "agents"), "project")),
  ...readAgents(path.join(CONFIG, "agents"), "user"),
], ["managed", "project", "user"], "claude.subagents.project>user");

// Settings layers + hooks
const settingsLayers = [
  ["managed", MANAGED && path.join(MANAGED, "managed-settings.json")],
  ["local", path.join(root, ".claude", "settings.local.json")],
  ["project", path.join(root, ".claude", "settings.json")],
  ["user", path.join(CONFIG, "settings.json")],
].filter(([, p]) => p && exists(p)).map(([scope, p]) => {
  const j = readJson(p) ?? {};
  const hooks = Object.entries(j.hooks ?? {}).reduce((n, [, groups]) => n + [].concat(groups).reduce((m, g) => m + (g?.hooks?.length ?? 1), 0), 0);
  return { scope, path: p, json: j, hooks, hookEvents: Object.keys(j.hooks ?? {}) };
});
const setting = (key) => settingsLayers.map((l) => l.json[key]).find((v) => v !== undefined);

// MCP (override: managed > local > project > user)
const cj = readJson(CLAUDE_JSON, "~/.claude.json") ?? {};
const projEntry = cj.projects?.[root] ?? cj.projects?.[target] ?? {};
const projectMcp = readJson(path.join(root, ".mcp.json"));
const enabled = new Set([...(setting("enabledMcpjsonServers") ?? []), ...(projEntry.enabledMcpjsonServers ?? [])]);
const disabled = new Set([...(setting("disabledMcpjsonServers") ?? []), ...(projEntry.disabledMcpjsonServers ?? [])]);
const allProject = setting("enableAllProjectMcpServers") ?? projEntry.enableAllProjectMcpServers ?? false;
const mcpDefs = (obj, scope, file) => Object.entries(obj ?? {}).map(([name, def]) => ({ kind: "mcp", name, scope, confidence: "documented", path: file, def,
  approval: scope !== "project" ? "n/a" : disabled.has(name) ? "denied" : enabled.has(name) || allProject ? "approved" : "pending" }));
const mcp = resolveOverride([
  ...(MANAGED ? mcpDefs(readJson(path.join(MANAGED, "managed-mcp.json"))?.mcpServers, "managed", path.join(MANAGED, "managed-mcp.json")) : []),
  ...mcpDefs(projEntry.mcpServers, "local", `${CLAUDE_JSON}#projects[${tilde(root)}]`),
  ...mcpDefs(projectMcp?.mcpServers, "project", path.join(root, ".mcp.json")),
  ...mcpDefs(cj.mcpServers, "user", `${CLAUDE_JSON}#mcpServers`),
], ["managed", "local", "project", "user"], "claude.mcp.managed>local>project>user");
for (const s of mcp.effective) {
  const cmd = s.def?.command;
  if (cmd && !cmd.includes("/") && !onPath(cmd)) finding("error", "MCP_COMMAND_NOT_FOUND", `MCP '${s.name}' (${s.scope}): '${cmd}' is not on PATH`);
  if (s.approval === "pending") finding("info", "MCP_PENDING_APPROVAL", `MCP '${s.name}' in .mcp.json isn't approved yet. Claude Code won't start it until you approve it`);
  for (const [k, v] of Object.entries(s.def?.env ?? {})) {
    const ref = /\$\{?([A-Z0-9_]+)/.exec(String(v));
    if (ref && process.env[ref[1]] === undefined) finding("warn", "MCP_ENV_UNSET", `MCP '${s.name}': env ${k} references \${${ref[1]}}, which is unset in this shell`);
  }
}
function onPath(cmd) { return (process.env.PATH ?? "").split(path.delimiter).some((d) => exists(path.join(d, cmd))); }

// ---------- generic override resolver ----------
function resolveOverride(items, order, rule) {
  const sorted = items.slice().sort((a, b) => order.indexOf(a.scope) - order.indexOf(b.scope));
  const effective = [], shadowed = [];
  for (const it of sorted) {
    const winner = effective.find((e) => e.name === it.name);
    if (winner) shadowed.push({ ...it, by: winner, rule }); else effective.push(it);
  }
  return { effective, shadowed };
}

// ---------- cross-checks ----------
const byName = new Map();
for (const s of skillCandidates) (byName.get(s.name) ?? byName.set(s.name, []).get(s.name)).push(s);
const totalBytes = [...instructions, ...rules.filter((r) => r.mode === "always")].reduce((n, i) => n + i.bytes + (i.imports ?? []).reduce((m, x) => m + (x.bytes ?? 0), 0), 0);
if (totalBytes > 40_000) finding("warn", "INSTRUCTIONS_LARGE", `always-loaded instructions total ${(totalBytes / 1024).toFixed(1)} KB (≈${Math.round(totalBytes / 4 / 1000)}k tokens) every session`);
for (const s of skills.shadowed.filter((x) => x.kind === "skill")) finding("warn", "SKILL_SHADOWED", `project skill '${s.name}' is ignored: your personal skill of the same name wins (${tilde(s.by.path)})`);
for (const a of agents.shadowed) finding("info", "SUBAGENT_SHADOWED", `user subagent '${a.name}' is overridden by the project's copy (${tilde(a.by.path)})`);

// ---------- output ----------
const result = { agent: "claude-code", dir: target, gitRoot: root, configDir: CONFIG, instructions, rules, lazy, skills, agents, mcp, settings: settingsLayers.map(({ json, ...l }) => l), totals: { instructionBytes: totalBytes, approxTokens: Math.round(totalBytes / 4) }, findings };
if (flags.has("--json")) {
  const redact = (k, v) => (k === "env" || k === "headers") && v && typeof v === "object" ? Object.fromEntries(Object.keys(v).map((x) => [x, "•••"])) : k === "by" ? v?.path : v;
  console.log(JSON.stringify(result, redact, 2));
  process.exit(0);
}

const out = [];
const P = (s = "") => out.push(s);
const link = (x) => (x?.link ? dim(` → ${tilde(x.link.real ?? x.link.link)} (symlink)`) : "");
const conf = (x) => (x.confidence === "inferred" ? yellow(" [inferred]") : "");
const pad = (s, n) => String(s).padEnd(n);
P(`${bold("Claude Code")} · ${tilde(target)}${root !== target ? dim(` (git root ${tilde(root)})`) : ""} · ${dim("config " + tilde(CONFIG))}`);
P(dim("whatsloaded M0 prototype. Read-only. Precedence per docs/IMPLEMENTATION-M0-M1.md §2."));

P(); P(bold(`INSTRUCTIONS  `) + dim(`(${instructions.length} files + ${instructions.reduce((n, i) => n + i.imports.filter((x) => x.status === "ok").length, 0)} imports + ${rules.filter((r) => r.mode === "always").length} rules · ${(totalBytes / 1024).toFixed(1)} KB · ≈${(totalBytes / 4000).toFixed(1)}k tokens, loaded every session)`));
if (!instructions.length) P(dim("  (none)"));
instructions.forEach((i, n) => {
  P(`  ${n + 1} ${pad(i.scope, 13)}${tilde(i.path)}${link(i)}  ${dim(i.reason)}${conf(i)}`);
  for (const x of i.imports) P(`    ${"  ".repeat(x.depth - 1)}└ @${tilde(x.path)}  ${x.status === "ok" ? dim(`import · hop ${x.depth}`) : red(x.status)}`);
});
for (const r of rules) P(`  ${r.mode === "always" ? "•" : cyan("~")} ${pad("rule:" + r.scope, 13)}${tilde(r.path)}${link(r)}  ${r.mode === "always" ? dim("always") : cyan(r.mode)}${conf(r)}`);
for (const l of lazy.slice(0, 8)) P(`  ${cyan("~")} ${pad("nested", 13)}${tilde(l)}  ${cyan("lazy: loaded only when Claude reads files in that folder")}`);
if (lazy.length > 8) P(dim(`    … ${lazy.length - 8} more nested CLAUDE.md files`));

const section = (title, res, fmt) => {
  P(); P(bold(title) + dim(`  (${res.effective.length} effective${res.shadowed.length ? ` · ${res.shadowed.length} shadowed` : ""})`));
  if (!res.effective.length && !res.shadowed.length) P(dim("  (none)"));
  const groups = {};
  for (const e of res.effective) (groups[e.scope] ??= []).push(e);
  for (const [scope, items] of Object.entries(groups)) {
    if (items.length > 12 && !flags.has("--all")) {
      P(`  ${pad(scope, 9)}${items.length} items: ${items.slice(0, 10).map((x) => x.name + (x.link ? "*" : "")).join(", ")}, … ${dim("(--all to list; * = symlink)")}`);
    } else for (const e of items) P(`  ${pad(e.name, 28)} ${pad(e.scope, 9)}${fmt(e)}`);
  }
  for (const s of res.shadowed) P(`  ${red("✗")} ${strike(pad(s.name, 26))} ${pad(s.scope, 9)}${dim(tilde(s.path))}  ${red(`shadowed by ${s.by.scope}`)} ${dim(`(${s.rule})`)}`);
};
section("SKILLS & COMMANDS", skills, (e) => dim(tilde(e.path)) + link(e) + (e.kind === "command" ? dim(" [legacy command]") : "") + (e.flags?.length ? cyan(` [${e.flags.join(", ")}]`) : "") + conf(e));
section("SUBAGENTS", agents, (e) => dim(tilde(e.path)) + link(e));
section("MCP SERVERS", mcp, (e) => `${dim(e.def?.url ?? [e.def?.command, ...(e.def?.args ?? [])].join(" ").slice(0, 60))}  ${e.approval === "pending" ? yellow("pending approval") : e.approval === "denied" ? red("denied") : green("active")}`);

P(); P(bold("SETTINGS & HOOKS") + dim("  (scalars: highest wins · arrays & hooks: merged across layers)"));
if (!settingsLayers.length) P(dim("  (no settings files)"));
for (const l of settingsLayers) P(`  ${pad(l.scope, 9)}${tilde(l.path)}  ${l.hooks ? `${l.hooks} hook(s): ${l.hookEvents.join(", ")}` : dim("no hooks")}`);

P(); P(bold(`FINDINGS`) + dim(`  (${findings.length})`));
if (!findings.length) P(green("  ✓ nothing suspicious found"));
const icon = { error: red("✗"), warn: yellow("!"), info: cyan("i") };
// Group noisy findings: same id + same missing root (e.g. a deleted ~/gstack checkout) → one line.
const sorted = findings.sort((a, b) => ["error", "warn", "info"].indexOf(a.sev) - ["error", "warn", "info"].indexOf(b.sev));
const groups = new Map();
for (const f of sorted) {
  const rootOf = (t) => { let d = t; while (d && !exists(path.dirname(d)) && path.dirname(d) !== d) d = path.dirname(d); return d; };
  const key = f.target ? `${f.id}|${rootOf(path.resolve(f.target))}` : `${f.id}|${f.msg}`;
  (groups.get(key) ?? groups.set(key, []).get(key)).push(f);
}
for (const [key, fs_] of groups) {
  const f = fs_[0];
  if (fs_.length >= 4 && f.target) {
    const missing = key.split("|")[1];
    P(`  ${icon[f.sev]} ${dim(pad(f.id, 26))}${bold(`${fs_.length} skills are ignored`)} because ${tilde(missing)} no longer exists`);
    P(`    ${dim(fs_.map((x) => /'([^']+)'/.exec(x.msg)?.[1]).join(", "))}`);
  } else for (const x of fs_) P(`  ${icon[x.sev]} ${dim(pad(x.id, 26))}${x.msg}`);
}
P(); P(dim("Unobservable from config: user/plugin settings applied via CLI flags, claude.ai connectors, auto-memory contents beyond MEMORY.md."));
console.log(out.join("\n"));
