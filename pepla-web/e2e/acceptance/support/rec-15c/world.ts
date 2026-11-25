import { A, B, NOW, R, ROLES_TABLE, SUB, TABLE, TENANTS, ago, av, plain, rowsOf, runRoute, world as world15, type Run, type Tables } from '../rec-15/world';
import { candidateRow } from '../rec-15/world';
import { DEP } from '../rec-14/world';
import type { Caller } from '../rec-04/world';
import type { Row } from '../rec-14/lambda-harness';

/**
 * REC-15 step C: the world of the candidate record (spec Part 2, rules 12 to 18, AC-10 to AC-13). Nothing here is application code.
 *
 * It is REC-15 step A's world (companies A and B with the real Standard pack, REC-04's roles, A's departments list, a fixed clock NOW,
 * A's stage hours Applied 24, Screening 48, Interview 100, Offer 72) with the candidates below added. Every one of them is a row as it is
 * stored today, with no settingVersions (an older row: the record must read its settings without locking it, spec check C-2), unless it
 * says otherwise.
 *
 * Company A (Fleet controller is MID, hiring manager hmA; Warehouse supervisor is SENIOR, hm2A; the Standard pack's interview rule:
 * JUNIOR needs PHONE_SCREEN, MID adds TECHNICAL, SENIOR adds BEHAVIORAL):
 *   full      Interview, Fleet, department Operations by id, added by recA, source, employee-free. PHONE_SCREEN completed (panel panelA),
 *             TECHNICAL scheduled (panel panelA and panelX): 1 of 2 done, so the next step is blocked. The row also carries every old
 *             field a caller reads, and fields that must never leave: an ID number, salary, an offer, a Not hired note, criteria,
 *             recruiterId, updatedBy, idempotency fields, and a settingVersions lock (shown to a Recruiter only, spec check C-1).
 *   ready     Interview, Fleet, PHONE_SCREEN completed twice and TECHNICAL completed: 2 of 2, no blocker.
 *   twice     Interview, Fleet, PHONE_SCREEN completed twice and TECHNICAL scheduled: still 1 of 2 (types are counted, not interviews).
 *   foreign   Interview, Fleet, PHONE_SCREEN completed, and a TECHNICAL marked completed but stamped company B: 1 of 2.
 *   applied   Applied, Fleet.            screening  Screening, Fleet.           offer  Offer, Fleet, both required types completed.
 *   legacy    Hired with the REC-03 marker legacy_hired (and no employee_id).
 *   employed  Hired with an employee_id and hired_at (REC-06 writes them).
 *   notHired  Not hired from Interview (stage_before_not_hired INTERVIEW), with a reason note and decided_by_kind PERSON.
 *   old       An old row: no role_id, no appliedDate, the old stage name TECHNICAL_INTERVIEW (Interview), department as free text.
 *   junior    Interview, JUNIOR, Fleet, no interview at all: 0 of 1.     senior  Interview, SENIOR, Warehouse (hm2A), 2 of 3 done.
 *   bDept     Applied, Fleet, but its department_id is company B's: B's name must never show.
 * Company B: bCand, Interview on B's role, hmB, with a completed PHONE_SCREEN (panel panelB).
 */
export { A, B, NOW, R, ROLES_TABLE, SUB, TABLE, TENANTS, DEP, ago, av, plain, rowsOf };
export type { Run, Tables, Row };

export const Q = {
  full: 'CAND-15REC15CFULLAAAAAAAAAA1', ready: 'CAND-15REC15CREADYAAAAAAAAA1', twice: 'CAND-15REC15CTWICEAAAAAAAAA1',
  foreign: 'CAND-15REC15CFOREIGNAAAAAAA1', applied: 'CAND-15REC15CAPPLIEDAAAAAAA1', screening: 'CAND-15REC15CSCREENAAAAAAAA1',
  offer: 'CAND-15REC15COFFERAAAAAAAAA1', legacy: 'CAND-15REC15CLEGACYAAAAAAAA1', employed: 'CAND-15REC15CEMPLOYEDAAAAAA1',
  notHired: 'CAND-15REC15CNOTHIREDAAAAAA1', old: 'CAND-15REC15COLDAAAAAAAAAAA1', junior: 'CAND-15REC15CJUNIORAAAAAAAA1',
  senior: 'CAND-15REC15CSENIORAAAAAAAA1', bDept: 'CAND-15REC15CBDEPTAAAAAAAAA1',
  bCand: 'CAND-15REC15CBCANDBBBBBBBBB1',
};
export const EMPLOYEE_ID = 'emp_01REC15CEMPLOYEEAAAAAAAA1';
/** Text that is stored on the full row and must never be in any answer or log line. */
export const NEVER = { idNumber: '8001015009087', note: 'zz-rec15c-private-note', salary: 'zz-rec15c-salary-text', idemKey: 'zz-rec15c-idem-key' };
/** Every old field the full row carries that rule 12 keeps (and step 0 item 1 adds), with its stored value. */
export const OLD_KEPT_VALUES: Record<string, unknown> = {
  email: 'thabo.nkosi@example.test', phone: '+27 82 555 0199', positionTitle: 'Fleet ctrl (old title)', positionLevel: 'MID', department: 'Ops (typed when added)',
  location: 'Durban', experienceYears: 6, source: 'Referral', hiringManagerId: SUB.hmA, appliedDate: ago(240), currentStage: 'INTERVIEW', stageEnteredAt: ago(30),
  status: 'ACTIVE', slaStatus: 'AT_RISK', createdAt: ago(241), workflowTemplateId: 'wf-standard', configVersion: '1', updatedAt: ago(30), slaBreachedAt: ago(2),
  interviewSentiment: 'POSITIVE', engagementSentiment: 'INTERESTED', acceptanceSentiment: 'NEUTRAL', engagementScore: 7, evaluationResult: 'PENDING', finalScore: 3.5,
  firstName: 'Thabo', lastName: 'Nkosi',
};
/** Stored fields that are not on rule 12's list: no caller ever gets them. */
export const NEVER_FIELDS: Record<string, unknown> = {
  idNumber: NEVER.idNumber, salary: NEVER.salary, baseSalary: 91000, offer: { state: 'OFFER_CREATED', baseSalary: 91000 }, reason_note: NEVER.note,
  criteria: [{ key: 'technical', label: 'Technical' }], recruiterId: SUB.recA, updatedBy: SUB.recA, idempotencyKey: NEVER.idemKey, not_hired_pending: { by: SUB.recA, reason_code: 'WITHDREW' },
  stage_before_not_hired: 'INTERVIEW', legacy_stage: 'PANEL_INTERVIEW', role: 'not a field anyone reads',
};
export const LOCK_V1 = {
  STAGE_CONFIG: 1, SENIORITY_PROFILES: 1, INTERVIEW_TYPES: 1, PANEL_CONFIG: 1, SCORING_WEIGHTS: 1, REJECTION_RULES: 1, APPROVAL_RULES: 1, SLA_THRESHOLDS: 1,
  SENTIMENT_SCALE: 1, EMAIL_TEMPLATES: 1, INTELLIGENCE_RULES: 1,
};

type Iv = { n: number; type: string; status: string; panel: string[]; company?: string; at?: string };
/** An interview row of a candidate, as scheduleInterview stores it. */
export function interviewRow(id: string, company: string, iv: Iv): Row {
  return av({
    PK: `CANDIDATE#${id}`, SK: `INTERVIEW#iv-${id.slice(13, 21).toLowerCase()}-${iv.n}`, interviewId: `iv-${id.slice(13, 21).toLowerCase()}-${iv.n}`, candidateId: id,
    tenant_id: iv.company ?? company, tenantId: iv.company ?? company, interviewType: iv.type, status: iv.status, scheduledAt: iv.at ?? ago(48 - iv.n),
    panelMemberIds: iv.panel, votesRequired: iv.panel.length, createdAt: ago(60 - iv.n),
  });
}
const done = (n: number, type: string, panel: string[] = [SUB.panelA], company?: string): Iv => ({ n, type, status: 'COMPLETED', panel, company });
const planned = (n: number, type: string, panel: string[] = [SUB.panelA]): Iv => ({ n, type, status: 'SCHEDULED', panel });

type C = { first: string; last: string; company: string; stage: string; role?: string | null; hm: string; level?: string; entered?: number; extra?: Record<string, any>; ivs?: Iv[] };
export const CAND: Record<string, C> = {
  [Q.full]: {
    first: 'Thabo', last: 'Nkosi', company: A, stage: 'INTERVIEW', role: R.fleet, hm: SUB.hmA, entered: 30,
    extra: { ...OLD_KEPT_VALUES, ...NEVER_FIELDS, department_id: DEP.opsA.id, added_by: SUB.recA, settingVersions: LOCK_V1, decided_by_kind: 'PERSON', GSI1SK: `SAGA#${ago(241)}` },
    ivs: [done(1, 'PHONE_SCREEN'), planned(2, 'TECHNICAL', [SUB.panelA, SUB.panelX])],
  },
  [Q.ready]: { first: 'Ready', last: 'Mokoena', company: A, stage: 'INTERVIEW', role: R.fleet, hm: SUB.hmA, entered: 20, ivs: [done(1, 'PHONE_SCREEN'), done(2, 'PHONE_SCREEN'), done(3, 'TECHNICAL')] },
  [Q.twice]: { first: 'Twice', last: 'Dube', company: A, stage: 'INTERVIEW', role: R.fleet, hm: SUB.hmA, entered: 20, ivs: [done(1, 'PHONE_SCREEN'), done(2, 'PHONE_SCREEN'), planned(3, 'TECHNICAL')] },
  [Q.foreign]: { first: 'Foreign', last: 'Interview', company: A, stage: 'INTERVIEW', role: R.fleet, hm: SUB.hmA, entered: 20, ivs: [done(1, 'PHONE_SCREEN'), done(2, 'TECHNICAL', [SUB.panelA], B)] },
  [Q.applied]: { first: 'Applied', last: 'Person', company: A, stage: 'APPLIED', role: R.fleet, hm: SUB.hmA, entered: 5 },
  [Q.screening]: { first: 'Screening', last: 'Person', company: A, stage: 'SCREENING', role: R.fleet, hm: SUB.hmA, entered: 5 },
  [Q.offer]: { first: 'Offer', last: 'Person', company: A, stage: 'OFFER', role: R.fleet, hm: SUB.hmA, entered: 5, ivs: [done(1, 'PHONE_SCREEN'), done(2, 'TECHNICAL')] },
  [Q.legacy]: { first: 'Legacy', last: 'Hire', company: A, stage: 'HIRED', role: R.fleet, hm: SUB.hmA, entered: 400, extra: { legacy_hired: true, legacy_stage: 'ONBOARDING' }, ivs: [done(1, 'PHONE_SCREEN')] },
  [Q.employed]: { first: 'Employed', last: 'Hire', company: A, stage: 'HIRED', role: R.fleet, hm: SUB.hmA, entered: 50, extra: { employee_id: EMPLOYEE_ID, hired_at: ago(50) }, ivs: [done(1, 'PHONE_SCREEN'), done(2, 'TECHNICAL')] },
  [Q.notHired]: {
    first: 'Not', last: 'Hired', company: A, stage: 'NOT_HIRED', role: R.fleet, hm: SUB.hmA, entered: 60,
    extra: { stage_before_not_hired: 'INTERVIEW', not_hired_at: ago(10), reason_code: 'WITHDREW', reason_note: NEVER.note, decided_by: SUB.recA, decided_by_kind: 'PERSON' }, ivs: [done(1, 'PHONE_SCREEN')],
  },
  [Q.old]: { first: 'Old', last: 'Row', company: A, stage: 'TECHNICAL_INTERVIEW', role: null, hm: SUB.hmA, entered: 10, extra: { appliedDate: undefined, department: 'Bakery floor', positionTitle: 'Bread maker' }, ivs: [done(1, 'PHONE_SCREEN')] },
  [Q.junior]: { first: 'Junior', last: 'Person', company: A, stage: 'INTERVIEW', role: R.fleet, hm: SUB.hmA, level: 'JUNIOR', entered: 5 },
  [Q.senior]: { first: 'Senior', last: 'Person', company: A, stage: 'INTERVIEW', role: R.warehouse, hm: SUB.hm2A, level: 'SENIOR', entered: 5, ivs: [done(1, 'PHONE_SCREEN', [SUB.panel2A]), done(2, 'TECHNICAL', [SUB.panel2A])] },
  [Q.bDept]: { first: 'Bdept', last: 'Person', company: A, stage: 'APPLIED', role: R.fleet, hm: SUB.hmA, entered: 5, extra: { department_id: DEP.dispatchB.id, department: 'Typed dispatch' } },
  [Q.bCand]: { first: 'Bontle', last: 'Candidate', company: B, stage: 'INTERVIEW', role: R.b, hm: SUB.hmB, entered: 5, ivs: [done(1, 'PHONE_SCREEN', [SUB.panelB])] },
};
export const nameOf = (id: string) => `${CAND[id]!.first} ${CAND[id]!.last}`;

/** The stored rows of one candidate of this world (its row, then its interviews). */
export function rowsOfCandidate(id: string, c: C = CAND[id]!): Row[] {
  const extra: Record<string, any> = { positionLevel: c.level ?? (c.role === R.warehouse ? 'SENIOR' : 'MID'), ...(c.extra ?? {}) };
  const row = candidateRow(id, { first: c.first, last: c.last, company: c.company, stage: c.stage, role: c.role, hm: c.hm, entered: c.entered, level: extra['positionLevel'], extra });
  return [row, ...(c.ivs ?? []).map((iv) => interviewRow(id, c.company, iv))];
}

/** REC-15 step A's world with this card's candidates and their interviews added. */
export function world(): Tables {
  const t = world15();
  t[TABLE.state] = [...(t[TABLE.state] ?? []), ...Object.keys(CAND).flatMap((id) => rowsOfCandidate(id))];
  return t;
}

// ---------------------------------------------------------------- settings

const isActiveRow = (p: Record<string, any>, c: string, type: string) => p['PK'] === `TENANT#${c}` && p['GSI1PK'] === `TENANT#${c}#ACTIVE` && p['GSI1SK'] === `CONFIG#${type}`;
/** The data of company `c`'s active version of a setting, plain. */
export function activeData(t: Tables, c: string, type: string): any {
  return rowsOf(t, TABLE.config).find((p) => isActiveRow(p, c, type))?.['data'];
}
/** Company `c`'s active version of a setting with its data changed in place (same version number). */
export function withSetting(t: Tables, c: string, type: string, change: (d: any) => any): Tables {
  const out = structuredClone(t);
  out[TABLE.config] = (out[TABLE.config] ?? []).map((r) => {
    const p = plain(r);
    return isActiveRow(p, c, type) ? av({ ...p, data: change(structuredClone(p['data'])) }) : r;
  });
  return out;
}
/**
 * A new active version of a setting for company `c` (as the settings route saves one: the old version stays as a row, no longer active).
 * Answers the world and the new version number.
 */
export function withNewVersion(t: Tables, c: string, type: string, change: (d: any) => any): { t: Tables; version: number } {
  const out = structuredClone(t);
  let version = 0;
  let data: any;
  out[TABLE.config] = (out[TABLE.config] ?? []).map((r) => {
    const p = plain(r);
    if (!isActiveRow(p, c, type)) return r;
    version = Number(p['version']) + 1;
    data = change(structuredClone(p['data']));
    const { GSI1PK: _a, GSI1SK: _b, ...rest } = p;
    return av({ ...rest, isActive: false });
  });
  if (!version) throw new Error(`company ${c} has no active ${type}`);
  out[TABLE.config]!.push(av({
    PK: `TENANT#${c}`, SK: `CONFIG#${type}#v${version}`, GSI1PK: `TENANT#${c}#ACTIVE`, GSI1SK: `CONFIG#${type}`, tenant_id: c, tenantId: c, configType: type, version, isActive: true,
    data, createdAt: ago(1),
  }));
  return { t: out, version };
}
/** The level's decider (REJECTION_RULES.decider) for company A, set for every level at once or for one. */
export const withDecider = (t: Tables, decider: 'HR_ONLY' | 'HR_OR_HM', level?: string) =>
  withSetting(t, A, 'REJECTION_RULES', (d) => { for (const l of Object.keys(d.decider)) if (!level || l === level) d.decider[l] = decider; return d; });
/** Screening on or off for company A. */
export const withScreening = (t: Tables, on: boolean) => withSetting(t, A, 'STAGE_CONFIG', (d) => ({ ...d, screening: on }));

/** The same world with one candidate's stored fields changed (plain values merged; `undefined` removes a field). */
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
/** Company `c`'s departments list with one department renamed. */
export function withDepartmentName(t: Tables, c: string, id: string, name: string): Tables {
  const out = structuredClone(t);
  out[TENANTS] = (out[TENANTS] ?? []).map((r) => {
    const p = plain(r);
    if (p['pk'] !== `TENANT#${c}` || p['sk'] !== 'DEPARTMENTS') return r;
    return av({ ...p, departments: (p['departments'] as any[]).map((d) => (d.id === id ? { ...d, name } : d)) });
  });
  return out;
}
/**
 * Lock check round 1, FX-2: two stray role rows in company A's partition of the roles table. `stampedB` sits under TENANT#A / ROLE#<id>
 * but is stamped company B; `mismatch` sits under TENANT#A / ROLE#<id> but stores another role_id. Neither is A's role: the list's role
 * reader (candidate-list.mjs roleOf) refuses both, so their titles must never reach A's record.
 */
export const STRAY = {
  stampedB: { id: 'role-01REC15CSTRAYBAAAAAAAA1', title: 'Zz stray role stamped B' },
  mismatch: { id: 'role-01REC15CMISMATCHAAAAAAA1', title: 'Zz role row with another id' },
};
export function withStrayRoles(t: Tables): Tables {
  const out = structuredClone(t);
  const f = plain(roleRowOf(out, A, R.fleet)) as Record<string, any>;
  out[ROLES_TABLE] = [
    ...(out[ROLES_TABLE] ?? []),
    av({ ...f, pk: `TENANT#${A}`, sk: `ROLE#${STRAY.stampedB.id}`, role_id: STRAY.stampedB.id, tenant_id: B, tenantId: B, job_title: STRAY.stampedB.title }),
    av({ ...f, pk: `TENANT#${A}`, sk: `ROLE#${STRAY.mismatch.id}`, role_id: R.warehouse, tenant_id: A, job_title: STRAY.mismatch.title }),
  ];
  return out;
}
const roleRowOf = (t: Tables, c: string, id: string) => (t[ROLES_TABLE] ?? []).find((r) => { const p = plain(r); return p['tenant_id'] === c && p['role_id'] === id; })!;
/** Company A's interview `n` of candidate `id` with its panel replaced (M01: a panel member on only some interviews). */
export function withPanel(t: Tables, id: string, n: number, panel: string[]): Tables {
  const out = structuredClone(t);
  const sk = `INTERVIEW#${interviewIdOf(id, n)}`;
  out[TABLE.state] = (out[TABLE.state] ?? []).map((r) => { const p = plain(r); return p['PK'] === `CANDIDATE#${id}` && p['SK'] === sk ? av({ ...p, panelMemberIds: panel }) : r; });
  return out;
}
export const interviewIdOf = (id: string, n: number) => `iv-${id.slice(13, 21).toLowerCase()}-${n}`;

export const sagaOf = (t: Tables, id: string) => rowsOf(t, TABLE.state).find((r) => r['PK'] === `CANDIDATE#${id}` && r['SK'] === 'SAGA');

// ---------------------------------------------------------------- routes

export const RECORD = 'GET /v1/candidates/{id}';
export const MOVE = 'PUT /v1/candidates/{id}/stage';
export const NOT_HIRED = 'POST /v1/candidates/{id}/not-hired';
export const REOPEN = 'POST /v1/candidates/{id}/reopen';
type O = { query?: Record<string, string>; headers?: Record<string, string>; body?: unknown; claims?: Record<string, unknown>; fail?: any };
/** GET /v1/candidates/{id} as `who`. */
export const recordRun = (who: Caller, id: string, t: Tables, o: O = {}): Run =>
  runRoute('getCandidate', RECORD, who, { path: { id }, query: o.query, headers: o.headers, body: o.body, claims: o.claims }, t, o.fail ? { fail: o.fail } : {});
/** PUT /v1/candidates/{id}/stage { to, reason } as `who` (the real REC-03 route). */
export const moveRun = (who: Caller, id: string, to: string, t: Tables): Run =>
  runRoute('advanceCandidateStage', MOVE, who, { path: { id }, body: { to, reason: 'Checking what the record says' } }, t);
/** POST /v1/candidates/{id}/not-hired { reason } as `who` (the real REC-02 route). */
export const notHiredRun = (who: Caller, id: string, t: Tables): Run =>
  runRoute('recordNotHired', NOT_HIRED, who, { path: { id }, body: { reason: 'WITHDREW' } }, t);
/** POST /v1/candidates/{id}/reopen { reason } as `who` (the real REC-02 route). */
export const reopenRun = (who: Caller, id: string, t: Tables): Run =>
  runRoute('recordNotHired', REOPEN, who, { path: { id }, body: { reason: 'Checking what the record says' } }, t);
