import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { LAMBDA, REPO, httpEvent, runHandler, runPack, type PoolUser, type Row, type Run, type Tables } from './lambda-harness';
import { A, AGENT_SECRET, B, D, SUB, TABLE, TENANTS, authorizerOf, av, fileOf, packTables, plain, rowsOf, saga, settings, type Caller } from './world';
import { LIST_A, LIST_B, VERSION, listRow } from '../rec-14/world';

/**
 * REC-04: the card's own world and helpers. Nothing here is application code: rows in the shape the card's rule 1 gives a role
 * record, candidate rows in the shape they are stored today (with role_id), the card's routes, and small readers of what a run wrote.
 *
 * Companies A and B both hold the real Standard pack (REC-12, written by the real pack script). Company A has four roles: Fleet
 * controller (hiring manager hmA) with candidates in every stage, Warehouse supervisor (hiring manager hm2A) with two open candidates,
 * Senior accountant (hiring manager hmA) with none, and Old till role, already closed. Company B has Dispatch lead (hiring manager hmB).
 * One candidate of company B carries company A's Fleet controller role id: no read of company A may ever count or show it.
 */

export const ROLES_TABLE = 'talent-flow-roles';
export const HANDLER = 'manageRoles';
export const ROUTE = {
  list: 'GET /v1/roles',
  one: 'GET /v1/roles/{id}',
  open: 'POST /v1/roles',
  close: 'POST /v1/roles/{id}/close',
  candidates: 'GET /v1/candidates',
} as const;
export type RouteKey = (typeof ROUTE)[keyof typeof ROUTE];
export const ROLE_ROUTES: RouteKey[] = [ROUTE.list, ROUTE.one, ROUTE.open, ROUTE.close];
export const ROUTE_HANDLER: Record<string, string> = { [ROUTE.list]: HANDLER, [ROUTE.one]: HANDLER, [ROUTE.open]: HANDLER, [ROUTE.close]: HANDLER, [ROUTE.candidates]: 'getCandidates' };
export const INDEX = 'role-id-index';
/** The open stages (REC-00 rule 6): a role's candidate_count and the close refusal count these. */
export const OPEN = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER'];
/** D-T-6: today's stored SLA words, as the screens read them. */
export const SLA = { ON_TRACK: 'ON_TRACK', AT_RISK: 'DUE_SOON', BREACHED: 'OVERDUE' } as Record<string, string>;

export const R = {
  fleet: 'role-01REC04FLEETAAAAAAAAAAA1',
  warehouse: 'role-01REC04WAREHOUSEAAAAAAA1',
  accountant: 'role-01REC04ACCOUNTANTAAAAAA1',
  closed: 'role-01REC04CLOSEDAAAAAAAAAA1',
  b: 'role-01REC04DISPATCHBBBBBBBB1',
  /** A role id no row has. */
  none: 'role-01REC04NONEAAAAAAAAAAAA1',
};
export const TITLE: Record<string, string> = { [R.fleet]: 'Fleet controller', [R.warehouse]: 'Warehouse supervisor', [R.accountant]: 'Senior accountant', [R.closed]: 'Old till role', [R.b]: 'Dispatch lead' };

/** Person ids beyond world.ts: a person of A who may not be a hiring manager, a person of A with the tick, and a manager not yet confirmed. */
export const P = { employeeA: 'sub-employee-a', tickA: 'sub-tick-a', unconfirmedA: 'sub-unconfirmed-a', noMemberHm: 'sub-hm-nomember' };

/** The card's candidates. Fleet controller holds one in each stage, an old stage name, an old rejection and two SLA states. */
export const K = {
  applied: 'CAND-04REC04APPLIEDAAAAAAAA1',
  screening: 'CAND-04REC04SCREENINGAAAAAA1',
  interview: 'CAND-04REC04INTERVIEWAAAAAA1',
  /** Stored under an old name (INTERVIEWING): reads as INTERVIEW. Its SLA is AT_RISK. */
  oldName: 'CAND-04REC04OLDNAMEAAAAAAAA1',
  /** In Offer; SLA BREACHED. */
  offer: 'CAND-04REC04OFFERAAAAAAAAAA1',
  hired: 'CAND-04REC04HIREDAAAAAAAAAA1',
  notHired: 'CAND-04REC04NOTHIREDAAAAAAA1',
  /** The old system's rejection (status REJECTED, an old stage): Not hired. */
  oldRejected: 'CAND-04REC04OLDREJECTEDAAAA1',
  /** In Fleet controller, but its hiring manager is hm2A (a manager's own list is by the candidate's hiring manager). */
  otherHm: 'CAND-04REC04OTHERHMAAAAAAAA1',
  w1: 'CAND-04REC04WAREHOUSE1AAAAA1',
  w2: 'CAND-04REC04WAREHOUSE2AAAAA1',
  /** Company A, no role yet (REC-13 attaches it). */
  noRole: 'CAND-04REC04NOROLEAAAAAAAAA1',
  /** Company B's candidate on B's role. */
  b1: 'CAND-04REC04BCANDBBBBBBBBBBB1',
  /** Company B's candidate stamped with company A's Fleet controller role id. */
  bOnA: 'CAND-04REC04BONABBBBBBBBBBBB1',
  /** Old till role (closed): one Hired candidate. */
  closedHired: 'CAND-04REC04CLOSEDHIREDAAAA1',
};
export const NAME: Record<string, [string, string]> = {
  [K.applied]: ['Amahle', 'Dlamini'], [K.screening]: ['Tariro', 'Moyo'], [K.interview]: ['Tendai', 'Ncube'], [K.oldName]: ['Bongani', 'Mthembu'],
  [K.offer]: ['Kagiso', 'Molefe'], [K.hired]: ['Lindiwe', 'Khoza'], [K.notHired]: ['Nomvula', 'Zulu'], [K.oldRejected]: ['Farai', 'Moyo'],
  [K.otherHm]: ['Ayanda', 'Mkhize'], [K.w1]: ['Lwazi', 'Buthelezi'], [K.w2]: ['Zanele', 'Pillay'], [K.noRole]: ['Karabo', 'Jacobs'],
  [K.b1]: ['Hlengiwe', 'Sibiya'], [K.bOnA]: ['Mandla', 'Cele'], [K.closedHired]: ['Pule', 'Maseko'],
};
export const fullName = (id: string) => (NAME[id] ? NAME[id]!.join(' ') : `(not a seeded candidate: ${id})`);

/** Fleet controller, as the board reads it: candidate id -> the stage code a read must give. */
export const FLEET_STAGE: Record<string, string> = {
  [K.applied]: 'APPLIED', [K.screening]: 'SCREENING', [K.interview]: 'INTERVIEW', [K.oldName]: 'INTERVIEW', [K.offer]: 'OFFER', [K.hired]: 'HIRED',
  [K.notHired]: 'NOT_HIRED', [K.oldRejected]: 'NOT_HIRED', [K.otherHm]: 'SCREENING',
};
export const FLEET_OPEN = [K.applied, K.screening, K.interview, K.oldName, K.offer, K.otherHm];
export const FLEET_SLA: Record<string, string> = { [K.oldName]: 'DUE_SOON', [K.offer]: 'OVERDUE' };

const NOW = '2026-11-10T08:00:00.000Z';
const criteria = [{ key: 'technical', label: 'Technical' }, { key: 'communication', label: 'Communication' }, { key: 'culturalFit', label: 'Cultural fit' }, { key: 'problemSolving', label: 'Problem solving' }];

/** A role record as rule 1 gives it. */
export function roleRow(c: string, id: string, hm: string, extra: Record<string, any> = {}): Row {
  return av({
    pk: `TENANT#${c}`, sk: `ROLE#${id}`, tenant_id: c, role_id: id, job_title: TITLE[id] ?? 'A role', department: 'Operations', level: 'MID',
    hiring_manager_id: hm, criteria, panel_size: 3, status: 'OPEN', opened_at: '2026-10-12T08:00:00.000Z', opened_by: c === A ? SUB.recA : SUB.recB, legacy: false, ...extra,
  });
}

function cand(id: string, c: string, roleId: string | undefined, stage: string, hm: string, extra: Record<string, any> = {}): Row {
  const [first, last] = NAME[id]!;
  return saga(id, first, last, c, hm, { currentStage: stage, ...(roleId ? { role_id: roleId } : {}), positionTitle: roleId ? TITLE[roleId] ?? 'A role' : 'Junior baker', ...extra });
}

export function rec04Rows(): Row[] {
  return [
    cand(K.applied, A, R.fleet, 'APPLIED', SUB.hmA),
    cand(K.screening, A, R.fleet, 'SCREENING', SUB.hmA),
    cand(K.interview, A, R.fleet, 'INTERVIEW', SUB.hmA),
    cand(K.oldName, A, R.fleet, 'INTERVIEWING', SUB.hmA, { slaStatus: 'AT_RISK' }),
    cand(K.offer, A, R.fleet, 'OFFER', SUB.hmA, { slaStatus: 'BREACHED' }),
    cand(K.hired, A, R.fleet, 'HIRED', SUB.hmA),
    cand(K.notHired, A, R.fleet, 'NOT_HIRED', SUB.hmA, { not_hired_reason: 'WITHDREW' }),
    cand(K.oldRejected, A, R.fleet, 'EVALUATION', SUB.hmA, { status: 'REJECTED', evaluationCompletedAt: '2026-09-14T10:00:00.000Z' }),
    cand(K.otherHm, A, R.fleet, 'SCREENING', SUB.hm2A),
    cand(K.w1, A, R.warehouse, 'APPLIED', SUB.hm2A),
    cand(K.w2, A, R.warehouse, 'OFFER', SUB.hm2A, { slaStatus: 'BREACHED' }),
    cand(K.noRole, A, undefined, 'APPLIED', SUB.hmA),
    cand(K.closedHired, A, R.closed, 'HIRED', SUB.hmA),
    cand(K.b1, B, R.b, 'APPLIED', SUB.hmB),
    cand(K.bOnA, B, R.fleet, 'APPLIED', SUB.hmB, { slaStatus: 'BREACHED' }),
  ];
}

export function roleRows(): Row[] {
  return [
    roleRow(A, R.fleet, SUB.hmA),
    roleRow(A, R.warehouse, SUB.hm2A, { level: 'SENIOR', opened_at: '2026-10-20T08:00:00.000Z' }),
    roleRow(A, R.accountant, SUB.hmA, { department: 'Finance', level: 'SENIOR', opened_at: '2026-10-28T08:00:00.000Z' }),
    roleRow(A, R.closed, SUB.hm2A, { status: 'CLOSED', closed_at: '2026-11-01T08:00:00.000Z', closed_by: SUB.recA }),
    roleRow(B, R.b, SUB.hmB),
  ];
}

/** Member rows (TEN-01 shape) for the extra people of this card. */
function memberRows(): Row[] {
  return [P.employeeA, P.tickA, P.unconfirmedA].map((s) => av({ pk: `USER#${s}`, sk: `TENANT#${A}`, tenant_id: A }));
}

/** The pool the hiring manager check reads (the TEN-05 picker: the manager role, the tick or the old HiringManager group; CONFIRMED). */
export function pool(): PoolUser[] {
  const u = (sub: string, groups: string[], status = 'CONFIRMED'): PoolUser => ({ username: sub, sub, status, enabled: true, attributes: { sub, email: `${sub}@example.test`, given_name: 'Pat', family_name: sub }, groups });
  return [
    u(SUB.hmA, ['manager']), u(SUB.hm2A, ['manager']), u(SUB.hmB, ['manager']), u(SUB.recA, ['hr_staff', 'perm-recruitment']), u(SUB.recB, ['hr_staff', 'perm-recruitment']),
    u(P.employeeA, ['employee']), u(P.tickA, ['perm-recruitment']), u(P.unconfirmedA, ['manager'], 'FORCE_CHANGE_PASSWORD'), u(P.noMemberHm, ['manager']),
  ];
}

let packedB: Tables | undefined;
/** Companies A and B with the Standard pack, the roles and the candidates. */
export function world(): Tables {
  if (!packedB) {
    const r = runPack(B, 'dev', { tables: packTables() });
    if (r.code !== 0) throw new Error(`the Standard pack did not run for company B (exit ${r.code}): ${(r.stdout + r.stderr).slice(-600)}`);
    packedB = r.tables;
  }
  const t = structuredClone(packedB);
  t[TABLE.state] = [...(t[TABLE.state] ?? []), ...rec04Rows()];
  t[ROLES_TABLE] = roleRows();
  // REC-14 step B (child lock rec-04.2): the companies' department lists (REC-14's rows), so a role is opened with a department id.
  t[TENANTS] = [...(t[TENANTS] ?? []), ...memberRows(), listRow(A, VERSION.A, LIST_A), listRow(B, VERSION.B, LIST_B)];
  return t;
}

/** The same world with `n` more open candidates on Fleet controller (to make the reads page). */
export function withMany(t: Tables, n: number, roleId = R.fleet): Tables {
  const out = structuredClone(t);
  for (let i = 0; i < n; i++) {
    const id = `CAND-04REC04MANY${String(i).padStart(12, '0')}`;
    out[TABLE.state]!.push(saga(id, 'Many', `Person${i}`, A, SUB.hmA, { currentStage: OPEN[i % 4]!, role_id: roleId, positionTitle: TITLE[roleId] ?? 'A role' }));
  }
  return out;
}

// ---------------------------------------------------------------- calls

export type Ask4 = { id?: string; body?: unknown; headers?: Record<string, string>; query?: Record<string, string>; claims?: Record<string, unknown> };
/** Runs one route as `caller`, as API Gateway (HTTP API, payload 2.0) hands it over. */
export function call(route: string, caller: Caller, a: Ask4, t: Tables, opts: { queryPageSize?: number; fail?: any; pool?: PoolUser[] } = {}): Run {
  const [method, template] = route.split(' ') as [string, string];
  const path = a.id === undefined ? template : template.replace('{id}', a.id);
  const event = httpEvent({ authorizer: authorizerOf(caller, a.claims ?? {}), path: a.id === undefined ? undefined : { id: a.id }, query: a.query, body: a.body, headers: a.headers });
  event.routeKey = route;
  event.rawPath = path;
  event.requestContext.routeKey = route;
  event.requestContext.http.method = method;
  event.requestContext.http.path = path;
  return runHandler(fileOf(ROUTE_HANDLER[route]!), event, {
    tables: t, secrets: { [AGENT_SECRET]: { AWSCURRENT: 'rec04-agent-key' } }, env: settings({ ROLES_TABLE_NAME: ROLES_TABLE }), cognito: { users: opts.pool ?? pool() },
    ...(opts.queryPageSize ? { queryPageSize: opts.queryPageSize } : {}), ...(opts.fail ? { fail: opts.fail } : {}),
  });
}
let keyN = 0;
export const newKey = () => `rec04-key-${process.pid}-${++keyN}`;
export const list = (who: Caller, t: Tables, query?: Record<string, string>, o = {}) => call(ROUTE.list, who, { query }, t, o);
export const one = (who: Caller, id: string, t: Tables, o = {}) => call(ROUTE.one, who, { id }, t, o);
export const open = (who: Caller, body: unknown, t: Tables, key: string | null = newKey(), o: { headers?: Record<string, string>; pool?: PoolUser[] } = {}) =>
  call(ROUTE.open, who, { body, headers: { ...(key === null ? {} : { 'idempotency-key': key }), ...(o.headers ?? {}) } }, t, { pool: o.pool });
export const close = (who: Caller, id: string, t: Tables, o = {}) => call(ROUTE.close, who, { id, body: {} }, t, o);
export const candidates = (who: Caller, query: Record<string, string>, t: Tables, o = {}) => call(ROUTE.candidates, who, { query }, t, o);

// ---------------------------------------------------------------- readers

/** Every role row of the roles table, plain. */
export const rolesIn = (t: Tables) => rowsOf(t, ROLES_TABLE);
export const roleOf = (t: Tables, id: string) => rolesIn(t).find((r) => r['role_id'] === id);
/** Every call to an outside service (log lines left out). */
export const awsOf = (r: Run) => r.calls.filter((c: any) => c.service !== 'log' && c.service !== 'step');
export const logsOf = (r: Run) => r.calls.filter((c: any) => c.service === 'log').map((c: any) => `${c.message}${c.extra === undefined ? '' : ' ' + JSON.stringify(c.extra)}`);
export const anyWrite = (r: Run) => awsOf(r).filter((c: any) => (c.service === 'dynamodb' && /PutItem|UpdateItem|DeleteItem|BatchWriteItem|TransactWriteItems/.test(c.op)) || (c.service !== 'dynamodb' && !/^(Get|List|Describe|Head|Query|Scan|Admin(Get|List))/.test(c.op ?? '')));
/** Rows (any table) that differ between two worlds, as plain values with the table name. */
export function changedRows(before: Tables, after: Tables): Record<string, any>[] {
  const out: Record<string, any>[] = [];
  for (const tb of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const was = new Set((before[tb] ?? []).map((x) => JSON.stringify(x)));
    for (const x of after[tb] ?? []) if (!was.has(JSON.stringify(x))) out.push({ table: tb, ...plain(x) });
    const now = new Set((after[tb] ?? []).map((x) => JSON.stringify(x)));
    for (const x of before[tb] ?? []) if (!now.has(JSON.stringify(x))) out.push({ table: tb, removed: true, ...plain(x) });
  }
  return out;
}
export const sagaOf = (t: Tables, id: string) => rowsOf(t, TABLE.state).find((r) => r['PK'] === `CANDIDATE#${id}` && r['SK'] === 'SAGA');

// ---------------------------------------------------------------- code as text

export const CORE = join(LAMBDA, 'shared', 'recruitment-actions', 'roles.mjs');
export const handlerFolderFiles = (name = HANDLER) => (existsSync(join(LAMBDA, name)) ? readdirSync(join(LAMBDA, name)).filter((f) => /\.(m?js|cjs)$/.test(f) && !/\.test\./.test(f)).map((f) => join(LAMBDA, name, f)) : []);
export const SEED = join(REPO, 'scripts', 'ci', 'seed-dev.py');
export const SEED_RUN = join(__dirname, 'seed-run.py');
export { A, B, D, SUB, TABLE, TENANTS, fileOf, readFileSync };
