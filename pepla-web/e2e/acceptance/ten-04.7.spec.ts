import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { REPO, readSpec } from './support/ten-04/files';
import { terraformRoutes, type ApiName } from './support/ten-04/tf';
import type { Kind } from './support/ten-04/rows';
import { walk, type OpInfo, type Req, type Res, type World } from './support/ten-04/walk';

/**
 * TEN-04.7 · The company walk does not count the order of a row's fields (child lock of TEN-04, after ten-04.5).
 * Dev run 44428593151 (develop e504e78) failed AC-7 on POST /v1/candidates and POST /v1/config. In both lines the first
 * difference is the first field of the same company A row: the config row came back as {"GSI1PK",...} before and as
 * {"configType",...} after, the candidate as {"seed",...} then {"lastName":"Demo-Candidate",...}. Both reads are DynamoDB
 * index queries, and DynamoDB does not keep the order of a row's fields from one read to the next.
 * So the walk now compares each object with its keys in name order. It still compares every key, every value and the order
 * of rows in a list, so a change, a removed field or another company's row in company A's answer is still counted.
 * No-backend only: the walk runs against a small API of its own. Nothing here calls AWS or any AI.
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: the walk runs against a small API of its own.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};
const ids = JSON.parse(readFileSync(join(__dirname, 'support', 'ten-04', 'dev-ids.json'), 'utf8')) as Record<string, string> & { names: string[] };
const TENANT_A = `ten_${'a'.repeat(26)}`;
const world = (): World => ({
  ids: { employee: ids['employee']!, document: ids['document']!, candidate: ids['candidate']!, interview: ids['interview']!, tile: ids['tile']!, config: ids['config']!, itTask: ids['itTask']!, bundle: ids['bundle']!, notification: ids['notification']!, action: ids['action']!, user: 'sub-ten04-victim-a' } as Record<Kind, string>,
  tenantA: TENANT_A,
  markers: [TENANT_A],
  bMarkers: ['ten04-b-'],
});
const opsFor = (keys: string[]): OpInfo[] => {
  const api = new Map(terraformRoutes(REPO).map((r) => [r.key, r.api]));
  return readSpec().ops.filter((o) => keys.includes(o.key)).map((o) => ({ key: o.key, method: o.method, path: o.path, tenant: o.tenant, roles: o.roles, api: (api.get(o.key) ?? 'employees') as ApiName }));
};
const reversed = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).reverse());
const isA = (req: Req) => ['hrA', 'tfA', 'itA', 'empA'].includes(req.login);

/** Company A's candidate list and active config row, as the index queries answer them. */
const candidateA = { seed: 'pepla-demo', GSI1PK: `TENANT#${TENANT_A}`, appliedDate: '2026-11-10T08:00:00.000Z', positionLevel: 'JUNIOR', lastName: 'Demo-Candidate', stageEnteredAt: '2026-11-10T08:00:00.000Z', tenant_id: TENANT_A, data: { note: 'TEN04A', size: 1 } };
const configA = { GSI1PK: `TENANT#${TENANT_A}#ACTIVE`, tenant_id: TENANT_A, PK: `TENANT#${TENANT_A}`, configType: 'TEN04A_cfg-ten04-a-0001', version: 1, isActive: true, data: { note: 'TEN04A', size: 1 } };

/**
 * Runs the walk over one create and its read-back. Company A's first read answers `first`; every later read of company A
 * answers `later(first)` (`start(first)` replaces the first answer when given). Company B's own calls answer an empty list or an empty config. Answers the "not as it was" lines.
 */
const walkCreate = async (create: 'POST /v1/candidates' | 'POST /v1/config', later: (row: Record<string, unknown>) => unknown[], start: (row: Record<string, unknown>) => unknown[] = (r) => [r]) => {
  const read = create === 'POST /v1/candidates' ? 'GET /v1/candidates' : 'GET /v1/config';
  const ops = opsFor([create, read]);
  expect(ops.map((o) => o.key).sort(), `the file holds ${create} and ${read}`).toEqual([create, read].sort());
  let aReads = 0;
  const send = async (req: Req): Promise<Res> => {
    if (req.method === 'POST') return { status: 201, body: create === 'POST /v1/candidates' ? { candidateId: 'CAND-ten04-b' } : { configType: 'TEN04A_cfg-ten04-a-0001', version: 1 } };
    const first = create === 'POST /v1/candidates' ? candidateA : configA;
    const rows = !isA(req) ? [] : aReads++ === 0 ? start(first) : later(first);
    if (create === 'POST /v1/candidates') return { status: 200, body: { candidates: rows, total: rows.length } };
    return { status: 200, body: rows[0] ?? { configType: 'TEN04A_cfg-ten04-a-0001', version: null, isActive: false, data: {} } };
  };
  return (await walk(ops, send, world())).problems.filter((p) => /not as it was/.test(p));
};

test.describe('TEN-04.7 · the company walk does not count the order of a row\'s fields', () => {
  test('AC-7 The same company A row with its fields in another order is not counted', async ({}, testInfo) => {
    once(testInfo.project.name);
    expect.soft(await walkCreate('POST /v1/candidates', (r) => [reversed(r)]), 'candidate list: the same row, fields in another order').toEqual([]);
    expect.soft(await walkCreate('POST /v1/candidates', (r) => [reversed({ ...r, data: reversed(r['data'] as Record<string, unknown>) })]), 'candidate list: nested fields in another order too').toEqual([]);
    expect.soft(await walkCreate('POST /v1/config', (r) => [reversed(r)]), 'active config: the same row, fields in another order').toEqual([]);
  });

  test('AC-7 A real change to company A still counts, whatever the order of the fields', async ({}, testInfo) => {
    once(testInfo.project.name);
    const changed = await walkCreate('POST /v1/candidates', (r) => [reversed({ ...r, lastName: 'Walk' })]);
    expect.soft(changed.length, 'a changed value on company A\'s candidate: counted').toBe(1);
    expect.soft(changed[0] ?? '', 'the line says what it was').toContain('"lastName":"Demo-Candidate"');
    expect.soft(changed[0] ?? '', 'the line says what it is now').toContain('"lastName":"Walk"');
    const nested = await walkCreate('POST /v1/config', (r) => [reversed({ ...r, data: { note: 'TEN04A', size: 2 } })]);
    expect.soft(nested.length, 'a changed value inside company A\'s config data: counted').toBe(1);
    const gone = await walkCreate('POST /v1/config', (r) => { const { isActive: _gone, ...rest } = r; return [reversed(rest)]; });
    expect.soft(gone.length, 'a field gone from company A\'s config: counted').toBe(1);
    const added = await walkCreate('POST /v1/config', (r) => [reversed({ ...r, createdBy: 'company B' })]);
    expect.soft(added.length, 'a field added to company A\'s config: counted').toBe(1);
    const extra = await walkCreate('POST /v1/candidates', (r) => [reversed(r), { candidateId: 'CAND-ten04-b', firstName: 'Ten04', lastName: 'Walk', tenant_id: TENANT_A }]);
    expect.soft(extra.length, 'company B\'s new candidate shows in company A\'s list: counted').toBe(1);
    const swapped = await walkCreate('POST /v1/candidates', (r) => [{ ...r, lastName: 'Other' }, r].reverse().map(reversed));
    expect.soft(swapped.length, 'company A\'s list changes length and order: counted').toBe(1);
    // Same number of rows, only their order swapped: still counted (the walk keeps the order of rows in a list).
    const two = (r: Record<string, unknown>) => [r, { ...r, lastName: 'Second-Row' }];
    const sameCount = await walkCreate('POST /v1/candidates', (r) => two(r).reverse().map(reversed), two);
    expect.soft(await walkCreate('POST /v1/candidates', (r) => two(r).map(reversed), two), 'control: the same two rows in the same order, fields reordered: not counted').toEqual([]);
    expect.soft(sameCount.length, 'company A\'s rows come back in another order, same count: counted').toBe(1);
    const secondRow = await walkCreate('POST /v1/candidates', (r) => [r, { ...r, lastName: 'Changed-Row' }].map(reversed), two);
    expect.soft(secondRow.length, 'the second of company A\'s rows changes, same count and order: counted').toBe(1);
    const late = await walkCreate('POST /v1/candidates', (r) => [reversed({ ...r, tenant_id: 'ten_bbbbbbbbbbbbbbbbbbbbbbbbbb' })]);
    expect.soft(late.length, 'a change to a key late in name order (tenant_id): counted').toBe(1);
  });
});
