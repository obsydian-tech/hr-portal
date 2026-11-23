import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { attributes, blocks, stripComments } from './support/infra-harness';
import { policyOf } from './support/onb-15/tf-policy';
import { LAMBDA, REPO, type Pool, type Run, type Tables } from './support/ten-05/lambda-harness';
import { av } from './support/ten-03/world';
import { A, B, ID, POOL_GROUPS, TABLE, TENANTS, ask, aws, bodyOf, describe, rowsOf, statusOf, tables, type Ask, type Caller } from './support/ten-05/world';

/**
 * TEN-04.2 · Walk follow-up: bundles check the candidate, pickers keep only the company's people, hiring managers skip a missing
 * group (follow-up to NH-196, epic NH-192). Red. One test per acceptance criterion, written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/TEN-04.2.md (18 Nov 2026). Notes: TEN-04.2-tests-for-review.md.
 *
 * The Lambda tests run the real handlers and shared modules, each call in its own Node process, against TEN-05's fake AWS
 * (support/ten-05/fake-aws: DynamoDB over rows, the tenants table with Member rows, a Cognito pool with a group list, EventBridge).
 * Company A is the founding company; B is a second one. Names and addresses are made up. No run sets LEGACY_TENANT_ID unless the
 * test says so. AC-8 reads code and Terraform as text. AC-9 is the locked specs themselves (child lock ten-03.3 / ten-05.4).
 * AC-10 runs on the dev walk after Iggie's IAM approval, not here. Nothing here calls AWS or any AI.
 *
 * Pinned by the verifier (written down in the notes):
 *  - V1 The unexpected-failure answer of createProvisioningBundle is any 500 JSON body with one text field ("error" or "message"):
 *    the card names no new wording, so the test pins the status, that nothing was written and that no AWS message text is in it.
 *  - V2 The scoring-link members of the candidate are judged by their e-mail address; a pool person narrowed out is not listed.
 *  - V3 Member rows are the only people-to-company link a picker may read (rule 3), judged by who is listed.
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS or reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};
const NOT_FOUND = { error: 'Not found' };
const MARK = 'ten042-private-detail-9051';
const REQUIRED = { message: 'candidateId, candidateName, candidateRole, and startDate are required.' };

const staffA: Caller = { name: 'staff of A', groups: ['manager'], company: A };
const staffB: Caller = { name: 'staff of B', groups: ['manager'], company: B, sub: 'sub-ten042-staff-b' };
const noCompany: Caller = { name: 'staff with no company', groups: ['manager'], company: null };
/** A company named outside the token: a header, the query string and the body. It must change nothing. */
const named = (company: string) => ({ headers: { 'x-tenant-id': company }, query: { tenant_id: company, tenantId: company, company } });

// ---------------------------------------------------------------- the world

/** One Member row: this person is in this company. */
const member = (sub: string, company: string) => av({ pk: `USER#${sub}`, sk: `TENANT#${company}`, tenant_id: company });
const SUBS = { a1: 'sub-t42-a1', a2: 'sub-t42-a2', a3: 'sub-t42-a3', aUnconfirmed: 'sub-t42-a9', b1: 'sub-t42-b1', none: 'sub-t42-none', both: 'sub-t42-both' };
const MAIL = { a1: 'amy.alpha@example.test', a2: 'zed.alpha@example.test', a3: 'cy.alpha@example.test', aUnconfirmed: 'una.alpha@example.test', b1: 'bea.beta@example.test', none: 'nomember@example.test', both: 'both.companies@example.test' };
const NAMES = { a1: 'Amy Alpha', a2: 'Zed Alpha', a3: 'Cy Alpha', aUnconfirmed: 'Una Alpha', b1: 'Bea Beta', none: 'Nia Nomember', both: 'Bo Both' };
const person = (key: keyof typeof SUBS, groups: string[], status = 'CONFIRMED') => {
  const [given, family] = NAMES[key].split(' ');
  return { username: MAIL[key], sub: SUBS[key], status, attributes: { email: MAIL[key], given_name: given!, family_name: family! }, groups };
};
const PEOPLE = [
  person('a2', ['manager']), // listed first in the pool, sorted last by name
  person('a1', ['manager']),
  person('a3', ['perm-recruitment']), // a hiring manager group only, not a panel group
  person('aUnconfirmed', ['manager'], 'FORCE_CHANGE_PASSWORD'),
  person('b1', ['manager']),
  person('none', ['manager']),
  person('both', ['manager']),
];
const EVERY_NAME = [...Object.values(NAMES), ...Object.values(MAIL)];

/** TEN-05's rows, the Member rows of the people above, and A's scoring-link members (the rows getPanelMembers asks for). */
function world(extra: (t: Tables) => void = () => {}): Tables {
  const t = tables();
  t[TENANTS]!.push(member(SUBS.a1, A), member(SUBS.a2, A), member(SUBS.a3, A), member(SUBS.aUnconfirmed, A), member(SUBS.b1, B), member(SUBS.both, A), member(SUBS.both, B));
  t[TABLE.state]!.push(
    av({ PK: `CANDIDATE#${ID.a1}`, SK: 'SCORING_LINK#tok-ext-a', token: 'tok-ext-a', candidateId: ID.a1, tenant_id: A, tenantId: A, panelMemberId: 'ext-a', panelMemberEmail: 'ext.panel.a@example.test', panelMemberName: 'Ext Panel A', panelMemberRole: 'Engineer', used: false, ttl: 4102444800 }),
    av({ PK: `CANDIDATE#${ID.a1}`, SK: 'SCORING_LINK#tok-sys-a', token: 'tok-sys-a', candidateId: ID.a1, tenant_id: A, tenantId: A, panelMemberId: SUBS.a1, panelMemberEmail: MAIL.a1, panelMemberName: NAMES.a1, panelMemberRole: 'Engineer', used: false, ttl: 4102444800 }),
  );
  extra(t);
  return t;
}
const poolOf = (groups: string[] = POOL_GROUPS): Pool => ({ users: PEOPLE, groups });
const pick = (r: Run, key: string, field = 'email') => ((bodyOf(r)?.[key] ?? []) as any[]).map((m) => m[field]);
const panel = (caller: Caller, a: Ask = {}, o: { env?: Record<string, string>; t?: Tables; groups?: string[]; fail?: any } = {}) =>
  ask('getPanelMembers', caller, a, { tables: o.t ?? world(), pool: poolOf(o.groups), env: o.env, fail: o.fail });
const managers = (caller: Caller, a: Ask = {}, o: { env?: Record<string, string>; t?: Tables; groups?: string[]; fail?: any } = {}) =>
  ask('getHiringManagers', caller, a, { tables: o.t ?? world(), pool: poolOf(o.groups), env: o.env, fail: o.fail });

const BODY = { candidateId: ID.a1, candidateName: 'John Doe', candidateRole: 'Junior baker', startDate: '2026-12-01' };
const ghost = 'CAND-01TEN042NOSUCHCANDIDATE0';
const bundle = (caller: Caller, body: unknown = BODY, o: { t?: Tables; a?: Ask; fail?: any } = {}) =>
  ask('createProvisioningBundle', caller, { method: 'POST', body, ...(o.a ?? {}) }, { tables: o.t ?? world(), fail: o.fail });
const events = (r: Run) => (r.calls as any[]).filter((c) => c.service === 'events');
const logs = (r: Run) => (r.calls as any[]).filter((c) => c.service === 'log').map((c) => `${c.level} ${c.message}`);
const sentTo = (r: Run, table: string) => aws(r).filter((c) => c.table === table);

// ---------------------------------------------------------------- tests

test.describe('TEN-04.2 · Bundles check the candidate, pickers keep the company\'s people, hiring managers skip a missing group', () => {
  // -------------------------------------------------------------- AC-1

  test('AC-1 Bundle, other company\'s candidate: 404, nothing written', async ({}, testInfo) => {
    once(testInfo.project.name);
    const before = rowsOf(world(), TABLE.bundles);
    const r = bundle(staffB);
    expect(statusOf(r), `B posts A's candidate: 404\n${describe(r)}`).toBe(404);
    expect(bodyOf(r), 'B posts A\'s candidate: {"error":"Not found"}').toEqual(NOT_FOUND);
    expect(rowsOf(r.tables, TABLE.bundles), 'the bundles table is as it was').toEqual(before);
    expect(events(r), 'no BundleCreated event').toEqual([]);
    expect(sentTo(r, TABLE.config), 'no config (template) read').toEqual([]);
    expect(aws(r).filter((c) => c.op === 'PutItem'), 'no write of any kind').toEqual([]);
    expect(`${aws(r)[0]?.op} ${aws(r)[0]?.table}`, 'the candidate check is the first AWS call').toBe(`Query ${TABLE.state}`);
    // The same answer as an id that does not exist, byte for byte.
    const none = bundle(staffB, { ...BODY, candidateId: ghost });
    expect(none.response?.statusCode, 'an id that does not exist: the same status').toBe(r.response?.statusCode);
    expect(none.response?.body, 'an id that does not exist: the same answer, byte for byte').toBe(r.response?.body);
    expect(JSON.stringify(r.response)).not.toContain(ID.a1);
    // A's own staff asking for a candidate nobody has gets the same 404 and writes nothing.
    const ghostA = bundle(staffA, { ...BODY, candidateId: ghost });
    expect(statusOf(ghostA), 'A asks for an id that does not exist: 404').toBe(404);
    expect(rowsOf(ghostA.tables, TABLE.bundles), 'and writes nothing').toEqual(before);
  });

  // -------------------------------------------------------------- AC-2

  test('AC-2 Bundle, own candidate: unchanged', async ({}, testInfo) => {
    once(testInfo.project.name);
    for (const body of [BODY, { ...BODY, items: [{ type: 'LAPTOP', label: 'Laptop', queue: 'Laptops' }] }]) {
      const r = bundle(staffA, body);
      expect(statusOf(r), `A with A's candidate: 201\n${describe(r)}`).toBe(201);
      const made = bodyOf(r)?.bundle;
      expect(made?.tenant_id, 'the bundle is stamped with A').toBe(A);
      expect(made?.candidateId, 'the bundle names the candidate').toBe(ID.a1);
      const mine = rowsOf(r.tables, TABLE.bundles).filter((x) => x['candidateId'] === ID.a1 && x['bundleId'] === made?.bundleId);
      expect(mine.length, 'one new bundle row').toBe(1);
      expect(mine[0]!['tenant_id'], 'the row carries A').toBe(A);
      const put = aws(r).filter((c) => c.service === 'dynamodb' && c.op === 'PutItem' && c.table === TABLE.bundles);
      expect(put.length, 'one write').toBe(1);
      expect(put[0]!.input?.ConditionExpression, 'the idempotent-conflict condition is kept').toBe('attribute_not_exists(bundleId)');
      const ev = events(r);
      expect(ev.length, 'one BundleCreated event').toBe(1);
      expect(ev[0]!.detailType).toBe('BundleCreated');
      expect(ev[0]!.detail.tenant_id, 'the event carries A').toBe(A);
      expect(ev[0]!.detail.candidateId).toBe(ID.a1);
    }
  });

  // -------------------------------------------------------------- AC-3

  test('AC-3 Bundle, order and failure', async ({}, testInfo) => {
    once(testInfo.project.name);
    // No sign-in company: 403, no AWS call.
    const none = bundle(noCompany);
    expect(statusOf(none), `no sign-in company: 403\n${describe(none)}`).toBe(403);
    expect(aws(none), 'no sign-in company: no AWS call').toEqual([]);
    // A bad body is still 400, with no state read: missing field, and a candidate id that is not text.
    const bad = bundle(staffA, { ...BODY, candidateName: '' });
    expect(statusOf(bad), 'a missing field: 400').toBe(400);
    expect(aws(bad), 'a missing field: no state read, no AWS call').toEqual([]);
    for (const id of [{ $eq: ID.a1 }, [ID.a1], 12345, true]) {
      const r = bundle(staffA, { ...BODY, candidateId: id });
      expect(statusOf(r), `candidateId ${JSON.stringify(id)}: 400\n${describe(r)}`).toBe(400);
      expect(bodyOf(r), `candidateId ${JSON.stringify(id)}: the existing "required" message`).toEqual(REQUIRED);
      expect(aws(r), `candidateId ${JSON.stringify(id)}: no key condition is built, no AWS call`).toEqual([]);
    }
    // The state read fails: 500, no write, no event, the log holds the error name only (D-4.2-1).
    const before = rowsOf(world(), TABLE.bundles);
    const failed = bundle(staffA, BODY, { fail: { service: 'dynamodb', ops: ['Query'], name: 'InternalServerError', message: MARK } });
    expect(statusOf(failed), `the state read fails: 500 (never "yes")\n${describe(failed)}`).toBe(500);
    expect(failed.error, 'the Lambda does not throw the error out').toBeUndefined();
    const text = bodyOf(failed);
    expect(text && typeof text === 'object' && typeof (text.error ?? text.message) === 'string', 'the 500 is a JSON body with one text field').toBe(true);
    expect(JSON.stringify(failed.response), 'the answer carries no AWS message text').not.toContain(MARK);
    expect(rowsOf(failed.tables, TABLE.bundles), 'nothing written').toEqual(before);
    expect(aws(failed).filter((c) => c.op === 'PutItem'), 'no write call').toEqual([]);
    expect(events(failed), 'no event').toEqual([]);
    expect(logs(failed).join('\n'), 'the log holds no AWS message text (BE-18)').not.toContain(MARK);
    expect(logs(failed).join('\n'), 'the log names the error').toContain('InternalServerError');
    // A candidate row with no company belongs to nobody: 404.
    const orphan = world((t) => {
      const saga = t[TABLE.state]!.find((x) => (x as any).PK?.S === `CANDIDATE#${ID.a1}` && (x as any).SK?.S === 'SAGA')!;
      delete (saga as any).tenant_id;
      delete (saga as any).tenantId;
    });
    const o = bundle(staffA, BODY, { t: orphan });
    expect(statusOf(o), `a candidate row with no tenant_id: 404\n${describe(o)}`).toBe(404);
    expect(bodyOf(o)).toEqual(NOT_FOUND);
    expect(events(o), 'a candidate row with no tenant_id: no event').toEqual([]);
    // The company never comes from the request.
    const plain = bundle(staffA);
    const aNamingB = bundle(staffA, { ...BODY, tenantId: B, tenant_id: B, company: B }, { a: { ...named(B) } });
    expect(statusOf(aNamingB), 'A naming B in body, query and header: still 201').toBe(statusOf(plain));
    expect(bodyOf(aNamingB)?.bundle?.tenant_id, 'A naming B: the bundle is A\'s').toBe(A);
    expect(events(aNamingB)[0]?.detail?.tenant_id, 'A naming B: the event is A\'s').toBe(A);
    const bNamingA = bundle(staffB, { ...BODY, tenantId: A, tenant_id: A, company: A }, { a: { ...named(A) } });
    expect(statusOf(bNamingA), `B naming A in body, query and header: still 404\n${describe(bNamingA)}`).toBe(404);
    expect(bodyOf(bNamingA)).toEqual(NOT_FOUND);
    expect(rowsOf(bNamingA.tables, TABLE.bundles), 'B naming A: nothing written').toEqual(before);
  });

  // -------------------------------------------------------------- AC-4

  test('AC-4 Panel members: only the company\'s people', async ({}, testInfo) => {
    once(testInfo.project.name);
    const forA = panel(staffA);
    expect(statusOf(forA), `panel members as A: 200\n${describe(forA)}`).toBe(200);
    const aMail = pick(forA, 'members');
    expect(aMail, 'A sees A\'s panel people').toEqual(expect.arrayContaining([MAIL.a1, MAIL.a2]));
    expect(aMail, 'a person of a hiring-manager-only group is not a panel member').not.toContain(MAIL.a3);
    for (const m of [MAIL.b1, MAIL.none, MAIL.both]) expect(aMail, `A does not see ${m} (B's, no Member row, two companies)`).not.toContain(m);
    expect(bodyOf(forA)?.total, 'total matches the listed people').toBe(bodyOf(forA)?.members.length);
    expect(Object.keys(bodyOf(forA)?.members[0] ?? {}).sort(), 'the shape of a member is as it was').toEqual(['accessType', 'email', 'id', 'name', 'role', 'tenantId']);
    // A person with no Member row is the founding company's only while LEGACY_TENANT_ID says so.
    const legacyA = panel(staffA, {}, { env: { LEGACY_TENANT_ID: A } });
    expect(pick(legacyA, 'members'), 'LEGACY_TENANT_ID = A: the person with no Member row is A\'s').toContain(MAIL.none);
    expect(pick(legacyA, 'members'), 'LEGACY_TENANT_ID = A: B\'s person is still not A\'s').not.toContain(MAIL.b1);
    expect(pick(legacyA, 'members'), 'LEGACY_TENANT_ID = A: the two-company person is still nobody\'s').not.toContain(MAIL.both);
    const legacyAForB = panel(staffB, {}, { env: { LEGACY_TENANT_ID: A } });
    expect(pick(legacyAForB, 'members'), 'LEGACY_TENANT_ID = A: B does not get the person with no Member row').not.toContain(MAIL.none);
    // The mirror, as B's staff.
    const forB = panel(staffB);
    expect(statusOf(forB), `panel members as B: 200\n${describe(forB)}`).toBe(200);
    expect(pick(forB, 'members'), 'B sees B\'s person only').toEqual([MAIL.b1]);
    expect(pick(panel(staffB, {}, { env: { LEGACY_TENANT_ID: B } }), 'members').sort(), 'LEGACY_TENANT_ID = B: B also gets the person with no Member row').toEqual([MAIL.b1, MAIL.none].sort());
    // The scoring-link members of A's candidate: for A, still there (and a pool person's link still marks them); for B, never.
    const linked = panel(staffA, { query: { candidateId: ID.a1 } });
    expect(pick(linked, 'members'), 'A with A\'s candidate: the scoring-link member is listed').toContain('ext.panel.a@example.test');
    const ext = (bodyOf(linked)?.members as any[]).find((m) => m.email === 'ext.panel.a@example.test');
    expect(ext?.accessType, 'the scoring-link member is an EMAIL_LINK member').toBe('EMAIL_LINK');
    const sys = (bodyOf(linked)?.members as any[]).find((m) => m.email === MAIL.a1);
    expect(sys?.scoringLinkToken, 'A\'s own pool person with a link carries it').toBe('tok-sys-a');
    const stolen = panel(staffB, { query: { candidateId: ID.a1 } });
    expect(statusOf(stolen), `B with A's candidate: 200 (the same list as without it)\n${describe(stolen)}`).toBe(200);
    expect(JSON.stringify(bodyOf(stolen)), 'B with A\'s candidate: none of A\'s links or people').not.toMatch(/ext\.panel\.a|tok-ext-a|tok-sys-a|amy\.alpha|zed\.alpha/);
    expect(pick(stolen, 'members'), 'B with A\'s candidate: B\'s person only').toEqual([MAIL.b1]);
    // The company comes from the token only.
    expect(pick(panel(staffA, named(B)), 'members'), 'A naming B: the same list').toEqual(aMail);
    expect(pick(panel(staffB, named(A)), 'members'), 'B naming A: B\'s list').toEqual([MAIL.b1]);
  });

  // -------------------------------------------------------------- AC-5

  test('AC-5 Hiring managers: only the company\'s people', async ({}, testInfo) => {
    once(testInfo.project.name);
    const forA = managers(staffA);
    expect(statusOf(forA), `hiring managers as A: 200\n${describe(forA)}`).toBe(200);
    expect(pick(forA, 'hiringManagers'), 'A sees A\'s confirmed people of manager and perm-recruitment, sorted by name (the unconfirmed one is not listed)').toEqual([MAIL.a1, MAIL.a3, MAIL.a2]);
    expect(pick(forA, 'hiringManagers', 'name'), 'sorted by name').toEqual([NAMES.a1, NAMES.a3, NAMES.a2]);
    expect(Object.keys(bodyOf(forA)?.hiringManagers[0] ?? {}).sort(), 'the shape of a hiring manager is as it was').toEqual(['email', 'familyName', 'givenName', 'name', 'sub']);
    expect(Object.keys(bodyOf(forA) ?? {}), 'the answer keeps its one key').toEqual(['hiringManagers']);
    const leak = JSON.stringify(bodyOf(forA));
    for (const x of [MAIL.b1, MAIL.none, MAIL.both, NAMES.b1, NAMES.none, NAMES.both]) expect(leak, `A does not see ${x}`).not.toContain(x);
    const legacyA = managers(staffA, {}, { env: { LEGACY_TENANT_ID: A } });
    expect(pick(legacyA, 'hiringManagers'), 'LEGACY_TENANT_ID = A: the person with no Member row is nobody\'s (REC-14 rule 12: no legacy fallback)').toEqual([MAIL.a1, MAIL.a3, MAIL.a2]);
    expect(pick(managers(staffB, {}, { env: { LEGACY_TENANT_ID: A } }), 'hiringManagers'), 'LEGACY_TENANT_ID = A: B does not get the person with no Member row').toEqual([MAIL.b1]);
    const forB = managers(staffB);
    expect(statusOf(forB), `hiring managers as B: 200\n${describe(forB)}`).toBe(200);
    expect(pick(forB, 'hiringManagers'), 'B sees B\'s person only').toEqual([MAIL.b1]);
    expect(pick(managers(staffB, {}, { env: { LEGACY_TENANT_ID: B } }), 'hiringManagers'), 'LEGACY_TENANT_ID = B: the person with no Member row is nobody\'s (REC-14 rule 12: no legacy fallback)').toEqual([MAIL.b1]);
    expect(pick(managers(staffA, named(B)), 'hiringManagers'), 'A naming B: the same list').toEqual([MAIL.a1, MAIL.a3, MAIL.a2]);
    expect(pick(managers(staffB, named(A)), 'hiringManagers'), 'B naming A: B\'s list').toEqual([MAIL.b1]);
  });

  // -------------------------------------------------------------- AC-6

  test('AC-6 Pickers fail closed', async ({}, testInfo) => {
    once(testInfo.project.name);
    const fail = { service: 'dynamodb', ops: ['Query'], name: 'InternalServerError', message: MARK };
    for (const [name, run] of [['panel members', panel], ['hiring managers', managers]] as const) {
      const r = run(staffA, {}, { fail });
      expect(statusOf(r), `${name}: the Member read fails: 500\n${describe(r)}`).toBe(500);
      expect(r.error, `${name}: the Lambda does not throw the error out`).toBeUndefined();
      const text = JSON.stringify(r.response);
      for (const x of EVERY_NAME) expect(text, `${name}: the failure answer holds no person (${x})`).not.toContain(x);
      expect(text, `${name}: the answer carries no AWS message text`).not.toContain(MARK);
      expect(bodyOf(r), `${name}: the route's own failure body`).toEqual(name === 'panel members' ? { message: 'Failed to retrieve panel members' } : { error: 'Failed to retrieve hiring managers' });
      // Failing closed holds with LEGACY_TENANT_ID set too (a failed read is never "founding company").
      const legacy = run(staffA, {}, { fail, env: { LEGACY_TENANT_ID: A } });
      expect(statusOf(legacy), `${name}: the Member read fails with a legacy company set: 500`).toBe(500);
    }
    // A user whose Member rows name two companies is listed for neither company.
    for (const [name, run, key] of [['panel members', panel, 'members'], ['hiring managers', managers, 'hiringManagers']] as const) {
      for (const [who, caller] of [['A', staffA], ['B', staffB]] as const) {
        for (const env of [{}, { LEGACY_TENANT_ID: A }, { LEGACY_TENANT_ID: B }]) {
          expect(pick(run(caller, {}, { env }), key), `${name} as ${who} ${JSON.stringify(env)}: the person in two companies is not listed`).not.toContain(MAIL.both);
        }
      }
    }
  });

  // -------------------------------------------------------------- AC-7

  test('AC-7 Hiring managers skip a missing group', async ({}, testInfo) => {
    once(testInfo.project.name);
    const missing = 'naleko-talentflow-hiringmanager';
    const some = POOL_GROUPS.filter((g) => g !== missing);
    const r = managers(staffA, {}, { groups: some });
    expect(statusOf(r), `a missing group: 200 (not 500)\n${describe(r)}`).toBe(200);
    expect(pick(r, 'hiringManagers'), 'the people of the groups that exist (manager, perm-recruitment), narrowed to A').toEqual([MAIL.a1, MAIL.a3, MAIL.a2]);
    const warns = (r.calls as any[]).filter((c) => c.service === 'log' && c.level === 'console.warn');
    expect(warns.length, 'one warning').toBe(1);
    expect(warns[0].message, 'the warning names the group').toContain(missing);
    expect(warns[0].message, 'the warning is the one the sibling handler writes').toContain('skipping group');
    expect(warns[0].message, 'the warning holds the error name').toContain('ResourceNotFoundException');
    expect(warns[0].message, 'the warning holds no message text').not.toMatch(/Group not found/i);
    // The groups that exist were all asked (the missing one did not stop the loop).
    const asked = aws(r).filter((c) => c.service === 'cognito' && c.op === 'ListUsersInGroup').map((c) => c.input?.GroupName);
    expect(asked, 'every group was asked').toEqual(expect.arrayContaining(['manager', 'perm-recruitment', missing]));
    // Every group missing: 200 with an empty list, as getPanelMembers does (D-4.2-3).
    const all = managers(staffA, {}, { groups: [] });
    expect(statusOf(all), `every group missing: 200\n${describe(all)}`).toBe(200);
    expect(bodyOf(all), 'every group missing: an empty list').toEqual({ hiringManagers: [] });
    expect((all.calls as any[]).filter((c) => c.service === 'log' && c.level === 'console.warn').length, 'one warning per missing group').toBeGreaterThanOrEqual(3);
    // Another kind of failure of the pool is not swallowed by this: with no tenants Query it is a 500 only for the Member read (AC-6).
    const ok = managers(staffB, {}, { groups: some });
    expect(pick(ok, 'hiringManagers'), 'as B, a missing group: only B\'s person').toEqual([MAIL.b1]);
  });

  // -------------------------------------------------------------- AC-8

  test('AC-8 Text checks', async ({}, testInfo) => {
    once(testInfo.project.name);
    const code = (name: string) => stripComments(readFileSync(join(LAMBDA, name, 'index.js'), 'utf8'));
    const bundleSrc = code('createProvisioningBundle');
    const hmSrc = code('getHiringManagers');
    const pmSrc = code('getPanelMembers');
    // The candidate check comes before the first write.
    const check = bundleSrc.indexOf('candidateIsOurs(');
    const firstPut = bundleSrc.indexOf('new PutItemCommand(');
    expect(check, 'createProvisioningBundle calls candidateIsOurs').toBeGreaterThan(-1);
    expect(firstPut, 'createProvisioningBundle still writes the bundle').toBeGreaterThan(-1);
    expect(check, 'candidateIsOurs comes before the first PutItemCommand').toBeLessThan(firstPut);
    expect(bundleSrc.indexOf('getConfig('), 'and before the template read').toBeGreaterThan(check);
    expect(/QueryCommand[^;]*from\s*'@aws-sdk\/client-dynamodb'|from\s*'@aws-sdk\/client-dynamodb'[^;]*QueryCommand/.test(bundleSrc.replace(/\s+/g, ' ')) || /require\('@aws-sdk\/client-dynamodb'\)/.test(bundleSrc) && /QueryCommand/.test(bundleSrc), 'QueryCommand comes from the DynamoDB client').toBe(true);
    expect(bundleSrc, 'the state table name is STATE_TABLE_NAME with the TalentFlow table as fallback').toMatch(/process\.env\.STATE_TABLE_NAME\s*\|\|\s*['"]talent-flow-state['"]/);
    expect(bundleSrc, 'the company check takes the sign-in\'s company').toMatch(/candidateIsOurs\([\s\S]*?,\s*tenantId\s*\)/);
    // The pickers narrow with the Member read of the shared module, with the company from requireTenant only.
    // REC-14 step B (child lock ten-04.9): the hiring managers' pick is the shared lambda/shared/hiring-managers.mjs, which reads the Member rows itself.
    const sharedHm = stripComments(readFileSync(join(LAMBDA, 'shared', 'hiring-managers.mjs'), 'utf8'));
    expect(sharedHm, 'the shared hiring manager function reads the Member rows').toMatch(/companiesOf\(/);
    expect(sharedHm, 'and loads the shared membership module').toMatch(/membership\.mjs/);
    expect(hmSrc, 'getHiringManagers uses the shared function').toMatch(/hiring-managers\.mjs/);
    for (const [name, src] of [['getPanelMembers', pmSrc], ['getHiringManagers', hmSrc]] as const) {
      if (name === 'getPanelMembers') {
        expect(src, `${name} narrows with inCompany`).toMatch(/inCompany\(/);
        expect(src, `${name} loads the shared membership module`).toMatch(/membership\.mjs/);
      }
      expect(src, `${name} takes the company from requireTenant`).toMatch(/\{\s*tenantId\s*,\s*refusal\s*\}\s*=\s*T\.requireTenant\(event\)|\{\s*refusal\s*,\s*tenantId\s*\}\s*=\s*T\.requireTenant\(event\)/);
      expect(src.replace(/\s+/g, ' '), `${name} reads no company from the body, query, path or headers`).not.toMatch(/(event\.body|queryStringParameters|pathParameters|\.headers)[^;]{0,80}(tenant|company)/i);
      expect(src, `${name} reads no request body`).not.toMatch(/event\??\.body/);
    }
    expect(sharedHm, 'the hiring manager function skips a missing group with a warning that holds the error name').toMatch(/console\.warn\([^)]*skipping group[^)]*error:\s*e\??\.name/s);
    // No group name was added to a handler (TEN-05 AC-4 stays true): the handlers name no Cognito group.
    const groupLiteral = new RegExp(`['"\`](${POOL_GROUPS.filter((g) => !['admin', 'manager', 'employee', 'guest'].includes(g)).join('|')})['"\`]`);
    for (const [name, src] of [['createProvisioningBundle', bundleSrc], ['getHiringManagers', hmSrc], ['getPanelMembers', pmSrc]] as const) {
      expect(src.match(groupLiteral)?.[0], `${name} holds no Cognito group name`).toBeUndefined();
    }
    // IAM: the three statements of rule 6 and no others.
    const tf: { stack: string; role: string; pairs: string[] }[] = [];
    for (const stack of ['infra', 'talent-flow-infra']) {
      const dir = join(REPO, stack);
      const files = (existsSync(dir) ? readdirSync(dir) : []).filter((f: string) => f.endsWith('.tf')).map((f: string) => join(dir, f));
      for (const b of blocks(files, 'resource').filter((x) => x.labels[0] === 'aws_iam_role_policy')) {
        const role = (attributes(b.body).get('role') ?? '').replace(/^aws_iam_role\./, '').replace(/\.(name|id)$/, '');
        try {
          const doc: any = policyOf({ type: 'aws_iam_role_policy', name: b.labels[1]!, raw: b.raw, body: b.body, attrs: attributes(b.body) });
          const st = Array.isArray(doc.Statement) ? doc.Statement : [doc.Statement];
          const L = (v: unknown): string[] => (v === undefined ? [] : Array.isArray(v) ? (v as string[]) : [v as string]);
          tf.push({ stack, role: `${role} ${b.labels[1]}`, pairs: st.flatMap((x: any) => L(x.Action).flatMap((a) => L(x.Resource).map((res) => `${x.Effect} ${a} ${res}`))) });
        } catch { /* a policy that cannot be read as a policy is judged by locked ten-03 AC-10 */ }
      }
    }
    // The same two table ARNs as locked ten-03 AC-10 allows, read from the Resource text of the policy.
    const stateArn = /^(aws_dynamodb_table\.talent_flow_state\.arn|arn:aws:dynamodb:[^:]+:[^:]+:table\/(talent-flow-state|\$\{local\.tf_state_table\}))$/;
    const tenantsArn = /^(aws_dynamodb_table\.tenants\.arn|arn:aws:dynamodb:[^:]+:[^:]+:table\/(\$\{local\.tf_tenants_table\}|naleko-people-\$\{var\.environment\}-tenants))$/;
    const queries = (re: RegExp, resource: RegExp) => tf.filter((p) => re.test(p.role)).flatMap((p) => p.pairs.filter((x) => {
      const [effect, action, res] = x.split(' ');
      return effect === 'Allow' && action === 'dynamodb:Query' && resource.test(res ?? '');
    }));
    expect(queries(/createProvisioningBundle|create_provisioning_bundle/i, stateArn).length, 'createProvisioningBundle may Query the state table (table ARN only)').toBe(1);
    expect(queries(/getPanelMembers|get_panel_members/i, tenantsArn).length, 'getPanelMembers may Query the tenants table (table ARN only)').toBe(1);
    expect(queries(/getHiringManagers|get_hiring_managers/i, tenantsArn).length, 'getHiringManagers may Query the tenants table (table ARN only)').toBe(1);
    for (const p of tf.filter((x) => /createProvisioningBundle|getPanelMembers|get_panel_members|getHiringManagers|get_hiring_managers|create_provisioning_bundle/i.test(x.role))) {
      for (const x of p.pairs) {
        expect(x, `${p.role}: no Scan`).not.toMatch(/dynamodb:Scan/);
        // The grants of this card: Queries on the state or tenants table (the config table's index Query is older and stays as it is).
        if (/dynamodb:Query/.test(x) && /talent_flow_state|talent-flow-state|tf_state_table|tenants/.test(x)) {
          expect(x, `${p.role}: a Query is on a table ARN, with no wildcard`).not.toMatch(/\*/);
          expect(x, `${p.role}: a Query is not on an index`).not.toMatch(/\/index\//);
        }
      }
    }
  });
});
