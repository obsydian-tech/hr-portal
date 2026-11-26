import { createHash } from 'node:crypto';
import { httpEvent, type Row, type Run, type Tables } from '../rec-14/lambda-harness';
import { authorizerOf, av, fileOf, plain, saga, type Caller } from '../rec-02/world';
import { A, B, C, K, NAME as NAME05, NOW, R, SUB as SUB05, TABLE, UPLOAD_BUCKET, at, env as env05, poolUsers, world as world05 } from '../rec-05/world';
import { runHandler, type Extra } from './lambda-harness';

/**
 * REC-06: the world of the conversion card (spec onboarding-cards/specs/REC-06.md, rules 1 to 10, AC-1 to AC-10). It is REC-05's
 * world (support/rec-05/world.ts: companies A, B and D, the Standard pack for A and B, roles, departments, people, the sign-in pool)
 * with what this card adds: the `employees` table (email-index as Terraform declares it) holding a few people of A and of B, this
 * card's candidates in Offer, and two Recruiters known only by an old TalentFlow HR group name (no hr_staff). Every call runs the real
 * handler in a fresh Node process against ./fake-aws at a fixed time (REC-15's clock, through REC-05's settings). All names are made up.
 *
 *   Company A  candidates in Offer on role RA (Fleet controller, department Operations by id): `main` with a phone, p[0..19] with
 *              phones, `noPhone`, `noRole` (its role row does not exist), `roleText` (a role with department text and no id),
 *              `oldStage` (stored stage OFFER_DELIVERY, an old name that reads as Offer), `rehire` and `capsStored` (whose email is
 *              an employee of A's), `sharedB` (whose email is only an employee of B's).
 *   Company B  candidate `bMain` in Offer on role RB.
 *   Employees  A: `rehire.person@example.test` and `old.hand@example.test`. B: `shared.person@example.test` and the same address
 *              as A's rehire.
 */
export { A, B, C, K, NOW, R, TABLE, UPLOAD_BUCKET, at, plain, poolUsers };
export type { Caller, Row, Run, Tables };

export const EMPLOYEES = 'employees';
/** REC-06 rule 3 (D-T-6.1): employee_id is the version 5 UUID of "<tenant_id>:<offer_id>" in this namespace. */
export const EMPLOYEE_ID_NAMESPACE = '6b7dcfde-d603-4673-9949-d5d39ac59e17';
/** The version 5 UUID (RFC 4122, SHA-1) of `name` in `namespace`, computed here, never with the build's own function (L-3). */
export function uuidV5(namespace: string, name: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const h = createHash('sha1').update(ns).update(Buffer.from(name, 'utf8')).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x50;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const x = b.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
export const employeeIdOf = (tenant: string, offerId: string) => uuidV5(EMPLOYEE_ID_NAMESPACE, `${tenant}:${offerId}`);
export const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ---------------------------------------------------------------- people

export const SUB = { ...SUB05, oldHr: 'sub-rec06-old-hr', oldHrDir: 'sub-rec06-old-hr-director', staffA: 'sub-rec06-staff' };
export const NAME: Record<string, [string, string]> = { ...NAME05, [SUB.oldHr]: ['Sibusiso', 'Ntuli'], [SUB.oldHrDir]: ['Nandi', 'Khoza'], [SUB.staffA]: ['Precious', 'Mabuza'] };
const p = (name: string, groups: string[], sub: string, claims: Record<string, unknown> = {}): Caller =>
  ({ name, groups, sub, claims: { given_name: NAME[sub]![0], family_name: NAME[sub]![1], ...claims } });
export const P = {
  /** A Recruiter only through the old TalentFlow HR group name (perm-recruitment, no role, no hr_staff): D-REC-1.3, L-1. */
  oldHr: p('Recruiter by the old HR group name naleko-talentflow-hr (no hr_staff)', ['naleko-talentflow-hr'], SUB.oldHr),
  oldHrDir: p('Recruiter by the old HR group name HRDirector (no hr_staff)', ['HRDirector'], SUB.oldHrDir),
  /** An HR Recruiter whose sign-in carries a staff number (custom:staff_id): created_by and hr_staff_id use it (rule 4). */
  staffA: p('HR Recruiter with a staff number (staffA)', ['hr_staff', 'perm-recruitment'], SUB.staffA, { 'custom:staff_id': 'STAFF-0042' }),
} satisfies Record<string, Caller>;
export const fullName = (sub: string) => NAME[sub]!.join(' ');
/** The email claim every test sign-in carries (support/rec-02/world.ts authorizerOf). */
export const emailOf = (c: Caller) => `${c.sub}@example.test`;

// ---------------------------------------------------------------- rows

const cand = (company: 'A' | 'B', tag: string, n: number) => `CAND-REC06${company}${tag}${String(n).padStart(18, '0')}`;
export const KC = {
  main: cand('A', 'MN', 1), p: Array.from({ length: 20 }, (_, i) => cand('A', 'PL', i + 1)), noPhone: cand('A', 'NP', 1), noRole: cand('A', 'NR', 1),
  roleText: cand('A', 'RT', 1), oldStage: cand('A', 'OS', 1), rehire: cand('A', 'RH', 1), capsStored: cand('A', 'CS', 1), sharedB: cand('A', 'SB', 1),
  bMain: cand('B', 'MN', 1),
  /** Roles: one with department text and no id; one that does not exist. */
  roleDispatch: 'role-rec06-dispatch', roleGone: 'role-rec06-gone',
};
export const PHONE = '+27 82 555 0101';
export const EMAIL = {
  main: 'thandeka.mahlaba@example.test', rehire: 'rehire.person@example.test', capsStored: '  Rehire.Person@Example.TEST ', sharedB: 'shared.person@example.test',
  oldHand: 'old.hand@example.test', bMain: 'bheki.zondo@example.test',
};
type Spec = { id: string; first: string; last: string; company: string; hm: string; role: string; title: string; extra?: Record<string, any> };
const SPECS: Spec[] = [
  { id: KC.main, first: 'Thandeka', last: 'Mahlaba', company: A, hm: SUB.hmA, role: K.ra, title: 'Driver trainee', extra: { email: EMAIL.main, phone: PHONE, department: 'Transport yard' } },
  ...KC.p.map((id, i) => ({ id, first: `Plain${i + 1}`, last: 'Candidate', company: A, hm: SUB.hmA, role: K.ra, title: 'Driver trainee', extra: { phone: `+27 82 555 ${String(200 + i).padStart(4, '0')}` } })),
  { id: KC.noPhone, first: 'Nophone', last: 'Person', company: A, hm: SUB.hmA, role: K.ra, title: 'Driver trainee' },
  { id: KC.noRole, first: 'Norole', last: 'Person', company: A, hm: SUB.hmA, role: KC.roleGone, title: 'Night baker', extra: { phone: PHONE, department: 'Bakery floor' } },
  { id: KC.roleText, first: 'Roletext', last: 'Person', company: A, hm: SUB.hmA, role: KC.roleDispatch, title: 'Dispatch trainee', extra: { phone: PHONE, department: 'Old dispatch' } },
  { id: KC.oldStage, first: 'Oldstage', last: 'Person', company: A, hm: SUB.hmA, role: K.ra, title: 'Driver trainee', extra: { phone: PHONE, currentStage: 'OFFER_DELIVERY' } },
  { id: KC.rehire, first: 'Rehire', last: 'Person', company: A, hm: SUB.hmA, role: K.ra, title: 'Driver trainee', extra: { email: EMAIL.rehire, phone: PHONE } },
  { id: KC.capsStored, first: 'Capsstored', last: 'Person', company: A, hm: SUB.hmA, role: K.ra, title: 'Driver trainee', extra: { email: EMAIL.capsStored, phone: PHONE } },
  { id: KC.sharedB, first: 'Shared', last: 'Person', company: A, hm: SUB.hmA, role: K.ra, title: 'Driver trainee', extra: { email: EMAIL.sharedB, phone: PHONE } },
  { id: KC.bMain, first: 'Bheki', last: 'Zondo', company: B, hm: SUB.hmB, role: K.rb, title: 'Driver trainee', extra: { email: EMAIL.bMain, phone: PHONE } },
];
export const candidateSpec = (id: string) => SPECS.find((s) => s.id === id)!;

/** An employee row as createEmployee stores one (the fields REC-06's check reads are employee_id, email and tenant_id). */
export function employee(id: string, first: string, last: string, email: string, company: string): Row {
  return av({
    employee_id: id, first_name: first, middle_name: '', last_name: last, email, phone: '+27 11 555 0000', department: 'Operations', job_title: 'Clerk',
    stage: 'VERIFIED', offer_accept_date: '2025-01-10', planned_start_date: '2025-02-01', created_at: '2025-01-10T08:00:00.000Z', created_by: 'sub-old-hr',
    hr_staff_id: 'sub-old-hr', hr_staff_name: '', hr_staff_email: '', tenant_id: company,
  });
}
export const EMP = {
  rehireA: '0b9f2a10-0000-4000-8000-00000000a001', oldHandA: '0b9f2a10-0000-4000-8000-00000000a002',
  sharedB: '0b9f2a10-0000-4000-8000-00000000b001', rehireB: '0b9f2a10-0000-4000-8000-00000000b002',
};

let base: Tables | undefined;
/** REC-05's world plus this card's rows. Each call hands back its own copy. */
export function world(): Tables {
  if (!base) {
    const w = world05();
    w[TABLE.state] = [
      ...(w[TABLE.state] ?? []),
      ...SPECS.map((s) => saga(s.id, s.first, s.last, s.company, s.hm, { role_id: s.role, positionTitle: s.title, positionLevel: 'MID', currentStage: 'OFFER', stageEnteredAt: '2026-11-20T08:00:00.000Z', ...(s.extra ?? {}) })),
    ];
    w[TABLE.roles] = [
      ...(w[TABLE.roles] ?? []),
      av({
        pk: `TENANT#${A}`, sk: `ROLE#${KC.roleDispatch}`, tenant_id: A, role_id: KC.roleDispatch, job_title: 'Dispatch clerk', department: 'Dispatch', level: 'MID',
        hiring_manager_id: SUB.hmA, criteria: [{ key: 'driving', label: 'Driving' }], panel_size: 2, status: 'OPEN', opened_at: '2026-11-01T08:00:00.000Z', opened_by: SUB.recA, legacy: false,
      }),
    ];
    w[EMPLOYEES] = [
      employee(EMP.rehireA, 'Rehire', 'Person', EMAIL.rehire, A),
      employee(EMP.oldHandA, 'Old', 'Hand', EMAIL.oldHand, A),
      employee(EMP.sharedB, 'Shared', 'Person', EMAIL.sharedB, B),
      employee(EMP.rehireB, 'Rehire', 'Person', EMAIL.rehire, B),
    ];
    base = w;
  }
  return structuredClone(base);
}

// ---------------------------------------------------------------- runs

export type Opts = { now?: string; headers?: Record<string, string>; query?: Record<string, string>; extra?: Extra; env?: Record<string, string> };
/** Every run's settings: REC-05's, plus the employees table under the names a builder may read (the code may also use the literal). */
export const env = (now = NOW, extra: Record<string, string> = {}) => env05(now, { EMPLOYEES_TABLE: EMPLOYEES, EMPLOYEES_TABLE_NAME: EMPLOYEES, ...extra });
const extraOf = (o: Opts): Extra => ({ cognito: { users: poolUsers() }, ...(o.extra ?? {}) });

/** A signed-in caller on one route (`METHOD /path/{id}`) of one handler. */
export function call(handler: string, routeKey: string, who: Caller, a: { id?: string; body?: unknown }, t: Tables, o: Opts = {}): Run {
  const [method, route] = routeKey.split(' ') as [string, string];
  const path = a.id === undefined ? undefined : { id: a.id };
  const event = httpEvent({ authorizer: authorizerOf(who), path, query: o.query, body: a.body, headers: o.headers });
  const raw = route.replace('{id}', encodeURIComponent(a.id ?? ''));
  event.routeKey = routeKey;
  event.rawPath = raw;
  event.requestContext.routeKey = routeKey;
  event.requestContext.http.method = method;
  event.requestContext.http.path = raw;
  return runHandler(fileOf(handler), event, t, env(o.now, o.env), extraOf(o));
}
export const OFFERS = 'manageOffers';
export const act = (route: string, who: Caller, id: string, body: unknown, t: Tables, o: Opts = {}) => call(OFFERS, route, who, { id, body }, t, o);
export const getOffer = (who: Caller, id: string, t: Tables, o: Opts = {}) => call(OFFERS, R.get, who, { id }, t, o);
export const listOffers = (who: Caller, t: Tables, o: Opts = {}) => call(OFFERS, R.list, who, {}, t, o);

// ---------------------------------------------------------------- reading the result

export const bodyOf = (r: { response: any }) => {
  try { return JSON.parse(r.response?.body ?? 'null'); } catch { return r.response?.body; }
};
export const statusOf = (r: Run) => r.response?.statusCode as number | undefined;
export const answer = (r: Run) => [statusOf(r), bodyOf(r)];
export const describe = (r: Run) => `${statusOf(r)} ${JSON.stringify(bodyOf(r)).slice(0, 400)}${r.error ? ` (threw ${r.error.name}: ${r.error.message.slice(0, 300)})` : ''}`;
export const ok = (r: Run) => [200, 201].includes(statusOf(r) ?? 0);
export const rowsOf = (t: Tables, table: string = TABLE.state) => (t[table] ?? []).map(plain);
export const sagaOf = (t: Tables, id: string) => rowsOf(t).find((r) => r['PK'] === `CANDIDATE#${id}` && r['SK'] === 'SAGA') ?? {};
export const offerRow = (t: Tables, offerId: string) => rowsOf(t).find((r) => r['PK'] === `OFFER#${offerId}` && r['SK'] === 'OFFER');
export const historyOf = (t: Tables, id: string) => rowsOf(t).filter((r) => r['PK'] === `CANDIDATE#${id}` && String(r['SK']).startsWith('STAGE#'));
export const employeesOf = (t: Tables) => rowsOf(t, EMPLOYEES);
export const employeeById = (t: Tables, id: string) => employeesOf(t).filter((r) => r['employee_id'] === id);
export const awsOf = (r: { calls: any[] }) => r.calls.filter((c: any) => c.service !== 'log' && c.service !== 'step');
export const writesOf = (r: { calls: any[] }) => r.calls.filter((c: any) => (c.service === 'dynamodb' && /PutItem|UpdateItem|DeleteItem|BatchWriteItem|TransactWriteItems/.test(c.op)) || (/^(events|eventbridge|sqs|sns|lambda|sfn|ses|s3|postmark|http)$/i.test(c.service) && !/^(Get|List|Head|presign)/.test(c.op ?? '')) || (c.service === 'cognito' && !/^(Get|List|Admin(Get|List))/.test(c.op ?? '')));
export const eventsOf = (r: { calls: any[] }, type?: string) => r.calls.filter((c: any) => c.service === 'events' && (!type || c.detailType === type));
export const logsOf = (r: Run) => r.calls.filter((c: any) => c.service === 'log').map((c: any) => `${c.message}${c.extra === undefined ? '' : ' ' + JSON.stringify(c.extra)}`);
/** The rows of every table that are new or changed against `before`, and the tables that lost a row. */
export function changed(before: Tables, after: Tables): string[] {
  const out: string[] = [];
  for (const [name, rows] of Object.entries(after)) {
    const was = new Set((before[name] ?? []).map((r) => JSON.stringify(r)));
    for (const r of rows) if (!was.has(JSON.stringify(r))) { const x = plain(r); out.push(`${name} ${x['PK'] ?? x['pk'] ?? x['employee_id'] ?? x['idempotencyKey'] ?? ''} ${x['SK'] ?? x['sk'] ?? ''}`); }
  }
  for (const [name, rows] of Object.entries(before)) if ((after[name] ?? []).length < rows.length) out.push(`${name}: a row was removed`);
  return out;
}
/** Every key name in a value, at every depth. */
export function keysDeep(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); keysDeep(x, out); }
  return out;
}

// ---------------------------------------------------------------- offers built through REC-05's routes

export const START = '2027-01-04';
export const CONFIRMED = '2027-01-11';
const EXPIRY = '2026-12-10';
const SALARY = 487250.75;
export const SALARY_TEXT = ['487250.75', '487250', '487 250', '487,250'];
const PDF = { file_name: 'Signed offer.pdf', content_type: 'application/pdf', file_size: 245_760 };
export type Sent = { t: Tables; id: string; candidate: string; key: string; s3: { bucket: string; objects: Record<string, { size: number; contentType: string }> } };

/** Takes `candidate`'s offer to SENT through REC-05's routes (draft, submit, approve, send) and uploads a signed copy, from second n0. */
export function sentOffer(t0: Tables, candidate: string, n0: number): Sent {
  const company = candidateSpec(candidate)?.company ?? A;
  const drafter = company === B ? C.recB : C.recA;
  const approver = company === B ? C.apprB : C.apprA;
  const must = (what: string, r: Run) => {
    if (!ok(r)) throw new Error(`building ${candidate}'s offer: ${what} failed (${describe(r)})`);
    return r;
  };
  let r = must('draft', call(OFFERS, R.create, drafter, { body: { candidate_id: candidate, salary: SALARY, start_date: START, expiry_date: EXPIRY } }, t0, { now: at(n0) }));
  const id = bodyOf(r).offer_id as string;
  r = must('submit', act(R.submit, drafter, id, {}, r.tables, { now: at(n0 + 1) }));
  r = must('approve', act(R.approve, approver, id, { version: bodyOf(r).version }, r.tables, { now: at(n0 + 2) }));
  r = must('send', act(R.send, drafter, id, {}, r.tables, { now: at(n0 + 3) }));
  const up = must('signed upload', act(R.upload, drafter, id, PDF, r.tables, { now: at(n0 + 4) }));
  const key = bodyOf(up).signed_key as string;
  return { t: up.tables, id, candidate, key, s3: { bucket: UPLOAD_BUCKET, objects: { [key]: { size: PDF.file_size, contentType: PDF.content_type } } } };
}
/** POST /v1/offers/{id}/answer with ACCEPTED, the signed copy and the confirmed start date (rule 5). */
export const acceptBody = (s: Sent, extra: Record<string, unknown> = {}) => ({ answer: 'ACCEPTED', signed_key: s.key, confirmed_start_date: CONFIRMED, ...extra });
export function accept(who: Caller, s: Sent, t: Tables, n: number, o: Opts = {}): Run {
  return act(R.answer, who, s.id, acceptBody(s), t, { now: at(n), ...o, extra: { s3: s.s3, ...(o.extra ?? {}) } });
}
