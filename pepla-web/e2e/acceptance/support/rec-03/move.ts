import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { LAMBDA, REPO, STAGES_FILE, httpEvent, runHandler, runModule, runPack, runScript, type Row, type Run, type Tables } from './lambda-harness';
import { A, AGENT_SECRET, B, SUB, TABLE, authorizerOf, av, fileOf, interview, packTables, plain, rowsOf, saga, settings, type Caller } from './world';
import { attributes } from '../infra-harness';
import { resourcesOf, valueOf } from './iam';

/**
 * REC-03: the card's own world and helpers. Nothing here is application code: rows in the shape the stored records hold today, the
 * card's routes, the migration table of the card (rule 7) written out as plain values, and small readers of what a run wrote.
 *
 * The world is companies A and B, both with the real Standard pack (REC-12, written by the real pack script), plus the rows below.
 * Every candidate is MID unless it says otherwise, its hiring manager is hmA (company A) or hmB (company B), and it is already locked
 * to version 1 of every setting (settingVersions), so a move reads its settings without writing the lock.
 */

/** The six stage codes in order (REC-00 rule 6). */
export const SIX = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'NOT_HIRED'];
/** The ten old stage names of today's list (advanceCandidateStage STAGE_ORDER), as the card names them (rule 1). */
export const TEN_OLD = [
  'APPLICATION_REVIEW', 'INTERVIEWING', 'EVALUATION', 'BACKGROUND_CHECK', 'OFFER_PREPARATION', 'OFFER_APPROVAL', 'OFFER_DELIVERY',
  'CONTRACT_SIGNING', 'PRE_BOARDING', 'ONBOARDING',
];
/** Three older names still in today's code (config-reader.js, updateCandidate's lock list; REC-02 maps them too). D-T-2. */
export const OLDER = ['PHONE_SCREENING', 'TECHNICAL_INTERVIEW', 'PANEL_INTERVIEW'];
export const OLD_NAMES = [...TEN_OLD, ...OLDER];
/** The card's table (rule 7), plus the three older names (D-T-2). */
export const MAP: Record<string, string> = {
  APPLICATION_REVIEW: 'APPLIED',
  INTERVIEWING: 'INTERVIEW', EVALUATION: 'INTERVIEW',
  BACKGROUND_CHECK: 'OFFER', OFFER_PREPARATION: 'OFFER', OFFER_APPROVAL: 'OFFER', OFFER_DELIVERY: 'OFFER',
  CONTRACT_SIGNING: 'HIRED', PRE_BOARDING: 'HIRED', ONBOARDING: 'HIRED',
  PHONE_SCREENING: 'SCREENING', TECHNICAL_INTERVIEW: 'INTERVIEW', PANEL_INTERVIEW: 'INTERVIEW',
};
/** The offer states the card calls live (rule 2, back out of Offer). */
export const LIVE_OFFER = ['WAITING_APPROVAL', 'APPROVED', 'SENT'];
export const ROLE_ID = 'role-a-junior-baker';
export const LOCK_TYPES = ['STAGE_CONFIG', 'SENIORITY_PROFILES', 'INTERVIEW_TYPES', 'PANEL_CONFIG', 'SCORING_WEIGHTS', 'REJECTION_RULES', 'APPROVAL_RULES', 'SLA_THRESHOLDS', 'SENTIMENT_SCALE', 'EMAIL_TEMPLATES', 'INTELLIGENCE_RULES'];

export const HANDLER = 'advanceCandidateStage';
export const ROUTE = {
  move: 'PUT /v1/candidates/{id}/stage',
  update: 'PATCH /v1/candidates/{id}',
  events: 'GET /v1/candidates/{id}/events',
  /** REC-02's list of what the old system rejected (AC-9 and AC-11 read the script's rows back through it). */
  oldSystem: 'GET /v1/candidates/old-system',
} as const;
export const ROUTE_HANDLER: Record<string, string> = { [ROUTE.move]: 'advanceCandidateStage', [ROUTE.update]: 'updateCandidate', [ROUTE.events]: 'getCandidateEvents', [ROUTE.oldSystem]: 'recordNotHired' };
export const CORE = join(LAMBDA, 'shared', 'recruitment-actions', 'move-candidate.mjs');
export const MIGRATE = join(REPO, 'scripts', 'recruitment', 'migrate-stages.mjs');
export { STAGES_FILE };

/** The card's candidates. */
export const M = {
  applied: 'CAND-03REC03APPLIEDAAAAAAAA1',
  screening: 'CAND-03REC03SCREENINGAAAAAA1',
  /** In Interview; MID; PHONE_SCREEN and TECHNICAL completed (the gate passes); panel panelA. */
  interview: 'CAND-03REC03INTERVIEWAAAAAA1',
  /** In Interview; MID; PHONE_SCREEN completed, TECHNICAL scheduled (the gate refuses). */
  pending: 'CAND-03REC03PENDINGAAAAAAAA1',
  /** In Interview; MID; PHONE_SCREEN completed, TECHNICAL cancelled. */
  cancelled: 'CAND-03REC03CANCELLEDAAAAAA1',
  /** In Interview; JUNIOR; PHONE_SCREEN completed (all a JUNIOR needs). */
  junior: 'CAND-03REC03JUNIORAAAAAAAAA1',
  /** In Interview; SENIOR; PHONE_SCREEN and TECHNICAL completed, BEHAVIORAL not held (the gate refuses). */
  senior: 'CAND-03REC03SENIORAAAAAAAAA1',
  /** In Interview; MID; four other interviews first, the two required ones completed last (a second page of a Query). */
  paged: 'CAND-03REC03PAGEDAAAAAAAAAA1',
  /** In Interview; MID; PHONE_SCREEN completed; a TECHNICAL marked completed but stamped with company B. */
  foreignIv: 'CAND-03REC03FOREIGNIVAAAAAA1',
  /** In Offer, no offer row. */
  offer: 'CAND-03REC03OFFERAAAAAAAAAA1',
  /** In Offer with an offer row in a state that is not live (today's draft state). */
  offerDraft: 'CAND-03REC03OFFERDRAFTAAAAA1',
  hired: 'CAND-03REC03HIREDAAAAAAAAAA1',
  notHired: 'CAND-03REC03NOTHIREDAAAAAAA1',
  /** Applied, with an interview already scheduled (the level lock). */
  appliedIv: 'CAND-03REC03APPLIEDIVAAAAAA1',
  /** Today's stored names, not yet moved by the script. */
  oldApp: 'CAND-03REC03OLDAPPAAAAAAAAA1',
  oldInt: 'CAND-03REC03OLDINTAAAAAAAAA1',
  oldEval: 'CAND-03REC03OLDEVALAAAAAAAA1',
  oldOffer: 'CAND-03REC03OLDOFFERAAAAAAA1',
  oldHired: 'CAND-03REC03OLDHIREDAAAAAAA1',
  oldRejected: 'CAND-03REC03OLDREJECTEDAAAA1',
  /** Company B's own candidates. */
  b: 'CAND-03REC03BBBBBBBBBBBBBBB1',
  bApplied: 'CAND-03REC03BBBBBBBBAPPLIED1',
  /** Stored under an old offer name with a live offer (round 2, AC-3). */
  oldOfferLive: 'CAND-03REC03OLDOFFERLIVEAAA1',
};
/** Live-offer candidates: one per live state, each in Offer. */
export const LIVE = Object.fromEntries(LIVE_OFFER.map((s, i) => [s, `CAND-03REC03LIVE${s.slice(0, 6).padEnd(6, 'X')}AAAA${i}`]));
export const NAMES: Record<string, [string, string]> = {};
const firsts = ['Ayanda', 'Bheki', 'Carla', 'Dumi', 'Elsa', 'Fikile', 'Gugu', 'Hlengiwe', 'Itumeleng', 'Jabu', 'Karabo', 'Lindiwe', 'Mpho', 'Nandi', 'Olwethu', 'Precious', 'Refilwe', 'Sizwe', 'Tumi', 'Unathi', 'Vuyo', 'Wandile', 'Xolani', 'Yonela', 'Zodwa'];

const NOW = '2026-11-10T08:00:00.000Z';
const lock = () => Object.fromEntries(LOCK_TYPES.map((t) => [t, 1]));
const without = (r: Row, ...keys: string[]): Row => Object.fromEntries(Object.entries(r).filter(([k]) => !keys.includes(k)));

let n = 0;
/** A candidate row of today's shape (support/rec-12/world.ts saga) in `stage`, of `level`, with hiring manager `hm`, locked to version 1. */
export function candidate(id: string, opts: { stage: string; level?: string; hm?: string | null; company?: string; extra?: Record<string, any>; unlocked?: boolean }): Row {
  const [first, last] = NAMES[id] ?? (NAMES[id] = [firsts[n++ % firsts.length]!, 'Rec-Three']);
  const r = saga(id, first, last, opts.company ?? A, opts.hm ?? (opts.company === B ? SUB.hmB : SUB.hmA), {
    currentStage: opts.stage, positionLevel: opts.level ?? 'MID', role_id: ROLE_ID, ...(opts.unlocked ? {} : { settingVersions: lock() }), ...(opts.extra ?? {}),
  });
  return opts.hm === null ? without(r, 'hiringManagerId') : r;
}
/** An interview of `type` in `status` (today's shape), with `panel` by person id. */
export function iv(id: string, ivId: string, type: string, status: string, opts: { company?: string; panel?: string[] } = {}): Row {
  return av({ ...plain(interview(id, ivId, opts.company ?? A, opts.panel ?? [SUB.panelA], status)), interviewType: type });
}
export function offerRow(id: string, state: string, company = A): Row {
  return av({
    PK: `CANDIDATE#${id}`, SK: 'OFFER', offerId: `OFFER#${id}`, candidateId: id, tenant_id: company, tenantId: company, state, positionLevel: 'MID',
    baseSalary: 91000, currency: 'ZAR', approvalChain: [], currentApprovalStep: 0, configVersion: '1', interactionLog: [], createdAt: NOW, updatedAt: NOW,
  });
}

/** The rows this card adds to the world. */
export function rec03Rows(): Row[] {
  const done = (id: string, types: string[], extra: Row[] = []) => [...types.map((t, i) => iv(id, `iv-${id.slice(-6)}-${i}`, t, 'COMPLETED')), ...extra];
  return [
    candidate(M.applied, { stage: 'APPLIED' }),
    candidate(M.screening, { stage: 'SCREENING' }),
    candidate(M.interview, { stage: 'INTERVIEW' }), ...done(M.interview, ['PHONE_SCREEN', 'TECHNICAL']),
    candidate(M.pending, { stage: 'INTERVIEW' }), ...done(M.pending, ['PHONE_SCREEN'], [iv(M.pending, 'iv-pending-t', 'TECHNICAL', 'SCHEDULED')]),
    candidate(M.cancelled, { stage: 'INTERVIEW' }), ...done(M.cancelled, ['PHONE_SCREEN'], [iv(M.cancelled, 'iv-cancelled-t', 'TECHNICAL', 'CANCELLED')]),
    candidate(M.junior, { stage: 'INTERVIEW', level: 'JUNIOR' }), ...done(M.junior, ['PHONE_SCREEN']),
    candidate(M.senior, { stage: 'INTERVIEW', level: 'SENIOR' }), ...done(M.senior, ['PHONE_SCREEN', 'TECHNICAL']),
    candidate(M.paged, { stage: 'INTERVIEW' }),
    iv(M.paged, 'iv-paged-0', 'CULTURE_FIT', 'SCHEDULED'), iv(M.paged, 'iv-paged-1', 'FINAL', 'SCHEDULED'), iv(M.paged, 'iv-paged-2', 'BEHAVIORAL', 'CANCELLED'),
    iv(M.paged, 'iv-paged-3', 'CULTURE_FIT', 'CANCELLED'), iv(M.paged, 'iv-paged-4', 'PHONE_SCREEN', 'COMPLETED'), iv(M.paged, 'iv-paged-5', 'TECHNICAL', 'COMPLETED'),
    candidate(M.foreignIv, { stage: 'INTERVIEW' }), ...done(M.foreignIv, ['PHONE_SCREEN'], [iv(M.foreignIv, 'iv-foreign-t', 'TECHNICAL', 'COMPLETED', { company: B })]),
    candidate(M.offer, { stage: 'OFFER' }), ...done(M.offer, ['PHONE_SCREEN', 'TECHNICAL']),
    candidate(M.offerDraft, { stage: 'OFFER' }), offerRow(M.offerDraft, 'OFFER_CREATED'),
    ...LIVE_OFFER.map((s) => [candidate(LIVE[s]!, { stage: 'OFFER' }), offerRow(LIVE[s]!, s)]).flat(),
    candidate(M.hired, { stage: 'HIRED' }),
    candidate(M.notHired, { stage: 'NOT_HIRED', extra: { decided_by_kind: 'PERSON', decided_by: SUB.recA, reason_code: 'WITHDREW', stage_before_not_hired: 'SCREENING', not_hired_at: '2026-11-01T09:00:00.000Z' } }),
    candidate(M.appliedIv, { stage: 'APPLIED' }), iv(M.appliedIv, 'iv-appliediv-0', 'PHONE_SCREEN', 'SCHEDULED'),
    candidate(M.oldApp, { stage: 'APPLICATION_REVIEW' }),
    candidate(M.oldInt, { stage: 'INTERVIEWING' }), ...done(M.oldInt, ['PHONE_SCREEN', 'TECHNICAL']),
    candidate(M.oldEval, { stage: 'EVALUATION' }), ...done(M.oldEval, ['PHONE_SCREEN', 'TECHNICAL']),
    candidate(M.oldOffer, { stage: 'OFFER_APPROVAL' }),
    candidate(M.oldOfferLive, { stage: 'OFFER_APPROVAL' }), offerRow(M.oldOfferLive, 'WAITING_APPROVAL'),
    candidate(M.oldHired, { stage: 'CONTRACT_SIGNING' }),
    candidate(M.oldRejected, { stage: 'INTERVIEWING', extra: { status: 'REJECTED', evaluationResult: 'FAILED', evaluationCompletedAt: '2026-10-02T09:00:00.000Z' } }), ...done(M.oldRejected, ['PHONE_SCREEN', 'TECHNICAL']),
    candidate(M.b, { stage: 'INTERVIEW', company: B }), ...[iv(M.b, 'iv-b-ps', 'PHONE_SCREEN', 'COMPLETED', { company: B, panel: [SUB.panelB] }), iv(M.b, 'iv-b-t', 'TECHNICAL', 'COMPLETED', { company: B, panel: [SUB.panelB] })],
    candidate(M.bApplied, { stage: 'APPLIED', company: B }),
  ];
}

/** Sets values on a company's version-1 setting of `type` (written by the pack). */
export function setSetting(t: Tables, type: string, change: (data: any) => void, company = A): Tables {
  const rows = t[TABLE.config] ?? [];
  const i = rows.findIndex((r) => plain(r)['PK'] === `TENANT#${company}` && plain(r)['SK'] === `CONFIG#${type}#v1`);
  if (i < 0) throw new Error(`no ${type} version 1 for ${company}: the Standard pack did not write it`);
  const p = plain(rows[i]);
  change(p['data']);
  rows[i] = av(p);
  return t;
}
export const LEVELS = ['JUNIOR', 'MID', 'SENIOR'];
export const byLevel = <T>(v: T, over: Record<string, T> = {}) => Object.fromEntries(LEVELS.map((l) => [l, over[l] ?? v]));
/** Company A's REJECTION_RULES decider per level (who may move Interview to Offer: canDecide). */
export const withDecider = (t: Tables, decider: Record<string, string>, company = A) => setSetting(t, 'REJECTION_RULES', (d) => { d.decider = decider; }, company);
/** Company A's STAGE_CONFIG screening switch. */
export const withScreening = (t: Tables, on: boolean, company = A) => setSetting(t, 'STAGE_CONFIG', (d) => { d.screening = on; }, company);
/** Company A's required interviews per level. */
export const withRequired = (t: Tables, required: Record<string, string[]>, company = A) => setSetting(t, 'INTERVIEW_TYPES', (d) => { Object.assign(d.requiredByLevel, required); }, company);

let packedB: Tables | undefined;
/** A and B with the Standard pack, plus this card's rows. Each call hands back its own copy. */
export function world(): Tables {
  if (!packedB) {
    const r = runPack(B, 'dev', { tables: packTables() });
    if (r.code !== 0) throw new Error(`the Standard pack did not run for company B (exit ${r.code}): ${(r.stdout + r.stderr).slice(-600)}`);
    packedB = r.tables;
  }
  const t = structuredClone(packedB);
  t[TABLE.state] = [...(t[TABLE.state] ?? []), ...rec03Rows()];
  return t;
}

// ---------------------------------------------------------------- calls

export type Ask3 = { id?: string; body?: unknown; headers?: Record<string, string>; query?: Record<string, string>; claims?: Record<string, unknown> };
/** Runs one route as `caller`, as API Gateway (HTTP API, payload 2.0) hands it over. */
export function call(route: string, caller: Caller, a: Ask3, t: Tables, opts: { queryPageSize?: number } = {}): Run {
  const [method, template] = route.split(' ') as [string, string];
  const path = a.id === undefined ? template : template.replace('{id}', a.id);
  const event = httpEvent({ authorizer: authorizerOf(caller, a.claims ?? {}), path: a.id === undefined ? undefined : { id: a.id }, query: a.query, body: a.body, headers: a.headers });
  event.routeKey = route;
  event.rawPath = path;
  event.requestContext.routeKey = route;
  event.requestContext.http.method = method;
  event.requestContext.http.path = path;
  return runHandler(fileOf(ROUTE_HANDLER[route]!), event, {
    tables: t, secrets: { [AGENT_SECRET]: { AWSCURRENT: 'rec03-agent-key' } }, env: settings(), cognito: { users: [] }, ...(opts.queryPageSize ? { queryPageSize: opts.queryPageSize } : {}),
  });
}
/** A move as the screens send it: PUT /v1/candidates/{id}/stage { to, reason }. */
export const move = (caller: Caller, id: string, body: unknown, t: Tables, a: Omit<Ask3, 'id' | 'body'> = {}, opts: { queryPageSize?: number } = {}) => call(ROUTE.move, caller, { ...a, id, body }, t, opts);
export const update = (caller: Caller, id: string, body: unknown, t: Tables) => call(ROUTE.update, caller, { id, body }, t);
export const history = (caller: Caller, id: string, t: Tables) => call(ROUTE.events, caller, { id }, t);

/** Runs the migration script against `t` (script conventions of scripts/tenancy/move-default.mjs, D-T-13). */
export function migrate(args: string[], t: Tables, opts: { sts?: { Account: string; Arn: string }; queryPageSize?: number } = {}) {
  return runScript(MIGRATE, args, { tables: t, ...(opts.sts ? { sts: opts.sts } : {}), queryPageSize: opts.queryPageSize ?? 2 });
}
/** Calls normaliseStage in the shared stage file once per value, in one process. */
export function normalise(values: unknown[]) {
  return runModule(values.map((v) => ({ fn: 'normaliseStage', args: [v] })), { module: STAGES_FILE });
}

// ---------------------------------------------------------------- readers

export const sagaOf = (t: Tables, id: string) => rowsOf(t, TABLE.state).find((r) => r['PK'] === `CANDIDATE#${id}` && r['SK'] === 'SAGA');
/** Stage history rows of a candidate (today's place: SK STAGE#..., advanceCandidateStage writeStageHistory). */
export const historyOf = (t: Tables, id: string) => rowsOf(t, TABLE.state).filter((r) => r['PK'] === `CANDIDATE#${id}` && String(r['SK']).startsWith('STAGE#'));
/** The new history rows of a candidate between two worlds. */
export const newHistory = (before: Tables, after: Tables, id: string) => historyOf(after, id).filter((h) => !historyOf(before, id).some((x) => x['SK'] === h['SK']));
/** A history row's fields under the card's names, or today's (D-T-8). */
export const hist = (h: Record<string, any>) => ({ from: h['from'] ?? h['fromStage'], to: h['to'] ?? h['toStage'], by: h['by'] ?? h['actor'], at: h['at'] ?? h['timestamp'] });
const own = (r: { calls: any[] }) => r.calls.filter((c: any) => c.service !== 'log' && c.service !== 'step');
/** Every event the run put on a bus: { detailType, source, detail }. */
export const eventsOf = (r: { calls: any[] }) => own(r).filter((c) => c.service === 'events').map((c) => ({ detailType: c.detailType as string, source: c.source as string, detail: c.detail as Record<string, any> }));
const WRITE_OP = /PutItem|UpdateItem|DeleteItem|BatchWriteItem|TransactWriteItems/;
/** The first lock of a candidate's settings (REC-12) is the one write a read may make: a SET of settingVersions and nothing else. */
const settingsLockOnly = (c: any) => c.op === 'UpdateItem' && /^\s*SET\s+settingVersions(\.#\w+)?\s*=\s*:\w+\s*$/.test(String(c.input?.UpdateExpression ?? ''));
/** Every call that changes anything (a table write anywhere, an event, a queue, a Lambda, a state machine), the settings lock left out. */
export const anyWrite = (r: { calls: any[] }) => own(r).filter((c) => (c.service === 'dynamodb' && WRITE_OP.test(c.op) && !settingsLockOnly(c)) || /^(events|sqs|lambda|sfn|ses|s3)$/.test(c.service));
export const awsOf = (r: { calls: any[] }) => own(r);
export const logsOf = (r: { calls: any[] }) => r.calls.filter((c: any) => c.service === 'log').map((c: any) => String(c.message) + (c.extra === undefined ? '' : ' ' + JSON.stringify(c.extra)));
/** The state table rows that changed or appeared between two worlds (settingVersions left out of the comparison). */
export function changedRows(before: Tables, after: Tables, table: string = TABLE.state) {
  const key = (r: Record<string, any>) => `${r['PK'] ?? r['pk']}|${r['SK'] ?? r['sk']}`;
  const strip = (r: Record<string, any>) => JSON.stringify({ ...r, settingVersions: undefined });
  const old = new Map(rowsOf(before, table).map((r) => [key(r), strip(r)]));
  return rowsOf(after, table).filter((r) => old.get(key(r)) !== strip(r));
}

// ---------------------------------------------------------------- what the card's text check reads

const CODE_FILE = /\.(m?js|cjs)$/;
const SKIP = /(^|\/)(node_modules|__tests__|coverage)(\/|$)|\.test\.(m?js|cjs)$|\.spec\.(m?js|cjs)$/;
function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (SKIP.test(p)) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (CODE_FILE.test(name)) out.push(p);
  }
  return out;
}
/** The function names of every Lambda in the TalentFlow stack (talent-flow-infra), as Terraform names them. */
export function talentFlowLambdas(): string[] {
  return [...new Set(resourcesOf('talent-flow-infra', 'aws_lambda_function').map((b) => valueOf('talent-flow-infra', attributes(b.body).get('function_name'))).filter(Boolean))];
}
/**
 * The code the card's one-list rule covers (D-T-3): every Recruitment Lambda's own folder (the TalentFlow stack's functions), the
 * Recruitment shared files, and the Standard pack seed. Tests, packages and the one-off scripts at the top of lambda/ are left out.
 */
export function recruitmentCode(): string[] {
  const shared = join(LAMBDA, 'shared');
  const files = [
    ...talentFlowLambdas().flatMap((fn) => walk(join(LAMBDA, fn))),
    ...walk(join(shared, 'recruitment-actions')),
    ...(existsSync(shared) ? readdirSync(shared).filter((f) => /^(recruitment-.*\.mjs|config-reader\.js|tf-.*\.js)$/.test(f)).map((f) => join(shared, f)) : []),
    join(REPO, 'scripts', 'tenancy', 'module-seeds', 'recruitment.mjs'),
  ];
  return [...new Set(files)].filter(existsSync);
}
export const read = (p: string) => readFileSync(p, 'utf8');
export { A, B };
