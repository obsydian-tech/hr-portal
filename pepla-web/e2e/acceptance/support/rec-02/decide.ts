import { httpEvent, runHandler, runPack, type Row, type Run, type Tables } from './lambda-harness';
import { A, AGENT_SECRET, B, SUB, TABLE, authorizerOf, av, fileOf, interview, packTables, plain, rowsOf, saga, settings, type Caller } from './world';

/**
 * REC-02: the card's own world and helpers. Nothing here is application code: rows as the stored shape holds them today, the
 * card's routes, and small readers of what a run wrote.
 *
 * The world is company A with the real Standard pack (REC-12, written by the real pack script), plus the rows below. Company B is
 * packed too (packedBoth), so a B caller on B's own candidate is a good request and a 404 on A's candidate means something.
 *
 * Every candidate is MID unless it says otherwise (the level REJECTION_RULES is read for).
 */

export const HANDLER = 'recordNotHired';
/** The card's five routes (rule 3 to 6), all on one Lambda (D-T-1). */
export const ROUTE = {
  notHired: 'POST /v1/candidates/{id}/not-hired',
  confirm: 'POST /v1/candidates/{id}/not-hired/confirm',
  cancel: 'POST /v1/candidates/{id}/not-hired/cancel',
  reopen: 'POST /v1/candidates/{id}/reopen',
  oldSystem: 'GET /v1/candidates/old-system',
} as const;
export type RouteKey = (typeof ROUTE)[keyof typeof ROUTE];
export const CANDIDATE_ROUTES: RouteKey[] = [ROUTE.notHired, ROUTE.confirm, ROUTE.cancel, ROUTE.reopen];

/** The eight reason codes (REC-12 D-REC-12.2) and the six stage codes (REC-00 rule 6). */
export const REASONS = ['NOT_RIGHT_SKILLS', 'NOT_RIGHT_EXPERIENCE', 'CHOSE_ANOTHER', 'WITHDREW', 'SALARY_MISMATCH', 'DID_NOT_ATTEND', 'ROLE_CLOSED', 'OTHER'];
export const OPEN = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER'];
/**
 * A stage as today's rows store it -> the open stage it is (REC-03's table, rule 7). Until REC-03 moves the rows, a candidate
 * still carries an old name; Not hired works from it and stores the new code (D-T-3).
 */
export const OLD_OPEN: Record<string, string> = {
  APPLICATION_REVIEW: 'APPLIED', INTERVIEWING: 'INTERVIEW', EVALUATION: 'INTERVIEW',
  BACKGROUND_CHECK: 'OFFER', OFFER_PREPARATION: 'OFFER', OFFER_APPROVAL: 'OFFER', OFFER_DELIVERY: 'OFFER',
};
/** Stages that are not open: Hired (and today's names REC-03 maps to it) and Not hired. */
export const CLOSED = ['HIRED', 'NOT_HIRED', 'CONTRACT_SIGNING', 'PRE_BOARDING', 'ONBOARDING'];
/** The offer states REC-05 calls live (rule 3), and one that is not (today's draft). */
export const LIVE_OFFER = ['WAITING_APPROVAL', 'APPROVED', 'SENT'];

export const ROLE_ID = 'role-a-junior-baker';
export const R = {
  /** The main candidate: in Interview, hiring manager hmA, an interview whose panel is panelA and panelX. */
  n1: 'CAND-02REC02AAAAAAAAAAAAAAA1',
  /** In Screening, no hiring manager. */
  n2: 'CAND-02REC02AAAAAAAAAAAAAAA2',
  /** A JUNIOR candidate of hmA (a second level, so the decider is read for the candidate's level). */
  j1: 'CAND-02REC02AAAAAAAAAAAAAAJ1',
  /** The vote candidate: in INTERVIEWING (today's name), interview iv-v with a panel of five, three votes needed. */
  v: 'CAND-02REC02VOTEAAAAAAAAAAA1',
  iv: 'iv-v-0001',
  ivN1: 'iv-n1-0001',
  /** Old-system rows of A (REC-03's migration shape, rule 6), of B, and two A rows the list must leave out. */
  old: ['CAND-02REC02OLDAAAAAAAAAAA1', 'CAND-02REC02OLDAAAAAAAAAAA2', 'CAND-02REC02OLDAAAAAAAAAAA3', 'CAND-02REC02OLDAAAAAAAAAAA4', 'CAND-02REC02OLDAAAAAAAAAAA5', 'CAND-02REC02OLDAAAAAAAAAAA6'],
  oldB: 'CAND-02REC02OLDBBBBBBBBBBBB1',
  /** Not hired by a person (decided_by_kind PERSON): not on the old-system list. */
  person: 'CAND-02REC02PERSONAAAAAAAAA1',
  /** status REJECTED, not yet moved by REC-03 (no decided_by_kind): not on the list until the migration runs. */
  unmoved: 'CAND-02REC02UNMOVEDAAAAAAAA1',
  /** B's own open candidate. */
  b1: 'CAND-02REC02BBBBBBBBBBBBBBB1',
};
/** The five panel members of the vote candidate (company A people, group employee). */
export const PANEL5 = ['sub-v1-a', 'sub-v2-a', 'sub-v3-a', 'sub-v4-a', 'sub-v5-a'];
export const TOKENS = PANEL5.map((_s, i) => `vote-token-v-${i + 1}`);
/** The old-system rows' stored values (what the list must hand back). */
export const OLD_ROWS = R.old.map((id, i) => ({
  id, first: ['Ayanda', 'Bheki', 'Carla', 'Dumi', 'Elsa', 'Fikile'][i]!, last: 'Old-System',
  before: ['INTERVIEW', 'APPLIED', 'SCREENING', 'OFFER', 'INTERVIEW', 'APPLIED'][i]!,
  status: i % 2 ? 'EVALUATION_FAILED' : 'REJECTED', at: `2026-10-0${i + 1}T09:00:00.000Z`, role: i === 1 ? undefined : ROLE_ID,
}));
/** Votes of other people on the first old-system row: a list for HR must not carry them. */
export const OTHER_VOTERS = ['sub-oldvoter1-a', 'sub-oldvoter2-a'];

const NOW = '2026-11-10T08:00:00.000Z';
const without = (r: Row, ...keys: string[]): Row => Object.fromEntries(Object.entries(r).filter(([k]) => !keys.includes(k)));

/** A candidate row of today's shape (support/rec-12/world.ts saga) in `stage`, of `level`, with hiring manager `hm` (none if null). */
export function candidate(id: string, opts: { stage?: string; level?: string; hm?: string | null; company?: string; first?: string; last?: string; extra?: Record<string, any> } = {}): Row {
  const r = saga(id, opts.first ?? 'Thandi', opts.last ?? 'Nkosi', opts.company ?? A, opts.hm ?? SUB.hmA, {
    currentStage: opts.stage ?? 'INTERVIEW', positionLevel: opts.level ?? 'MID', role_id: ROLE_ID, ...(opts.extra ?? {}),
  });
  return opts.hm === null ? without(r, 'hiringManagerId') : r;
}
export function offerRow(id: string, state: string, company = A): Row {
  return av({
    PK: `CANDIDATE#${id}`, SK: 'OFFER', offerId: `OFFER#${id}`, candidateId: id, tenant_id: company, tenantId: company, state, positionLevel: 'MID',
    baseSalary: 91000, currency: 'ZAR', approvalChain: [], currentApprovalStep: 0, configVersion: '1', interactionLog: [], createdAt: NOW, updatedAt: NOW,
  });
}
function scoringLink(token: string, cand: string, panel: string, iv: string): Row {
  return av({
    PK: `SCORING_LINK#${token}`, SK: 'META', token, candidateId: cand, tenant_id: A, tenantId: A, panelMemberId: panel, panelMemberEmail: `${panel}@example.test`,
    panelMemberName: 'Panel Person', panelMemberRole: 'Baker', interviewId: iv, used: false, createdAt: NOW, ttl: 4102444800,
  });
}
function oldVote(id: string, voter: string, score: number): Row {
  return av({
    PK: `CANDIDATE#${id}`, SK: `VOTE#${voter}#${NOW}`, voterId: voter, candidateId: id, interviewId: 'iv-old-0001', tenant_id: A, tenantId: A, rating: 'NO',
    scores: { technical: score, communication: score, culturalFit: score, problemSolving: score }, weightedScore: score, configVersionUsed: '1', createdAt: NOW,
  });
}
function oldSystem(o: (typeof OLD_ROWS)[number], company = A): Row {
  return candidate(o.id, {
    stage: 'NOT_HIRED', company, first: o.first, last: o.last, hm: 'sub-old-hm',
    extra: {
      status: o.status, evaluationResult: 'FAILED', finalScore: 3.25, votingResult: o.status === 'EVALUATION_FAILED' ? 'STRONG_NO_VETO' : 'COMPLETED',
      decided_by_kind: 'OLD_SYSTEM', stage_before_not_hired: o.before, not_hired_at: o.at, legacy_stage: 'INTERVIEWING', role_id: o.role,
    },
  });
}

/** The rows this card adds to the world. */
export function rec02Rows(): Row[] {
  return [
    candidate(R.n1, { stage: 'INTERVIEW', extra: { currentInterviewId: R.ivN1 } }),
    interview(R.n1, R.ivN1, A, [SUB.panelA, SUB.panelX]),
    candidate(R.n2, { stage: 'SCREENING', hm: null, first: 'Musa', last: 'Zulu' }),
    candidate(R.j1, { stage: 'APPLIED', level: 'JUNIOR', first: 'Jabu', last: 'Mthembu' }),
    candidate(R.v, { stage: 'INTERVIEWING', first: 'Vusi', last: 'Ndlovu', extra: { currentInterviewId: R.iv } }),
    av({ ...plain(interview(R.v, R.iv, A, PANEL5)), votesRequired: 3 }),
    ...PANEL5.map((p, i) => scoringLink(TOKENS[i]!, R.v, p, R.iv)),
    ...OLD_ROWS.map((o) => oldSystem(o)),
    ...OTHER_VOTERS.map((v, i) => oldVote(R.old[0]!, v, 2 + i)),
    oldSystem({ id: R.oldB, first: 'Gugu', last: 'Old-System-B', before: 'SCREENING', status: 'REJECTED', at: '2026-10-09T09:00:00.000Z', role: 'role-b-driver' }, B),
    candidate(R.person, { stage: 'NOT_HIRED', first: 'Palesa', last: 'Decided', extra: { decided_by_kind: 'PERSON', decided_by: SUB.recA, reason_code: 'WITHDREW', stage_before_not_hired: 'SCREENING', not_hired_at: '2026-11-01T09:00:00.000Z' } }),
    candidate(R.unmoved, { stage: 'INTERVIEWING', first: 'Unathi', last: 'Unmoved', extra: { status: 'REJECTED', evaluationResult: 'FAILED' } }),
    candidate(R.b1, { stage: 'INTERVIEW', company: B, hm: SUB.hmB, first: 'Bongani', last: 'Bee' }),
  ];
}

/** Sets a value on a company's active setting row of `type` (version 1, written by the pack). */
export function setSetting(t: Tables, type: string, change: (data: any) => void, company = A): Tables {
  const rows = t[TABLE.config] ?? [];
  const i = rows.findIndex((r) => plain(r)['PK'] === `TENANT#${company}` && plain(r)['SK'] === `CONFIG#${type}#v1`);
  if (i < 0) throw new Error(`no ${type} version 1 for ${company}: the Standard pack did not write it`);
  const p = plain(rows[i]);
  change(p['data']);
  rows[i] = av(p);
  return t;
}
/** REJECTION_RULES of company A with the given values (per-level values are given for every level). */
export const LEVELS = ['JUNIOR', 'MID', 'SENIOR'];
export const byLevel = <T>(v: T, over: Record<string, T> = {}) => Object.fromEntries(LEVELS.map((l) => [l, over[l] ?? v]));
export function withRules(t: Tables, rules: Partial<{ decider: Record<string, string>; secondConfirmation: Record<string, boolean>; reviewVoteLevel: string | null; reviewBelowScore: number | null }>, company = A): Tables {
  return setSetting(t, 'REJECTION_RULES', (d) => Object.assign(d, rules), company);
}

let packedB: Tables | undefined;
/** A and B with the Standard pack, plus this card's rows. Each call hands back its own copy. */
export function world(opts: { oldVeto?: boolean } = {}): Tables {
  if (!packedB) {
    const r = runPack(B, 'dev', { tables: packTables() });
    if (r.code !== 0) throw new Error(`the Standard pack did not run for company B (exit ${r.code}): ${(r.stdout + r.stderr).slice(-600)}`);
    packedB = r.tables;
  }
  const t = structuredClone(packedB);
  t[TABLE.state] = [...(t[TABLE.state] ?? []), ...rec02Rows()];
  // A company that still carries today's veto switch and vote count in its stored PANEL_CONFIG (the rows REC-12 left in place for
  // companies that used Recruitment before it, before-prod item 1). The old code reads them; the card's code must not act on them.
  if (opts.oldVeto) setSetting(t, 'PANEL_CONFIG', (d) => { d.rules = { strongNoVeto: true, votesRequired: { JUNIOR: 2, MID: 3, SENIOR: 4 } }; });
  return t;
}

// ---------------------------------------------------------------- calls

export type Ask2 = { id?: string; body?: unknown; headers?: Record<string, string>; query?: Record<string, string>; claims?: Record<string, unknown> };
/** Runs one of the card's routes as `caller`, as API Gateway (HTTP API, payload 2.0) hands it over. */
export function call(route: RouteKey, caller: Caller, a: Ask2, t: Tables, opts: { fail?: any; queryPageSize?: number } = {}): Run {
  const [method, template] = route.split(' ') as [string, string];
  const path = a.id === undefined ? template : template.replace('{id}', a.id);
  const event = httpEvent({ authorizer: authorizerOf(caller, a.claims ?? {}), path: a.id === undefined ? undefined : { id: a.id }, query: a.query, body: a.body, headers: a.headers });
  event.routeKey = route;
  event.rawPath = path;
  event.requestContext.routeKey = route;
  event.requestContext.http.method = method;
  event.requestContext.http.path = path;
  return runHandler(fileOf(HANDLER), event, {
    tables: t, secrets: { [AGENT_SECRET]: { AWSCURRENT: 'rec02-agent-key' } }, env: settings(), cognito: { users: [] }, ...(opts.fail ? { fail: opts.fail } : {}), ...(opts.queryPageSize ? { queryPageSize: opts.queryPageSize } : {}),
  });
}
export const notHired = (caller: Caller, id: string, body: unknown, t: Tables, headers?: Record<string, string>) => call(ROUTE.notHired, caller, { id, body, headers }, t);

// ---------------------------------------------------------------- readers

export const sagaOf = (t: Tables, id: string) => rowsOf(t, TABLE.state).find((r) => r['PK'] === `CANDIDATE#${id}` && r['SK'] === 'SAGA');
/** Stage history rows of a candidate (today's shape: SK STAGE#<time>, advanceCandidateStage writeStageHistory). */
export const historyOf = (t: Tables, id: string) => rowsOf(t, TABLE.state).filter((r) => r['PK'] === `CANDIDATE#${id}` && String(r['SK']).startsWith('STAGE#'));
export const votesOf = (t: Tables, id: string) => rowsOf(t, TABLE.state).filter((r) => r['PK'] === `CANDIDATE#${id}` && String(r['SK']).startsWith('VOTE#'));
const own = (r: { calls: any[] }) => r.calls.filter((c: any) => c.service !== 'log' && c.service !== 'step');
/** Every event the run put on a bus: { detailType, source, detail }. */
export const eventsOf = (r: { calls: any[] }) => own(r).filter((c) => c.service === 'events').map((c) => ({ detailType: c.detailType as string, source: c.source as string, detail: c.detail as Record<string, any> }));
/** The calls that change the state table. */
export const stateWrites = (r: { calls: any[] }) => own(r).filter((c) => c.service === 'dynamodb' && /PutItem|UpdateItem|DeleteItem|BatchWriteItem|TransactWriteItems/.test(c.op) && (c.table === TABLE.state || JSON.stringify(c.input ?? {}).includes(`"${TABLE.state}"`)));
/** Every call that changes anything (a table write anywhere, an event, a queue, a Lambda). */
export const anyWrite = (r: { calls: any[] }) => own(r).filter((c) => (c.service === 'dynamodb' && /PutItem|UpdateItem|DeleteItem|BatchWriteItem|TransactWriteItems/.test(c.op)) || /^(events|sqs|lambda|sfn|ses|s3)$/.test(c.service));
/** Every AWS call (not the log). */
export const awsOf = (r: { calls: any[] }) => own(r);
export const logsOf = (r: { calls: any[] }) => r.calls.filter((c: any) => c.service === 'log').map((c: any) => String(c.message));
/** The state table rows of one candidate that changed or appeared between two worlds. */
export function changedRows(before: Tables, after: Tables, id: string) {
  const key = (r: Record<string, any>) => `${r['PK']}|${r['SK']}`;
  const old = new Map(rowsOf(before, TABLE.state).map((r) => [key(r), JSON.stringify(r)]));
  return rowsOf(after, TABLE.state).filter((r) => r['PK'] === `CANDIDATE#${id}` && old.get(key(r)) !== JSON.stringify(r));
}
export { A, B };
