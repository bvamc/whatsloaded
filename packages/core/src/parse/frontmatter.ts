import YAML from "yaml";

export interface FrontmatterParseResult<T = Record<string, unknown>> {
  frontmatter: T | null;
  body: string;
  hasFrontmatter: boolean;
  error?: string;
}

/**
 * Extracts YAML frontmatter bounded by --- markers and parses it.
 */
export function parseFrontmatter<T = Record<string, unknown>>(
  text: string,
): FrontmatterParseResult<T> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) {
    return { frontmatter: null, body: text, hasFrontmatter: false };
  }

  const rawYaml = match[1];
  const body = text.slice(match[0].length);

  try {
    const parsed = YAML.parse(rawYaml);
    return {
      frontmatter: (parsed && typeof parsed === "object" ? parsed : null) as T | null,
      body,
      hasFrontmatter: true,
    };
  } catch (err) {
    return {
      frontmatter: null,
      body,
      hasFrontmatter: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
