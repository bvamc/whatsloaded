import path from "node:path";
import type { ReadonlyFs } from "../env.js";
import type { ImportEdge } from "../types.js";

export const MAX_IMPORT_DEPTH = 4;

/**
 * Extracts raw `@path` candidates from markdown text:
 * - Skips fenced code blocks (``` ... ```)
 * - Skips inline code spans (`...`)
 * - Respects backslash escapes (\ )
 * - Ignores quoted paths ("@path" or '@path')
 * - Skips email addresses and URL protocols
 */
export function extractImportDirectives(text: string): string[] {
  // Strip fenced code blocks
  const withoutBlocks = text.replace(/```[\s\S]*?```/g, "");
  // Strip inline code spans
  const stripped = withoutBlocks.replace(/`[^`\n]*`/g, "");

  const directives: string[] = [];
  const regex = /(?:^|\s)@((?:\\ |[^\s"'`])+)/g;

  let match: RegExpExecArray | null = null;
  while (true) {
    match = regex.exec(stripped);
    if (!match) break;

    const raw = match[1].replace(/\\ /g, " ").replace(/[.,;:)]+$/, "");
    // Ignore emails or protocols
    if (/^[\w.-]+@/.test(raw) || raw.includes("://")) {
      continue;
    }
    // Only capture paths that look like files (contains path separator, extension, or relative marker)
    if (!/[/.~]/.test(raw)) {
      continue;
    }

    directives.push(raw);
  }

  return directives;
}

export interface ImportExpansionResult {
  edges: ImportEdge[];
  visitedFiles: Set<string>;
}

/**
 * Recursively expands markdown imports up to maxDepth.
 */
export async function expandMarkdownImports(
  fs: ReadonlyFs,
  entryFile: string,
  homeDir: string,
  maxDepth = MAX_IMPORT_DEPTH,
): Promise<ImportExpansionResult> {
  const edges: ImportEdge[] = [];
  const visitedFiles = new Set<string>();

  async function recurse(currentFile: string, currentDepth: number): Promise<void> {
    if (visitedFiles.has(currentFile)) {
      return;
    }
    visitedFiles.add(currentFile);

    const text = await fs.readText(currentFile);
    if (!text) {
      return;
    }

    const directives = extractImportDirectives(text);
    for (const raw of directives) {
      const resolved = raw.startsWith("~/")
        ? path.join(homeDir, raw.slice(2))
        : path.resolve(path.dirname(currentFile), raw);

      const nextDepth = currentDepth + 1;
      if (nextDepth > maxDepth) {
        edges.push({
          raw,
          resolvedPath: resolved,
          ok: false,
          depth: nextDepth,
        });
        continue;
      }

      const fileExists = await fs.exists(resolved);
      if (!fileExists) {
        edges.push({
          raw,
          resolvedPath: resolved,
          ok: false,
          depth: nextDepth,
        });
        continue;
      }

      const stat = await fs.stat(resolved);
      edges.push({
        raw,
        resolvedPath: resolved,
        ok: true,
        depth: nextDepth,
        bytes: stat?.size ?? 0,
      });

      await recurse(resolved, nextDepth);
    }
  }

  await recurse(path.resolve(entryFile), 0);
  return { edges, visitedFiles };
}
