import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { attributes, blocks, tfFiles } from './support/infra-harness';
import {
  LAMBDA, LINK_SCRIPT, POOLS, POST_AUTH, PRE_TOKEN, REPO, TENANT_HELPER, USER_MIGRATION, awsCalls, logLines, migrationEvent, postAuthEvent, preTokenEvent,
  runHandler, runModule, runScript, type Call, type Pool, type PoolUser, type Row, type Run, type Tables,
} from './support/ten-06/lambda-harness';
import { all, common, expectOnly, inside, lambdaNamed, nested, resources, roleOf, settingsOf, squash, without } from './support/ten-01/tf';
import { ROUTES } from './support/ten-03/routes';
import { SUB, ask, authorizerOf, av, bodyOf, plain, rowsOf, statusOf, tables as seededTables, type Caller } from './support/ten-03/world';

/**
 * TEN-06 · TalentFlow people move to the one sign-in pool, silently (Jira NH-198, epic NH-192 Tenancy). Red.
 * One test per acceptance criterion of step 1 (the switch), written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/TEN-06.md (16 Nov 2026). AC-9 (the reminder script, step 2) is
 * written for the card's second lock, acceptance-lock/ten-06.1, 60 days after the prod switch.
 *
 * Nothing here opens an app. AC-1, AC-2 and AC-3 run the real Lambdas (userMigration, tenantPreToken, cognitoPostAuth),
 * each call in its own Node process, against a fake AWS (support/ten-06/fake-aws, copied from TEN-05's with code added
 * only: a second Cognito pool, the TalentFlow pool). AC-4 runs the 22 handlers that compare the caller to a stored person
 * id, on TEN-03's seeded world. AC-5 runs scripts/tenancy/link-both-pools.mjs. AC-6 reads the old app's files and
 * runs its plain claim functions. AC-7 reads Terraform as text. AC-8 runs on pepla-dev only.
 *
 * Every made-up person, address and password below is invented. Nothing calls AWS or any AI.
 * Locked once accepted: see cards/ten-06.md.
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS or reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};

const A = 'ten_01jd3k9q7w2x5v8b4n6m0h1caa'; // the founding company
const B = 'ten_01jd3k9q7w2x5v8b4n6m0h1cbb';
const TENANTS = 'naleko-people-dev-tenants';

// ---------------------------------------------------------------- the people

type Person = { email: string; given: string; family: string; tfSub: string; password: string; groups: string[]; mapped: string[] };
const ALL_PERMS = ['perm-recruitment', 'perm-it', 'perm-approve-offers'];
const HM: Person = { email: 'lerato.dlamini@kestrel-foods.co.za', given: 'Lerato', family: 'Dlamini', tfSub: '3f1a9c20-7b44-4d0e-9a51-hm0000000001', password: 'Rumble-Stone-4471!x', groups: ['HiringManager'], mapped: ['manager', 'perm-recruitment'] };
const ADMIN: Person = { email: 'pieter.vanwyk@kestrel-foods.co.za', given: 'Pieter', family: 'Vanwyk', tfSub: '8d2e4b61-1c93-4f7a-b0d2-ad0000000002', password: 'Copper-Kettle-9082#y', groups: ['TalentFlowAdmin'], mapped: ['admin', ...ALL_PERMS] };
const BOTH: Person = { email: 'zanele.mthembu@kestrel-foods.co.za', given: 'Zanele', family: 'Mthembu', tfSub: 'c7a0f315-52de-4c18-8e69-bo0000000003', password: 'Tidal-Basin-2256$z', groups: ['ITAdmin', 'HiringManager'], mapped: ['manager', 'perm-recruitment', 'perm-it'] };
const BOTH_NALEKO_SUB = 'nal-5b19c0de-44a7-4e31-a8f2-bo0000000003';
const NAL_HR = { email: 'thandeka.mokoena@kestrel-foods.co.za', sub: 'nal-0a9b8c7d-6e5f-4a3b-9c2d-hr0000000004', groups: ['hr_staff'] };
const FINANCE: Person = { email: 'sipho.khumalo@kestrel-foods.co.za', given: 'Sipho', family: 'Khumalo', tfSub: 'e19b72a4-6d0f-4c85-93b7-fl0000000005', password: 'Granite-Ridge-7713%q', groups: ['FinanceLead', 'PanelMember'], mapped: ['perm-approve-offers'] };
const DISABLED: Person = { email: 'nomsa.zulu@kestrel-foods.co.za', given: 'Nomsa', family: 'Zulu', tfSub: '5c60d8e3-9a12-4e47-b3c9-di0000000006', password: 'Willow-Creek-3340^w', groups: ['HiringManager'], mapped: ['manager', 'perm-recruitment'] };
const NEW_PW: Person = { email: 'ayanda.ngcobo@kestrel-foods.co.za', given: 'Ayanda', family: 'Ngcobo', tfSub: 'a3f78c19-0b25-4d6e-8c41-np0000000007', password: 'Temp-Passw0rd-First!1', groups: ['HiringManager'], mapped: ['manager', 'perm-recruitment'] };
const STRANGER = { email: 'unknown.person@elsewhere-example.co.za', password: 'Whatever-Pass-0001!a' };

const tfUser = (p: Person, extra: Partial<PoolUser> = {}): PoolUser => ({ username: p.email, sub: p.tfSub, status: 'CONFIRMED', password: p.password, attributes: { email: p.email, email_verified: 'true', given_name: p.given, family_name: p.family }, groups: [...p.groups], ...extra } as PoolUser);
const TALENTFLOW_POOL: Pool = {
  users: [tfUser(HM), tfUser(ADMIN), tfUser(BOTH), tfUser(FINANCE), tfUser(DISABLED, { enabled: false }), tfUser(NEW_PW, { status: 'FORCE_CHANGE_PASSWORD' })],
};
const NALEKO_POOL: Pool = {
  users: [
    { username: BOTH.email, sub: BOTH_NALEKO_SUB, status: 'CONFIRMED', password: 'Naleko-Own-Pass-5521!n', attributes: { email: BOTH.email, email_verified: 'true' }, groups: ['employee'] } as PoolUser,
    { username: NAL_HR.email, sub: NAL_HR.sub, status: 'CONFIRMED', password: 'Naleko-Own-Pass-6612!m', attributes: { email: NAL_HR.email, email_verified: 'true' }, groups: [...NAL_HR.groups] } as PoolUser,
  ],
};
const POOL_ENV = { COGNITO_POOL_ID: POOLS.naleko, TALENT_FLOW_POOL_ID: POOLS.talentflow, TALENT_FLOW_CLIENT_ID: POOLS.talentflowClient };
const MIGRATION_ENV = { ...POOL_ENV, TENANTS_TABLE: TENANTS, LEGACY_TENANT_ID: A };
const TRIGGER_ENV = { ...POOL_ENV, TENANTS_TABLE: TENANTS, LEGACY_TENANT_ID: A, EMPLOYEES_TABLE: 'employees', TALENT_FLOW_USERS_TABLE: 'talent-flow-users' };

const member = (sub: string, tenantId: string, more: Record<string, string> = {}): Row => av({ pk: `USER#${sub}`, sk: `TENANT#${tenantId}`, tenant_id: tenantId, created_at: '2026-11-16T08:00:00.000Z', ...more });
const company = (tenantId: string, name: string): Row => av({ pk: `TENANT#${tenantId}`, sk: 'PROFILE', tenant_id: tenantId, name, status: 'ACTIVE', country: 'ZA', created_at: '2026-11-16T08:00:00.000Z' });
/** Rows every case starts from: both companies and a few people who are already members. */
const NOISE: Row[] = [company(A, 'Founding client'), company(B, 'Kestrel Foods'), member(NAL_HR.sub, A), member(BOTH_NALEKO_SUB, A), member('nal-other-company-sub', B)];
const world = (rows: Row[] = []): Tables => ({ [TENANTS]: [...NOISE, ...rows], employees: [], 'talent-flow-users': [] });

// ---------------------------------------------------------------- Terraform: what the pending row's expiry is called

/** The tenants table's TTL attribute, from Terraform (the pending row carries it). */
function ttlAttribute(): string {
  const table = resources('aws_dynamodb_table').filter((b) => attributes(b.body).get('name') === '"naleko-people-${var.environment}-tenants"');
  expect(table, 'one aws_dynamodb_table named "naleko-people-${var.environment}-tenants"').toHaveLength(1);
  const ttl = nested(table[0]!.body, 'ttl');
  expect(ttl, 'the tenants table has a ttl block (pending rows expire after 30 days)').toHaveLength(1);
  const t = attributes(inside(ttl[0]!));
  expect(t.get('enabled'), 'the ttl is enabled').toBe('true');
  const name = (t.get('attribute_name') ?? '').replace(/^"|"$/g, '');
  expect(name, 'the ttl names an attribute').toMatch(/^[a-z_][a-z0-9_]*$/);
  expect(['pk', 'sk', 'tenant_id'], 'the ttl attribute is none of the key attributes').not.toContain(name);
  return name;
}

// ---------------------------------------------------------------- shared checks

const sortedCopy = (l: string[]) => [...l].sort();
const pendingRows = (t: Tables) => rowsOf(t, TENANTS).filter((r) => String(r['pk']).startsWith('MIGRATE#'));
const tenantRows = (t: Tables) => rowsOf(t, TENANTS);
const without_ = (t: Tables, pred: (r: Record<string, any>) => boolean) => tenantRows(t).filter((r) => !pred(r));
const asList = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : v instanceof Set ? [...(v as Set<string>)] : []);
const groupsOfRow = (r: Record<string, any>): string[] => asList(r['groups']);
const SECTIONS = ['idTokenGeneration', 'accessTokenGeneration'] as const;

/** The text of every log line a run made, one JSON object per line when it is one, else the line as written. */
function logMessages(calls: Call[]): { message: string; text: string }[] {
  return logLines(calls).map((text) => {
    const first = text.trim();
    const bare = first.split(/ [\[{]/)[0] ?? first;
    let message = bare;
    if (first.startsWith('{')) {
      try { message = String((JSON.parse(first) as any).message ?? bare); } catch { message = bare; }
    }
    return { message, text };
  });
}

/** No person's email, name, id or password appears anywhere in the run's logs, calls (but the AWS call inputs) or error. */
function expectNoPersonalWords(what: string, run: Run, p: { email: string; given?: string; family?: string; tfSub?: string; password?: string }) {
  const log = logLines(run.calls).join('\n') + '\n' + (run.error?.message ?? '') + '\n' + (run.error?.stack ?? '');
  const words = [p.email, p.email.split('@')[0]!, p.email.split('@')[1]!, p.given, p.family, p.tfSub, p.password].filter((w): w is string => !!w);
  for (const w of words) expect(log.toLowerCase().includes(w.toLowerCase()), `${what}: the logs and the error do not hold "${w.slice(0, 4)}..." (no email, name, id or password)`).toBe(false);
}

/** Same value with every ISO timestamp blanked, so two runs a millisecond apart compare equal. */
function noTime<T>(v: T): T {
  return JSON.parse(JSON.stringify(v).replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z/g, 'TIME').replace(/"(ttl|expires_at)":(?:\{"N":"\d+"\}|"?\d+"?)/g, '"$1":"TTL"').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'UUID')) as T;
}

function expectOnlyMoveLogs(what: string, run: Run, moved: boolean) {
  const lines = logMessages(run.calls);
  expect(lines.length, `${what}: it logs something`).toBeGreaterThan(0);
  for (const l of lines) expect(['User moved', 'User not moved'], `${what}: every log line is "User moved" or "User not moved" (got: ${l.message.slice(0, 80)})`).toContain(l.message);
  const names = new Set(lines.map((l) => l.message));
  expect([...names], `${what}: ${moved ? 'only "User moved"' : 'only "User not moved"'}`).toEqual([moved ? 'User moved' : 'User not moved']);
  if (!moved) for (const l of lines) expect(l.text, `${what}: "User not moved" carries a reason code`).toMatch(/"?reason"?\s*[:=]\s*"?[a-z][a-z_]*"?/);
}

// ---------------------------------------------------------------- AC-1 and AC-2 helpers

function migrate(p: { email: string }, password: string | undefined, opts: { pool?: Pool; rows?: Row[]; trigger?: string; username?: string; fail?: boolean } = {}): Run {
  return runHandler(USER_MIGRATION, migrationEvent({ username: opts.username ?? p.email, ...(password === undefined ? {} : { password }), ...(opts.trigger ? { trigger: opts.trigger } : {}) }), {
    tables: world(opts.rows),
    talentflow: opts.pool ?? TALENTFLOW_POOL,
    cognito: NALEKO_POOL,
    env: MIGRATION_ENV,
    ...(opts.fail ? { fail: { service: 'dynamodb' as const, message: 'ProvisionedThroughputExceededException: Rate of requests exceeds the allowed throughput' } } : {}),
  });
}

/** The same rows as before, and exactly one more: the person's pending row. Returns that row. */
function expectOnePendingRow(what: string, before: Tables, run: Run, p: Person): Record<string, any> {
  const rows = pendingRows(run.tables);
  expect(rows, `${what}: one pending row`).toHaveLength(1);
  const row = rows[0]!;
  expect(row['pk'], `${what}: pk is MIGRATE# and the lower-case email`).toBe(`MIGRATE#${p.email.toLowerCase()}`);
  expect(row['sk'], `${what}: sk is TENANT# and the founding company's id`).toBe(`TENANT#${A}`);
  expect(row['legacy_user_id'], `${what}: it holds the TalentFlow sub (legacy_user_id)`).toBe(p.tfSub);
  expect(sortedCopy(groupsOfRow(row)), `${what}: it holds the role and permission groups TEN-05's table gives ${p.groups.join(', ')}`).toEqual(sortedCopy(p.mapped));
  expect('tenant_id' in row, `${what}: it has no tenant_id attribute, so it never shows in the company's member index (tenant-index)`).toBe(false);
  const ttl = row[ttlAttribute()];
  const now = Date.now() / 1000;
  expect(typeof ttl, `${what}: it carries the table's expiry attribute as a number (seconds)`).toBe('number');
  expect(ttl, `${what}: it expires in about 30 days (29 to 31)`).toBeGreaterThan(now + 29 * 86_400);
  expect(ttl, `${what}: it expires in about 30 days (29 to 31)`).toBeLessThan(now + 31 * 86_400);
  const others = (t: Tables) => JSON.stringify(without_(t, (r) => String(r['pk']).startsWith('MIGRATE#')));
  expect(others(run.tables), `${what}: no other row of the company list changed`).toBe(others(before));
  return row;
}

const refusalOf = (r: Run) => ({ name: r.error?.name, message: r.error?.message });

// ---------------------------------------------------------------- tests

test.describe('TEN-06 · TalentFlow people move to the one sign-in pool, silently', () => {
  // ------------------------------------------------------------- AC-1

  test('AC-1 Sign-in moves the user', async ({}, testInfo) => {
    once(testInfo.project.name);
    const before = world();

    // The right password: the answer, the one pending row, and the call to the TalentFlow pool.
    for (const p of [HM, ADMIN, FINANCE]) {
      const run = migrate(p, p.password);
      const what = `${p.given} (${p.groups.join(', ')})`;
      expect(run.error, `${what}: no error (${run.error?.message})`).toBeUndefined();
      const out = run.response?.response;
      expect(out, `${what}: the trigger answers with the event`).toBeTruthy();
      expect(out.finalUserStatus, `${what}: finalUserStatus CONFIRMED`).toBe('CONFIRMED');
      expect(out.messageAction, `${what}: messageAction SUPPRESS (no welcome email)`).toBe('SUPPRESS');
      expect(out.userAttributes?.['email']?.toLowerCase(), `${what}: the email`).toBe(p.email);
      expect(out.userAttributes?.['email_verified'], `${what}: email_verified is "true"`).toBe('true');
      expect(out.userAttributes?.['given_name'], `${what}: given name`).toBe(p.given);
      expect(out.userAttributes?.['family_name'], `${what}: family name`).toBe(p.family);
      expectOnePendingRow(what, before, run, p);
      const auth = run.calls.filter((c: any) => c.service === 'cognito' && c.op === 'AdminInitiateAuth') as any[];
      expect(auth, `${what}: one AdminInitiateAuth`).toHaveLength(1);
      expect(auth[0].input.AuthFlow, `${what}: the flow is ADMIN_USER_PASSWORD_AUTH`).toBe('ADMIN_USER_PASSWORD_AUTH');
      expect(auth[0].input.UserPoolId, `${what}: on the TalentFlow pool`).toBe(POOLS.talentflow);
      expect(auth[0].input.ClientId, `${what}: on the server-only client named by TALENT_FLOW_CLIENT_ID`).toBe(POOLS.talentflowClient);
      expect(auth[0].passwordRight ?? auth[0].input.passwordRight, `${what}: it sent the password the person typed`).toBe(true);
      expect(run.calls.filter((c: any) => c.service === 'cognito' && c.pool === 'naleko'), `${what}: nothing is read or written in the Naleko pool`).toEqual([]);
      const ops = awsCalls(run.calls);
      const cognitoOps = ops.filter((o) => o.startsWith('cognito'));
      for (const o of cognitoOps) expect(['cognito AdminInitiateAuth', 'cognito AdminGetUser', 'cognito AdminListGroupsForUser'], `${what}: only the three TalentFlow pool calls (${o})`).toContain(o);
      for (const o of ops.filter((x) => x.startsWith('dynamodb'))) expect(o, `${what}: only a write of the pending row, never a scan or a read of members`).toMatch(/^dynamodb (PutItem|UpdateItem) /);
      expect(ops.filter((o) => !/^(cognito|dynamodb)/.test(o)), `${what}: no other service`).toEqual([]);
      expectOnlyMoveLogs(what, run, true);
      expectNoPersonalWords(what, run, p);
    }

    // Capitals in what was typed: the pending key is the lower-case email.
    const caps = migrate(HM, HM.password, { username: 'Lerato.Dlamini@Kestrel-Foods.co.za' });
    expect(caps.error, 'capitals in the email: no error').toBeUndefined();
    expectOnePendingRow('capitals in the email', before, caps, HM);

    // Moving the same person twice keeps one row (and the same content).
    const first = migrate(HM, HM.password);
    const second = runHandler(USER_MIGRATION, migrationEvent({ username: HM.email, password: HM.password }), { tables: first.tables, talentflow: TALENT_FLOW_ONLY(), cognito: NALEKO_POOL, env: MIGRATION_ENV });
    const strip = (t: Tables) => JSON.stringify(pendingRows(t).map((r) => ({ ...r, [ttlAttribute()]: undefined, created_at: undefined })));
    expect(second.error, 'moving the same person twice: no error').toBeUndefined();
    expect(pendingRows(second.tables), 'moving the same person twice: still one pending row').toHaveLength(1);
    expect(strip(second.tables), 'moving the same person twice: same content').toBe(strip(first.tables));

    // Refusals: one answer for every one of them, no row, no personal words in the logs.
    const refusals: { what: string; run: Run; p: { email: string; given?: string; family?: string; tfSub?: string; password?: string } }[] = [
      { what: 'a wrong password', run: migrate(HM, 'Wrong-Pass-0000!zz'), p: { ...HM, password: 'Wrong-Pass-0000!zz' } },
      { what: 'an email nobody has', run: migrate(STRANGER, STRANGER.password), p: STRANGER },
      { what: 'a disabled person with the right password', run: migrate(DISABLED, DISABLED.password), p: DISABLED },
      { what: 'a person who must still set a first password', run: migrate(NEW_PW, NEW_PW.password), p: NEW_PW },
      { what: 'an empty password', run: migrate(HM, ''), p: HM },
      { what: 'the TalentFlow pool refusing the call', run: runHandler(USER_MIGRATION, migrationEvent({ username: HM.email, password: HM.password }), { tables: world(), talentflow: TALENTFLOW_POOL, cognito: NALEKO_POOL, env: MIGRATION_ENV, fail: { service: 'cognito', ops: ['AdminInitiateAuth'], message: 'Rate exceeded for AdminInitiateAuth', name: 'TooManyRequestsException' } }), p: HM },
      { what: 'the company list refusing the write', run: migrate(HM, HM.password, { fail: true }), p: HM },
      { what: 'a trigger source that is not a migration', run: migrate(HM, HM.password, { trigger: 'UserMigration_Other' }), p: HM },
    ];
    for (const { what, run, p } of refusals) {
      expect(run.error, `${what}: refused (the trigger throws, so Cognito does not create the user)`).toBeDefined();
      expect(run.response, `${what}: no answer`).toBeUndefined();
      expect(pendingRows(run.tables), `${what}: no pending row`).toEqual([]);
      expect(JSON.stringify(tenantRows(run.tables)), `${what}: the company list is as it was`).toBe(JSON.stringify(tenantRows(before)));
      expectOnlyMoveLogs(what, run, false);
      expectNoPersonalWords(what, run, p);
    }
    const answers = refusals.map((r) => JSON.stringify(refusalOf(r.run)));
    expect(new Set(answers).size, `every refusal is the same error, in name and words (${[...new Set(answers)].join(' | ').slice(0, 300)})`).toBe(1);
    // Same calls for a wrong password and an unknown email, so neither answers faster or slower.
    expect(awsCalls(refusals[1]!.run.calls), 'an email nobody has makes the same calls as a wrong password').toEqual(awsCalls(refusals[0]!.run.calls));
  });

  // ------------------------------------------------------------- AC-2

  test('AC-2 Forgot password moves the user', async ({}, testInfo) => {
    once(testInfo.project.name);
    const before = world();
    for (const p of [HM, ADMIN, BOTH]) {
      const run = migrate(p, undefined);
      const what = `${p.given} (forgot password)`;
      expect(run.error, `${what}: no error (${run.error?.message})`).toBeUndefined();
      const attrs = run.response?.response?.userAttributes;
      expect(attrs?.['email']?.toLowerCase(), `${what}: the email`).toBe(p.email);
      expect(attrs?.['email_verified'], `${what}: email_verified is "true", so the normal reset sends its code`).toBe('true');
      expect(attrs?.['given_name'], `${what}: given name`).toBe(p.given);
      expect(attrs?.['family_name'], `${what}: family name`).toBe(p.family);
      expectOnePendingRow(what, before, run, p);
      expect(awsCalls(run.calls).filter((o) => o === 'cognito AdminInitiateAuth'), `${what}: no password is checked`).toEqual([]);
      const lookups = run.calls.filter((c: any) => c.service === 'cognito' && c.op === 'AdminGetUser') as any[];
      expect(lookups.length, `${what}: the person is looked up in the TalentFlow pool`).toBeGreaterThanOrEqual(1);
      expect(run.calls.filter((c: any) => c.service === 'cognito' && c.pool !== 'talentflow'), `${what}: only the TalentFlow pool is touched`).toEqual([]);
      expectOnlyMoveLogs(what, run, true);
      expectNoPersonalWords(what, run, p);
    }
    // An email nobody has, a disabled person: the same answer as a failed sign-in, and no row.
    const unknown = migrate(STRANGER, undefined);
    const disabled = migrate(DISABLED, undefined);
    const wrong = migrate(HM, 'Wrong-Pass-0000!zz');
    for (const [what, run, p] of [['an email nobody has', unknown, STRANGER], ['a disabled person', disabled, DISABLED]] as const) {
      expect(run.error, `${what}: refused`).toBeDefined();
      expect(run.response, `${what}: no answer`).toBeUndefined();
      expect(pendingRows(run.tables), `${what}: no pending row`).toEqual([]);
      expect(JSON.stringify(tenantRows(run.tables)), `${what}: the company list is as it was`).toBe(JSON.stringify(tenantRows(before)));
      expectOnlyMoveLogs(what, run, false);
      expectNoPersonalWords(what, run, p);
      expect(JSON.stringify(refusalOf(run)), `${what}: the same answer as an unknown email at sign-in`).toBe(JSON.stringify(refusalOf(wrong)));
    }
    // Forgot password for somebody who is only in the Naleko pool never reaches this trigger (Cognito does not call it); if it
    // is called anyway, the TalentFlow pool has no such person.
    const nal = migrate({ email: NAL_HR.email }, undefined);
    expect(nal.error, 'a Naleko-only email: refused').toBeDefined();
    expect(pendingRows(nal.tables), 'a Naleko-only email: no pending row').toEqual([]);
  });

  // ------------------------------------------------------------- AC-3

  test('AC-3 First token is complete', async ({}, testInfo) => {
    once(testInfo.project.name);
    const NEW_SUB = 'nal-9e41b7c2-3d58-4a06-b1f9-mv0000000011';
    const TTL = ttlAttribute();
    const pendingFor = (p: Person, extra: Record<string, unknown> = {}): Row =>
      av({ pk: `MIGRATE#${p.email.toLowerCase()}`, sk: `TENANT#${A}`, legacy_user_id: p.tfSub, groups: [...p.mapped], created_at: '2026-11-18T08:00:00.000Z', [TTL]: Math.floor(Date.now() / 1000) + 20 * 86_400, ...extra } as any);
    const claimsOf = (run: Run, section: (typeof SECTIONS)[number]) => run.response?.response?.claimsAndScopeOverrideDetails?.[section]?.claimsToAddOrOverride;
    const preToken = (sub: string, email: string, rows: Row[], opts: { clientMetadata?: Record<string, string>; fail?: boolean; groups?: string[] } = {}) => {
      const event = preTokenEvent({ sub, email, groups: opts.groups ?? [], ...(opts.clientMetadata ? { clientMetadata: opts.clientMetadata } : {}) });
      const run = runHandler(PRE_TOKEN, event, { tables: world(rows), cognito: NALEKO_POOL, env: TRIGGER_ENV, ...(opts.fail ? { fail: { service: 'dynamodb' as const, message: 'ProvisionedThroughputExceededException: Rate of requests exceeds the allowed throughput' } } : {}) });
      return { event, run };
    };
    const expectClaims = (what: string, run: Run, want: Record<string, string> | null) => {
      expect(run.error, `${what}: the trigger never throws (${run.error?.message})`).toBeUndefined();
      for (const s of SECTIONS) {
        if (want) expect(claimsOf(run, s), `${what}: the ${s === 'idTokenGeneration' ? 'ID' : 'access'} token gets exactly these claims`).toEqual(want);
        else expect(claimsOf(run, s) ?? {}, `${what}: no claim added`).toEqual({});
      }
    };
    const groupOverride = (run: Run) => run.response?.response?.claimsAndScopeOverrideDetails?.groupOverrideDetails;

    // (a) The first sign-in, before the Member row: company, old id and the mapped groups.
    for (const p of [HM, ADMIN]) {
      const { event, run } = preToken(NEW_SUB, p.email, [pendingFor(p)]);
      const what = `pre-token, ${p.given}, pending row and no Member row`;
      expectClaims(what, run, { tenant_id: A, user_id: p.tfSub });
      expect(sortedCopy(groupOverride(run)?.groupsToOverride ?? []), `${what}: the groups for this token are the mapped ones`).toEqual(sortedCopy(p.mapped));
      for (const k of ['version', 'triggerSource', 'region', 'userPoolId', 'userName', 'callerContext'] as const) expect(run.response?.[k], `${what}: event.${k} comes back unchanged`).toEqual(event[k]);
      expect(run.response?.request, `${what}: the request part comes back unchanged`).toEqual(event.request);
      const ops = awsCalls(run.calls).filter((o) => o.startsWith('dynamodb'));
      for (const o of ops) expect(o, `${what}: only keyed reads (no scan, no write): ${o}`).toMatch(/^dynamodb (Query|GetItem) /);
      expect(JSON.stringify(run.calls.filter((c: any) => c.service === 'dynamodb')), `${what}: it reads the lower-case email's pending row`).toContain(`MIGRATE#${p.email.toLowerCase()}`);
      expect(JSON.stringify(noTime(tenantRows(run.tables))), `${what}: nothing is written`).toBe(JSON.stringify(noTime(tenantRows(world([pendingFor(p)])))));
    }
    // Capitals in the sign-in's email still find the row.
    expectClaims('pre-token, capitals in the sign-in email', preToken(NEW_SUB, 'Lerato.Dlamini@KESTREL-foods.co.za', [pendingFor(HM)]).run, { tenant_id: A, user_id: HM.tfSub });

    // (b) After the Member row exists (the other order): company and old id, the real groups untouched.
    const memberMoved = member(NEW_SUB, A, { legacy_user_id: HM.tfSub });
    const afterMember = preToken(NEW_SUB, HM.email, [memberMoved], { groups: HM.mapped });
    expectClaims('pre-token, Member row with legacy_user_id', afterMember.run, { tenant_id: A, user_id: HM.tfSub });
    expect(groupOverride(afterMember.run), 'pre-token, Member row with legacy_user_id: no group override (the pool has the real groups)').toBeFalsy();
    // A Member row wins over a pending row (left behind by a crash).
    const both = preToken(NEW_SUB, HM.email, [memberMoved, pendingFor(HM)], { groups: HM.mapped });
    expectClaims('pre-token, Member row and a left-over pending row', both.run, { tenant_id: A, user_id: HM.tfSub });
    expect(groupOverride(both.run), 'pre-token, Member row and a left-over pending row: no group override').toBeFalsy();
    const otherCompany = preToken(NEW_SUB, HM.email, [member(NEW_SUB, B), pendingFor(HM)]);
    expectClaims('pre-token, Member row of company B and a pending row', otherCompany.run, { tenant_id: B });
    expect(groupOverride(otherCompany.run), 'pre-token, Member row of company B and a pending row: no group override, no old id').toBeFalsy();

    // (c) Everyone else is as TEN-01 left them: a Member row without legacy_user_id gets exactly tenant_id (no user_id claim).
    expectClaims('pre-token, an ordinary Member row', preToken(NAL_HR.sub, NAL_HR.email, []).run, { tenant_id: A });
    expect(groupOverride(preToken(NAL_HR.sub, NAL_HR.email, []).run), 'pre-token, an ordinary Member row: no group override').toBeFalsy();

    // (d) A pending row that does not apply gives nothing: expired, another email's, an email only in the client's own words.
    const expired = pendingFor(HM, { [TTL]: { N: String(Math.floor(Date.now() / 1000) - 3600) } });
    const expiredRow = av({ pk: `MIGRATE#${HM.email}`, sk: `TENANT#${A}`, legacy_user_id: HM.tfSub, groups: [...HM.mapped], [TTL]: Math.floor(Date.now() / 1000) - 3600 } as any);
    void expired;
    for (const [what, rows, email, meta] of [
      ['an expired pending row (the table may keep it for a day or two after it expires)', [expiredRow], HM.email, undefined],
      ['another email\'s pending row', [pendingFor(ADMIN)], HM.email, undefined],
      ['an email only in the client metadata', [pendingFor(ADMIN)], 'someone.else@kestrel-foods.co.za', { email: ADMIN.email, username: ADMIN.email, tenant_id: B, user_id: ADMIN.tfSub }],
    ] as const) {
      const { run } = preToken(NEW_SUB, email, [...rows], meta ? { clientMetadata: meta as Record<string, string> } : {});
      expectClaims(`pre-token, ${what}`, run, { tenant_id: A });
      expect(groupOverride(run), `pre-token, ${what}: no group override`).toBeFalsy();
    }

    // (e) The company list failing: never throws, no old id, no group override.
    const failing = preToken(NEW_SUB, HM.email, [pendingFor(HM)], { fail: true });
    expect(failing.run.error, 'pre-token, the company list failing: never throws').toBeUndefined();
    expect(failing.run.response?.response?.claimsAndScopeOverrideDetails?.idTokenGeneration?.claimsToAddOrOverride?.['user_id'], 'pre-token, the company list failing: no old id').toBeUndefined();
    expect(groupOverride(failing.run), 'pre-token, the company list failing: no group override').toBeFalsy();

    // (f) Post-authentication on the same sign-in: Member row, groups, pending row gone; each step can run again.
    const post = (sub: string, email: string, rows: Row[], pool: Pool = NALEKO_POOL, fail?: Parameters<typeof runHandler>[2] extends infer O ? (O extends { fail?: infer F } ? F : never) : never) =>
      runHandler(POST_AUTH, postAuthEvent({ sub, email }), { tables: world(rows), cognito: pool, env: TRIGGER_ENV, ...(fail ? { fail } : {}) });
    const movedPool = (p: Person): Pool => ({ users: [...NALEKO_POOL.users, { username: p.email, sub: NEW_SUB, status: 'CONFIRMED', attributes: { email: p.email, email_verified: 'true' }, groups: [] } as PoolUser] });
    for (const p of [HM, ADMIN]) {
      const what = `post-auth, ${p.given}, pending row and no Member row`;
      const run = post(NEW_SUB, p.email, [pendingFor(p)], movedPool(p));
      expect(run.error, `${what}: never throws (${run.error?.message})`).toBeUndefined();
      expect(run.response?.userName, `${what}: it hands the event back`).toBe(p.email);
      const members = rowsOf(run.tables, TENANTS).filter((r) => r['pk'] === `USER#${NEW_SUB}`);
      expect(members, `${what}: one Member row for the new sub`).toHaveLength(1);
      expect(members[0]!['sk'], `${what}: of the founding company`).toBe(`TENANT#${A}`);
      expect(members[0]!['tenant_id'], `${what}: tenant_id`).toBe(A);
      expect(members[0]!['legacy_user_id'], `${what}: with the old TalentFlow id`).toBe(p.tfSub);
      expect(pendingRows(run.tables), `${what}: the pending row is gone`).toEqual([]);
      const user = run.cognito.users.find((u) => u.sub === NEW_SUB)!;
      expect(sortedCopy(user.groups), `${what}: the person is in the mapped groups`).toEqual(sortedCopy(p.mapped));
      const adds = run.calls.filter((c: any) => c.service === 'cognito' && c.op === 'AdminAddUserToGroup') as any[];
      expect(sortedCopy(adds.map((a) => a.input.GroupName)), `${what}: one AdminAddUserToGroup per group`).toEqual(sortedCopy(p.mapped));
      for (const a of adds) {
        expect(a.input.UserPoolId, `${what}: in this pool`).toBe(POOLS.naleko);
        expect(String(a.input.Username).toLowerCase(), `${what}: for this person`).toBe(p.email);
      }
      expect(run.calls.filter((c: any) => c.service === 'cognito' && c.op !== 'AdminAddUserToGroup'), `${what}: no other Cognito call`).toEqual([]);
      // Running it again changes nothing.
      const again = runHandler(POST_AUTH, postAuthEvent({ sub: NEW_SUB, email: p.email }), { tables: run.tables, cognito: run.cognito, env: TRIGGER_ENV });
      expect(again.error, `${what}, again: never throws`).toBeUndefined();
      expect(JSON.stringify(again.tables), `${what}, again: no row changes`).toBe(JSON.stringify(run.tables));
      expect(JSON.stringify(again.cognito), `${what}, again: no group changes`).toBe(JSON.stringify(run.cognito));
      expect(awsCalls(again.calls).filter((o) => /PutItem|DeleteItem|UpdateItem|AdminAddUserToGroup/.test(o)), `${what}, again: no write at all`).toEqual([]);
    }
    // A crash between the steps: the Member row is there, the pending row is not deleted yet. The Member row is not rewritten.
    const crashRows = [member(NEW_SUB, A, { legacy_user_id: HM.tfSub }), pendingFor(HM)];
    const crashed = post(NEW_SUB, HM.email, crashRows, movedPool(HM));
    expect(crashed.error, 'post-auth, left-over pending row: never throws').toBeUndefined();
    expect(pendingRows(crashed.tables), 'post-auth, left-over pending row: it is deleted').toEqual([]);
    expect(JSON.stringify(rowsOf(crashed.tables, TENANTS).filter((r) => r['pk'] === `USER#${NEW_SUB}`)), 'post-auth, left-over pending row: the Member row is not rewritten').toBe(JSON.stringify(rowsOf(world(crashRows), TENANTS).filter((r) => r['pk'] === `USER#${NEW_SUB}`)));
    expect(sortedCopy(crashed.cognito.users.find((u) => u.sub === NEW_SUB)!.groups), 'post-auth, left-over pending row: the groups are there').toEqual(sortedCopy(HM.mapped));
    // A group that cannot be added: the sign-in still works and the pending row stays, so the next sign-in tries again.
    const stuck = post(NEW_SUB, HM.email, [pendingFor(HM)], movedPool(HM), { service: 'cognito', ops: ['AdminAddUserToGroup'], message: 'Rate exceeded', name: 'TooManyRequestsException' });
    expect(stuck.error, 'post-auth, a group that cannot be added: never throws').toBeUndefined();
    expect(pendingRows(stuck.tables), 'post-auth, a group that cannot be added: the pending row stays').toHaveLength(1);
    // Nobody else is touched: a person with no pending row, an expired one, another email's.
    for (const [what, rows] of [['no pending row', []], ['an expired pending row', [expiredRow]], ['another email\'s pending row', [pendingFor(ADMIN)]]] as const) {
      const run = post(NAL_HR.sub, NAL_HR.email, [...rows]);
      expect(run.error, `post-auth, ${what}: never throws`).toBeUndefined();
      expect(JSON.stringify(noTime(tenantRows(run.tables))), `post-auth, ${what}: the company list is as it was`).toBe(JSON.stringify(noTime(tenantRows(world(rows)))));
      expect(JSON.stringify(run.cognito), `post-auth, ${what}: no group changes`).toBe(JSON.stringify(NALEKO_POOL));
    }

    // (g) Either order gives the same end state, and the second token is complete too.
    const pendingOnly = [pendingFor(HM)];
    const preFirst = preToken(NEW_SUB, HM.email, pendingOnly).run;
    expectClaims('order pre-token then post-auth: token', preFirst, { tenant_id: A, user_id: HM.tfSub });
    const thenPost = runHandler(POST_AUTH, postAuthEvent({ sub: NEW_SUB, email: HM.email }), { tables: preFirst.tables, cognito: movedPool(HM), env: TRIGGER_ENV });
    const postFirst = runHandler(POST_AUTH, postAuthEvent({ sub: NEW_SUB, email: HM.email }), { tables: world(pendingOnly), cognito: movedPool(HM), env: TRIGGER_ENV });
    const thenPre = runHandler(PRE_TOKEN, preTokenEvent({ sub: NEW_SUB, email: HM.email, groups: HM.mapped }), { tables: postFirst.tables, cognito: postFirst.cognito, env: TRIGGER_ENV });
    expectClaims('order post-auth then pre-token: token', thenPre, { tenant_id: A, user_id: HM.tfSub });
    expect(JSON.stringify(noTime(thenPost.tables)), 'both orders end with the same company list').toBe(JSON.stringify(noTime(thenPre.tables)));
    expect(JSON.stringify(thenPost.cognito), 'both orders end with the same groups').toBe(JSON.stringify(thenPre.cognito));
    // The pre-token trigger twice changes nothing.
    const preTwice = runHandler(PRE_TOKEN, preFirst.response, { tables: preFirst.tables, cognito: NALEKO_POOL, env: TRIGGER_ENV });
    expect(JSON.stringify(preTwice.tables), 'pre-token twice: nothing is written').toBe(JSON.stringify(preFirst.tables));
    expect(claimsOf(preTwice, 'idTokenGeneration'), 'pre-token twice: the same claims').toEqual({ tenant_id: A, user_id: HM.tfSub });
  });

  // ------------------------------------------------------------- AC-4

  test('AC-4 People keep their records', async ({}, testInfo) => {
    once(testInfo.project.name);

    // The helper: the old id when the sign-in carries one, else the sub; only from the signed-in token.
    const claimsEvent = (claims: Record<string, unknown> | undefined, extra: Record<string, unknown> = {}) => ({ requestContext: { ...(claims ? { authorizer: { jwt: { claims } } } : {}) }, ...extra });
    const helper = runModule(TENANT_HELPER, [
      { fn: 'userIdOf', args: [claimsEvent({ sub: 'new-sub', user_id: 'old-sub' })] },
      { fn: 'userIdOf', args: [claimsEvent({ sub: 'plain-sub' })] },
      { fn: 'userIdOf', args: [claimsEvent({ sub: 'plain-sub', user_id: '' })] },
      { fn: 'userIdOf', args: [claimsEvent({ sub: 'plain-sub', user_id: 7 })] },
      { fn: 'userIdOf', args: [claimsEvent({ sub: 'plain-sub', user_id: ['old-sub'] })] },
      { fn: 'userIdOf', args: [claimsEvent(undefined, { headers: { user_id: 'forged' }, body: JSON.stringify({ user_id: 'forged', sub: 'forged' }), queryStringParameters: { user_id: 'forged' }, pathParameters: { user_id: 'forged' } })] },
      { fn: 'userIdOf', args: [{ requestContext: { authorizer: { lambda: { actor: 'AGENT', tenant_id: A, user_id: 'forged' } } } }] },
      { fn: 'userIdOf', args: [{}] },
    ], { LEGACY_TENANT_ID: A });
    expect(helper.importError, 'lambda/shared/tenant.mjs loads').toBeUndefined();
    expect(helper.exports, 'tenant.mjs exports userIdOf').toContain('userIdOf');
    const [moved, plainSub, emptyOld, numberOld, listOld, forged, agent, nothing] = helper.results;
    expect(moved?.value, 'userIdOf: the user_id claim wins over the sub').toBe('old-sub');
    expect(plainSub?.value, 'userIdOf: no user_id, the sub').toBe('plain-sub');
    expect(emptyOld?.value, 'userIdOf: an empty user_id is no user_id').toBe('plain-sub');
    expect(numberOld?.value, 'userIdOf: a user_id that is not text is no user_id').toBe('plain-sub');
    expect(listOld?.value, 'userIdOf: a user_id that is a list is no user_id').toBe('plain-sub');
    expect(forged?.value || '', 'userIdOf: nothing in the body, query, path or headers counts').toBe('');
    expect(agent?.value || '', 'userIdOf: an agent\'s authorizer context gives no person').toBe('');
    expect(nothing?.value || '', 'userIdOf: no sign-in, no id').toBe('');

    // Every handler that compares the caller to a stored person id, run as the person under today's sub (the baseline), as
    // the same person after the move (a new sub, the old id in user_id), and as somebody else whose old id sits beside the
    // owner's sub. A handler that still reads the sub differs from the baseline in what it answers or writes.
    const PERSON_HANDLERS = [
      'acknowledgeTile', 'advanceCandidateStage', 'advanceOfferState', 'approveProvisioningBundle', 'captureSentiment', 'claimItTask', 'completeItTask', 'createCandidate',
      'createProvisioningBundle', 'dismissTile', 'generateScoringLink', 'getIntelligenceTiles', 'getItTasks', 'getProvisioningBundle', 'getProvisioningBundleProgress',
      'getProvisioningBundles', 'getUserNotifications', 'markNotificationRead', 'releaseItTask', 'snoozeTile', 'submitVote', 'updateProvisioningBundle',
    ];
    const routes = ROUTES.filter((r) => PERSON_HANDLERS.includes(r.handler));
    expect(new Set(routes.map((r) => r.handler)).size, 'TEN-03\'s route list covers all 22 handlers').toBe(PERSON_HANDLERS.length);
    const withClaims = (caller: Caller, change: Record<string, unknown>) => {
      const a = structuredClone(authorizerOf(caller)) as any;
      a.jwt.claims = { ...a.jwt.claims, ...change };
      return a;
    };
    const runAs = (route: (typeof routes)[number], authorizer: unknown) => {
      const caller = (route.caller ?? 'staffA') as Caller;
      void caller;
      const original = authorizerOf;
      void original;
      return askWith(route, authorizer);
    };
    for (const route of routes) {
      const caller = (route.caller ?? 'staffA') as Caller;
      const owner = (authorizerOf(caller) as any).jwt.claims.sub as string;
      const base = runAs(route, authorizerOf(caller));
      const movedRun = runAs(route, withClaims(caller, { sub: `moved-${owner}`, user_id: owner }));
      const what = `${route.name} (${route.handler})`;
      expect(statusOf(movedRun), `${what}: a moved person gets the status they got before`).toBe(statusOf(base));
      expect(noTime(bodyOf(movedRun)), `${what}: and the same answer`).toEqual(noTime(bodyOf(base)));
      expect(JSON.stringify(noTime(movedRun.tables)), `${what}: and writes the same rows, with the stored person ids unchanged`).toBe(JSON.stringify(noTime(base.tables)));
      // Somebody else: their id, not the owner's sub, decides.
      const stranger = 'someone-else-sub';
      const asStranger = runAs(route, withClaims(caller, { sub: stranger }));
      const strangerMoved = runAs(route, withClaims(caller, { sub: owner, user_id: stranger }));
      expect(statusOf(strangerMoved), `${what}: another person's user_id is theirs, not the owner's (status)`).toBe(statusOf(asStranger));
      expect(noTime(bodyOf(strangerMoved)), `${what}: another person's user_id is theirs, not the owner's (answer)`).toEqual(noTime(bodyOf(asStranger)));
      if (process.env.TEN06_DEBUG) { const a = JSON.stringify(noTime(strangerMoved.tables)), b = JSON.stringify(noTime(asStranger.tables)); let i = 0; while (i < a.length && a[i] === b[i]) i++; console.log(what, a.slice(Math.max(0, i - 80), i + 120), '|||', b.slice(Math.max(0, i - 80), i + 120)); }
      expect(JSON.stringify(noTime(strangerMoved.tables)), `${what}: another person's user_id writes as that person, not as the owner`).toBe(JSON.stringify(noTime(asStranger.tables)));
    }
  });

  // ------------------------------------------------------------- AC-5

  test('AC-5 Link script', async ({}, testInfo) => {
    once(testInfo.project.name);
    expect(existsSync(LINK_SCRIPT), 'scripts/tenancy/link-both-pools.mjs exists').toBe(true);
    const state: { tables: Tables; cognito: Pool; talentflow: Pool } = { tables: world(), cognito: NALEKO_POOL, talentflow: TALENTFLOW_POOL };
    const args = (...flags: string[]) => ['--env', 'dev', '--tenant', A, '--pool', POOLS.naleko, '--talent-flow-pool', POOLS.talentflow, ...flags];
    const go = (s: typeof state, ...flags: string[]) => runScript(LINK_SCRIPT, args(...flags), { ...s, env: POOL_ENV });
    const personal = [HM.email, ADMIN.email, BOTH.email, NAL_HR.email, FINANCE.email, HM.tfSub, BOTH.tfSub, BOTH_NALEKO_SUB, NAL_HR.sub, HM.given, BOTH.given, HM.family, BOTH.family, A];

    const expectCountsOnly = (what: string, r: ReturnType<typeof go>) => {
      const out = `${r.stdout}\n${r.stderr}`;
      for (const w of personal) expect(out.toLowerCase().includes(w.toLowerCase()), `${what}: the output holds no email, name or id ("${w.slice(0, 5)}...")`).toBe(false);
      expect(out, `${what}: the output holds no address at all`).not.toMatch(/@/);
      expect(r.stdout, `${what}: it prints counts`).toMatch(/\d/);
    };

    // Dry run: counts, no writes, exit 0.
    const dry = go(state);
    expect(dry.code, `dry run exits 0 (${dry.stderr.slice(-300)})`).toBe(0);
    expect(dry.writes, 'dry run writes nothing').toEqual([]);
    expect(JSON.stringify(dry.tables), 'dry run: the company list is as it was').toBe(JSON.stringify(state.tables));
    expect(JSON.stringify(dry.cognito), 'dry run: the Naleko pool is as it was').toBe(JSON.stringify(state.cognito));
    expectCountsOnly('dry run', dry);

    // Check before: exit 1.
    const checkBefore = go(state, '--check');
    expect(checkBefore.code, 'check exits 1 while somebody in both pools is not linked').toBe(1);
    expect(checkBefore.writes, 'check writes nothing').toEqual([]);
    expectCountsOnly('check', checkBefore);

    // Apply: the person in both pools gets legacy_user_id and the mapped groups; nobody else changes.
    const applied = go(state, '--apply');
    expect(applied.code, `apply exits 0 (${applied.stderr.slice(-300)})`).toBe(0);
    expectCountsOnly('apply', applied);
    const rowOf = (t: Tables, sub: string) => rowsOf(t, TENANTS).filter((r) => r['pk'] === `USER#${sub}`);
    const both = rowOf(applied.tables, BOTH_NALEKO_SUB);
    expect(both, 'apply: the person in both pools keeps one Member row').toHaveLength(1);
    expect(both[0]!['legacy_user_id'], 'apply: with their old TalentFlow id').toBe(BOTH.tfSub);
    expect(both[0]!['tenant_id'], 'apply: and the same company').toBe(A);
    const naleko = applied.cognito.users.find((u) => u.sub === BOTH_NALEKO_SUB)!;
    expect(sortedCopy(naleko.groups), 'apply: the mapped groups are added and the group they had stays').toEqual(sortedCopy(['employee', ...BOTH.mapped]));
    expect(sortedCopy(applied.cognito.users.find((u) => u.sub === NAL_HR.sub)!.groups), 'apply: a Naleko-only person is not touched').toEqual(NAL_HR.groups);
    expect(rowOf(applied.tables, NAL_HR.sub), 'apply: and keeps their Member row as it was').toEqual(rowOf(state.tables, NAL_HR.sub));
    expect(applied.cognito.users.length, 'apply: nobody is created in the Naleko pool (TalentFlow-only people move at their own sign-in)').toBe(NALEKO_POOL.users.length);
    expect(pendingRows(applied.tables), 'apply: no pending rows are made').toEqual([]);
    expect(rowsOf(applied.tables, TENANTS).filter((r) => /^USER#/.test(String(r['pk']))).length, 'apply: no Member row is added for a TalentFlow-only person').toBe(rowsOf(state.tables, TENANTS).filter((r) => /^USER#/.test(String(r['pk']))).length);
    expect(JSON.stringify(applied.talentflow), 'apply: the TalentFlow pool is only read').toBe(JSON.stringify(state.talentflow));
    expect(applied.writes.every((w: any) => w.service === 'dynamodb' || (w.service === 'cognito' && w.op === 'AdminAddUserToGroup' && w.pool === 'naleko')), 'apply: its writes are Member-row writes and AdminAddUserToGroup on the Naleko pool').toBe(true);

    // A second apply changes nothing; check passes.
    const after = { tables: applied.tables, cognito: applied.cognito, talentflow: applied.talentflow };
    const second = go(after, '--apply');
    expect(second.code, 'second apply exits 0').toBe(0);
    expect(second.writes, 'second apply writes nothing').toEqual([]);
    expect(JSON.stringify(second.tables), 'second apply: the company list is as it was').toBe(JSON.stringify(after.tables));
    expect(JSON.stringify(second.cognito), 'second apply: the groups are as they were').toBe(JSON.stringify(after.cognito));
    const checkAfter = go(after, '--check');
    expect(checkAfter.code, 'check exits 0 once everyone in both pools is linked').toBe(0);
    expect(checkAfter.writes, 'check after writes nothing').toEqual([]);

    // A missing or wrong argument is refused and writes nothing.
    const bad = runScript(LINK_SCRIPT, ['--env', 'dev', '--apply'], { ...state, env: POOL_ENV });
    expect(bad.code, 'no company and no pools: refused').not.toBe(0);
    expect(bad.writes, 'no company and no pools: nothing written').toEqual([]);
  });

  // ------------------------------------------------------------- AC-6

  test('AC-6 Old app', async ({}, testInfo) => {
    once(testInfo.project.name);
    const OLD = join(REPO, 'hr-portal', 'src');
    const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

    // The old app's TalentFlow and IT screens sign in on the one pool and its web client.
    for (const file of ['environment.ts', 'environment.prod.ts']) {
      const src = strip(read(join(OLD, 'environments', file)));
      expect(src, `${file} exists`).toBeTruthy();
      const top = /\bcognito\s*:\s*\{[^}]*?userPoolId\s*:\s*['"`]([^'"`]+)['"`][^}]*?clientId\s*:\s*['"`]([^'"`]+)['"`]/s.exec(src);
      const tf = /talentFlow\s*:\s*\{[\s\S]*?cognitoConfig\s*:\s*\{[^}]*?userPoolId\s*:\s*['"`]([^'"`]+)['"`][^}]*?clientId\s*:\s*['"`]([^'"`]+)['"`]/.exec(src);
      expect(top, `${file}: the Naleko pool and client`).toBeTruthy();
      expect(tf, `${file}: talentFlow.cognitoConfig`).toBeTruthy();
      expect(tf?.[1], `${file}: the TalentFlow screens use the Naleko pool`).toBe(top?.[1]);
      expect(tf?.[2], `${file}: and the Naleko web client`).toBe(top?.[2]);
    }
    const devEnv = read(join(REPO, 'scripts', 'ci', 'dev-frontend-env.sh'));
    const devTf = /talentFlow\s*:\s*\{[\s\S]*?(cognitoConfig\s*:\s*\{[^\n]*\})/.exec(devEnv)?.[1] ?? '';
    expect(devTf, 'dev-frontend-env.sh: the generated talentFlow.cognitoConfig uses the Naleko pool and client').toMatch(/userPoolId\s*:\s*'\$\{NALEKO_POOL\}'.*clientId\s*:\s*'\$\{NALEKO_CLIENT\}'/);

    // The sign-in sends the password to the one pool (USER_PASSWORD_AUTH), never SRP.
    const service = strip(read(join(OLD, 'app', 'features', 'talent-flow', 'services', 'talent-flow-auth.service.ts')));
    expect(service, 'talent-flow-auth.service.ts').toBeTruthy();
    expect(service, 'it signs in with USER_PASSWORD_AUTH (setAuthenticationFlowType)').toMatch(/setAuthenticationFlowType\(\s*['"]USER_PASSWORD_AUTH['"]\s*\)/);
    expect(service.indexOf('setAuthenticationFlowType'), 'and sets it before it authenticates').toBeLessThan(service.indexOf('authenticateUser('));
    expect(service, 'no SRP flow is named in it').not.toMatch(/USER_SRP_AUTH/);
    expect(service, 'it reads the groups through the claim mapping (legacyClaimsOf)').toMatch(/legacyClaimsOf\s*\(/);
    expect(service, 'it no longer reads custom:isAdmin (the one pool does not add it)').not.toMatch(/custom:isAdmin/);
    const guard = strip(read(join(OLD, 'app', 'features', 'talent-flow', 'guards', 'admin.guard.ts')));
    expect(guard, 'admin.guard.ts reads the admin through the same mapping (legacyClaimsOf)').toMatch(/legacyClaimsOf\s*\(/);

    // The mapping: today's claims from each TalentFlow group, got back from what the one pool's groups are after the move.
    const modulePath = join(OLD, 'app', 'features', 'talent-flow', 'services', 'legacy-claims.ts');
    expect(existsSync(modulePath), 'legacy-claims.ts exists beside the auth service (plain functions, no Angular)').toBe(true);
    const mod: any = await import(modulePath);
    expect(typeof mod.legacyClaimsOf, 'legacy-claims.ts exports legacyClaimsOf(groups)').toBe('function');
    const claims = (groups: string[]) => mod.legacyClaimsOf(groups) as { isAdmin: boolean; roles: string[]; activeRole: string; groups: string[] };
    // Each TalentFlow pool group today: [custom:isAdmin, custom:roles, custom:activeRole, what hasGroup() answers], then the groups the move gives it (TEN-05's table).
    const TODAY: [string, boolean, string[], string, string[], string[]][] = [
      ['TalentFlowAdmin', true, ['ADMIN'], 'ADMIN', ['TalentFlowAdmin'], ['admin', ...ALL_PERMS]],
      ['HiringManager', false, ['HM'], 'HM', ['HiringManager'], ['manager', 'perm-recruitment']],
      ['ITAdmin', false, ['IT'], 'IT', ['ITAdmin'], ['perm-it']],
      ['HRDirector', false, ['TA'], 'TA', ['HRDirector'], ['perm-recruitment']],
      ['FinanceLead', false, ['TA'], 'TA', ['FinanceLead'], ['perm-approve-offers']],
      ['ComplianceOfficer', false, ['TA'], 'TA', ['ComplianceOfficer'], ['guest']],
    ];
    for (const [group, isAdmin, roles, active, hasGroup, moved] of TODAY) {
      const got = claims(moved);
      expect(got.isAdmin, `${group}: isAdmin as today`).toBe(isAdmin);
      expect(got.roles, `${group}: roles as today`).toEqual(roles);
      expect(got.activeRole, `${group}: activeRole as today`).toBe(active);
      expect(sortedCopy(got.groups), `${group}: the screens' group checks answer as today`).toEqual(sortedCopy(hasGroup));
    }
    // PanelMember has no role and no tick in the one pool (TEN-05), so nothing in the token says it: the mapping gives no groups and the TA role, never an error.
    expect(claims([]), 'PanelMember (no groups): no admin, TA, no group').toEqual({ isAdmin: false, roles: ['TA'], activeRole: 'TA', groups: [] });
    // Several groups: the highest role wins and each group still answers.
    const both = claims(['manager', 'perm-recruitment', 'perm-it']);
    expect(both.roles, 'HiringManager and ITAdmin: HM').toEqual(['HM']);
    expect(both.activeRole, 'HiringManager and ITAdmin: activeRole HM').toBe('HM');
    expect(sortedCopy(both.groups), 'HiringManager and ITAdmin: both groups answer').toEqual(['HiringManager', 'ITAdmin']);
    expect(claims(['guest', 'perm-it']).groups.sort(), 'ComplianceOfficer and ITAdmin: both answer').toEqual(['ComplianceOfficer', 'ITAdmin']);
    // The old Naleko group name still counts as admin until step 2 (TEN-06.1).
    expect(claims(['naleko-talentflow-admin']).isAdmin, 'the old naleko-talentflow-admin group is still admin').toBe(true);
    // Nothing is read from anywhere but the groups.
    expect(claims(['employee', 'hr_staff']), 'people with only onboarding groups get no TalentFlow group and no admin').toEqual({ isAdmin: false, roles: ['TA'], activeRole: 'TA', groups: [] });
  });

  // ------------------------------------------------------------- AC-7

  test('AC-7 Roles', async ({}, testInfo) => {
    once(testInfo.project.name);
    const HERE = join(__dirname, 'support', 'ten-06');
    const baseCognito = join(__dirname, 'support', 'ten-06', 'cognito.6122df1.tf.txt');
    const tenantsRef = 'aws_dynamodb_table.tenants';
    expect(resources('aws_dynamodb_table').filter((b) => `aws_dynamodb_table.${b.labels[1]}` === tenantsRef), 'the tenants table is aws_dynamodb_table.tenants').toHaveLength(1);
    ttlAttribute();

    // The new Lambda and its settings.
    const fn = lambdaNamed('userMigration');
    const fnRef = `aws_lambda_function.${fn.labels[1]}`;
    const settings = settingsOf(fn);
    expect(settings.get('TENANTS_TABLE'), 'userMigration: TENANTS_TABLE is the tenants table\'s name').toBe(`${tenantsRef}.name`);
    expect(settings.get('LEGACY_TENANT_ID'), 'userMigration: LEGACY_TENANT_ID = var.founding_tenant_id (the pending row\'s company)').toBe('var.founding_tenant_id');
    const poolSetting = settings.get('TALENT_FLOW_POOL_ID') ?? '';
    expect(poolSetting, 'userMigration: TALENT_FLOW_POOL_ID is set').not.toBe('');
    expect(settings.get('TALENT_FLOW_CLIENT_ID') ?? '', 'userMigration: TALENT_FLOW_CLIENT_ID is set').not.toBe('');
    for (const k of settings.keys()) expect(k, `userMigration: setting ${k} is no password, secret or key`).not.toMatch(/PASSWORD|SECRET|KEY|TOKEN/i);

    // The pool: only lambda_config changes, and only by user_migration.
    const pools = resources('aws_cognito_user_pool').filter((b) => b.labels[1] === 'naleko_dev');
    expect(pools, 'aws_cognito_user_pool.naleko_dev is still there').toHaveLength(1);
    const pool = pools[0]!;
    const base = blocks([baseCognito], 'resource').find((b) => b.labels[0] === 'aws_cognito_user_pool' && b.labels[1] === 'naleko_dev')!;
    expect(squash(without(pool.body, 'lambda_config')), 'the pool changes only in lambda_config').toBe(squash(without(base.body, 'lambda_config')));
    expect(pool.body, 'prevent_destroy stays').toMatch(/prevent_destroy\s*=\s*true/);
    const configs = nested(pool.body, 'lambda_config');
    expect(configs, 'one lambda_config').toHaveLength(1);
    const config = inside(configs[0]!);
    const top = attributes(without(without(config, 'pre_token_generation_config'), 'custom_email_sender'));
    expect(top.get('user_migration'), 'lambda_config runs userMigration as the user migration trigger').toBe(`${fnRef}.arn`);
    expect([...top.keys()].sort(), 'lambda_config holds what it held and user_migration, nothing else').toEqual(['kms_key_id', 'post_authentication', 'post_confirmation', 'user_migration']);
    const baseConfig = inside(nested(base.body, 'lambda_config')[0]!);
    const baseTop = attributes(without(without(baseConfig, 'pre_token_generation_config'), 'custom_email_sender'));
    for (const [k, v] of baseTop) expect(top.get(k), `lambda_config keeps ${k}`).toBe(v);
    expect(nested(config, 'custom_email_sender').map((b) => squash(b)), 'lambda_config keeps custom_email_sender unchanged').toEqual(nested(baseConfig, 'custom_email_sender').map((b) => squash(b)));
    expect(nested(config, 'pre_token_generation_config').map((b) => squash(b)), 'lambda_config keeps the pre-token trigger as it is (V2, tenantPreToken)').toEqual(nested(baseConfig, 'pre_token_generation_config').map((b) => squash(b)));

    // Cognito may invoke it, from this pool only.
    const perms = resources('aws_lambda_permission').filter((b) => (attributes(b.body).get('function_name') ?? '').startsWith(`${fnRef}.`));
    expect(perms, 'one aws_lambda_permission for userMigration').toHaveLength(1);
    const perm = attributes(perms[0]!.body);
    expect(perm.get('principal'), 'invoked by Cognito').toBe('"cognito-idp.amazonaws.com"');
    expect(perm.get('action')).toBe('"lambda:InvokeFunction"');
    expect(perm.get('source_arn'), 'only by the Naleko pool').toBe('aws_cognito_user_pool.naleko_dev.arn');

    // userMigration's role: the TalentFlow pool's three calls, pending rows only, logs and X-Ray.
    const migRole = roleOf(fn);
    const migActions = expectOnly(migRole, 'userMigration', (a, res) => {
      const c = common('userMigration', a, res);
      if (c !== undefined) return c;
      if (/^cognito-idp:Admin(InitiateAuth|GetUser|ListGroupsForUser)$/.test(a)) {
        const listed = res.join(' ');
        if (res.length !== 1) return 'one pool only';
        if (!/userpool\//.test(listed)) return 'a pool ARN (userpool/...)';
        if (!listed.includes(poolSetting.replace(/^"|"$/g, ''))) return `the pool named by TALENT_FLOW_POOL_ID (${poolSetting})`;
        if (/naleko_dev/.test(listed)) return 'not the Naleko pool';
        return null;
      }
      if (a === 'dynamodb:PutItem') return res.length === 1 && res[0] === `${tenantsRef}.arn` ? null : 'PutItem on the tenants table only (not an index)';
      return 'an action this card does not give it';
    });
    expect(sortedCopy([...new Set(migActions)].filter((a) => !/^(logs|xray):/.test(a))), 'userMigration: exactly these actions').toEqual(['cognito-idp:AdminGetUser', 'cognito-idp:AdminInitiateAuth', 'cognito-idp:AdminListGroupsForUser', 'dynamodb:PutItem']);
    const migPolicyText = resources('aws_iam_role_policy').filter((b) => new RegExp(`^aws_iam_role\\.${migRole}\\.(name|id)$`).test(attributes(b.body).get('role') ?? '')).map((b) => b.body).join('\n');
    const put = /\{[^{}]*dynamodb:PutItem[^{}]*(\{[^{}]*(\{[^{}]*\}[^{}]*)*\}[^{}]*)*\}/.exec(migPolicyText)?.[0] ?? '';
    expect(squash(put), 'userMigration: PutItem only on rows whose key starts MIGRATE# (a dynamodb:LeadingKeys condition)').toMatch(/dynamodb:LeadingKeys"=\[?"MIGRATE#\*"\]?/);
    expect(squash(put), 'userMigration: that condition is for every key (ForAllValues:StringLike)').toMatch(/ForAllValues:StringLike/);

    // KMS: the encrypted tenants table is read and written through the table key; the role is named in dynamodb_read_role_arns only.
    const kms = squash(readFileSync(join(REPO, 'infra', 'kms.tf'), 'utf8'));
    expect(kms, 'kms.tf: userMigration\'s role is in dynamodb_read_role_arns').toMatch(new RegExp(`dynamodb_read_role_arns=\\[[^\\]]*aws_iam_role\\.${migRole}\\.arn[^\\]]*\\]`));
    for (const list of ['allowed_role_arns', 'cognito_sender_decrypt_role_arns']) expect(kms, `kms.tf: userMigration's role is not in ${list}`).not.toMatch(new RegExp(`${list}=\\[[^\\]]*aws_iam_role\\.${migRole}\\.arn[^\\]]*\\]`));

    // cognitoPostAuth gains the tenants-table writes and AdminAddUserToGroup on the Naleko pool, nothing else; tenantPreToken gains nothing.
    const postRole = roleOf(lambdaNamed('cognitoPostAuth'));
    const postActions = expectOnly(postRole, 'cognitoPostAuth', (a, res) => {
      const c = common('cognitoPostAuth', a, res);
      if (c !== undefined) return c;
      if (a === 'dynamodb:Query') return res.some((r) => !/aws_dynamodb_table\.(tenants|[a-z_]+)\.arn|tenant-index|employees|talent[_-]flow|email-?index/i.test(r)) ? 'a table it reads today' : null;
      if (a === 'dynamodb:PutItem' || a === 'dynamodb:DeleteItem') return res.length === 1 && res[0] === `${tenantsRef}.arn` ? null : `${a} on the tenants table only`;
      if (a === 'cognito-idp:AdminAddUserToGroup') return res.length === 1 && res[0] === 'aws_cognito_user_pool.naleko_dev.arn' ? null : 'the Naleko pool only';
      if (/^kms:/.test(a)) return null; // the table keys it already uses
      if (/^dynamodb:(UpdateItem|GetItem)$/.test(a)) return null; // what it already does to employees and talent-flow-users
      return 'an action this card does not give it';
    });
    if (process.env.TEN06_DEBUG) console.log('POSTACTIONS', JSON.stringify(postActions));
    const newOnes = new Set(postActions.filter((a) => /^(dynamodb:(PutItem|DeleteItem)|cognito-idp:)/.test(a)));
    expect([...newOnes].sort(), 'cognitoPostAuth: the new actions are exactly these').toEqual(['cognito-idp:AdminAddUserToGroup', 'dynamodb:DeleteItem', 'dynamodb:PutItem']);
    const preActions = expectOnly(roleOf(lambdaNamed('tenantPreToken')), 'tenantPreToken', (a, res) => {
      const c = common('tenantPreToken', a, res);
      if (c !== undefined) return c;
      return /^dynamodb:(Query|GetItem)$/.test(a) && res.length === 1 && res[0] === `${tenantsRef}.arn` ? null : 'Query or GetItem on the tenants table only';
    });
    expect(sortedCopy([...new Set(preActions)].filter((a) => !/^(logs|xray):/.test(a))), 'tenantPreToken: Query (or GetItem) on the tenants table, nothing more').toEqual(expect.arrayContaining(['dynamodb:Query']));
    expect(preActions.filter((a) => !/^(logs|xray):/.test(a) && /Put|Delete|Update|cognito/.test(a)), 'tenantPreToken: no write and no Cognito right').toEqual([]);

    // The TalentFlow stack: one new server-only client; the sign-in client and the pool as they were.
    const tfFilesList = tfFiles(join(REPO, 'talent-flow-infra'));
    const clients = blocks(tfFilesList, 'resource').filter((b) => b.labels[0] === 'aws_cognito_user_pool_client');
    const web = clients.find((b) => b.labels[1] === 'talent_flow_web');
    expect(web, 'the TalentFlow web client is still there').toBeTruthy();
    const baseTf = readFileSync(join(HERE, 'talent-flow-cognito.6122df1.tf.txt'), 'utf8');
    const baseClient = blocks([join(HERE, 'talent-flow-cognito.6122df1.tf.txt')], 'resource').find((b) => b.labels[1] === 'talent_flow_web')!;
    expect(squash(web!.body), 'the TalentFlow web client is unchanged').toBe(squash(baseClient.body));
    const basePool = blocks([join(HERE, 'talent-flow-cognito.6122df1.tf.txt')], 'resource').find((b) => b.labels[0] === 'aws_cognito_user_pool' && b.labels[1] === 'talent_flow')!;
    const pool2 = blocks(tfFilesList, 'resource').find((b) => b.labels[0] === 'aws_cognito_user_pool' && b.labels[1] === 'talent_flow')!;
    expect(squash(pool2.body), 'the TalentFlow pool is unchanged').toBe(squash(basePool.body));
    void baseTf;
    const added = clients.filter((b) => b.labels[1] !== 'talent_flow_web');
    expect(added, 'one new client in talent-flow-infra').toHaveLength(1);
    const c = attributes(added[0]!.body);
    expect(c.get('user_pool_id'), 'the new client is on the TalentFlow pool').toBe('aws_cognito_user_pool.talent_flow.id');
    expect(c.get('explicit_auth_flows')?.replace(/\s+/g, ''), 'the new client allows only ADMIN_USER_PASSWORD_AUTH').toBe('["ALLOW_ADMIN_USER_PASSWORD_AUTH"]');
    for (const k of ['allowed_oauth_flows', 'allowed_oauth_flows_user_pool_client', 'callback_urls', 'logout_urls', 'allowed_oauth_scopes', 'supported_identity_providers']) expect(c.has(k), `the new client has no ${k} (no sign-in page uses it)`).toBe(false);

    // Terraform may never manage table data.
    expect(blocks(all(), 'resource').filter((b) => b.labels[0] === 'aws_dynamodb_table_item'), 'no aws_dynamodb_table_item (the apply roles may not read or write table data)').toEqual([]);
  });

  // ------------------------------------------------------------- AC-8

  test('AC-8 A TalentFlow user moves silently @pepla-dev', async ({ page }, testInfo) => {
    test.skip(!ON_DEV, 'pepla-dev only: the no-backend run covers this in AC-1 to AC-4.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width.');
    const env = (k: string) => process.env[k] ?? '';
    const counts = join(REPO, 'scripts', 'tenancy', 'ten-06-dev-count.json');
    test.skip(!existsSync(counts), 'The merger records the number of candidates the TalentFlow-only test login saw before the move in scripts/tenancy/ten-06-dev-count.json ({ "candidates": <n> }); not recorded yet.');
    const before = (JSON.parse(readFileSync(counts, 'utf8')) as { candidates: number }).candidates;
    const login = { email: env('E2E_TF_ONLY_EMAIL'), password: env('E2E_TF_ONLY_PASSWORD') };
    expect(login.email, 'the TalentFlow-only test login is set (E2E_TF_ONLY_EMAIL, seeded in the TalentFlow pool only)').toBeTruthy();
    expect(login.password, 'its password is set (E2E_TF_ONLY_PASSWORD)').toBeTruthy();
    const devEnvText = readFileSync(join(REPO, 'hr-portal', 'src', 'environments', 'environment.ts'), 'utf8');
    const clientId = /\bcognito\s*:\s*\{[^}]*?clientId\s*:\s*['"`]([^'"`]+)['"`]/s.exec(devEnvText)?.[1] ?? '';
    const region = /\bcognito\s*:\s*\{[^}]*?region\s*:\s*['"`]([^'"`]+)['"`]/s.exec(devEnvText)?.[1] ?? 'af-south-1';
    const tfApi = (/talentFlow\s*:\s*\{[^}]*?apiUrl\s*:\s*['"`]([^'"`]+)['"`]/s.exec(devEnvText)?.[1] ?? '').replace(/\/+$/, '');
    expect(clientId, 'the old app\'s dev environment names the Naleko web client').not.toBe('');
    expect(tfApi, 'the TalentFlow API address is written for pepla-dev').toMatch(/^https:\/\/[^/]+\.execute-api\./);
    const signIn = async () => {
      const r = await page.request.post(`https://cognito-idp.${region}.amazonaws.com/`, {
        headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
        data: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: clientId, AuthParameters: { USERNAME: login.email, PASSWORD: login.password } }),
      });
      expect(r.status(), 'the TalentFlow password signs in at the one pool (the person is moved)').toBe(200);
      const token = ((await r.json()) as any).AuthenticationResult.IdToken as string;
      const payload = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as Record<string, any>;
      return { token, payload };
    };
    const first = await signIn();
    expect(first.payload['tenant_id'], 'the first token carries the company').toMatch(/^ten_[0-9a-z]{26}$/);
    expect(first.payload['user_id'], 'the first token carries the old TalentFlow id').toBeTruthy();
    expect(first.payload['user_id'], 'which is not the new sub').not.toBe(first.payload['sub']);
    expect(((first.payload['cognito:groups'] as string[] | undefined) ?? []).length, 'and the person\'s groups').toBeGreaterThan(0);
    const list = await page.request.get(`${tfApi}/candidates`, { headers: { Authorization: `Bearer ${first.token}` } });
    expect(list.status(), 'GET /v1/candidates: 200 with the moved sign-in').toBe(200);
    expect(((await list.json()) as { candidates?: unknown[] }).candidates?.length ?? 0, 'the same number of candidates as before the move').toBe(before);
    expect(before, 'there were candidates to see').toBeGreaterThan(0);
    // The next sign-in is an ordinary one: the same person (same sub, same old id), no second move.
    const second = await signIn();
    expect(second.payload['sub'], 'the next sign-in is the same person in the one pool (same sub)').toBe(first.payload['sub']);
    expect(second.payload['user_id'], 'with the same old id').toBe(first.payload['user_id']);
    expect(second.payload['tenant_id'], 'and the same company').toBe(first.payload['tenant_id']);
  });
});

/** Runs one of TEN-03's routes with the authorizer given, against TEN-03's seeded world. */
function askWith(route: (typeof ROUTES)[number], authorizer: unknown) {
  // ask() builds its authorizer from a caller name; replace it by running the same request through the harness' event builder.
  const { httpEvent } = require('./support/ten-03/lambda-harness') as typeof import('./support/ten-03/lambda-harness');
  const { fileOf, settings, POOL, AGENT_SECRET } = require('./support/ten-03/world') as typeof import('./support/ten-03/world');
  const { runHandler: run } = require('./support/ten-03/lambda-harness') as typeof import('./support/ten-03/lambda-harness');
  const a = route.own;
  const event = httpEvent({ authorizer, path: a.path, query: a.query, body: a.body, headers: a.headers });
  if (a.method) event.requestContext.http.method = a.method;
  if (a.rawPath) event.rawPath = a.rawPath;
  return run(fileOf(route.handler), event, { tables: seededTables(), secrets: { [AGENT_SECRET]: { AWSCURRENT: 'ten03-agent-key' } }, env: settings(), cognito: POOL });
}
function TALENT_FLOW_ONLY(): Pool { return TALENTFLOW_POOL; }
void [SUB, ask, plain, LAMBDA, resources, nested];
