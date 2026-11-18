import { KeyRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { CatalogEntry, InstallMethod, McpSpec, StateDTO } from '../api';
import { cn } from '../lib/meta';
import { usePlans } from '../store';
import { HarnessDot } from './atoms';
import { Button, Input, Modal } from './ui';

type McpMethod = Extract<InstallMethod, { type: 'mcp' }>;

/**
 * Add a catalog MCP server to the tools you pick: choose how it runs, fill in what it needs,
 * then review the exact change (a diff, undoable) like any other edit.
 */
export function CatalogMcpDialog({ entry, state, onClose }: { entry: CatalogEntry; state: StateDTO; onClose: () => void }) {
  const { propose } = usePlans();
  const methods = entry.install.filter((m): m is McpMethod => m.type === 'mcp');
  const [pick, setPick] = useState(0);
  const method = methods[pick];
  const [name, setName] = useState(entry.name);
  const [values, setValues] = useState<Record<string, string>>({});
  const targets = state.adapters
    .filter((a) => a.detected && (a.writable.mcp ?? []).includes('user'))
    .map((a) => ({ id: a.id, label: a.label.split(' / ')[0]!, key: `${a.id}:user` }));
  const [chosen, setChosen] = useState<Set<string>>(new Set(targets.map((t) => t.key)));

  const inputs = method?.inputs ?? [];
  const missing = inputs.filter((i) => i.required && !values[i.name]?.trim());
  const spec = useMemo<McpSpec | undefined>(() => {
    if (!method) return undefined;
    const filled = (where: 'env' | 'header') =>
      Object.fromEntries(inputs.filter((i) => i.where === where && values[i.name]?.trim()).map((i) => [i.name, values[i.name]!.trim()]));
    const env = filled('env');
    const headers = filled('header');
    return method.spec.transport === 'stdio'
      ? { ...method.spec, ...(Object.keys(env).length ? { env } : {}) }
      : { ...method.spec, ...(Object.keys(headers).length ? { headers } : {}) };
  }, [method, inputs, values]);
  const ready = !!spec && /^[\w@.:/-]{1,80}$/.test(name.trim()) && chosen.size > 0 && !missing.length;

  const review = () => {
    if (!spec) return;
    onClose();
    propose({ action: 'add', refs: [], name: name.trim(), spec, targets: [...chosen] });
  };

  return (
    <Modal open onClose={onClose} title={`Add ${entry.name}`} wide>
      <div className="scroll-thin max-h-[68vh] space-y-5 overflow-y-auto p-5">
        <h2 className="font-display text-[22px] italic">
          Add <span className="font-mono not-italic">{entry.name}</span> to your tools
        </h2>

        {methods.length > 1 && (
          <section>
            <p className="mb-1.5 text-[13px] text-paper">How it runs</p>
            <div className="space-y-1.5">
              {methods.map((m, i) => (
                <label key={m.label} className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-white/8 px-3 py-2">
                  <input type="radio" checked={pick === i} onChange={() => setPick(i)} className="mt-1 accent-[var(--color-lume)]" />
                  <span className="min-w-0">
                    <span className="block text-[12.5px] text-paper-2">{m.label}</span>
                    <code className="block truncate font-mono text-[11px] text-paper-4">
                      {m.spec.transport === 'stdio' ? [m.spec.command, ...(m.spec.args ?? [])].join(' ') : m.spec.url}
                    </code>
                  </span>
                </label>
              ))}
            </div>
          </section>
        )}

        {inputs.length > 0 && (
          <section className="space-y-2.5">
            <p className="text-[13px] text-paper">What it needs</p>
            {inputs.map((i) => (
              <label key={`${i.where}:${i.name}`} className="block space-y-1">
                <span className="flex items-center gap-1.5 text-[12px] text-paper-3">
                  {i.secret && <KeyRound className="h-3 w-3 text-paper-4" />}
                  <span className="font-mono">{i.name}</span>
                  <span className="text-paper-4">
                    {i.where === 'header' ? 'header' : 'setting'}
                    {i.required ? ' · required' : ' · optional'}
                  </span>
                </span>
                <Input
                  type={i.secret ? 'password' : 'text'}
                  value={values[i.name] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [i.name]: e.target.value }))}
                  placeholder={i.description ?? ''}
                  autoComplete="off"
                />
              </label>
            ))}
            {inputs.some((i) => i.secret) && (
              <p className="text-[11.5px] text-paper-4">Secrets are written into each tool’s own config file, as the tool expects.</p>
            )}
          </section>
        )}

        <section className="space-y-2">
          <label className="block space-y-1">
            <span className="text-[12px] text-paper-3">Name in your tools</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <p className="text-[13px] text-paper">Add to</p>
          <div className="flex flex-wrap gap-2">
            {targets.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() =>
                  setChosen((c) => {
                    const n = new Set(c);
                    if (n.has(t.key)) n.delete(t.key);
                    else n.add(t.key);
                    return n;
                  })
                }
                className={cn(
                  'flex h-8 items-center gap-2 rounded-lg border px-3 text-[12.5px]',
                  chosen.has(t.key) ? 'border-lume/50 bg-lume/10 text-paper' : 'border-white/8 text-paper-3',
                )}
              >
                <HarnessDot id={t.id} size={7} dim={!chosen.has(t.key)} /> {t.label}
              </button>
            ))}
          </div>
        </section>
      </div>
      <footer className="flex items-center justify-end gap-2 border-t border-white/6 bg-ink-0/40 px-5 py-3">
        {missing.length > 0 && <span className="mr-auto text-[12px] text-paper-4">Fill in {missing.map((m) => m.name).join(', ')}</span>}
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={review} disabled={!ready}>
          Review changes
        </Button>
      </footer>
    </Modal>
  );
}
