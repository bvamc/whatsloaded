import { parse } from "smol-toml";

export interface TomlParseResult<T = Record<string, unknown>> {
  data: T | null;
  error?: string;
}

/**
 * Read-only TOML parser using smol-toml.
 */
export function parseToml<T = Record<string, unknown>>(text: string): TomlParseResult<T> {
  try {
    const data = parse(text) as T;
    return { data };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
