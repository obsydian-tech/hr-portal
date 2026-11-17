// node --test lambda/shared/tenant.test.mjs (run by npm test in lambda/shared)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LAMBDA = join(HERE, '..');
const TABLES = /\b(EMPLOYEES_TABLE|DOCUMENTS_TABLE|INVITES_TABLE|VERIFICATION_TABLE)\b|['"`](employees|documents|employee_invites|document-verification)['"`]/;
const HELPER = /['"](\.\.\/)+(shared\/)?tenant\.mjs['"]/;
const SKIP = new Set(['node_modules', 'coverage', 'tests', 'test', '__tests__', 'dist']);

function sources(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP.has(e.name)) out.push(...sources(join(dir, e.name))); }
    else if (/\.[cm]?js$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) out.push(join(dir, e.name));
  }
  return out;
}

test('every Lambda that touches the onboarding tables uses the company check or is on the retrofit list', () => {
  const list = JSON.parse(readFileSync(join(HERE, 'tenant-retrofit.json'), 'utf8'));
  const bad = [];
  for (const name of readdirSync(LAMBDA)) {
    const dir = join(LAMBDA, name);
    if (name === 'shared' || name === 'node_modules' || !statSync(dir).isDirectory()) continue;
    const texts = sources(dir).map((f) => readFileSync(f, 'utf8'));
    if (texts.some((t) => TABLES.test(t)) && !texts.some((t) => HELPER.test(t)) && !list.includes(name)) bad.push(name);
  }
  assert.deepEqual(bad, [], `These Lambdas touch the onboarding tables without lambda/shared/tenant.mjs: ${bad.join(', ')}`);
});

test('the company filter joined to another filter never doubles its parentheses (DynamoDB refuses "((...))")', async () => {
  const id = 'ten_' + 'a'.repeat(26);
  process.env.LEGACY_TENANT_ID = id;
  const { tenantFilter, andFilter } = await import('./tenant.mjs?parens');
  for (const tenantId of [id, 'ten_' + 'b'.repeat(26)]) {
    const joined = andFilter({ FilterExpression: 'document_id = :docId' }, tenantFilter(tenantId)).FilterExpression;
    assert.doesNotMatch(joined, /\(\(/, joined);
  }
});
