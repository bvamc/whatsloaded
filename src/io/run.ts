/**
 * Runs an installer's command (e.g. `claude plugin install x@y`) after the person has seen and
 * confirmed it. Commands never go through a shell: argv is passed as is, and every word must be
 * one that every shell reads literally, so the text shown is exactly what runs.
 */
import { spawn } from 'node:child_process';
import { redactText } from '../core/redact.js';

// Plain ASCII words only: no spaces, quotes, globbing, variables, pipes, redirects, escapes, or
// control and invisible characters (which would make the shown text differ from what runs).
const WORD = /^[A-Za-z0-9@/:._+=,-]+$/;
/** A value put into a command (a package or plugin name): never read as an option. */
export const COMMAND_VALUE = /^[A-Za-z0-9][A-Za-z0-9@/:._+=-]{0,199}$/;

export class UnsafeCommandError extends Error {}

export function checkArgv(argv: readonly string[]): void {
  if (!argv.length || argv.length > 64) throw new UnsafeCommandError('a command needs 1-64 words');
  for (const a of argv) {
    if (!WORD.test(a)) throw new UnsafeCommandError(`not a plain command word: ${JSON.stringify(a.slice(0, 80))}`);
  }
}

/** The exact text that runs. */
export function commandText(argv: readonly string[]): string {
  checkArgv(argv);
  return argv.join(' ');
}

/** Fill `{name}`-style placeholders; each value must be a plain name, never an option or a path trick. */
export function fillArgv(template: readonly string[], values: Record<string, string | undefined>): string[] {
  return template.map((w) =>
    w.replace(/\{(\w+)\}/g, (_, k: string) => {
      const v = values[k];
      if (v === undefined || !COMMAND_VALUE.test(v)) throw new UnsafeCommandError(`cannot put ${JSON.stringify(v ?? '')} into a command`);
      return v;
    }),
  );
}

export interface RunResult {
  code: number | null;
  timedOut: boolean;
  /** The last part of stdout and stderr together, secrets redacted. */
  output: string;
  ms: number;
}

const MAX_OUTPUT = 64 * 1024;

export function runCommand(
  argv: readonly string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; onOutput?: (chunk: string) => void },
): Promise<RunResult> {
  checkArgv(argv);
  const started = Date.now();
  return new Promise((done) => {
    let out = '';
    let timedOut = false;
    const child = spawn(argv[0]!, argv.slice(1), { cwd: opts.cwd, env: opts.env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const take = (b: Buffer) => {
      const s = b.toString('utf8');
      out = (out + s).slice(-MAX_OUTPUT);
      opts.onOutput?.(redactText(s));
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 3000).unref();
    }, opts.timeoutMs);
    const finish = (code: number | null) => {
      clearTimeout(timer);
      done({ code, timedOut, output: redactText(out), ms: Date.now() - started });
    };
    child.on('error', (e) => {
      out += `\n${(e as NodeJS.ErrnoException).code === 'ENOENT' ? `${argv[0]} is not installed or not on PATH` : e.message}`;
      finish(null);
    });
    child.on('close', (code) => finish(code));
  });
}
