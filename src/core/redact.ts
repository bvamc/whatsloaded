import type { McpSpec } from './model.js';

const SENSITIVE = /(token|secret|password|passwd|api[-_]?key|auth|cookie|credential|session|bearer)/i;
const MASK = '••••';

/** Env and header values are hidden by default: MCP configs routinely carry credentials. */
export function redactSpec(spec: McpSpec, reveal = false): McpSpec {
  if (reveal) return spec;
  const maskAll = (r?: Record<string, string>) => r && Object.fromEntries(Object.keys(r).map((k) => [k, MASK]));
  return {
    ...spec,
    env: maskAll(spec.env),
    headers: maskAll(spec.headers),
    args: spec.args?.map((a) => (/^--?[\w-]*(token|key|secret|password)[\w-]*=/i.test(a) ? a.replace(/=.*/, `=${MASK}`) : a)),
  };
}

/** Mask values on diff/config lines whose key looks sensitive, or that sit inside env/headers blocks. */
export function redactText(text: string, reveal = false): string {
  if (reveal) return text;
  let inSecretBlock = 0;
  return text
    .split('\n')
    .map((line) => {
      const body = line.replace(/^[+\- ]/, '');
      if (/^\s*"?(env|headers|environment|http_headers)"?\s*[:=]\s*\{\s*$/.test(body)) inSecretBlock = 1;
      else if (/^\s*\[.*\.(env|http_headers)\]\s*$/.test(body)) inSecretBlock = 2;
      else if (inSecretBlock === 1 && /^\s*\}/.test(body)) inSecretBlock = 0;
      else if (inSecretBlock === 2 && /^\s*\[/.test(body)) inSecretBlock = 0;
      const kv = line.match(/^(.*?["']?[\w.-]+["']?\s*[:=]\s*)(.+?)(,?)$/);
      if (!kv) return line;
      const key = kv[1]!;
      const isInline = /\b(env|headers|environment|http_headers)\s*[:=]\s*\{/.test(line);
      if (inSecretBlock || SENSITIVE.test(key) || isInline) {
        if (/[:=]\s*\{\s*$/.test(line)) return line;
        return `${key}${JSON.stringify(MASK)}${kv[3]}`;
      }
      return line;
    })
    .join('\n');
}
