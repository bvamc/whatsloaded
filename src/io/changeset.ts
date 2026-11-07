/**
 * Every mutation is a list of Changes, produced by adapters without touching the filesystem.
 *
 * Edits are *transforms* (text -> text), not precomputed after-images: at apply time we
 * re-read each file and re-run the transform, because files like ~/.claude.json are
 * rewritten by running agent sessions between `plan` and `apply`.
 *
 * Nothing is ever deleted: removed files/dirs are moved into the backup, and every applied
 * plan writes a manifest that `restore` replays in reverse.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createTwoFilesPatch } from 'diff';
import type { Ctx } from '../core/context.js';
import { isSymlink as isSymlinkPath, lexists, linkInfo, readText } from './fsx.js';

export type Change =
  /** Rewrite a file. Returning null deletes it (moved into the backup). */
  | { op: 'edit'; file: string; describe: string; transform: (before: string | null) => string | null }
  /** Create a symlink at `path` pointing to `target`. */
  | { op: 'symlink'; path: string; target: string; describe: string }
  /** Move a file/dir/symlink (used to park and unpark items). */
  | { op: 'move'; from: string; to: string; describe: string }
  /** Remove a file/dir/symlink by moving it into the backup. */
  | { op: 'trash'; path: string; describe: string };

export interface Preview {
  change: Change;
  diff?: string;
  error?: string;
}

export function preview(changes: Change[]): Preview[] {
  return changes.map((change) => {
    if (change.op !== 'edit') return { change };
    try {
      const before = readText(change.file);
      const after = change.transform(before);
      const diff = createTwoFilesPatch(
        change.file,
        change.file,
        before ?? '',
        after ?? '',
        before === null ? '(new file)' : '',
        after === null ? '(deleted)' : '',
        { context: 2 },
      );
      return { change, diff: diff.split('\n').slice(2).join('\n') };
    } catch (e) {
      return { change, error: (e as Error).message };
    }
  });
}

type Step =
  | { op: 'edit'; file: string; existed: boolean; backup?: string; mode?: number }
  | { op: 'symlink'; path: string }
  | { op: 'move'; from: string; to: string };

export interface BackupManifest {
  id: string;
  createdAt: string;
  label: string;
  steps: Step[];
  restoredAt?: string;
}

const backupsDir = (ctx: Ctx) => join(ctx.dataDir, 'backups');

function atomicWrite(file: string, content: string, mode?: number): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.whatsloaded-${process.pid}.tmp`;
  writeFileSync(tmp, content, mode === undefined ? undefined : { mode });
  renameSync(tmp, file);
}

/**
 * Move a path. Symlinks are re-created rather than renamed: a relative link like
 * `../../.agents/skills/x` would otherwise dangle once moved to a different depth.
 * Relative links stay relative (re-aimed from the new location), absolute stay absolute.
 */
function movePath(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  if (isSymlinkPath(from)) {
    const raw = readlinkSync(from);
    const target = isAbsolute(raw) ? raw : relative(dirname(to), resolve(dirname(from), raw));
    symlinkSync(target, to);
    unlinkSync(from);
    return;
  }
  try {
    renameSync(from, to);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
    cpSync(from, to, { recursive: true, verbatimSymlinks: true });
    rmSync(from, { recursive: true, force: true });
  }
}

export function apply(changes: Change[], ctx: Ctx, label: string): BackupManifest {
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 6)}`;
  const dir = join(backupsDir(ctx), id);
  mkdirSync(join(dir, 'files'), { recursive: true });
  const manifest: BackupManifest = { id, createdAt: new Date().toISOString(), label, steps: [] };
  const save = () => writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  save();

  for (const [n, c] of changes.entries()) {
    switch (c.op) {
      case 'edit': {
        const before = readText(c.file);
        const after = c.transform(before);
        if (after === before) break;
        const step: Step = { op: 'edit', file: c.file, existed: before !== null };
        if (before !== null) {
          step.backup = `files/${n}-${basename(c.file)}`;
          step.mode = statSync(c.file).mode & 0o777;
          writeFileSync(join(dir, step.backup), before);
        }
        manifest.steps.push(step);
        save();
        if (after === null) unlinkSync(c.file);
        else atomicWrite(c.file, after, step.mode);
        break;
      }
      case 'symlink': {
        const existing = linkInfo(c.path);
        if (existing && existing.target === resolve(dirname(c.path), c.target)) break;
        if (lexists(c.path)) throw new Error(`refusing to overwrite existing ${c.path}`);
        mkdirSync(dirname(c.path), { recursive: true });
        symlinkSync(c.target, c.path);
        manifest.steps.push({ op: 'symlink', path: c.path });
        save();
        break;
      }
      case 'move':
      case 'trash': {
        const from = c.op === 'move' ? c.from : c.path;
        const to = c.op === 'move' ? c.to : join(dir, 'trash', `${n}-${basename(c.path)}`);
        if (!lexists(from)) throw new Error(`nothing to move at ${from}`);
        if (lexists(to)) throw new Error(`refusing to overwrite existing ${to}`);
        movePath(from, to);
        manifest.steps.push({ op: 'move', from, to });
        save();
        break;
      }
    }
  }
  return manifest;
}

export function listBackups(ctx: Ctx): BackupManifest[] {
  const root = backupsDir(ctx);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .sort()
    .reverse()
    .flatMap((id) => {
      try {
        return [JSON.parse(readFileSync(join(root, id, 'manifest.json'), 'utf8')) as BackupManifest];
      } catch {
        return [];
      }
    });
}

/** Undo an applied plan by replaying its steps in reverse. */
export function restore(id: string, ctx: Ctx): BackupManifest {
  const dir = join(backupsDir(ctx), id);
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as BackupManifest;
  if (manifest.restoredAt) throw new Error(`backup ${id} was already restored at ${manifest.restoredAt}`);
  for (const s of [...manifest.steps].reverse()) {
    if (s.op === 'edit') {
      if (s.backup) atomicWrite(s.file, readFileSync(join(dir, s.backup), 'utf8'), s.mode);
      else if (existsSync(s.file)) unlinkSync(s.file);
    } else if (s.op === 'symlink') {
      if (linkInfo(s.path)) unlinkSync(s.path);
    } else {
      if (lexists(s.from)) throw new Error(`cannot restore ${s.from}: something now exists there`);
      movePath(s.to, s.from);
    }
  }
  manifest.restoredAt = new Date().toISOString();
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}
