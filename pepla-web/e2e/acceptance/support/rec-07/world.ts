import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { httpEvent, runHandler, type Row, type Run, type Tables } from '../rec-14/lambda-harness';
import { A, B, SUB as SUB02, TABLE as TABLE02, authorizerOf, av, fileOf, packTables, plain, saga, settings, type Caller } from '../rec-02/world';

/**
 * REC-07: the world of the scoring card (spec onboarding-cards/specs/REC-07.md). It runs the real handlers in a fresh Node process each
 * call against REC-14's fake AWS (support/rec-14/fake-aws, unchanged), over REC-02's company rows and the real Standard pack for company
 * A (support/rec-02/world.ts packTables), with this card's role, candidates, interviews, an old 0 to 10 vote and today's scoring links.
 * Every run happens at one fixed time (NOW) through REC-15's clock preload (support/rec-15/clock.mjs). All names are made up.
 *
 *   Company A, role R7 "Sales consultant" (MID), criteria sales, comms, product.
 *     V   Thandi Nkosi, role R7, hiring manager hmA, in Interview. Interviews:
 *           I1 TECHNICAL, panel m1 m2 m3, snapshot = R7's criteria.
 *           I2 BEHAVIORAL, panel m1 m2 m3, snapshot = lead, comms (its own criteria: an interview keeps what it was scheduled with).
 *           I0 PHONE_SCREEN, COMPLETED before this card: no snapshot, one old 0 to 10 vote by m1 (legacy).
 *     W   Musa Zulu, no role, hiring manager hmA, in Interview, no interview yet (scheduling takes the company's default criteria).
 *     X   Ayanda Mokoena, role R7, in Interview, no interview yet (scheduling takes R7's criteria).
 *   Company B, VB Bongi Mahlangu with interview IB (panel mB).
 *   Scoring links in today's shape (raw token in the key): one valid for I1 (made before this card, still works until it expires),
 *   one expired, and one that names company A but B's interview (a forged row).
 */
export { A, B, av, plain };
export type { Caller, Row, Run, Tables };

/** The fixed time of every run (REC-15's clock). */
export const NOW = '2026-11-24T08:00:00.000Z';
const CLOCK = join(__dirname, '..', 'rec-15', 'clock.mjs');
export const DAY = 86_400_000;

export const TABLE = { ...TABLE02, roles: 'talent-flow-roles' };
export const ROLES_TABLE = TABLE.roles;

export const SUB = {
  ...SUB02,
  m1: 'sub-rec07-m1', m2: 'sub-rec07-m2', m3: 'sub-rec07-m3', mB: 'sub-rec07-mb',
  outsider: 'sub-rec07-outsider',
};
export const K = {
  v: 'CAND-REC07AAAAAAAAAAAAAAAAV1',
  w: 'CAND-REC07AAAAAAAAAAAAAAAAW1',
  x: 'CAND-REC07AAAAAAAAAAAAAAAAX1',
  vb: 'CAND-REC07BBBBBBBBBBBBBBBVB1',
  i0: 'iv-rec07-a-0', i1: 'iv-rec07-a-1', i2: 'iv-rec07-a-2', ib: 'iv-rec07-b-1',
  r7: 'role-rec07-sales', rb: 'role-rec07-b',
  /** Today's link rows (raw token in the key), made before this card. */
  oldToken: 'Q7mWf2Lr9xTt4VbN8cYp3HsK6dZa1EgUj5RoXiPq0w',
  oldExpiredToken: 'Lr9xTt4VbN8cYp3HsK6dZa1EgUj5RoXiPq0wQ7mWf2',
  forgedToken: 'N8cYp3HsK6dZa1EgUj5RoXiPq0wQ7mWf2Lr9xTt4Vb',
};
export const R7_CRITERIA = [{ key: 'sales', label: 'Sales experience' }, { key: 'comms', label: 'Communication' }, { key: 'product', label: 'Product knowledge' }];
export const I2_CRITERIA = [{ key: 'lead', label: 'Leadership' }, { key: 'comms', label: 'Communication' }];
/** The Standard pack's default criteria (REC-12, SCORING_WEIGHTS.defaultCriteria). */
export const DEFAULT_KEYS = ['technical', 'communication', 'culturalFit', 'problemSolving'];
export const SCHEDULED_AT = { i0: '2026-11-12T09:00:00.000Z', i1: '2026-11-20T09:00:00.000Z', i2: '2026-11-23T13:00:00.000Z', ib: '2026-11-21T09:00:00.000Z' };

const company = (c: string) => ({ tenant_id: c, tenantId: c });
type Plain = Parameters<typeof av>[0][string];

export function roleRow(c: string, id: string, hm: string, criteria = R7_CRITERIA, extra: Record<string, Plain> = {}): Row {
  return av({
    pk: `TENANT#${c}`, sk: `ROLE#${id}`, tenant_id: c, role_id: id, job_title: c === A ? 'Sales consultant' : 'Driver', department: 'Sales', level: 'MID',
    hiring_manager_id: hm, criteria, panel_size: 3, status: 'OPEN', opened_at: '2026-11-01T08:00:00.000Z', opened_by: c === A ? SUB.recA : SUB.recB, legacy: false, ...extra,
  });
}
export function interviewRow(cand: string, iv: string, c: string, type: string, at: string, panel: string[], criteria: { key: string; label: string }[] | undefined, extra: Record<string, Plain> = {}): Row {
  return av({
    PK: `CANDIDATE#${cand}`, SK: `INTERVIEW#${iv}`, interviewId: iv, candidateId: cand, ...company(c), interviewType: type, scheduledAt: at, panelMemberIds: panel,
    votesRequired: panel.length, votesSubmitted: 0, status: 'SCHEDULED', createdAt: '2026-11-10T08:00:00.000Z', ...(criteria ? { criteria_snapshot: criteria } : {}), ...extra,
  });
}
/** A vote row as today's code wrote it (four criteria, 0 to 10, weighted). */
export function oldVoteRow(cand: string, iv: string, c: string, voter: string): Row {
  return av({
    PK: `CANDIDATE#${cand}`, SK: `VOTE#${voter}#2026-11-12T10:00:00.000Z`, voterId: voter, candidateId: cand, interviewId: iv, ...company(c), rating: 'STRONG_YES',
    scores: { technical: 9, communication: 8, culturalFit: 7, problemSolving: 9 }, weightedScore: 8.4, configVersionUsed: '1', createdAt: '2026-11-12T10:00:00.000Z',
  });
}
/** A scoring link row as today's generateScoringLink writes it (raw token in the key and in a field). */
export function oldLinkRow(token: string, cand: string, iv: string, c: string, ttlSec: number, expiresAt: string): Row {
  return av({
    PK: `SCORING_LINK#${token}`, SK: 'META', token, candidateId: cand, ...company(c), panelMemberId: 'guest-old-1', panelMemberEmail: 'pieter.guest@example.test',
    panelMemberName: 'Pieter Guest', panelMemberRole: 'Area manager', interviewId: iv, used: false, createdBy: SUB.recA, createdAt: '2026-11-20T08:00:00.000Z', expiresAt, ttl: ttlSec,
  });
}

let base: Tables | undefined;
/** The seeded world: REC-02's companies, the Standard pack for A, and this card's rows. Each call hands back its own copy. */
export function world(): Tables {
  if (!base) {
    const t = packTables();
    const nowSec = Date.parse(NOW) / 1000;
    t[TABLE.state] = [
      ...(t[TABLE.state] ?? []),
      saga(K.v, 'Thandi', 'Nkosi', A, SUB.hmA, { role_id: K.r7, positionTitle: 'Sales consultant', positionLevel: 'MID', currentStage: 'INTERVIEW', stageEnteredAt: '2026-11-11T08:00:00.000Z' }),
      saga(K.w, 'Musa', 'Zulu', A, SUB.hmA, { positionTitle: 'Junior baker', positionLevel: 'MID', currentStage: 'INTERVIEW', stageEnteredAt: '2026-11-11T08:00:00.000Z' }),
      saga(K.x, 'Ayanda', 'Mokoena', A, SUB.hmA, { role_id: K.r7, positionTitle: 'Sales consultant', positionLevel: 'MID', currentStage: 'INTERVIEW', stageEnteredAt: '2026-11-11T08:00:00.000Z' }),
      saga(K.vb, 'Bongi', 'Mahlangu', B, SUB.hmB, { role_id: K.rb, positionTitle: 'Driver', positionLevel: 'MID', currentStage: 'INTERVIEW', stageEnteredAt: '2026-11-11T08:00:00.000Z' }),
      interviewRow(K.v, K.i0, A, 'PHONE_SCREEN', SCHEDULED_AT.i0, [SUB.m1], undefined, { status: 'COMPLETED', votesRequired: 1, votesSubmitted: 1 }),
      interviewRow(K.v, K.i1, A, 'TECHNICAL', SCHEDULED_AT.i1, [SUB.m1, SUB.m2, SUB.m3], R7_CRITERIA),
      interviewRow(K.v, K.i2, A, 'BEHAVIORAL', SCHEDULED_AT.i2, [SUB.m1, SUB.m2, SUB.m3], I2_CRITERIA),
      interviewRow(K.vb, K.ib, B, 'TECHNICAL', SCHEDULED_AT.ib, [SUB.mB], R7_CRITERIA),
      oldVoteRow(K.v, K.i0, A, SUB.m1),
      oldLinkRow(K.oldToken, K.v, K.i1, A, nowSec + 3 * 86400, new Date(Date.parse(NOW) + 3 * DAY).toISOString()),
      oldLinkRow(K.oldExpiredToken, K.v, K.i1, A, nowSec - 86400, new Date(Date.parse(NOW) - DAY).toISOString()),
      oldLinkRow(K.forgedToken, K.vb, K.ib, A, nowSec + 3 * 86400, new Date(Date.parse(NOW) + 3 * DAY).toISOString()),
    ];
    t[TABLE.roles] = [roleRow(A, K.r7, SUB.hmA), roleRow(B, K.rb, SUB.hmB)];
    // The people of this card belong to company A (B for mB), as the company list says.
    t['naleko-people-dev-tenants'] = [
      ...(t['naleko-people-dev-tenants'] ?? []),
      ...[SUB.m1, SUB.m2, SUB.m3, SUB.outsider].map((s) => av({ pk: `USER#${s}`, sk: `TENANT#${A}`, tenant_id: A })),
      av({ pk: `USER#${SUB.mB}`, sk: `TENANT#${B}`, tenant_id: B }),
    ];
    base = t;
  }
  return structuredClone(base);
}

/** Changes the data of company A's settings of one type (every version), the way a company's own choice would. */
export function withSetting(t: Tables, type: string, change: (data: any) => any): Tables {
  const out = structuredClone(t);
  out[TABLE.config] = (out[TABLE.config] ?? []).map((r) => {
    const p = plain(r);
    if (p['configType'] !== type || p['tenant_id'] !== A) return r;
    return { ...r, data: av({ data: change(structuredClone(p['data'])) })['data']! };
  });
  return out;
}

// ---------------------------------------------------------------- callers

const p = (name: string, groups: string[], sub: string, extra: Partial<Caller> = {}): Caller => ({ name, groups, sub, ...extra });
export const C = {
  recruiter: p('Recruiter', ['hr_staff', 'perm-recruitment'], SUB.recA),
  hm: p('Hiring manager of the candidate', ['manager'], SUB.hmA),
  otherHm: p('Manager of another role', ['manager'], SUB.hm2A),
  m1: p('Panel member 1 (employee)', ['employee'], SUB.m1),
  m2: p('Panel member 2 (employee)', ['employee'], SUB.m2),
  m3: p('Panel member 3 (manager, on the panel)', ['manager'], SUB.m3),
  outsider: p('Employee on no panel', ['employee'], SUB.outsider),
  recruiterB: p('Recruiter of B', ['hr_staff', 'perm-recruitment'], SUB.recB, { company: 'B' }),
  mB: p('Panel member of B', ['employee'], SUB.mB, { company: 'B' }),
  recruiterD: p('Recruiter of D (Recruitment off)', ['hr_staff', 'perm-recruitment'], 'sub-rec07-recD', { company: 'D' }),
  noCompany: p('Recruiter with no company', ['hr_staff', 'perm-recruitment'], 'sub-rec07-nocompany', { company: null as any }),
} satisfies Record<string, Caller>;

// ---------------------------------------------------------------- runs

export type Ask = { method: string; route: string; path?: Record<string, string>; query?: Record<string, string>; body?: unknown; headers?: Record<string, string> };

/** Company B named in every header and query parameter a handler might wrongly read the company from (REC-00: never from input). */
export const FORGED_HEADERS: Record<string, string> = { 'x-tenant-id': B, 'X-Tenant-Id': B, 'x-company-id': B, 'tenant-id': B, tenant_id: B };
export const FORGED_QUERY: Record<string, string> = { tenant_id: B, tenantId: B, company_id: B, companyId: B };
let forging = false;
/** Runs `fn` with FORGED_HEADERS and FORGED_QUERY added to every call it makes (the calls are synchronous). */
export function forged<T>(fn: () => T): T {
  forging = true;
  try { return fn(); } finally { forging = false; }
}
/** Every call made through ask/askPublic, with what was sent, so a test can look through all its log lines at once. */
export const seen: { run: Run; body: unknown }[] = [];

function routed(a0: Ask, authorizer: unknown) {
  const a = forging ? { ...a0, headers: { ...FORGED_HEADERS, ...(a0.headers ?? {}) }, query: { ...FORGED_QUERY, ...(a0.query ?? {}) } } : a0;
  const event = httpEvent({ authorizer, path: a.path, query: a.query, body: a.body, headers: a.headers });
  const raw = a.route.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(a.path?.[k] ?? ''));
  event.routeKey = `${a.method} ${a.route}`;
  event.rawPath = raw;
  event.requestContext.routeKey = `${a.method} ${a.route}`;
  event.requestContext.http.method = a.method;
  event.requestContext.http.path = raw;
  if (authorizer === undefined) delete event.requestContext.authorizer;
  return event;
}
const env = (extra: Record<string, string> = {}) => settings({ ROLES_TABLE_NAME: TABLE.roles, NODE_OPTIONS: `--import=${pathToFileURL(CLOCK).href}`, REC15_NOW: NOW, TOKEN_TTL_DAYS: '7', ...extra });

/** A signed-in caller on one route of one handler. */
export function ask(handler: string, caller: Caller, a: Ask, t: Tables, opts: { fail?: any; env?: Record<string, string> } = {}): Run {
  const run = runHandler(fileOf(handler), routed(a, authorizerOf(caller)), { tables: t, env: env(opts.env), cognito: { users: [] }, ...(opts.fail ? { fail: opts.fail } : {}) });
  seen.push({ run, body: a.body });
  return run;
}
/** A caller with no sign-in (the public scoring link routes). */
export function askPublic(handler: string, a: Ask, t: Tables): Run {
  const run = runHandler(fileOf(handler), routed(a, undefined), { tables: t, env: env(), cognito: { users: [] } });
  seen.push({ run, body: a.body });
  return run;
}
/** An EventBridge event (completeEvaluation reads VotingCompleted). */
export function runEvent(handler: string, event: unknown, t: Tables): Run {
  return runHandler(fileOf(handler), event, { tables: t, env: env(), cognito: { users: [] } });
}

// The routes of this card (D-T-7.1).
export const vote = (who: Caller, iv: string, body: unknown, t: Tables, headers?: Record<string, string>) =>
  ask('submitVote', who, { method: 'POST', route: '/v1/interviews/{id}/votes', path: { id: iv }, body, ...(headers ? { headers } : {}) }, t);
export const sheet = (who: Caller, cand: string, t: Tables) => ask('submitVote', who, { method: 'GET', route: '/v1/candidates/{id}/scores', path: { id: cand } }, t);
export const interviews = (who: Caller, cand: string, t: Tables) => ask('scheduleInterview', who, { method: 'GET', route: '/v1/candidates/{id}/interviews', path: { id: cand } }, t);
export const schedule = (who: Caller, cand: string, body: Record<string, unknown>, t: Tables) =>
  ask('scheduleInterview', who, { method: 'POST', route: '/v1/candidates/{id}/interviews', path: { id: cand }, body }, t);
export const makeLink = (who: Caller, cand: string, body: unknown, t: Tables) =>
  ask('generateScoringLink', who, { method: 'POST', route: '/v1/candidates/{id}/scoring-links', path: { id: cand }, body }, t);
export const readLink = (token: string, t: Tables) => askPublic('submitVoteByToken', { method: 'GET', route: '/v1/scoring-links/{token}', path: { token } }, t);
export const linkVote = (token: string, body: unknown, t: Tables) => askPublic('submitVoteByToken', { method: 'POST', route: '/v1/scoring-links/{token}', path: { token }, body }, t);
/** VotingCompleted as EventBridge hands it to completeEvaluation. */
export const evaluate = (cand: string, t: Tables, averageScore: number | null = 9.9) =>
  runEvent('completeEvaluation', { version: '0', id: 'evt-rec07', 'detail-type': 'VotingCompleted', source: 'talent-flow.workflow', time: NOW, detail: { candidateId: cand, tenant_id: A, result: 'COMPLETED', averageScore, votesSubmitted: 3 } }, t);

// ---------------------------------------------------------------- reading the result

export const bodyOf = (r: { response: any }) => {
  try { return JSON.parse(r.response?.body ?? 'null'); } catch { return r.response?.body; }
};
export const statusOf = (r: Run) => r.response?.statusCode as number | undefined;
export const describe = (r: Run) => `${statusOf(r)} ${JSON.stringify(bodyOf(r)).slice(0, 300)}${r.error ? ` (threw ${r.error.name}: ${r.error.message.slice(0, 200)})` : ''}`;
export const rowsOf = (t: Tables, table: string = TABLE.state) => (t[table] ?? []).map(plain);
export const sagaOf = (t: Tables, cand: string) => rowsOf(t).find((r) => r['PK'] === `CANDIDATE#${cand}` && r['SK'] === 'SAGA') ?? {};
export const interviewOf = (t: Tables, cand: string, iv: string) => rowsOf(t).find((r) => r['PK'] === `CANDIDATE#${cand}` && r['SK'] === `INTERVIEW#${iv}`);
export const votesOf = (t: Tables, cand?: string) => rowsOf(t).filter((r) => String(r['SK'] ?? '').startsWith('VOTE#') && (!cand || r['PK'] === `CANDIDATE#${cand}`));
export const logsOf = (r: Run) => r.calls.filter((c: any) => c.service === 'log').map((c: any) => `${c.message}${c.extra === undefined ? '' : ' ' + JSON.stringify(c.extra)}`);
export const writesOf = (r: Run) => r.calls.filter((c: any) => (c.service === 'dynamodb' && /PutItem|UpdateItem|DeleteItem|BatchWriteItem|TransactWriteItems/.test(c.op)) || /^(events|eventbridge|sqs|lambda|sfn|ses|s3)$/i.test(c.service) && !/^(Get|List|Head)/.test(c.op ?? ''));
/** Every row of every table, as text (to look for a raw token anywhere at rest). */
export const allText = (t: Tables) => JSON.stringify(t);
export const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex');
export const sha256B64u = (s: string) => createHash('sha256').update(s).digest('base64url');
/** A row-by-row difference: the rows of `after` that are new or changed against `before` (key + table). */
export function changed(before: Tables, after: Tables): string[] {
  const out: string[] = [];
  for (const [name, rows] of Object.entries(after)) {
    const was = new Set((before[name] ?? []).map((r) => JSON.stringify(r)));
    for (const r of rows) if (!was.has(JSON.stringify(r))) { const x = plain(r); out.push(`${name} ${x['PK'] ?? x['pk'] ?? ''} ${x['SK'] ?? x['sk'] ?? ''}`); }
  }
  for (const [name, rows] of Object.entries(before)) if ((after[name] ?? []).length < rows.length) out.push(`${name}: a row was removed`);
  return out;
}

/** The AWS calls of a run (not its logs). */
export const awsOf = (r: { calls: any[] }) => r.calls.filter((c: any) => c.service !== 'log' && c.service !== 'step');
/** The calls that read the company list for its modules (MOD-01's requireModule). */
export const isModulesRead = (c: any) => c.service === 'dynamodb' && c.op === 'GetItem' && /tenants$/.test(String(c.table ?? '')) && JSON.stringify(c.input?.Key ?? {}).includes('PROFILE');

/**
 * Log lines of every call since `from` (an index into `seen`) that hold something personal: a vote comment, a vote's scores, a guest
 * email (each as sent in that run's body), or the candidate's name. Logs carry error names only (LESSONS, 15 Nov).
 */
export function personalLogLines(from: number, names: string[] = ['Thandi', 'Nkosi']): string[] {
  const out: string[] = [];
  for (const { run, body } of seen.slice(from)) {
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const secrets = [
      ...(typeof b['comment'] === 'string' && b['comment'].length >= 4 ? [b['comment']] : []),
      ...(b['scores'] && typeof b['scores'] === 'object' ? [JSON.stringify(b['scores'])] : []),
      ...(typeof b['guest_email'] === 'string' ? [b['guest_email']] : []),
      ...names,
    ];
    for (const line of logsOf(run)) if (secrets.some((x) => line.includes(x))) out.push(line.slice(0, 200));
  }
  return out;
}
