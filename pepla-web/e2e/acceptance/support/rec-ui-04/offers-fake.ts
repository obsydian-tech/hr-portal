import type { BrowserContext, Locator, Page, Route } from '@playwright/test';
import { ON_DEV } from '../fixtures';
import type { ModulesFake } from '../mod-02/modules-fake';
import { COMPANY_ID, PASSWORD, WHO, expect, requestProblems, test as base, type Call, type Co, type Who } from '../rec-ui/harness';

/**
 * REC-UI-04 step A · Offers (Jira NH-230, lock acceptance-lock/rec-ui-04): the words, the people, the fake of the eleven
 * `/v1/offers` routes and the helpers of rec-ui-04.spec.ts.
 * Spec: onboarding-cards/specs/REC-UI-04.md (rules 1 to 14, W-04.1 to W-04.11, AC-1 to AC-14). Notes: ../../cards/rec-ui-04.md.
 * Backend: REC-05 (PR 507), lambda/shared/recruitment-actions/offers.mjs and lambda/manageOffers. The fake answers as that file
 * does, field for field (the `shape` and `listRow` of offers.mjs), and the routes are the ones api/openapi.yaml lists: a request
 * to a method and path the file does not have is refused and written to `contractErrors`, which the fixture checks after every
 * test (REC-14 rule 17, as the harness does).
 *
 * The harness (support/rec-ui/harness.ts, locked by rec-ui-01) does not answer `/v1/offers`; this file adds its own route on the
 * same browser context for those paths only. Every call is recorded with its sign-in, body and Idempotency-Key.
 * Nothing here calls Bedrock or any paid AI.
 */

// ---------------------------------------------------------------- the words
/** Group E (approved 17 Nov), group F, kit text, earlier approved patterns, and the W-04 lines taken under rule 7a. */
export const W = {
  offers: 'Offers',
  line: 'Every offer in one list.',
  columns: ['Candidate', 'Role', 'State', 'Expires', 'Approver'] as const,
  caption: 'Offers',
  empty: 'No one yet',
  failed: 'Offers could not be loaded.',
  tryAgain: 'Try again',
  card: 'Offer',
  created: (date: string, name: string) => `Created ${date} by ${name}`,
  details: 'Offer details',
  chain: 'Approval chain',
  role: 'Role',
  department: 'Department',
  salary: 'Salary',
  salaryHidden: 'Salary hidden',
  show: 'Show',
  hide: 'Hide',
  start: 'Start date',
  expires: 'Offer expires',
  benefits: 'Benefits',
  zar: 'ZAR',
  // Actions.
  save: 'Save draft',
  submit: 'Submit for approval',
  approve: 'Approve',
  sendBack: 'Send back',
  sendBackPrompt: 'What needs to change? (required)',
  markSent: 'Mark as sent',
  withdraw: 'Withdraw offer',
  recordAnswer: 'Record answer',
  cancel: 'Cancel',
  // Lines.
  drafter: 'You drafted this offer, so someone else approves it.',
  notApproved: 'This offer is not approved yet.',
  sentBackBy: (name: string) => `${name} sent this back:`,
  approvedBy: (name: string, date: string) => `${name} approved, ${date}.`,
  /** W-04.12 (rule 7a, this lock): the chain line while nobody has approved; REC-05 names no approver before one approves. */
  notYet: 'Not approved yet.',
  withdrawTitle: 'Withdraw this offer?',
  note: 'Note',
  optional: '(optional)',
  notFound: 'This offer could not be found.',
  generic: 'Your change could not be saved. Try again.',
  // W-04.6 refusal lines.
  noApprover: 'No one else can approve offers yet. Ask an Admin to give someone the Approve offers tick.',
  offerExists: 'This candidate already has an open offer.',
  noteRequired: 'Say what needs to change.',
  changed: 'This offer has changed. It now shows its latest state.',
  // W-04.7 field checks.
  salaryCheck: 'Enter a salary above 0.',
  startCheck: 'Choose a start date after today.',
  expiryCheck: 'Choose a date after today and on or before the start date.',
  benefitsCheck: 'Keep benefits to 2000 characters.',
  // Record answer (step A: Declined and Withdrawn only).
  answers: ['Declined', 'Withdrawn'] as const,
  accepted: 'Accepted',
  // State words (group E) and the W-04.5 "{State} {date}" pattern.
  states: {
    DRAFT: 'Draft', WAITING_APPROVAL: 'Waiting for approval', APPROVED: 'Approved', SENT: 'Sent',
    ACCEPTED: 'Accepted', DECLINED: 'Declined', EXPIRED: 'Expired', WITHDRAWN: 'Withdrawn',
  } as Record<State, string>,
  sentOn: 'Sent',
  replyDue: 'Reply due',
  approver: 'Approver',
};

/** Words that may never be on an offer page (AC-10, AC-13). */
export const NEVER = /\b(Masked|Rejected|Send off|Provisioning|Evaluation)\b/;
/** Screen text that would tell HR the app contacts the candidate (AC-10, REC-05 rule 5). */
export const TELLS_CANDIDATE = /\b(email(ed|s)?|sen[dt] to (the )?candidate|candidate (will be|is) (told|notified|emailed|sent)|we('| wi)ll (send|email|tell|notify)|notif(y|ied|ies) (the )?candidate|delivered)\b/i;

// ---------------------------------------------------------------- the people
const SUNBIRD = 'sunbird-bakery.co.za';
const person = (email: string, given: string, family: string, groups: string[], company: Co, lands: Who['lands']): Who => ({
  email: `${email}@${SUNBIRD}`, givenName: given, familyName: family, groups, password: PASSWORD, company, lands, full: `${given} ${family}`,
});
export const P = {
  /** The Recruiter who drafted the seeded offers. */
  recruiter: WHO.recruiterA,
  /** A second Recruiter of A, no approver tick. */
  recruiter2: WHO.recruiter2A,
  /** The approver with the tick only: an employee who holds perm-approve-offers (D-T-04.3). */
  approver: person('sipho.ndlovu', 'Sipho', 'Ndlovu', ['employee', 'perm-approve-offers'], 'A', '/start'),
  /** HR with the approver tick and no Recruitment tick. */
  approverHr: person('precious.mwale', 'Precious', 'Mwale', ['hr_staff', 'perm-approve-offers'], 'A', '/hr'),
  /** A person with both ticks (Recruiter and approver). Drafts the offer called `bothDraft`. */
  both: person('thandeka.dlamini', 'Thandeka', 'Dlamini', ['hr_staff', 'perm-recruitment', 'perm-approve-offers'], 'A', '/hr'),
  /** An employee of company B (Recruitment off) with the approver tick: refused (lock check round 1). */
  approverB: person('lerato.khumalo', 'Lerato', 'Khumalo', ['employee', 'perm-approve-offers'], 'B', '/start'),
  recruiterB: WHO.recruiterB,
  recruiterC: WHO.recruiterC,
  hrNoTick: WHO.hrNoTickA,
  tickOnly: WHO.tickOnlyA,
  employee: WHO.employeeA,
  manager: WHO.managerA,
} satisfies Record<string, Who>;

// ---------------------------------------------------------------- the data
export type State = 'DRAFT' | 'WAITING_APPROVAL' | 'APPROVED' | 'SENT' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'WITHDRAWN';
type Hist = { from: State | null; to: State; by_kind: 'person' | 'system'; by_name: string | null; at: string; note?: string; kind?: string; fields?: string[] };
export type Offer = {
  offer_id: string; candidate_id: string; candidate_name: string; role_title: string; department: string; company: Co;
  state: State; version: number; salary: number; currency: string; start_date: string; expiry_date: string; benefits?: string;
  created_at: string; drafted_by: string; drafted_by_name: string; submitted_at?: string; sent_at?: string; answered_at?: string;
  approval?: { approver_name: string; at: string; mode: 'ONE_APPROVER' }; approval_history: Array<{ kind: string; by_name: string; note?: string; at: string }>; history: Hist[];
};
export type Candidate = { id: string; name: string; company: Co; stage: 'OFFER' | 'INTERVIEW'; role_title: string; department: string };

/** The salary of every seeded offer (the kit's sample). It must never be on a page unless "Show" was pressed. */
export const SALARY = 650000;
export const SALARY_TEXT = '650 000.00';
export const BENEFITS = "Medical aid, provident fund, 21 days' leave";
export const NOTE = 'Please check the benefits.';
export const START = '2026-12-01';
export const EXPIRY = '2026-11-26';

const cid = (n: number) => `CAND-01JDCQ${String(n).padStart(20, '0')}`;
const oid = (n: number) => `offer-5e1d0c4a-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const CAND = {
  draft: cid(1), sentBack: cid(2), waiting: cid(3), approved: cid(4), sent: cid(5), accepted: cid(6), declined: cid(7), expired: cid(8), withdrawn: cid(9),
  bothDraft: cid(10), fresh: cid(11), interview: cid(12), b: cid(21), fresh2: cid(13),
};
export const O = {
  draft: oid(1), sentBack: oid(2), waiting: oid(3), approved: oid(4), sent: oid(5), accepted: oid(6), declined: oid(7), expired: oid(8), withdrawn: oid(9),
  bothDraft: oid(10), b: oid(21),
};
export const NAMES: Record<keyof typeof O, string> = {
  draft: 'Dineo Kruger', sentBack: 'Chipo Banda', waiting: 'Lwazi Buthelezi', approved: 'Zanele Pillay', sent: 'Kagiso Molefe', accepted: 'Pule Maseko',
  declined: 'Karabo Jacobs', expired: 'Ntombi Dlamini', withdrawn: 'Vusi Naidoo', bothDraft: 'Ayanda Mkhize', b: 'Hlengiwe Sibiya',
};
/** Dates as the screens write them ("8 Nov 2026"), Johannesburg. */
export const day = (isoDay: string): string => {
  const [y, m, d] = isoDay.slice(0, 10).split('-').map(Number);
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m! - 1]} ${y}`;
};

/** Page time: 19 Nov 2026 10:00 in Johannesburg (the harness's). "After today" is 20 Nov 2026 on. */
export const TODAY = '2026-11-19';

export function seedOffers(): { offers: Offer[]; cands: Candidate[] } {
  const R = P.recruiter, A = P.approver;
  const at = (d: string, h = 8) => `${d}T${String(h).padStart(2, '0')}:00:00.000Z`;
  const h = (from: State | null, to: State, by: string | null, when: string, extra: Partial<Hist> = {}): Hist => ({ from, to, by_kind: by ? 'person' : 'system', by_name: by, at: when, ...extra });
  const base = (k: keyof typeof O, role: string, dept: string, created: string, by: Who = R): Offer => ({
    offer_id: O[k], candidate_id: CAND[k], candidate_name: NAMES[k], role_title: role, department: dept, company: k === 'b' ? 'B' : 'A', state: 'DRAFT', version: 1,
    salary: SALARY, currency: 'ZAR', start_date: START, expiry_date: EXPIRY, benefits: BENEFITS, created_at: at(created), drafted_by: by.email, drafted_by_name: by.full,
    approval_history: [], history: [h(null, 'DRAFT', by.full, at(created))],
  });
  const submitted = (o: Offer, d: string) => { o.state = 'WAITING_APPROVAL'; o.version++; o.submitted_at = at(d); o.history.push(h('DRAFT', 'WAITING_APPROVAL', R.full, at(d))); };
  const approved = (o: Offer, d: string) => { o.state = 'APPROVED'; o.version++; o.approval = { approver_name: A.full, at: at(d, 9), mode: 'ONE_APPROVER' }; o.history.push(h('WAITING_APPROVAL', 'APPROVED', A.full, at(d, 9))); };
  const sent = (o: Offer, d: string) => { o.state = 'SENT'; o.version++; o.sent_at = at(d, 10); o.history.push(h('APPROVED', 'SENT', R.full, at(d, 10))); };
  const answered = (o: Offer, s: State, d: string, by: string | null = R.full) => { o.history.push(h(o.state, s, by, at(d, 11))); o.state = s; o.version++; o.answered_at = at(d, 11); };

  const draft = base('draft', 'Warehouse supervisor', 'Operations', '2026-11-05');
  const sentBack = base('sentBack', 'Fleet controller', 'Operations', '2026-11-06');
  submitted(sentBack, '2026-11-07');
  sentBack.state = 'DRAFT'; sentBack.version++;
  sentBack.approval_history.push({ kind: 'SENT_BACK', by_name: A.full, note: NOTE, at: at('2026-11-08') });
  sentBack.history.push(h('WAITING_APPROVAL', 'DRAFT', A.full, at('2026-11-08'), { note: NOTE }));
  const waiting = base('waiting', 'Warehouse supervisor', 'Operations', '2026-11-09'); submitted(waiting, '2026-11-18');
  const appr = base('approved', 'Fleet controller', 'Operations', '2026-11-10'); submitted(appr, '2026-11-11'); approved(appr, '2026-11-18');
  const snt = base('sent', 'Senior accountant', 'Finance', '2026-11-05'); submitted(snt, '2026-11-06'); approved(snt, '2026-11-08'); sent(snt, '2026-11-09');
  const acc = base('accepted', 'Warehouse supervisor', 'Operations', '2026-11-01'); submitted(acc, '2026-11-02'); approved(acc, '2026-11-03'); sent(acc, '2026-11-04'); answered(acc, 'ACCEPTED', '2026-11-10');
  const dec = base('declined', 'Senior accountant', 'Finance', '2026-11-02'); submitted(dec, '2026-11-03'); approved(dec, '2026-11-04'); sent(dec, '2026-11-05'); answered(dec, 'DECLINED', '2026-11-10');
  const exp = base('expired', 'Senior accountant', 'Finance', '2026-10-28'); exp.expiry_date = '2026-11-12'; submitted(exp, '2026-10-29'); approved(exp, '2026-10-30'); sent(exp, '2026-10-31'); answered(exp, 'EXPIRED', '2026-11-13', null);
  const wd = base('withdrawn', 'Fleet controller', 'Operations', '2026-11-03'); submitted(wd, '2026-11-04'); approved(wd, '2026-11-05'); answered(wd, 'WITHDRAWN', '2026-11-09');
  const bothDraft = base('bothDraft', 'Fleet controller', 'Operations', '2026-11-12', P.both); submitted(bothDraft, '2026-11-13');
  const b = base('b', 'Dispatch lead', 'Operations', '2026-11-11', P.recruiterB); submitted(b, '2026-11-12'); b.approval = { approver_name: 'Lindiwe Peters', at: at('2026-11-13'), mode: 'ONE_APPROVER' }; b.state = 'SENT'; b.sent_at = at('2026-11-14');
  const offers = [draft, sentBack, waiting, appr, snt, acc, dec, exp, wd, bothDraft, b];
  const cands: Candidate[] = [
    ...offers.map((o) => ({ id: o.candidate_id, name: o.candidate_name, company: o.company, stage: 'OFFER' as const, role_title: o.role_title, department: o.department })),
    { id: CAND.fresh, name: 'Amahle Dlamini', company: 'A', stage: 'OFFER', role_title: 'Fleet controller', department: 'Operations' },
    { id: CAND.fresh2, name: 'Bongani Mthembu', company: 'A', stage: 'OFFER', role_title: 'Fleet controller', department: 'Operations' },
    { id: CAND.interview, name: 'Tariro Moyo', company: 'A', stage: 'INTERVIEW', role_title: 'Fleet controller', department: 'Operations' },
  ];
  return { offers, cands };
}

// ---------------------------------------------------------------- the fake API
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, idempotency-key',
  'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
};
const JWT = /^Bearer eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/;
export const isOffersCall = (url: URL): boolean => /\/v1\/offers(\/|$)/.test(url.pathname);
const LIVE: State[] = ['DRAFT', 'WAITING_APPROVAL', 'APPROVED', 'SENT'];
const ROW_STATES: State[] = ['DRAFT', 'WAITING_APPROVAL', 'APPROVED', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN'];

/** How a request is answered instead (a failure test sets one). `path` is matched against the path; `method` too. */
export type OfferRefusal = { method: string; path: RegExp; status?: number; body?: unknown; abort?: boolean; once?: boolean; hold?: boolean };

export class OffersFake {
  readonly calls: Call[] = [];
  readonly contractErrors: string[] = [];
  offers: Offer[];
  cands: Candidate[];
  /** Submit answers 409 NO_APPROVER while this is on (nobody else holds the approver tick). */
  noApprover = false;
  /** A test flips `drafted_by_me` for one offer without changing anyone's roles (AC-5). */
  readonly draftedByMe = new Map<string, boolean>();
  /** A test sets `can_reveal_salary` for one offer (AC-7). */
  readonly canReveal = new Map<string, boolean>();
  private readonly emails = new Map<string, Who>();
  private readonly refusals: OfferRefusal[] = [];
  private readonly held: Array<() => void> = [];
  private readonly keyed = new Map<string, { status: number; body: unknown }>();
  private seq = 0;
  private made = 100;

  constructor(private readonly subOf: (email: string) => string | undefined, private readonly modulesOf: (co: Co) => string[], private readonly now: number) {
    const s = seedOffers();
    this.offers = s.offers;
    this.cands = s.cands;
  }

  assign(who: Who): void { this.emails.set(who.email.toLowerCase(), who); }
  refuse(r: OfferRefusal): void { this.refusals.push({ once: true, ...r }); }
  release(): void { for (const go of this.held.splice(0)) go(); }
  offer(id: string): Offer { return this.offers.find((o) => o.offer_id === id)!; }

  async install(context: BrowserContext): Promise<void> {
    await context.route((url) => isOffersCall(url), (route) => this.handle(route));
  }

  /** The calls to one route (method and path pattern), in order; OPTIONS are never counted. */
  to(method: string, path: RegExp): Call[] { return this.calls.filter((c) => c.method === method && path.test(c.path)); }
  /** Every call but preflights. */
  get requests(): Call[] { return this.calls.filter((c) => c.method !== 'OPTIONS'); }
  reads(id: string): Call[] { return this.to('GET', new RegExp(`/v1/offers/${id}$`)); }
  reveals(): Call[] { return this.calls.filter((c) => c.method === 'GET' && c.query['reveal'] === 'salary'); }

  private who(sub: string | null): Who | null {
    if (!sub) return null;
    for (const [email, who] of this.emails) if (this.subOf(email) === sub) return who;
    return null;
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const authorization = request.headers()['authorization'] ?? null;
    const who = authorization && JWT.test(authorization) ? this.who(subOf(authorization)) : null;
    const raw = `${request.method()} ${url.pathname}${url.search}\n${JSON.stringify(request.headers())}\n${request.postData() ?? ''}`;
    let body: unknown = null;
    try { body = request.postData() ? JSON.parse(request.postData()!) : null; } catch { body = request.postData(); }
    const call: Call = {
      seq: ++this.seq, method: request.method(), path: url.pathname, query: Object.fromEntries(url.searchParams), idempotencyKey: request.headers()['idempotency-key'] ?? null,
      body, authorization, email: who?.email ?? null, company: who?.company ?? null, raw, status: 0,
    };
    this.calls.push(call);
    const refusal = this.refusals.find((r) => r.method === call.method && r.path.test(call.path));
    if (refusal) {
      if (refusal.once) this.refusals.splice(this.refusals.indexOf(refusal), 1);
      if (refusal.hold) await new Promise<void>((go) => this.held.push(go));
      if (refusal.abort) { call.status = -1; return route.abort('internetdisconnected'); }
      if (!refusal.hold || refusal.status) return this.send(route, call, refusal.status ?? 500, refusal.body ?? { error: 'Internal Server Error' });
    }
    if (!authorization || !JWT.test(authorization)) return this.send(route, call, 401, { message: 'Unauthorized' });
    if (!who) return this.send(route, call, 403, { error: 'Forbidden' });
    const wrong = requestProblems(call.method, call.path, call.query);
    if (wrong.length) {
      this.contractErrors.push(...wrong);
      return this.send(route, call, wrong[0]!.includes('no such route') ? 404 : 400, { message: 'Not Found' });
    }
    const [status, answer] = this.route(call, who);
    return this.send(route, call, status, answer);
  }

  private send(route: Route, call: Call, status: number, body: unknown): Promise<void> {
    call.status = status;
    return route.fulfill({ status, headers: { ...CORS, 'cache-control': 'private, no-store', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }

  /** The one-offer answer of offers.mjs `shape`, for this caller. */
  shape(o: Offer, who: Who, reveal = false): Record<string, unknown> {
    return {
      offer_id: o.offer_id, candidate_id: o.candidate_id, candidate_name: o.candidate_name, role_title: o.role_title, department: o.department, state: o.state, version: o.version,
      start_date: o.start_date, expiry_date: o.expiry_date, benefits: o.benefits ?? null, currency: o.currency, salary: reveal ? o.salary : null, salary_hidden: !reveal,
      created_at: o.created_at, drafted_by_name: o.drafted_by_name, submitted_at: o.submitted_at ?? null, sent_at: o.sent_at ?? null, answered_at: o.answered_at ?? null,
      approval: o.approval ? { ...o.approval } : null,
      history: o.history.map((x) => ({ ...x })),
      drafted_by_me: this.draftedByMe.get(o.offer_id) ?? o.drafted_by === who.email,
      can_reveal_salary: this.canReveal.get(o.offer_id) ?? (isRecruiter(who) || isApprover(who)),
    };
  }

  private listRow(o: Offer): Record<string, unknown> {
    const out: Record<string, unknown> = { offer_id: o.offer_id, candidate_id: o.candidate_id, candidate_name: o.candidate_name, role_title: o.role_title, state: o.state, expires_at: o.expiry_date };
    const back = o.approval_history.filter((a) => a.kind === 'SENT_BACK').at(-1);
    const name = o.approval?.approver_name ?? (o.state === 'DRAFT' ? back?.by_name : undefined);
    if (name) out['approver_name'] = name;
    return out;
  }

  private route(call: Call, who: Who): [number, unknown] {
    const { method, path, query } = call;
    const forbidden: [number, unknown] = [403, { error: 'Forbidden' }];
    const notFound: [number, unknown] = [404, { error: 'Not found', code: 'NOT_FOUND' }];
    const bad = (code: string, field?: string): [number, unknown] => [400, { error: 'Bad request', code, ...(field ? { field } : {}) }];
    const conflict = (code: string): [number, unknown] => [409, { error: 'Conflict', code }];
    const recruiter = isRecruiter(who), approver = isApprover(who);
    if (!(recruiter || approver || who.groups.includes('manager'))) return forbidden;
    if (!this.modulesOf(who.company).includes('recruitment')) return forbidden;
    const at = new Date(this.now).toISOString();
    const today = TODAY;
    const futureDay = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && v > today;
    const goodSalary = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0 && /^\d{1,12}(\.\d{1,2})?$/.test(String(v));
    const b = (call.body && typeof call.body === 'object' && !Array.isArray(call.body) ? call.body : {}) as Record<string, unknown>;
    const memo = (k: string) => (call.idempotencyKey ? `${who.company}|${who.email}|${k}|${call.idempotencyKey}` : null);
    const remember = (k: string | null, r: [number, unknown]): [number, unknown] => { if (k) this.keyed.set(k, { status: r[0], body: r[1] }); return r; };
    let m: RegExpExecArray | null;

    if (/\/v1\/offers$/.test(path) && method === 'GET') {
      if (!recruiter && !approver) return forbidden;
      if (query['state'] !== undefined && !ROW_STATES.includes(query['state'] as State)) return bad('INVALID_FIELD', 'state');
      const rows = this.offers.filter((o) => o.company === who.company && (recruiter || !!o.submitted_at) && (!query['state'] || o.state === query['state']) && (!query['candidate_id'] || o.candidate_id === query['candidate_id']))
        .sort((x, y) => y.created_at.localeCompare(x.created_at) || y.offer_id.localeCompare(x.offer_id));
      return [200, { offers: rows.map((o) => this.listRow(o)) }];
    }
    if (/\/v1\/offers$/.test(path) && method === 'POST') {
      if (!recruiter) return forbidden;
      const k = memo('POST offers');
      const seen = k ? this.keyed.get(k) : undefined;
      if (seen) return [seen.status === 201 ? 200 : seen.status, seen.body];
      if (typeof b['candidate_id'] !== 'string') return remember(k, bad('INVALID_FIELD', 'candidate_id'));
      if (!goodSalary(b['salary'])) return remember(k, bad('INVALID_FIELD', 'salary'));
      if (b['currency'] !== undefined && !(typeof b['currency'] === 'string' && /^[A-Z]{3}$/.test(b['currency']))) return remember(k, bad('INVALID_FIELD', 'currency'));
      if (!futureDay(b['start_date'])) return remember(k, bad('INVALID_FIELD', 'start_date'));
      if (!futureDay(b['expiry_date']) || (b['expiry_date'] as string) > (b['start_date'] as string)) return remember(k, bad('INVALID_FIELD', 'expiry_date'));
      if (b['benefits'] !== undefined && !(typeof b['benefits'] === 'string' && b['benefits'].length <= 2000)) return remember(k, bad('INVALID_FIELD', 'benefits'));
      const c = this.cands.find((x) => x.id === b['candidate_id'] && x.company === who.company);
      if (!c) return remember(k, notFound);
      if (c.stage !== 'OFFER') return remember(k, conflict('NOT_IN_OFFER'));
      if (this.offers.some((o) => o.candidate_id === c.id && LIVE.includes(o.state))) return remember(k, conflict('OFFER_EXISTS'));
      const o: Offer = {
        offer_id: `offer-5e1d0c4a-0000-4000-8000-${String(++this.made).padStart(12, '0')}`, candidate_id: c.id, candidate_name: c.name, role_title: c.role_title, department: c.department,
        company: who.company, state: 'DRAFT', version: 1, salary: b['salary'] as number, currency: (b['currency'] as string) ?? 'ZAR', start_date: b['start_date'] as string,
        expiry_date: b['expiry_date'] as string, ...(b['benefits'] !== undefined ? { benefits: b['benefits'] as string } : {}), created_at: at, drafted_by: who.email, drafted_by_name: who.full,
        approval_history: [], history: [{ from: null, to: 'DRAFT', by_kind: 'person', by_name: who.full, at }],
      };
      this.offers.push(o);
      return remember(k, [201, this.shape(o, who)]);
    }
    if (!(m = /\/v1\/offers\/([^/]+)(?:\/([a-z-]+))?$/.exec(path))) return [404, { message: 'Not Found' }];
    const o = this.offers.find((x) => x.offer_id === decodeURIComponent(m![1]!) && x.company === who.company);
    const action = m[2] ?? (method === 'PATCH' ? 'patch' : method === 'GET' ? 'get' : '');
    if (action === 'get') {
      if (!o) return notFound;
      if (!(recruiter || (approver && o.submitted_at))) return notFound;
      if (query['reveal'] === 'salary') {
        if (!(this.canReveal.get(o.offer_id) ?? (recruiter || approver))) return forbidden;
        return [200, this.shape(o, who, true)];
      }
      return [200, this.shape(o, who)];
    }
    if (!o) return notFound;
    const keyFor = memo(`${action} ${o.offer_id}`);
    const seen = keyFor ? this.keyed.get(keyFor) : undefined;
    if (seen) return [seen.status, seen.body];
    const step = (from: State, to: State, extra: Partial<Offer> = {}, note?: string) => {
      o.history.push({ from, to, by_kind: 'person', by_name: who.full, at, ...(note !== undefined ? { note } : {}) });
      Object.assign(o, extra, { state: to, version: o.version + 1 });
    };
    const ok = (): [number, unknown] => remember(keyFor, [200, this.shape(o, who)]);
    const versionOk = () => Number.isInteger(b['version']) && b['version'] === o.version;
    switch (action) {
      case 'patch': {
        if (!recruiter) return forbidden;
        if (o.state !== 'DRAFT' && o.state !== 'APPROVED') return remember(keyFor, conflict('NOT_OPEN'));
        if (!versionOk()) return remember(keyFor, conflict('STALE'));
        const fields = ['salary', 'start_date', 'expiry_date', 'benefits'].filter((f) => b[f] !== undefined);
        if (!fields.length) return remember(keyFor, bad('NO_FIELDS'));
        if (b['salary'] !== undefined && !goodSalary(b['salary'])) return remember(keyFor, bad('INVALID_FIELD', 'salary'));
        if (b['start_date'] !== undefined && !futureDay(b['start_date'])) return remember(keyFor, bad('INVALID_FIELD', 'start_date'));
        if (b['expiry_date'] !== undefined && !futureDay(b['expiry_date'])) return remember(keyFor, bad('INVALID_FIELD', 'expiry_date'));
        if (b['benefits'] !== undefined && !(typeof b['benefits'] === 'string' && b['benefits'].length <= 2000)) return remember(keyFor, bad('INVALID_FIELD', 'benefits'));
        if (((b['expiry_date'] as string) ?? o.expiry_date) > ((b['start_date'] as string) ?? o.start_date)) return remember(keyFor, bad('INVALID_FIELD', 'expiry_date'));
        const was = o.state;
        for (const f of fields) (o as Record<string, unknown>)[f] = b[f];
        delete o.approval;
        o.history.push({ from: was, to: 'DRAFT', by_kind: 'person', by_name: who.full, at, kind: 'EDITED', fields: [...fields].sort() });
        o.state = 'DRAFT'; o.version++;
        return ok();
      }
      case 'submit':
        if (!recruiter) return forbidden;
        if (o.state !== 'DRAFT') return remember(keyFor, conflict('NOT_DRAFT'));
        if (this.noApprover) return remember(keyFor, conflict('NO_APPROVER'));
        step('DRAFT', 'WAITING_APPROVAL', { submitted_at: at });
        return ok();
      case 'approve':
      case 'send-back': {
        if (!approver) return forbidden;
        if (o.drafted_by === who.email) return forbidden;
        if (o.state !== 'WAITING_APPROVAL') return remember(keyFor, conflict('NOT_WAITING'));
        if (!versionOk()) return remember(keyFor, conflict('STALE'));
        if (action === 'approve') { step('WAITING_APPROVAL', 'APPROVED', { approval: { approver_name: who.full, at, mode: 'ONE_APPROVER' } }); return ok(); }
        const note = b['note'];
        if (typeof note !== 'string' || !note.trim() || note.length > 1000) return remember(keyFor, bad('NOTE_REQUIRED'));
        o.approval_history.push({ kind: 'SENT_BACK', by_name: who.full, note, at });
        step('WAITING_APPROVAL', 'DRAFT', {}, note);
        delete o.approval;
        return ok();
      }
      case 'send':
        if (!recruiter) return forbidden;
        if (o.state !== 'APPROVED') return remember(keyFor, conflict('NOT_APPROVED'));
        step('APPROVED', 'SENT', { sent_at: at });
        return ok();
      case 'withdraw': {
        if (!recruiter) return forbidden;
        if (!LIVE.includes(o.state)) return remember(keyFor, conflict('NOT_OPEN'));
        const note = b['note'];
        if (note !== undefined && (typeof note !== 'string' || note.length > 1000)) return remember(keyFor, bad('INVALID_FIELD', 'note'));
        step(o.state, 'WITHDRAWN', o.state === 'SENT' ? { answered_at: at } : {}, note as string | undefined);
        return ok();
      }
      case 'answer': {
        if (!recruiter) return forbidden;
        if (o.state !== 'SENT') return remember(keyFor, conflict('NOT_SENT'));
        const answer = b['answer'];
        if (!['ACCEPTED', 'DECLINED', 'WITHDRAWN'].includes(answer as string)) return remember(keyFor, bad('INVALID_FIELD', 'answer'));
        if (answer === 'ACCEPTED') return remember(keyFor, bad('INVALID_FIELD', 'signed_key'));
        step('SENT', answer as State, { answered_at: at });
        return ok();
      }
      case 'signed-upload':
        if (!recruiter) return forbidden;
        if (o.state !== 'SENT') return conflict('NOT_SENT');
        return [200, { upload_url: `https://offers-upload.invalid/recruitment/${COMPANY_ID[who.company]}/x`, signed_key: 'recruitment/x' }];
      default:
        return [404, { message: 'Not Found' }];
    }
  }
}

export const isRecruiter = (who: Who) => who.groups.includes('hr_staff') && who.groups.includes('perm-recruitment');
export const isApprover = (who: Who) => who.groups.includes('perm-approve-offers');

function subOf(authorization: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(authorization.split('.')[1] ?? '', 'base64url').toString('utf8'));
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- the fixture
type Fx = { offers: OffersFake | null };
export const test = base.extend<Fx>({
  offers: [
    async ({ context, cognito, modules, now }, use) => {
      if (ON_DEV) return use(null);
      const m = modules as ModulesFake;
      const fake = new OffersFake((email) => cognito!.subOf(email), (co) => m.answers[co], now);
      for (const who of Object.values(P)) fake.assign(who);
      await fake.install(context);
      await use(fake);
      expect(fake.contractErrors, 'every offers request matches api/openapi.yaml (REC-14 rule 17)').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

// ---------------------------------------------------------------- page helpers
export const main = (page: Page): Locator => page.locator('main');
/** The state card: the card whose title is "Offer" (kit: article.pp-card, h2.pp-card__title). */
export const stateCard = (page: Page): Locator => main(page).locator('article, .pp-card').filter({ has: page.getByRole('heading', { name: W.card, exact: true }) }).first();
/** The names of the buttons on the state card, but for Show and Hide (those belong to the salary). */
export async function cardActions(page: Page): Promise<string[]> {
  const card = stateCard(page);
  await expect(card).toBeVisible();
  const names = await card.getByRole('button').evaluateAll((els) => els
    .filter((e) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest('[hidden],[inert]'); })
    .map((e) => (e.getAttribute('aria-label') ?? e.textContent ?? '').replace(/\s+/g, ' ').trim()));
  return names.filter((n) => n !== W.show && n !== W.hide).sort();
}
/** Opens one offer and waits for its state card (or the not-found line). */
export async function openOffer(page: Page, id: string): Promise<void> {
  await page.goto(`/hire/offers/${id}`);
  await expect(stateCard(page).or(main(page).getByText(W.notFound, { exact: true }))).toBeVisible();
}
/** Fills a date field the way its kind wants: an `<input type="date">` takes 2026-12-01, a text field "1 Dec 2026". */
export async function fillDate(field: Locator, isoDay: string): Promise<void> {
  const type = await field.getAttribute('type');
  await field.fill(type === 'date' ? isoDay : day(isoDay));
}
/** A field of the draft form by its label. */
export const field = (page: Page, label: string): Locator => stateCard(page).getByLabel(label, { exact: false }).first();
/** The visible text of an element with every run of white space (incl. no-break spaces) made one space. */
export const norm = (s: string) => s.replace(/[\s\u00a0 ]+/g, ' ').trim();
