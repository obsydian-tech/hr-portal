import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { httpEvent, runHandler, type PoolUser, type Row } from '../rec-14/lambda-harness';
import { AGENT_SECRET, authorizerOf, fileOf, settings, type Caller } from '../rec-04/world';
import { pool as pool4 } from '../rec-04/roles';
import { CLOCK, THRESHOLDS_A, candidateRow, withThresholds } from '../rec-15/world';
import { A, B, NOW, Q, R, SUB, TABLE, TENANTS, ago, av, plain, rowsOf, world as world15c, type Run, type Tables } from '../rec-15c/world';

/**
 * REC-15 step D: the world of the interviews read and the history names (spec Part 4, rules 24 to 28, AC-14 and AC-15, with the spec
 * check's D-1 to D-14 and R2-1 to R2-5). Nothing here is application code.
 *
 * It is REC-15 step C's world (companies A and B with the real Standard pack, REC-04's roles, step C's candidates and their interviews, a
 * fixed clock NOW) with company A's stage hours carrying feedbackDueHours 24, and the people and candidates below added.
 *
 * People (each id is a sign-in sub in the 36-character UUID form unless it says otherwise; "pool" is the fake Naleko sign-in pool):
 *   p1      Member of A. Pool given_name "  Thandi ", family_name "Mokoena " (the name is "Thandi Mokoena"), plus an email, a phone, a
 *           `name` attribute and a preferred_username that must never reach an answer.     Also a caller: a panel member (employee).
 *   p2      Member of A. Pool given_name "Sizwe" only (name "Sizwe").                       Also a caller: a panel member (employee).
 *   p3      Member of A. Pool family_name "Ndlovu" only (name "Ndlovu").
 *   blank   Member of A. In the pool with an email and a `name` attribute but no given or family name: null.
 *   noRow   No Member row. Pool "Naledi Norow". Named only when LEGACY_TENANT_ID is the caller's company (the pickers' rule, D-2).
 *   pB      Member of B. Pool "Bheki Bcompany", email bheki.b@bontle.test (BEMAIL). For an A caller: null, and the pool is never asked.
 *   two     Member of A and of B. Pool "Twofold Person". null, and the pool is never asked.
 *   gone    Member of A, not in the pool (deleted): null.
 *   alias   Member of A. The pool user named by this id answers another sub (ALIAS_SUB): null (R2-1, the sub must match).
 *   stranger No Member row, not in the pool: null.
 *   many[0..50] 51 Members of A, each in the pool as "Many P<n>": the 50-id limit.
 * Not in sign-in form, and so null with no read at all (R2-1, D-7): BEMAIL (company B's person's email, stored as a panel member id) and
 * SUB.panelA ("sub-panel-a", which has a Member row of A and, here only, a pool user "Old Panelname").
 *
 * Candidates added:
 *   dee   Company A, Interview, Fleet controller (MID), hiring manager hmA, an older row (no settingVersions). Interviews, oldest first:
 *         iv1 PHONE_SCREEN COMPLETED 50h ago, panel p1 and p2, guests "  Gift Guest " (gift.guest@outside.test) and "Rec Seven"
 *             (rec.seven@outside.test). Votes: p1; the guest Gift the old way (voterId "Gift.Guest@OUTSIDE.test"); a REC-07 link vote
 *             (voterId GUEST#0123456789abcdef). p2 has not voted.
 *         iv2 TECHNICAL SCHEDULED 10h ago, panel p1, p3, blank, noRow, pB, two, gone, alias, BEMAIL, SUB.panelA, and a guest whose name is
 *             only spaces (blank.guest@outside.test). Votes: p3 (with a comment and scores). The row also stores votesSubmitted,
 *             PANEL_FEEDBACK_PENDING_COUNT, PANEL_SPLIT_FLAG, PANEL_CONSENSUS, criteria_snapshot, tenant_id and a stray key no list names.
 *         iv3 FINAL CANCELLED 5h ago, panel p2 only.
 *         ivB TECHNICAL COMPLETED, panel p1, stored under dee but stamped company B: never shown, never counted.
 *         History: events (actor SYSTEM with the candidate's email in detail, HUMAN, AGENT, system, p1, pB, stranger, noRow, none) and stage
 *         rows (by p2 with a reason; an old row with actor p3; by "sub-rec-a", not in sign-in form).
 *   bee   Company B, Interview on B's role, hiring manager hmB, one interview: panel noRow and pB.
 *   big   Company A, Interview, Fleet controller, one interview SCHEDULED 3h ago with the 51 `many` people.
 */
export { A, B, NOW, Q, R, SUB, TABLE, TENANTS, ago, av, plain, rowsOf };
export type { Run, Tables, Row, Caller };

const uid = (n: number) => `d15d${n.toString(16).padStart(4, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
export const P = {
  p1: uid(1), p2: uid(2), p3: uid(3), blank: uid(4), noRow: uid(5), pB: uid(6), two: uid(7), gone: uid(8), alias: uid(9), stranger: uid(10),
};
export const ALIAS_SUB = uid(99);
export const MANY = Array.from({ length: 51 }, (_x, i) => uid(0x100 + i));
export const BEMAIL = 'bheki.b@bontle.test';
/** The name each person must have for a caller of company A with LEGACY_TENANT_ID set to A (null: no name). */
export const NAME: Record<string, string | null> = {
  [P.p1]: 'Thandi Mokoena', [P.p2]: 'Sizwe', [P.p3]: 'Ndlovu', [P.blank]: null, [P.noRow]: 'Naledi Norow', [P.pB]: null, [P.two]: null, [P.gone]: null,
  [P.alias]: null, [P.stranger]: null, [BEMAIL]: null, [SUB.panelA]: null,
};
/** Everything the pool holds about people besides their given and family names: none of it may reach an answer or a log line. */
export const POOL_OTHER = ['thandi.m@mokoena.test', '+27825550101', 'ZZ Display Name P1', 'zz-preferred-p1', 'blank.person@mokoena.test', 'ZZ Blank Display', 'Bheki', 'Bcompany', 'Twofold', 'Alias Person', 'Old Panelname'];
/** Every name a pool record holds (none may be in a log line). */
export const ALL_NAMES = ['Thandi', 'Mokoena', 'Sizwe', 'Ndlovu', 'Naledi', 'Norow', 'Bheki', 'Bcompany', 'Twofold', 'Alias', 'Old Panelname'];
export const GUEST = {
  gift: { name: '  Gift Guest ', email: 'gift.guest@outside.test', role: 'External' }, seven: { name: 'Rec Seven', email: 'rec.seven@outside.test' },
  blank: { name: '   ', email: 'blank.guest@outside.test' },
};
export const GUEST_VOTER = 'GUEST#0123456789abcdef';
export const NEVER = { comment: 'zz-rec15d-comment', reason: 'zz-rec15d-reason', stray: 'zz-rec15d-stray-key', candidateEmail: 'dee.interview@example.test' };

const user = (username: string, sub: string, attributes: Record<string, string>, groups: string[] = ['employee']): PoolUser => ({ username, sub, status: 'CONFIRMED', enabled: true, attributes: { sub, ...attributes }, groups });
/** The fake pool: REC-04's people and the people above. */
export function pool(): PoolUser[] {
  return [
    ...pool4(),
    user(P.p1, P.p1, { email: 'thandi.m@mokoena.test', phone_number: '+27825550101', given_name: '  Thandi ', family_name: 'Mokoena ', name: 'ZZ Display Name P1', preferred_username: 'zz-preferred-p1' }),
    user(P.p2, P.p2, { email: 'sizwe@mokoena.test', given_name: 'Sizwe' }),
    user(P.p3, P.p3, { email: 'ndlovu@mokoena.test', family_name: 'Ndlovu' }),
    user(P.blank, P.blank, { email: 'blank.person@mokoena.test', name: 'ZZ Blank Display' }),
    user(P.noRow, P.noRow, { email: 'naledi@mokoena.test', given_name: 'Naledi', family_name: 'Norow' }),
    user(P.pB, P.pB, { email: BEMAIL, given_name: 'Bheki', family_name: 'Bcompany' }),
    user(P.two, P.two, { email: 'two@mokoena.test', given_name: 'Twofold', family_name: 'Person' }),
    user(P.alias, ALIAS_SUB, { email: 'alias@mokoena.test', given_name: 'Alias', family_name: 'Person' }),
    user(SUB.panelA, SUB.panelA, { email: 'old.panel@mokoena.test', given_name: 'Old', family_name: 'Panelname' }),
    ...MANY.map((s, i) => user(s, s, { email: `many${i}@mokoena.test`, given_name: 'Many', family_name: `P${i}` })),
  ];
}

const member = (sub: string, c: string) => av({ pk: `USER#${sub}`, sk: `TENANT#${c}`, tenant_id: c, created_at: '2026-11-01T08:00:00.000Z' });
const MEMBERS: Row[] = [
  member(P.p1, A), member(P.p2, A), member(P.p3, A), member(P.blank, A), member(P.pB, B), member(P.two, A), member(P.two, B), member(P.gone, A),
  member(P.alias, A), ...MANY.map((s) => member(s, A)),
];

export const D = { dee: 'CAND-15REC15DDEEAAAAAAAAAAA1', bee: 'CAND-15REC15DBEEBBBBBBBBBBB1', big: 'CAND-15REC15DBIGAAAAAAAAAAA1' };
export const IV = { iv1: 'iv-rec15d-dee-1', iv2: 'iv-rec15d-dee-2', iv3: 'iv-rec15d-dee-3', ivB: 'iv-rec15d-dee-b', bee: 'iv-rec15d-bee-1', big: 'iv-rec15d-big-1' };
/** When each of dee's interviews is (hours before NOW). */
export const AT = { iv1: 50, iv2: 10, iv3: 5, ivB: 20, bee: 8, big: 3 };

type Iv = { id: string; type: string; status: string; at: number; panel: string[]; company?: string; extra?: Record<string, any> };
function interview(cand: string, company: string, iv: Iv): Row {
  return av({
    PK: `CANDIDATE#${cand}`, SK: `INTERVIEW#${iv.id}`, interviewId: iv.id, candidateId: cand, tenant_id: iv.company ?? company, tenantId: iv.company ?? company,
    interviewType: iv.type, status: iv.status, scheduledAt: ago(iv.at), panelMemberIds: iv.panel, votesRequired: 3, createdAt: ago(iv.at + 24), ...(iv.extra ?? {}),
  });
}
function vote(cand: string, company: string, iv: string, voter: string, extra: Record<string, any> = {}): Row {
  return av({
    PK: `CANDIDATE#${cand}`, SK: `VOTE#${voter}#${iv}`, voterId: voter, candidateId: cand, interviewId: iv, tenant_id: company, tenantId: company, rating: 'YES',
    scores: { technical: 4, communication: 3 }, weightedScore: 3.5, comment: NEVER.comment, configVersionUsed: '1', createdAt: ago(1), ...extra,
  });
}
let n = 0;
function event(cand: string, company: string, h: number, type: string, actor: string | undefined, detail: Record<string, any> = {}): Row {
  n++;
  const at = ago(h);
  return av({
    PK: `CANDIDATE#${cand}`, SK: `EVENT#${at}#ev-rec15d-${n}`, eventId: `ev-rec15d-${n}`, eventType: type, source: 'talentflow', candidateId: cand, tenant_id: company,
    ...(actor === undefined ? {} : { actor }), timestamp: at, detail: JSON.stringify(detail),
  });
}
function stage(cand: string, company: string, h: number, row: Record<string, any>): Row {
  const at = ago(h);
  return av({ PK: `CANDIDATE#${cand}`, SK: `STAGE#${at}#${row['to'] ?? row['toStage']}`, candidateId: cand, tenant_id: company, tenantId: company, recordType: 'STAGE_HISTORY', ...row });
}

/** The stored rows of dee, bee and big, and the Member rows. */
export function rowsD(): { state: Row[]; events: Row[]; tenants: Row[] } {
  n = 0;
  const dee = candidateRow(D.dee, { first: 'Dee', last: 'Interview', company: A, stage: 'INTERVIEW', role: R.fleet, hm: SUB.hmA, entered: 60, extra: { email: NEVER.candidateEmail } });
  const bee = candidateRow(D.bee, { first: 'Bee', last: 'Bcandidate', company: B, stage: 'INTERVIEW', role: R.b, hm: SUB.hmB, entered: 30 });
  const big = candidateRow(D.big, { first: 'Big', last: 'Panel', company: A, stage: 'INTERVIEW', role: R.fleet, hm: SUB.hmA, entered: 20 });
  const iv2Panel = [P.p1, P.p3, P.blank, P.noRow, P.pB, P.two, P.gone, P.alias, BEMAIL, SUB.panelA];
  const state: Row[] = [
    dee, bee, big,
    interview(D.dee, A, { id: IV.iv1, type: 'PHONE_SCREEN', status: 'COMPLETED', at: AT.iv1, panel: [P.p1, P.p2], extra: { adhocPanelMembers: [GUEST.gift, GUEST.seven], completedAt: ago(40), outcome: 'PASS', votesSubmitted: 3 } }),
    interview(D.dee, A, {
      id: IV.iv2, type: 'TECHNICAL', status: 'SCHEDULED', at: AT.iv2, panel: iv2Panel,
      extra: {
        adhocPanelMembers: [GUEST.blank], votesSubmitted: 1, PANEL_FEEDBACK_PENDING_COUNT: 9, PANEL_SPLIT_FLAG: true, PANEL_CONSENSUS: 'SPLIT',
        criteria_snapshot: [{ key: 'technical', label: 'Technical' }, { key: 'communication', label: 'Communication' }], zzStrayKey: NEVER.stray,
      },
    }),
    interview(D.dee, A, { id: IV.iv3, type: 'FINAL', status: 'CANCELLED', at: AT.iv3, panel: [P.p2] }),
    interview(D.dee, A, { id: IV.ivB, type: 'TECHNICAL', status: 'COMPLETED', at: AT.ivB, panel: [P.p1], company: B }),
    vote(D.dee, A, IV.iv1, P.p1), vote(D.dee, A, IV.iv1, 'Gift.Guest@OUTSIDE.test'), vote(D.dee, A, IV.iv1, GUEST_VOTER), vote(D.dee, A, IV.iv2, P.p3),
    interview(D.bee, B, { id: IV.bee, type: 'TECHNICAL', status: 'SCHEDULED', at: AT.bee, panel: [P.noRow, P.pB] }),
    interview(D.big, A, { id: IV.big, type: 'TECHNICAL', status: 'SCHEDULED', at: AT.big, panel: MANY }),
    stage(D.dee, A, 58, { from: 'APPLIED', to: 'SCREENING', by: P.p2, by_kind: 'PERSON', at: ago(58), reason: NEVER.reason, reason_code: 'GOOD_FIT' }),
    stage(D.dee, A, 57, { fromStage: 'PHONE_SCREENING', toStage: 'TECHNICAL_INTERVIEW', actor: P.p3, timestamp: ago(57) }),
    stage(D.dee, A, 56, { from: 'SCREENING', to: 'INTERVIEW', by: SUB.recA, by_kind: 'PERSON', at: ago(56), reason: NEVER.reason }),
  ];
  const events: Row[] = [
    event(D.dee, A, 59.9, 'CandidateCreated', 'SYSTEM', { email: NEVER.candidateEmail, stage: 'APPLIED' }),
    event(D.dee, A, 49, 'InterviewScheduled', 'HUMAN', { interviewId: IV.iv2 }),
    event(D.dee, A, 48, 'AgentNote', 'AGENT', { note: 'checked' }),
    event(D.dee, A, 47, 'SlaChecked', 'system', {}),
    event(D.dee, A, 46, 'NoteAdded', P.p1, { by: 'p1' }),
    event(D.dee, A, 45, 'NoteAdded', P.pB, {}),
    event(D.dee, A, 44, 'NoteAdded', P.stranger, {}),
    event(D.dee, A, 43, 'NoteAdded', P.noRow, {}),
    event(D.dee, A, 42, 'Imported', undefined, {}),
  ];
  return { state, events, tenants: MEMBERS };
}

/** Step C's world, company A's stage hours with feedbackDueHours 24, and the people and candidates above. */
export function world(): Tables {
  const t = withThresholds(world15c(), A, { ...THRESHOLDS_A, feedbackDueHours: 24 });
  const d = rowsD();
  t[TABLE.state] = [...(t[TABLE.state] ?? []), ...d.state];
  t[TABLE.events] = [...(t[TABLE.events] ?? []), ...d.events];
  t[TENANTS] = [...(t[TENANTS] ?? []), ...d.tenants];
  return t;
}
/** Company A's stage hours with feedbackDueHours set to `hours`, or left out (null). */
export function withFeedbackHours(t: Tables, hours: number | null): Tables {
  const { feedbackDueHours: _x, ...rest } = THRESHOLDS_A;
  return withThresholds(t, A, hours === null ? rest : { ...rest, feedbackDueHours: hours });
}
/** The same world with one stored interview of a candidate changed (plain values merged). */
export function withInterview(t: Tables, cand: string, iv: string, change: Record<string, any>): Tables {
  const out = structuredClone(t);
  out[TABLE.state] = (out[TABLE.state] ?? []).map((r) => {
    const p = plain(r);
    return p['PK'] === `CANDIDATE#${cand}` && p['SK'] === `INTERVIEW#${iv}` ? av({ ...p, ...change }) : r;
  });
  return out;
}

// ---------------------------------------------------------------- callers

const person = (name: string, sub: string): Caller => ({ name, groups: ['employee'], sub });
export const PC = { p1: person('Panel member p1 (Thandi)', P.p1), p2: person('Panel member p2 (Sizwe)', P.p2) };

// ---------------------------------------------------------------- runs

export const FAULTS = join(__dirname, 'faults.mjs');
export const INTERVIEWS = 'GET /v1/candidates/{id}/interviews';
export const EVENTS = 'GET /v1/candidates/{id}/events';
export type Faults = { pool?: Record<string, string>; member?: Record<string, string> };
export type Opts = { legacy?: string; faults?: Faults; query?: Record<string, string>; headers?: Record<string, string>; body?: unknown; claims?: Record<string, unknown> };

/** One route as `who`, at NOW, as API Gateway (HTTP API, payload 2.0) hands it over, with this world's pool. */
export function runD(handler: string, route: string, who: Caller, id: string, t: Tables, o: Opts = {}): Run {
  const [method, template] = route.split(' ') as [string, string];
  const path = template.replace('{id}', id);
  const event = httpEvent({ authorizer: authorizerOf(who, o.claims ?? {}), path: { id }, query: o.query, headers: o.headers, body: o.body });
  event.routeKey = route;
  event.rawPath = path;
  event.requestContext.routeKey = route;
  event.requestContext.http.method = method;
  event.requestContext.http.path = path;
  const preload = [`--import=${pathToFileURL(CLOCK).href}`, ...(o.faults ? [`--import=${pathToFileURL(FAULTS).href}`] : [])].join(' ');
  return runHandler(fileOf(handler), event, {
    tables: t, secrets: { [AGENT_SECRET]: { AWSCURRENT: 'rec15d-agent-key' } }, cognito: { users: pool() },
    env: {
      ...settings({ ROLES_TABLE_NAME: 'talent-flow-roles' }), NODE_OPTIONS: preload, REC15_NOW: NOW,
      ...(o.legacy ? { LEGACY_TENANT_ID: o.legacy } : {}), ...(o.faults ? { REC15D_FAULTS: JSON.stringify(o.faults) } : {}),
    },
  });
}
/** GET /v1/candidates/{id}/interviews as `who`. */
export const interviewsRun = (who: Caller, id: string, t: Tables, o: Opts = {}) => runD('scheduleInterview', INTERVIEWS, who, id, t, o);
/** GET /v1/candidates/{id}/events as `who`. */
export const eventsRun = (who: Caller, id: string, t: Tables, o: Opts = {}) => runD('getCandidateEvents', EVENTS, who, id, t, o);

/** The AWS calls of a run (log lines left out). */
export const awsOf = (r: Run) => (r.calls as any[]).filter((c) => c.service !== 'log');
export const logsOf = (r: Run) => (r.calls as any[]).filter((c) => c.service === 'log').map((c) => `${c.message}${c.extra === undefined ? '' : ' ' + JSON.stringify(c.extra)}`);
/** The usernames the run asked the pool for (AdminGetUser). */
export const poolAsked = (r: Run) => awsOf(r).filter((c) => c.service === 'cognito' && c.op === 'AdminGetUser').map((c) => String(c.input?.Username));
/** The sign-ins whose Member rows the run read (a Query of the tenants table naming USER#<id>). */
export const membersRead = (r: Run) => awsOf(r)
  .filter((c) => c.service === 'dynamodb' && c.op === 'Query' && /tenants$/.test(String(c.table ?? '')))
  .flatMap((c) => Object.values(c.input?.ExpressionAttributeValues ?? {}).map((v: any) => (v && typeof v === 'object' && 'S' in v ? v.S : v)))
  .filter((v): v is string => typeof v === 'string' && v.startsWith('USER#')).map((v) => v.slice(5));
