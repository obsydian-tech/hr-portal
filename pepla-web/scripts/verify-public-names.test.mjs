import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scan } from './verify-public-names.mjs';

const site = (files) => {
  const dir = mkdtempSync(join(tmpdir(), 'vpn-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
};
const ok = { 'index.html': '<title>Naleko People</title><link rel="icon" href="naleko-app-icon.svg">', 'main.js': "const sender = 'pepla';", 'styles.css': '.pp-agent-panel__message--pepla{}' };

test('a clean site passes, internal names in scripts and styles are allowed', () => {
  const dir = site(ok);
  try { const r = scan(dir); assert.deepEqual(r.hits, []); assert.equal(r.files, 3); } finally { rmSync(dir, { recursive: true }); }
});

for (const [name, extra] of [
  ['page text', { 'index.html': '<p>PePlA</p>' }],
  ['a file name', { 'pepla-app-icon.svg': '<svg/>' }],
  ['a folder name', { 'PEPLA/x.txt': 'x' }],
  ['a link in a script', { 'main.js': 'x = `<link rel="icon" href="/pepla.svg">`' }],
  ['an <a> in a script', { 'main.js': 'x = `<a href="/pepla">About</a>`' }],
  ['a meta in a script', { 'main.js': 'x = `<meta name="description" content="pepla">`' }],
]) {
  test(`fails on ${name}`, () => {
    const dir = site({ ...ok, ...extra });
    try { assert.ok(scan(dir).hits.length > 0); } finally { rmSync(dir, { recursive: true }); }
  });
}
