import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { httpEvent, type PoolUser, type Row, type Run, type Tables } from '../rec-14/lambda-harness';
import { A, B, D, SUB as SUB02, TABLE as TABLE02, TENANTS, authorizerOf, av, fileOf, packTables, plain, saga, settings, type Caller } from '../rec-02/world';
import { REPO, runHandler, runScript, type Extra, type S3World } from './lambda-harness';

/**
 * REC-05: the world of the offer card (spec onboarding-cards/specs/REC-05.md, rules 1 to 17). It runs the real handlers in a fresh Node
 * process each call against this card's fake AWS (./fake-aws), over REC-02's company rows (A founding, B with Recruitment on, D with
 * Recruitment off) with the real Standard pack run for A and for B, and this card's roles, departments, candidates, people and old
 * offer rows. Every run happens at a fixed time through REC-15's clock preload (support/rec-15/clock.mjs): NOW unless a call names
 * another. All names are made up.
 *
 *   Company A  role RA "Fleet controller" (department Operations by id; the role's stored department text is an older name), hiring
 *              manager hmA. Candidates in Offer: a1 .. a24 (one per test that needs a fresh offer). Candidates in Applied, Hired and Not
 *              hired. Old offer rows (today's shape, PK CANDIDATE#<id> SK OFFER) on l1 .. l5 in OFFER_CREATED, IN_APPROVAL, OFFER_SENT,
 *              ACCEPTED and REJECTED.
 *   Company B  role RB "Driver", hiring manager hmB, candidates b1 .. b3 in Offer, one old offer row (IN_APPROVAL) on lb.
 *   People     A: the Recruiter who drafts (recA), a second Recruiter (rec2A), an approver with the approver tick only (apprA), a person
 *              with both ticks and the Admin role (bothA), the hiring manager (hmA), a manager of another role (hm2A), Admin only,
 *              Employee, Guest, HR without the Recruitment tick. B: a Recruiter (recB), an approver (apprB). D: a Recruiter. One
 *              Recruiter with no company. The sign-in pool holds every person with the approver tick, each with a Member row.
 */
export { A, B, D, av, plain };
export type { Caller, Row, Run, Tables };

export const NOW = '2026-11-25T08:00:00.000Z';
const CLOCK = join(__dirname, '..', 'rec-15', 'clock.mjs');
export const SEC = 1000;
export const DAY = 86_400_000;
/** NOW plus n seconds, as an ISO time (each step of a test runs at its own time, so created_at orders the offers). */
export const at = (n: number) => new Date(Date.parse(NOW) + n * SEC).toISOString();

export const TABLE = { ...TABLE02, roles: 'talent-flow-roles', tenants: TENANTS };
export const UPLOAD_BUCKET = 'rec05-uploads';
export const POOL = 'af-south-1_Rec01Fake';

export const SUB = {
  ...SUB02,
  rec2A: 'sub-rec05-rec2', apprA: 'sub-rec05-appr', bothA: 'sub-rec05-both', adminA: 'sub-rec05-admin', empA: 'sub-rec05-emp', guestA: 'sub-rec05-guest',
  hrNoTickA: 'sub-rec05-hr-only', apprB: 'sub-rec05-appr-b', recD: 'sub-rec05-rec-d', none: 'sub-rec05-none',
};
/** Each person's name as the sign-in carries it (given_name, family_name). */
export const NAME: Record<string, [string, string]> = {
  [SUB.recA]: ['Naledi', 'Khumalo'], [SUB.rec2A]: ['Pieter', 'Botha'], [SUB.apprA]: ['Thabo', 'Molefe'], [SUB.bothA]: ['Zanele', 'Dube'],
  [SUB.hmA]: ['Sizwe', 'Ndlovu'], [SUB.hm2A]: ['Ruth', 'Pillay'], [SUB.adminA]: ['Anele', 'Mthembu'], [SUB.empA]: ['Kagiso', 'Sithole'],
  [SUB.guestA]: ['Lwazi', 'Cele'], [SUB.hrNoTickA]: ['Mpho', 'Radebe'], [SUB.recB]: ['Bongani', 'Zulu'], [SUB.apprB]: ['Lindiwe', 'Mahlangu'],
  [SUB.hmB]: ['Themba', 'Nkosi'], [SUB.recD]: ['Dineo', 'Moloi'], [SUB.none]: ['Neo', 'Masilela'],
};
export const fullName = (sub: string) => NAME[sub]!.join(' ');

const p = (name: string, groups: string[], sub: string, extra: Partial<Caller> = {}): Caller =>
  ({ name, groups, sub, ...extra, claims: { given_name: NAME[sub]![0], family_name: NAME[sub]![1], ...(extra.claims ?? {}) } });
export const C = {
  recA: p('Recruiter who drafts (recA)', ['hr_staff', 'perm-recruitment'], SUB.recA),
  rec2A: p('Second Recruiter (rec2A)', ['hr_staff', 'perm-recruitment'], SUB.rec2A),
  apprA: p('Approver, approver tick only (apprA)', ['perm-approve-offers'], SUB.apprA),
  bothA: p('Person with both ticks and Admin (bothA)', ['admin', 'hr_staff', 'perm-recruitment', 'perm-approve-offers'], SUB.bothA),
  hmA: p('Hiring manager of the candidate (hmA)', ['manager'], SUB.hmA),
  hm2A: p('Manager of another role (hm2A)', ['manager'], SUB.hm2A),
  adminA: p('Admin only', ['admin'], SUB.adminA),
  empA: p('Employee', ['employee'], SUB.empA),
  guestA: p('Guest', ['guest'], SUB.guestA),
  hrNoTickA: p('HR without the Recruitment tick', ['hr_staff'], SUB.hrNoTickA),
  recB: p('Recruiter of B (recB)', ['hr_staff', 'perm-recruitment'], SUB.recB, { company: 'B' }),
  apprB: p('Approver of B (apprB)', ['perm-approve-offers'], SUB.apprB, { company: 'B' }),
  recD: p('Recruiter of D (Recruitment off)', ['hr_staff', 'perm-recruitment'], SUB.recD, { company: 'D' }),
  recNone: p('Recruiter with no company', ['hr_staff', 'perm-recruitment'], SUB.none, { company: null }),
} satisfies Record<string, Caller>;
/** A caller exactly like `c` with only the person id of the sign-in changed (and nothing else). */
export const asPerson = (c: Caller, sub: string): Caller => ({ ...c, name: `${c.name} signed in as ${sub}`, sub });

// ---------------------------------------------------------------- rows

/** A candidate id of the ulid shape createCandidate writes (CAND- and 26 letters or digits). */
const cand = (company: 'A' | 'B', tag: string, n: number) => `CAND-REC05${company}${tag}${String(n).padStart(18, '0')}`;
export const K = {
  /** A's candidates in Offer, one per use. */
  a: Array.from({ length: 30 }, (_, i) => cand('A', 'OF', i + 1)),
  b: Array.from({ length: 4 }, (_, i) => cand('B', 'OF', i + 1)),
  applied: cand('A', 'AP', 1), hired: cand('A', 'HI', 1), notHired: cand('A', 'NH', 1), otherRole: cand('A', 'OR', 1),
  /** Old offer rows (today's shape) on these candidates. */
  l: Array.from({ length: 5 }, (_, i) => cand('A', 'LG', i + 1)),
  lb: cand('B', 'LG', 1),
  ra: 'role-rec05-fleet', ra2: 'role-rec05-stores', rb: 'role-rec05-driver',
  depOps: 'dep_01REC05A0000000000000000OP', depStores: 'dep_01REC05A0000000000000000ST', depB: 'dep_01REC05B0000000000000000DR',
};
/** The old states of l1 .. l5 and what rule 1 reads them as. */
export const LEGACY: [string, string][] = [['OFFER_CREATED', 'DRAFT'], ['IN_APPROVAL', 'DRAFT'], ['OFFER_SENT', 'SENT'], ['ACCEPTED', 'ACCEPTED'], ['REJECTED', 'WITHDRAWN']];
const FIRST = ['Ayanda', 'Busisiwe', 'Chris', 'Dumisani', 'Esther', 'Fikile', 'Gugu', 'Hlengiwe', 'Itumeleng', 'Jabu', 'Karabo', 'Lebo', 'Mandla', 'Nomsa', 'Oupa', 'Palesa', 'Refilwe', 'Sello', 'Tumi', 'Unathi', 'Vusi', 'Wandile', 'Xolani', 'Yandisa', 'Zodwa', 'Amahle', 'Bheki', 'Cebo', 'Duduzile', 'Enhle'];
const LAST = ['Mkhize', 'Shabalala', 'Naidoo', 'Mabaso', 'Hadebe', 'Ngcobo', 'Zwane', 'Khoza', 'Mokoena', 'Buthelezi', 'Mazibuko', 'Ntuli', 'Gumede', 'Majola', 'Vilakazi', 'Dlamini', 'Msimang', 'Nxumalo', 'Mthethwa', 'Cele', 'Ngubane', 'Zungu', 'Mdlalose', 'Shange', 'Sibiya', 'Mlambo', 'Hlongwane', 'Gama', 'Maseko', 'Kubheka'];
/** Each candidate's first and last name. */
export const CAND_NAME: Record<string, [string, string]> = Object.fromEntries([
  ...K.a.map((id, i) => [id, [FIRST[i]!, LAST[i]!]]), ...K.b.map((id, i) => [id, [FIRST[(i + 7) % 30]!, `${LAST[(i + 11) % 30]!}-B`]]),
  [K.applied, ['Ivy', 'Applied']], [K.hired, ['Harold', 'Hired']], [K.notHired, ['Nora', 'Nothired']], [K.otherRole, ['Olwethu', 'Stores']],
  ...K.l.map((id, i) => [id, [`Legacy${i + 1}`, 'Person']]), [K.lb, ['LegacyB', 'Person']],
]) as Record<string, [string, string]>;
export const candName = (id: string) => CAND_NAME[id]!.join(' ');
export const ROLE_TITLE = { ra: 'Fleet controller', ra2: 'Stores clerk', rb: 'Driver' };

function roleRow(c: string, id: string, title: string, hm: string, depId: string, depText: string): Row {
  return av({
    pk: `TENANT#${c}`, sk: `ROLE#${id}`, tenant_id: c, role_id: id, job_title: title, department_id: depId, department: depText, level: 'MID',
    hiring_manager_id: hm, criteria: [{ key: 'driving', label: 'Driving' }], panel_size: 2, status: 'OPEN', opened_at: '2026-11-01T08:00:00.000Z',
    opened_by: c === A ? SUB.recA : SUB.recB, legacy: false,
  });
}
function departmentsRow(c: string, deps: { id: string; name: string }[]): Row {
  return av({ pk: `TENANT#${c}`, sk: 'DEPARTMENTS', tenant_id: c, version: 3, departments: deps.map((d) => ({ ...d, status: 'ACTIVE' })), updated_at: '2026-11-20T08:00:00.000Z', updated_by: SUB.recA });
}
const inStage = (stage: string, role: string, title: string) => ({ role_id: role, positionTitle: title, positionLevel: 'MID', currentStage: stage, stageEnteredAt: '2026-11-20T08:00:00.000Z' });
/** An offer row as today's createOffer and advanceOfferState write it (PK CANDIDATE#<id>, SK OFFER), in an old state. */
export function legacyOffer(candidate: string, c: string, state: string, extra: Record<string, any> = {}): Row {
  return av({
    PK: `CANDIDATE#${candidate}`, SK: 'OFFER', offerId: `OFFER#${candidate}`, candidateId: candidate, tenant_id: c, tenantId: c, state, positionLevel: 'MID',
    role: null, department: null, location: null, approvalChain: [{ stepId: 'step-1', approverRole: 'HiringManager', status: 'PENDING' }], currentApprovalStep: 0,
    configVersion: '1', interactionLog: [], createdAt: '2026-11-15T08:00:00.000Z', updatedAt: '2026-11-16T08:00:00.000Z',
    ...(state === 'OFFER_CREATED' ? {} : { baseSalary: 312345.67, currency: 'ZAR', startDate: '2027-02-01', expiryDate: '2026-12-15', submittedAt: '2026-11-16T08:00:00.000Z' }),
    ...(state === 'OFFER_SENT' || state === 'ACCEPTED' ? { sentAt: '2026-11-17T08:00:00.000Z' } : {}),
    ...extra,
  });
}
/** The salary on the old rows (to look for it in answers). */
export const LEGACY_SALARY = 312345.67;

/** The sign-in pool: every person, with their groups and names (the approver check reads who holds the approver tick). */
export function poolUsers(): PoolUser[] {
  const all: [string, string[]][] = Object.values(C).map((c) => [c.sub!, c.groups as string[]]);
  return all.map(([sub, groups]) => ({
    username: `${sub}@example.test`, sub, enabled: true, status: 'CONFIRMED', groups,
    attributes: { sub, email: `${sub}@example.test`, email_verified: 'true', given_name: NAME[sub]![0], family_name: NAME[sub]![1] },
  }));
}

let base: Tables | undefined;
/** The seeded world. Each call hands back its own copy. */
export function world(): Tables {
  if (!base) {
    const t = packTables();
    // The Standard pack for company B too (B's offers read B's own settings).
    const packed = runScript(join(__dirname, '..', 'rec-02', 'pack-run.mjs'), [join(REPO, 'scripts', 'tenancy', 'module-seeds', 'recruitment.mjs'), B, 'dev'], t);
    if (packed.code !== 0) throw new Error(`the Standard pack did not run for company B: ${(packed.stdout + packed.stderr).slice(-600)}`);
    const w = packed.tables;
    w[TABLE.state] = [
      ...(w[TABLE.state] ?? []),
      ...K.a.map((id) => saga(id, CAND_NAME[id]![0], CAND_NAME[id]![1], A, SUB.hmA, inStage('OFFER', K.ra, 'Driver trainee'))),
      ...K.b.map((id) => saga(id, CAND_NAME[id]![0], CAND_NAME[id]![1], B, SUB.hmB, inStage('OFFER', K.rb, 'Driver trainee'))),
      saga(K.applied, 'Ivy', 'Applied', A, SUB.hmA, inStage('APPLIED', K.ra, 'Driver trainee')),
      saga(K.hired, 'Harold', 'Hired', A, SUB.hmA, inStage('HIRED', K.ra, 'Driver trainee')),
      saga(K.notHired, 'Nora', 'Nothired', A, SUB.hmA, { ...inStage('NOT_HIRED', K.ra, 'Driver trainee'), not_hired_reason: 'OTHER' }),
      saga(K.otherRole, 'Olwethu', 'Stores', A, SUB.hm2A, inStage('OFFER', K.ra2, 'Stores trainee')),
      ...K.l.map((id) => saga(id, CAND_NAME[id]![0], CAND_NAME[id]![1], A, SUB.hmA, inStage('OFFER', K.ra, 'Driver trainee'))),
      saga(K.lb, 'LegacyB', 'Person', B, SUB.hmB, inStage('OFFER', K.rb, 'Driver trainee')),
      ...K.l.map((id, i) => legacyOffer(id, A, LEGACY[i]![0])),
      legacyOffer(K.lb, B, 'IN_APPROVAL'),
    ];
    w[TABLE.roles] = [
      roleRow(A, K.ra, ROLE_TITLE.ra, SUB.hmA, K.depOps, 'Ops (old name)'), roleRow(A, K.ra2, ROLE_TITLE.ra2, SUB.hm2A, K.depStores, 'Stores'),
      roleRow(B, K.rb, ROLE_TITLE.rb, SUB.hmB, K.depB, 'Transport'),
    ];
    w[TABLE.tenants] = [
      ...(w[TABLE.tenants] ?? []),
      departmentsRow(A, [{ id: K.depOps, name: 'Operations' }, { id: K.depStores, name: 'Stores' }]),
      departmentsRow(B, [{ id: K.depB, name: 'Transport' }]),
      ...[SUB.rec2A, SUB.apprA, SUB.bothA, SUB.adminA, SUB.empA, SUB.guestA, SUB.hrNoTickA].map((s) => av({ pk: `USER#${s}`, sk: `TENANT#${A}`, tenant_id: A })),
      av({ pk: `USER#${SUB.apprB}`, sk: `TENANT#${B}`, tenant_id: B }),
      av({ pk: `USER#${SUB.recD}`, sk: `TENANT#${D}`, tenant_id: D }),
    ];
    // Child lock rec-05.2 (REC-06): an accepted offer now writes an employee, so the world has the employees table (empty; its email-index
    // comes from Terraform through the harness), and every REC-05 accept can write.
    w['employees'] = [];
    base = w;
  }
  return structuredClone(base);
}

/** Company A's Recruitment switched off (its Company row names only onboarding), as an Admin's change would. */
export function withRecruitmentOff(t: Tables, company = A): Tables {
  const out = structuredClone(t);
  out[TABLE.tenants] = (out[TABLE.tenants] ?? []).map((r) => {
    const x = plain(r);
    return x['pk'] === `TENANT#${company}` && x['sk'] === 'PROFILE' ? { ...r, modules: { SS: ['onboarding'] } } : r;
  });
  return out;
}

// ---------------------------------------------------------------- runs

export type Opts = { now?: string; headers?: Record<string, string>; query?: Record<string, string>; extra?: Extra; env?: Record<string, string> };
/** Company B named in every header and query parameter a handler might wrongly read the company from (REC-00: never from input). */
export const FORGED_HEADERS: Record<string, string> = { 'x-tenant-id': B, 'X-Tenant-Id': B, 'x-company-id': B, 'tenant-id': B, tenant_id: B };
export const FORGED_QUERY: Record<string, string> = { tenant_id: B, tenantId: B, company_id: B, companyId: B };

export const env = (now = NOW, extra: Record<string, string> = {}) => settings({
  ROLES_TABLE_NAME: TABLE.roles, IDEMPOTENCY_TABLE: TABLE02.idempotency, UPLOAD_BUCKET, NODE_OPTIONS: `--import=${pathToFileURL(CLOCK).href}`, REC15_NOW: now, ...extra,
});
export const S3_EMPTY: S3World = { bucket: UPLOAD_BUCKET, objects: {} };
/** Every run's sign-in pool and S3 (a test may give its own). */
const extraOf = (o: Opts): Extra => ({ cognito: { users: poolUsers() }, s3: S3_EMPTY, ...(o.extra ?? {}) });

/** The handler that serves every /v1/offers route (D-T-5.1). */
export const OFFERS = 'manageOffers';

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
export const R = {
  list: 'GET /v1/offers', create: 'POST /v1/offers', get: 'GET /v1/offers/{id}', patch: 'PATCH /v1/offers/{id}',
  submit: 'POST /v1/offers/{id}/submit', approve: 'POST /v1/offers/{id}/approve', sendBack: 'POST /v1/offers/{id}/send-back', send: 'POST /v1/offers/{id}/send',
  answer: 'POST /v1/offers/{id}/answer', withdraw: 'POST /v1/offers/{id}/withdraw', upload: 'POST /v1/offers/{id}/signed-upload',
} as const;
/** Every route of rule 2 to 7 and 13 to 15 that names one offer. */
export const ONE_OFFER_ROUTES = [R.get, R.patch, R.submit, R.approve, R.sendBack, R.send, R.answer, R.withdraw, R.upload] as const;

export const list = (who: Caller, query: Record<string, string>, t: Tables, o: Opts = {}) => call(OFFERS, R.list, who, {}, t, { ...o, query: { ...query, ...(o.query ?? {}) } });
export const create = (who: Caller, body: unknown, t: Tables, o: Opts = {}) => call(OFFERS, R.create, who, { body }, t, o);
export const get = (who: Caller, id: string, t: Tables, o: Opts = {}) => call(OFFERS, R.get, who, { id }, t, o);
export const patch = (who: Caller, id: string, body: unknown, t: Tables, o: Opts = {}) => call(OFFERS, R.patch, who, { id, body }, t, o);
export const act = (route: string, who: Caller, id: string, body: unknown, t: Tables, o: Opts = {}) => call(OFFERS, route, who, { id, body }, t, o);

// Today's routes (rule 17).
export const oldCreate = (who: Caller, candidate: string, body: unknown, t: Tables, o: Opts = {}) => call('createOffer', 'POST /v1/candidates/{id}/offer', who, { id: candidate, body }, t, o);
export const oldPut = (who: Caller, candidate: string, body: unknown, t: Tables, o: Opts = {}) => call('advanceOfferState', 'PUT /v1/candidates/{id}/offer', who, { id: candidate, body }, t, o);
export const oldGet = (who: Caller, candidate: string, t: Tables, o: Opts = {}) => call('getOffer', 'GET /v1/candidates/{id}/offer', who, { id: candidate }, t, o);

/** The hourly job (monitorTalentFlowSLAs) once, at `now`. */
export function monitor(t: Tables, now: string, extra: Extra = {}): Run {
  return runHandler(fileOf('monitorTalentFlowSLAs'), { version: '0', source: 'aws.events', 'detail-type': 'Scheduled Event', time: now, detail: {} }, t, env(now), { cognito: { users: poolUsers() }, ...extra });
}
export const MIGRATE = join(REPO, 'scripts', 'recruitment', 'migrate-offers.mjs');
export const migrate = (args: string[], t: Tables, extra: Extra = {}) => runScript(MIGRATE, args, t, extra);

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
/** The stored offer row of a new offer (D-T-5.3: it carries offer_id and state; a history or audit row never carries both). */
export const offerRow = (t: Tables, offerId: string) => rowsOf(t).find((r) => r['offer_id'] === offerId && 'state' in r && r['SK'] !== undefined && !String(r['SK']).startsWith('HISTORY'));
/** Every row of every table that holds this offer id somewhere (the offer, its history rows, audit rows). */
export const rowsNaming = (t: Tables, offerId: string) => Object.entries(t).flatMap(([name, rows]) => rows.map(plain).filter((r) => JSON.stringify(r).includes(offerId)).map((r) => ({ table: name, row: r })));
export const awsOf = (r: { calls: any[] }) => r.calls.filter((c: any) => c.service !== 'log' && c.service !== 'step');
export const dbOf = (r: { calls: any[] }) => r.calls.filter((c: any) => c.service === 'dynamodb');
export const isModulesRead = (c: any) => c.service === 'dynamodb' && c.op === 'GetItem' && /tenants$/.test(String(c.table ?? '')) && JSON.stringify(c.input?.Key ?? {}).includes('PROFILE');
export const writesOf = (r: { calls: any[] }) => r.calls.filter((c: any) => (c.service === 'dynamodb' && /PutItem|UpdateItem|DeleteItem|BatchWriteItem|TransactWriteItems/.test(c.op)) || (/^(events|eventbridge|sqs|lambda|sfn|ses|s3|cognito)$/i.test(c.service) && !/^(Get|List|Head|Admin(Get|List)|presign)/.test(c.op ?? '')));
export const eventsOf = (r: { calls: any[] }, type?: string) => r.calls.filter((c: any) => c.service === 'events' && (!type || c.detailType === type));
export const logsOf = (r: Run) => r.calls.filter((c: any) => c.service === 'log').map((c: any) => `${c.message}${c.extra === undefined ? '' : ' ' + JSON.stringify(c.extra)}`);
/** A row-by-row difference: the rows of `after` that are new or changed against `before`, and rows removed. */
export function changed(before: Tables, after: Tables): string[] {
  const out: string[] = [];
  for (const [name, rows] of Object.entries(after)) {
    const was = new Set((before[name] ?? []).map((r) => JSON.stringify(r)));
    for (const r of rows) if (!was.has(JSON.stringify(r))) { const x = plain(r); out.push(`${name} ${x['PK'] ?? x['pk'] ?? x['idempotencyKey'] ?? ''} ${x['SK'] ?? x['sk'] ?? ''}`); }
  }
  for (const [name, rows] of Object.entries(before)) if ((after[name] ?? []).length < rows.length) out.push(`${name}: a row was removed`);
  return out;
}
/** The new or changed rows, in full (plain values). */
export function newRows(before: Tables, after: Tables): { table: string; row: Record<string, any> }[] {
  return Object.entries(after).flatMap(([name, rows]) => {
    const was = new Set((before[name] ?? []).map((r) => JSON.stringify(r)));
    return rows.filter((r) => !was.has(JSON.stringify(r))).map((r) => ({ table: name, row: plain(r) }));
  });
}
/** Every key name in a value, at every depth. */
export function keysDeep(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); keysDeep(x, out); }
  return out;
}
/** Every person id of the world (none may appear in an offer answer, D-REC-5.10). */
export const PERSON_IDS = Object.values(SUB);
