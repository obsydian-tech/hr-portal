#!/usr/bin/env node
// verify-public-names: no "pepla" (any case) in what the public can reach (SITE-01, NH-203).
//
//   node scripts/verify-public-names.mjs [folder]     default: dist/pepla-web/browser (the production output)
//
// Fails (exit 1, one line per hit: file and text) when "pepla" is in
//   - the name of any file or folder in the folder,
//   - the text of any .html file,
//   - any <title>, <meta>, <link> or <a> in any text file (scripts and styles included).
// Internal names inside scripts and styles that are not one of those tags (a CSS class, a message
// sender) are not public pages and are allowed. `npm run build` runs this as postbuild.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const DEFAULT_DIR = join(ROOT, 'dist', 'pepla-web', 'browser');
const WORD = /pepla/i;
const TEXT = /\.(?:html?|js|mjs|css|json|txt|xml|svg|webmanifest|map)$/i;
const TAG = /<(title)\b[^>]*>([\s\S]*?)<\/title\s*>|<(meta|link|a)\b([^>]*)>/gi;

/** Every hit under `dir`, and how many files were read. */
export function scan(dir) {
  const hits = [];
  let files = 0;
  const visit = (d) => {
    for (const name of readdirSync(d).sort()) {
      const path = join(d, name);
      const rel = relative(dir, path).split(sep).join('/');
      const isDir = statSync(path).isDirectory();
      if (WORD.test(name)) hits.push({ file: rel, text: `${isDir ? 'folder' : 'file'} name "${name}"` });
      if (isDir) { visit(path); continue; }
      files += 1;
      if (!TEXT.test(name)) continue;
      const text = readFileSync(path, 'utf8');
      if (/\.html?$/i.test(name)) {
        for (const line of text.split('\n')) {
          const m = line.match(/.{0,40}pepla.{0,40}/i);
          if (m) hits.push({ file: rel, text: m[0].trim() });
        }
        continue;
      }
      for (const m of text.matchAll(TAG)) {
        const value = m[1] ? m[2] : m[4];
        if (WORD.test(value)) hits.push({ file: rel, text: m[0].slice(0, 120) });
      }
    }
  };
  visit(dir);
  return { hits, files };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = resolve(process.argv[2] ?? DEFAULT_DIR);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(`verify-public-names: ${dir} is not a folder; build first (npm run build)`);
    process.exit(2);
  }
  const { hits, files } = scan(dir);
  for (const h of hits) console.log(`${h.file}: ${h.text}`);
  if (!files) {
    console.log(`verify-public-names: scanned 0 files in ${dir}; nothing to check is a failure`);
    process.exit(1);
  }
  if (hits.length) {
    console.log(`verify-public-names: ${hits.length} "pepla" hit${hits.length === 1 ? '' : 's'} in ${files} files scanned`);
    process.exit(1);
  }
  console.log(`verify-public-names: scanned ${files} files, no "pepla"`);
}
