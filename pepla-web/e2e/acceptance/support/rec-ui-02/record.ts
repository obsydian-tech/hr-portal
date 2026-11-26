import type { BrowserContext, Locator, Page, Route } from '@playwright/test';
import { ON_DEV } from '../fixtures';
import type { ModulesFake } from '../mod-02/modules-fake';
import { STAGES, STAGE_WORDS, WHO, contract, expect, iso, requestProblems, routeOf, test as base, type Call, type Cand, type Co, type HireFake, type Stage, type Who } from '../rec-ui/harness';

/**
 * REC-UI-02 step 3 · The candidate record, first version: header, hiring steps path, Overview (Jira NH-228, lock
 * acceptance-lock/rec-ui-02.3): the words, the fake of `GET /v1/candidates/{id}` and the page helpers of
 * rec-ui-02-record.spec.ts. Spec: onboarding-cards/specs/REC-UI-02-candidate-record.md (R-1 to R-13, AC-R1 to AC-R15), its spec
 * check REC-UI-02-nh228-spec-check.md (rounds 1 and 2, G-1 to G-5, test-writer nits N-1 to N-3), decisions D-RUI-02.13 to .21.
 *
 * The harness (support/rec-ui/harness.ts, locked by rec-ui-01) does not answer `GET /v1/candidates/{id}`. This file adds its own
 * route on the same browser context for that one route; every other Recruitment call (the lists, the options, the stage move and
 * Not hired) stays the harness's, so a Move or a Not hired made on the record changes the same world the record is read from.
 *
 * The answer is built from api/openapi.yaml `CandidateRecord` and `NextStep` (REC-15 step C, PR 521, develop a1e82c1; REC-15
 * rule 31): `recordOf` fills the file's own property list, refuses a field the file does not have, and every answer is checked
 * against the file before it is sent (REC-14 rule 17). A test ends red when `contractErrors` is not empty. The server's rules are
 * those of lambda/shared/recruitment-actions (step C): another company's candidate is 404 (`ownsRow`), a caller without the
 * Recruiter groups or whose company has Recruitment off is 403, `next_step` is codes and numbers only and null on Offer, Hired
 * and Not hired, `can_decide` is also true on Not hired (it means "may reopen", G-4).
 *
 * Every answer also carries (N-1) stale copies of the old fields with other values (`currentStage`, `positionTitle`,
 * `positionLevel`, `slaStatus`, `appliedDate`, `stageEnteredAt`) and marker values in every field R-2 says is never drawn, so a page
 * that reads an old field, or draws a hidden one, fails.
 * Nothing here calls Bedrock or any paid AI.
 */

// ---------------------------------------------------------------- the words (kit text, approved lines, rule 7a picks)
export const RW = {
  candidates: 'Candidates',
  overview: 'Overview',
  nextStep: 'Next step',
  details: 'Candidate details',
  /** W-9d, approved by Iggie 25 Nov 2026 19:42 SAST (specs/interview-journey/WORDING-PROPOSED.md card 5). */
  blockedBody: 'Every required interview must be done first.',
  goToInterviews: 'Go to interviews',
  /** D-RUI-02.15 (7a, existing patterns). */
  notFound: 'This candidate could not be found.',
  failed: 'This candidate could not be loaded.',
  tryAgain: 'Try again',
  notHired: 'Not hired',
  move: 'Move',
  hired: 'Hired',
  detailLabels: ['Email', 'Phone', 'Level', 'Source'] as const,
  /** D-RUI-02.19 (7a, existing pattern). */
  titleLoading: 'Candidate · Naleko People',
  /** REC-UI-01's words: the page's line when a save fails, and the Not hired dialog's "Record not hired". */
  saveFail: 'Your change could not be saved. Try again.',
  recordNotHired: 'Record not hired',
} as const;
export const blockedTitle = (first: string) => `${first} cannot move on yet`;
export const titleOf = (name: string) => `${name} · Naleko People`;
/** D-RUI-02.14: whole days, rounded down; "1 day in stage"; "0 days in stage" under a day. */
export const daysInStage = (n: number) => (n === 1 ? '1 day in stage' : `${n} days in stage`);
export const appliedOn = (day: string) => `Applied ${day}`;
export const hiredOn = (day: string) => `Hired ${day}`;
/** "From to To" with the kit's stage names. */
export const fromTo = (from: Stage, to: Stage) => `${STAGE_WORDS[from as keyof typeof STAGE_WORDS]} to ${STAGE_WORDS[to as keyof typeof STAGE_WORDS]}`;
/** Words no record page may use (AC-R14): "Hidden" is the word, never "Masked"; Not hired, never "Rejected"; no Evaluation stage. */
export const OLD_WORDS = /\b(Masked|Rejected|Evaluation|Provisioning|sentiment)\b/i;

// ---------------------------------------------------------------- what the answer carries that is never drawn (R-2, N-1)
/** One marker per field R-2 says is never drawn: text where the file types a string, a number nobody else uses where it types a number. */
export const NEVER = {
  interviewSentiment: 'MARK-interview-sentiment', engagementSentiment: 'MARK-engagement-sentiment', acceptanceSentiment: 'MARK-acceptance-sentiment',
  evaluationResult: 'MARK-evaluation-result', added_by: 'MARK-added-by', hiringManagerId: 'MARK-hiring-manager-id', employee_id: 'MARK-employee-id',
  decided_by_kind: 'MARK-decided-by-kind',
} as const;
export const NEVER_NUMBERS = { finalScore: 9137, engagementScore: 8246 } as const;
/** `settingVersions` holds whole numbers only (the file says so); each is a number no page shows. */
export const SETTING_VERSIONS = {
  STAGE_CONFIG: 7301, SENIORITY_PROFILES: 7302, INTERVIEW_TYPES: 7303, PANEL_CONFIG: 7304, SCORING_WEIGHTS: 7305, REJECTION_RULES: 7306,
  APPROVAL_RULES: 7307, SLA_THRESHOLDS: 7308, SENTIMENT_SCALE: 7309, EMAIL_TEMPLATES: 7310, INTELLIGENCE_RULES: 7311, RETENTION: 7312,
} as const;
/** N-1: the old fields, with values that differ from the new ones. A page that reads one of them shows a value the test can see. */
export const STALE = { positionTitle: 'Stale position title', appliedDate: '2025-03-03T08:00:00.000Z' } as const;

// ---------------------------------------------------------------- the record, from the file

export type NextStep = { from: Stage; to: Stage; blocker: { code: 'INTERVIEWS_INCOMPLETE'; done: number; total: number } | null } | null;
/** What a test sets on one candidate's record beyond the harness world (a key present with `undefined` is left out of the answer). */
export type RecordExtra = Partial<{
  firstName: string | null; lastName: string | null; email: string | null; phone: string | null; location: string | null; source: string | null;
  applied_at: string | null; role_title: string | null; department: string | null; level: string | null; next_step: NextStep; can_move: boolean; can_decide: boolean;
}>;

const DAY = 86_400_000;
export const DEFAULT_PHONE = '083 555 0198';
export const DEFAULT_LOCATION = 'Durban';

/** The server's `next_step` (REC-15 rule 14): the next stage on the path and what blocks it; null on Offer, Hired and Not hired. */
export function nextStepOf(c: Cand, screening: boolean): NextStep {
  switch (c.stage) {
    case 'APPLIED': return { from: 'APPLIED', to: screening ? 'SCREENING' : 'INTERVIEW', blocker: null };
    case 'SCREENING': return { from: 'SCREENING', to: 'INTERVIEW', blocker: null };
    case 'INTERVIEW': {
      const done = c.interviews_done ?? 0, total = c.interviews_required ?? 0;
      return { from: 'INTERVIEW', to: 'OFFER', blocker: done < total ? { code: 'INTERVIEWS_INCOMPLETE', done, total } : null };
    }
    default: return null;
  }
}

const isRecordPath = (pathname: string): RegExpExecArray | null => {
  const m = /\/v1\/candidates\/([^/]+)$/.exec(pathname);
  return m && m[1] !== 'old-system' ? m : null;
};
export const isRecordCall = (url: URL): boolean => !!isRecordPath(url.pathname);

export type RecordRefusal = { status?: number; body?: unknown; abort?: boolean; once?: boolean; hold?: boolean; id?: string };

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, idempotency-key',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, OPTIONS',
};
const JWT = /^Bearer eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/;

export class RecordFake {
  readonly calls: Call[] = [];
  readonly contractErrors: string[] = [];
  /** Per candidate: what the record says beyond the harness world. */
  readonly extra = new Map<string, RecordExtra>();
  private readonly emails = new Map<string, Who>();
  private readonly refusals: RecordRefusal[] = [];
  private readonly held: Array<() => void> = [];
  private seq = 0;

  constructor(private readonly hire: HireFake, private readonly subOf: (email: string) => string | undefined, private readonly modulesOf: (co: Co) => string[]) {}

  assign(who: Who): void { this.emails.set(who.email.toLowerCase(), who); }
  /** Answers the next record reads (of one id, or any) with this instead; once by default. */
  refuse(r: RecordRefusal): void { this.refusals.push({ once: true, ...r }); }
  lift(): void { this.refusals.length = 0; }
  release(): void { for (const go of this.held.splice(0)) go(); }
  get heldCount(): number { return this.held.length; }
  set(id: string, x: RecordExtra): void { this.extra.set(id, { ...(this.extra.get(id) ?? {}), ...x }); }

  /** Every record read but preflights; `reads(id)` only that candidate's. */
  get requests(): Call[] { return this.calls.filter((c) => c.method !== 'OPTIONS'); }
  reads(id?: string): Call[] { return this.requests.filter((c) => c.method === 'GET' && (!id || c.path.endsWith(`/v1/candidates/${id}`))); }

  async install(context: BrowserContext): Promise<void> {
    await context.route((url) => isRecordCall(url), (route) => this.handle(route));
  }

  /** A candidate's company: its role's, or its own when no role is attached yet (as the harness counts it). */
  companyOf(c: Cand): Co | null { return this.hire.world.roles.find((r) => r.role_id === c.role_id)?.company ?? c.company ?? null; }

  /** The answer of `GET /v1/candidates/{id}` for this candidate, built over the file's own property list. */
  recordOf(c: Cand): Record<string, unknown> {
    const w = this.hire.world;
    const role = w.roles.find((r) => r.role_id === c.role_id);
    const co = this.companyOf(c) ?? 'A';
    const x = this.extra.get(c.id) ?? {};
    const pick = <K extends keyof RecordExtra>(k: K, fallback: RecordExtra[K]): RecordExtra[K] => (k in x ? x[k] : fallback);
    const [first, ...rest] = c.name.split(' ');
    const open = c.stage !== 'HIRED' && c.stage !== 'NOT_HIRED';
    const stageIdx = STAGES.indexOf(c.stage as never);
    const level = pick('level', c.level || null);
    const values: Record<string, unknown> = {
      id: c.id, candidateId: c.id,
      firstName: pick('firstName', first ?? null), lastName: pick('lastName', rest.join(' ') || null),
      email: pick('email', c.email), phone: pick('phone', DEFAULT_PHONE), location: pick('location', DEFAULT_LOCATION),
      stage: c.stage, role_id: c.role_id || null, role_title: pick('role_title', role?.job_title ?? c.role_title ?? null), level,
      applied_at: pick('applied_at', c.applied_at ?? c.stage_entered_at), stage_entered_at: c.stage_entered_at,
      due_at: open ? c.due_at : null, sla_status: open ? c.sla_status : null,
      department_id: role?.department_id ?? null, department: pick('department', role?.department ?? null),
      source: pick('source', c.source ?? null),
      next_step: 'next_step' in x ? x.next_step : nextStepOf(c, w.options[co].screening),
      interviews_done: c.interviews_done ?? null, interviews_required: c.interviews_required ?? null,
      can_move: pick('can_move', open), can_decide: pick('can_decide', c.stage !== 'HIRED'),
      // N-1: stale copies with other values.
      currentStage: STAGES[(stageIdx + 2) % STAGES.length] ?? 'OFFER', positionTitle: STALE.positionTitle,
      positionLevel: level === 'SENIOR' ? 'JUNIOR' : 'SENIOR', slaStatus: c.sla_status === 'OVERDUE' ? 'ON_TRACK' : 'OVERDUE',
      appliedDate: STALE.appliedDate, stageEnteredAt: iso(w.now - 40 * DAY),
      // R-2: never drawn.
      ...NEVER, ...NEVER_NUMBERS, settingVersions: { ...SETTING_VERSIONS },
    };
    const props = (contract().doc.components?.schemas?.['CandidateRecord']?.properties ?? {}) as Record<string, unknown>;
    const unknown = Object.keys(values).filter((k) => !(k in props));
    if (unknown.length) throw new Error(`record fake: api/openapi.yaml CandidateRecord has no ${unknown.join(', ')}`);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(props)) if (values[k] !== undefined) out[k] = values[k];
    return out;
  }

  private who(sub: string | null): Who | null {
    if (!sub) return null;
    for (const [email, who] of this.emails) if (this.subOf(email) === sub) return who;
    return null;
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (request.method() !== 'GET') return route.fallback();
    const authorization = request.headers()['authorization'] ?? null;
    const who = authorization && JWT.test(authorization) ? this.who(subOfBearer(authorization)) : null;
    const raw = `${request.method()} ${url.pathname}${url.search}\n${JSON.stringify(request.headers())}\n${request.postData() ?? ''}`;
    const call: Call = {
      seq: ++this.seq, method: request.method(), path: url.pathname, query: Object.fromEntries(url.searchParams), idempotencyKey: request.headers()['idempotency-key'] ?? null,
      body: null, authorization, email: who?.email ?? null, company: who?.company ?? null, raw, status: 0,
    };
    this.calls.push(call);
    const id = decodeURIComponent(isRecordPath(url.pathname)![1]!);
    const refusal = this.refusals.find((r) => !r.id || r.id === id);
    if (refusal) {
      if (refusal.once) this.refusals.splice(this.refusals.indexOf(refusal), 1);
      if (refusal.hold) await new Promise<void>((go) => this.held.push(go));
      if (refusal.abort) { call.status = -1; return route.abort('internetdisconnected'); }
      if (!refusal.hold || refusal.status) return this.send(route, call, refusal.status ?? 500, refusal.body ?? { error: 'Internal Server Error' }, false);
    }
    if (!authorization || !JWT.test(authorization)) return this.send(route, call, 401, { message: 'Unauthorized' }, false);
    if (!who) return this.send(route, call, 403, { error: 'Forbidden' });
    const wrong = requestProblems(call.method, call.path, call.query);
    if (wrong.length) { this.contractErrors.push(...wrong); return this.send(route, call, 404, { message: 'Not Found' }, false); }
    const recruiter = who.groups.includes('hr_staff') && who.groups.includes('perm-recruitment');
    if (!recruiter || !this.modulesOf(who.company).includes('recruitment')) return this.send(route, call, 403, { error: 'Forbidden' });
    const c = this.hire.world.cands.find((x) => x.id === id);
    // Another company's candidate, or none: the same 404 (ownsRow, TEN-01), never a 403.
    if (!c || this.companyOf(c) !== who.company) return this.send(route, call, 404, { error: 'Not found' });
    return this.send(route, call, 200, this.recordOf(c));
  }

  private send(route: Route, call: Call, status: number, body: unknown, checked = true): Promise<void> {
    call.status = status;
    if (checked) {
      const key = routeOf(call.method, call.path);
      const schema = key ? contract().doc.paths?.['/v1/candidates/{id}']?.get?.responses?.[String(status)]?.content?.['application/json']?.schema : undefined;
      if (!schema) this.contractErrors.push(`GET /v1/candidates/{id} ${status}: api/openapi.yaml describes no such answer`);
      else this.contractErrors.push(...contract().check(schema, body).map((p) => `GET /v1/candidates/{id} ${status}: ${p}`));
    }
    return route.fulfill({ status, headers: { ...CORS, 'cache-control': 'private, no-store', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }
}

function subOfBearer(authorization: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(authorization.split('.')[1] ?? '', 'base64url').toString('utf8'));
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- the fixture
type Fx = { record: RecordFake | null };
export const test = base.extend<Fx>({
  record: [
    async ({ context, cognito, modules, hire }, use) => {
      if (ON_DEV) return use(null);
      const m = modules as ModulesFake;
      const fake = new RecordFake(hire!, (email) => cognito!.subOf(email), (co) => m.answers[co]);
      for (const who of Object.values(WHO)) fake.assign(who);
      // Registered after the harness's route, so this one answers `GET /v1/candidates/{id}` first (Playwright runs the last match first).
      await fake.install(context);
      await use(fake);
      expect(fake.contractErrors, 'every record request and answer matches api/openapi.yaml (REC-14 rule 17, REC-15 rule 31)').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

// ---------------------------------------------------------------- page helpers
export const main = (page: Page): Locator => page.locator('main');
export const norm = (s: string) => s.replace(/[\s  ]+/g, ' ').trim();
/** The app's short date in Johannesburg, with no leading zero ("4 Nov 2026"), as the lists write it. */
export const day = (isoTime: string): string => {
  const d = new Date(Date.parse(isoTime) + 2 * 3_600_000);
  return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

export const personHeader = (page: Page): Locator => main(page).locator('.pp-person-header').first();
export const pathList = (page: Page): Locator => main(page).locator('ol.pp-progress-tracker').first();
/** A card by its title (kit: article.pp-card with h2.pp-card__title). */
export const cardTitled = (page: Page, title: string): Locator =>
  main(page).locator('.pp-card').filter({ has: page.locator('.pp-card__title').getByText(title, { exact: true }) }).first();
export const nextStepCard = (page: Page): Locator => cardTitled(page, RW.nextStep);
export const detailsCard = (page: Page): Locator => cardTitled(page, RW.details);
/** A button of the page (not of a dialog) by its exact name, shown or not. */
export const pageButton = (page: Page, name: string | RegExp): Locator =>
  main(page).getByRole('button', { name, exact: typeof name === 'string' }).or(main(page).getByRole('link', { name, exact: typeof name === 'string' }));

/** Opens a record by its address and waits for the name, or the not-found or failure line. */
export async function openRecord(page: Page, id: string): Promise<void> {
  await page.goto(`/hire/candidates/${id}`);
  await expect(personHeader(page).or(main(page).getByText(RW.notFound, { exact: true })).or(main(page).getByText(RW.failed, { exact: true })).first()).toBeVisible();
}

export type Header = { name: string; initials: string; role: string; facts: string[]; lozenge: { words: string; classes: string[] } | null; lozenges: number };
/** The person header as a person reads it (hidden helper text left out). */
export async function readHeader(page: Page): Promise<Header> {
  await expect(personHeader(page)).toBeVisible();
  return personHeader(page).evaluate((el) => {
    const t = (n: Element | null | undefined) => {
      if (!n) return '';
      const c = n.cloneNode(true) as HTMLElement;
      c.querySelectorAll('.pp-visually-hidden').forEach((x) => x.remove());
      return (c.textContent ?? '').replace(/[\s  ]+/g, ' ').trim();
    };
    const loz = [...el.querySelectorAll('.pp-lozenge')];
    return {
      name: t(el.querySelector('.pp-person-header__name')), initials: t(el.querySelector('.pp-avatar')), role: t(el.querySelector('.pp-person-header__role')),
      facts: [...el.querySelectorAll('.pp-person-header__fact')].map((f) => t(f)),
      lozenge: loz[0] ? { words: t(loz[0]), classes: [...loz[0].classList] } : null, lozenges: loz.length,
    };
  });
}

export type PathStep = { label: string; state: 'done' | 'current' | 'other'; meta: string };
/** The hiring steps path, step by step: the label without its hidden state words, done, current or neither, and its text. */
export async function readPath(page: Page): Promise<PathStep[]> {
  await expect(pathList(page)).toBeVisible();
  return pathList(page).evaluate((ol) => [...ol.querySelectorAll(':scope > li')].map((li) => {
    const t = (n: Element | null) => {
      if (!n) return '';
      const c = n.cloneNode(true) as HTMLElement;
      c.querySelectorAll('.pp-visually-hidden, .pp-progress-tracker__state').forEach((x) => x.remove());
      return (c.textContent ?? '').replace(/[\s  ]+/g, ' ').trim();
    };
    const cls = li.classList;
    const state = cls.contains('pp-progress-tracker__step--current') || li.getAttribute('aria-current') === 'step' ? 'current' : cls.contains('pp-progress-tracker__step--done') ? 'done' : 'other';
    return { label: t(li.querySelector('.pp-progress-tracker__label')), state, meta: t(li.querySelector('.pp-progress-tracker__meta')) };
  })) as Promise<PathStep[]>;
}

/** The dt/dd pairs of the Candidate details card, in order. */
export async function readDetails(page: Page): Promise<Array<[string, string]>> {
  await expect(detailsCard(page)).toBeVisible();
  return detailsCard(page).locator('dl').first().evaluate((dl) => {
    const out: Array<[string, string]> = [];
    let k: string | null = null;
    for (const el of [...dl.querySelectorAll('dt, dd')]) {
      const t = (el.textContent ?? '').replace(/[\s  ]+/g, ' ').trim();
      if (el.tagName === 'DT') k = t;
      else if (k !== null) { out.push([k, t]); k = null; }
    }
    return out;
  });
}

/** The Next step card: its subtitle and its section messages (title and body), or null when there is no card. */
export async function readNextStep(page: Page): Promise<{ subtitle: string; messages: Array<{ title: string; body: string; classes: string[] }>; buttons: string[] } | null> {
  if ((await nextStepCard(page).count()) === 0) return null;
  return nextStepCard(page).evaluate((card) => {
    const t = (n: Element | null) => (n?.textContent ?? '').replace(/[\s  ]+/g, ' ').trim();
    return {
      subtitle: t(card.querySelector('.pp-card__subtitle')),
      messages: [...card.querySelectorAll('.pp-section-message')].map((m) => ({ title: t(m.querySelector('.pp-section-message__title')), body: t(m.querySelector('.pp-section-message__body')), classes: [...m.classList] })),
      buttons: [...card.querySelectorAll('button, a[href]')].map((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').replace(/\s+/g, ' ').trim()),
    };
  });
}

/** The breadcrumb trail: each item's words and link. */
export async function readCrumbs(page: Page): Promise<Array<{ text: string; href: string | null }>> {
  const nav = main(page).locator('nav.pp-breadcrumbs, nav[aria-label="Breadcrumb"]').first();
  await expect(nav).toBeVisible();
  return nav.locator('li').evaluateAll((lis) => lis.map((li) => ({ text: (li.textContent ?? '').replace(/[\s  ]+/g, ' ').trim(), href: li.querySelector('a')?.getAttribute('href') ?? null })));
}

/** The names of the tabs on the page. */
export const tabNames = async (page: Page): Promise<string[]> => (await main(page).getByRole('tab').allInnerTexts()).map(norm);

/** A candidate of company A for one test, put in the harness world (so Move and Not hired act on it too). */
export function addCand(hire: HireFake, c: Partial<Cand> & Pick<Cand, 'id' | 'name' | 'stage'>): Cand {
  const now = hire.world.now;
  const cand: Cand = { role_id: 'role-fleet', level: 'MID', email: `${c.id}@example.org`, stage_entered_at: iso(now - DAY), due_at: iso(now + 4 * DAY), sla_status: 'ON_TRACK', ...c } as Cand;
  hire.world.cands.push(cand);
  return cand;
}
