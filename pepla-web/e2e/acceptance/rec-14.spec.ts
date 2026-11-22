import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { REPO, runHandler, runScript, httpEvent, type Run, type Sts, type Tables } from './support/rec-14/lambda-harness';
import { filesOf, kmsList, lambdaNamed, policyLines, resourcesOf, roleResourceOf, settingsOf, TENANTS_RESOURCE } from './support/rec-04/iam';
import { attributes, blocks, stripComments } from './support/infra-harness';
import { answerSchema, checker, looseObjects, operation, readDoc, refName, type Doc } from './support/rec-14/schema';
import {
  A, ADMIN_FORMS, B, C, DEP, DEP_ID, HANDLER_DIR, ISO, LIST_A, LIST_B, NOT_READERS, NOT_WRITERS, READERS, ROUTE, SEED, SEED_DEV, SEED_RUN, SET_MODULES,
  SHARED, STARTING, TENANTS, TENANTS_PROD, VERSION, WALK_DEPARTMENT, WHO, WRITERS,
  add, ask, auditsOf, authorizerOf, av, bodyOf, change, companyRows, describe, dynamoOps, handlerExists, handlerFile, keysNamed, list, listOf, listRow, logsOf,
  newKey, otherCalls, othersThan, plain, read, rowsOf, sortKeys, statusOf, tables, writesOf, type Caller, type Dep, type RouteKey,
} from './support/rec-14/world';

/**
 * REC-14 step A · Departments: every company keeps its own list on the server (red). Spec: /mnt/project-files/onboarding-cards/specs/REC-14.md
 * (rules 1 to 9, AC-1 to AC-4). Notes: cards/rec-14.md. Review page: onboarding-cards/specs/REC-14-tests-for-review.md (the bar).
 *
 * Scope (coordinator, 22 Nov 2026): this lock covers step A only, the departments store: AC-1 (read the list), AC-2 (add, rename, archive,
 * restore), AC-3 (only its own rows) and AC-4 (the seed). Steps B to D (the options route, the page, the old departments) get their own tests
 * later, on child locks of this card (rec-14.1 and on). Q-2 to Q-4 take the spec's recommended options (Admin only changes the list).
 *
 * The Lambda tests run the real handler (lambda/manageDepartments) in a fresh Node process each call, against a fake AWS
 * (support/rec-14/fake-aws, REC-04's copy with one hook added: another Admin saving between this caller's read and its write). The seed
 * and the module script run against the same fake. The dev seed (scripts/ci/seed-dev.py, seed_departments) runs against an in-memory table
 * (support/rec-14/seed-run.py, no AWS). AC-3 reads code and Terraform as text. Every answer is checked against api/openapi.yaml (rule 15).
 * One test runs on pepla-dev only (@pepla-dev): it reads, and changes nothing. Nothing calls AWS or any AI in the no-backend run.
 *
 * Pinned by the verifier where the spec is silent (each is in cards/rec-14.md for the BA to confirm):
 *  - D-T-1 One Lambda, lambda/manageDepartments (index.mjs), serves the three routes, routed by the route key. It is in infra/ with its own role,
 *    on the employees API (JWT, the employees API's Cognito authorizer), next to PUT /v1/admin/company/ask-batsi. Its only setting is
 *    TENANTS_TABLE. The employees API's CORS gains PATCH; idempotency-key is already allowed.
 *  - D-T-2 Who: reading is HR staff (role hr_staff), an Admin (role admin) or a Recruiter (REC-01 isRecruiter, old HR names included until
 *    TEN-06); old names count through TEN-05 (roles.mjs). Changing is an Admin only (Q-2). The role check comes first (403, no AWS call), then
 *    requireTenant (403, no AWS call). No module check. In api/openapi.yaml: x-tenant token; x-roles [admin, hr_staff] for the read, [admin]
 *    for the two writes.
 *  - D-T-3 `?include=archived` from anyone who is not an Admin is ignored: they get the active list, not a 403. Any other value is ignored.
 *  - D-T-4 "Sorted by name" ignores case (aviation before Engineering). With archived ones included, all are sorted together.
 *  - D-T-5 Every department in an answer is { id, name, status }. The POST answers 201 { version, department }; the PATCH 200 { version, department }.
 *  - D-T-6 Errors: 400 { error: 'Bad request', code: 'INVALID_FIELD', field } (field name, status or expected_version); 400 { error: 'Bad request',
 *    code: 'IDEMPOTENCY_KEY_REQUIRED' }; 409 { error: 'Conflict', code: 'DUPLICATE_NAME' | 'TOO_MANY_DEPARTMENTS' | 'STALE_VERSION' };
 *    404 { error: 'Not found' }; 403 { error: 'Forbidden' }; 500 { error: 'Something went wrong' } with the error's name only in the log.
 *    A body that is not JSON is 400 (code not pinned). Fields the routes do not take (id, status on the POST, version, tenant_id) are ignored.
 *  - D-T-7 A department id is dep_ and a ULID (26 letters and digits). A name is trimmed and every run of spaces inside becomes one space; that
 *    is what is stored, checked for length and compared. The same name ignoring case is a duplicate; a department renamed to its own name in
 *    other letters is not.
 *  - D-T-8 The list row: pk TENANT#<id>, sk DEPARTMENTS, tenant_id, version, departments [{ id, name, status }], updated_at, updated_by (the
 *    caller's sub). An audit row: pk TENANT#<id>, sk DEPARTMENTS#<iso time>#<ulid>, tenant_id, action, department_id, by (the caller's sub),
 *    at; a RENAME also carries from and to (the names). One audit row per change: a PATCH that renames and archives writes two, and the
 *    version goes up once.
 *  - D-T-9 The Idempotency-Key is kept in the company list too (sk starting DEPARTMENTS#, rule 6), in the same transaction. The same key
 *    from the same company gives back the first answer and changes nothing; another company's same key is its own.
 *  - D-T-10 The PATCH needs expected_version (a whole number); a missing or stale one is refused before anything is written. A PATCH with a
 *    made-up id, or another company's, is 404 whatever the version. A PATCH that changes nothing answers 200 with the stored department and
 *    version and writes nothing. On a version clash the POST reads again and tries once more; a second clash is 409 STALE_VERSION.
 *  - D-T-11 The seed: `node scripts/tenancy/company-seeds/departments.mjs --env dev|prod --tenant <id> [--apply]`, on
 *    naleko-people-<env>-tenants. Without --apply it prints the plan and writes nothing. It refuses (non-zero, nothing written) a bad --env, a
 *    bad or missing --tenant, and a company with no Company row. Version 1 holds the four Q-1 names, all active.
 *  - D-T-12 set-modules turning Onboarding or Recruitment on runs the department seed before the flip (MOD-01's seed before flip): a failing
 *    department write leaves the modules as they were.
 *  - D-T-13 The dev seed: seed_departments(ddb) in scripts/ci/seed-dev.py, called by main(), gives the founding, second and walk companies
 *    version 1 with the department seed's own starting names (read from company-seeds/departments.mjs, so there is one list of names; it does
 *    not start node, because be-16 AC-4 runs seed-dev.py with a fake boto3 only) when they have no list, and keeps a list that exists. The
 *    founding company also gets Fleet with the walk's fixed id (support/ten-04/dev-ids.json `department`), put back to "Fleet", active, on
 *    every run; the second company gets at least one name of its own. A second run changes nothing.
 *  - D-T-14 The company walk rows of the three routes go in scripts/tenancy/ten-04-rows.json (TEN-04 P7); the PATCH row aims at the
 *    `department` id (child lock ten-04.8 adds that kind).
 *  - D-T-15 The PII key: manageDepartments' role is on the key's DynamoDB read list (dynamodb_read_role_arns) once, never on
 *    allowed_role_arns; its own policy has no KMS action (BE-18: DynamoDB writes with the table key).
 *  - D-T-16 (lock check round 2) A list that exists with every department archived is still a list: the seed, the module script
 *    and seed-dev.py leave it as it is (nothing written, version unchanged). The seed and seed-dev.py read a list with a
 *    consistent read.
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS or reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};
const FORBIDDEN = { error: 'Forbidden' };
const NOT_FOUND = { error: 'Not found' };
const SOMETHING = { error: 'Something went wrong' };
const bad = (code: string, field?: string) => ({ error: 'Bad request', code, ...(field ? { field } : {}) });
const conflict = (code: string) => ({ error: 'Conflict', code });
const answer = (r: Run) => [statusOf(r), bodyOf(r)];
const byName = (a: { name: string }, b: { name: string }) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());
const shown = (deps: Dep[], archived = false) => deps.filter((d) => archived || d.status === 'ACTIVE').map((d) => ({ id: d.id, name: d.name, status: d.status })).sort(byName);
const sameTables = (x: Tables | undefined, y: Tables | undefined) => JSON.stringify(sortKeys(x ?? {})) === JSON.stringify(sortKeys(y ?? {}));
const ids = (deps: { id: string }[] | undefined) => (deps ?? []).map((d) => d.id).sort();
const ULID_SK = /^DEPARTMENTS#\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z#[0-9A-HJKMNP-TV-Z]{26}$/;
const DEV_STS: Sts = { Account: '424556617428', Arn: 'arn:aws:sts::424556617428:assumed-role/pepla-dev-operator/rec14', UserId: 'AROAREC14DEV:rec14' };
const PROD_STS: Sts = { Account: '937137806477', Arn: 'arn:aws:sts::937137806477:assumed-role/naleko-prod-operator/rec14', UserId: 'AROAREC14PROD:rec14' };

/** JavaScript with comments blanked out; strings kept (as rec-04.spec.ts). */
function stripJs(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const two = src.slice(i, i + 2);
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (two === '//') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
    } else if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else { out += c; i++; }
  }
  return out;
}

// ---------------------------------------------------------------- the contract (rules 14 and 15)

let docCache: Doc | undefined;
const doc = () => (docCache ??= readDoc());
/** Problems of one answer against the file's schema for its route and status (empty when it fits). */
function misfit(route: RouteKey, r: Run): string[] {
  const s = statusOf(r);
  if (s === undefined) return [`no answer (${describe(r)})`];
  return checker(doc()).check(answerSchema(doc(), route, s), bodyOf(r)).map((p) => `${route} ${s}: ${p}`);
}
/** Every answer passes the file's schema for its route and status. */
const fits = (route: RouteKey, label: string, ...runs: Run[]) => {
  for (const r of runs) expect.soft(misfit(route, r), `${label}: the answer (${describe(r).slice(0, 120)}) passes api/openapi.yaml`).toEqual([]);
};

/** Nothing written: the company list is exactly as it was. */
const unchanged = (label: string, before: Tables, r: Run) => {
  expect.soft(sameTables(r.tables, before), `${label}: nothing is written (the company list is as it was)`).toBe(true);
};
/** Refused before any AWS call. */
const noAws = (label: string, r: Run) => {
  expect.soft(dynamoOps(r), `${label}: no DynamoDB call`).toEqual([]);
  expect.soft(otherCalls(r), `${label}: and no other AWS call`).toEqual([]);
};
/** Rule 6: every key a run names is its own company's DEPARTMENTS row or a DEPARTMENTS# row; no Query, Scan, Delete or batch. */
const ownKeysOnly = (label: string, r: Run, company: string) => {
  const wrong = keysNamed(r).filter((k) => k.pk !== `TENANT#${company}` || !(k.sk === 'DEPARTMENTS' || k.sk.startsWith('DEPARTMENTS#')));
  expect.soft(wrong.map((k) => `${k.op} ${k.pk} ${k.sk}`), `${label}: every key it builds is TENANT#<its company> with sk DEPARTMENTS or DEPARTMENTS#...`).toEqual([]);
  expect.soft(dynamoOps(r).filter((o) => /Query|Scan|Delete|BatchGet|BatchWrite/.test(o)), `${label}: no Query, Scan, Delete or batch call`).toEqual([]);
  expect.soft([...new Set((r.calls as any[]).filter((c) => c.service === 'dynamodb').flatMap((c) => c.op === 'TransactWriteItems' ? (c.input?.TransactItems ?? []).map((t: any) => (Object.values(t)[0] as any)?.TableName) : [c.table]))], `${label}: only the company list table`).toEqual(dynamoOps(r).length ? [TENANTS] : []);
};
/** The DEPARTMENTS GetItem of a run read consistently (rule 7). */
const consistent = (label: string, r: Run) => {
  const gets = (r.calls as any[]).filter((c) => c.service === 'dynamodb' && c.op === 'GetItem' && plain(c.input?.Key)['sk'] === 'DEPARTMENTS');
  expect.soft(gets.length, `${label}: the list is read with GetItem`).toBeGreaterThan(0);
  expect.soft(gets.every((c) => c.input?.ConsistentRead === true), `${label}: with a consistent read`).toBe(true);
};

/** The company list after a write, checked for rule 1, 2, 5 and D-T-8. */
function written(label: string, before: Tables, r: Run, company: string, who: Caller, expect_: { version: number; deps: Dep[]; audits: { action: string; department_id: string; from?: string; to?: string }[] }) {
  const row = listOf(r.tables, company);
  expect.soft(row?.['version'], `${label}: the list row is version ${expect_.version}`).toBe(expect_.version);
  expect.soft(row?.['tenant_id'], `${label}: the list row carries its company`).toBe(company);
  const stored = ((row?.['departments'] ?? []) as Dep[]).map((d) => ({ id: d.id, name: d.name, status: d.status }));
  expect.soft(stored.slice().sort((x, y) => x.id.localeCompare(y.id)), `${label}: the stored departments`).toEqual(expect_.deps.map((d) => ({ id: d.id, name: d.name, status: d.status })).sort((x, y) => x.id.localeCompare(y.id)));
  expect.soft(row?.['updated_by'], `${label}: updated_by is the caller`).toBe(who.sub);
  expect.soft(String(row?.['updated_at'] ?? ''), `${label}: updated_at is a time`).toMatch(ISO);
  const old = new Set(auditsOf(before, company).map((a) => a['sk']));
  const fresh = auditsOf(r.tables, company).filter((a) => !old.has(a['sk']));
  expect.soft(fresh.map((a) => a['action']).sort(), `${label}: one audit row per change`).toEqual(expect_.audits.map((a) => a.action).sort());
  for (const want of expect_.audits) {
    const a = fresh.find((x) => x['action'] === want.action) ?? {};
    expect.soft(String(a['sk'] ?? ''), `${label}: the ${want.action} audit row is sk DEPARTMENTS#<time>#<ulid>`).toMatch(ULID_SK);
    expect.soft([a['tenant_id'], a['department_id'], a['by']], `${label}: the ${want.action} audit row names the company, the department and who`).toEqual([company, want.department_id, who.sub]);
    expect.soft(String(a['at'] ?? ''), `${label}: and when`).toMatch(ISO);
    if (want.from !== undefined) expect.soft(a['from'], `${label}: the ${want.action} audit row's from`).toBe(want.from);
    if (want.to !== undefined) expect.soft(a['to'], `${label}: the ${want.action} audit row's to`).toBe(want.to);
  }
  expect.soft(othersThan(r.tables, company), `${label}: no other row of the company list changes (Company rows, Member rows, MODULES# rows, other companies)`).toBe(othersThan(before, company));
  const tx = writesOf(r);
  expect.soft(tx.map((c: any) => c.op), `${label}: the change is one TransactWriteItems (rule 5)`).toEqual(['TransactWriteItems']);
  const steps = (tx[0]?.input?.TransactItems ?? []).map((t: any) => Object.values(t)[0] as any);
  const listStep = steps.find((s: any) => plain(s?.Key ?? s?.Item)['sk'] === 'DEPARTMENTS');
  expect.soft(!!listStep?.ConditionExpression, `${label}: the list row is written with a condition (version = what was read, or not there yet)`).toBe(true);
}

/** A company whose list holds `n` departments (`archived` of them archived), at version 40. */
function fullWorld(n: number, archived = 0): Tables {
  const deps: Dep[] = Array.from({ length: n }, (_x, i) => ({ id: `dep_01REC14MANY${String(i).padStart(15, '0')}`, name: `Department ${i + 1}`, status: i < archived ? 'ARCHIVED' : 'ACTIVE' }));
  return { [TENANTS]: [...companyRows(), listRow(A, 40, deps), listRow(B, VERSION.B, LIST_B)] };
}

// ---------------------------------------------------------------- the dev seed (support/rec-14/seed-run.py)

const FOUNDING = /^\s*founding_tenant_id\s*=\s*"(ten_[0-9a-z]{26})"/m.exec(read(join(REPO, 'infra', 'env', 'dev.tfvars')))?.[1] ?? '';
const SECOND = /^SECOND_TENANT_ID\s*=\s*"(ten_[0-9a-z]{26})"/m.exec(read(SEED_DEV))?.[1] ?? '';
const WALK = /^WALK_TENANT_ID\s*=\s*"(ten_[0-9a-z]{26})"/m.exec(read(SEED_DEV))?.[1] ?? '';
function devWorld(): Tables {
  const profile = (c: string, name: string) => av({ pk: `TENANT#${c}`, sk: 'PROFILE', tenant_id: c, name, status: 'ACTIVE', country: 'ZA', created_at: '2026-11-18T00:00:00Z', modules: new Set(['onboarding', 'recruitment']) });
  return { [TENANTS]: [profile(FOUNDING, 'Founding client'), profile(SECOND, 'Company B'), profile(WALK, 'Company C (walk)')], 'talent-flow-state': [], 'talent-flow-roles': [] };
}
/** Two departments, both archived: a list that exists but has nothing active. */
const ARCHIVED_ONLY = (c: string): Dep[] => [
  { id: `dep_01REC14${c.slice(4, 5).toUpperCase() === 'H' ? 'H' : 'X'}${'0'.repeat(17)}1`, name: 'Old Kitchen', status: 'ARCHIVED' },
  { id: `dep_01REC14${c.slice(4, 5).toUpperCase() === 'H' ? 'H' : 'X'}${'0'.repeat(17)}2`, name: 'Old Stores', status: 'ARCHIVED' },
];
function runDevSeed(t: Tables): { tables?: Tables; calls?: any[]; error?: string; returned?: unknown } {
  const dir = mkdtempSync(join(tmpdir(), 'rec-14-seed-'));
  const file = join(dir, 'world.json');
  writeFileSync(file, JSON.stringify({ tables: t }));
  const out = execFileSync('python3', ['-I', SEED_RUN, SEED_DEV, file, join(__dirname, 'support', 'rec-14', 'fake-aws')], { encoding: 'utf8', timeout: 120_000, cwd: dir });
  const line = out.split('\n').find((l) => l.startsWith('@@REC14@@'));
  if (!line) throw new Error(`the seed run printed no result:\n${out.slice(-1500)}`);
  return JSON.parse(line.slice('@@REC14@@'.length));
}

// ---------------------------------------------------------------- Terraform (AC-3)

const FN = 'manageDepartments';
function theLambda() {
  const found = lambdaNamed(FN);
  return { found, fn: found[0], role: found[0] ? roleResourceOf(found[0].block) : undefined };
}
const tfText = (file: string) => (existsSync(join(REPO, 'infra', file)) ? stripComments(readFileSync(join(REPO, 'infra', file), 'utf8')) : '');
const sq = (s: string) => s.replace(/\s+/g, '');

// ---------------------------------------------------------------- tests

test.describe('REC-14 step A · Departments: every company keeps its own list', () => {
  test('Control: the world is good: the Ask Batsi switch runs for A\'s Admin in this fake, the file reads, the dev seed file loads', async ({}, testInfo) => {
    once(testInfo.project.name);
    // An existing Admin route of the same API and table answers through this world and these callers.
    const ev = httpEvent({ authorizer: authorizerOf(WHO.adminB), body: { enabled: true } });
    ev.routeKey = 'PUT /v1/admin/company/ask-batsi';
    const sw = runHandler(join(REPO, 'lambda', 'adminSetAskBatsi', 'index.mjs'), ev, { tables: tables(), env: { TENANTS_TABLE: TENANTS } });
    expect.soft(statusOf(sw), `B's Admin turns Ask Batsi on (${describe(sw)})`).toBe(200);
    expect.soft(rowsOf(sw.tables, TENANTS).filter((r) => r['pk'] === `TENANT#${B}` && String(r['sk']).startsWith('MODULES#')).length, 'and one more MODULES# audit row is written for B').toBe(2);
    const refused = runHandler(join(REPO, 'lambda', 'adminSetAskBatsi', 'index.mjs'), { ...ev, requestContext: { ...ev.requestContext, authorizer: authorizerOf(WHO.hrA) } }, { tables: tables(), env: { TENANTS_TABLE: TENANTS } });
    expect.soft(answer(refused), 'HR staff is refused there').toEqual([403, FORBIDDEN]);
    // The world itself.
    expect.soft(listOf(tables(), A)?.['version'], 'A\'s list is version 7').toBe(VERSION.A);
    expect.soft(listOf(tables(), C), 'C has no list').toBeUndefined();
    // The file reads, and its Error schema checks an answer.
    const d = readDoc();
    expect.soft(Object.keys(d.paths ?? {}).length, 'api/openapi.yaml reads').toBeGreaterThan(20);
    expect.soft(checker(d).check({ $ref: '#/components/schemas/Error' }, { error: 'x' }), 'the validator runs on the file\'s components').toEqual([]);
    expect.soft(checker(d).check({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false }, { a: 'x', b: 1 }).length, 'and refuses an extra field').toBeGreaterThan(0);
    // The dev seed file loads in the in-memory harness (it may not have the departments part yet).
    const s = runDevSeed(devWorld());
    expect.soft(s.error ?? '', 'seed-dev.py loads with boto3 replaced').toMatch(/^$|has no seed_departments/);
    expect.soft([FOUNDING, SECOND, WALK].every((x) => /^ten_[0-9a-z]{26}$/.test(x)), 'the three dev company ids are found').toBe(true);
  });

  // ---------------------------------------------------------------- AC-1

  test('AC-1 HR staff, Admin and Recruiter of A read A\'s active departments, sorted by name, with the version', async ({}, testInfo) => {
    once(testInfo.project.name);
    expect(handlerExists(), 'lambda/manageDepartments/index.mjs exists').toBe(true);
    const want = { version: VERSION.A, departments: shown(LIST_A) };
    expect(want.departments.map((d) => d.name), 'control: the expected order ignores case').toEqual(['aviation', 'Engineering', 'Finance', 'Fleet', 'Operations', 'People']);
    for (const who of READERS) {
      const t = tables();
      const r = list(who, undefined, { tables: t });
      expect.soft(answer(r), `${who.name}: A's active departments, sorted by name, and the version (${describe(r)})`).toEqual([200, want]);
      fits(ROUTE.list, who.name, r);
      unchanged(who.name, t, r);
      expect.soft(writesOf(r), `${who.name}: a read writes nothing`).toEqual([]);
      ownKeysOnly(who.name, r, A);
      consistent(who.name, r);
      expect.soft(otherCalls(r), `${who.name}: no other AWS call (no Cognito, no module read)`).toEqual([]);
    }
  });

  test('AC-1 Archived ones are listed only for an Admin who asks with ?include=archived', async ({}, testInfo) => {
    once(testInfo.project.name);
    const all = { version: VERSION.A, departments: shown(LIST_A, true) };
    const active = { version: VERSION.A, departments: shown(LIST_A) };
    expect(all.departments.map((d) => d.name), 'control: archived ones sort with the others').toEqual(['aviation', 'Engineering', 'Finance', 'Fleet', 'Old Stores', 'Operations', 'People']);
    for (const who of WRITERS) {
      const r = list(who, { include: 'archived' });
      expect.soft(answer(r), `${who.name} with ?include=archived: archived ones too (${describe(r)})`).toEqual([200, all]);
      fits(ROUTE.list, who.name, r);
    }
    expect.soft(answer(list(WHO.adminA)), 'an Admin who does not ask: active ones only').toEqual([200, active]);
    for (const v of ['ARCHIVED', 'all', 'archived,active', '1', '']) expect.soft(answer(list(WHO.adminA, { include: v })), `an Admin with ?include=${v}: active ones only`).toEqual([200, active]);
    for (const who of [WHO.hrA, WHO.recruiterA, WHO.oldHrA]) {
      const r = list(who, { include: 'archived' });
      expect.soft(answer(r), `${who.name} with ?include=archived: active ones only, not a refusal (D-T-3)`).toEqual([200, active]);
    }
  });

  test('AC-1 Everyone else is refused before anything is read', async ({}, testInfo) => {
    once(testInfo.project.name);
    for (const who of NOT_READERS) {
      const r = list(who);
      expect.soft(answer(r), `${who.name}: 403 (${describe(r)})`).toEqual([403, FORBIDDEN]);
      noAws(who.name, r);
      fits(ROUTE.list, who.name, r);
    }
    for (const who of [WHO.adminNoCompany, WHO.hrNoCompany, WHO.adminBadCompany]) {
      const r = list(who, { include: 'archived' });
      expect.soft(answer(r), `${who.name}: 403 (${describe(r)})`).toEqual([403, FORBIDDEN]);
      noAws(who.name, r);
    }
  });

  test('AC-1 C has no list yet; B sees only B\'s; nothing in the request changes the company', async ({}, testInfo) => {
    once(testInfo.project.name);
    for (const who of [WHO.hrC, WHO.adminC]) {
      const r = list(who, { include: 'archived' });
      expect.soft(answer(r), `${who.name}: { version: 0, departments: [] } (${describe(r)})`).toEqual([200, { version: 0, departments: [] }]);
      fits(ROUTE.list, who.name, r);
      expect.soft(writesOf(r), `${who.name}: and nothing is written`).toEqual([]);
      ownKeysOnly(who.name, r, C);
    }
    const bActive = { version: VERSION.B, departments: shown(LIST_B) };
    const bAll = { version: VERSION.B, departments: shown(LIST_B, true) };
    expect.soft(answer(list(WHO.hrB)), 'B\'s HR: B\'s active departments').toEqual([200, bActive]);
    expect.soft(answer(list(WHO.adminB, { include: 'archived' })), 'B\'s Admin with archived: all of B\'s').toEqual([200, bAll]);
    const aOnly = [...LIST_A.map((d) => d.id), 'Fleet', 'aviation', 'Old Stores', 'Finance', 'Operations', 'People', A];
    // The company is the sign-in's: in the query, the body, the path and the headers, A's id changes nothing.
    const forged: [string, Caller, Parameters<typeof ask>[2], unknown][] = [
      ['A in the query', WHO.adminB, { query: { include: 'archived', tenant_id: A, tenantId: A, company: A, companyId: A } }, bAll],
      ['A in the body', WHO.adminB, { query: { include: 'archived' }, body: { tenant_id: A, tenantId: A, company: A } }, bAll],
      ['A in the path', WHO.adminB, { query: { include: 'archived' }, path: { tenantId: A, tenant_id: A, company: A } }, bAll],
      ['A in the headers', WHO.adminB, { query: { include: 'archived' }, headers: { 'x-tenant-id': A, 'x-company-id': A, tenant_id: A, 'x-tenant': A } }, bAll],
      ['A everywhere, for B\'s HR', WHO.hrB, { query: { tenant_id: A }, body: { tenant_id: A }, path: { tenantId: A }, headers: { 'x-tenant-id': A } }, bActive],
      ['A\'s id in the path for C', WHO.hrC, { path: { tenantId: A, id: DEP.fleetA.id }, query: { tenant_id: A } }, { version: 0, departments: [] }],
    ];
    for (const [what, who, a, want] of forged) {
      const r = ask(ROUTE.list, who, a);
      expect.soft(answer(r), `${who.name}, ${what}: still their own company's answer (${describe(r)})`).toEqual([200, want]);
      const text = JSON.stringify(bodyOf(r));
      for (const m of aOnly) if (!(who.company === 'B' && ['Engineering'].includes(m))) expect.soft(text.includes(m) && !(LIST_B.some((d) => d.name === m)), `${who.name}, ${what}: the answer holds nothing of A's (${m})`).toBe(false);
      ownKeysOnly(`${who.name}, ${what}`, r, who.company === 'B' ? B : C);
    }
  });

  test('AC-1 Every answer passes api/openapi.yaml, and the file is strict', async ({}, testInfo) => {
    once(testInfo.project.name);
    const d = readDoc();
    const ops = Object.values(ROUTE).map((k) => [k, operation(d, k)] as const);
    for (const [k, op] of ops) {
      expect.soft(!!op, `${k} is in api/openapi.yaml`).toBe(true);
      if (!op) continue;
      expect.soft(op['x-tenant'], `${k}: x-tenant token (the company is the sign-in's)`).toBe('token');
      expect.soft(JSON.stringify(op.security), `${k}: a Cognito sign-in`).toBe(JSON.stringify([{ CognitoJWT: [] }]));
      expect.soft([...(op['x-roles'] ?? [])].sort(), `${k}: x-roles (D-T-2)`).toEqual(k === ROUTE.list ? ['admin', 'hr_staff'] : ['admin']);
      const askBatsi = operation(d, 'PUT /v1/admin/company/ask-batsi');
      expect.soft(JSON.stringify(op.servers ?? d.paths?.[k.split(' ')[1]!]?.servers), `${k}: on the employees API (the same address as the Ask Batsi switch)`).toBe(JSON.stringify(askBatsi?.servers ?? d.paths?.['/v1/admin/company/ask-batsi']?.servers));
    }
    // Rule 14: named schemas, strict objects.
    const okList = answerSchema(d, ROUTE.list, 200);
    expect.soft(refName(okList), 'GET answers the named schema DepartmentList').toBe('DepartmentList');
    expect.soft(!!d.components?.schemas?.['Department'], 'the file names a Department schema').toBe(true);
    const okAdd = answerSchema(d, ROUTE.add, 201);
    const okChange = answerSchema(d, ROUTE.change, 200);
    for (const [what, s] of [['GET 200', okList], ['POST 201', okAdd], ['PATCH 200', okChange]] as const) {
      expect.soft(!!s, `${what} has a JSON schema`).toBe(true);
      expect.soft(looseObjects(d, s, what), `${what}: every object is strict (additionalProperties: false, every property required)`).toEqual([]);
    }
    const depRef = (s: any) => (refName(s) ? d.components?.schemas?.[refName(s)!] : s)?.properties?.department;
    expect.soft(refName(depRef(okAdd)), 'POST 201 { department } is the Department schema').toBe('Department');
    expect.soft(refName(depRef(okChange)), 'PATCH 200 { department } is the Department schema').toBe('Department');
    const codes: [RouteKey, number[]][] = [[ROUTE.list, [403, 500]], [ROUTE.add, [400, 403, 409, 500]], [ROUTE.change, [400, 403, 404, 409, 500]]];
    for (const [k, list_] of codes) {
      for (const c of list_) {
        const s = answerSchema(d, k, c);
        expect.soft(!!s, `${k} describes its ${c} answer`).toBe(true);
        expect.soft(looseObjects(d, s, `${k} ${c}`, new Set(), ['code', 'field']), `${k} ${c}: strict (only error, code and field may be left out)`).toEqual([]);
      }
    }
    // The schema refuses what drifted before (rule 17's cases, on these routes).
    const chk = checker(d);
    const good = { version: 3, departments: [{ id: DEP.engA.id, name: 'Engineering', status: 'ACTIVE' }] };
    expect.soft(chk.check(okList, good), 'control: a good list passes').toEqual([]);
    const planted: [string, unknown][] = [
      ['departments as plain strings', { version: 3, departments: ['Engineering'] }],
      ['an extra field on a department', { version: 3, departments: [{ ...good.departments[0], tenant_id: A }] }],
      ['an extra field on the answer', { ...good, tenant_id: A }],
      ['no version', { departments: good.departments }],
      ['a version as text', { version: '3', departments: good.departments }],
      ['a department with no status', { version: 3, departments: [{ id: DEP.engA.id, name: 'Engineering' }] }],
      ['a status that is not ACTIVE or ARCHIVED', { version: 3, departments: [{ ...good.departments[0], status: 'DELETED' }] }],
      ['departments renamed', { version: 3, items: good.departments }],
    ];
    for (const [what, v] of planted) expect.soft(chk.check(okList, v).length, `GET 200 refuses ${what}`).toBeGreaterThan(0);
    expect.soft(chk.check(okAdd, { version: 4, department: { id: DEP.engA.id, name: 'Engineering', status: 'ACTIVE' } }), 'control: a good POST answer passes').toEqual([]);
    expect.soft(chk.check(okAdd, { version: 4, department: { id: DEP.engA.id, name: 'Engineering', status: 'ACTIVE', tenant_id: A } }).length, 'POST 201 refuses an extra field on the department').toBeGreaterThan(0);
    // Rule 15: the validator is the tests' own dev dependency.
    const pkg = JSON.parse(readFileSync(join(REPO, 'pepla-web', 'package.json'), 'utf8'));
    expect.soft(Object.keys(pkg.devDependencies ?? {}), 'pepla-web names ajv as a dev dependency (rule 15)').toContain('ajv');
    expect.soft(Object.keys(pkg.dependencies ?? {}), 'and not as an app dependency').not.toContain('ajv');
  });

  test('AC-1 A failing read is 500, with no detail in the answer or the log', async ({}, testInfo) => {
    once(testInfo.project.name);
    const secret = `Fleet ${DEP.fleetA.id} ${A} table naleko-people-dev-tenants is unavailable`;
    const r = list(WHO.hrA, undefined, { fail: { service: 'dynamodb', ops: ['GetItem'], message: secret, name: 'InternalServerError' } });
    expect.soft(answer(r), `500 with the fixed words (${describe(r)})`).toEqual([500, SOMETHING]);
    fits(ROUTE.list, 'the 500', r);
    const logs = logsOf(r);
    expect.soft(logs, 'the log names the error').toContain('InternalServerError');
    for (const bit of ['Fleet', DEP.fleetA.id, 'unavailable', A]) expect.soft(logs.includes(bit), `the log does not carry the message (${bit})`).toBe(false);
  });

  test('AC-1 The company walk has a row for each route (scripts/tenancy/ten-04-rows.json)', async ({}, testInfo) => {
    once(testInfo.project.name);
    const f = join(REPO, 'scripts', 'tenancy', 'ten-04-rows.json');
    const rows = JSON.parse(readFileSync(f, 'utf8')) as Record<string, any>;
    const readBack = { op: ROUTE.list };
    expect.soft(rows[ROUTE.list], 'GET: a list row (B\'s caller sees none of A\'s, naming A changes nothing)').toEqual({ kind: 'list' });
    expect.soft(rows[ROUTE.add]?.kind, 'POST: a create row').toBe('create');
    expect.soft(rows[ROUTE.add]?.read, 'POST: A reads its list back').toEqual(readBack);
    expect.soft(rows[ROUTE.add]?.body?.tenant_id, 'POST: B\'s caller names A in the body').toBe('$A');
    expect.soft(rows[ROUTE.change]?.kind, 'PATCH: a byId row').toBe('byId');
    expect.soft(rows[ROUTE.change]?.ids, 'PATCH: aimed at A\'s seeded department (D-T-14, child lock ten-04.8)').toEqual({ id: 'department' });
    expect.soft(rows[ROUTE.change]?.read, 'PATCH: A reads its list back').toEqual(readBack);
    expect.soft(typeof rows[ROUTE.change]?.body?.name === 'string' && Number.isInteger(rows[ROUTE.change]?.body?.expected_version), 'PATCH: B\'s caller sends a real change (a name and a version)').toBe(true);
    const devIds = JSON.parse(readFileSync(join(__dirname, 'support', 'ten-04', 'dev-ids.json'), 'utf8'));
    expect.soft(devIds['department'], 'support/ten-04/dev-ids.json names the walk department (child lock ten-04.8)').toBe(WALK_DEPARTMENT.id);
    expect.soft(read(join(__dirname, 'support', 'ten-04', 'rows.ts')), 'the walk knows the department kind (child lock ten-04.8)').toMatch(/'department'/);
    expect.soft(read(join(__dirname, 'ten-04.spec.ts')).match(/department: ids\['department'\]/g)?.length ?? 0, 'the walk\'s worlds carry the department id (child lock ten-04.8)').toBeGreaterThanOrEqual(2);
  });

  test('AC-1 On pepla-dev: each company reads only its own list, and the browser may send the writes @pepla-dev', async ({ page }, testInfo) => {
    test.skip(!ON_DEV, 'pepla-dev only: the no-backend run covers this in AC-1 and AC-2.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width.');
    test.setTimeout(4 * 60_000);
    const env = (k: string) => process.env[k] ?? '';
    const login = (p: string) => ({ email: env(`${p}_EMAIL`), password: env(`${p}_PASSWORD`) });
    const logins = { hr: login('E2E_HR'), companyB: login('E2E_HR_B') };
    for (const [who, l] of Object.entries(logins)) expect(l.email && l.password, `the ${who} test login is set`).toBeTruthy();
    const { devEnv } = await import('./support/ten-02/dev');
    const { api, region, clientId } = devEnv();
    const signIn = async (l: { email: string; password: string }) => {
      const r = await page.request.post(`https://cognito-idp.${region}.amazonaws.com/`, {
        headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
        data: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: clientId, AuthParameters: { USERNAME: l.email, PASSWORD: l.password } }),
      });
      expect(r.status(), 'signs in at Cognito').toBe(200);
      return ((await r.json()) as any).AuthenticationResult.IdToken as string;
    };
    const [hr, companyB] = await Promise.all([signIn(logins.hr), signIn(logins.companyB)]);
    const get = async (token: string) => {
      const r = await page.request.fetch(`${api}/v1/company/departments`, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
      const text = await r.text();
      let body: any = text;
      try { body = JSON.parse(text); } catch { /* the check below says so */ }
      return { status: r.status(), body };
    };
    const d = readDoc();
    const chk = checker(d);
    const a = await get(hr);
    expect(a.status, `the HR login reads its list (${JSON.stringify(a.body).slice(0, 200)})`).toBe(200);
    expect.soft(chk.check(answerSchema(d, ROUTE.list, 200), a.body), 'the real answer passes api/openapi.yaml').toEqual([]);
    const aDeps = (a.body.departments ?? []) as Dep[];
    for (const n of STARTING) expect.soft(aDeps.filter((x) => x.name === n && x.status === 'ACTIVE').length, `the founding company has ${n} (Q-1)`).toBe(1);
    expect.soft(aDeps.find((x) => x.id === WALK_DEPARTMENT.id), 'and Fleet with the walk\'s id (seed-dev.py)').toEqual({ ...WALK_DEPARTMENT, status: 'ACTIVE' });
    expect.soft(aDeps.map((x) => x.name), 'sorted by name').toEqual(aDeps.map((x) => x.name).slice().sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase())));
    const b = await get(companyB);
    expect(b.status, 'the company B login reads its own list').toBe(200);
    expect.soft(chk.check(answerSchema(d, ROUTE.list, 200), b.body), 'its answer passes api/openapi.yaml').toEqual([]);
    const bIds = ((b.body.departments ?? []) as Dep[]).map((x) => x.id);
    expect.soft(bIds.filter((x) => aDeps.some((y) => y.id === x)), 'none of the founding company\'s departments').toEqual([]);
    expect.soft(bIds.length, 'and some of its own').toBeGreaterThan(0);
    // The real preflights from the new app's address (LESSONS NH-187): POST with idempotency-key, and PATCH.
    const origins = [...new Set([new URL(env('E2E_BASE_URL') || 'http://127.0.0.1:4300').origin, 'http://localhost:4300'])];
    for (const origin of origins) {
      for (const [method, path, headers] of [['POST', '/v1/admin/company/departments', 'authorization,content-type,idempotency-key'], ['PATCH', `/v1/admin/company/departments/${WALK_DEPARTMENT.id}`, 'authorization,content-type']] as const) {
        const pre = await page.request.fetch(`${api}${path}`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': method, 'Access-Control-Request-Headers': headers } });
        expect.soft(pre.status(), `the ${method} preflight from ${origin} passes`).toBeLessThan(300);
        const h = pre.headers();
        expect.soft(h['access-control-allow-origin'], `it lets ${origin} in`).toBe(origin);
        expect.soft((h['access-control-allow-methods'] ?? '').toUpperCase(), `it allows ${method}`).toContain(method);
        for (const x of headers.split(',')) expect.soft((h['access-control-allow-headers'] ?? '').toLowerCase(), `with ${x}`).toContain(x);
      }
    }
  });

  // ---------------------------------------------------------------- AC-2

  test('AC-2 An Admin adds a department: 201, the version goes up, one audit row', async ({}, testInfo) => {
    once(testInfo.project.name);
    for (const who of WRITERS) {
      const t = tables();
      const r = add(who, { name: '  Night   Shift ' }, { tables: t });
      const b = bodyOf(r);
      expect.soft(statusOf(r), `${who.name}: 201 (${describe(r)})`).toBe(201);
      expect.soft(Object.keys(b ?? {}).sort(), `${who.name}: { version, department }`).toEqual(['department', 'version']);
      expect.soft(b?.version, `${who.name}: version 8`).toBe(VERSION.A + 1);
      expect.soft(String(b?.department?.id ?? ''), `${who.name}: a new id, dep_<ulid>`).toMatch(DEP_ID);
      expect.soft(LIST_A.map((d) => d.id), `${who.name}: the id is new`).not.toContain(b?.department?.id);
      expect.soft([b?.department?.name, b?.department?.status], `${who.name}: the name trimmed, inner spaces joined, ACTIVE`).toEqual(['Night Shift', 'ACTIVE']);
      fits(ROUTE.add, who.name, r);
      const made: Dep = { id: b?.department?.id ?? 'none', name: 'Night Shift', status: 'ACTIVE' };
      written(who.name, t, r, A, who, { version: VERSION.A + 1, deps: [...LIST_A, made], audits: [{ action: 'ADD', department_id: made.id }] });
      ownKeysOnly(who.name, r, A);
      // Readers see it at once.
      const after = list(WHO.hrA, undefined, { tables: r.tables });
      expect.soft(bodyOf(after)?.departments?.map((d: Dep) => d.name), `${who.name}: HR reads it in its place`).toEqual(['aviation', 'Engineering', 'Finance', 'Fleet', 'Night Shift', 'Operations', 'People']);
    }
    // A company with no list gets its first row, version 1.
    const t = tables();
    const first = add(WHO.adminC, { name: 'Dispatch' }, { tables: t });
    expect.soft([statusOf(first), bodyOf(first)?.version, bodyOf(first)?.department?.name], `C's Admin adds the first one: 201, version 1 (${describe(first)})`).toEqual([201, 1, 'Dispatch']);
    written('C\'s first', t, first, C, WHO.adminC, { version: 1, deps: [{ id: bodyOf(first)?.department?.id ?? 'none', name: 'Dispatch', status: 'ACTIVE' }], audits: [{ action: 'ADD', department_id: bodyOf(first)?.department?.id ?? 'none' }] });
    // Names are per company: B's name is free for A; 80 characters is the limit after joining spaces.
    for (const name of ['Bontle Dispatch', 'x'.repeat(80), `${'y'.repeat(40)}      ${'z'.repeat(39)}`]) {
      const r = add(WHO.adminA, { name });
      expect.soft([statusOf(r), bodyOf(r)?.department?.name], `A's Admin adds "${name.slice(0, 20)}…" (${name.length} characters as typed): 201`).toEqual([201, name.trim().replace(/\s+/g, ' ')]);
    }
    // Fields the route does not take are ignored (mass assignment).
    const t2 = tables();
    const extra = add(WHO.adminA, { name: 'Yard', status: 'ARCHIVED', id: DEP.engB.id, tenant_id: B, tenantId: B, version: 99, departments: [] }, { tables: t2 });
    expect.soft([statusOf(extra), bodyOf(extra)?.version, bodyOf(extra)?.department?.status], `extra fields: still A's, ACTIVE, version 8 (${describe(extra)})`).toEqual([201, VERSION.A + 1, 'ACTIVE']);
    expect.soft(bodyOf(extra)?.department?.id, 'and the id is a new one, not the body\'s').not.toBe(DEP.engB.id);
    expect.soft(listOf(extra.tables, B), 'B\'s list is as it was').toEqual(listOf(t2, B));
  });

  test('AC-2 Bad names, a duplicate, the 201st and a missing key are refused, and nothing is written', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = tables();
    const cases: [string, unknown, unknown][] = [
      ['an empty name', { name: '' }, bad('INVALID_FIELD', 'name')],
      ['a name of spaces', { name: '   \t ' }, bad('INVALID_FIELD', 'name')],
      ['no name', {}, bad('INVALID_FIELD', 'name')],
      ['a name that is a number', { name: 42 }, bad('INVALID_FIELD', 'name')],
      ['a name that is null', { name: null }, bad('INVALID_FIELD', 'name')],
      ['a name that is a list', { name: ['Fleet'] }, bad('INVALID_FIELD', 'name')],
      ['an 81-character name', { name: 'a'.repeat(81) }, bad('INVALID_FIELD', 'name')],
      ['81 characters after joining spaces', { name: `${'b'.repeat(40)}  ${'c'.repeat(40)}` }, bad('INVALID_FIELD', 'name')],
      ['the same name', { name: 'Fleet' }, conflict('DUPLICATE_NAME')],
      ['the same name in other letters', { name: 'fLEET' }, conflict('DUPLICATE_NAME')],
      ['the same name with spaces', { name: '  Fleet  ' }, conflict('DUPLICATE_NAME')],
      ['an archived name', { name: 'Old Stores' }, conflict('DUPLICATE_NAME')],
      ['an archived name in other letters and spaces', { name: ' old   STORES ' }, conflict('DUPLICATE_NAME')],
      ['the lower-case one in capitals', { name: 'AVIATION' }, conflict('DUPLICATE_NAME')],
    ];
    for (const [what, body, want] of cases) {
      const r = add(WHO.adminA, body, { tables: t });
      expect.soft(answer(r), `${what}: refused (${describe(r)})`).toEqual([(want as any).error === 'Conflict' ? 409 : 400, want]);
      unchanged(what, t, r);
      fits(ROUTE.add, what, r);
    }
    for (const [what, raw] of [['a body that is not JSON', '{"name": '], ['a body that is a list', '["Fleet"]'], ['a body that is text', '"Fleet"']] as const) {
      const r = ask(ROUTE.add, WHO.adminA, { rawBody: raw, headers: { 'Idempotency-Key': newKey() } }, { tables: t });
      expect.soft(statusOf(r), `${what}: 400 (${describe(r)})`).toBe(400);
      unchanged(what, t, r);
    }
    for (const [what, headers] of [['no Idempotency-Key', {}], ['an empty Idempotency-Key', { 'Idempotency-Key': '' }], ['a blank Idempotency-Key', { 'idempotency-key': '   ' }]] as const) {
      const r = add(WHO.adminA, { name: 'Night Shift' }, { tables: t }, headers);
      expect.soft(answer(r), `${what}: 400 IDEMPOTENCY_KEY_REQUIRED (${describe(r)})`).toEqual([400, bad('IDEMPOTENCY_KEY_REQUIRED')]);
      unchanged(what, t, r);
      fits(ROUTE.add, what, r);
    }
    // At most 200 per company, archived ones counted (D-REC-14.4).
    const full = fullWorld(200, 150);
    const over = add(WHO.adminA, { name: 'One more' }, { tables: full });
    expect.soft(answer(over), `the 201st (150 of the 200 archived): 409 TOO_MANY_DEPARTMENTS (${describe(over)})`).toEqual([409, conflict('TOO_MANY_DEPARTMENTS')]);
    unchanged('the 201st', full, over);
    fits(ROUTE.add, 'the 201st', over);
    const almost = fullWorld(199, 150);
    const last = add(WHO.adminA, { name: 'One more' }, { tables: almost });
    expect.soft([statusOf(last), bodyOf(last)?.version], `the 200th: 201, version 41 (${describe(last)})`).toEqual([201, 41]);
  });

  test('AC-2 Rename, archive and restore with the current version; a stale one is 409 and writes nothing', async ({}, testInfo) => {
    once(testInfo.project.name);
    let t = tables();
    const fleet = DEP.fleetA;
    // Rename.
    const r1 = change(WHO.adminA, fleet.id, { name: ' Fleet   Services ', expected_version: 7 }, { tables: t });
    expect.soft(answer(r1), `rename: 200 { version: 8, department } (${describe(r1)})`).toEqual([200, { version: 8, department: { id: fleet.id, name: 'Fleet Services', status: 'ACTIVE' } }]);
    fits(ROUTE.change, 'rename', r1);
    const renamed = LIST_A.map((d) => (d.id === fleet.id ? { ...d, name: 'Fleet Services' } : d));
    written('rename', t, r1, A, WHO.adminA, { version: 8, deps: renamed, audits: [{ action: 'RENAME', department_id: fleet.id, from: 'Fleet', to: 'Fleet Services' }] });
    ownKeysOnly('rename', r1, A);
    consistent('rename', r1);
    t = r1.tables;
    // Archive: gone from the readers' list, still there for an Admin who asks.
    const r2 = change(WHO.adminA, fleet.id, { status: 'ARCHIVED', expected_version: 8 }, { tables: t });
    expect.soft(answer(r2), `archive: 200 { version: 9, department ARCHIVED } (${describe(r2)})`).toEqual([200, { version: 9, department: { id: fleet.id, name: 'Fleet Services', status: 'ARCHIVED' } }]);
    const archived = renamed.map((d) => (d.id === fleet.id ? { ...d, status: 'ARCHIVED' as const } : d));
    written('archive', t, r2, A, WHO.adminA, { version: 9, deps: archived, audits: [{ action: 'ARCHIVE', department_id: fleet.id }] });
    expect.soft(bodyOf(list(WHO.hrA, undefined, { tables: r2.tables }))?.departments?.map((d: Dep) => d.id), 'HR no longer gets it').not.toContain(fleet.id);
    expect.soft(bodyOf(list(WHO.adminA, { include: 'archived' }, { tables: r2.tables }))?.departments?.find((d: Dep) => d.id === fleet.id), 'an Admin who asks still sees it, archived').toEqual({ id: fleet.id, name: 'Fleet Services', status: 'ARCHIVED' });
    // An archived one keeps its name: a new one cannot take it.
    expect.soft(answer(add(WHO.adminA, { name: 'fleet services' }, { tables: r2.tables })), 'adding its name again: 409 DUPLICATE_NAME').toEqual([409, conflict('DUPLICATE_NAME')]);
    t = r2.tables;
    // Restore.
    const r3 = change(WHO.adminA, fleet.id, { status: 'ACTIVE', expected_version: 9 }, { tables: t });
    expect.soft(answer(r3), `restore: 200 { version: 10, department ACTIVE } (${describe(r3)})`).toEqual([200, { version: 10, department: { id: fleet.id, name: 'Fleet Services', status: 'ACTIVE' } }]);
    written('restore', t, r3, A, WHO.adminA, { version: 10, deps: renamed, audits: [{ action: 'RESTORE', department_id: fleet.id }] });
    // An archived one can be renamed; renaming and archiving at once is one version, two audit rows.
    const t4 = tables();
    const r4 = change(WHO.adminA, DEP.storesA.id, { name: 'Stores', expected_version: 7 }, { tables: t4 });
    expect.soft(answer(r4), 'renaming an archived one: 200, still archived').toEqual([200, { version: 8, department: { id: DEP.storesA.id, name: 'Stores', status: 'ARCHIVED' } }]);
    const r5 = change(WHO.adminA, fleet.id, { name: 'Fleet Two', status: 'ARCHIVED', expected_version: 7 }, { tables: tables() });
    expect.soft(answer(r5), 'rename and archive at once: 200, version 8').toEqual([200, { version: 8, department: { id: fleet.id, name: 'Fleet Two', status: 'ARCHIVED' } }]);
    written('rename and archive', tables(), r5, A, WHO.adminA, { version: 8, deps: LIST_A.map((d) => (d.id === fleet.id ? { ...d, name: 'Fleet Two', status: 'ARCHIVED' as const } : d)), audits: [{ action: 'RENAME', department_id: fleet.id, from: 'Fleet', to: 'Fleet Two' }, { action: 'ARCHIVE', department_id: fleet.id }] });
    // Its own name in other letters is not a duplicate.
    const r6 = change(WHO.adminA, fleet.id, { name: 'FLEET', expected_version: 7 }, { tables: tables() });
    expect.soft(answer(r6), 'renaming Fleet to FLEET: 200 (it is the same department)').toEqual([200, { version: 8, department: { id: fleet.id, name: 'FLEET', status: 'ACTIVE' } }]);
    // Every Admin form may change; fields the route does not take are ignored.
    for (const who of WRITERS) {
      const r = change(who, fleet.id, { name: 'Fleet Three', expected_version: 7, id: DEP.engA.id, tenant_id: B, version: 99, department_id: DEP.engA.id }, { tables: tables() });
      expect.soft(answer(r), `${who.name}: renames Fleet only (${describe(r)})`).toEqual([200, { version: 8, department: { id: fleet.id, name: 'Fleet Three', status: 'ACTIVE' } }]);
      expect.soft(listOf(r.tables, A)?.['departments']?.find((d: Dep) => d.id === DEP.engA.id)?.name, `${who.name}: Engineering is untouched`).toBe('Engineering');
    }
    // Stale, missing or wrong versions, bad fields and duplicates: refused, nothing written.
    const base = tables();
    const refusals: [string, unknown, number, unknown][] = [
      ['an older version', { name: 'X ray', expected_version: 6 }, 409, conflict('STALE_VERSION')],
      ['a newer version', { name: 'X ray', expected_version: 8 }, 409, conflict('STALE_VERSION')],
      ['version 0', { status: 'ARCHIVED', expected_version: 0 }, 409, conflict('STALE_VERSION')],
      ['no expected_version', { name: 'X ray' }, 400, bad('INVALID_FIELD', 'expected_version')],
      ['expected_version as text', { name: 'X ray', expected_version: '7' }, 400, bad('INVALID_FIELD', 'expected_version')],
      ['expected_version 7.5', { name: 'X ray', expected_version: 7.5 }, 400, bad('INVALID_FIELD', 'expected_version')],
      ['a blank name', { name: '  ', expected_version: 7 }, 400, bad('INVALID_FIELD', 'name')],
      ['an 81-character name', { name: 'q'.repeat(81), expected_version: 7 }, 400, bad('INVALID_FIELD', 'name')],
      ['a name that is a number', { name: 7, expected_version: 7 }, 400, bad('INVALID_FIELD', 'name')],
      ['status DELETED', { status: 'DELETED', expected_version: 7 }, 400, bad('INVALID_FIELD', 'status')],
      ['status in lower case', { status: 'archived', expected_version: 7 }, 400, bad('INVALID_FIELD', 'status')],
      ['another department\'s name', { name: 'finance', expected_version: 7 }, 409, conflict('DUPLICATE_NAME')],
      ['an archived department\'s name', { name: 'Old Stores', expected_version: 7 }, 409, conflict('DUPLICATE_NAME')],
    ];
    for (const [what, body, code, want] of refusals) {
      const r = change(WHO.adminA, fleet.id, body, { tables: base });
      expect.soft(answer(r), `${what}: ${code} (${describe(r)})`).toEqual([code, want]);
      unchanged(what, base, r);
      fits(ROUTE.change, what, r);
    }
    const notJson = ask(ROUTE.change, WHO.adminA, { id: fleet.id, rawBody: '{"name":' }, { tables: base });
    expect.soft(statusOf(notJson), 'a body that is not JSON: 400').toBe(400);
    unchanged('a body that is not JSON', base, notJson);
  });

  test('AC-2 A change that changes nothing writes nothing and answers 200', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = tables();
    for (const [what, depId, body, dep] of [
      ['the same name', DEP.fleetA.id, { name: 'Fleet', expected_version: 7 }, DEP.fleetA],
      ['the same name with spaces around it', DEP.fleetA.id, { name: '  Fleet ', expected_version: 7 }, DEP.fleetA],
      ['ACTIVE on an active one', DEP.fleetA.id, { status: 'ACTIVE', expected_version: 7 }, DEP.fleetA],
      ['ARCHIVED on an archived one', DEP.storesA.id, { status: 'ARCHIVED', expected_version: 7 }, DEP.storesA],
      ['the same name and status', DEP.storesA.id, { name: 'Old Stores', status: 'ARCHIVED', expected_version: 7 }, DEP.storesA],
    ] as const) {
      const r = change(WHO.adminA, depId, body, { tables: t });
      expect.soft(answer(r), `${what}: 200 with the stored department and version (${describe(r)})`).toEqual([200, { version: 7, department: { ...dep } }]);
      unchanged(what, t, r);
      expect.soft(writesOf(r), `${what}: no write call at all`).toEqual([]);
      fits(ROUTE.change, what, r);
    }
  });

  test('AC-2 Another company\'s id, or a made-up one, is 404 and changes nothing', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = tables();
    const cases: [string, Caller, string, unknown][] = [
      ['A\'s Admin on B\'s Engineering', WHO.adminA, DEP.engB.id, { name: 'Taken over', expected_version: VERSION.B }],
      ['A\'s Admin on B\'s Engineering, with A\'s version', WHO.adminA, DEP.engB.id, { status: 'ARCHIVED', expected_version: VERSION.A }],
      ['A\'s Admin on B\'s archived one', WHO.adminA, DEP.yardB.id, { status: 'ACTIVE', expected_version: VERSION.B }],
      ['B\'s Admin on A\'s Fleet', WHO.adminB, DEP.fleetA.id, { name: 'Taken over', expected_version: VERSION.A }],
      ['B\'s Admin on A\'s Fleet, with B\'s version', WHO.adminB, DEP.fleetA.id, { status: 'ARCHIVED', expected_version: VERSION.B }],
      ['C\'s Admin (no list) on A\'s Fleet', WHO.adminC, DEP.fleetA.id, { name: 'Taken over', expected_version: 0 }],
      ['C\'s Admin on A\'s Fleet with version 7', WHO.adminC, DEP.fleetA.id, { name: 'Taken over', expected_version: 7 }],
      ['A\'s Admin on a made-up id', WHO.adminA, 'dep_01REC14ZZZZZZZZZZZZZZZZZZZ', { name: 'Taken over', expected_version: VERSION.A }],
      ['A\'s Admin on an id that is not an id', WHO.adminA, '../PROFILE', { name: 'Taken over', expected_version: VERSION.A }],
      ['A\'s Admin on B\'s id with B named in the body', WHO.adminA, DEP.engB.id, { name: 'Taken over', expected_version: VERSION.B, tenant_id: B }],
    ];
    for (const [what, who, depId, body] of cases) {
      const r = change(who, depId, body, { tables: t });
      expect.soft(answer(r), `${what}: 404 (${describe(r)})`).toEqual([404, NOT_FOUND]);
      unchanged(what, t, r);
      fits(ROUTE.change, what, r);
      ownKeysOnly(what, r, who.company === 'B' ? B : who.company === 'C' ? C : A);
    }
    // B's Admin naming A in the body of a POST adds to B only.
    const viaBody = add(WHO.adminB, { name: 'From B', tenant_id: A, tenantId: A }, { tables: t }, { 'Idempotency-Key': newKey(), 'x-tenant-id': A });
    expect.soft(statusOf(viaBody), `B's Admin naming A in the body and a header: 201 (${describe(viaBody)})`).toBe(201);
    expect.soft(listOf(viaBody.tables, A), 'A\'s list is as it was').toEqual(listOf(t, A));
    expect.soft((listOf(viaBody.tables, B)?.['departments'] ?? []).map((d: Dep) => d.name), 'the new one is B\'s').toContain('From B');
  });

  test('AC-2 HR staff, Recruiters and everyone else get 403 on every write, before anything is read', async ({}, testInfo) => {
    once(testInfo.project.name);
    for (const who of [...NOT_WRITERS, WHO.hrB, WHO.hrC]) {
      const p = add(who, { name: 'Night Shift' });
      expect.soft(answer(p), `${who.name}, POST: 403 (${describe(p)})`).toEqual([403, FORBIDDEN]);
      noAws(`${who.name}, POST`, p);
      fits(ROUTE.add, `${who.name}, POST`, p);
      const c = change(who, DEP.fleetA.id, { name: 'Night Shift', expected_version: VERSION.A });
      expect.soft(answer(c), `${who.name}, PATCH: 403 (${describe(c)})`).toEqual([403, FORBIDDEN]);
      noAws(`${who.name}, PATCH`, c);
      fits(ROUTE.change, `${who.name}, PATCH`, c);
    }
    for (const who of [WHO.adminNoCompany, WHO.adminBadCompany]) {
      for (const r of [add(who, { name: 'Night Shift' }), change(who, DEP.fleetA.id, { name: 'Night Shift', expected_version: VERSION.A })]) {
        expect.soft(answer(r), `${who.name}: 403 (${describe(r)})`).toEqual([403, FORBIDDEN]);
        noAws(who.name, r);
      }
    }
  });

  test('AC-2 The same Idempotency-Key gives the first answer and writes nothing; another company\'s key is its own', async ({}, testInfo) => {
    once(testInfo.project.name);
    const key = newKey();
    const t0 = tables();
    const first = add(WHO.adminA, { name: 'Night Shift' }, { tables: t0 }, { 'Idempotency-Key': key });
    expect(statusOf(first), `the first POST: 201 (${describe(first)})`).toBe(201);
    const keyRows = rowsOf(first.tables, TENANTS).filter((r) => !rowsOf(t0, TENANTS).some((x) => x['pk'] === r['pk'] && x['sk'] === r['sk']));
    expect.soft(keyRows.every((r) => r['pk'] === `TENANT#${A}` && (r['sk'] === 'DEPARTMENTS' || String(r['sk']).startsWith('DEPARTMENTS#'))), 'everything it adds is under A\'s DEPARTMENTS keys (the key too, D-T-9)').toBe(true);
    for (const [what, headers, body] of [
      ['the same key and body', { 'Idempotency-Key': key }, { name: 'Night Shift' }],
      ['the same key in lower case header', { 'idempotency-key': key }, { name: 'Night Shift' }],
    ] as const) {
      const again = add(WHO.adminA, body, { tables: first.tables }, headers);
      expect.soft(answer(again), `${what}: the first answer`).toEqual(answer(first));
      unchanged(what, first.tables, again);
    }
    // Still the first answer after someone else changed the list.
    const moved = change(WHO.adminA, DEP.engA.id, { name: 'Engineering and Data', expected_version: VERSION.A + 1 }, { tables: first.tables });
    expect(statusOf(moved), `another change in between (${describe(moved)})`).toBe(200);
    const later = add(WHO.adminA, { name: 'Night Shift' }, { tables: moved.tables }, { 'Idempotency-Key': key });
    expect.soft(answer(later), 'after another change: still the first answer').toEqual(answer(first));
    unchanged('after another change', moved.tables, later);
    // B's Admin with the same key: B's own department, and nothing of A's.
    const b = add(WHO.adminB, { name: 'Night Shift' }, { tables: first.tables }, { 'Idempotency-Key': key });
    expect.soft([statusOf(b), bodyOf(b)?.version], `B's Admin with A's key: B's own 201, B's version 3 (${describe(b)})`).toEqual([201, VERSION.B + 1]);
    expect.soft(bodyOf(b)?.department?.id, 'with an id of its own, not A\'s').not.toBe(bodyOf(first)?.department?.id);
    expect.soft(listOf(b.tables, A), 'A\'s list is as it was').toEqual(listOf(first.tables, A));
    // A different key adds again only if the name is free.
    expect.soft(answer(add(WHO.adminA, { name: 'Night Shift' }, { tables: first.tables })), 'a new key, the same name: 409 DUPLICATE_NAME').toEqual([409, conflict('DUPLICATE_NAME')]);
  });

  test('AC-2 A version clash on a POST is read again and tried once more; a second clash is 409', async ({}, testInfo) => {
    once(testInfo.project.name);
    const clash1: Dep = { id: 'dep_01REC14CRASH00000000000001', name: 'Clash One', status: 'ACTIVE' };
    const clash2: Dep = { id: 'dep_01REC14CRASH00000000000002', name: 'Clash Two', status: 'ACTIVE' };
    const t = tables();
    const once1 = add(WHO.adminA, { name: 'Night Shift' }, { tables: t, clash: { times: 1, add: [clash1] } });
    expect.soft([statusOf(once1), bodyOf(once1)?.version], `one clash: 201, version 9 (7, the other save, then this one) (${describe(once1)})`).toEqual([201, VERSION.A + 2]);
    const names = ((listOf(once1.tables, A)?.['departments'] ?? []) as Dep[]).map((d) => d.name);
    expect.soft(names, 'the other Admin\'s department is kept (the list was read again, not written over)').toContain('Clash One');
    expect.soft(names, 'and the new one is there').toContain('Night Shift');
    expect.soft(writesOf(once1).filter((c: any) => c.op === 'TransactWriteItems').length, 'two tries').toBe(2);
    expect.soft(auditsOf(once1.tables, A).filter((a) => a['action'] === 'ADD').length, 'one ADD audit row').toBe(1);
    fits(ROUTE.add, 'one clash', once1);
    // Two clashes: no third try.
    const twice = add(WHO.adminA, { name: 'Night Shift' }, { tables: t, clash: { times: 2, add: [clash1, clash2] } });
    expect.soft(answer(twice), `two clashes: 409 STALE_VERSION (${describe(twice)})`).toEqual([409, conflict('STALE_VERSION')]);
    expect.soft(writesOf(twice).filter((c: any) => c.op === 'TransactWriteItems').length, 'exactly two tries').toBe(2);
    const after = ((listOf(twice.tables, A)?.['departments'] ?? []) as Dep[]).map((d) => d.name);
    expect.soft(after.includes('Night Shift'), 'the new name is not written').toBe(false);
    expect.soft(auditsOf(twice.tables, A).length, 'no audit row').toBe(0);
    fits(ROUTE.add, 'two clashes', twice);
    // A PATCH does not retry: the person was looking at an older list.
    const p = change(WHO.adminA, DEP.fleetA.id, { name: 'Fleet Services', expected_version: VERSION.A }, { tables: t, clash: { times: 1, add: [clash1] } });
    expect.soft(answer(p), `a PATCH that clashes: 409 STALE_VERSION (${describe(p)})`).toEqual([409, conflict('STALE_VERSION')]);
    expect.soft(((listOf(p.tables, A)?.['departments'] ?? []) as Dep[]).find((d) => d.id === DEP.fleetA.id)?.name, 'Fleet keeps its name').toBe('Fleet');
  });

  test('AC-2 A failing write is 500 with no detail, and nothing is half-written', async ({}, testInfo) => {
    once(testInfo.project.name);
    const secret = `Night Shift ${A} ProvisionedThroughputExceeded on naleko-people-dev-tenants`;
    const t = tables();
    for (const [what, r] of [
      ['POST', add(WHO.adminA, { name: 'Night Shift' }, { tables: t, fail: { service: 'dynamodb', ops: ['TransactWriteItems', 'PutItem', 'UpdateItem'], message: secret, name: 'ProvisionedThroughputExceededException' } })],
      ['PATCH', change(WHO.adminA, DEP.fleetA.id, { name: 'Night Shift', expected_version: 7 }, { tables: t, fail: { service: 'dynamodb', ops: ['TransactWriteItems', 'PutItem', 'UpdateItem'], message: secret, name: 'ProvisionedThroughputExceededException' } })],
      ['POST, failing read', add(WHO.adminA, { name: 'Night Shift' }, { tables: t, fail: { service: 'dynamodb', ops: ['GetItem'], message: secret, name: 'InternalServerError' } })],
    ] as const) {
      expect.soft(answer(r), `${what}: 500 with the fixed words (${describe(r)})`).toEqual([500, SOMETHING]);
      unchanged(what, t, r);
      const logs = logsOf(r);
      expect.soft(/ProvisionedThroughputExceededException|InternalServerError/.test(logs), `${what}: the log names the error`).toBe(true);
      for (const bit of ['Night Shift', A, 'naleko-people-dev-tenants']) expect.soft(logs.includes(bit), `${what}: the log does not carry the message or the name (${bit})`).toBe(false);
      fits(what.startsWith('PATCH') ? ROUTE.change : ROUTE.add, what, r);
    }
  });

  // ---------------------------------------------------------------- AC-3

  test('AC-3 The code builds only its own keys: sk DEPARTMENTS and DEPARTMENTS#…, and no other table', async ({}, testInfo) => {
    once(testInfo.project.name);
    expect(handlerExists(), 'lambda/manageDepartments/index.mjs exists').toBe(true);
    expect(existsSync(SHARED), 'lambda/shared/departments.mjs exists (rule 7)').toBe(true);
    const files = [...readdirSync(HANDLER_DIR).filter((f) => /\.(m?js|cjs)$/.test(f) && !/\.test\./.test(f)).map((f) => join(HANDLER_DIR, f)), SHARED];
    for (const f of files) {
      const src = stripJs(readFileSync(f, 'utf8'));
      const rel = f.slice(REPO.length + 1);
      for (const [what, re] of [
        ['the Company row', /PROFILE/], ['Member rows', /USER#/], ['module rows', /MODULES/], ['another sort key prefix', /['"`](TENANT#[^'"`$]*#|ROLE#|CONFIG#|INVITE#|PENDING#)/],
        ['Query', /\bQuery(Command)?\b/], ['Scan', /\bScan(Command)?\b/], ['Delete', /\bDelete(Item)?(Command)?\b/], ['a batch', /\bBatch(Write|Get)(Item)?(Command)?\b/], ['an index', /IndexName|tenant-index/],
        ['another table setting', /process\.env\.(?!TENANTS_TABLE\b|AWS_REGION\b)[A-Z_]+/],
      ] as const) {
        expect.soft(re.test(src), `${rel}: names no ${what}`).toBe(false);
      }
      const imports = [...src.matchAll(/(?:import\s[^'"`]*?from\s*|import\s*\(\s*|require\s*\(\s*)['"`]([^'"`]+)['"`]/g)].map((m) => m[1]!);
      const allowed = /^(@aws-sdk\/(client-dynamodb|util-dynamodb|lib-dynamodb)|node:crypto|crypto|\.\.?\/.*)$/;
      expect.soft(imports.filter((m) => !allowed.test(m)), `${rel}: imports only DynamoDB, crypto and its own files`).toEqual([]);
      expect.soft(imports.filter((m) => /modules\.mjs|membership\.mjs|company-rows\.mjs|idempotency\.mjs|config-reader/.test(m)), `${rel}: none of the shared files that touch other rows or tables`).toEqual([]);
    }
    expect.soft(stripJs(read(SHARED)), 'lambda/shared/departments.mjs exports departmentsOf, activeDepartment and normaliseName (rule 7)').toMatch(/export[\s\S]*departmentsOf[\s\S]*/);
    for (const name of ['departmentsOf', 'activeDepartment', 'normaliseName']) expect.soft(new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${name}\\b|export\\s*\\{[^}]*\\b${name}\\b`).test(stripJs(read(SHARED))), `departments.mjs exports ${name}`).toBe(true);
    expect.soft(/departments\.mjs/.test(stripJs(read(handlerFile()))), 'the handler uses the shared reader').toBe(true);
    // At run time, over the routes above: its own company's DEPARTMENTS keys only.
    const t = tables();
    for (const [what, r, c] of [
      ['a read', list(WHO.adminA, { include: 'archived' }, { tables: t }), A],
      ['an add', add(WHO.adminA, { name: 'Night Shift' }, { tables: t }), A],
      ['a first add for C', add(WHO.adminC, { name: 'Dispatch' }, { tables: t }), C],
      ['a rename', change(WHO.adminA, DEP.fleetA.id, { name: 'Fleet Services', expected_version: 7 }, { tables: t }), A],
      ['an archive by B', change(WHO.adminB, DEP.dispatchB.id, { status: 'ARCHIVED', expected_version: 2 }, { tables: t }), B],
      ['a clash and a retry', add(WHO.adminA, { name: 'Night Shift' }, { tables: t, clash: { times: 1, add: [{ id: 'dep_01REC14CRASH00000000000001', name: 'Clash One', status: 'ACTIVE' }] } }), A],
    ] as const) {
      expect.soft([200, 201].includes(statusOf(r) ?? 0), `${what} works (${describe(r)})`).toBe(true);
      ownKeysOnly(what, r, c);
      const added = rowsOf(r.tables, TENANTS).filter((x) => !rowsOf(t, TENANTS).some((y) => y['pk'] === x['pk'] && y['sk'] === x['sk']));
      expect.soft(added.filter((x) => x['tenant_id'] !== c).map((x) => `${x['pk']} ${x['sk']}`), `${what}: every row it adds carries its company`).toEqual([]);
    }
  });

  test('AC-3 Its role: Get, Update and Put on the company list only, for TENANT# keys, and the PII key through DynamoDB only', async ({}, testInfo) => {
    once(testInfo.project.name);
    const { found, fn, role } = theLambda();
    expect(found.map((x) => x.stack), 'one Lambda manageDepartments, in infra/ (the PII key\'s stack, so role and key line land together)').toEqual(['infra']);
    expect(role, 'it runs as its own role (aws_iam_role.<name>.arn)').toBeTruthy();
    const others = resourcesOf('infra', 'aws_lambda_function').filter((b) => roleResourceOf(b) === role).map((b) => b.labels[1]);
    expect.soft(others.length, 'no other Lambda shares its role').toBe(1);
    const pols = Object.entries(policyLines()).filter(([, p]) => p.stack === 'infra' && p.role === role);
    expect(pols.length, 'its role has its own inline policy').toBeGreaterThan(0);
    expect.soft(pols.filter(([, p]) => !p.pairs).map(([k]) => k), 'the policy reads as a document').toEqual([]);
    const pairs = pols.flatMap(([, p]) => p.pairs ?? []);
    const LEADING = /^\{"ForAllValues:StringLike":\{"dynamodb:LeadingKeys":(\["TENANT#\*"\]|"TENANT#\*")\}\}$/;
    const rows = pairs.map((x) => { const [effect, action, resource, ...cond] = x.split(' '); return { effect: effect!, action: action!, resource: resource!, cond: cond.join(' ') }; });
    expect.soft(rows.filter((x) => x.effect !== 'Allow').map((x) => `${x.effect} ${x.action}`), 'only Allow lines (nothing to read around)').toEqual([]);
    const ddb = rows.filter((x) => x.action.startsWith('dynamodb:'));
    expect.soft([...new Set(ddb.map((x) => x.action))].sort(), 'DynamoDB: exactly GetItem, PutItem and UpdateItem (no Query, Scan, DeleteItem, batch or *)').toEqual(['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem']);
    for (const x of ddb) {
      expect.soft(TENANTS_RESOURCE.test(x.resource), `${x.action} is on the company list table itself (no index, no other table, no *): ${x.resource}`).toBe(true);
      expect.soft(LEADING.test(x.cond), `${x.action} is limited to TENANT#* leading keys (Member rows start USER#): ${x.cond}`).toBe(true);
    }
    const rest = rows.filter((x) => !x.action.startsWith('dynamodb:'));
    const okRest = (x: { action: string; resource: string }) =>
      (/^logs:(CreateLogGroup|CreateLogStream|PutLogEvents)$/.test(x.action) && /:log-group:\/aws\/lambda\/manageDepartments(:\*)?$/.test(x.resource))
      || (/^xray:(PutTraceSegments|PutTelemetryRecords)$/.test(x.action) && x.resource === '*');
    expect.soft(rest.filter((x) => !okRest(x)).map((x) => `${x.action} ${x.resource}`), 'apart from that: its own logs and X-Ray only (no KMS, no Cognito, no other service)').toEqual([]);
    const attach = resourcesOf('infra', 'aws_iam_role_policy_attachment').filter((b) => (attributes(b.body).get('role') ?? '').includes(`aws_iam_role.${role}.`));
    expect.soft(attach.map((b) => b.labels[1]), 'no managed policy is attached to its role').toEqual([]);
    const roleBlock = resourcesOf('infra', 'aws_iam_role').find((b) => b.labels[1] === role);
    expect.soft(/managed_policy_arns|inline_policy/.test(stripComments(roleBlock?.body ?? '')), 'and none is given inside the role').toBe(false);
    // The PII key (D-T-15).
    const line = `aws_iam_role.${role}.arn`;
    const readList = kmsList('dynamodb_read_role_arns');
    expect.soft(readList.split(line).length - 1, 'its role is on the PII key\'s DynamoDB read list once (decrypt through DynamoDB only)').toBe(1);
    expect.soft(kmsList('allowed_role_arns').includes(line), 'and not on the encrypt list').toBe(false);
    expect.soft(/manageDepartments|manage_departments/.test(kmsList('allowed_role_arns')), 'not by name either').toBe(false);
    // Settings: the company list's name, nothing else that names a table.
    const s = settingsOf(fn!.block);
    expect.soft(sq(s.get('TENANTS_TABLE') ?? ''), 'TENANTS_TABLE is the company list table').toBe('aws_dynamodb_table.tenants.name');
    expect.soft([...s.keys()].filter((k) => /TABLE/.test(k) && k !== 'TENANTS_TABLE'), 'no other table setting').toEqual([]);
  });

  test('AC-3 The Lambda, its three routes, its log group and alarms are in infra/', async ({}, testInfo) => {
    once(testInfo.project.name);
    const { fn } = theLambda();
    expect(fn, 'the Lambda is in infra/').toBeTruthy();
    const a = attributes(fn!.block.body);
    expect.soft(sq(a.get('runtime') ?? ''), 'nodejs22.x').toBe('"nodejs22.x"');
    expect.soft(sq(a.get('handler') ?? ''), 'index.handler').toBe('"index.handler"');
    expect.soft(/tracing_config\s*\{\s*mode\s*=\s*"Active"/.test(stripComments(fn!.block.body)), 'X-Ray tracing on').toBe(true);
    const integ = resourcesOf('infra', 'aws_apigatewayv2_integration').filter((b) => sq(attributes(b.body).get('integration_uri') ?? '') === `aws_lambda_function.${fn!.block.labels[1]}.invoke_arn`);
    expect(integ.length, 'one integration to it').toBe(1);
    expect.soft(sq(attributes(integ[0]!.body).get('api_id') ?? ''), 'on the employees API').toBe('aws_apigatewayv2_api.employees_api.id');
    const routes = resourcesOf('infra', 'aws_apigatewayv2_route').filter((b) => sq(attributes(b.body).get('target') ?? '').includes(`aws_apigatewayv2_integration.${integ[0]!.labels[1]}.id`));
    expect.soft(routes.map((b) => sq(attributes(b.body).get('route_key') ?? '').replace(/"/g, '')).sort(), 'exactly the three routes').toEqual(Object.values(ROUTE).map(sq).sort());
    for (const r of routes) {
      const ra = attributes(r.body);
      expect.soft([sq(ra.get('api_id') ?? ''), sq(ra.get('authorization_type') ?? ''), sq(ra.get('authorizer_id') ?? '')], `${ra.get('route_key')}: a JWT route of the employees API`).toEqual(['aws_apigatewayv2_api.employees_api.id', '"JWT"', 'aws_apigatewayv2_authorizer.employees_api_cognito.id']);
    }
    const perm = resourcesOf('infra', 'aws_lambda_permission').filter((b) => sq(attributes(b.body).get('function_name') ?? '').includes(`aws_lambda_function.${fn!.block.labels[1]}.`));
    expect.soft(perm.map((b) => sq(attributes(b.body).get('source_arn') ?? '')), 'the employees API may call it').toEqual(['"${aws_apigatewayv2_api.employees_api.execution_arn}/*/*"']);
    // The browser can send the writes (LESSONS NH-187).
    const api = blocks(filesOf('infra'), 'resource').find((b) => b.labels[0] === 'aws_apigatewayv2_api' && b.labels[1] === 'employees_api');
    const cors = sq(stripComments(api?.body ?? ''));
    for (const m of ['GET', 'POST', 'PATCH', 'OPTIONS']) expect.soft(cors, `the employees API's CORS allows ${m}`).toMatch(new RegExp(`allow_methods=\\[[^\\]]*"${m}"`));
    for (const h of ['authorization', 'content-type', 'idempotency-key']) expect.soft(cors, `and the ${h} header`).toMatch(new RegExp(`allow_headers=\\[[^\\]]*"${h}"`));
    expect.soft(sq(tfText('cloudwatch.tf')), 'its log group is in the 30-day list').toContain('"/aws/lambda/manageDepartments"');
    for (const f of ['alarms.tf', 'dashboards.tf']) expect.soft(sq(tfText(f)), `${f} lists it`).toContain('"manageDepartments"');
    expect.soft(existsSync(join(HANDLER_DIR, 'package.json')), 'its folder has a package.json (as the other Lambdas)').toBe(true);
    // No table data in Terraform (LESSONS 16 Nov).
    expect.soft(/aws_dynamodb_table_item/.test(filesOf('infra').map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n')), 'no aws_dynamodb_table_item: the lists come from the seed').toBe(false);
  });

  // ---------------------------------------------------------------- AC-4

  test('AC-4 The seed gives a company with no list the four starting names, once; a company with a list keeps it', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(3 * 60_000);
    expect(existsSync(SEED), 'scripts/tenancy/company-seeds/departments.mjs exists').toBe(true);
    const world0 = (): Tables => ({ [TENANTS]: tables()[TENANTS]!, [TENANTS_PROD]: companyRows() });
    const run = (args: string[], t: Tables = world0(), sts: Sts = DEV_STS) => runScript(SEED, args, { tables: t, sts });
    const out = (r: { stdout: string; stderr: string }) => r.stdout + r.stderr;
    const clean = (what: string, r: { stdout: string; stderr: string }) => {
      expect.soft(out(r), `${what}: the output has no address`).not.toMatch(/@/);
      for (const n of Object.values({ a: 'Mokoena Bakeries', b: 'Bontle Logistics', c: 'Cele Couriers' })) expect.soft(out(r), `${what}: and no company name`).not.toContain(n);
    };
    // Dry run: the plan, nothing written.
    const dry = run(['--env', 'dev', '--tenant', C]);
    expect(dry.code, `the dry run exits 0 (${out(dry).slice(-300)})`).toBe(0);
    expect.soft(dry.writes, 'the dry run writes nothing').toEqual([]);
    for (const n of STARTING) expect.soft(out(dry), `the plan names ${n}`).toContain(n);
    clean('the dry run', dry);
    // Apply: version 1 with the four names, active.
    const t0 = world0();
    const applied = run(['--env', 'dev', '--tenant', C, '--apply'], t0);
    expect(applied.code, `--apply exits 0 (${out(applied).slice(-300)})`).toBe(0);
    const row = listOf(applied.tables, C);
    expect.soft(row?.['version'], 'C\'s list is version 1').toBe(1);
    expect.soft(row?.['tenant_id'], 'and carries its company').toBe(C);
    const deps = (row?.['departments'] ?? []) as Dep[];
    expect.soft(deps.map((d) => d.name).sort(), 'the four starting names (Q-1): Engineering, Finance, Operations, People').toEqual([...STARTING].sort());
    expect.soft(deps.every((d) => d.status === 'ACTIVE' && DEP_ID.test(d.id)), 'all active, each with a dep_<ulid> id').toBe(true);
    expect.soft(new Set(deps.map((d) => d.id)).size, 'four different ids').toBe(4);
    expect.soft(String(row?.['updated_at'] ?? ''), 'updated_at is a time').toMatch(ISO);
    expect.soft(String(row?.['updated_by'] ?? ''), 'updated_by says who wrote it').not.toBe('');
    const added = rowsOf(applied.tables, TENANTS).filter((x) => !rowsOf(t0, TENANTS).some((y) => y['pk'] === x['pk'] && y['sk'] === x['sk']));
    expect.soft(added.filter((x) => !(x['pk'] === `TENANT#${C}` && /^DEPARTMENTS(#|$)/.test(String(x['sk'])))).map((x) => `${x['pk']} ${x['sk']}`), 'it adds only C\'s DEPARTMENTS rows').toEqual([]);
    expect.soft(othersThan(applied.tables, C), 'and changes no other row').toBe(othersThan(t0, C));
    expect.soft(rowsOf(applied.tables, TENANTS_PROD).length, 'and nothing on the prod list').toBe(companyRows().length);
    clean('--apply', applied);
    // The readers get them.
    const r = list(WHO.hrC, undefined, { tables: applied.tables });
    expect.soft(answer(r), 'C\'s HR reads them, sorted, version 1').toEqual([200, { version: 1, departments: deps.map((d) => ({ id: d.id, name: d.name, status: 'ACTIVE' })).sort(byName) }]);
    // A second run changes nothing; a company with a list keeps it.
    const again = run(['--env', 'dev', '--tenant', C, '--apply'], applied.tables);
    expect.soft(again.code, `a second --apply exits 0 (${out(again).slice(-300)})`).toBe(0);
    expect.soft(again.writes, 'and writes nothing').toEqual([]);
    expect.soft(sameTables(again.tables, applied.tables), 'C keeps version 1, the same ids').toBe(true);
    for (const c of [A, B]) {
      const kept = run(['--env', 'dev', '--tenant', c, '--apply']);
      expect.soft(kept.code, `${c.slice(0, 5)}… with a list: exits 0 (${out(kept).slice(-200)})`).toBe(0);
      expect.soft(kept.writes, `${c.slice(0, 5)}… with a list: nothing written (never re-versions)`).toEqual([]);
    }
    // A list whose every department is archived is still a list: the seed never starts it again.
    const archivedWorld = world0();
    archivedWorld[TENANTS]!.push(listRow(C, 5, ARCHIVED_ONLY(C)));
    const archived = run(['--env', 'dev', '--tenant', C, '--apply'], archivedWorld);
    expect.soft(archived.code, `C with every department archived: exits 0 (${out(archived).slice(-200)})`).toBe(0);
    expect.soft(archived.writes, 'C with every department archived: nothing written').toEqual([]);
    expect.soft(listOf(archived.tables, C)?.['version'], 'and C keeps version 5').toBe(5);
    expect.soft(sameTables(archived.tables, archivedWorld), 'and every row is as it was').toBe(true);
    // The seed reads the list with a consistent read (it decides on what it reads).
    const listReads = (applied.calls as any[]).filter((x) => x.service === 'dynamodb' && x.op === 'GetItem' && JSON.stringify(x.input ?? {}).includes('"DEPARTMENTS"'));
    expect.soft(listReads.length, 'the seed reads C\'s list').toBeGreaterThan(0);
    expect.soft(listReads.every((x) => x.input?.ConsistentRead === true), 'every read of the list is a consistent read').toBe(true);
    // Prod writes the prod list only.
    const prod = run(['--env', 'prod', '--tenant', C, '--apply'], world0(), PROD_STS);
    expect.soft(prod.code, `--env prod exits 0 (${out(prod).slice(-200)})`).toBe(0);
    expect.soft(listOf({ [TENANTS]: prod.tables[TENANTS_PROD] ?? [] }, C)?.['version'], 'C gets version 1 on the prod list').toBe(1);
    expect.soft(listOf(prod.tables, C), 'and nothing on the dev list').toBeUndefined();
    // Refusals.
    for (const [what, args] of [
      ['--env staging', ['--env', 'staging', '--tenant', C, '--apply']],
      ['no --env', ['--tenant', C, '--apply']],
      ['a malformed company id', ['--env', 'dev', '--tenant', 'ten_short', '--apply']],
      ['DEFAULT as a company', ['--env', 'dev', '--tenant', 'DEFAULT', '--apply']],
      ['no --tenant', ['--env', 'dev', '--apply']],
      ['a company with no Company row', ['--env', 'dev', '--tenant', 'ten_zzzzzzzzzzzzzzzzzzzzzzzzzz', '--apply']],
    ] as const) {
      const x = run([...args]);
      expect.soft(x.code, `${what}: refused (non-zero exit)`).not.toBe(0);
      expect.soft(x.writes, `${what}: nothing written`).toEqual([]);
    }
  });

  test('AC-4 Switching Onboarding or Recruitment on through the module script gives the company its list, once', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(4 * 60_000);
    const E = 'ten_eeeeeeeeeeeeeeeeeeeeeeeeee';
    const F = 'ten_ffffffffffffffffffffffffff';
    const G = 'ten_gggggggggggggggggggggggggg';
    const H = 'ten_hhhhhhhhhhhhhhhhhhhhhhhhhh';
    const profile = (c: string, modules: string[]) => av({ pk: `TENANT#${c}`, sk: 'PROFILE', tenant_id: c, name: `Company ${c.slice(4, 5)}`, status: 'ACTIVE', country: 'ZA', created_at: '2026-11-16T00:00:00Z', modules: modules.length ? new Set(modules) : [] });
    const world0 = (): Tables => ({
      [TENANTS]: [...tables()[TENANTS]!, profile(E, ['recruitment']), profile(F, []), profile(G, ['onboarding']), listRow(G, 3, [{ id: 'dep_01REC14G000000000000000001', name: 'Kitchen', status: 'ACTIVE' }])],
      'talent-flow-config': [],
    });
    const run = (args: string[], t: Tables = world0()) => runScript(SET_MODULES, ['--reason', 'REC-14 AC-4', ...args], { tables: t, sts: DEV_STS });
    const out = (r: { stdout: string; stderr: string }) => r.stdout + r.stderr;
    const modulesOf = (t: Tables, c: string) => rowsOf(t, TENANTS).find((r) => r['pk'] === `TENANT#${c}` && r['sk'] === 'PROFILE')?.['modules'];
    const names = (t: Tables, c: string) => ((listOf(t, c)?.['departments'] ?? []) as Dep[]).map((d) => d.name).sort();
    for (const [what, c, on] of [['C turns Recruitment on', C, 'recruitment'], ['E turns Onboarding on', E, 'onboarding'], ['F turns both on at once', F, 'onboarding,recruitment']] as const) {
      const r = run(['--env', 'dev', '--tenant', c, '--on', on, '--apply']);
      expect(r.code, `${what}: exits 0 (${out(r).slice(-300)})`).toBe(0);
      expect.soft(listOf(r.tables, c)?.['version'], `${what}: the company's list is version 1`).toBe(1);
      expect.soft(names(r.tables, c), `${what}: the four starting names, once each`).toEqual([...STARTING].sort());
      expect.soft(String(JSON.stringify(modulesOf(r.tables, c))), `${what}: and the module is on`).toContain(on.split(',')[0]!);
      // Seed before flip (D-T-12): the list is written before the Company row's modules are.
      const writes = (r.calls as any[]).map((x, i) => [i, x] as const).filter(([, x]) => x.service === 'dynamodb' && /PutItem|UpdateItem|TransactWriteItems/.test(x.op));
      const inputOf = (x: any) => JSON.stringify(x.input ?? {});
      const listAt = writes.find(([, x]) => inputOf(x).includes('"DEPARTMENTS"'))?.[0] ?? -1;
      const flipAt = writes.find(([, x]) => inputOf(x).includes('"PROFILE"') && inputOf(x).includes('modules'))?.[0] ?? -1;
      expect.soft(listAt >= 0 && flipAt >= 0 && listAt < flipAt, `${what}: the list is written before the module is switched on (list write ${listAt}, switch ${flipAt})`).toBe(true);
    }
    const kept = run(['--env', 'dev', '--tenant', G, '--on', 'recruitment', '--apply']);
    expect.soft(kept.code, `G (a list already) turns Recruitment on: exits 0 (${out(kept).slice(-300)})`).toBe(0);
    expect.soft([listOf(kept.tables, G)?.['version'], names(kept.tables, G)], 'G keeps its own list, version 3').toEqual([3, ['Kitchen']]);
    // H's list exists with every department archived: switching a module on writes the module only, never a new list.
    const hWorld = world0();
    hWorld[TENANTS]!.push(profile(H, []), listRow(H, 5, ARCHIVED_ONLY(H)));
    const hRun = run(['--env', 'dev', '--tenant', H, '--on', 'onboarding,recruitment', '--apply'], hWorld);
    expect.soft(hRun.code, `H (every department archived) turns both on: exits 0 (${out(hRun).slice(-300)})`).toBe(0);
    expect.soft(listOf(hRun.tables, H), 'H keeps its list as it was: version 5, every department archived').toEqual(listOf(hWorld, H));
    expect.soft(rowsOf(hRun.tables, TENANTS).filter((x) => x['pk'] === `TENANT#${H}` && /^DEPARTMENTS#/.test(String(x['sk']))).length, 'and no department change is logged for H').toBe(0);
    expect.soft(((hRun.calls ?? []) as any[]).filter((x) => x.service === 'dynamodb' && /PutItem|UpdateItem|TransactWriteItems/.test(x.op) && JSON.stringify(x.input ?? {}).includes('"DEPARTMENTS')).length, 'no write names H\'s DEPARTMENTS rows').toBe(0);
    expect.soft(String(JSON.stringify(modulesOf(hRun.tables, H))), 'and the modules are on').toContain('recruitment');
    // Turning a module off, or a module already on, does not run it.
    const off = run(['--env', 'dev', '--tenant', C, '--off', 'onboarding', '--on', 'recruitment', '--apply']);
    expect.soft(off.code, `C swaps Onboarding for Recruitment: exits 0 (${out(off).slice(-300)})`).toBe(0);
    // A failing department write: the module stays off, nothing else is written (seed before flip, D-T-12).
    const failing = runScript(SET_MODULES, ['--reason', 'REC-14 AC-4', '--env', 'dev', '--tenant', E, '--on', 'onboarding', '--apply'], { tables: world0(), sts: DEV_STS, fail: { service: 'dynamodb', ops: ['PutItem', 'UpdateItem', 'TransactWriteItems'], message: 'InternalServerError: DynamoDB is unavailable', nth: 1 } });
    expect.soft(failing.code, 'a failing department write: the script exits non-zero').not.toBe(0);
    expect.soft(modulesOf(failing.tables, E), 'and E keeps Recruitment only').toEqual(['recruitment']);
    expect.soft(listOf(failing.tables, E), 'and has no list').toBeUndefined();
    // The registry names the seed for both modules (rule 8).
    const reg = ['index.mjs', 'onboarding.mjs', 'recruitment.mjs'].map((f) => stripJs(read(join(REPO, 'scripts', 'tenancy', 'module-seeds', f)))).join('\n');
    expect.soft(/company-seeds\/departments/.test(reg), 'the module seed registry calls company-seeds/departments.mjs').toBe(true);
  });

  test('AC-4 seed-dev.py gives the dev companies their lists, the walk department included, and a second run changes nothing', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(3 * 60_000);
    const src = read(SEED_DEV);
    const main = /def main\(\)[\s\S]*$/.exec(src)?.[0] ?? '';
    expect.soft(/\bseed_departments\(\s*ddb\b/.test(main), 'main() calls seed_departments(ddb)').toBe(true);
    expect.soft(/company-seeds\/departments/.test(src), 'seed-dev.py runs the same seed (company-seeds/departments)').toBe(true);
    expect.soft(src.includes(WALK_DEPARTMENT.id), 'seed-dev.py writes the walk department\'s fixed id').toBe(true);
    const t0 = devWorld();
    const s1 = runDevSeed(t0);
    expect(s1.error, `seed_departments runs (${s1.error ?? ''})`).toBeUndefined();
    const t1 = s1.tables!;
    const depsOf = (t: Tables, c: string) => ((listOf(t, c)?.['departments'] ?? []) as Dep[]);
    for (const [what, c] of [['the founding company', FOUNDING], ['the second company', SECOND], ['the walk company', WALK]] as const) {
      const deps = depsOf(t1, c);
      for (const n of STARTING) expect.soft(deps.filter((d) => d.name === n && d.status === 'ACTIVE').length, `${what} has ${n}`).toBe(1);
      expect.soft(deps.every((d) => DEP_ID.test(d.id)), `${what}: every id is dep_<ulid>`).toBe(true);
      expect.soft(listOf(t1, c)?.['tenant_id'], `${what}: the row carries its company`).toBe(c);
    }
    expect.soft(depsOf(t1, FOUNDING).find((d) => d.id === WALK_DEPARTMENT.id), 'the founding company has Fleet with the walk\'s id').toEqual({ ...WALK_DEPARTMENT, status: 'ACTIVE' });
    expect.soft(depsOf(t1, SECOND).some((d) => !STARTING.includes(d.name)), 'the second company has a name of its own (a different list)').toBe(true);
    expect.soft(depsOf(t1, SECOND).concat(depsOf(t1, WALK)).some((d) => d.id === WALK_DEPARTMENT.id), 'the walk id is the founding company\'s only').toBe(false);
    const added = rowsOf(t1, TENANTS).filter((x) => !rowsOf(t0, TENANTS).some((y) => y['pk'] === x['pk'] && y['sk'] === x['sk']));
    expect.soft(added.filter((x) => !/^DEPARTMENTS(#|$)/.test(String(x['sk']))).map((x) => `${x['pk']} ${x['sk']}`), 'it adds DEPARTMENTS rows only').toEqual([]);
    // A second run changes nothing.
    const s2 = runDevSeed(t1);
    expect.soft(s2.error, 'a second run runs').toBeUndefined();
    expect.soft(sameTables(s2.tables, t1), 'and changes nothing').toBe(true);
    // A test that renamed or archived Fleet is put back.
    const moved = structuredClone(t1);
    const row = moved[TENANTS]!.find((r) => plain(r)['pk'] === `TENANT#${FOUNDING}` && plain(r)['sk'] === 'DEPARTMENTS')!;
    const p = plain(row);
    const changed = (p['departments'] as Dep[]).map((d) => (d.id === WALK_DEPARTMENT.id ? { ...d, name: 'Fleet renamed by a test', status: 'ARCHIVED' as const } : d));
    Object.assign(row, av({ departments: changed, version: Number(p['version']) + 1 }));
    const s3 = runDevSeed(moved);
    expect.soft(s3.error, 'the seed runs over a changed Fleet').toBeUndefined();
    expect.soft(depsOf(s3.tables ?? {}, FOUNDING).find((d) => d.id === WALK_DEPARTMENT.id), 'Fleet is back: its name, active').toEqual({ ...WALK_DEPARTMENT, status: 'ACTIVE' });
    expect.soft(listOf(s3.tables, FOUNDING)?.['version'], 'and the version moved on (never back)').toBeGreaterThan(Number(p['version']) + 1);
    // The walk company's list with every department archived is still a list: the seed leaves it as it is.
    const archivedWorld = structuredClone(t1);
    const walkRow = archivedWorld[TENANTS]!.findIndex((r) => plain(r)['pk'] === `TENANT#${WALK}` && plain(r)['sk'] === 'DEPARTMENTS');
    archivedWorld[TENANTS]![walkRow] = listRow(WALK, 5, ARCHIVED_ONLY(WALK));
    const s4 = runDevSeed(archivedWorld);
    expect.soft(s4.error, 'the seed runs over an all-archived list').toBeUndefined();
    expect.soft(listOf(s4.tables, WALK), 'the walk company keeps its list: version 5, every department archived').toEqual(listOf(archivedWorld, WALK));
    const walkRows = (t: Tables | undefined) => JSON.stringify(rowsOf(t, TENANTS).filter((x) => x['pk'] === `TENANT#${WALK}`));
    expect.soft(walkRows(s4.tables), 'and no row of the walk company changed').toBe(walkRows(archivedWorld));
    // seed-dev.py reads every list with a consistent read (it decides on what it reads).
    const devListReads = ((s1.calls ?? []) as any[]).filter((x) => x.op === 'get_item' && x.key?.sk?.S === 'DEPARTMENTS');
    expect.soft(devListReads.length, 'seed-dev.py reads the lists').toBeGreaterThan(0);
    expect.soft(devListReads.every((x) => x.consistent === true), 'every read of a list is a consistent read').toBe(true);
  });
});

void [ADMIN_FORMS, ids, newKey];
