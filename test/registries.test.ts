import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { methodsOf, publisherOf, registrySource } from '../src/catalog/mcpRegistry.js';
import { skillEntry } from '../src/catalog/skillsSh.js';
import { makeHome } from './fixture.js';

const servers = [
  {
    server: {
      name: 'io.github.acme/notes',
      description: 'Notes',
      version: '1.2.0',
      repository: { url: 'https://github.com/acme/notes' },
      packages: [
        {
          registryType: 'npm',
          identifier: '@acme/notes-mcp',
          version: '1.2.0',
          transport: { type: 'stdio' },
          environmentVariables: [{ name: 'NOTES_TOKEN', isRequired: true, isSecret: true }],
        },
        {
          registryType: 'oci',
          identifier: 'ghcr.io/acme/notes:1.2.0',
          transport: { type: 'stdio' },
          environmentVariables: [{ name: 'NOTES_TOKEN' }],
        },
      ],
      remotes: [{ type: 'streamable-http', url: 'https://mcp.acme.dev/mcp', headers: [{ name: 'Authorization', isSecret: true }] }],
      _meta: { 'io.modelcontextprotocol.registry/publisher-provided': { github: { stargazerCount: 42, isInOrganization: true } } },
    },
    _meta: { 'io.modelcontextprotocol.registry/official': { status: 'active' } },
  },
  { server: { name: 'com.old/gone', version: '0.1' }, _meta: { 'io.modelcontextprotocol.registry/official': { status: 'deprecated' } } },
  { server: { name: 'ai.smithery/x', version: '1' } },
];

let http: Server;
let base = '';
beforeAll(async () => {
  http = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url?.startsWith('/v0.1/servers?')) return res.end(JSON.stringify({ servers, metadata: { nextCursor: 'c2', total: 3 } }));
    if (req.url?.startsWith('/v0.1/servers/io.github.acme%2Fnotes/versions/latest')) return res.end(JSON.stringify(servers[0]));
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});
afterAll(() => http.close());

describe('MCP registries', () => {
  it('turns registry records into ways to run the server, and drops dead or deprecated ones', async () => {
    const src = registrySource({ id: 't', label: 'Test', description: '', base, trust: () => 'community', minQuery: 0 });
    const page = await src.search(makeHome().ctx, { text: '' });
    expect(page.entries.map((e) => e.installName)).toEqual(['io.github.acme/notes']);
    expect(page.next).toBe('c2');
    const [remote, npm, oci] = page.entries[0]!.install as Extract<(typeof page.entries)[0]['install'][number], { type: 'mcp' }>[];
    expect(remote).toMatchObject({ label: 'Hosted by mcp.acme.dev', spec: { transport: 'http', url: 'https://mcp.acme.dev/mcp' } });
    expect(remote!.inputs).toEqual([{ name: 'Authorization', required: false, secret: true, where: 'header', description: undefined }]);
    expect(npm!.spec).toEqual({ transport: 'stdio', command: 'npx', args: ['-y', '@acme/notes-mcp@1.2.0'] });
    expect(npm!.inputs![0]).toMatchObject({ name: 'NOTES_TOKEN', required: true, secret: true, where: 'env' });
    expect(oci!.spec.args).toEqual(['run', '-i', '--rm', '-e', 'NOTES_TOKEN', 'ghcr.io/acme/notes:1.2.0']);
    expect(page.entries[0]!.facts).toContainEqual(['Stars', '42']);
    expect((await src.get!(makeHome().ctx, 't:mcp:io.github.acme/notes'))?.name).toBe('notes');
  });

  it('asks for a longer search where the registry needs one', async () => {
    const src = registrySource({ id: 't', label: 'Test', description: '', base, trust: () => 'community', minQuery: 3 });
    expect((await src.search(makeHome().ctx, { text: 'ab' })).note).toMatch(/at least 3 letters/);
  });

  it('names publishers the way people know them', () => {
    expect(publisherOf('io.github.octo/thing')).toBe('octo');
    expect(publisherOf('com.example/thing')).toBe('example.com');
    expect(methodsOf({ remotes: [{ type: 'sse', url: 'https://server.smithery.ai/x' }] })).toEqual([]);
  });
});

describe('skills.sh', () => {
  it('installs with the skills CLI into the tools you pick, and refuses odd names', () => {
    const e = skillEntry({ source: 'anthropics/skills', skillId: 'pdf', installs: 5 })!;
    expect(e).toMatchObject({ name: 'pdf', publisher: 'anthropics', trust: 'verified' });
    expect(e.install[0]).toMatchObject({ type: 'command', env: { DISABLE_TELEMETRY: '1' } });
    expect(skillEntry({ source: 'x/y; rm -rf ~', skillId: 'a' })).toBeUndefined();
    expect(skillEntry({ source: 'x/y', skillId: '--force' })).toBeUndefined();
  });
});
