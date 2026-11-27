import type { PoolUser } from '../rec-14/lambda-harness';
import { av } from '../rec-02/world';
import {
  A, B, C, KC, TABLE, accept, candidateSpec, describe as describe06, eventsOf, offerRow, ok, plain, poolUsers, rowsOf, sentOffer, world as world06,
  type Row, type Tables,
} from '../rec-06/world';
import { runHandler, loadOnly, type Extra, type Run } from './lambda-harness';

/**
 * REC-16: the world of the hiring manager IT-bundle email (spec onboarding-cards/specs/REC-16.md, rules 1 to 11, AC-1 to AC-13).
 *
 * It is REC-06's world (support/rec-06/world.ts: companies A and B, their roles, candidates in Offer, the sign-in pool), with two offers
 * taken all the way to ACCEPTED through the real offer routes (REC-05's draft, submit, approve, send and upload, then REC-06's accept):
 * company A's for `main` (Thandeka Mahlaba, hiring manager hmA) and company B's for `bMain` (Bheki Zondo, hiring manager hmB). The
 * CandidateHired events those accepts put on the bus are the events the tests deliver, so the handler is judged on the event the real
 * accept sends. Variants change only the stored rows (as another route or an old system would leave them) or the event.
 *
 * Added to the sign-in pool (all made up): hmA gets a real-looking address; people who are hiring managers but must never be emailed
 * (a member of A and B, a disabled one, an unconfirmed one, one with no Member row, one with no email and three with a malformed
 * address), each with the Member rows named below.
 */
export { A, B, KC, TABLE, plain, rowsOf, offerRow };
export type { Row, Tables, Run };

export const STATE = TABLE.state;
export const TENANTS = TABLE.tenants;
export const POOL = 'af-south-1_Rec01Fake';
export const TEST_EMAIL = 'hm-it-bundle@blackhole.postmarkapp.com';
export const SENDER = 'it-notices@naleko.example';
export const HM_A_EMAIL = 'sizwe.ndlovu@mokoena.example';
export const HM_B_EMAIL = 'themba.nkosi@bontle.example';

/** The approved words (Iggie, 26 Nov 14:03 SAST). <candidateName> is first name, one space, last name. */
export const subjectFor = (name: string) => `Action required: Set up IT provisioning for ${name}`;
export const bodyFor = (name: string) => `The offer for ${name} has been accepted. Please create their IT provisioning bundle at your earliest convenience.`;
export const htmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Rule 8: every outcome code. */
export const OUTCOMES = ['SENT', 'ALREADY_SENT', 'WRONG_EVENT', 'BAD_EVENT', 'OFFER_NOT_FOUND', 'OFFER_NOT_ACCEPTED', 'CANDIDATE_NOT_FOUND', 'NO_HIRING_MANAGER',
  'HIRING_MANAGER_NOT_IN_COMPANY', 'HIRING_MANAGER_NO_EMAIL', 'NO_CANDIDATE_NAME', 'SEND_FAILED', 'SEND_UNKNOWN', 'MARK_FAILED'] as const;

// ---------------------------------------------------------------- people

export const SUB = {
  hmA: 'sub-hm-a', hmB: 'sub-hm-b', empA: 'sub-rec05-emp',
  both: 'sub-rec16-hm-both', disabled: 'sub-rec16-hm-disabled', unconfirmed: 'sub-rec16-hm-unconfirmed', noMember: 'sub-rec16-hm-no-member',
  a2: 'sub-rec16-hm-a2', noEmail: 'sub-rec16-hm-no-email', space: 'sub-rec16-hm-space', bcc: 'sub-rec16-hm-bcc', atAt: 'sub-rec16-hm-at-at',
};
/** A second, valid hiring manager of company A (lock check round 1, F-1): an event naming them must not move the email to them. */
export const HM_A2_EMAIL = 'second.manager@mokoena.example';
export const BAD_ADDRESS = { space: 'a b@x.co', bcc: 'a@x.co\nBcc: y@z.co', atAt: 'a@@x.co' };
const person = (sub: string, email: string | undefined, extra: Partial<PoolUser> = {}): PoolUser => ({
  username: `${sub}-login`, sub, enabled: true, status: 'CONFIRMED', groups: ['manager'],
  attributes: { sub, ...(email === undefined ? {} : { email, email_verified: 'true' }), given_name: 'Test', family_name: sub.replace(/^sub-rec16-/, '') }, ...extra,
});
/** REC-06's pool with hmA's and hmB's addresses set, and this card's people. */
export function pool(): PoolUser[] {
  const base = poolUsers().map((u) => {
    if (u.sub === SUB.hmA) return { ...u, attributes: { ...u.attributes, email: HM_A_EMAIL } };
    if (u.sub === SUB.hmB) return { ...u, attributes: { ...u.attributes, email: HM_B_EMAIL } };
    return u;
  });
  const hmB = base.some((u) => u.sub === SUB.hmB) ? [] : [{ ...person(SUB.hmB, HM_B_EMAIL), attributes: { sub: SUB.hmB, email: HM_B_EMAIL, email_verified: 'true', given_name: 'Themba', family_name: 'Nkosi' } }];
  return [
    ...base,
    ...hmB,
    person(SUB.a2, HM_A2_EMAIL),
    person(SUB.both, 'both.companies@mokoena.example'),
    person(SUB.disabled, 'disabled.manager@mokoena.example', { enabled: false }),
    person(SUB.unconfirmed, 'unconfirmed.manager@mokoena.example', { status: 'FORCE_CHANGE_PASSWORD' }),
    person(SUB.noMember, 'no.member@mokoena.example'),
    person(SUB.noEmail, undefined),
    person(SUB.space, BAD_ADDRESS.space),
    person(SUB.bcc, BAD_ADDRESS.bcc),
    person(SUB.atAt, BAD_ADDRESS.atAt),
  ];
}
/** Every address in the pool that a test must find only where it belongs (logs never; Postmark only for the right person). */
export const POOL_ADDRESSES = () => pool().map((u) => u.attributes['email']).filter((e): e is string => typeof e === 'string' && e.length > 0);

// ---------------------------------------------------------------- the accepted world

export type Hired = { offer: string; candidate: string; employee: string; tenant: string; detail: Record<string, unknown> };
let built: { t: Tables; a: Hired; b: Hired } | undefined;

function acceptedOffer(t0: Tables, candidate: string, n0: number, who: typeof C.recA): { t: Tables; hired: Hired } {
  const s = sentOffer(t0, candidate, n0);
  const r = accept(who, s, s.t, n0 + 6);
  if (!ok(r)) throw new Error(`building ${candidate}'s accepted offer: the accept failed (${describe06(r)})`);
  const ev = eventsOf(r, 'CandidateHired');
  if (ev.length !== 1) throw new Error(`building ${candidate}'s accepted offer: ${ev.length} CandidateHired events`);
  const e = ev[0];
  if (e.source !== 'talent-flow.workflow') throw new Error(`CandidateHired came from ${e.source}`);
  const d = e.detail as Record<string, unknown>;
  const company = candidateSpec(candidate)?.company ?? A;
  return { t: r.tables, hired: { offer: s.id, candidate, employee: String(d['employee_id']), tenant: company, detail: d } };
}

/** The two accepted offers, built once through the real routes; each call hands back its own copy. */
export function accepted(): { t: Tables; a: Hired; b: Hired } {
  if (!built) {
    const w = world06();
    w[TENANTS] = [
      ...(w[TENANTS] ?? []),
      ...[SUB.a2, SUB.both, SUB.disabled, SUB.unconfirmed, SUB.noEmail, SUB.space, SUB.bcc, SUB.atAt].map((s) => av({ pk: `USER#${s}`, sk: `TENANT#${A}`, tenant_id: A })),
      av({ pk: `USER#${SUB.both}`, sk: `TENANT#${B}`, tenant_id: B }),
    ];
    const one = acceptedOffer(w, KC.main, 0, C.recA);
    const two = acceptedOffer(one.t, KC.bMain, 100, C.recB);
    built = { t: two.t, a: one.hired, b: two.hired };
  }
  return structuredClone(built);
}

// ---------------------------------------------------------------- changing stored rows

const toAv = (v: unknown): Record<string, unknown> => (v === null ? { NULL: true } : typeof v === 'number' ? { N: String(v) } : typeof v === 'boolean' ? { BOOL: v } : { S: String(v) });
/** Sets (or, with undefined, removes) fields on the row with this PK and SK. */
export function withRow(t: Tables, pk: string, sk: string, set: Record<string, unknown>): Tables {
  const out = structuredClone(t);
  let hit = false;
  out[STATE] = (out[STATE] ?? []).map((r) => {
    const x = plain(r);
    if (x['PK'] !== pk || x['SK'] !== sk) return r;
    hit = true;
    const next = { ...r } as Row;
    for (const [k, v] of Object.entries(set)) { if (v === undefined) delete next[k]; else next[k] = toAv(v) as any; }
    return next;
  });
  if (!hit) throw new Error(`no row ${pk} ${sk}`);
  return out;
}
/** Puts a row (plain values) into the state table, replacing one with the same PK and SK. */
export function putState(t: Tables, row: Record<string, unknown>): Tables {
  const out = structuredClone(t);
  const r = av(row as any);
  out[STATE] = [...(out[STATE] ?? []).filter((x) => { const p = plain(x); return !(p['PK'] === row['PK'] && p['SK'] === row['SK']); }), r];
  return out;
}
/** A guard row as another run would leave it. */
export const guardRow = (h: Hired, status: string, extra: Record<string, unknown> = {}) => ({
  PK: `NOTICE#HM_IT#${h.offer}`, SK: 'NOTICE', status, claimed_at: '2026-11-25T08:00:11.000Z', offer_id: h.offer, candidate_id: h.candidate, tenant_id: h.tenant, ...extra,
});
export const withCandidate = (t: Tables, candidate: string, set: Record<string, unknown>) => withRow(t, `CANDIDATE#${candidate}`, 'SAGA', set);
export const withOffer = (t: Tables, offer: string, set: Record<string, unknown>) => withRow(t, `OFFER#${offer}`, 'OFFER', set);
export const sagaOf = (t: Tables, candidate: string) => rowsOf(t).find((r) => r['PK'] === `CANDIDATE#${candidate}` && r['SK'] === 'SAGA');

// ---------------------------------------------------------------- the event and the run

/** The EventBridge event Lambda gets from the rule (no input transformer: the whole event). */
export function hiredEvent(detail: Record<string, unknown>, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: '0', id: 'rec16-event-0001', 'detail-type': 'CandidateHired', source: 'talent-flow.workflow', account: '424556617428',
    time: '2026-11-25T08:00:10Z', region: 'af-south-1', resources: [], detail, ...over,
  };
}

export type Mode = 'HIRING_MANAGER' | 'TEST_ADDRESS';
/** The settings rule 11 names, with the values a correct deployment gives. COGNITO_POOL_ID is the fake pool's own setting (the fake
 *  Cognito answers only that pool); the Lambda is not expected to read it. */
export function settings(mode: Mode | undefined, extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    HM_IT_EMAIL_MODE: mode, HM_IT_TEST_EMAIL: TEST_EMAIL, POSTMARK_API_TOKEN: 'rec16-fake-token', POSTMARK_SENDER_EMAIL: SENDER,
    STATE_TABLE: STATE, TENANTS_TABLE: TENANTS, HM_COGNITO_POOL_ID: POOL, HM_GROUP_NAME: 'naleko-talentflow-hiringmanager', COGNITO_POOL_ID: POOL,
    ...extra,
  };
}

export type Opts = { mode?: Mode; env?: Record<string, string | undefined>; extra?: Extra; users?: PoolUser[] };
/** Delivers one event to the handler. Default mode HIRING_MANAGER (the mode that reaches a real person, so the strictest to judge). */
export function deliver(event: unknown, t: Tables, o: Opts = {}): Run {
  return runHandler(event, t, settings(o.mode ?? 'HIRING_MANAGER', o.env ?? {}), o.users ?? pool(), o.extra ?? {});
}
export const load = (t: Tables, env: Record<string, string | undefined>) => loadOnly(t, env);

// ---------------------------------------------------------------- reading a run

export const postmarkOf = (r: { calls: any[] }) => r.calls.filter((c: any) => c.service === 'postmark');
/** A Postmark attempt that sent, or may have sent (a timeout or a dropped connection), an email. */
export const mayHaveSent = (r: { calls: any[] }) => postmarkOf(r).filter((c: any) => [...['ok', 'timeout', 'dropped', 'noMessageId'], ...NO_ANSWER_162].includes(c.outcome));
/** REC-16.2 (NH-286, lock rec-16.5): Postmark's answers that are not a numeric 400 to 499, so the email may have gone. The 4xx modes
 *  (http400, http404, http408, http429, http499) are refused: nothing went, so they are not counted. */
export const NO_ANSWER_162 = ['http500', 'http502', 'http503', 'http504', 'http399', 'http600', 'statusString', 'statusFraction', 'statusNaN', 'statusMissing'];
/** REC-16.2: every `new ServerClient(token, options)` the run made (fake-aws/postmark.mjs records it as its own service). */
export const clientsOf = (r: { calls: any[] }) => r.calls.filter((c: any) => c.service === 'postmark-client');
export const guardKey = (offer: string) => ({ PK: `NOTICE#HM_IT#${offer}`, SK: 'NOTICE' });
export const guardOf = (t: Tables, offer: string) => rowsOf(t).find((r) => r['PK'] === `NOTICE#HM_IT#${offer}` && r['SK'] === 'NOTICE');
export const guardRows = (t: Tables) => rowsOf(t).filter((r) => String(r['PK']).startsWith('NOTICE#'));
export const logLines = (r: { calls: any[] }) => r.calls.filter((c: any) => c.service === 'log').map((c: any) => `${c.message}${c.extra === undefined ? '' : ' ' + JSON.stringify(c.extra)}`);
/** The run's log lines read as JSON objects (D-T-16.4: each line is one JSON object); a line that is not one is kept as { raw }. */
export function logObjects(r: { calls: any[] }): Record<string, unknown>[] {
  return r.calls.filter((c: any) => c.service === 'log').map((c: any) => {
    try {
      const o = JSON.parse(c.message);
      if (o && typeof o === 'object' && !Array.isArray(o) && c.extra === undefined) return o as Record<string, unknown>;
    } catch { /* not JSON */ }
    return { raw: `${c.message}${c.extra === undefined ? '' : ' ' + JSON.stringify(c.extra)}` };
  });
}
export const outcomesOf = (r: { calls: any[] }) => logObjects(r).map((o) => o['outcome']).filter((x) => x !== undefined);
export const runText = (r: Run) => `${r.error ? `threw ${r.error.name}: ${r.error.message.slice(0, 300)}; ` : ''}outcomes ${JSON.stringify(outcomesOf(r))}; postmark ${JSON.stringify(postmarkOf(r).map((c: any) => c.outcome))}; logs ${JSON.stringify(logLines(r)).slice(0, 600)}`;
/** Every DynamoDB write of the run, as "op key". */
export const dbWrites = (r: { calls: any[] }) => r.calls.filter((c: any) => c.service === 'dynamodb' && /PutItem|UpdateItem|DeleteItem|BatchWriteItem|TransactWriteItems/.test(c.op));
/** Every call that is not a read, a log or a Postmark send: events, queues, other services, Cognito writes. (REC-16.2: making the
 *  Postmark client at load is not a write; AC-4 of REC-16.2 judges it with clientsOf.) */
export const otherWrites = (r: { calls: any[] }) => r.calls.filter((c: any) => !['log', 'dynamodb', 'postmark', 'postmark-client'].includes(c.service) && !(c.service === 'cognito' && /^(ListUsersInGroup|ListUsers|AdminGetUser|AdminListGroupsForUser)$/.test(c.op)));
/** The rows of every table that differ from `before`, except the guard rows (NOTICE#HM_IT#...). */
export function changedOutsideGuard(before: Tables, after: Tables): string[] {
  const out: string[] = [];
  const key = (name: string, r: Row) => { const x = plain(r); return `${name} ${x['PK'] ?? x['pk'] ?? x['employee_id'] ?? ''} ${x['SK'] ?? x['sk'] ?? ''}`; };
  const isGuard = (r: Row) => String(plain(r)['PK'] ?? '').startsWith('NOTICE#HM_IT#');
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const was = new Map((before[name] ?? []).filter((r) => !isGuard(r)).map((r) => [key(name, r), JSON.stringify(r)]));
    const now = new Map((after[name] ?? []).filter((r) => !isGuard(r)).map((r) => [key(name, r), JSON.stringify(r)]));
    for (const [k, v] of now) if (was.get(k) !== v) out.push(was.has(k) ? `${k} changed` : `${k} added`);
    for (const k of was.keys()) if (!now.has(k)) out.push(`${k} removed`);
  }
  return out;
}
