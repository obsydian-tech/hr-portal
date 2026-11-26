import { createHash } from 'node:crypto';
import { httpEvent, type Row, type Run, type Tables } from '../rec-14/lambda-harness';
import { authorizerOf, av, fileOf, saga, type Caller } from '../rec-02/world';
import {
  A, B, C, EMPLOYEES, K, R, SUB, TABLE, UPLOAD_BUCKET, at, bodyOf, describe, env, ok, plain, poolUsers, rowsOf, world as world06,
} from '../rec-06/world';
import { runHandler, type Extra } from './lambda-harness';

/**
 * REC-06.1: the world of the leftovers card (spec onboarding-cards/specs/REC-06.1.md, rules 1 to 13, AC-1 to AC-10). It is REC-06's
 * world (support/rec-06/world.ts, itself REC-05's) with what this card adds: candidates in Offer who share one email address. Every
 * call runs the real handler in a fresh Node process against ./fake-aws (REC-06's fake with code added only) at a fixed time.
 * All names are made up.
 *
 *   Company A  `a1` and `a2`: two candidates with the same address, stored lower case. `aCaps`: the same address stored with
 *              capitals and spaces (an old row). `empty`, `spaces` and `noEmail`: an empty address, only spaces, no address at all.
 *   Company B  `b1`: the same address as A's pair.
 */
export { A, B, C, K, R, SUB, TABLE, at, plain };
export type { Caller, Row, Run, Tables };

export const SHARED = 'shared.twin@example.test';
const cand = (company: 'A' | 'B', tag: string, n: number) => `CAND-REC061${company}${tag}${String(n).padStart(17, '0')}`;
export const KT = {
  a1: cand('A', 'TW', 1), a2: cand('A', 'TW', 2), aCaps: cand('A', 'TC', 1), empty: cand('A', 'EE', 1), spaces: cand('A', 'ES', 1),
  noEmail: cand('A', 'EN', 1), b1: cand('B', 'TW', 1),
};
type Spec = { id: string; first: string; last: string; company: string; email?: string | null; phone: string };
const SPECS: Spec[] = [
  { id: KT.a1, first: 'Lindiwe', last: 'Sithole', company: A, email: SHARED, phone: '+27 82 555 0311' },
  { id: KT.a2, first: 'Nomvula', last: 'Dube', company: A, email: SHARED, phone: '+27 82 555 0312' },
  { id: KT.aCaps, first: 'Zanele', last: 'Khumalo', company: A, email: '  Shared.Twin@Example.TEST ', phone: '+27 82 555 0313' },
  { id: KT.empty, first: 'Emptymail', last: 'Mokoena', company: A, email: '', phone: '+27 82 555 0314' },
  { id: KT.spaces, first: 'Spacemail', last: 'Mokoena', company: A, email: '   ', phone: '+27 82 555 0315' },
  { id: KT.noEmail, first: 'Nomail', last: 'Mokoena', company: A, email: null, phone: '+27 82 555 0316' },
  { id: KT.b1, first: 'Sipho', last: 'Ndlovu', company: B, email: SHARED, phone: '+27 82 555 0317' },
];
export const specOf = (id: string) => SPECS.find((s) => s.id === id);

let base: Tables | undefined;
/** REC-06's world plus this card's candidates. Each call hands back its own copy. */
export function world(): Tables {
  if (!base) {
    const w = world06();
    w[TABLE.state] = [
      ...(w[TABLE.state] ?? []),
      ...SPECS.map((s) => {
        const row = saga(s.id, s.first, s.last, s.company, s.company === B ? SUB.hmB : SUB.hmA, {
          role_id: s.company === B ? K.rb : K.ra, positionTitle: 'Driver trainee', positionLevel: 'MID', currentStage: 'OFFER',
          stageEnteredAt: '2026-11-20T08:00:00.000Z', phone: s.phone, ...(typeof s.email === 'string' ? { email: s.email } : {}),
        }) as Record<string, unknown>;
        if (s.email === null) delete row['email'];
        return row as Row;
      }),
    ];
    base = w;
  }
  return structuredClone(base);
}

// ---------------------------------------------------------------- runs (this card's fake)

export type Opts = { now?: string; headers?: Record<string, string>; query?: Record<string, string>; extra?: Extra; env?: Record<string, string>; body?: Record<string, unknown> };
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
/** Runs a handler with a non-HTTP event (a Cognito trigger, say). */
export const trigger = (handler: string, event: unknown, t: Tables, o: Opts = {}): Run => runHandler(fileOf(handler), event, t, env(o.now, o.env), extraOf(o));
export const OFFERS = 'manageOffers';
export const act = (route: string, who: Caller, id: string, body: unknown, t: Tables, o: Opts = {}) => call(OFFERS, route, who, { id, body }, t, o);

// ---------------------------------------------------------------- offers built through REC-05's routes

export const START = '2027-01-04';
export const CONFIRMED = '2027-01-11';
const PDF = { file_name: 'Signed offer.pdf', content_type: 'application/pdf', file_size: 245_760 };
export type Sent = { t: Tables; id: string; candidate: string; key: string; s3: { bucket: string; objects: Record<string, { size: number; contentType: string }> } };

/** Takes `candidate`'s offer to SENT through REC-05's routes (draft, submit, approve, send) and uploads a signed copy, from second n0. */
export function sentOffer(t0: Tables, candidate: string, n0: number): Sent {
  const company = specOf(candidate)?.company ?? A;
  const drafter = company === B ? C.recB : C.recA;
  const approver = company === B ? C.apprB : C.apprA;
  const must = (what: string, r: Run) => {
    if (!ok(r)) throw new Error(`building ${candidate}'s offer: ${what} failed (${describe(r)})`);
    return r;
  };
  let r = must('draft', call(OFFERS, R.create, drafter, { body: { candidate_id: candidate, salary: 412000, start_date: START, expiry_date: '2026-12-10' } }, t0, { now: at(n0) }));
  const id = bodyOf(r).offer_id as string;
  r = must('submit', act(R.submit, drafter, id, {}, r.tables, { now: at(n0 + 1) }));
  r = must('approve', act(R.approve, approver, id, { version: bodyOf(r).version }, r.tables, { now: at(n0 + 2) }));
  r = must('send', act(R.send, drafter, id, {}, r.tables, { now: at(n0 + 3) }));
  const up = must('signed upload', act(R.upload, drafter, id, PDF, r.tables, { now: at(n0 + 4) }));
  const key = bodyOf(up).signed_key as string;
  return { t: up.tables, id, candidate, key, s3: { bucket: UPLOAD_BUCKET, objects: { [key]: { size: PDF.file_size, contentType: PDF.content_type } } } };
}
export const acceptBody = (s: Sent, extra: Record<string, unknown> = {}) => ({ answer: 'ACCEPTED', signed_key: s.key, confirmed_start_date: CONFIRMED, ...extra });
export function accept(who: Caller, s: Sent, t: Tables, n: number, o: Opts = {}): Run {
  return act(R.answer, who, s.id, acceptBody(s, o.body ?? {}), t, { now: at(n), ...o, extra: { s3: s.s3, ...(o.extra ?? {}) } });
}

// ---------------------------------------------------------------- the lock and the claim

/** SHA-256 hex of the address trimmed and lower case (rule 1). Computed here, never with the build's own function. */
export const hashOf = (email: string) => createHash('sha256').update(email.trim().toLowerCase(), 'utf8').digest('hex');
export const lockKeyOf = (tenant: string, email: string) => `EMAIL_LOCK#${tenant}#${hashOf(email)}`;
/** Every lock row in the state table (by its sort key or its key prefix). */
export const lockRows = (t: Tables) => rowsOf(t).filter((r) => r['SK'] === 'EMAIL_LOCK' || String(r['PK']).startsWith('EMAIL_LOCK'));
export const plusMs = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();
export const MIN = 60_000;
/** Only the state table and employees from a run: what another call's finished writes look like to this one. */
export const landed = (t: Tables): Tables => ({ [TABLE.state]: t[TABLE.state] ?? [], [EMPLOYEES]: t[EMPLOYEES] ?? [] });
/** The offer row with its followups_done replaced by `fields` (strings), as another call would have left it. */
export function withFollowups(t: Tables, offerId: string, fields: Record<string, string>): Tables {
  const out = structuredClone(t);
  out[TABLE.state] = (out[TABLE.state] ?? []).map((r) => {
    const x = plain(r);
    if (x['PK'] !== `OFFER#${offerId}` || x['SK'] !== 'OFFER') return r;
    return { ...r, followups_done: { M: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { S: v }])) } } as Row;
  });
  return out;
}
/** A lock row as rule 1 writes it (for a test that plants one). */
export const lockRow = (tenant: string, email: string, offerId: string, employeeId: string, lockedAt: string) => av({
  PK: lockKeyOf(tenant, email), SK: 'EMAIL_LOCK', employee_id: employeeId, offer_id: offerId, locked_at: lockedAt, expires_at: plusMs(lockedAt, 15 * MIN), tenant_id: tenant,
});
export const withoutEmployee = (t: Tables, employeeId: string): Tables => ({ ...structuredClone(t), [EMPLOYEES]: (t[EMPLOYEES] ?? []).filter((r) => plain(r)['employee_id'] !== employeeId) });
export const withRow = (t: Tables, row: Row): Tables => ({ ...structuredClone(t), [TABLE.state]: [...(t[TABLE.state] ?? []), row] });
