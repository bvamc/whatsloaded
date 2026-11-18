import { Layers, Plus, X } from 'lucide-react';
import { useState } from 'react';
import type { StateDTO, ToolLoadDTO } from '../api';
import { usePlans } from '../store';
import { Button, Input, Tip } from './ui';

/**
 * Profiles: save what a tool loads (or only what you used) under a name, and switch any tool
 * to it later. Every save, apply and delete goes through the normal review dialog.
 */
export function ProfilesBar({ t, state }: { t: ToolLoadDTO; state: StateDTO }) {
  const { propose } = usePlans();
  const [saving, setSaving] = useState<'current' | 'used'>();
  const [name, setName] = useState('');
  const keeps = (p: StateDTO['profiles'][number]) =>
    `keeps ${p.keep.mcp.length} servers · ${p.keep.skill.length} skills · ${p.keep.agent.length} agents · ${p.keep.plugin.length} plugins`;
  const save = () => {
    if (!saving || !name.trim()) return;
    propose({ action: 'profile-save', refs: [], name: name.trim(), harness: t.harness, from: saving });
    setSaving(undefined);
    setName('');
  };

  return (
    <div className="mt-5 flex flex-wrap items-center gap-2 rounded-xl border border-white/7 bg-ink-1/50 px-4 py-2.5">
      <Layers className="h-4 w-4 text-paper-4" />
      <span className="mr-1 text-[12.5px] text-paper-3">Profiles</span>
      {state.profiles.map((p) => (
        <span key={p.name} className="flex items-center overflow-hidden rounded-full border border-white/10">
          <Tip content={`${keeps(p)}${p.description ? `\n${p.description}` : ''}`}>
            <button
              type="button"
              onClick={() => propose({ action: 'profile-apply', refs: [], name: p.name, harness: t.harness })}
              className="h-7 px-3 font-mono text-[12px] text-paper-2 hover:bg-white/5 hover:text-paper"
            >
              Apply {p.name}
            </button>
          </Tip>
          <Tip content={`Delete profile ${p.name}`}>
            <button
              type="button"
              aria-label={`delete profile ${p.name}`}
              onClick={() => propose({ action: 'profile-delete', refs: [], name: p.name })}
              className="h-7 border-l border-white/10 px-2 text-paper-4 hover:bg-white/5 hover:text-bad"
            >
              <X className="h-3 w-3" />
            </button>
          </Tip>
        </span>
      ))}
      {!state.profiles.length && !saving && (
        <span className="text-[12px] text-paper-4">Save a setup to switch back to it in one click.</span>
      )}
      <div className="flex-1" />
      {saving ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={saving === 'used' ? 'lean' : 'full'}
            className="h-7 w-36"
            autoFocus
          />
          <Button size="sm" variant="primary" type="submit" disabled={!/^[\w.-]{1,40}$/.test(name.trim())}>
            Save
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setSaving(undefined)}>
            Cancel
          </Button>
        </form>
      ) : (
        <>
          <Button size="sm" onClick={() => setSaving('current')}>
            <Plus className="h-3.5 w-3.5" /> Save current setup
          </Button>
          {t.tracked && (
            <Button size="sm" onClick={() => setSaving('used')}>
              <Plus className="h-3.5 w-3.5" /> Save only what I used
            </Button>
          )}
        </>
      )}
    </div>
  );
}
