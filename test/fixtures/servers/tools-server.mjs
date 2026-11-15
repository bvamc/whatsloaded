// Minimal MCP stdio server for tests: newline-delimited JSON-RPC, two tools over two pages.
import { createInterface } from 'node:readline';

const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
const tools = [
  { name: 'search', description: 'Search notes', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } },
  { name: 'write', description: 'Write a note', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
];
createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: m.id,
      result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'notes', version: '1.0.0' } },
    });
  } else if (m.method === 'tools/list') {
    const page = m.params?.cursor === 'p2' ? 1 : 0;
    send({ jsonrpc: '2.0', id: m.id, result: { tools: [tools[page]], ...(page === 0 ? { nextCursor: 'p2' } : {}) } });
  } else if (m.id !== undefined) {
    send({ jsonrpc: '2.0', id: m.id, result: {} });
  }
});
