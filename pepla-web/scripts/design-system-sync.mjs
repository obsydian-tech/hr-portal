#!/usr/bin/env node
// Copies the Pepla design system into this app. The design system repo is the only source of
// colour, type, space, shape, motion, layers, component CSS and the icon vocabulary; this app
// never edits them. verify:design fails if anything under src/styles/design-system/ changes
// without going through this script.
//
//   npm run design-system:sync -- v1.0.0                 a tag, branch or commit on GitHub
//   npm run design-system:sync -- --from ../../pepla-design-system   a local checkout (for DS work)
//
// It writes src/styles/design-system/{tokens/*.css, components.css, icons.json} and
// sync.json (the ref, and a sha256 for every file), then regenerates the icon registry.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGISTRY, render as renderRegistry } from './icon-registry.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const DEST = join(ROOT, 'src', 'styles', 'design-system');
export const MANIFEST = join(DEST, 'sync.json');
const REPO = 'obsydian-tech/pepla-design-system';
// Token files in cascade order (palette first, base last), then the component bundle.
const TOKEN_FILES = ['palette.css', 'colors.css', 'typography.css', 'spacing.css', 'shape.css', 'motion.css', 'layers.css', 'base.css'];

export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

// Every file the sync owns, relative to DEST.
export function owned() {
  const list = TOKEN_FILES.map((f) => `tokens/${f}`);
  return [...list, 'components.css', 'icons.json', 'index.css'];
}

function fetchRef(ref) {
  const dir = mkdtempSync(join(tmpdir(), 'pepla-ds-'));
  const url = `https://codeload.github.com/${REPO}/tar.gz/${encodeURIComponent(ref)}`;
  execFileSync('sh', ['-c', `curl -fsSL "$0" | tar -xz -C "$1" --strip-components=1`, url, dir], { stdio: 'inherit' });
  return dir;
}

function iconsFromReadme(readme) {
  // Older design system versions have no icons.json; derive it the same way the DS repo does.
  const section = readme.split('## Iconography')[1].split('\n## ')[0];
  const icons = [];
  let group = null;
  for (const line of section.split('\n')) {
    const g = line.match(/^\*\*(.+?)\*\*\s*$/);
    if (g) { group = g[1]; continue; }
    const row = line.match(/^\|\s*([^|]+?)\s*\|\s*(.+?)\s*\|\s*$/);
    if (!row || !group || /^-+$/.test(row[1]) || row[1] === 'Meaning') continue;
    for (const [, name] of row[2].matchAll(/`([a-z0-9-]+)`/g)) if (!name.startsWith('-')) icons.push({ name, meaning: row[1], group });
  }
  return `${JSON.stringify({ source: 'project/readme.md, Iconography', icons }, null, 2)}\n`;
}

export function sync(src, ref) {
  const P = join(src, 'project');
  if (!existsSync(join(P, 'components.css'))) throw new Error(`${src} is not a pepla-design-system checkout (no project/components.css)`);
  rmSync(DEST, { recursive: true, force: true });
  mkdirSync(join(DEST, 'tokens'), { recursive: true });
  const files = {};
  const put = (rel, text) => { writeFileSync(join(DEST, rel), text); files[rel] = sha256(text); };
  for (const f of TOKEN_FILES) put(`tokens/${f}`, readFileSync(join(P, 'tokens', f), 'utf8'));
  put('components.css', readFileSync(join(P, 'components.css'), 'utf8'));
  put('icons.json', existsSync(join(P, 'icons.json')) ? readFileSync(join(P, 'icons.json'), 'utf8') : iconsFromReadme(readFileSync(join(P, 'readme.md'), 'utf8')));
  put('index.css', [
    '/* Pepla design system, synced by scripts/design-system-sync.mjs. Do not edit. */',
    ...TOKEN_FILES.map((f) => `@import "./tokens/${f}";`),
    '@import "./components.css";',
    '',
  ].join('\n'));
  writeFileSync(MANIFEST, `${JSON.stringify({ repo: REPO, ref, files }, null, 2)}\n`);
  writeFileSync(REGISTRY, renderRegistry());
  return Object.keys(files).length;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--from');
  if (i >= 0) {
    const src = resolve(args[i + 1] || '');
    let ref = 'local';
    try { ref = `local:${execFileSync('git', ['-C', src, 'rev-parse', '--short', 'HEAD']).toString().trim()}`; } catch { /* not a git checkout */ }
    console.log(`Pepla design system: synced ${sync(src, ref)} files from ${src} (${ref})`);
  } else if (args[0]) {
    const dir = fetchRef(args[0]);
    try { console.log(`Pepla design system: synced ${sync(dir, args[0])} files from ${REPO}@${args[0]}`); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  } else {
    console.error('Usage: npm run design-system:sync -- <tag|branch|commit>   or   -- --from <path to pepla-design-system>');
    process.exit(2);
  }
}

