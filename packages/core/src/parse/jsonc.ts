import { type ParseError, parse } from "jsonc-parser";

export interface JsonParseResult<T = unknown> {
  data: T | null;
  error?: {
    message: string;
    offset: number;
    length: number;
  };
}

/**
 * Parses JSON or JSONC text and captures precise error offsets.
 */
export function parseJsonc<T = unknown>(text: string): JsonParseResult<T> {
  const errors: ParseError[] = [];
  const data = parse(text, errors, { allowTrailingComma: true });

  if (errors.length > 0) {
    const err = errors[0];
    return {
      data: null,
      error: {
        message: `JSON parse error code: ${err.error}`,
        offset: err.offset,
        length: err.length,
      },
    };
  }

  return { data };
}
