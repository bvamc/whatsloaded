import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "../src/parse/frontmatter.js";
import { parseJsonc } from "../src/parse/jsonc.js";
import { extractImportDirectives } from "../src/parse/md-imports.js";
import { parseToml } from "../src/parse/toml.js";

describe("core parsers", () => {
  it("parses JSONC with comments and trailing commas", () => {
    const jsonc = `
    {
      // A comment
      "name": "test",
      "items": [1, 2,],
    }
    `;
    const res = parseJsonc<{ name: string; items: number[] }>(jsonc);
    expect(res.data).toEqual({ name: "test", items: [1, 2] });
    expect(res.error).toBeUndefined();
  });

  it("parses YAML frontmatter", () => {
    const md = `---
name: my-skill
paths:
  - "src/**/*.ts"
---
# Hello
`;
    const res = parseFrontmatter<{ name: string; paths: string[] }>(md);
    expect(res.hasFrontmatter).toBe(true);
    expect(res.frontmatter?.name).toBe("my-skill");
    expect(res.frontmatter?.paths).toEqual(["src/**/*.ts"]);
    expect(res.body.trim()).toBe("# Hello");
  });

  it("extracts @imports correctly according to rules", () => {
    const text = `
    See @docs/rules.md for info.
    Also @nested/path\\ with\\ space.md.
    \`@ignore/inline.md\` should be skipped.
    \`\`\`
    @ignore/block.md
    \`\`\`
    Contact user@example.com or visit https://example.com/@alice.
    `;
    const directives = extractImportDirectives(text);
    expect(directives).toEqual(["docs/rules.md", "nested/path with space.md"]);
  });

  it("parses TOML correctly", () => {
    const toml = `
    project_doc_max_bytes = 32768
    [mcp_servers.github]
    command = "npx"
    args = ["-y", "@modelcontextprotocol/server-github"]
    `;
    const res = parseToml<{
      project_doc_max_bytes: number;
      mcp_servers: Record<string, { command: string }>;
    }>(toml);
    expect(res.data?.project_doc_max_bytes).toBe(32768);
    expect(res.data?.mcp_servers.github.command).toBe("npx");
  });
});
