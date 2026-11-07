#!/usr/bin/env node
/**
 * Fails if any tracked or untracked source file matches a private list of terms that must
 * never be published (e.g. names of internal tools). The list itself is NOT in the repo:
 * pass it via WHATSLOADED_TERMS (regex lines separated by newlines) or WHATSLOADED_TERMS_FILE.
 * With neither set, the check is skipped (forks and contributors without the list).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const raw =
  process.env.WHATSLOADED_TERMS ?? (process.env.WHATSLOADED_TERMS_FILE ? readFileSync(process.env.WHATSLOADED_TERMS_FILE, 'utf8') : '');
const patterns = raw
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => new RegExp(l, 'i'));

if (!patterns.length) {
  console.log('check-terms: no term list provided; skipping');
  process.exit(0);
}

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !f.endsWith('package-lock.json') && !/\.(png|woff2?|ico)$/.test(f));

let hits = 0;
for (const f of files) {
  let text;
  try {
    text = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  text.split('\n').forEach((line, n) => {
    for (const re of patterns) {
      if (re.test(line)) {
        hits++;
        // Print location and pattern index only, never the matched term itself.
        console.error(`${f}:${n + 1}: matches term #${patterns.indexOf(re) + 1}`);
      }
    }
  });
}
if (hits) {
  console.error(`check-terms: ${hits} match(es)`);
  process.exit(1);
}
console.log(`check-terms: clean (${files.length} files, ${patterns.length} terms)`);
