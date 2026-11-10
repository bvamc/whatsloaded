/**
 * Who installed the program an MCP server runs, and the command that uninstalls it.
 * Only public package managers are known here; providers add organisation-specific ones.
 * Nothing is executed: this reads the resolved path and the configured command.
 */
import type { Installer, Item } from '../model.js';

export type { Installer };

const pkgAfter = (args: string[], flagsWithValue: string[] = []) => {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (flagsWithValue.includes(a)) {
      i++;
      continue;
    }
    if (a.startsWith('--package=')) return a.slice(10);
    if (a === '-p' || a === '--package') return args[i + 1];
    if (!a.startsWith('-')) return a;
  }
  return undefined;
};

export function detectInstaller(i: Item): Installer | undefined {
  const s = i.mcp;
  if (!s) return undefined;
  if (s.transport !== 'stdio') return { by: `remote (${s.url ? new URL(s.url).host : 'URL'})`, onDemand: true };
  const cmd = (s.command ?? '').split(/[\\/]/).at(-1) ?? '';
  const args = s.args ?? [];
  if (['npx', 'bunx'].includes(cmd) || (cmd === 'pnpm' && args[0] === 'dlx')) {
    const pkg = pkgAfter(cmd === 'pnpm' ? args.slice(1) : args);
    return { by: `${cmd === 'pnpm' ? 'pnpm dlx' : cmd} (downloads ${pkg ?? 'the package'} on each start)`, onDemand: true };
  }
  if (cmd === 'uvx' || (cmd === 'uv' && args[0] === 'tool' && args[1] === 'run')) {
    return {
      by: `uvx (downloads ${pkgAfter(cmd === 'uv' ? args.slice(2) : args, ['--from']) ?? 'the package'} on each start)`,
      onDemand: true,
    };
  }
  if (cmd === 'docker' || cmd === 'podman') return { by: `${cmd} image`, onDemand: true };
  // An interpreter running a script: the server is the script, not the interpreter. Never suggest
  // uninstalling node or python because a server happens to run on them.
  if (/^(node|nodejs|bun|deno|python3?|ruby|perl|php|java)$/.test(cmd)) {
    const script = args.find((a) => !a.startsWith('-'));
    return { by: script ? `a ${cmd} script (${script})` : cmd };
  }
  const real = i.runtime?.realpath ?? i.runtime?.resolved;
  if (!real) return undefined;
  const brew = real.match(/\/Cellar\/([^/]+)\//);
  if (brew) return { by: 'Homebrew', uninstall: `brew uninstall ${brew[1]}` };
  const npm = real.match(/\/lib\/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
  if (npm) return { by: 'npm (global)', uninstall: `npm uninstall -g ${npm[1]}` };
  const pipx = real.match(/\/pipx\/venvs\/([^/]+)\//);
  if (pipx) return { by: 'pipx', uninstall: `pipx uninstall ${pipx[1]}` };
  if (/\/\.cargo\/bin\//.test(real)) return { by: 'cargo', uninstall: `cargo uninstall ${cmd}` };
  return undefined;
}
