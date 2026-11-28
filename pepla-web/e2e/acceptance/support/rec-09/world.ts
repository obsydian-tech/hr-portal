import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { httpEvent, runHandler, type PoolUser, type Row, type Run, type Tables } from '../rec-14/lambda-harness';
import { AGENT_SECRET, authorizerOf, fileOf, settings, type Caller } from '../rec-04/world';
import { C } from '../rec-04/callers';
import { CLOCK, candidateRow } from '../rec-15/world';
import { withNewVersion } from '../rec-15c/world';
import { A, B, H, K as K1, NOW, P, R, REC_U, SUB, TABLE, TENANTS, av, interviewRow, linkRow, plain, rowsOf, voteRow, withRows, withSetting, world as world01, pool as pool01, hashOf, token, W } from '../int-01/world';
import { HOOKS } from '../int-04/world';

/**
 * REC-09 (NH-243): the world of the rules that reach real people (spec onboarding-cards/specs/REC-09.md, AC-1 to AC-10). Nothing here is
 * application code.
 *
 * It is INT-01's world (companies A and B with the real Standard pack, REC-04's roles, the people p1, p2, p3 of A and pB of B with Member
 * rows and names in the fake sign-in pool, a fixed clock NOW) with the people and candidates below. Every run happens at NOW unless a test
 * gives another time (REC-15's clock). The notification queue, Postmark and the sign-in pool are the fakes of REC-14 (unchanged).
 *
 * People (a made-up person each; the Member row is the company they belong to):
 *   Recruiters of A (hr_staff + perm-recruitment, CONFIRMED): SUB.recA, REC_U, rec2. Not recruiters: hrOnly (hr_staff only), tickOnly (the tick
 *   only), recOff (a Recruiter whose sign-in is disabled), recNew (a Recruiter not yet confirmed), recNoRow (a Recruiter with no Member row),
 *   recTwo (a Recruiter with Member rows in A and B).  B's Recruiter: SUB.recB.
 *   Hiring managers: hmA (Fleet controller), hm2A (Warehouse supervisor), hmB.
 *   Approvers (perm-approve-offers): ap1 (the drafter of the offers below), ap2, apNoRow; B's approver apB.
 */
export { A, B, H, NOW, P, R, REC_U, SUB, TABLE, TENANTS, av, interviewRow, linkRow, plain, rowsOf, voteRow, withRows, withSetting, withNewVersion, hashOf, token };
export type { Caller, Row, Run, Tables, PoolUser };

const uid = (n: number) => `09a9${n.toString(16).padStart(4, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
export const X = {
  rec2: uid(1), hrOnly: uid(2), tickOnly: uid(3), recOff: uid(4), recNew: uid(5), recNoRow: uid(6), recTwo: uid(7),
  ap1: uid(8), ap2: uid(9), apNoRow: uid(10), apB: uid(11), hmNoRow: uid(12), hmOff: uid(13), p4: uid(14),
};
const MEMBERS_A = [X.rec2, X.hrOnly, X.tickOnly, X.recOff, X.recNew, X.recTwo, X.ap1, X.ap2, X.hmOff, X.p4, SUB.hm2A, SUB.hmA];
const MEMBERS_B = [X.recTwo, X.apB];
const GROUPS: Record<string, string[]> = {
  [X.rec2]: ['hr_staff', 'perm-recruitment'], [X.hrOnly]: ['hr_staff'], [X.tickOnly]: ['perm-recruitment'], [X.recOff]: ['hr_staff', 'perm-recruitment'],
  [X.recNew]: ['hr_staff', 'perm-recruitment'], [X.recNoRow]: ['hr_staff', 'perm-recruitment'], [X.recTwo]: ['hr_staff', 'perm-recruitment'],
  [X.ap1]: ['perm-approve-offers'], [X.ap2]: ['perm-approve-offers'], [X.apNoRow]: ['perm-approve-offers'], [X.apB]: ['perm-approve-offers'],
  [X.hmNoRow]: ['manager'], [X.hmOff]: ['manager'], [X.p4]: ['employee'],
};
export function pool(): PoolUser[] {
  const extra = Object.entries(GROUPS).map(([sub, groups]): PoolUser => ({
    username: sub, sub, groups, enabled: sub !== X.recOff && sub !== X.hmOff, status: sub === X.recNew ? 'FORCE_CHANGE_PASSWORD' : 'CONFIRMED',
    attributes: { sub, email: `${sub.slice(0, 8)}@mokoena.test`, given_name: 'Pat', family_name: sub.slice(0, 8) },
  }));
  return [...pool01(), ...extra];
}

/** The candidates of this card (company A unless it says otherwise). */
export const K = {
  late: 'CAND-09REC09LATEAAAAAAAAAAA1', soon: 'CAND-09REC09SOONAAAAAAAAAAA1', fine: 'CAND-09REC09FINEAAAAAAAAAAA1', lateB: 'CAND-09REC09LATEBBBBBBBBBBB1',
  lateHm2: 'CAND-09REC09LATEHM2AAAAAAAA1', hired: 'CAND-09REC09HIREDAAAAAAAAAA1', notHired: 'CAND-09REC09NOTHIREDAAAAAAA1',
  iv: 'CAND-09REC09IVAAAAAAAAAAAAA1', ivB: 'CAND-09REC09IVBBBBBBBBBBBBB1', split: 'CAND-09REC09SPLITAAAAAAAAAA1', strong: 'CAND-09REC09STRONGAAAAAAAAA1',
  ready: 'CAND-09REC09READYAAAAAAAAAA1', offer: 'CAND-09REC09OFFERAAAAAAAAAA1', offerB: 'CAND-09REC09OFFERBBBBBBBBBB1', appr: 'CAND-09REC09APPRAAAAAAAAAAA1',
  noEmail: 'CAND-09REC09NOEMAILAAAAAAAA1', bad: 'CAND-09REC09BADAAAAAAAAAAAA1',
};
export const OFFER = { main: 'offer-09rec09main0001', b: 'offer-09rec09bbbb0001', appr: 'offer-09rec09appr0001', noMail: 'offer-09rec09nomail01' };
export const CAND_EMAIL = 'amahle.zulu@candidate.test';
export const seedRow = (id: string, first: string, last: string, stage: string, entered: number, o: { company?: string; role?: string; hm?: string; sla?: string; extra?: Record<string, any> } = {}) =>
  candidateRow(id, { first, last, company: o.company ?? A, stage, role: o.role ?? R.fleet, hm: o.hm ?? SUB.hmA, entered, ...(o.sla ? { sla: o.sla } : {}), extra: { configVersion: '1', email: `${first}.${last}@candidate.test`.toLowerCase(), ...(o.extra ?? {}) } });

/** The day NOW falls on and the offer expiry used below: two days after NOW, which is a Wednesday (2026-11-25). */
export const EXPIRY = '2026-11-25';
export const EXPIRY_DAY = 'Wednesday';

function seeded(): Row[] {
  return [
    seedRow(K.late, 'Lerato', 'Late', 'APPLIED', 30, { sla: 'BREACHED' }),
    seedRow(K.soon, 'Soon', 'Person', 'APPLIED', 19, { sla: 'AT_RISK' }),
    seedRow(K.fine, 'Fine', 'Person', 'APPLIED', 2),
    seedRow(K.lateB, 'Bee', 'Late', 'APPLIED', 30, { company: B, role: R.b, hm: SUB.hmB, sla: 'BREACHED' }),
    seedRow(K.lateHm2, 'Warehouse', 'Late', 'APPLIED', 30, { role: R.warehouse, hm: SUB.hm2A, sla: 'BREACHED' }),
    seedRow(K.hired, 'Hired', 'Person', 'HIRED', 30),
    seedRow(K.notHired, 'Nothired', 'Person', 'NOT_HIRED', 30),
    seedRow(K.iv, 'Ivy', 'Interview', 'INTERVIEW', 10), seedRow(K.ivB, 'Ivor', 'Binterview', 'INTERVIEW', 10, { company: B, role: R.b, hm: SUB.hmB }),
    seedRow(K.split, 'Split', 'Panel', 'INTERVIEW', 10, { extra: { PANEL_SPLIT_FLAG: true } }),
    seedRow(K.strong, 'Strong', 'Noone', 'INTERVIEW', 10),
    seedRow(K.ready, 'Ready', 'Decision', 'INTERVIEW', 10),
    seedRow(K.offer, 'Amahle', 'Zulu', 'OFFER', 10, { extra: { email: CAND_EMAIL } }),
    seedRow(K.offerB, 'Bheki', 'Boffer', 'OFFER', 10, { company: B, role: R.b, hm: SUB.hmB }),
    seedRow(K.appr, 'Ap', 'Proval', 'OFFER', 10),
    seedRow(K.noEmail, 'Noemail', 'Person', 'OFFER', 10, { extra: { email: undefined } }),
  ];
}
/** An offer row as REC-05 stores it. */
export function offerRowOf(id: string, cand: string, o: { company?: string; state?: string; expiry?: string; drafter?: string; submittedAt?: string } = {}): Row {
  const company = o.company ?? A;
  return av({
    PK: `OFFER#${id}`, SK: 'OFFER', offer_id: id, candidate_id: cand, tenant_id: company, state: o.state ?? 'SENT', expiry_date: o.expiry ?? EXPIRY, start_date: '2027-01-15', salary: 100000,
    currency: 'ZAR', drafted_by: o.drafter ?? X.ap1, drafted_at: H(-72), ...(o.submittedAt ? { submitted_at: o.submittedAt } : {}), version: 3,
  });
}
export const liveLock = (company: string, cand: string, offerId: string): Row => av({ PK: `TENANT#${company}#OFFER_LIVE#${cand}`, SK: 'LOCK', live_offer_id: offerId, tenant_id: company });

let base: Tables | undefined;
/** INT-01's world with this card's people and candidates (and the offers a live offer needs). Each call hands back its own copy. */
export function world(): Tables {
  if (!base) {
    let t = withRows(world01(), seeded());
    t[TENANTS] = [
      ...(t[TENANTS] ?? []),
      ...MEMBERS_A.filter((s) => s !== SUB.hmA && s !== SUB.hm2A).map((s) => av({ pk: `USER#${s}`, sk: `TENANT#${A}`, tenant_id: A, created_at: '2026-11-01T08:00:00.000Z' })),
      ...MEMBERS_B.map((s) => av({ pk: `USER#${s}`, sk: `TENANT#${B}`, tenant_id: B, created_at: '2026-11-01T08:00:00.000Z' })),
    ];
    t[TABLE.notifications] ??= [];
    t[TABLE.events] ??= [];
    // Company B has rules of its own: RULE-SLA-001 is LOW for B (A's is HIGH) and repeats after 6 hours (A's 24), so a run that judges B by A's rules shows.
    t = withSetting(t, B, 'INTELLIGENCE_RULES', (d: any) => ({ ...d, rules: d.rules.map((r: any) => (r.id === 'RULE-SLA-001' ? { ...r, severity: 'LOW', action: { ...r.action, cooldown: 6 } } : r)) }));
    base = t;
  }
  return structuredClone(base);
}

// ---------------------------------------------------------------- runs

const NODE_OPTIONS = [CLOCK, HOOKS].map((f) => `--import=${pathToFileURL(f).href}`).join(' ');
export type O9 = { now?: string; env?: Record<string, string | undefined>; pool?: PoolUser[]; fail?: any };
/** Runs any handler with an event at NOW (or `o.now`), with this card's pool and preloads. */
export function invoke(handler: string, event: unknown, t: Tables, o: O9 = {}): Run {
  const env = { ...settings({ ROLES_TABLE_NAME: 'talent-flow-roles', IDEMPOTENCY_TABLE: TABLE.idempotency }), REC15_NOW: o.now ?? NOW, NODE_OPTIONS, ...(o.env ?? {}) };
  return runHandler(fileOf(handler), event, { tables: t, secrets: { [AGENT_SECRET]: { AWSCURRENT: 'rec09-agent-key' } }, cognito: { users: o.pool ?? pool() }, env, ...(o.fail ? { fail: o.fail } : {}) });
}
/** A stream event with one MODIFY record per candidate id: the new image is the row as stored in `t`. */
export function stream(t: Tables, ids: string[], eventName = 'MODIFY') {
  const rows = ids.map((id) => (t[TABLE.state] ?? []).find((r) => r['PK']?.['S'] === `CANDIDATE#${id}` && r['SK']?.['S'] === 'SAGA')).filter(Boolean) as Row[];
  return { Records: rows.map((r, i) => ({ eventID: `rec09-${i}`, eventName, dynamodb: { NewImage: r } })) };
}
/** Runs the rule engine once on these candidates. */
export const evaluate = (t: Tables, ids: string[], o: O9 = {}) => invoke('evaluateIntelligenceRules', stream(t, ids), t, o);
/** Runs the hourly job once at `now`. */
export const monitor = (t: Tables, now = NOW, o: O9 = {}) => invoke('monitorTalentFlowSLAs', { source: 'aws.events', 'detail-type': 'Scheduled Event', detail: {} }, t, { ...o, now });
/** GET the tiles as `who`. */
export function tiles(who: Caller, t: Tables, o: O9 & { query?: Record<string, string>; headers?: Record<string, string>; claims?: Record<string, unknown> } = {}): Run {
  const event = httpEvent({ authorizer: authorizerOf(who, o.claims ?? {}), query: o.query ?? {}, headers: o.headers });
  event.routeKey = 'GET /v1/intelligence/tiles';
  return invoke('getIntelligenceTiles', event, t, o);
}
/** Who a rule target goes to for company `tenantId`. */
export function recipients(tenantId: string, target: string, context: unknown, t: Tables, o: O9 = {}): Run {
  const env = { ...settings({ ROLES_TABLE_NAME: 'talent-flow-roles' }), REC15_NOW: o.now ?? NOW, ...(o.env ?? {}) };
  return runHandler(join(__dirname, 'recipients-handler.mjs'), { tenantId, target, context }, { tables: t, secrets: {}, cognito: { users: o.pool ?? pool() }, env });
}
export const idsOf = (r: Run): string[] => (r.response as any)?.ids ?? [];

export const DRAFT = { list: 'GET /v1/drafts', edit: 'PATCH /v1/drafts/{id}', send: 'POST /v1/drafts/{id}/send', dismiss: 'POST /v1/drafts/{id}/dismiss' } as const;
/** Runs one draft route as `who`. */
export function drafts(route: string, who: Caller, a: { id?: string; body?: unknown; headers?: Record<string, string>; query?: Record<string, string> }, t: Tables, o: O9 = {}): Run {
  const [method, template] = route.split(' ') as [string, string];
  const path = a.id === undefined ? template : template.replace('{id}', a.id);
  const event = httpEvent({ authorizer: authorizerOf(who), path: a.id === undefined ? undefined : { id: a.id }, body: a.body, headers: a.headers, query: a.query ?? {} });
  event.routeKey = route; event.rawPath = path; event.requestContext.routeKey = route; event.requestContext.http.method = method; event.requestContext.http.path = path;
  return invoke('manageDrafts', event, t, o);
}
/** Runs the sender once with these messages (one SQS record each). */
export function send(bodies: unknown[], t: Tables, o: O9 = {}): Run {
  const event = { Records: bodies.map((b, i) => ({ messageId: `rec09-m-${i + 1}`, body: JSON.stringify(b), attributes: { MessageGroupId: 'g' } })) };
  return invoke('sendTalentFlowNotification', event, t, { ...o, env: { INT04_POSTMARK: 'ok', MVP1_RECIPIENT_OVERRIDE: 'zz.override@rec09.example', POSTMARK_SENDER_EMAIL: 'noreply@rec09.example', ...(o.env ?? {}) } });
}

// ---------------------------------------------------------------- readers

export const bodyOf = (r: Run) => { try { return JSON.parse((r.response as any)?.body ?? 'null'); } catch { return (r.response as any)?.body; } };
export const statusOf = (r: Run) => (r.response as any)?.statusCode as number | undefined;
export const logsOf = (r: { calls: any[] }) => r.calls.filter((c: any) => c.service === 'log').map((c: any) => `${c.message}${c.extra === undefined ? '' : ' ' + JSON.stringify(c.extra)}`);
/** The messages the run queued, parsed. */
export const queued = (r: { calls: any[] }): any[] => r.calls.filter((c: any) => c.service === 'int04' && c.op === 'SendMessage').map((c: any) => { try { return JSON.parse(c.input?.MessageBody); } catch { return c.input?.MessageBody; } });
export const postmarkOf = (r: { calls: any[] }) => r.calls.filter((c: any) => c.service === 'postmark');
/** In-app notification rows (PK USER#<sub>, SK NOTIF#...). */
export const notifRows = (t: Tables) => rowsOf(t, TABLE.notifications).filter((x) => String(x['PK']).startsWith('USER#') && String(x['SK']).startsWith('NOTIF#'));
/** The rule firings written to the events table (rule 5). */
export const firings = (t: Tables) => rowsOf(t, TABLE.events).filter((x) => String(x['SK']).startsWith('INTEL#'));
export const flagsFor = (t: Tables, ruleId: string, cand?: string) => notifRows(t).filter((n) => n['ruleId'] === ruleId && (cand === undefined || n['candidateId'] === cand));
export const stateRow = (t: Tables, pk: string, sk: string) => rowsOf(t, TABLE.state).find((x) => x['PK'] === pk && x['SK'] === sk);
export const draftRows = (t: Tables) => rowsOf(t, TABLE.state).filter((x) => String(x['SK']).startsWith('DRAFT#'));
export const describe = (r: Run) => `${statusOf(r)} ${JSON.stringify(bodyOf(r)).slice(0, 300)}${r.error ? ` (threw ${r.error.name}: ${r.error.message.slice(0, 200)})` : ''}`;
export { C, K1, W };

/** An interview as the plain row the engine reads (for the recipients test). */
export const interviewRowPlain = (t: Tables, id: string, cand: string, panel: string[]) => plain(interviewRow({ id, cand, at: H(-30), panel }));

/** A candidate of company D (Recruitment off), for the module-off test. */
export const candidateRowForD = seedRow;
