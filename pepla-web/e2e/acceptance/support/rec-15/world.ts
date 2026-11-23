import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { httpEvent, runHandler, type Failure, type Row, type Run, type Tables } from '../rec-14/lambda-harness';
import { A, AGENT_SECRET, B, D, SUB, TABLE, TENANTS, authorizerOf, av, fileOf, plain, rowsOf, saga, settings, type Caller } from '../rec-04/world';
import { R, ROLES_TABLE, pool, roleRow, world as world4 } from '../rec-04/roles';

/**
 * REC-15 step A: the world of the candidate lists (spec Part 1, rules 1 to 11, AC-1 to AC-6). Nothing here is application code.
 *
 * It is REC-04's world (companies A and B hold the real Standard pack and REC-04's roles; D has Recruitment off) with every candidate row
 * replaced by this card's, and each company's stage hours (SLA_THRESHOLDS) set here so a test can say exactly how much of a stage is used.
 * Every run happens at one fixed time (NOW, through ./clock.mjs), so "74 percent used" is exact.
 *
 * Company A's hours: Applied 24, Screening 48, Interview 100, Offer 72. The row also holds keys that must not change anything: HIRED and
 * NOT_HIRED (a closed stage has no clock), riskPoints 10/20/30 (the points are 75 and 100, D-REC-15.1, not the company's riskPoints),
 * stageLimitHours and feedbackDueHours (not a stage). Company B's hours are 10 for every open stage, so a B candidate 10 hours into Applied
 * is overdue by B's hours and on track by A's.
 *
 * The candidates of A (hours are before NOW; "due" is hours after NOW, negative when past):
 *   a1 Applied, Fleet, hmA, 10h in (due +14, on track), its email is the only place the text "zz-unique-mail" appears
 *   a2 Applied, Fleet, hmA, 18h in (75 percent: due soon)          s1 Screening, Fleet, hmA, 47.52h in (99 percent: due soon)
 *   s2 Screening, Warehouse, hm2A, 48h in (100 percent: overdue)    i1 Interview, Fleet, hmA, 74h in (74 percent: on track; stored BREACHED)
 *   i2 PANEL_INTERVIEW (old name), Fleet, hmA, 75h in (due soon)    o1 Offer, Warehouse, hm2A, 250h in (overdue)
 *   o2 Offer, Fleet, hmA, no stageEnteredAt, created 80h ago (overdue from createdAt)
 *   h1 Hired, Fleet, hmA, 120h in      h2 Hired, the closed role, hm2A, 48h in      h3 ONBOARDING (old name, Hired), no role, hmA, 30h in
 *   n1 Not hired, Fleet, hmA, 24h in   n2 EVALUATION with status REJECTED (old outcome, Not hired), Warehouse, hm2A, 72h in
 *   r0 Applied, no role_id, hmA, 2h in, title "Junior baker", no appliedDate (applied_at is createdAt)
 *   g1 Applied, a role id no role row has, hmA, 3h in, title "Pastry chef"
 *   ad Applied, Fleet, hiring manager hm2A, added_by the Recruiter recA, source "Referral", 5h in
 *   rc Screening, Fleet, hmA, 6h in, recruiterId recA (the old field: not "mine" for recA, rule 8)
 *   x1 Applied, Fleet, in A's GSI1 partition but stamped tenant_id B (a stray row): never shown to anyone
 * Every candidate row carries a phone and an ID number, and an email, so a list that sends any of them is caught.
 * Fleet candidates are stored with positionTitle "Fleet ctrl (old title)", so a role_title taken from the row is caught.
 * Company B: b1 Applied on B's role, hmB, added_by recB, 10h in (overdue by B's hours); bA Applied, carries A's Fleet role id, 1h in.
 */
export { A, B, D, SUB, TABLE, TENANTS, R, ROLES_TABLE, av, plain, roleRow, rowsOf };
export type { Run, Tables, Failure, Row };

export const NOW = '2026-11-23T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);
/** The time `h` hours before NOW, as DynamoDB stores times here. */
export const ago = (h: number) => new Date(NOW_MS - Math.round(h * 3_600_000)).toISOString();
/** The time `h` hours after NOW (h may be negative). */
export const after = (h: number) => new Date(NOW_MS + Math.round(h * 3_600_000)).toISOString();

export const HOURS_A = { APPLIED: 24, SCREENING: 48, INTERVIEW: 100, OFFER: 72 } as const;
export const THRESHOLDS_A = {
  ...HOURS_A, HIRED: 5, NOT_HIRED: 5, riskPoints: [10, 20, 30], stageLimitHours: { JUNIOR: 1, MID: 1, SENIOR: 1 }, feedbackDueHours: 1, engagementLimitDays: 7,
};
export const THRESHOLDS_B = { APPLIED: 10, SCREENING: 10, INTERVIEW: 10, OFFER: 10, feedbackDueHours: 48 };
/**
 * The old-name form of the hours (REC-03 rule): several old names became one stage, the longest counts. INTERVIEW is also given a new-name
 * key of 20 that the old names outrank (the monitor takes the largest). Applied 24, Screening 30, Interview 100, Offer 72.
 */
export const THRESHOLDS_OLD = {
  APPLICATION_REVIEW: 24, PHONE_SCREENING: 30, TECHNICAL_INTERVIEW: 60, PANEL_INTERVIEW: 100, INTERVIEW: 20, OFFER_PREPARATION: 50, OFFER_DELIVERY: 72,
  stageLimitHours: { JUNIOR: 72, MID: 72, SENIOR: 72 }, feedbackDueHours: 48,
};

export const K = {
  a1: 'CAND-15REC15A1AAAAAAAAAAAAA1', a2: 'CAND-15REC15A2AAAAAAAAAAAAA1', s1: 'CAND-15REC15S1AAAAAAAAAAAAA1', s2: 'CAND-15REC15S2AAAAAAAAAAAAA1',
  i1: 'CAND-15REC15I1AAAAAAAAAAAAA1', i2: 'CAND-15REC15I2AAAAAAAAAAAAA1', o1: 'CAND-15REC15O1AAAAAAAAAAAAA1', o2: 'CAND-15REC15O2AAAAAAAAAAAAA1',
  h1: 'CAND-15REC15H1AAAAAAAAAAAAA1', h2: 'CAND-15REC15H2AAAAAAAAAAAAA1', h3: 'CAND-15REC15H3AAAAAAAAAAAAA1',
  n1: 'CAND-15REC15N1AAAAAAAAAAAAA1', n2: 'CAND-15REC15N2AAAAAAAAAAAAA1',
  r0: 'CAND-15REC15R0AAAAAAAAAAAAA1', g1: 'CAND-15REC15G1AAAAAAAAAAAAA1', ad: 'CAND-15REC15ADAAAAAAAAAAAAA1', rc: 'CAND-15REC15RCAAAAAAAAAAAAA1',
  x1: 'CAND-15REC15X1AAAAAAAAAAAAA1',
  b1: 'CAND-15REC15B1BBBBBBBBBBBBB1', bA: 'CAND-15REC15BABBBBBBBBBBBBB1',
};
type Fix = {
  first: string; last: string; company: string; stage: string; status?: string; role?: string | null; hm: string; entered?: number; created?: number;
  sla?: string; title?: string; level?: string; extra?: Record<string, any>;
  /** What a read must give (for A's and B's own callers): the stage code, the status, and the hours of the clock (null: no clock). */
  want?: { stage: string; sla: string | null; hours: number | null };
};
export const FIX: Record<string, Fix> = {
  [K.a1]: { first: 'Amahle', last: 'Dlamini', company: A, stage: 'APPLIED', role: R.fleet, hm: SUB.hmA, entered: 10, extra: { email: 'zz-unique-mail@example.test', appliedDate: ago(11.5) }, want: { stage: 'APPLIED', sla: 'ON_TRACK', hours: 24 } },
  [K.a2]: { first: 'Tariro', last: 'Moyo', company: A, stage: 'APPLIED', role: R.fleet, hm: SUB.hmA, entered: 18, want: { stage: 'APPLIED', sla: 'DUE_SOON', hours: 24 } },
  [K.s1]: { first: 'Tendai', last: 'Ncube', company: A, stage: 'SCREENING', role: R.fleet, hm: SUB.hmA, entered: 47.52, want: { stage: 'SCREENING', sla: 'DUE_SOON', hours: 48 } },
  [K.s2]: { first: 'Lwazi', last: 'Buthelezi', company: A, stage: 'SCREENING', role: R.warehouse, hm: SUB.hm2A, entered: 48, level: 'SENIOR', want: { stage: 'SCREENING', sla: 'OVERDUE', hours: 48 } },
  [K.i1]: { first: 'Kagiso', last: 'Molefe', company: A, stage: 'INTERVIEW', role: R.fleet, hm: SUB.hmA, entered: 74, sla: 'BREACHED', want: { stage: 'INTERVIEW', sla: 'ON_TRACK', hours: 100 } },
  [K.i2]: { first: 'Bongani', last: 'Mthembu', company: A, stage: 'PANEL_INTERVIEW', role: R.fleet, hm: SUB.hmA, entered: 75, want: { stage: 'INTERVIEW', sla: 'DUE_SOON', hours: 100 } },
  [K.o1]: { first: 'Zanele', last: 'Pillay', company: A, stage: 'OFFER', role: R.warehouse, hm: SUB.hm2A, entered: 250, level: 'SENIOR', want: { stage: 'OFFER', sla: 'OVERDUE', hours: 72 } },
  [K.o2]: { first: 'Ayanda', last: 'Mkhize', company: A, stage: 'OFFER', role: R.fleet, hm: SUB.hmA, created: 80, want: { stage: 'OFFER', sla: 'OVERDUE', hours: 72 } },
  [K.h1]: { first: 'Lindiwe', last: 'Khoza', company: A, stage: 'HIRED', role: R.fleet, hm: SUB.hmA, entered: 120, want: { stage: 'HIRED', sla: null, hours: null } },
  [K.h2]: { first: 'Pule', last: 'Maseko', company: A, stage: 'HIRED', role: R.closed, hm: SUB.hm2A, entered: 48, want: { stage: 'HIRED', sla: null, hours: null } },
  [K.h3]: { first: 'Naledi', last: 'Sithole', company: A, stage: 'ONBOARDING', role: null, hm: SUB.hmA, entered: 30, title: 'Bakery assistant', want: { stage: 'HIRED', sla: null, hours: null } },
  [K.n1]: { first: 'Nomvula', last: 'Zulu', company: A, stage: 'NOT_HIRED', role: R.fleet, hm: SUB.hmA, entered: 24, extra: { not_hired_reason: 'WITHDREW' }, want: { stage: 'NOT_HIRED', sla: null, hours: null } },
  [K.n2]: { first: 'Farai', last: 'Moyo', company: A, stage: 'EVALUATION', status: 'REJECTED', role: R.warehouse, hm: SUB.hm2A, entered: 72, level: 'SENIOR', want: { stage: 'NOT_HIRED', sla: null, hours: null } },
  [K.r0]: { first: 'Karabo', last: 'Jacobs', company: A, stage: 'APPLIED', role: null, hm: SUB.hmA, entered: 2, title: 'Junior baker', extra: { appliedDate: undefined }, want: { stage: 'APPLIED', sla: 'ON_TRACK', hours: 24 } },
  [K.g1]: { first: 'Sibusiso', last: 'Nkosi', company: A, stage: 'APPLIED', role: R.none, hm: SUB.hmA, entered: 3, title: 'Pastry chef', want: { stage: 'APPLIED', sla: 'ON_TRACK', hours: 24 } },
  [K.ad]: { first: 'Precious', last: 'Ndlovu', company: A, stage: 'APPLIED', role: R.fleet, hm: SUB.hm2A, entered: 5, extra: { added_by: SUB.recA, source: 'Referral' }, want: { stage: 'APPLIED', sla: 'ON_TRACK', hours: 24 } },
  [K.rc]: { first: 'Musa', last: 'Zwane', company: A, stage: 'SCREENING', role: R.fleet, hm: SUB.hmA, entered: 6, extra: { recruiterId: SUB.recA }, want: { stage: 'SCREENING', sla: 'ON_TRACK', hours: 48 } },
  [K.x1]: { first: 'Stray', last: 'Rowperson', company: A, stage: 'APPLIED', role: R.fleet, hm: SUB.hmA, entered: 1, extra: { tenant_id: B, tenantId: B } },
  [K.b1]: { first: 'Hlengiwe', last: 'Sibiya', company: B, stage: 'APPLIED', role: R.b, hm: SUB.hmB, entered: 10, extra: { added_by: SUB.recB }, want: { stage: 'APPLIED', sla: 'OVERDUE', hours: 10 } },
  [K.bA]: { first: 'Mandla', last: 'Cele', company: B, stage: 'APPLIED', role: R.fleet, hm: SUB.hmB, entered: 1, want: { stage: 'APPLIED', sla: 'ON_TRACK', hours: 10 } },
};
export const ROLE_TITLE: Record<string, string> = { [R.fleet]: 'Fleet controller', [R.warehouse]: 'Warehouse supervisor', [R.closed]: 'Old till role', [R.b]: 'Dispatch lead' };
export const fullName = (id: string) => `${FIX[id]!.first} ${FIX[id]!.last}`;
export const emailOf = (id: string, f: Fix = FIX[id]!) => f.extra?.['email'] ?? `${f.first}.${f.last}`.toLowerCase() + '@example.test';
/** The phone and ID number every candidate row carries (the list must never send them). */
export const phoneOf = (id: string) => `+27 82 555 ${id.slice(12, 16).replace(/\D/g, '0').padEnd(4, '0')}`;
export const idNumberOf = (id: string) => `80010150${String(Object.keys(FIX).indexOf(id)).padStart(5, '0')}`;

/** A candidate row as stored today (REC-04's saga shape), from a fixture line. */
export function candidateRow(id: string, f: Fix): Row {
  const createdAt = f.created !== undefined ? ago(f.created) : ago((f.entered ?? 0) + 1);
  const extra: Record<string, any> = {
    currentStage: f.stage, status: f.status ?? 'ACTIVE', slaStatus: f.sla ?? 'ON_TRACK', positionTitle: f.title ?? (f.role && ROLE_TITLE[f.role] ? 'Fleet ctrl (old title)' : 'A role'),
    positionLevel: f.level ?? 'MID', createdAt, appliedDate: createdAt, stageEnteredAt: f.entered === undefined ? undefined : ago(f.entered),
    GSI1SK: `SAGA#${createdAt}`, phone: phoneOf(id), idNumber: idNumberOf(id), ...(f.role ? { role_id: f.role } : {}), ...(f.extra ?? {}),
  };
  if (f.role && f.role !== R.fleet) extra['positionTitle'] = f.title ?? 'A role';
  const row = saga(id, f.first, f.last, f.company, f.hm, extra);
  if (!('email' in (f.extra ?? {}))) row['email'] = { S: emailOf(id, f) };
  if (f.extra && 'appliedDate' in f.extra && f.extra['appliedDate'] === undefined) delete row['appliedDate'];
  if (f.entered === undefined) delete row['stageEnteredAt'];
  return row;
}
export const candidateRows = (ids = Object.keys(FIX)) => ids.map((id) => candidateRow(id, FIX[id]!));

const isSaga = (r: Row) => plain(r)['SK'] === 'SAGA';
/** Replaces company `c`'s active SLA_THRESHOLDS data (or removes the setting when `data` is null). */
export function withThresholds(t: Tables, c: string, data: Record<string, unknown> | null): Tables {
  const out = structuredClone(t);
  const mine = (r: Row) => { const p = plain(r); return p['PK'] === `TENANT#${c}` && String(p['SK']).startsWith('CONFIG#SLA_THRESHOLDS'); };
  const rest = (out[TABLE.config] ?? []).filter((r) => !mine(r));
  if (data === null) { out[TABLE.config] = rest; return out; }
  const row = av({
    PK: `TENANT#${c}`, SK: 'CONFIG#SLA_THRESHOLDS#v1', GSI1PK: `TENANT#${c}#ACTIVE`, GSI1SK: 'CONFIG#SLA_THRESHOLDS', tenant_id: c, tenantId: c,
    configType: 'SLA_THRESHOLDS', version: 1, isActive: true, data: data as any, createdAt: '2026-11-01T08:00:00.000Z',
  });
  out[TABLE.config] = [...rest, row];
  return out;
}

/** REC-04's world with this card's candidates in place of every candidate row, and the hours above. */
export function world(): Tables {
  const t = world4();
  t[TABLE.state] = [...(t[TABLE.state] ?? []).filter((r) => !isSaga(r)), ...candidateRows()];
  return withThresholds(withThresholds(t, A, THRESHOLDS_A), B, THRESHOLDS_B);
}
/** The same world with these candidate rows added (each a plain row). */
export function withRows(t: Tables, rows: Row[]): Tables {
  const out = structuredClone(t);
  out[TABLE.state] = [...(out[TABLE.state] ?? []), ...rows];
  return out;
}
/** The same world with one stored candidate changed (plain values merged; `undefined` removes a field). */
export function withCandidate(t: Tables, id: string, change: Record<string, any>): Tables {
  const out = structuredClone(t);
  out[TABLE.state] = (out[TABLE.state] ?? []).map((r) => {
    const p = plain(r);
    if (p['PK'] !== `CANDIDATE#${id}` || p['SK'] !== 'SAGA') return r;
    const merged: Record<string, any> = { ...p, ...change };
    for (const [k, v] of Object.entries(change)) if (v === undefined) delete merged[k];
    return av(merged);
  });
  return out;
}
/** The same world with one role changed (plain values merged). */
export function withRole(t: Tables, c: string, id: string, change: Record<string, any>): Tables {
  const out = structuredClone(t);
  out[ROLES_TABLE] = (out[ROLES_TABLE] ?? []).map((r) => {
    const p = plain(r);
    return p['role_id'] === id && p['tenant_id'] === c ? av({ ...p, ...change }) : r;
  });
  return out;
}
/**
 * `n` more candidates of company A (ids CAND-15MANY<prefix><n>): stages cycle through Applied, Screening, Interview, Offer and Hired; their times
 * repeat every 7 rows so many share a due date (the order then falls back on the id). Hiring manager hmA unless given.
 */
export function many(n: number, o: { prefix?: string; role?: string | null; hm?: string; company?: string } = {}): Row[] {
  const stages = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED'];
  const out: Row[] = [];
  for (let i = 0; i < n; i++) {
    const id = `CAND-15MANY${o.prefix ?? 'X'}${String(i).padStart(10, '0')}`;
    const f: Fix = {
      first: 'Many', last: `Person${o.prefix ?? 'X'}${i}`, company: o.company ?? A, stage: stages[i % 5]!, role: o.role === undefined ? R.fleet : o.role, hm: o.hm ?? SUB.hmA,
      entered: 1 + ((i * 37) % 7) * 11,
    };
    out.push(candidateRow(id, f));
  }
  return out;
}

// ---------------------------------------------------------------- runs

export const CLOCK = join(__dirname, 'clock.mjs');
/** The environment of a run at NOW (or another time). */
export const clockEnv = (now = NOW): Record<string, string> => ({ NODE_OPTIONS: `--import=${pathToFileURL(CLOCK).href}`, REC15_NOW: now });

export type Ask = { query?: Record<string, string>; headers?: Record<string, string>; claims?: Record<string, unknown>; path?: Record<string, string>; body?: unknown };
export type Opts = { fail?: Failure; queryPageSize?: number; now?: string; env?: Record<string, string> };

/** Runs one route of a Lambda as `caller`, at NOW, as API Gateway (HTTP API, payload 2.0) hands it over. */
export function runRoute(handler: string, route: string, caller: Caller, a: Ask, t: Tables, o: Opts = {}): Run {
  const [method, template] = route.split(' ') as [string, string];
  const path = a.path?.['id'] ? template.replace('{id}', a.path['id']) : template;
  const event = httpEvent({ authorizer: authorizerOf(caller, a.claims ?? {}), path: a.path, query: a.query, headers: a.headers, body: a.body });
  event.routeKey = route;
  event.rawPath = path;
  event.requestContext.routeKey = route;
  event.requestContext.http.method = method;
  event.requestContext.http.path = path;
  return runHandler(fileOf(handler), event, {
    tables: t, secrets: { [AGENT_SECRET]: { AWSCURRENT: 'rec15-agent-key' } }, cognito: { users: pool() },
    env: { ...settings({ ROLES_TABLE_NAME: ROLES_TABLE }), ...clockEnv(o.now), ...(o.env ?? {}) },
    ...(o.fail ? { fail: o.fail } : {}), ...(o.queryPageSize ? { queryPageSize: o.queryPageSize } : {}),
  });
}
/** GET /v1/candidates with this query. */
export const list = (who: Caller, query: Record<string, string>, t: Tables, o: Opts & { headers?: Record<string, string>; path?: Record<string, string> } = {}) =>
  runRoute('getCandidates', 'GET /v1/candidates', who, { query, headers: o.headers, path: o.path }, t, o);
/** GET /v1/roles (REC-04's route, rule 11). */
export const roles = (who: Caller, t: Tables, o: Opts = {}) => runRoute('manageRoles', 'GET /v1/roles', who, {}, t, o);
export const role = (who: Caller, id: string, t: Tables, o: Opts = {}) => runRoute('manageRoles', 'GET /v1/roles/{id}', who, { path: { id } }, t, o);

/** Runs the hourly SLA job (monitorTalentFlowSLAs) once at NOW against the world. */
export function runMonitor(t: Tables, now = NOW): Run {
  return runHandler(fileOf('monitorTalentFlowSLAs'), { source: 'aws.events', 'detail-type': 'Scheduled Event', detail: {} }, {
    tables: t, secrets: {}, cognito: { users: [] }, env: { ...settings(), ...clockEnv(now) },
  });
}
/** What the SLA job wrote: candidate id -> the stored status it set (AT_RISK or BREACHED). */
export function monitorVerdicts(r: Run): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of r.calls as any[]) {
    if (c.service !== 'dynamodb' || c.op !== 'UpdateItem') continue;
    const pk = c.input?.Key?.PK?.S as string | undefined;
    const status = c.input?.ExpressionAttributeValues?.[':status']?.S as string | undefined;
    if (pk && status) out[pk.replace(/^CANDIDATE#/, '')] = status;
  }
  return out;
}
