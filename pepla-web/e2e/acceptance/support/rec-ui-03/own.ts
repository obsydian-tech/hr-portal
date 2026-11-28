import type { BrowserContext, Page, Route } from '@playwright/test';
import { ON_DEV } from '../fixtures';
import { PASSWORD, WHO, contract, test as base, expect, type Co, type Who } from '../rec-ui/harness';
import type { ModulesFake } from '../mod-02/modules-fake';
import { DEFAULT_CRITERIA, type Snapshot } from './capture';

/**
 * REC-UI-03 step 4 · The panel member's own feedback page `/hire/feedback/:interviewId` (Jira NH-292, red; lock
 * acceptance-lock/rec-ui-03.4): the people, the words and the fake of `GET /v1/interviews/{id}` and `POST /v1/interviews/{id}/votes`
 * that rec-ui-03.4-feedback-page.spec.ts uses.
 * Spec: onboarding-cards/specs/REC-UI-03-next-slices.md, "Step 4" (rules 1 to 7, AC-4.1 to AC-4.9) and the dev seed table;
 * decisions D-RUI-03.13, .14, .15, .20. Where the spec is silent, cards/rec-ui-03.4.md says what these tests take (T-P1 up).
 *
 * The fake answers as the merged server does on develop 2e90a21:
 *   GET  (lambda/submitVote/read.mjs): no or a bad sign-in token 401; a caller the fake does not know 403; Recruitment off for the
 *        caller's company 403 `{ error: 'Forbidden' }`; the interview is looked for among the caller's own company's interviews only,
 *        and a caller not on its panel gets the same 404 `{ error: 'Not found' }` as an unknown id or another company's interview.
 *        200 carries exactly id, candidate_first, candidate_last, role_title, type, at, status, criteria (the snapshot when it is a
 *        non-empty list, else the company's default criteria), my_feedback, my_vote (`{ rating, overall }` of the caller's own vote
 *        only, overall the mean of the stored scores for those criteria to one decimal, or null), can, and `why` when can says no:
 *        GIVEN when the caller has a vote (whatever the status), else NOT_STARTED before the start, else CLOSED.
 *   POST (lambda/submitVote/rec07.mjs `vote`): 401 / 403 / Recruitment off as above; another company's or an unknown interview 404;
 *        `on_behalf_of` from a caller who is not a Recruiter 403; without it, a caller not on the panel 403; the body judged against
 *        the same criteria (`scores` exactly those keys, whole numbers 1 to 5, else 400 INVALID_SCORES; `rating` one of the four,
 *        else 400 INVALID_FIELD; `comment` a string of at most 2000, else 400 INVALID_FIELD); COMPLETED 409 ALREADY_DONE; another
 *        status but SCHEDULED 409 NOT_ALLOWED_NOW; before the start 409 NOT_STARTED; a second vote 409 ALREADY_SCORED; 201
 *        `{ vote }`. The last panel person's vote makes the interview COMPLETED, as interview-scoring.mjs `everyoneVoted` does.
 * Every answer the fake makes (and every scripted 200 answer) is checked against api/openapi.yaml. A `refuse()` stands for a
 * gateway or network failure, a hold or a scripted refusal. Nothing here calls Bedrock or any paid AI.
 */

// ---------------------------------------------------------------- the words (kit, parent spec, W-9b, INT-UI-01, D-RUI-03.6, .13, .14)
export const OW = {
  title: (first: string, last: string) => `Interview feedback for ${first} ${last}`,
  /** D-RUI-03.13. */
  notFound: 'This interview could not be found.',
  /** D-RUI-03.6. */
  loadFailed: 'Interview feedback could not be loaded.',
  tryAgain: 'Try again',
  saveFail: 'Your change could not be saved. Try again.',
  /** W-9b (approved 25 Nov). */
  notStarted: 'You can give feedback once the interview has started.',
  /** D-RUI-03.14: the approved guest line, reused. */
  done: 'Thank you. Your feedback is saved with your name and the time.',
  submit: 'Submit feedback',
  cancel: 'Cancel',
  decision: 'Decision',
  notes: 'Notes',
  optional: '(optional)',
} as const;
/** INT-UI-01's rating words (INTERVIEW_WORDS.ratings). */
export const RATING_WORDS: Record<string, string> = { STRONG_YES: 'Strong yes', YES: 'Yes', NO: 'No', STRONG_NO: 'Strong no' };

// ---------------------------------------------------------------- the people

const SUNBIRD = 'sunbird-bakery.co.za';
const who = (email: string, given: string, family: string, groups: string[], company: Co, lands: Who['lands']): Who => ({
  email: `${email}@${SUNBIRD}`, givenName: given, familyName: family, groups, password: PASSWORD, company, lands, full: `${given} ${family}`,
});
/**
 * The panel members of these tests. T-P1: a hiring manager who can sign in today holds `employee` as well as `manager` (ONB-23 refuses
 * an account whose only group is `manager`, so such a person cannot reach any page; REC-UI-01's managerA stays the refused one).
 */
export const P = {
  /** A panel member who is an Employee of company A (John Doe of the other cards). */
  employee: WHO.employeeA,
  /** A hiring manager of company A who is on a panel. */
  manager: who('ayanda.mokoena', 'Ayanda', 'Mokoena', ['employee', 'manager'], 'A', '/start'),
  /** HR of company A without the Recruitment tick (Jane Smith of the other cards), on a panel. */
  hr: WHO.hrNoTickA,
  /** A Recruiter of company A who is on no panel here. */
  recruiter: WHO.recruiterA,
  /** A second Employee of company A, on no panel here. */
  other: who('zanele.khumalo', 'Zanele', 'Khumalo', ['employee'], 'A', '/start'),
  /** An Employee of company B (B has Recruitment on in the tests that need it). */
  employeeB: who('musa.dlamini', 'Musa', 'Dlamini', ['employee'], 'B', '/start'),
} satisfies Record<string, Who>;

// ---------------------------------------------------------------- the fake

/** An interview as the fake server stores it. `panel` holds people's emails; `snapshot` undefined is an interview with none stored. */
export type OwnIv = {
  id: string; company: Co; first: string; last: string; role: string | null; type: string; at: string;
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'DID_NOT_HAPPEN'; snapshot?: Snapshot; panel: string[];
  /** Votes kept, by voter email: the stored scores and rating (as rec07.mjs stores them). */
  votes: Map<string, { scores: Record<string, unknown>; rating: string | null; comment?: string | null }>;
  /** What the store holds that the read must never send. */
  secret?: Record<string, unknown>;
};
export type OwnRefusal = { status?: number; body?: unknown; abort?: boolean; hold?: boolean; once?: boolean; thenAbort?: boolean };
export type OwnCall = {
  seq: number; method: string; path: string; interviewId: string; idempotencyKey: string | null; body: unknown; authorization: string | null;
  email: string | null; status: number; raw: string;
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, idempotency-key',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, OPTIONS',
};
const JWT = /^Bearer eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/;
const OWN_PATH = /\/v1\/interviews\/([^/]+)(\/votes)?$/;
const RATINGS = ['STRONG_NO', 'NO', 'YES', 'STRONG_YES'];
const oneDecimal = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export class OwnFake {
  readonly calls: OwnCall[] = [];
  readonly contractErrors: string[] = [];
  readonly ivs = new Map<string, OwnIv>();
  private readonly people = new Map<string, Who>();
  private readonly refusals: Record<'GET' | 'POST', OwnRefusal[]> = { GET: [], POST: [] };
  private readonly scripted: unknown[] = [];
  private readonly held: Array<() => void> = [];
  private seq = 0;

  constructor(private readonly subOf: (email: string) => string | undefined, private readonly modulesOf: (co: Co) => string[], readonly now: number) {}

  assign(w: Who): void { this.people.set(w.email.toLowerCase(), w); }
  put(x: Omit<OwnIv, 'votes'> & { votes?: OwnIv['votes'] }): OwnIv {
    const iv: OwnIv = { ...x, panel: x.panel.map((e) => e.toLowerCase()), votes: x.votes ?? new Map() };
    this.ivs.set(iv.id, iv);
    return iv;
  }
  /** The next GET (or POST) gets this refusal instead of the server's answer. */
  refuse(method: 'GET' | 'POST', r: OwnRefusal): void { this.refusals[method].push({ once: true, ...r }); }
  /** The next GET that the server would answer 200 answers 200 with this body instead (a stored row the tests cannot make otherwise). */
  answerNext(body: unknown): void { this.scripted.push(body); }
  release(): void { for (const go of this.held.splice(0)) go(); }
  get heldCount(): number { return this.held.length; }
  get gets(): OwnCall[] { return this.calls.filter((c) => c.method === 'GET'); }
  get posts(): OwnCall[] { return this.calls.filter((c) => c.method === 'POST'); }

  async install(context: BrowserContext): Promise<void> {
    await context.route((url) => OWN_PATH.test(url.pathname), (route) => this.handle(route));
  }

  private caller(authorization: string | null): Who | null {
    if (!authorization || !JWT.test(authorization)) return null;
    let sub: string | null = null;
    try { sub = JSON.parse(Buffer.from(authorization.split('.')[1] ?? '', 'base64url').toString('utf8')).sub ?? null; } catch { sub = null; }
    if (!sub) return null;
    for (const [email, w] of this.people) if (this.subOf(email) === sub) return w;
    return null;
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(request.url());
    const m = OWN_PATH.exec(url.pathname)!;
    const method = request.method();
    let body: unknown = null;
    try { body = request.postData() ? JSON.parse(request.postData()!) : null; } catch { body = request.postData(); }
    const authorization = request.headers()['authorization'] ?? null;
    const w = this.caller(authorization);
    const call: OwnCall = {
      seq: ++this.seq, method, path: url.pathname + url.search, interviewId: decodeURIComponent(m[1]!), idempotencyKey: request.headers()['idempotency-key'] ?? null,
      body, authorization, email: w?.email ?? null, status: 0, raw: `${method} ${url.pathname}${url.search}\n${JSON.stringify(request.headers())}\n${request.postData() ?? ''}`,
    };
    this.calls.push(call);
    const votes = !!m[2];
    if ((votes && method !== 'POST') || (!votes && method !== 'GET')) return this.send(route, call, 404, { message: 'Not Found' }, false);
    const list = this.refusals[method as 'GET' | 'POST'];
    const refusal = list.shift();
    if (refusal && !refusal.once) list.unshift(refusal);
    if (refusal?.hold) await new Promise<void>((go) => this.held.push(go));
    if (refusal?.abort) { call.status = -1; return route.abort('internetdisconnected').catch(() => undefined); }
    if (refusal?.status) return this.send(route, call, refusal.status, refusal.body ?? { error: 'Internal error' }, ![500, 502, 503, 504, 429].includes(refusal.status));
    const [status, answer] = votes ? this.vote(call, w) : this.read(call, w);
    if (refusal?.thenAbort) { call.status = status; return route.abort('internetdisconnected').catch(() => undefined); }
    // A scripted read stands for a stored row the file does not describe yet (an old vote with no rating: read.mjs sends
    // `rating: null`, which api/openapi.yaml does not allow, NH-292 review note), so it is not checked against the file.
    if (!votes && status === 200 && this.scripted.length) return this.send(route, call, 200, this.scripted.shift(), false);
    return this.send(route, call, status, answer);
  }

  private find(id: string, co: Co): OwnIv | null {
    const x = this.ivs.get(id);
    return x && x.company === co ? x : null;
  }
  private criteriaOf(x: OwnIv): Snapshot { return Array.isArray(x.snapshot) && x.snapshot.length ? x.snapshot : DEFAULT_CRITERIA; }
  private refusalOf(x: OwnIv): string | null {
    if (x.status === 'COMPLETED') return 'ALREADY_DONE';
    if (x.status !== 'SCHEDULED') return 'NOT_ALLOWED_NOW';
    if (this.now < Date.parse(x.at)) return 'NOT_STARTED';
    return null;
  }
  private gate(call: OwnCall, w: Who | null): [number, unknown] | null {
    if (!call.authorization || !JWT.test(call.authorization)) return [401, { message: 'Unauthorized' }];
    if (!w) return [403, { error: 'Forbidden' }];
    if (!this.modulesOf(w.company).includes('recruitment')) return [403, { error: 'Forbidden' }];
    return null;
  }

  private read(call: OwnCall, w: Who | null): [number, unknown] {
    const g = this.gate(call, w);
    if (g) return g;
    const x = this.find(call.interviewId, w!.company);
    const me = w!.email.toLowerCase();
    if (!x || !x.panel.includes(me)) return [404, { error: 'Not found' }];
    const criteria = this.criteriaOf(x).map((c) => ({ key: c.key, label: c.label }));
    const mine = x.votes.get(me);
    const myVote = mine ? { rating: mine.rating ?? null, overall: oneDecimal(mean(criteria.map((c) => mine.scores[c.key]).filter((n): n is number => typeof n === 'number' && Number.isFinite(n)))) } : null;
    const refusal = this.refusalOf(x);
    const can = { capture_feedback: !mine && !refusal };
    const out: Record<string, unknown> = {
      id: x.id, candidate_first: x.first, candidate_last: x.last, role_title: x.role, type: x.type, at: x.at, status: x.status, criteria,
      my_feedback: mine ? 'GIVEN' : 'WAITING', my_vote: myVote, can,
    };
    if (!can.capture_feedback) out['why'] = mine ? 'GIVEN' : refusal === 'NOT_STARTED' ? 'NOT_STARTED' : 'CLOSED';
    return [200, out];
  }

  private vote(call: OwnCall, w: Who | null): [number, unknown] {
    const g = this.gate(call, w);
    if (g) return g;
    const x = this.find(call.interviewId, w!.company);
    if (!x) return [404, { error: 'Not found' }];
    const me = w!.email.toLowerCase();
    const b = call.body && typeof call.body === 'object' && !Array.isArray(call.body) ? (call.body as Record<string, unknown>) : null;
    if (b && b['on_behalf_of'] !== undefined) {
      const recruiter = w!.groups.includes('hr_staff') && w!.groups.includes('perm-recruitment');
      if (!recruiter) return [403, { error: 'Forbidden' }];
      return [400, { error: 'Bad request', code: 'INVALID_FIELD', field: 'on_behalf_of' }];
    }
    if (!x.panel.includes(me)) return [403, { error: 'Forbidden' }];
    if (!b) return [400, { error: 'Bad request', code: 'INVALID_SCORES' }];
    const keys = this.criteriaOf(x).map((c) => c.key);
    const s = b['scores'];
    if (!s || typeof s !== 'object' || Array.isArray(s)) return [400, { error: 'Bad request', code: 'INVALID_SCORES' }];
    const sc = s as Record<string, unknown>;
    const got = Object.keys(sc);
    if (got.length !== keys.length || !keys.every((k) => got.includes(k))) return [400, { error: 'Bad request', code: 'INVALID_SCORES' }];
    if (!keys.every((k) => Number.isInteger(sc[k]) && (sc[k] as number) >= 1 && (sc[k] as number) <= 5)) return [400, { error: 'Bad request', code: 'INVALID_SCORES' }];
    if (!RATINGS.includes(b['rating'] as string)) return [400, { error: 'Bad request', code: 'INVALID_FIELD', field: 'rating' }];
    if (b['comment'] !== undefined && (typeof b['comment'] !== 'string' || (b['comment'] as string).length > 2000)) return [400, { error: 'Bad request', code: 'INVALID_FIELD', field: 'comment' }];
    const r = this.refusalOf(x);
    if (r) return [409, { error: 'Conflict', code: r }];
    if (x.votes.has(me)) return [409, { error: 'Conflict', code: 'ALREADY_SCORED' }];
    x.votes.set(me, { scores: { ...sc }, rating: b['rating'] as string, comment: (b['comment'] as string | undefined) ?? null });
    if (x.panel.every((p) => x.votes.has(p))) x.status = 'COMPLETED';
    const at = new Date(this.now).toISOString();
    return [201, { vote: { interview_id: x.id, voter_id: this.subOf(me) ?? me, scores: sc, rating: b['rating'], comment: b['comment'] ?? null, on_behalf: false, submitted_at: at } }];
  }

  private send(route: Route, call: OwnCall, status: number, body: unknown, checked = true): Promise<void> {
    call.status = status;
    if (checked && status !== 401) {
      const path = call.method === 'GET' ? '/v1/interviews/{id}' : '/v1/interviews/{id}/votes';
      const op = call.method.toLowerCase() as 'get' | 'post';
      const schema = contract().doc.paths?.[path]?.[op]?.responses?.[String(status)]?.content?.['application/json']?.schema;
      if (!schema) this.contractErrors.push(`${call.method} ${path} ${status}: api/openapi.yaml describes no such answer`);
      else this.contractErrors.push(...contract().check(schema, body).map((x) => `${call.method} ${path} ${status}: ${x}`));
    }
    return route.fulfill({ status, headers: { ...CORS, 'cache-control': 'private, no-store', 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------- every request the page makes

export type Seen = { method: string; url: string; resourceType: string };
/** Every request of the page, from the moment `track` is called. */
export class Requests {
  readonly all: Seen[] = [];
  readonly pageErrors: string[] = [];
  track(page: Page): void {
    page.on('request', (r) => this.all.push({ method: r.method(), url: r.url(), resourceType: r.resourceType() }));
    page.on('pageerror', (e) => this.pageErrors.push(`${e.name}: ${e.message}`));
  }
  /** A mark to count from. */
  get mark(): number { return this.all.length; }
  /**
   * The calls to any API since `from`: everything but the app's own files, Google Fonts, Cognito sign-in traffic, data: and blob:
   * addresses and CORS preflights. Each as "METHOD path".
   */
  apiSince(from: number, appOrigin: string): string[] {
    return this.all.slice(from).filter((r) => {
      if (!/^https?:/.test(r.url) || r.method === 'OPTIONS') return false;
      const u = new URL(r.url);
      if (u.origin === appOrigin) return false;
      if (/fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)) return false;
      if (/^cognito-(idp|identity)\.[a-z0-9-]+\.amazonaws\.com$/.test(u.hostname)) return false;
      return true;
    }).map((r) => `${r.method} ${new URL(r.url).pathname}`);
  }
}

// ---------------------------------------------------------------- the fixture

type Fx = { own: OwnFake | null; requests: Requests; appOrigin: string };
export const test = base.extend<Fx>({
  appOrigin: async ({ baseURL }, use) => { await use(new URL(baseURL!).origin); },
  own: [
    async ({ context, cognito, modules, now }, use) => {
      if (ON_DEV) return use(null);
      const m = modules as ModulesFake;
      const fake = new OwnFake((email) => cognito!.subOf(email), (co) => m.answers[co], now);
      for (const w of [...Object.values(WHO), ...Object.values(P)]) fake.assign(w);
      await fake.install(context);
      await use(fake);
      expect(fake.contractErrors, 'every interview read and vote request and answer matches api/openapi.yaml').toEqual([]);
    },
    { auto: true },
  ],
  requests: [
    async ({ page }, use) => {
      const r = new Requests();
      r.track(page);
      await use(r);
      expect(r.pageErrors, 'no uncaught error in the page').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };
