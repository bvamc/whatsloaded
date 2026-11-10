import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { contextChars } from '../src/core/load.js';
import { ref } from '../src/core/model.js';
import { planCopy } from '../src/core/ops.js';
import { inv, makeHome } from './fixture.js';

let h: ReturnType<typeof makeHome>;
beforeEach(() => {
  h = makeHome();
  writeFileSync(
    join(h.home, '.agents/.skill-lock.json'),
    JSON.stringify({
      version: 3,
      skills: {
        architect: {
          source: 'acme/skills',
          sourceType: 'github',
          sourceUrl: 'https://user:token@github.com/acme/skills.git',
          skillPath: 'pack/skills/architect/SKILL.md',
          installedAt: '2026-09-26T03:09:43.508Z',
          updatedAt: '2026-09-26T03:09:43.508Z',
        },
      },
    }),
  );
  writeFileSync(
    join(h.home, '.agents/skills/architect/SKILL.md'),
    '---\nname: architect\ndescription: Designs things\ndisable-model-invocation: true\n---\nLong body\n',
  );
});

const get = async (r: string) => (await inv(h.ctx)).items.find((i) => ref(i) === r)!;

describe('skills', () => {
  it('knows who installed a shared skill, also for the tools that link to it', async () => {
    const store = await get('agents:store/skill/architect');
    expect(store.provenance).toMatchObject({
      by: 'skills CLI',
      source: { repo: 'acme/skills', path: 'pack/skills/architect/SKILL.md' },
      installedAt: '2026-09-26T03:09:43.508Z',
    });
    expect(store.provenance?.source?.url).toBe('https://github.com/acme/skills.git'); // credentials stripped
    expect((await get('claude:user/skill/architect')).provenance?.by).toBe('skills CLI');
  });

  it('marks skills only you can start, which put nothing in context', async () => {
    const s = await get('claude:user/skill/architect');
    expect(s.skill).toMatchObject({ userOnly: true });
    expect(contextChars(s)).toBe(0);
    expect(contextChars(await get('claude:user/skill/local-skill'))).toBeGreaterThan(0);
  });

  it('adds a shared skill to opencode in the folder opencode reads (skills/)', async () => {
    const i = await inv(h.ctx);
    const store = i.items.find((x) => ref(x) === 'agents:store/skill/architect')!;
    const plan = planCopy(i, store, [{ harness: 'opencode', level: 'user' }]);
    expect(plan.changes[0]).toMatchObject({ op: 'symlink', path: join(h.home, '.config/opencode/skills/architect') });
  });
});
