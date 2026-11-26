import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { httpEvent, runHandler, type PoolUser, type Row, type Run, type Tables } from '../rec-14/lambda-harness';
import { AGENT_SECRET, authorizerOf, fileOf, settings, type Caller } from '../rec-04/world';
import { C } from '../rec-04/callers';
import { CLOCK, candidateRow } from '../rec-15/world';
import { withDecider, withSetting } from '../rec-15c/world';
import { A, B, MANY, NOW, P, PC, R, SUB, TABLE, TENANTS, av, plain, pool as pool15d, rowsOf, world as world15d } from '../rec-15d/world';

/**
 * INT-01 (NH-269): the world of the interview lifecycle on the server. Nothing here is application code.
 *
 * It is REC-15 step D's world (companies A and B with the real Standard pack, REC-04's roles, step C's and step D's candidates, the
 * people p1, p2, p3 of company A and pB of company B with Member rows and names in the fake sign-in pool, a fixed clock NOW) with:
 *   - company A's PANEL_CONFIG carrying interview_emails 'ON' (spec R-20; company B's is left as the pack wrote it: off);
 *   - one more person of A, recU, a Recruiter whose sign-in id is in sign-in form, with a Member row and the pool name
 *     "Lindiwe Recruiter" (so closed_by_name and on_behalf_by_name can be a real name);
 *   - the candidates below. Each test adds the interviews, links and votes it needs with the row builders here, in the formats the
 *     spec names (R-21, S-3): `scheduledAt` from toISOString(), `interviewType`, `panelMemberIds`, `sequence` (the new-way marker),
 *     `guest_link_hash` and a REC-07 link row `SCORING_LINK#<sha256 hex of the raw token>` / `META`.
 *
 * Candidates (company A unless it says otherwise; Fleet controller is MID: PHONE_SCREEN and TECHNICAL are required, panel size 3,
 * guests allowed, HR may enter for a member; hiring manager hmA, who decides for MID unless a test sets HR_ONLY):
 *   book       Interview, no interview.               fresh   Interview, no interview (a second clean candidate).
 *   screening  Screening (booking is refused there, S-6).  notHired  Not hired (closing a booked interview still works, S-6).
 *   bee        Company B, Interview on B's role, hiring manager hmB.
 * Every run happens at NOW unless a test gives another time (REC-15's clock preload), with ./race.mjs preloaded (it does nothing unless
 * a test asks for a race, a stale read or a store fault).
 */
export { A, B, NOW, P, PC, R, SUB, TABLE, TENANTS, MANY, av, plain, rowsOf, withDecider, withSetting };
export type { Caller, Row, Run, Tables };

const NOW_MS = Date.parse(NOW);
/** The time `h` hours after NOW (negative: before), as toISOString() writes it. */
export const H = (h: number) => new Date(NOW_MS + Math.round(h * 3_600_000)).toISOString();
/** The time `m` minutes after NOW. */
export const M = (m: number) => new Date(NOW_MS + Math.round(m * 60_000)).toISOString();
export const DAY_MS = 86_400_000;
export const plusDays = (iso: string, d: number) => new Date(Date.parse(iso) + d * DAY_MS).toISOString();

const uid = (n: number) => `1a7e${n.toString(16).padStart(4, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
/** recU: a Recruiter of A in sign-in form with a name. */
export const REC_U = uid(1);
export const REC_U_NAME = 'Lindiwe Recruiter';
export const NAMES: Record<string, string> = { [P.p1]: 'Thandi Mokoena', [P.p2]: 'Sizwe', [P.p3]: 'Ndlovu', [REC_U]: REC_U_NAME };

export const K = {
  book: 'CAND-01INT01BOOKAAAAAAAAAAA1', fresh: 'CAND-01INT01FRESHAAAAAAAAAA1', screening: 'CAND-01INT01SCREENAAAAAAAAA1',
  notHired: 'CAND-01INT01NOTHIREDAAAAAA1', bee: 'CAND-01INT01BEEBBBBBBBBBBBB1',
};
/** Text the tests send or store that no log line, event or answer it does not belong in may hold. */
export const NEVER = {
  place: 'zz-int01-place Boardroom 3', link: 'https://meet.example.test/zz-int01-room', note: 'zz-int01-candidate-note', reasonNote: 'zz-int01-reason-note',
  closedNote: 'zz-int01-closed-note', comment: 'zz-int01-vote-comment', guestEmail: 'zz.int01.guest@outside.test', guestEmail2: 'zz.int01.second@outside.test',
};
/** The criteria every seeded interview is scored on, and a right vote body for them. */
export const CRIT = [{ key: 'technical', label: 'Technical' }, { key: 'communication', label: 'Communication' }];
export const SCORES = { technical: 4, communication: 3 };
export const voteBody = (extra: Record<string, unknown> = {}) => ({ scores: SCORES, rating: 'YES', comment: NEVER.comment, ...extra });

/** A raw guest token (43 characters, the base64url form REC-07 makes) and its stored hash. */
export const token = (n: number) => `int01${String(n).padStart(4, '0')}`.padEnd(43, 'Gx7q');
export const hashOf = (raw: string) => createHash('sha256').update(raw).digest('hex');
/** The voter id a guest's vote is stored under (R-21): GUEST# + the first 16 characters of the link's hash. */
export const guestVoter = (raw: string) => `GUEST#${hashOf(raw).slice(0, 16)}`;

// ---------------------------------------------------------------- rows

export type IvSpec = {
  id: string; cand: string; type?: string; at: string; status?: string; panel?: string[]; company?: string;
  /** The raw token of this interview's guest link (the row stores its hash as guest_link_hash). */
  guest?: string;
  /** null: an interview booked the old way (no sequence, no length, no where, no booked_by). */
  sequence?: number | null;
  votesSubmitted?: number; where?: 'IN_PERSON' | 'ONLINE'; length?: number; note?: string; extra?: Record<string, any>;
};
export const PANEL3 = () => [P.p1, P.p2, P.p3];

/** An interview row as INT-01 stores it (or, with sequence null, as scheduleInterview stored it before INT-01). */
export function interviewRow(iv: IvSpec): Row {
  const company = iv.company ?? A;
  const panel = iv.panel ?? PANEL3();
  const base: Record<string, any> = {
    PK: `CANDIDATE#${iv.cand}`, SK: `INTERVIEW#${iv.id}`, interviewId: iv.id, candidateId: iv.cand, tenant_id: company, tenantId: company,
    interviewType: iv.type ?? 'TECHNICAL', scheduledAt: iv.at, panelMemberIds: panel, votesRequired: panel.length, votesSubmitted: iv.votesSubmitted ?? 0,
    status: iv.status ?? 'SCHEDULED', createdAt: H(-48), criteria_snapshot: CRIT, PANEL_FEEDBACK_PENDING_COUNT: panel.length,
  };
  if (iv.sequence !== null) {
    const where = iv.where ?? 'IN_PERSON';
    Object.assign(base, {
      sequence: iv.sequence ?? 1, length_minutes: iv.length ?? 60, where, ...(where === 'IN_PERSON' ? { place: NEVER.place } : { video_link: NEVER.link }),
      booked_by: SUB.recA, booked_at: H(-48), ...(iv.note ? { candidate_note: iv.note } : {}),
    });
  }
  if (iv.guest) base['guest_link_hash'] = hashOf(iv.guest);
  return av({ ...base, ...(iv.extra ?? {}) });
}
/** The REC-07 link row of a guest (R-21): expires 7 days after the interview unless given. */
export function linkRow(raw: string, cand: string, ivId: string, at: string, o: { company?: string; expires?: string; used?: string | null; email?: string } = {}): Row {
  const h = hashOf(raw);
  const exp = o.expires ?? plusDays(at, 7);
  return av({
    PK: `SCORING_LINK#${h}`, SK: 'META', token_hash: h, interview_id: ivId, candidate_id: cand, guest_email: o.email ?? NEVER.guestEmail, expires_at: exp,
    used_at: o.used ?? null, tenant_id: o.company ?? A, created_by: SUB.recA, created_at: H(-48), ttl: Math.floor(Date.parse(exp) / 1000),
  });
}
/** A vote row in REC-07's format (scale 1 to 5). A guest's voter id is guestVoter(raw). */
export function voteRow(cand: string, ivId: string, voter: string, o: { company?: string; onBehalfBy?: string; at?: string; scores?: Record<string, number>; rating?: string } = {}): Row {
  const at = o.at ?? H(-1);
  const guest = voter.startsWith('GUEST#');
  return av({
    PK: `CANDIDATE#${cand}`, SK: guest ? `VOTE#${voter}#${at}#${ivId}` : `VOTE#${voter}#${ivId}`, voterId: voter, candidateId: cand, interviewId: ivId,
    tenant_id: o.company ?? A, tenantId: o.company ?? A, scores: o.scores ?? SCORES, rating: o.rating ?? 'YES', scale: { min: 1, max: 5 },
    on_behalf: !!o.onBehalfBy, ...(o.onBehalfBy ? { entered_by: o.onBehalfBy } : {}), ...(guest ? { guest: true } : {}), createdAt: at,
  });
}
/** A vote row as the old route wrote it (four criteria, 0 to 10, no scale). */
export function oldVoteRow(cand: string, ivId: string, voter: string): Row {
  return av({
    PK: `CANDIDATE#${cand}`, SK: `VOTE#${voter}#${H(-30)}`, voterId: voter, candidateId: cand, interviewId: ivId, tenant_id: A, tenantId: A, rating: 'YES',
    scores: { technical: 7, communication: 7, culturalFit: 7, problemSolving: 7 }, weightedScore: 7, configVersionUsed: '1', createdAt: H(-30),
  });
}

/** Adds rows to the state table (each test works on its own copy). */
export function withRows(t: Tables, rows: Row[]): Tables {
  const out = structuredClone(t);
  out[TABLE.state] = [...(out[TABLE.state] ?? []), ...rows];
  return out;
}
/** Adds an interview (and, with a guest, its link row expiring 7 days after the interview). */
export function withIv(t: Tables, iv: IvSpec, link: { expires?: string; used?: string | null } = {}): Tables {
  const rows = [interviewRow(iv)];
  if (iv.guest) rows.push(linkRow(iv.guest, iv.cand, iv.id, iv.at, { company: iv.company, ...link }));
  return withRows(t, rows);
}
/** Changes one stored row of the state table (plain values merged; undefined removes a key). */
export function withChange(t: Tables, pk: string, sk: string, change: Record<string, any>): Tables {
  const out = structuredClone(t);
  out[TABLE.state] = (out[TABLE.state] ?? []).map((r) => {
    const p = plain(r);
    if (p['PK'] !== pk || p['SK'] !== sk) return r;
    const m: Record<string, any> = { ...p, ...change };
    for (const [k, v] of Object.entries(change)) if (v === undefined) delete m[k];
    return av(m);
  });
  return out;
}

/** The candidates of this card. */
export function candidates(): Row[] {
  const row = (id: string, first: string, last: string, stage: string, company = A, role = R.fleet, hm = SUB.hmA, extra: Record<string, any> = {}) =>
    candidateRow(id, { first, last, company, stage, role, hm, entered: 20, extra: { configVersion: '1', ...extra } });
  return [
    row(K.book, 'Booked', 'Person', 'INTERVIEW'), row(K.fresh, 'Fresh', 'Person', 'INTERVIEW'), row(K.screening, 'Screening', 'Person', 'SCREENING'),
    row(K.notHired, 'Nothired', 'Person', 'NOT_HIRED', A, R.fleet, SUB.hmA, { stage_before_not_hired: 'INTERVIEW', not_hired_at: H(-5), reason_code: 'WITHDREW' }),
    row(K.bee, 'Bee', 'Bcompany', 'INTERVIEW', B, R.b, SUB.hmB),
  ];
}

let base: Tables | undefined;
/** Step D's world, A's interview_emails ON, recU, and this card's candidates. Each call hands back its own copy. */
export function world(): Tables {
  if (!base) {
    let t = withSetting(world15d(), A, 'PANEL_CONFIG', (d) => ({ ...d, interview_emails: 'ON' }));
    t = withRows(t, candidates());
    t[TENANTS] = [...(t[TENANTS] ?? []), av({ pk: `USER#${REC_U}`, sk: `TENANT#${A}`, tenant_id: A, created_at: '2026-11-01T08:00:00.000Z' })];
    t[TABLE.idempotency] ??= [];
    base = t;
  }
  return structuredClone(base);
}
/** A's guest switch set to `v` (undefined: the key left out). */
export const withEmails = (t: Tables, v: unknown) => withSetting(t, A, 'PANEL_CONFIG', (d) => { const o = { ...d }; if (v === undefined) delete o.interview_emails; else o.interview_emails = v; return o; });
/** A's PANEL_CONFIG changed. */
export const withPanelConfig = (t: Tables, change: Record<string, unknown>) => withSetting(t, A, 'PANEL_CONFIG', (d) => ({ ...d, ...change }));

/** The fake pool: step D's people and recU. */
export function pool(): PoolUser[] {
  return [...pool15d(), { username: REC_U, sub: REC_U, status: 'CONFIRMED', enabled: true, attributes: { sub: REC_U, email: 'lindiwe.r@mokoena.test', given_name: 'Lindiwe', family_name: 'Recruiter' }, groups: ['hr_staff', 'perm-recruitment'] }];
}

// ---------------------------------------------------------------- callers

const person = (name: string, groups: string[], sub: string, extra: Partial<Caller> = {}): Caller => ({ name, groups, sub, ...extra });
export const W = {
  recruiter: C.recruiter,
  recU: person('Recruiter recU (named)', ['hr_staff', 'perm-recruitment'], REC_U),
  hm: C.hmC1,
  otherHm: C.hmOther,
  employee: C.employee,
  p1: PC.p1, p2: PC.p2, p3: person('Panel member p3 (Ndlovu)', ['employee'], P.p3),
  recruiterB: C.recruiterB,
  managerB: C.managerB,
} satisfies Record<string, Caller>;

// ---------------------------------------------------------------- routes and runs

export const ROUTE = {
  book: 'POST /v1/candidates/{id}/interviews', act: 'PATCH /v1/candidates/{id}/interviews/{interviewId}', read: 'GET /v1/candidates/{id}/interviews',
  vote: 'POST /v1/interviews/{id}/votes', scores: 'GET /v1/candidates/{id}/scores', guestRead: 'GET /v1/scoring-links/{token}', guestVote: 'POST /v1/scoring-links/{token}',
  oldVote: 'POST /v1/candidates/{id}/votes', oldGuest: 'POST /v1/scoring/{token}/votes', link: 'POST /v1/candidates/{id}/scoring-links', move: 'PUT /v1/candidates/{id}/stage',
} as const;
export const HANDLER: Record<string, string> = {
  [ROUTE.book]: 'scheduleInterview', [ROUTE.act]: 'scheduleInterview', [ROUTE.read]: 'scheduleInterview', [ROUTE.vote]: 'submitVote', [ROUTE.scores]: 'submitVote',
  [ROUTE.guestRead]: 'submitVoteByToken', [ROUTE.guestVote]: 'submitVoteByToken', [ROUTE.oldVote]: 'submitVote', [ROUTE.oldGuest]: 'submitVoteByToken',
  [ROUTE.link]: 'generateScoringLink', [ROUTE.move]: 'advanceCandidateStage',
};
export const RACE_FILE = join(__dirname, 'race.mjs');
export const IDEM_TABLE = TABLE.idempotency;

let keys = 0;
/** A fresh Idempotency-Key value. */
export const newKey = () => `int01-key-${process.pid}-${++keys}`;

export type Req = { route: string; who?: Caller; path: Record<string, string>; body?: unknown; headers?: Record<string, string>; query?: Record<string, string>; claims?: Record<string, unknown> };
/** The event API Gateway (HTTP API, payload 2.0) hands over; `who` undefined: no sign-in (the public scoring routes). */
export function apiEvent(q: Req): any {
  const [method, template] = q.route.split(' ') as [string, string];
  const raw = template.replace(/\{(\w+)\}/g, (_m, k) => encodeURIComponent(q.path[k] ?? ''));
  const event = httpEvent({ authorizer: q.who ? authorizerOf(q.who, q.claims ?? {}) : undefined, path: q.path, query: q.query, body: q.body, headers: q.headers });
  event.routeKey = q.route;
  event.rawPath = raw;
  event.requestContext.routeKey = q.route;
  event.requestContext.http.method = method;
  event.requestContext.http.path = raw;
  if (!q.who) delete event.requestContext.authorizer;
  return event;
}

export type RaceSpec = { when: 'before' | 'after'; match: string; table?: string; nth?: number; second: Req | { handler: string; event: unknown } };
export type O = {
  now?: string; env?: Record<string, string | undefined>; fail?: any; race?: RaceSpec; stale?: boolean; failTable?: string;
  /** The Idempotency-Key header (a write route gets a fresh one unless given; null sends none). */
  key?: string | null;
};
const WRITE_ROUTES = new Set<string>([ROUTE.book, ROUTE.act]);
const envOf = (o: O): Record<string, string | undefined> => ({
  ...settings({ ROLES_TABLE_NAME: 'talent-flow-roles', IDEMPOTENCY_TABLE: IDEM_TABLE, TOKEN_TTL_DAYS: '7' }),
  NODE_OPTIONS: [`--import=${pathToFileURL(CLOCK).href}`, `--import=${pathToFileURL(RACE_FILE).href}`].join(' '),
  REC15_NOW: o.now ?? NOW,
  ...(o.stale ? { INT01_STALE: '1' } : {}),
  ...(o.failTable ? { INT01_FAIL_TABLE: o.failTable } : {}),
  ...(o.race ? { INT01_RACE: JSON.stringify(raceOf(o.race)) } : {}),
  ...(o.env ?? {}),
});
function raceOf(r: RaceSpec) {
  const second = 'route' in r.second ? { handler: fileOf(HANDLER[r.second.route]!), event: apiEvent(withKey(r.second, undefined)) } : r.second;
  return { when: r.when, match: r.match, table: r.table, nth: r.nth, handler: second.handler, event: second.event };
}
function withKey(q: Req, key: string | null | undefined): Req {
  if (!WRITE_ROUTES.has(q.route)) return q;
  const given = Object.keys(q.headers ?? {}).some((h) => h.toLowerCase() === 'idempotency-key');
  if (given || key === null) return q;
  return { ...q, headers: { ...(q.headers ?? {}), 'Idempotency-Key': key ?? newKey() } };
}
/** Runs one request in a fresh process at NOW (or o.now) against `t`. */
export function call(q: Req, t: Tables, o: O = {}): Run {
  return runHandler(fileOf(HANDLER[q.route]!), apiEvent(withKey(q, o.key)), {
    tables: t, secrets: { [AGENT_SECRET]: { AWSCURRENT: 'int01-agent-key' } }, cognito: { users: pool() }, env: envOf(o), ...(o.fail ? { fail: o.fail } : {}),
  });
}
/** Runs a handler with any event (a bus event or a direct invoke, no sign-in). */
export function invoke(handler: string, event: unknown, t: Tables, o: O = {}): Run {
  return runHandler(fileOf(handler), event, { tables: t, secrets: {}, cognito: { users: pool() }, env: envOf(o), ...(o.fail ? { fail: o.fail } : {}) });
}

export const book = (who: Caller, cand: string, body: unknown, t: Tables, o: O = {}) => call({ route: ROUTE.book, who, path: { id: cand }, body }, t, o);
export const act = (who: Caller, cand: string, iv: string, body: unknown, t: Tables, o: O = {}) => call({ route: ROUTE.act, who, path: { id: cand, interviewId: iv }, body }, t, o);
export const read = (who: Caller, cand: string, t: Tables, o: O = {}) => call({ route: ROUTE.read, who, path: { id: cand } }, t, o);
export const vote = (who: Caller, iv: string, body: unknown, t: Tables, o: O = {}) => call({ route: ROUTE.vote, who, path: { id: iv }, body }, t, o);
export const scoresOf = (who: Caller, cand: string, t: Tables, o: O = {}) => call({ route: ROUTE.scores, who, path: { id: cand } }, t, o);
export const guestRead = (raw: string, t: Tables, o: O = {}) => call({ route: ROUTE.guestRead, path: { token: raw } }, t, o);
export const guestVote = (raw: string, body: unknown, t: Tables, o: O = {}) => call({ route: ROUTE.guestVote, path: { token: raw }, body }, t, o);
export const oldVote = (who: Caller, cand: string, body: unknown, t: Tables, o: O = {}) => call({ route: ROUTE.oldVote, who, path: { id: cand }, body }, t, o);
export const oldGuestVote = (raw: string, body: unknown, t: Tables, o: O = {}) => call({ route: ROUTE.oldGuest, path: { token: raw }, body }, t, o);
export const makeLink = (who: Caller, cand: string, body: unknown, t: Tables, o: O = {}) => call({ route: ROUTE.link, who, path: { id: cand }, body }, t, o);
export const move = (who: Caller, cand: string, to: string, t: Tables, o: O = {}) => call({ route: ROUTE.move, who, path: { id: cand }, body: { to, reason: 'Checking the interviews' } }, t, o);
/** The old four-criteria body of the old routes. */
export const oldScores = { technical: 7, communication: 7, culturalFit: 7, problemSolving: 7 };

// ---------------------------------------------------------------- reading a run

export const bodyOf = (r: { response: any }) => { try { return JSON.parse(r.response?.body ?? 'null'); } catch { return r.response?.body; } };
export const statusOf = (r: Run) => r.response?.statusCode as number | undefined;
export const describe = (r: Run) => `${statusOf(r)} ${JSON.stringify(bodyOf(r)).slice(0, 300)}${r.error ? ` (threw ${r.error.name}: ${r.error.message.slice(0, 200)})` : ''}`;
/** The calls of the request itself (a race's second request left out), and the second request's calls and answer. */
export function split(r: Run): { own: any[]; second: any[]; secondAnswer?: { response?: any; error?: any } } {
  const own: any[] = [];
  const second: any[] = [];
  let inSecond = false;
  let secondAnswer;
  for (const c of r.calls as any[]) {
    if (c.service === 'race-start') { inSecond = true; continue; }
    if (c.service === 'race') { inSecond = false; secondAnswer = { response: c.response, error: c.error }; continue; }
    (inSecond ? second : own).push(c);
  }
  return { own, second, secondAnswer };
}
export const secondOf = (r: Run): Run => { const s = split(r); return { response: s.secondAnswer?.response, error: s.secondAnswer?.error, calls: s.second, tables: r.tables }; };
export const ownOf = (r: Run): Run => ({ ...r, calls: split(r).own });
export const awsOf = (r: { calls: any[] }) => r.calls.filter((c: any) => !['log', 'step', 'race', 'race-start'].includes(c.service));
export const logsOf = (r: { calls: any[] }) => r.calls.filter((c: any) => c.service === 'log').map((c: any) => `${c.message}${c.extra === undefined ? '' : ' ' + JSON.stringify(c.extra)}`);
export const WRITE_OPS = /^(PutItem|UpdateItem|DeleteItem|BatchWriteItem|TransactWriteItems|ExecuteStatement|BatchExecuteStatement)$/;
export const dbWrites = (r: { calls: any[] }) => awsOf(r).filter((c: any) => c.service === 'dynamodb' && WRITE_OPS.test(c.op));
export const busOf = (r: { calls: any[] }) => awsOf(r).filter((c: any) => c.service === 'events');
export const sqsOf = (r: { calls: any[] }) => awsOf(r).filter((c: any) => c.service === 'sqs');
export const rowOf = (t: Tables, pk: string, sk: string) => rowsOf(t, TABLE.state).find((x) => x['PK'] === pk && x['SK'] === sk);
export const ivOf = (t: Tables, cand: string, iv: string) => rowOf(t, `CANDIDATE#${cand}`, `INTERVIEW#${iv}`);
export const linkOf = (t: Tables, raw: string) => rowOf(t, `SCORING_LINK#${hashOf(raw)}`, 'META');
export const ivsOf = (t: Tables, cand: string) => rowsOf(t, TABLE.state).filter((x) => x['PK'] === `CANDIDATE#${cand}` && String(x['SK']).startsWith('INTERVIEW#'));
/** Link rows on this card's candidates (step D's world already holds REC-07 link rows of its own). */
export const linksOf = (t: Tables) => rowsOf(t, TABLE.state).filter((x) => String(x['PK']).startsWith('SCORING_LINK#') && Object.values(K).includes(String(x['candidate_id']) as never));
export const votesOf = (t: Tables, cand: string, iv?: string) => rowsOf(t, TABLE.state).filter((x) => x['PK'] === `CANDIDATE#${cand}` && String(x['SK']).startsWith('VOTE#') && (!iv || x['interviewId'] === iv));
export const guardsOf = (t: Tables, cand: string) => rowsOf(t, TABLE.state).filter((x) => x['PK'] === `CANDIDATE#${cand}` && String(x['SK']).startsWith('VOTED#'));
/** The rows of every table that are new, changed or gone in `after` against `before` (the idempotency table left out unless asked). */
export function changed(before: Tables, after: Tables, withKeys = false): string[] {
  const out: string[] = [];
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!withKeys && name === IDEM_TABLE) continue;
    const was = new Set((before[name] ?? []).map((r) => JSON.stringify(r)));
    const is = new Set((after[name] ?? []).map((r) => JSON.stringify(r)));
    for (const r of after[name] ?? []) if (!was.has(JSON.stringify(r))) { const x = plain(r); out.push(`${name} ${x['PK'] ?? x['pk'] ?? x['idempotencyKey'] ?? ''} ${x['SK'] ?? x['sk'] ?? ''} changed or new`); }
    for (const r of before[name] ?? []) if (!is.has(JSON.stringify(r))) { const x = plain(r); if (!(after[name] ?? []).some((y) => { const p = plain(y); return p['PK'] === x['PK'] && p['SK'] === x['SK'] && p['pk'] === x['pk'] && p['sk'] === x['sk'] && p['idempotencyKey'] === x['idempotencyKey']; })) out.push(`${name} ${x['PK'] ?? x['pk'] ?? ''} ${x['SK'] ?? x['sk'] ?? ''} gone`); }
  }
  return out;
}
/** Every substring of the text that could be a raw guest token (20 to 128 of [A-Za-z0-9_-]) whose sha256 is a stored link hash. */
export function leakedTokens(text: string, t: Tables): string[] {
  const hashes = new Set(rowsOf(t, TABLE.state).filter((x) => String(x['PK']).startsWith('SCORING_LINK#')).map((l) => String(l['token_hash'] ?? String(l['PK']).slice(13))));
  const out: string[] = [];
  for (const m of text.matchAll(/[A-Za-z0-9_-]{20,128}/g)) if (hashes.has(hashOf(m[0]))) out.push(m[0].slice(0, 6) + '…');
  return out;
}
