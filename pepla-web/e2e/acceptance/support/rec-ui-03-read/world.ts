import { A, B, C as C07, DAY, I2_CRITERIA, K as K07, NOW, R7_CRITERIA, SUB, TABLE, av, ask, interviewRow, plain, world as world07, type Caller, type Run, type Tables } from '../rec-07/world';
import { saga } from '../rec-02/world';
import type { Row } from '../rec-14/lambda-harness';

/**
 * REC-UI-03 step 3 (G-10a): the world of GET /v1/interviews/{id}. It is REC-07's world (support/rec-07/world.ts, unchanged: company A's
 * candidate V with I0 (old 0 to 10 vote by m1, COMPLETED, no snapshot), I1 (R7's three criteria, panel m1 m2 m3, started) and I2
 * (lead, comms, panel m1 m2 m3, started); company B's VB with IB), at REC-07's fixed time NOW, plus the rows below. All names are made up.
 *
 *   V  gets a private note on I1 and a closed note, and an email, phone, CV key, expected salary and offer fields on its saga, so the
 *      "nothing extra" scan has something to find.
 *   Y  Lindiwe Dube (company A, no role): IN, no criteria_snapshot; IE, criteria_snapshot []. Both started, panel m1.
 *   Z  Sipho Khumalo (company A, role R7): IF starts a day after NOW (panel m1); IS started, one-person panel m1; IH started,
 *      one-person panel m2; IX started, panel m1, with a status the test sets (COMPLETED, CANCELLED, DID_NOT_HAPPEN).
 */
export { A, B, DAY, I2_CRITERIA, NOW, R7_CRITERIA, SUB, TABLE, av, plain };
export type { Caller, Run, Tables };

export const K = {
  ...K07,
  y: 'CAND-RUI03AAAAAAAAAAAAAAAAY1',
  z: 'CAND-RUI03AAAAAAAAAAAAAAAAZ1',
  iN: 'iv-rui03-a-nosnap', iE: 'iv-rui03-a-empty', iF: 'iv-rui03-a-future', iS: 'iv-rui03-a-solo', iH: 'iv-rui03-a-solo-hr', iX: 'iv-rui03-a-ended',
};
export const C = C07;
/** An admin of company A who sits on a panel (M-2: any of the four roles may). */
export const SUB_ADMIN = 'sub-rui03-admin';
export const ADMIN: Caller = { name: 'Admin on the panel', groups: ['admin'], sub: SUB_ADMIN };

/** Values that must never come back in a read (AC-3.3). */
export const SECRET = {
  note: 'Candidate asked to keep the salary talk for HR only',
  closedNote: 'Closed note kept for HR only',
  email: 'thandi.private@example.test',
  phone: '082 555 0101',
  cv: 'cv/rec-ui-03/thandi-nkosi.pdf',
  salary: 'R 412 000',
};

const started = new Date(Date.parse(NOW) - 3_600_000).toISOString();
const future = new Date(Date.parse(NOW) + DAY).toISOString();

let base: Tables | undefined;
/** The seeded world. Each call hands back its own copy. */
export function world(): Tables {
  if (!base) {
    const t = world07();
    const rows = (t[TABLE.state] ?? []).map((r) => {
      const p = plain(r);
      if (p['PK'] === `CANDIDATE#${K.v}` && p['SK'] === 'SAGA') {
        return { ...r, ...av({ email: SECRET.email, phone: SECRET.phone, cvKey: SECRET.cv, expectedSalary: SECRET.salary, offerId: 'offer-rui03-aaaaaaaa', offer_state: 'DRAFT' }) };
      }
      if (p['PK'] === `CANDIDATE#${K.v}` && p['SK'] === `INTERVIEW#${K.i1}`) return { ...r, ...av({ candidate_note: SECRET.note, closed_note: SECRET.closedNote }) };
      return r;
    });
    t[TABLE.state] = [
      ...rows,
      saga(K.y, 'Lindiwe', 'Dube', A, SUB.hmA, { positionTitle: 'Junior baker', positionLevel: 'MID', currentStage: 'INTERVIEW', stageEnteredAt: '2026-11-11T08:00:00.000Z' }),
      interviewRow(K.y, K.iN, A, 'TECHNICAL', started, [SUB.m1], undefined),
      interviewRow(K.y, K.iE, A, 'BEHAVIORAL', started, [SUB.m1], []),
      saga(K.z, 'Sipho', 'Khumalo', A, SUB.hmA, { role_id: K.r7, positionTitle: 'Sales consultant', positionLevel: 'MID', currentStage: 'INTERVIEW', stageEnteredAt: '2026-11-11T08:00:00.000Z' }),
      interviewRow(K.z, K.iF, A, 'TECHNICAL', future, [SUB.m1], R7_CRITERIA),
      interviewRow(K.z, K.iS, A, 'BEHAVIORAL', started, [SUB.m1], R7_CRITERIA),
      interviewRow(K.z, K.iH, A, 'FINAL', started, [SUB.m2], R7_CRITERIA),
      interviewRow(K.z, K.iX, A, 'PHONE_SCREEN', started, [SUB.m1], R7_CRITERIA),
    ];
    t['naleko-people-dev-tenants'] = [...(t['naleko-people-dev-tenants'] ?? []), av({ pk: `USER#${SUB_ADMIN}`, sk: `TENANT#${A}`, tenant_id: A })];
    base = t;
  }
  return structuredClone(base);
}

/** A copy of `t` where interview `iv` of `cand` has the given fields. */
export function withInterview(t: Tables, cand: string, iv: string, set: Record<string, unknown>): Tables {
  const out = structuredClone(t);
  out[TABLE.state] = (out[TABLE.state] ?? []).map((r) => {
    const p = plain(r);
    return p['PK'] === `CANDIDATE#${cand}` && p['SK'] === `INTERVIEW#${iv}` ? { ...r, ...av(set as any) } : r;
  });
  return out;
}
/** A copy of `t` with more state rows. */
export function withRows(t: Tables, rows: Row[]): Tables {
  const out = structuredClone(t);
  out[TABLE.state] = [...(out[TABLE.state] ?? []), ...rows];
  return out;
}
/** A copy of `t` where the saga of `cand` is changed by `change` (on the stored form). */
export function withSaga(t: Tables, cand: string, change: (r: Row) => Row): Tables {
  const out = structuredClone(t);
  out[TABLE.state] = (out[TABLE.state] ?? []).map((r) => (plain(r)['PK'] === `CANDIDATE#${cand}` && plain(r)['SK'] === 'SAGA' ? change(r) : r));
  return out;
}
/** A vote row as code before REC-07 wrote it (no scale), with the given scores. */
export function oldStyleVote(cand: string, iv: string, voter: string, at: string, scores: Record<string, number>): Row {
  return av({ PK: `CANDIDATE#${cand}`, SK: `VOTE#${voter}#${at}`, voterId: voter, candidateId: cand, interviewId: iv, tenant_id: A, tenantId: A, rating: 'YES', scores, createdAt: at });
}

/** The route of this step: GET /v1/interviews/{id} on submitVote. */
export const readIv = (who: Caller, iv: string, t: Tables, extra: { headers?: Record<string, string>; query?: Record<string, string>; body?: unknown } = {}, opts: Parameters<typeof ask>[4] = {}): Run =>
  ask('submitVote', who, { method: 'GET', route: '/v1/interviews/{id}', path: { id: iv }, ...extra }, t, opts);
