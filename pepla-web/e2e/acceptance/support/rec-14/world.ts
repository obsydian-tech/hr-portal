import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LAMBDA, REPO, httpEvent, jwtAuthorizer, runHandler, type Failure, type Row, type Run, type Tables } from './lambda-harness';

/**
 * REC-14 step A: the world of AC-1 to AC-4 (the departments store). Rows and helpers in the shape of ../rec-04/world.ts.
 *
 *   A  the founding company. Its list (version 7) holds five active departments, one archived, and one written in lower case
 *      ("aviation") so the sort can be seen to ignore case.
 *   B  a second company. Its list (version 2) holds "Engineering" too (same name, its own id), one active and one archived name
 *      of its own. B's callers exist to be refused A's list, and A's Admin to be refused B's ids.
 *   C  a company with no list yet (no DEPARTMENTS row).
 * Each company has its Company row (sk PROFILE), Member rows, and one MODULES# audit row, so a test can see they are left alone.
 * All names and ids are made up.
 */

export const A = 'ten_aaaaaaaaaaaaaaaaaaaaaaaaaa';
export const B = 'ten_bbbbbbbbbbbbbbbbbbbbbbbbbb';
export const C = 'ten_cccccccccccccccccccccccccc';
export const TENANTS = 'naleko-people-dev-tenants';
export const TENANTS_PROD = 'naleko-people-prod-tenants';
export const HANDLER_DIR = join(LAMBDA, 'manageDepartments');
export const SHARED = join(LAMBDA, 'shared', 'departments.mjs');
export const SEED = join(REPO, 'scripts', 'tenancy', 'company-seeds', 'departments.mjs');
export const SET_MODULES = join(REPO, 'scripts', 'tenancy', 'set-modules.mjs');
export const SEED_DEV = join(REPO, 'scripts', 'ci', 'seed-dev.py');
export const SEED_RUN = join(__dirname, 'seed-run.py');
/** Q-1, decided by Iggie on 22 Nov 2026: the four names Register an employee already offers. */
export const STARTING = ['Engineering', 'Finance', 'Operations', 'People'];
/** The dev walk's department of the founding company (support/ten-04/dev-ids.json, child lock ten-04.8). */
export const WALK_DEPARTMENT = { id: 'dep_01TEN04A000000000000000001', name: 'Fleet' };
export const DEP_ID = /^dep_[0-9A-HJKMNP-TV-Z]{26}$/;
export const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export const ROUTE = {
  list: 'GET /v1/company/departments',
  add: 'POST /v1/admin/company/departments',
  change: 'PATCH /v1/admin/company/departments/{id}',
} as const;
export type RouteKey = (typeof ROUTE)[keyof typeof ROUTE];

// ---------------------------------------------------------------- rows

type Plain = string | number | boolean | null | undefined | Plain[] | { [k: string]: Plain };
/** A row as DynamoDB stores it, from plain values (maps and lists too). A `Set` of strings becomes a string set. */
export function av(values: Record<string, Plain | Set<string>>): Row {
  const one = (v: Plain | Set<string>): Record<string, unknown> =>
    v instanceof Set ? { SS: [...v] }
      : v === null ? { NULL: true }
        : typeof v === 'string' ? { S: v }
          : typeof v === 'number' ? { N: String(v) }
            : typeof v === 'boolean' ? { BOOL: v }
              : Array.isArray(v) ? { L: v.map(one) }
                : { M: Object.fromEntries(Object.entries(v as Record<string, Plain>).filter(([, x]) => x !== undefined).map(([k, x]) => [k, one(x)])) };
  const out: Row = {};
  for (const [k, v] of Object.entries(values)) if (v !== undefined) out[k] = one(v);
  return out;
}
/** A stored value read back as a plain value. */
export function plainValue(v: any): any {
  if (!v || typeof v !== 'object') return v;
  if ('S' in v) return v.S;
  if ('N' in v) return Number(v.N);
  if ('BOOL' in v) return v.BOOL;
  if ('NULL' in v) return null;
  if ('SS' in v) return [...v.SS].sort();
  if ('L' in v) return v.L.map(plainValue);
  if ('M' in v) return Object.fromEntries(Object.entries(v.M).map(([k, x]) => [k, plainValue(x)]));
  return v;
}
export const plain = (r: Row | undefined): Record<string, any> => Object.fromEntries(Object.entries(r ?? {}).map(([k, v]) => [k, plainValue(v)]));
export const rowsOf = (t: Tables | undefined, table: string) => (t?.[table] ?? []).map(plain);

export type Dep = { id: string; name: string; status: 'ACTIVE' | 'ARCHIVED' };
const id = (c: string, n: number) => `dep_01REC14${c}${String(n).padStart(18, '0')}`;
export const DEP = {
  engA: { id: id('A', 1), name: 'Engineering', status: 'ACTIVE' },
  finA: { id: id('A', 2), name: 'Finance', status: 'ACTIVE' },
  opsA: { id: id('A', 3), name: 'Operations', status: 'ACTIVE' },
  pplA: { id: id('A', 4), name: 'People', status: 'ACTIVE' },
  fleetA: { id: id('A', 5), name: 'Fleet', status: 'ACTIVE' },
  storesA: { id: id('A', 6), name: 'Old Stores', status: 'ARCHIVED' },
  aviationA: { id: id('A', 7), name: 'aviation', status: 'ACTIVE' },
  engB: { id: id('B', 1), name: 'Engineering', status: 'ACTIVE' },
  dispatchB: { id: id('B', 2), name: 'Bontle Dispatch', status: 'ACTIVE' },
  yardB: { id: id('B', 3), name: 'Bontle Yard', status: 'ARCHIVED' },
} satisfies Record<string, Dep>;
export const LIST_A: Dep[] = [DEP.engA, DEP.finA, DEP.opsA, DEP.pplA, DEP.fleetA, DEP.storesA, DEP.aviationA];
export const LIST_B: Dep[] = [DEP.engB, DEP.dispatchB, DEP.yardB];
export const VERSION = { A: 7, B: 2 };
const NOW = '2026-11-20T08:00:00.000Z';

/** A company's list row (rule 1): pk TENANT#<id>, sk DEPARTMENTS. */
export function listRow(c: string, version: number, deps: Dep[]): Row {
  return av({ pk: `TENANT#${c}`, sk: 'DEPARTMENTS', tenant_id: c, version, departments: deps.map((d) => ({ ...d })), updated_at: NOW, updated_by: 'sub-seed' });
}
export const NAMES: Record<string, string> = { [A]: 'Mokoena Bakeries', [B]: 'Bontle Logistics', [C]: 'Cele Couriers' };
/** Every row of the company list table in the world. */
export function companyRows(): Row[] {
  const profile = (c: string, extra: Record<string, Plain | Set<string>>) =>
    av({ pk: `TENANT#${c}`, sk: 'PROFILE', tenant_id: c, name: NAMES[c]!, status: 'ACTIVE', country: 'ZA', created_at: '2026-11-16T00:00:00Z', ...extra });
  const member = (sub: string, c: string) => av({ pk: `USER#${sub}`, sk: `TENANT#${c}`, tenant_id: c, created_at: NOW });
  const audit = (c: string) => av({ pk: `TENANT#${c}`, sk: `MODULES#2026-11-18T10:00:00.000Z#01REC14MODULES${c === A ? 'A' : c === B ? 'B' : 'C'}00000000000`, tenant_id: c, from: ['onboarding'], to: ['onboarding', 'recruitment'], by: 'arn:aws:iam::000000000000:user/seed' });
  return [
    profile(A, { founding: true }), profile(B, { modules: new Set(['onboarding', 'recruitment']) }), profile(C, { modules: new Set(['onboarding']) }),
    audit(A), audit(B), audit(C),
    member('sub-admin-a', A), member('sub-hr-a', A), member('sub-rec-a', A), member('sub-admin-b', B), member('sub-hr-b', B), member('sub-admin-c', C),
  ];
}
/** The seeded world: the company list table only (the Lambda may touch no other table). */
export function tables(): Tables {
  return { [TENANTS]: [...companyRows(), listRow(A, VERSION.A, LIST_A), listRow(B, VERSION.B, LIST_B)] };
}
/** The list row of a company, plain, or undefined. */
export const listOf = (t: Tables | undefined, c: string) => rowsOf(t, TENANTS).find((r) => r['pk'] === `TENANT#${c}` && r['sk'] === 'DEPARTMENTS');
/** The audit rows of a company (rule 5: sk DEPARTMENTS#<time>#<ulid>, with an action). */
export const auditsOf = (t: Tables | undefined, c: string) => rowsOf(t, TENANTS).filter((r) => r['pk'] === `TENANT#${c}` && String(r['sk']).startsWith('DEPARTMENTS#') && r['action'] !== undefined);
/** Every row of the company list that is not a DEPARTMENTS row of company `c` (what a department change must leave alone). */
export const othersThan = (t: Tables | undefined, c: string) => JSON.stringify(
  (t?.[TENANTS] ?? []).filter((r) => !(plainValue(r['pk']) === `TENANT#${c}` && /^DEPARTMENTS(#|$)/.test(String(plainValue(r['sk']))))).map(sortKeys).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))),
);
export function sortKeys(v: any): any {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

// ---------------------------------------------------------------- callers

export type Caller = {
  name: string;
  /** The "cognito:groups" claim: a list is sent in the form API Gateway uses ("[a b]"); a string is sent as it is; undefined sends none. */
  groups?: string[] | string;
  sub: string;
  company?: 'A' | 'B' | 'C' | null;
  claims?: Record<string, unknown>;
};
const p = (name: string, groups: string[] | string | undefined, sub: string, extra: Partial<Caller> = {}): Caller => ({ name, groups, sub, ...extra });
export const WHO = {
  adminA: p('Admin of A', ['admin'], 'sub-admin-a'),
  adminHrA: p('Admin who is also HR of A', ['admin', 'hr_staff'], 'sub-adminhr-a'),
  oldAdminA: p('Old TalentFlowAdmin of A', ['TalentFlowAdmin'], 'sub-oldadmin-a'),
  oldAdminClaimA: p('Old custom:isAdmin "true" of A, no group', [], 'sub-oldadminclaim-a', { claims: { 'custom:isAdmin': 'true' } }),
  hrA: p('HR staff of A', ['hr_staff'], 'sub-hr-a'),
  recruiterA: p('Recruiter of A (hr_staff + perm-recruitment)', ['hr_staff', 'perm-recruitment'], 'sub-rec-a'),
  oldHrA: p('Old TalentFlow HR of A (naleko-talentflow-hr, a Recruiter until TEN-06)', ['naleko-talentflow-hr'], 'sub-oldhr-a'),
  managerA: p('Manager of A (no tick)', ['manager'], 'sub-manager-a'),
  managerTickA: p('Manager of A with the Recruitment tick', ['manager', 'perm-recruitment'], 'sub-managertick-a'),
  tickA: p('The Recruitment tick without HR', ['perm-recruitment'], 'sub-tick-a'),
  employeeA: p('Employee of A', ['employee'], 'sub-employee-a'),
  guestA: p('Guest of A', ['guest'], 'sub-guest-a'),
  itA: p('IT only (perm-it) of A', ['perm-it'], 'sub-it-a'),
  approverA: p('Approver (perm-approve-offers) of A', ['perm-approve-offers'], 'sub-approver-a'),
  noGroupsA: p('No groups claim, of A', undefined, 'sub-nogroups-a'),
  oldHmA: p('Old HiringManager of A', ['HiringManager'], 'sub-oldhm-a'),
  nearAdmins: p('admins (a near name)', ['admins'], 'sub-near1-a'),
  nearHr: p('hr_staffx (a near name)', ['hr_staffx'], 'sub-near2-a'),
  nearUpper: p('ADMIN (upper case)', ['ADMIN'], 'sub-near3-a'),
  nearOne: p('one string "admin-hr_staff"', ['admin-hr_staff'], 'sub-near4-a'),
  accessAdminA: p('Admin of A on an access token', ['admin'], 'sub-admin-a', { claims: { token_use: 'access' } }),
  adminNoCompany: p('Admin with no company', ['admin'], 'sub-admin-none', { company: null }),
  hrNoCompany: p('HR with no company', ['hr_staff'], 'sub-hr-none', { company: null }),
  adminBadCompany: p('Admin whose tenant_id claim is not a company id', ['admin'], 'sub-admin-bad', { claims: { tenant_id: 'DEFAULT' } }),
  adminB: p('Admin of B', ['admin'], 'sub-admin-b', { company: 'B' }),
  hrB: p('HR staff of B', ['hr_staff'], 'sub-hr-b', { company: 'B' }),
  adminC: p('Admin of C (no list yet)', ['admin'], 'sub-admin-c', { company: 'C' }),
  hrC: p('HR staff of C (no list yet)', ['hr_staff'], 'sub-hr-c', { company: 'C' }),
} satisfies Record<string, Caller>;
/** The claim forms of A's Admin, as API Gateway can hand the groups over. */
export const ADMIN_FORMS: Caller[] = [
  p('groups as "[admin]"', ['admin'], 'sub-admin-a'),
  p('groups as a JSON list string', '["admin"]', 'sub-admin-a'),
  p('groups as "employee,admin"', 'employee,admin', 'sub-admin-a'),
  p('groups as a real list', [], 'sub-admin-a', { claims: { 'cognito:groups': ['admin'] } }),
];
/** AC-1: who reads the list (HR staff, Admin, Recruiter; old names through TEN-05 and REC-01 D-REC-1.3). */
export const READERS: Caller[] = [WHO.adminA, WHO.adminHrA, WHO.oldAdminA, WHO.oldAdminClaimA, WHO.hrA, WHO.recruiterA, WHO.oldHrA, ...ADMIN_FORMS];
/** AC-1: everyone of A who may not read it. */
export const NOT_READERS: Caller[] = [
  WHO.managerA, WHO.managerTickA, WHO.tickA, WHO.employeeA, WHO.guestA, WHO.itA, WHO.approverA, WHO.noGroupsA, WHO.oldHmA,
  WHO.nearAdmins, WHO.nearHr, WHO.nearUpper, WHO.nearOne, WHO.accessAdminA,
];
/** AC-2: who changes the list (Q-2, recommended option taken: Admin only). */
export const WRITERS: Caller[] = [WHO.adminA, WHO.adminHrA, WHO.oldAdminA, WHO.oldAdminClaimA, ...ADMIN_FORMS];
/** AC-2: everyone of A who may not change it (HR staff and Recruiters read only). */
export const NOT_WRITERS: Caller[] = [WHO.hrA, WHO.recruiterA, WHO.oldHrA, ...NOT_READERS];
const COMPANY = { A, B, C };

/** The authorizer a caller arrives with. */
export function authorizerOf(c: Caller, extra: Record<string, unknown> = {}): unknown {
  const company = c.company === undefined ? 'A' : c.company;
  const groups = Array.isArray(c.groups) ? `[${c.groups.join(' ')}]` : c.groups;
  return jwtAuthorizer({
    sub: c.sub, email: `${c.sub}@example.test`, email_verified: 'true', token_use: 'id',
    'cognito:groups': groups, ...(company ? { tenant_id: COMPANY[company] } : {}), ...(c.claims ?? {}), ...extra,
  });
}

/** The handler file of manageDepartments (D-T-1). */
export function handlerFile(): string {
  for (const f of ['index.mjs', 'index.js']) if (existsSync(join(HANDLER_DIR, f))) return join(HANDLER_DIR, f);
  return join(HANDLER_DIR, 'index.mjs');
}
export const handlerExists = () => ['index.mjs', 'index.js'].some((f) => existsSync(join(HANDLER_DIR, f)));

export type Ask = { query?: Record<string, string>; body?: unknown; headers?: Record<string, string>; id?: string; claims?: Record<string, unknown>; rawBody?: string; /** extra path parameters, as a forged request could carry */ path?: Record<string, string> };
export type Opts = { tables?: Tables; fail?: Failure; clash?: { times: number; add?: Dep[]; company?: string }; env?: Record<string, string | undefined> };
/** The settings the Lambda gets (as Terraform gives them, D-T-1). */
export const SETTINGS = { TENANTS_TABLE: TENANTS };

/** Runs one route of manageDepartments as a caller, in a fresh process, against the world (or the given tables). */
export function ask(route: RouteKey, caller: Caller, a: Ask = {}, o: Opts = {}): Run {
  const [method, path] = route.split(' ') as [string, string];
  const raw = a.id !== undefined ? path.replace('{id}', encodeURIComponent(a.id)) : path;
  const event = httpEvent({ authorizer: authorizerOf(caller, a.claims ?? {}), query: a.query, body: a.rawBody !== undefined ? a.rawBody : a.body, headers: a.headers, ...(a.id !== undefined || a.path ? { path: { ...(a.path ?? {}), ...(a.id !== undefined ? { id: a.id } : {}) } } : {}) });
  event.routeKey = route;
  event.rawPath = raw;
  event.requestContext.routeKey = route;
  event.requestContext.http.method = method;
  event.requestContext.http.path = raw;
  const clashCompany = o.clash?.company ?? A;
  return runHandler(handlerFile(), event, {
    tables: o.tables ?? tables(),
    env: { ...SETTINGS, ...(o.env ?? {}) },
    ...(o.fail ? { fail: o.fail } : {}),
    ...(o.clash ? { clashBeforeTransact: { table: TENANTS, key: av({ pk: `TENANT#${clashCompany}`, sk: 'DEPARTMENTS' }), times: o.clash.times, add: (o.clash.add ?? []).map((d) => av({ d: { ...d } })['d'] as Row) } } : {}),
  });
}
let n = 0;
/** A fresh Idempotency-Key. */
export const newKey = () => `rec14-key-${process.pid}-${++n}-${Date.now()}`;
/** POST /v1/admin/company/departments with a fresh key (unless headers are given). */
export const add = (caller: Caller, body: unknown, o: Opts = {}, headers?: Record<string, string>) => ask(ROUTE.add, caller, { body, headers: headers ?? { 'Idempotency-Key': newKey() } }, o);
export const change = (caller: Caller, depId: string, body: unknown, o: Opts = {}) => ask(ROUTE.change, caller, { id: depId, body }, o);
export const list = (caller: Caller, query?: Record<string, string>, o: Opts = {}) => ask(ROUTE.list, caller, { query }, o);

export const statusOf = (r: Run) => r.response?.statusCode as number | undefined;
export function bodyOf(r: Run): any {
  const b = r.response?.body;
  if (typeof b !== 'string') return b;
  try { return JSON.parse(b); } catch { return b; }
}
export const describe = (r: Run) => (r.error ? `threw ${r.error.name}: ${r.error.message.slice(0, 300)}` : `${statusOf(r)} ${typeof r.response?.body === 'string' ? r.response.body.slice(0, 300) : JSON.stringify(r.response).slice(0, 300)}`);
export const WRITE_OPS = /PutItem|UpdateItem|DeleteItem|BatchWriteItem|TransactWriteItems/;
/** The DynamoDB write calls of a run. */
export const writesOf = (r: Run) => (r.calls as any[]).filter((c) => c.service === 'dynamodb' && WRITE_OPS.test(c.op));
/** Every DynamoDB call of a run, as "op table". */
export const dynamoOps = (r: Run) => (r.calls as any[]).filter((c) => c.service === 'dynamodb').map((c) => `${c.op} ${c.table ?? ''}`.trim());
/** Every call that is not a log line or DynamoDB. */
export const otherCalls = (r: Run) => (r.calls as any[]).filter((c) => c.service !== 'log' && c.service !== 'dynamodb').map((c) => `${c.service} ${c.op ?? ''}`);
export const logsOf = (r: Run) => (r.calls as any[]).filter((c) => c.service === 'log').map((c) => `${c.message}${c.extra === undefined ? '' : ' ' + JSON.stringify(c.extra)}`).join('\n');

/** Every key (pk, sk) a run's DynamoDB calls name, in the items, keys and conditions they send. */
export function keysNamed(r: Run): { pk: string; sk: string; op: string }[] {
  const out: { pk: string; sk: string; op: string }[] = [];
  const look = (op: string, x: any) => {
    const k = x?.Key ?? x?.Item;
    if (k?.pk || k?.sk) out.push({ op, pk: String(plainValue(k.pk)), sk: String(plainValue(k.sk)) });
  };
  for (const c of r.calls as any[]) {
    if (c.service !== 'dynamodb') continue;
    if (c.op === 'TransactWriteItems') for (const t of c.input?.TransactItems ?? []) for (const [kind, x] of Object.entries(t)) look(`${c.op}.${kind}`, x);
    else look(c.op, c.input);
    if (c.op === 'Query' || c.op === 'Scan') out.push({ op: c.op, pk: '(query)', sk: '(query)' });
  }
  return out;
}

export const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
