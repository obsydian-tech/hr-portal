import { readFileSync } from 'node:fs';
import { isRec062Grant } from './support/rec-09.1/grants'; // child lock rec-09.1 (REC-09), on top of rec-06.2.1
import { REC16_ROLE_KEY } from './support/rec-16.1/grants'; // child lock rec-16.1
import { join } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { REPO } from './support/rec-14/lambda-harness';
import { answerSchema, checker, looseObjects, operation, readDoc, refName, type Doc } from './support/rec-14/schema';
import { DEP } from './support/rec-14/world';
import { blocks } from './support/infra-harness';
import { filesOf, kmsList, lambdaNamed, policyLines, resourcesOf, roleResourceOf, settingsOf, squash, valueOf } from './support/rec-04/iam';
import { C, NOT_RECRUITERS, RECRUITERS } from './support/rec-04/callers';
import { bodyOf, describe, isModulesRead, statusOf } from './support/rec-04/world';
import { awsOf, changedRows, logsOf } from './support/rec-04/roles';
import { A, B, NOW, R, ROLES_TABLE, SUB, TABLE, TENANTS, list, plain, roleRow, rowsOf, runRoute, withRole, world, type Run, type Tables } from './support/rec-15/world';
import { isRec07Grant } from './support/rec-07.1/grants';
import { isRec05Grant } from './support/rec-05.1/grants'; // child lock rec-05.1
import { isRec15cGrant } from './support/rec-15c.1/grants'; // child lock rec-15c.1
import { isRec15dGrant } from './support/rec-15d.1/grants'; // child lock rec-15d.1
import { isInt01Grant } from './support/int-01.1/grants'; // child lock int-01.1

/**
 * REC-15 step B · Add a candidate to an open role (amber). Jira NH-266. Spec: /mnt/project-files/onboarding-cards/specs/REC-15.md, Part 3
 * (rules 19 to 23), AC-7, AC-8, AC-9, the add half of AC-16 and step B's lines of AC-17. Notes: cards/rec-15b.md. Review page:
 * onboarding-cards/specs/REC-15B-tests-for-review.md (the bar).
 *
 * The tests run the real handler (lambda/createCandidate) in a fresh Node process for each call, against REC-14's fake AWS over REC-15
 * step A's world (companies A and B, REC-04's roles, the Standard pack, a fixed clock NOW). The list read after an add is the real
 * getCandidates. Every answer is checked against api/openapi.yaml. Terraform is read as text. Nothing calls AWS or any AI. Nothing here has
 * a screen width: each test runs once, at 1280.
 *
 * Pinned by the verifier where the spec is silent (each is in cards/rec-15b.md for the BA to confirm):
 *  - D-T-B1 Refusal bodies: 400 { error: 'Bad request', code, field? } with code INVALID_FIELD (and the field), ROLE_REQUIRED,
 *    IDEMPOTENCY_KEY_REQUIRED (no key in the header or the body) or INVALID_BODY (not JSON, or not an object); 404 { error: 'Not found' };
 *    409 { error: 'Conflict', code: 'ROLE_CLOSED' }; 403 { error: 'Forbidden' }; 500 { error: 'Something went wrong' }. Codes as the
 *    role routes (REC-14) already give them.
 *  - D-T-B2 role_id that is missing, empty or not text is ROLE_REQUIRED.
 *  - D-T-B3 Text is trimmed before it is checked and stored: first_name and last_name 1 to 80, source 1 to 80, email at most 254 and
 *    stored lower-cased. phone is stored as sent (1 to 30 of digits, spaces and + - ( )).
 *  - D-T-B4 department_id and department are copied from the role row as it is stored (no departments read: rule 28 gives createCandidate
 *    only the roles read). A role with no department_id gives a row with no department_id. The criteria are stored as `criteria`.
 *  - D-T-B5 The answer's `candidate` is exactly the row GET /v1/candidates then gives the same caller for that candidate (rule 22).
 *  - D-T-B6 When the header and the body both carry a key, the header is the key.
 *  - D-T-B7 A replay of a finished key answers the first answer even when the role has closed since (the key is the promise).
 *  - D-T-B8 A key held by a request still running (IN_PROGRESS) is 409 and writes no candidate.
 *  - D-T-B9 CandidateCreated keeps today's detail keys exactly: candidateId, tenant_id, positionLevel, positionTitle, email (rule 23).
 *  - D-T-B10 A failed read of the role is 500 with nothing written, no candidate, no event and no key held (the same key then works).
 *    Lock check round 1 (D-1, decided): after ANY failure that stored no candidate, the same key works on the next try (201). The build
 *    may mark the key FAILED with a PutItem (the role already holds PutItem on the key table); it gets no new grant. A failed event send
 *    does not fail the add (rule 23, best effort as today): 201, the candidate stored, the log names the error only.
 *  - D-T-B12 (lock check round 1, F2) Every AWS call an add makes is one createCandidate's role may make after step B: DynamoDB GetItem on
 *    the key, settings, roles and tenants tables; PutItem on the state and key tables; Query on the settings index GSI1-active-configs;
 *    EventBridge PutEvents. No UpdateItem, DeleteItem, Scan, Batch or Transact call (the role has none, so on AWS they would be refused).
 *  - D-T-B11 Terraform: createCandidate gains exactly one grant, GetItem on talent-flow-roles, and its Lambda gets ROLES_TABLE_NAME. The
 *    roles table uses the state key createCandidate already holds, so no KMS line changes.
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS or reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};
const ROUTE = 'POST /v1/candidates';
const FORBIDDEN = { error: 'Forbidden' };
const NOT_FOUND = { error: 'Not found' };
const invalid = (field: string) => ({ error: 'Bad request', code: 'INVALID_FIELD', field });
const code400 = (code: string) => ({ error: 'Bad request', code });
const ROLE_CLOSED = { error: 'Conflict', code: 'ROLE_CLOSED' };
const SERVER_ERROR = { error: 'Something went wrong' };
const answer = (r: Run) => [statusOf(r), bodyOf(r)];
const sorted = (a: string[]) => [...a].sort();
// not_hired_pending: child lock rec-15b.4 (REC-UI-01.6, NH-291 rule 1): a new candidate's row carries it as null.
const ROW_KEYS = ['applied_at', 'due_at', 'hiring_manager_id', 'id', 'level', 'mine', 'name', 'not_hired_pending', 'role_id', 'role_title', 'sla_status', 'stage', 'stage_entered_at'];
const CRITERIA = [{ key: 'technical', label: 'Technical' }, { key: 'communication', label: 'Communication' }, { key: 'culturalFit', label: 'Cultural fit' }, { key: 'problemSolving', label: 'Problem solving' }];

/** A good body (rule 19), with any field changed or removed (`undefined` removes it). */
const GOOD = { first_name: 'Thandeka', last_name: 'Mahlaba', email: 'thandeka.mahlaba@example.test', role_id: R.fleet };
const body = (change: Record<string, unknown> = {}) => {
  const out: Record<string, unknown> = { ...GOOD, ...change };
  for (const [k, v] of Object.entries(change)) if (v === undefined) delete out[k];
  return out;
};
let keyN = 0;
const newKey = () => `rec15b-key-${process.pid}-${++keyN}`;
/**
 * Each add runs at its own time, a whole number of seconds after NOW (the fake ulid counts from the clock, so two runs at one fixed time
 * would make the same id). `atOf(r)` is the time a run saw.
 */
let addN = 0;
const runAt = new WeakMap<Run, string>();
const atOf = (r: Run) => runAt.get(r) ?? NOW;
type AddOpts = { key?: string | null; headers?: Record<string, string>; query?: Record<string, string>; path?: Record<string, string>; fail?: any };
/** POST /v1/candidates as `who`. The key goes in the Idempotency-Key header unless `key` is null (no header). */
const add = (who: any, b: unknown, t: Tables, o: AddOpts = {}): Run => {
  const key = o.key === undefined ? newKey() : o.key;
  const now = new Date(Date.parse(NOW) + ++addN * 1000).toISOString();
  const r = runRoute('createCandidate', ROUTE, who, { body: b, headers: { ...(key === null ? {} : { 'Idempotency-Key': key }), ...(o.headers ?? {}) }, query: o.query, path: o.path }, t, { now, ...(o.fail ? { fail: o.fail } : {}) });
  runAt.set(r, now);
  const refused = notAllowed(r);
  expect.soft(refused, `add ${addN}: every AWS call is one createCandidate's role may make (D-T-B12)`).toEqual([]);
  return r;
};

/**
 * D-T-B12: the calls createCandidate's role allows after step B (talent-flow-iam.tf, create_candidate and its modules read, plus the one
 * roles grant). The fake AWS does not check IAM, so this list does: a call outside it would be refused on AWS.
 */
const MAY: Record<string, string[]> = {
  'dynamodb GetItem': [TABLE.idempotency, TABLE.config, ROLES_TABLE, TENANTS],
  'dynamodb PutItem': [TABLE.state, TABLE.idempotency],
  'dynamodb Query': [TABLE.config],
  'events PutEvents': [''],
};
function notAllowed(r: Run): string[] {
  const out: string[] = [];
  for (const c of awsOf(r) as any[]) {
    const what = `${c.service} ${c.op}`;
    const where = c.service === 'events' ? '' : String(c.table ?? '');
    const ok = (MAY[what] ?? []).includes(where) && (what !== 'dynamodb Query' || c.input?.IndexName === 'GSI1-active-configs');
    if (!ok) out.push(`${what} ${where}${c.input?.IndexName ? ' index ' + c.input.IndexName : ''}`);
  }
  return out;
}

/** The candidate rows (SK SAGA) a run added. */
const newSagas = (before: Tables, r: Run) => {
  const had = new Set(rowsOf(before, TABLE.state).map((x) => `${x['PK']}|${x['SK']}`));
  return rowsOf(r.tables, TABLE.state).filter((x) => x['SK'] === 'SAGA' && !had.has(`${x['PK']}|${x['SK']}`));
};
const inProgress = (r: Run) => rowsOf(r.tables, TABLE.idempotency).filter((x) => x['status'] === 'IN_PROGRESS');
const eventsOf = (r: Run) => awsOf(r).filter((c: any) => c.service === 'events');
const sagaWrites = (r: Run) => awsOf(r).filter((c: any) => c.service === 'dynamodb' && /PutItem|UpdateItem|TransactWriteItems|BatchWriteItem/.test(c.op) && JSON.stringify(c.input ?? {}).includes('SAGA'));

/** A refused request: no candidate, no candidate write, no event, no row of any table but the key table changed, no key left IN_PROGRESS. */
function refusedClean(label: string, before: Tables, r: Run) {
  expect.soft(newSagas(before, r).map((x) => x['PK']), `${label}: no candidate row`).toEqual([]);
  expect.soft(sagaWrites(r).length, `${label}: no candidate write`).toBe(0);
  expect.soft(eventsOf(r).length, `${label}: no event`).toBe(0);
  expect.soft(changedRows(before, r.tables).filter((x) => x['table'] !== TABLE.idempotency).map((x) => `${x['table']} ${x['pk'] ?? x['PK']}`), `${label}: no other row changed`).toEqual([]);
  expect.soft(inProgress(r).length, `${label}: no key left IN_PROGRESS`).toBe(0);
}

/** Nothing but the role check: no AWS call at all (403 before any read). */
const noAws = (label: string, r: Run) => expect.soft(awsOf(r).map((c: any) => `${c.service} ${c.op} ${c.table ?? ''}`), `${label}: no AWS call`).toEqual([]);

let docCache: Doc | undefined;
const doc = () => (docCache ??= readDoc());
const misfit = (r: Run): string[] => {
  const s = statusOf(r);
  if (s === undefined) return [`no answer (${describe(r)})`];
  return checker(doc()).check(answerSchema(doc(), ROUTE, s), bodyOf(r)).map((p) => `${ROUTE} ${s}: ${p}`);
};
const fits = (label: string, ...runs: Run[]) => {
  for (const r of runs) expect.soft(misfit(r), `${label}: the answer (${describe(r).slice(0, 120)}) passes api/openapi.yaml`).toEqual([]);
};

/** Text that must never be in a log line: the person's details as sent and as stored, and the message of a planted failure. */
const SECRET_MESSAGE = 'zz-rec15b-planted-detail';
function logsClean(label: string, r: Run, b: Record<string, unknown> = GOOD) {
  const lines = logsOf(r).join('\n').toLowerCase();
  const words = [b['first_name'], b['last_name'], b['email'], b['phone'], b['source'], SECRET_MESSAGE].filter((x) => typeof x === 'string' && x.trim()).map((x) => String(x).trim().toLowerCase());
  for (const w of words) expect.soft(lines.includes(w), `${label}: no log line holds "${w}"`).toBe(false);
}

const rowsIn = (r: Run): any[] => (bodyOf(r)?.candidates ?? []) as any[];

// ---------------------------------------------------------------- tests

test.describe('REC-15 step B · Add a candidate to an open role', () => {
  test('Control: the world is good: the roles are there as the tests expect, the list answers, and B cannot see A', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    const roles = rowsOf(t, ROLES_TABLE);
    const of = (c: string, id: string) => roles.find((x) => x['tenant_id'] === c && x['role_id'] === id);
    expect.soft([of(A, R.fleet)?.['status'], of(A, R.fleet)?.['job_title'], of(A, R.fleet)?.['level'], of(A, R.fleet)?.['hiring_manager_id']], 'Fleet controller is an open MID role of A for hmA').toEqual(['OPEN', 'Fleet controller', 'MID', SUB.hmA]);
    expect.soft([of(A, R.warehouse)?.['status'], of(A, R.warehouse)?.['level'], of(A, R.warehouse)?.['hiring_manager_id']], 'Warehouse supervisor is an open SENIOR role of A for hm2A').toEqual(['OPEN', 'SENIOR', SUB.hm2A]);
    expect.soft(of(A, R.closed)?.['status'], 'Old till role is closed').toBe('CLOSED');
    expect.soft(of(B, R.b)?.['status'], 'B has an open role').toBe('OPEN');
    expect.soft(of(A, R.b), 'and A has no role with B\'s id').toBeUndefined();
    const l = list(C.recruiter, {}, t);
    expect.soft(statusOf(l), `A's Recruiter lists candidates (${describe(l)})`).toBe(200);
    expect.soft(JSON.stringify(bodyOf(list(C.recruiterB, {}, t))), 'B lists none of A\'s').not.toContain('Amahle');
  });

  // ---------------------------------------------------------------- AC-7

  test('AC-7 A valid body gives 201 with candidateId and the new candidate as the list shows it; the row takes title, level, department, hiring manager and criteria from the role', async ({}, testInfo) => {
    once(testInfo.project.name);
    const base = world();
    // Fleet controller carries a department id, as a role opened after REC-14 does; the stored department text is the role's.
    const t = withRole(base, A, R.fleet, { department_id: DEP.opsA.id, department: 'Operations' });
    const sent = body({ first_name: '  Thandeka ', last_name: ' Mahlaba  ', email: '  Thandeka.MAHLABA@Example.Test ', phone: '+27 (82) 555-0101', source: ' Referral ' });
    const r = add(C.recruiter, sent, t);
    expect(statusOf(r), `201 (${describe(r)})`).toBe(201);
    const a = bodyOf(r);
    expect.soft(Object.keys(a ?? {}).sort(), 'the answer has candidateId and candidate, nothing else (no notice: REC-08)').toEqual(['candidate', 'candidateId']);
    expect.soft(a?.candidateId, 'candidateId is a CAND- id').toMatch(/^CAND-[0-9A-Z]{10,}$/);
    expect.soft(a?.candidate?.id, 'the candidate is the same id').toBe(a?.candidateId);
    const added = newSagas(t, r);
    expect(added.length, 'one candidate row').toBe(1);
    const row = added[0]!;
    expect.soft(row['PK'], 'the row is the candidate\'s').toBe(`CANDIDATE#${a?.candidateId}`);
    expect.soft([row['tenant_id'], row['GSI1PK']], 'stamped with A, under A').toEqual([A, `TENANT#${A}`]);
    expect.soft(row['role_id'], 'role_id').toBe(R.fleet);
    expect.soft(row['positionTitle'], 'positionTitle is the role\'s job_title').toBe('Fleet controller');
    expect.soft(row['positionLevel'], 'positionLevel is the role\'s level').toBe('MID');
    expect.soft([row['department_id'], row['department']], 'department_id and department from the role (D-T-B4)').toEqual([DEP.opsA.id, 'Operations']);
    expect.soft(row['hiringManagerId'], 'hiringManagerId is the role\'s hiring manager').toBe(SUB.hmA);
    expect.soft(row['criteria'], 'the role\'s criteria are locked on the row (REC-04 rule 3)').toEqual(CRITERIA);
    expect.soft(row['added_by'], 'added_by is the person adding').toBe(SUB.recA);
    expect.soft([row['appliedDate'], row['createdAt']].map((x) => Date.parse(x)), 'appliedDate and createdAt are now').toEqual([Date.parse(atOf(r)), Date.parse(atOf(r))]);
    expect.soft(row['currentStage'], 'stage Applied').toBe('APPLIED');
    expect.soft([row['firstName'], row['lastName']], 'names stored trimmed (D-T-B3)').toEqual(['Thandeka', 'Mahlaba']);
    expect.soft(row['email'], 'email stored trimmed and lower-cased').toBe('thandeka.mahlaba@example.test');
    expect.soft([row['phone'], row['source']], 'phone as sent, source trimmed').toEqual(['+27 (82) 555-0101', 'Referral']);
    for (const k of ['idempotencyKey', 'first_name', 'last_name', 'role', 'tenantId_from_body']) expect.soft(k in row, `the row holds no body key "${k}"`).toBe(false);
    // The answer is the row the list gives the same Recruiter right after (rule 22, D-T-B5).
    const after = list(C.recruiter, {}, r.tables);
    const listed = rowsIn(after).find((x) => x?.id === a?.candidateId);
    expect.soft(listed, 'the new candidate is in A\'s list').toBeTruthy();
    expect.soft(a?.candidate, 'the answer\'s candidate equals the list row').toEqual(listed);
    expect.soft(Object.keys(a?.candidate ?? {}).sort(), 'exactly the CandidateRow fields, with source').toEqual(sorted([...ROW_KEYS, 'source']));
    expect.soft([a?.candidate?.stage, a?.candidate?.role_title, a?.candidate?.level, a?.candidate?.hiring_manager_id, a?.candidate?.mine, a?.candidate?.sla_status], 'Applied, the role\'s title, level and manager, mine, on track').toEqual(['APPLIED', 'Fleet controller', 'MID', SUB.hmA, true, 'ON_TRACK']);
    expect.soft(a?.candidate?.name, 'name is the trimmed first and last name').toBe('Thandeka Mahlaba');
    expect.soft(JSON.stringify(a), 'the answer holds no email or phone').not.toMatch(/thandeka\.mahlaba@|555-0101/i);
    // It counts: A's list gains it under Applied; the role's manager sees it; B does not.
    const before = list(C.recruiter, {}, t);
    expect.soft(bodyOf(after)?.counts?.all, 'A\'s count gains one').toBe((bodyOf(before)?.counts?.all ?? 0) + 1);
    expect.soft(rowsIn(list(C.recruiter, { stage: 'APPLIED' }, r.tables)).some((x) => x.id === a?.candidateId), 'under Applied').toBe(true);
    expect.soft(rowsIn(list(C.hmC1, {}, r.tables)).some((x) => x.id === a?.candidateId), 'the role\'s hiring manager sees it').toBe(true);
    expect.soft(JSON.stringify(bodyOf(list(C.recruiterB, {}, r.tables))), 'B does not').not.toContain(String(a?.candidateId));
    // The event goes as today (rule 23, D-T-B9).
    const ev = eventsOf(r) as any[];
    expect.soft(ev.length, 'one CandidateCreated event').toBe(1);
    expect.soft([ev[0]?.detailType, ev[0]?.source], 'CandidateCreated from talent-flow.candidates').toEqual(['CandidateCreated', 'talent-flow.candidates']);
    expect.soft(Object.keys(ev[0]?.detail ?? {}).sort(), 'it names no more than today').toEqual(['candidateId', 'email', 'positionLevel', 'positionTitle', 'tenant_id']);
    expect.soft([ev[0]?.detail?.candidateId, ev[0]?.detail?.tenant_id, ev[0]?.detail?.positionTitle, ev[0]?.detail?.positionLevel], 'its values: the new id, A, the role\'s title and level').toEqual([a?.candidateId, A, 'Fleet controller', 'MID']);
    logsClean('the add', r, sent);
    fits('AC-7', r);

    // Another role gives other values: nothing is a fixed value (Warehouse supervisor: SENIOR, hm2A; an old role with no department_id).
    const w = add(C.recruiter, body({ role_id: R.warehouse, email: 'w@example.test' }), base);
    expect(statusOf(w), `Warehouse supervisor: 201 (${describe(w)})`).toBe(201);
    const wr = newSagas(base, w)[0] ?? {};
    expect.soft([wr['positionTitle'], wr['positionLevel'], wr['hiringManagerId'], wr['department']], 'Warehouse supervisor\'s title, level, manager and department text').toEqual(['Warehouse supervisor', 'SENIOR', SUB.hm2A, 'Operations']);
    expect.soft('department_id' in wr, 'a role with no department id gives a row with none').toBe(false);
    expect.soft('source' in (bodyOf(w)?.candidate ?? {}), 'no source sent: none in the answer').toBe(false);
    expect.soft('phone' in wr || 'source' in wr, 'and none stored').toBe(false);
    expect.soft(bodyOf(w)?.candidate?.mine, 'mine for the person who added it, though hm2A hires').toBe(true);
    const fin = add(C.adminHr, body({ role_id: R.accountant, email: 'f@example.test' }), withRole(base, A, R.accountant, { department_id: DEP.finA.id, department: 'Finance', criteria: [{ key: 'numbers', label: 'Numbers' }] }));
    expect.soft(statusOf(fin), `an admin who is also HR with the tick may add (${describe(fin)})`).toBe(201);
    const fr = newSagas(base, fin)[0] ?? {};
    expect.soft([fr['positionTitle'], fr['department_id'], fr['department'], fr['criteria'], fr['added_by']], 'Senior accountant: its own title, department, criteria; added by the admin').toEqual(['Senior accountant', DEP.finA.id, 'Finance', [{ key: 'numbers', label: 'Numbers' }], 'sub-adminhr-a']);
    // The same person added twice to the same role with two keys: two candidates (Q-11, no duplicate refusal).
    const twice = add(C.recruiter, body(), w.tables);
    expect.soft(statusOf(twice), 'the same email again on another key: 201').toBe(201);
    expect.soft(newSagas(base, twice).length, 'two candidates now').toBe(2);
    fits('AC-7 other roles', w, fin, twice);
  });

  test('AC-7 A body that names the title, level, department, hiring manager, company or any other unknown key is 400 INVALID_FIELD for that key and writes nothing', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    const runs: Run[] = [];
    const stale: [string, unknown][] = [
      ['positionTitle', 'Chief'], ['positionLevel', 'SENIOR'], ['department', 'Finance'], ['department_id', DEP.finA.id], ['hiringManagerId', SUB.hm2A],
      ['hiring_manager_id', SUB.hm2A], ['tenantId', B], ['tenant_id', B], ['job_title', 'Chief'], ['level', 'SENIOR'], ['criteria', []], ['added_by', SUB.hmA],
      ['currentStage', 'OFFER'], ['cv_key', 'uploads/x.pdf'], ['firstName', 'Thandeka'], ['notice', { status: 'SENT' }], ['candidateId', 'CAND-MINE'], ['location', 'Durban'],
    ];
    for (const [k, v] of stale) {
      const r = add(C.recruiter, body({ [k]: v }), t);
      runs.push(r);
      expect.soft(answer(r), `${k}: 400 INVALID_FIELD naming it`).toEqual([400, invalid(k)]);
      refusedClean(k, t, r);
    }
    // Today's whole body (an old client): refused loudly, never half obeyed.
    const old = add(C.recruiter, { idempotencyKey: newKey(), firstName: 'Lerato', lastName: 'Mokoena', email: 'lerato@example.test', positionTitle: 'Baker', positionLevel: 'JUNIOR' }, t, { key: null });
    runs.push(old);
    expect.soft(statusOf(old), 'the old body: 400').toBe(400);
    expect.soft(bodyOf(old)?.code, 'INVALID_FIELD').toBe('INVALID_FIELD');
    expect.soft(['firstName', 'lastName', 'positionTitle', 'positionLevel'], 'naming one of its old keys').toContain(bodyOf(old)?.field);
    refusedClean('the old body', t, old);
    fits('AC-7 unknown keys', ...runs);
  });

  // ---------------------------------------------------------------- AC-8

  test('AC-8 The role decides: no role_id is ROLE_REQUIRED, another company\'s role and a made-up id are one identical 404, a closed role is 409 ROLE_CLOSED; nothing is written', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    const runs: Run[] = [];
    for (const [label, v] of [['missing', undefined], ['empty', ''], ['a number', 7], ['null', null], ['a list', [R.fleet]]] as [string, unknown][]) {
      const r = add(C.recruiter, body({ role_id: v }), t);
      runs.push(r);
      expect.soft(answer(r), `role_id ${label}: 400 ROLE_REQUIRED (D-T-B2)`).toEqual([400, code400('ROLE_REQUIRED')]);
      refusedClean(`role_id ${label}`, t, r);
    }
    // A stray role row stamped B under A's key: never A's.
    const STRAY = 'role-15REC15BSTRAYBBBBBBBB1';
    const ts = structuredClone(t);
    ts[ROLES_TABLE] = [...(ts[ROLES_TABLE] ?? []), roleRow(A, STRAY, SUB.hmA, { tenant_id: B, tenantId: B, job_title: 'Stray B title' })];
    const made = add(C.recruiter, body({ role_id: 'role-15REC15MADEUPAAAAAAAAA1' }), ts);
    const theirs = add(C.recruiter, body({ role_id: R.b }), ts);
    const stray = add(C.recruiter, body({ role_id: STRAY }), ts);
    const bOnA = add(C.recruiterB, body({ role_id: R.fleet }), ts);
    const bMade = add(C.recruiterB, body({ role_id: 'role-15REC15MADEUPAAAAAAAAA1' }), ts);
    runs.push(made, theirs, stray, bOnA, bMade);
    expect.soft(answer(made), 'a made-up role id: 404 Not found').toEqual([404, NOT_FOUND]);
    expect.soft(answer(theirs), 'B\'s role, from A: the very same answer').toEqual(answer(made));
    expect.soft(answer(stray), 'a role row of B under A\'s key: the very same answer').toEqual(answer(made));
    expect.soft(answer(bOnA), 'A\'s role, from B: the very same answer').toEqual(answer(bMade));
    expect.soft(answer(bMade), 'and that is 404 Not found').toEqual([404, NOT_FOUND]);
    for (const [l, r] of [['made-up', made], ['B\'s role', theirs], ['stray', stray], ['B on A\'s role', bOnA]] as [string, Run][]) {
      refusedClean(l, ts, r);
      expect.soft(JSON.stringify(bodyOf(r)), `${l}: names no title of the other company`).not.toMatch(/Stray B title|Dispatch lead|Fleet controller/);
    }
    const closed = add(C.recruiter, body({ role_id: R.closed }), t);
    runs.push(closed);
    expect.soft(answer(closed), 'a closed role: 409 ROLE_CLOSED').toEqual([409, ROLE_CLOSED]);
    refusedClean('closed', t, closed);
    // The same key works once the refusal is fixed: the refusal held nothing.
    const k = newKey();
    const first = add(C.recruiter, body({ role_id: R.closed }), t, { key: k });
    const again = add(C.recruiter, body(), first.tables, { key: k });
    runs.push(first, again);
    expect.soft(statusOf(again), `the same key on an open role after the refusal: 201 (${describe(again)})`).toBe(201);
    fits('AC-8 roles', ...runs);
  });

  test('AC-8 Each bad field is 400 INVALID_FIELD naming it and writes nothing; the edges of each field are accepted', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    const runs: Run[] = [];
    const x = (n: number) => 'x'.repeat(n);
    const bad: [string, unknown][] = [
      ['first_name', undefined], ['first_name', ''], ['first_name', '   '], ['first_name', x(81)], ['first_name', 7],
      ['last_name', undefined], ['last_name', ''], ['last_name', '  '], ['last_name', x(81)], ['last_name', ['Mahlaba']],
      ['email', undefined], ['email', ''], ['email', 'not-an-email'], ['email', 'two@@example.test'], ['email', 'a b@example.test'], ['email', `${x(242)}@example.test`], ['email', 5],
      ['phone', ''], ['phone', 'call me'], ['phone', '082 555 0101 ext 4'], ['phone', '1'.repeat(31)], ['phone', 27825550101],
      ['source', ''], ['source', '   '], ['source', x(81)], ['source', 3],
    ];
    for (const [k, v] of bad) {
      const r = add(C.recruiter, body({ [k]: v }), t);
      runs.push(r);
      expect.soft(answer(r), `${k} = ${JSON.stringify(v)?.slice(0, 30)}: 400 INVALID_FIELD ${k}`).toEqual([400, invalid(k)]);
      refusedClean(`${k} ${JSON.stringify(v)?.slice(0, 20)}`, t, r);
    }
    for (const [label, raw] of [['not JSON', '{not json'], ['a list', '[1,2]'], ['a string', '"hello"']] as [string, string][]) {
      const r = add(C.recruiter, raw, t);
      runs.push(r);
      expect.soft(answer(r), `${label}: 400 INVALID_BODY (D-T-B1)`).toEqual([400, code400('INVALID_BODY')]);
      refusedClean(label, t, r);
    }
    // The edges pass, so a stricter build is caught too.
    const edges: Record<string, unknown>[] = [
      { first_name: x(80), last_name: x(80) }, { first_name: 'A', last_name: 'B' }, { email: `${x(241)}@example.test` },
      { phone: '+27 (82) 555-0101 000 00' }, { phone: '0825550101' }, { source: x(80) }, { source: 'S' },
    ];
    for (const e of edges) {
      const r = add(C.recruiter, body({ ...e, email: (e['email'] as string) ?? `edge${keyN}@example.test` }), t);
      runs.push(r);
      expect.soft(statusOf(r), `${JSON.stringify(e).slice(0, 60)}: accepted (${describe(r).slice(0, 160)})`).toBe(201);
    }
    fits('AC-8 fields', ...runs);
  });

  test('AC-8 Only a Recruiter may add: every other caller is 403 before any AWS call; Recruitment off and no company are refused; the company never comes from the request', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    const runs: Run[] = [];
    // Every caller of A who is not a Recruiter (REC-01's list), the other company's non-Recruiters, and two people who lost half of it.
    const refused = [
      ...NOT_RECRUITERS, C.taPanelOn2, C.managerB, C.panelB, C.adminB,
      { name: 'Recruiter whose tick was taken away (now HR only)', groups: ['hr_staff'], sub: SUB.recA },
      { name: 'Recruiter whose HR role was taken away (tick only)', groups: ['perm-recruitment'], sub: SUB.recA },
    ];
    for (const who of refused) {
      const r = add(who as any, body(), t);
      runs.push(r);
      expect.soft(answer(r), `${who.name}: 403`).toEqual([403, FORBIDDEN]);
      noAws(who.name, r);
      refusedClean(who.name, t, r);
    }
    // Every form of Recruiter REC-01 knows may add (old TalentFlow HR names count until TEN-06).
    for (const who of RECRUITERS) {
      const r = add(who as any, body({ email: `rec${keyN}@example.test` }), t);
      runs.push(r);
      expect.soft(statusOf(r), `${who.name}: 201 (${describe(r).slice(0, 120)})`).toBe(201);
    }
    // The hiring manager of the role, sending a body that names themself and the company: still 403 before any read.
    const hmTry = add(C.hmC1, body({ hiringManagerId: SUB.hmA, tenantId: A }), t);
    expect.soft(answer(hmTry), 'the role\'s own hiring manager: 403').toEqual([403, FORBIDDEN]);
    noAws('the hiring manager', hmTry);
    const d = add(C.recruiterD, body(), t);
    expect.soft(statusOf(d), `Recruitment off: refused (${describe(d)})`).toBe(403);
    refusedClean('Recruitment off', t, d);
    expect.soft(awsOf(d).filter((c: any) => !isModulesRead(c)).length, 'Recruitment off: nothing read but the module row').toBe(0);
    const none = add(C.recruiterNoCompany, body(), t);
    expect.soft(statusOf(none), `no company: refused (${describe(none)})`).toBe(403);
    noAws('no company', none);
    refusedClean('no company', t, none);
    runs.push(hmTry, d, none);
    // The company comes from the sign-in only: B named in the query, a header and the path changes nothing.
    const r = add(C.recruiter, body(), t, { query: { tenantId: B, tenant_id: B }, headers: { 'x-tenant-id': B, 'X-Tenant': B }, path: { tenantId: B } });
    runs.push(r);
    expect.soft(statusOf(r), `A's Recruiter, naming B everywhere but the sign-in: 201 (${describe(r)})`).toBe(201);
    const row = newSagas(t, r)[0] ?? {};
    expect.soft([row['tenant_id'], row['GSI1PK']], 'the row is A\'s').toEqual([A, `TENANT#${A}`]);
    expect.soft(JSON.stringify(row), 'and names B nowhere').not.toContain(B);
    const bq = add(C.recruiterB, body({ role_id: R.b }), t, { query: { tenantId: A }, headers: { 'x-tenant-id': A } });
    runs.push(bq);
    expect.soft(statusOf(bq), `B's Recruiter on B's role: 201 (${describe(bq)})`).toBe(201);
    const brow = newSagas(t, bq)[0] ?? {};
    expect.soft([brow['tenant_id'], brow['GSI1PK'], brow['positionTitle'], brow['hiringManagerId'], brow['added_by']], 'B\'s row, B\'s role, B\'s people').toEqual([B, `TENANT#${B}`, 'Dispatch lead', SUB.hmB, SUB.recB]);
    expect.soft(JSON.stringify(bodyOf(list(C.recruiter, {}, bq.tables))), 'A\'s list does not show B\'s new candidate').not.toContain(String(bodyOf(bq)?.candidateId));
    fits('AC-8 callers', ...runs);
  });

  test('AC-8 A failed read or write is a 500 that says nothing more; a failed role read writes nothing and holds no key; logs carry error names only', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    const fail = (ops: string[], nth?: number) => ({ service: 'dynamodb', ops, message: `${SECRET_MESSAGE} ${GOOD.email} ${GOOD.first_name}`, name: 'ProvisionedThroughputExceededException', ...(nth ? { nth } : {}) });
    const k = newKey();
    // The first GetItem is the module row (MOD-01). The next two are the key and the role, in whichever order the build reads them: fail
    // each in turn. Either way: 500, nothing written, no key held, so the same key then works (D-T-B10).
    const retries: Run[] = [];
    const getRuns: Run[] = [];
    for (const nth of [2, 3]) {
      const getFails = add(C.recruiter, body(), t, { key: k, fail: fail(['GetItem'], nth) });
      getRuns.push(getFails);
      expect.soft(answer(getFails), `read ${nth} fails: 500 Something went wrong`).toEqual([500, SERVER_ERROR]);
      refusedClean(`read ${nth} fails`, t, getFails);
      logsClean(`read ${nth} fails`, getFails);
      expect.soft(logsOf(getFails).join('\n'), `read ${nth} fails: the log names the error`).toContain('ProvisionedThroughputExceededException');
      const retry = add(C.recruiter, body(), getFails.tables, { key: k });
      retries.push(retry);
      expect.soft(statusOf(retry), `read ${nth} failed: the same key afterwards gives 201 (D-T-B10) (${describe(retry)})`).toBe(201);
    }
    const [getFails, retry] = [getRuns[0]!, retries[0]!];
    // Lock check round 1 (F1): each PutItem fails in turn (the order is the build's). Rules that do not depend on the order: a 201 or 200
    // only ever comes with a stored candidate whose id is the answer's; a run that stored no candidate answers 500 Something went wrong,
    // sends no event and leaves the key free (D-1: the same key then gives 201, and one candidate in all). Logs carry error names only.
    const putRuns: Run[] = [];
    let candidateWriteFailed = false;
    for (const nth of [1, 2, 3, 4]) {
      const pk = newKey();
      const r = add(C.recruiter, body(), t, { key: pk, fail: fail(['PutItem'], nth) });
      putRuns.push(r);
      const puts = (awsOf(r) as any[]).filter((c) => c.service === 'dynamodb' && c.op === 'PutItem');
      if (puts.length >= nth && puts[nth - 1].table === TABLE.state) candidateWriteFailed = true;
      const stored = newSagas(t, r);
      const s = statusOf(r);
      if (s === 200 || s === 201) {
        expect.soft(stored.map((x) => x['candidateId']), `PutItem ${nth} fails, answer ${s}: exactly the answered candidate is stored`).toEqual([bodyOf(r)?.candidateId]);
      } else {
        expect.soft(answer(r), `PutItem ${nth} fails, not 200 or 201: 500 Something went wrong`).toEqual([500, SERVER_ERROR]);
      }
      if (stored.length === 0) {
        expect.soft(eventsOf(r).length, `PutItem ${nth} fails, no candidate stored: no event`).toBe(0);
        const again = add(C.recruiter, body(), r.tables, { key: pk });
        putRuns.push(again);
        expect.soft(statusOf(again), `PutItem ${nth} failed with no candidate stored: the same key then gives 201 (D-1) (${describe(again)})`).toBe(201);
        expect.soft(newSagas(t, again).length, `PutItem ${nth} failed, then the same key: one candidate in all`).toBe(1);
      }
      logsClean(`PutItem ${nth} fails`, r);
      if (puts.length >= nth) expect.soft(logsOf(r).join('\n'), `PutItem ${nth} fails: the log names the error`).toContain('ProvisionedThroughputExceededException');
    }
    expect.soft(candidateWriteFailed, 'one of the runs failed the candidate write itself (a PutItem on the state table)').toBe(true);
    // The event send fails: the add still stands (rule 23, best effort as today), and the log names the error only.
    const evFails = add(C.recruiter, body(), t, { fail: { service: 'events', ops: ['PutEvents'], message: `${SECRET_MESSAGE} ${GOOD.email}`, name: 'EventBridgeThrottled' } });
    expect.soft(statusOf(evFails), `the event send fails: still 201 (${describe(evFails)})`).toBe(201);
    expect.soft(newSagas(t, evFails).map((x) => x['candidateId']), 'the event send fails: the candidate is stored').toEqual([bodyOf(evFails)?.candidateId]);
    expect.soft(eventsOf(evFails).length, 'the event send was tried').toBe(1);
    logsClean('the event send fails', evFails);
    expect.soft(logsOf(evFails).join('\n'), 'the event send fails: the log names the error').toContain('EventBridgeThrottled');
    // The settings read fails: 500, nothing written.
    const qFails = add(C.recruiter, body(), t, { fail: fail(['Query']) });
    expect.soft(answer(qFails), 'the settings read fails: 500').toEqual([500, SERVER_ERROR]);
    expect.soft(newSagas(t, qFails).length, 'no candidate').toBe(0);
    logsClean('the settings read fails', qFails);
    // A good add and a refusal log nothing personal either.
    const sent = body({ phone: '+27 82 555 0199', source: 'zz-source-text' });
    const ok = add(C.recruiter, sent, t);
    expect.soft(statusOf(ok), 'a good add').toBe(201);
    logsClean('a good add', ok, sent);
    const refusedRun = add(C.recruiter, body({ ...sent, email: 'zz bad mail' }), t);
    logsClean('a refusal', refusedRun, { ...sent, email: 'zz bad mail' });
    fits('AC-8 failures', ...getRuns, ...retries, ...putRuns, evFails, qFails, ok, refusedRun);
    void [getFails, retry];
  });

  // ---------------------------------------------------------------- AC-9

  test('AC-9 Idempotency: the header key gives one candidate for two requests, the second 200 with the same answer and no write; the key is per company; the body key still works; no key is 400', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    const runs: Run[] = [];
    const k = newKey();
    const one = add(C.recruiter, body(), t, { key: k });
    const two = add(C.recruiter, body(), one.tables, { key: k });
    runs.push(one, two);
    expect.soft(statusOf(one), `first: 201 (${describe(one)})`).toBe(201);
    expect.soft(answer(two), 'second: 200 and the same body').toEqual([200, bodyOf(one)]);
    expect.soft(newSagas(t, two).length, 'one candidate').toBe(1);
    expect.soft(sagaWrites(two).length + eventsOf(two).length, 'the replay writes no candidate and sends no event').toBe(0);
    expect.soft(changedRows(one.tables, two.tables).length, 'the replay changes no row').toBe(0);
    // Any capitals of the header name.
    const lower = add(C.recruiter, body({ email: 'lower@example.test' }), two.tables, { key: null, headers: { 'idempotency-key': k + '-lower' } });
    const lower2 = add(C.recruiter, body({ email: 'lower@example.test' }), lower.tables, { key: null, headers: { 'IDEMPOTENCY-KEY': k + '-lower' } });
    runs.push(lower, lower2);
    expect.soft([statusOf(lower), statusOf(lower2)], 'idempotency-key in any capitals: 201 then 200').toEqual([201, 200]);
    expect.soft(bodyOf(lower2), 'the same answer').toEqual(bodyOf(lower));
    // B with A's key writes its own candidate, and A's stays as it was.
    const b = add(C.recruiterB, body({ role_id: R.b }), two.tables, { key: k });
    runs.push(b);
    expect.soft(statusOf(b), `B with the same key: 201, its own (${describe(b)})`).toBe(201);
    expect.soft(bodyOf(b)?.candidateId, 'a different candidate').not.toBe(bodyOf(one)?.candidateId);
    expect.soft(JSON.stringify(bodyOf(b)), 'B\'s answer names nothing of A\'s').not.toMatch(new RegExp(`${bodyOf(one)?.candidateId}|Fleet controller`));
    const bRow = newSagas(two.tables, b)[0] ?? {};
    expect.soft(bRow['tenant_id'], 'B\'s row is B\'s').toBe(B);
    expect.soft(changedRows(two.tables, b.tables).filter((x) => x['table'] === TABLE.state && String(x['PK'] ?? '').includes(String(bodyOf(one)?.candidateId))).length, 'A\'s candidate is untouched').toBe(0);
    // And A, sending the key again after B used it, still gets A's own answer.
    const aAgain = add(C.recruiter, body(), b.tables, { key: k });
    runs.push(aAgain);
    expect.soft(answer(aAgain), 'A again: its own answer').toEqual([200, bodyOf(one)]);
    // The body key, for older callers, when there is no header (Q-10).
    const bk = newKey();
    const viaBody = add(C.recruiter, body({ idempotencyKey: bk, email: 'bodykey@example.test' }), t, { key: null });
    const viaBody2 = add(C.recruiter, body({ idempotencyKey: bk, email: 'bodykey@example.test' }), viaBody.tables, { key: null });
    runs.push(viaBody, viaBody2);
    expect.soft(statusOf(viaBody), `the body key: 201 (${describe(viaBody)})`).toBe(201);
    expect.soft(answer(viaBody2), 'the body key again: 200, the same answer').toEqual([200, bodyOf(viaBody)]);
    expect.soft(newSagas(t, viaBody2).length, 'one candidate').toBe(1);
    // Header and body both: the header is the key (D-T-B6).
    const hk = newKey();
    const both = add(C.recruiter, body({ idempotencyKey: newKey(), email: 'both@example.test' }), t, { key: hk });
    const both2 = add(C.recruiter, body({ idempotencyKey: newKey(), email: 'both@example.test' }), both.tables, { key: hk });
    runs.push(both, both2);
    expect.soft(answer(both2), 'the same header with another body key: the first answer').toEqual([200, bodyOf(both)]);
    // No key anywhere: 400, nothing written.
    for (const [label, o, b2] of [['no header, no body key', { key: null }, body()], ['an empty header', { key: '' }, body()], ['an empty body key', { key: null }, body({ idempotencyKey: '' })]] as [string, AddOpts, unknown][]) {
      const r = add(C.recruiter, b2, t, o);
      runs.push(r);
      expect.soft(answer(r), `${label}: 400 IDEMPOTENCY_KEY_REQUIRED (D-T-B1)`).toEqual([400, code400('IDEMPOTENCY_KEY_REQUIRED')]);
      refusedClean(label, t, r);
    }
    fits('AC-9', ...runs);
  });

  test('AC-9 A replay answers the first answer even after the role closed; a key held by a running request is 409 and writes nothing; a refused key is free again', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    const k = newKey();
    const one = add(C.recruiter, body({ role_id: R.accountant, email: 'acc@example.test' }), t, { key: k });
    expect(statusOf(one), `201 (${describe(one)})`).toBe(201);
    // The role is closed between the two requests (its candidate was moved on). The retry still gets the first answer (D-T-B7).
    const closedNow = withRole(one.tables, A, R.accountant, { status: 'CLOSED' });
    const replay = add(C.recruiter, body({ role_id: R.accountant, email: 'acc@example.test' }), closedNow, { key: k });
    expect.soft(answer(replay), 'the replay after the close: 200 and the first answer').toEqual([200, bodyOf(one)]);
    expect.soft(newSagas(closedNow, replay).length, 'no second candidate').toBe(0);
    // A key a running request holds (D-T-B8).
    const held = newKey();
    const ht = structuredClone(t);
    ht[TABLE.idempotency] = [...(ht[TABLE.idempotency] ?? []), { idempotencyKey: { S: `TENANT#${A}#${held}` }, status: { S: 'IN_PROGRESS' }, ttl: { N: String(Math.floor(Date.parse(NOW) / 1000) + 3600) }, createdAt: { S: NOW } }];
    const busy = add(C.recruiter, body(), ht, { key: held });
    // The key's stored form is the company helper's (tenantKey); if the build stores it another way this seeded row is not found, so check
    // the stored form first, from a real add.
    const real = rowsOf(one.tables, TABLE.idempotency).map((x) => String(x['idempotencyKey'])).find((x) => x.endsWith(k));
    expect.soft(real, 'the key is stored as TENANT#<company>#<key> (the company helper)').toBe(`TENANT#${A}#${k}`);
    expect.soft(statusOf(busy), `a key held IN_PROGRESS: 409 (${describe(busy)})`).toBe(409);
    expect.soft(newSagas(ht, busy).length + eventsOf(busy).length, 'no candidate, no event').toBe(0);
    fits('AC-9 replay', one, replay, busy);
  });

  // ---------------------------------------------------------------- AC-16 (the add half)

  test('AC-16 The add is written once in api/openapi.yaml: NewCandidate and NewCandidateAnswer closed, every answer described; the validator fails a planted answer', async ({}, testInfo) => {
    once(testInfo.project.name);
    const d = doc();
    const op = operation(d, ROUTE);
    expect(op, 'POST /v1/candidates is in the file').toBeTruthy();
    const reqSchema = op?.requestBody?.content?.['application/json']?.schema;
    expect.soft(refName(reqSchema), 'its body is NewCandidate').toBe('NewCandidate');
    const nc = d.components?.schemas?.['NewCandidate'];
    expect.soft(Object.keys(nc?.properties ?? {}).sort(), 'NewCandidate has exactly the rule 19 fields and the old body key').toEqual(['email', 'first_name', 'idempotencyKey', 'last_name', 'phone', 'role_id', 'source']);
    expect.soft([...(nc?.required ?? [])].sort(), 'first_name, last_name, email and role_id are required').toEqual(['email', 'first_name', 'last_name', 'role_id']);
    expect.soft(nc?.additionalProperties, 'NewCandidate is closed').toBe(false);
    expect.soft([nc?.properties?.first_name?.maxLength, nc?.properties?.last_name?.maxLength, nc?.properties?.email?.maxLength, nc?.properties?.phone?.maxLength, nc?.properties?.source?.maxLength], 'the lengths of rule 19').toEqual([80, 80, 254, 30, 80]);
    for (const s of [201, 200]) expect.soft(refName(answerSchema(d, ROUTE, s)), `its ${s} is NewCandidateAnswer`).toBe('NewCandidateAnswer');
    expect.soft(looseObjects(d, { $ref: '#/components/schemas/NewCandidateAnswer' }, 'NewCandidateAnswer', new Set(), ['source', 'personId']), 'every object closed and every field required (but source and not_hired_pending.awaiting.personId: child lock rec-15b.4)').toEqual([]);
    const ans = d.components?.schemas?.['NewCandidateAnswer'];
    expect.soft(Object.keys(ans?.properties ?? {}).sort(), 'NewCandidateAnswer has candidateId and candidate, no notice (REC-08 adds it)').toEqual(['candidate', 'candidateId']);
    expect.soft(ans?.properties?.candidate?.$ref, 'candidate is a CandidateRow').toBe('#/components/schemas/CandidateRow');
    for (const s of [400, 403, 404, 409, 500]) expect.soft(!!answerSchema(d, ROUTE, s), `the ${s} answer is described`).toBe(true);
    const header = ((op?.parameters ?? []) as any[]).find((p) => p.in === 'header' && String(p.name).toLowerCase() === 'idempotency-key');
    expect.soft(!!header, 'the Idempotency-Key header is described').toBe(true);
    const ck = checker(d);
    const row = { id: 'c', name: 'A B', stage: 'APPLIED', stage_entered_at: NOW, due_at: NOW, sla_status: 'ON_TRACK', role_id: 'r', role_title: 'T', level: 'MID', applied_at: NOW, hiring_manager_id: 'h', mine: true, not_hired_pending: null }; // not_hired_pending: child lock rec-15b.4
    const good = { candidateId: 'c', candidate: row };
    const ok = answerSchema(d, ROUTE, 201);
    expect.soft(ck.check(ok, good), 'a right answer passes').toEqual([]);
    expect.soft(ck.check(ok, { candidateId: 'c' }).length > 0, 'the old answer (candidateId only) fails').toBe(true);
    expect.soft(ck.check(ok, { ...good, notice: { status: 'SENT' } }).length > 0, 'an answer with notice fails').toBe(true);
    expect.soft(ck.check(ok, { ...good, message: 'Duplicate request' }).length > 0, 'the old replay message fails').toBe(true);
    expect.soft(ck.check(ok, { ...good, candidate: { ...row, email: 'x@y.z' } }).length > 0, 'a candidate with an email fails').toBe(true);
    expect.soft(ck.check(refName(reqSchema) ? reqSchema : {}, { ...GOOD, positionTitle: 'X' }).length > 0, 'a body with positionTitle fails NewCandidate').toBe(true);
    expect.soft(ck.check(reqSchema, GOOD), 'the good body passes NewCandidate').toEqual([]);
    expect.soft(ck.check(answerSchema(d, ROUTE, 400), { ...invalid('email'), extra: 1 }).length > 0, 'a 400 with an extra key fails').toBe(true);
    // The generated types carry the new schemas (npm run api:types; the file is committed).
    const types = readFileSync(join(REPO, 'pepla-web', 'src', 'app', 'core', 'api', 'openapi.d.ts'), 'utf8');
    for (const n of ['NewCandidate', 'NewCandidateAnswer']) expect.soft(new RegExp(`\\b${n}:\\s*\\{`).test(types), `openapi.d.ts has ${n} (npm run api:types)`).toBe(true);
  });

  // ---------------------------------------------------------------- AC-17 (step B's lines)

  test('AC-17 Terraform for the add: createCandidate may read a role (one GetItem grant on talent-flow-roles, ROLES_TABLE_NAME), nothing else changes, no wildcard, no table item, the header is allowed', async ({}, testInfo) => {
    once(testInfo.project.name);
    const fn = lambdaNamed('createCandidate')[0];
    expect(fn, 'createCandidate is a Lambda in Terraform').toBeTruthy();
    const env = settingsOf(fn!.block);
    expect.soft(valueOf(fn!.stack, env.get('ROLES_TABLE_NAME')), 'createCandidate reads the roles table\'s name from ROLES_TABLE_NAME').toBe('talent-flow-roles');
    const role_ = roleResourceOf(fn!.block)!;
    const baseline = JSON.parse(readFileSync(join(__dirname, 'support', 'rec-15b', 'iam-7dcca4d', 'policies.json'), 'utf8')) as Record<string, { role: string; stack: string; pairs?: string[]; squash?: string }>;
    const byRole = (all: Record<string, { role: string; stack: string; pairs?: string[]; squash?: string }>) => {
      const out = new Map<string, Set<string>>();
      for (const p of Object.values(all)) {
        const k = `${p.stack}/${p.role}`;
        if (!out.has(k)) out.set(k, new Set());
        for (const l of p.pairs ?? [`squashed ${p.squash}`]) out.get(k)!.add(l);
      }
      return out;
    };
    const [was, is] = [byRole(baseline), byRole(policyLines())];
    const roleRead = /^Allow dynamodb:GetItem \S*(talent-flow-roles|\$\{local\.tf_table_roles\}) null$/;
    expect.soft(is.has(`${fn!.stack}/${role_}`), 'createCandidate\'s role is found').toBe(true);
    for (const [k, lines] of is) {
      if (k === REC16_ROLE_KEY) continue; // REC-16 (child lock rec-16.1): its own role, judged in rec-16.spec.ts AC-10.
      const gained = [...lines].filter((l) => !(was.get(k) ?? new Set()).has(l));
      const lost = [...(was.get(k) ?? new Set())].filter((l) => !lines.has(l));
      if (k === `${fn!.stack}/${role_}`) {
        expect.soft(gained.filter((l) => !roleRead.test(l)), 'createCandidate gains only GetItem on the roles table (D-T-B11)').toEqual([]);
        expect.soft(gained.filter((l) => roleRead.test(l)).length, 'that line, once').toBe(1);
        expect.soft(lost, 'createCandidate loses nothing').toEqual([]);
      } else {
        expect.soft(gained.filter((l) => !isRec07Grant(l, k) && !isRec05Grant(l, k) && !isRec15cGrant(l, k) && !isRec15dGrant(l, k) && !isInt01Grant(l, k) && !isRec062Grant(l, k)), `${k}: no new grant`).toEqual([]); // && isRec15dGrant: child lock rec-15d.1; // && isRec05Grant: child lock rec-05.1; && isRec15cGrant: // child lock rec-15c.1
      }
    }
    for (const k of was.keys()) expect.soft(is.has(k), `${k}: still there`).toBe(true);
    const mine = [...(is.get(`${fn!.stack}/${role_}`) ?? [])];
    for (const l of mine) if (!/ xray:/.test(l)) expect.soft(l.split(' ')[2], `${l}: no wildcard`).not.toMatch(/^\*$|table\/\*|index\/\*/);
    expect.soft(mine.some((l) => /^Allow (local\.tf_kms_actions|kms:Decrypt) aws_kms_key\.talent_flow_state\.arn null$/.test(l)), 'it keeps the state key').toBe(true);
    const rolesTable = resourcesOf('talent-flow-infra', 'aws_dynamodb_table').find((b) => /name\s*=\s*local\.tf_table_roles/.test(b.body));
    expect.soft(/kms_key_arn\s*=\s*aws_kms_key\.talent_flow_state\.arn/.test(rolesTable?.body ?? ''), 'the roles table is encrypted with the state key createCandidate holds').toBe(true);
    const kmsNow = kmsList('dynamodb_read_role_arns') + kmsList('allowed_role_arns');
    expect.soft(/create_candidate/.test(kmsNow), 'no PII key line for createCandidate').toBe(false);
    for (const stack of ['infra', 'talent-flow-infra'] as const) expect.soft(resourcesOf(stack, 'aws_dynamodb_table_item').length, `${stack}: no table item`).toBe(0);
    // The header the app sends is allowed by the TalentFlow API (rule 21).
    const api = blocks(filesOf('talent-flow-infra'), 'resource').find((b) => b.labels[0] === 'aws_apigatewayv2_api' && b.labels[1] === 'talent_flow_api');
    const cors = squash(/cors_configuration\s*\{([\s\S]*?)\n\s*\}/.exec(api?.body ?? '')?.[1] ?? '');
    expect.soft((/allow_headers=\[([^\]]*)\]/.exec(cors)?.[1] ?? '').toLowerCase(), 'the TalentFlow API allows the idempotency-key header').toMatch(/"idempotency-key"/);
    expect.soft(blocks([join(REPO, 'talent-flow-infra', 'talent-flow-apigateway.tf')], 'resource').some((b) => b.labels[0] === 'aws_apigatewayv2_route' && /"POST \/v1\/candidates"/.test(b.body) && /aws_apigatewayv2_integration\.create_candidate\.id/.test(b.body)), 'the route stays on createCandidate').toBe(true);
  });
});

// ---------------------------------------------------------------- child lock rec-15b.4 (REC-UI-01.6, NH-291, AC-14, spec check round 2 N-1)
// POST /v1/candidates answers NewCandidateAnswer.candidate, which is a CandidateRow: it gains not_hired_pending, null (a new candidate never
// has a waiting Not hired decision), and still equals the row the list then gives (D-T-B5).
test.describe('REC-UI-01.6 AC-14 · The add answer carries not_hired_pending null (child lock rec-15b.4)', () => {
  test('AC-14 The new candidate in the add answer carries not_hired_pending null, has exactly the CandidateRow fields and equals the list row; a replay answers the same', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    const key = newKey();
    const r = add(C.recruiter, body(), t, { key });
    expect(statusOf(r), `201 (${describe(r)})`).toBe(201);
    const a = bodyOf(r);
    expect.soft('not_hired_pending' in (a?.candidate ?? {}), 'the field is present').toBe(true);
    expect.soft(a?.candidate?.not_hired_pending, 'and null').toBeNull();
    expect.soft(Object.keys(a?.candidate ?? {}).sort(), 'exactly the CandidateRow fields (no source sent)').toEqual(sorted(ROW_KEYS));
    const listed = rowsIn(list(C.recruiter, {}, r.tables)).find((x) => x?.id === a?.candidateId);
    expect.soft(a?.candidate, 'the answer\'s candidate equals the list row').toEqual(listed);
    const again = add(C.recruiter, body(), r.tables, { key });
    expect.soft([statusOf(again), bodyOf(again)], 'the replay answers the first answer, the field with it').toEqual([200, a]);
    fits('AC-14 add', r, again);
  });
});
