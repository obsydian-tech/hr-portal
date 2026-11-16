#!/usr/bin/env node
// parity:kit: fetches the design system kit screens (project/ui_kits/*.html) at the ref the app is synced
// to (src/styles/design-system/sync.json) into e2e/parity/.kit/<ref>/, which git ignores. The kit
// parity harness (e2e/parity/kit-parity.ts) reads them from there; nobody types or copies a kit file.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const KIT_DIR = join(ROOT, 'e2e', 'parity', '.kit');
const { repo, ref } = JSON.parse(readFileSync(join(ROOT, 'src', 'styles', 'design-system', 'sync.json'), 'utf8'));
if (!/^[0-9a-f]{40}$/.test(ref)) {
  console.error(`parity:kit: sync.json ref "${ref}" is not a full commit; sync the design system at a commit first`);
  process.exit(1);
}
const out = join(KIT_DIR, ref);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const url = `https://codeload.github.com/${repo}/tar.gz/${ref}`;
execFileSync('sh', ['-c', 'curl -fsSL "$0" | tar -xz -C "$1" --strip-components=3 --wildcards "*/project/ui_kits/*.html"', url, out], { stdio: 'inherit' });
const files = readdirSync(out).filter((f) => f.endsWith('.html'));
if (!files.length) { console.error('parity:kit: no kit files in the download'); process.exit(1); }
// Byte for byte: each file must equal what GitHub serves for that commit, fetched on its own.
for (const f of files) {
  const raw = execFileSync('curl', ['-fsSL', `https://raw.githubusercontent.com/${repo}/${ref}/project/ui_kits/${f}`], { maxBuffer: 64 * 1024 * 1024 });
  const same = createHash('sha256').update(raw).digest('hex') === createHash('sha256').update(readFileSync(join(out, f))).digest('hex');
  if (!same) { console.error(`parity:kit: ${f} does not match ${repo}@${ref}`); process.exit(1); }
}
writeFileSync(join(out, '.source.json'), `${JSON.stringify({ repo, ref, url, files }, null, 2)}\n`);
console.log(`parity:kit: ${files.length} kit files, verified byte for byte, from ${repo}@${ref} in e2e/parity/.kit/${ref}/`);
