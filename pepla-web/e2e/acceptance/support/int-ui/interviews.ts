import type { BrowserContext, Locator, Page, Route } from '@playwright/test';
import { ON_DEV } from '../fixtures';
import type { ModulesFake } from '../mod-02/modules-fake';
import { WHO, contract, expect, requestProblems, type Call, type Cand, type Co, type HireFake, type Who } from '../rec-ui/harness';
import { main, type RecordFake } from '../rec-ui-02/record';
import { NW, sastDay, tab, test as base } from '../rec-ui-02/notes';

/**
 * INT-UI-01 · The Interviews tab on the candidate record (Jira NH-270, epic NH-223, amber; lock acceptance-lock/int-ui-01 on
 * acceptance-lock/rec-ui-02.4): the words, the fake of `GET /v1/candidates/{id}/interviews` and the page helpers of int-ui-01.spec.ts.
 * Spec: specs/interview-journey/cards/INT-UI-01.md, section "Changes after spec check round 1 (26 Nov)" (it wins over the text
 * above it): M-1 to M-7, S-1 to S-7, final AC-1 to AC-10, decisions INT-UI-01-D1 to D12. Its check: INT-UI-01-spec-check.md (round 2:
 * C-1, C-2 for the dev seed; notes N-1 to N-3). Where the spec is silent, cards/int-ui-01.md says what these tests take (T-I1 up).
 *
 * Neither the harness nor the record or history fakes answer the interviews read. This file adds its own route on the same browser
 * context for that one route. The answer is built over api/openapi.yaml `InterviewList` and `PanelEntry` (INT-01, develop 7630b3c):
 * `interviewOf` and `entryOf` fill the file's own property lists and refuse a field the file does not have, and every answer is
 * checked against the file before it is sent. A test ends red when `contractErrors` is not empty.
 *
 * The fake answers as lambda/scheduleInterview/index.js (GET) does at 7630b3c, for a Recruiter:
 *   - no or a bad sign-in token is 401; a caller whose company has Recruitment off is 403 `{ error: 'Forbidden' }`;
 *   - another company's candidate, or none, is 404 `{ error: 'Not found' }` (`ownsRow`), before any interview is read; a caller who
 *     is not a Recruiter (and so, here, neither the hiring manager nor on a panel) is 404 too (`relationOf`);
 *   - the interviews come in the order the test gives them (the server sorts them oldest first by start time);
 *   - a failed read is 500 `{ error: 'Failed to fetch interviews' }`.
 * Every interview also carries what the tab never draws (S-4, S-2, M-2): the raw `votes[]` with a comment and a rating of its own,
 * `closed_by_name`, `closed_at`, and stale copies of the old kept fields (`interviewType`, `scheduledAt`, `adhocPanelMembers`), so a
 * page that draws them, or reads an old field, fails.
 * Nothing here calls Bedrock or any paid AI.
 */

// ---------------------------------------------------------------- the words (all approved; "Words used in this card")
export const IW = {
  tab: 'Interviews',
  overview: NW.overview,
  notes: NW.notes,
  done: 'Done',
  cancelled: 'Cancelled',
  didNotHappen: 'Did not happen',
  noFeedback: 'No feedback',
  guest: 'Guest',
  noteLabel: 'Note for the candidate',
  inPerson: 'In person',
  online: 'Online',
  /** D10 (rule 7a), the REC-UI-02 pattern D-RUI-02.15. */
  failed: 'Interviews could not be loaded.',
  tryAgain: 'Try again',
  /** D11 (rule 7a). */
  empty: 'No interviews yet.',
  notFound: NW.notFound,
} as const;
/** S-1. */
export const countLine = (done: number, total: number) => `${done} of ${total} required interviews done`;
/** S-5. */
export const waitingOn = (n: number) => `Waiting on ${n} feedback`;
/** R-4 and S-3: "Captured by {name} for {first name}". */
export const capturedBy = (by: string, name: string) => `Captured by ${by} for ${name.split(' ')[0]}`;

/** M-3: the five known keys; any other key in sentence case. */
export const TYPE_WORDS: Record<string, string> = { PHONE_SCREEN: 'Phone screen', TECHNICAL: 'Technical', BEHAVIORAL: 'Behavioral', CULTURE_FIT: 'Culture fit', FINAL: 'Final' };
export const typeWords = (key: string | null | undefined): string | null => {
  if (typeof key !== 'string' || key.trim() === '') return null;
  if (TYPE_WORDS[key]) return TYPE_WORDS[key]!;
  const s = key.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** S-2: the closed reason words, looked up with the status. */
export const REASON_WORDS: Record<string, Record<string, string>> = {
  CANCELLED: { CANDIDATE_ASKED: 'Candidate asked', PANEL_NOT_AVAILABLE: 'Panel not available', CANDIDATE_WITHDREW: 'Candidate withdrew', OTHER: 'Other' },
  DID_NOT_HAPPEN: { CANDIDATE_DID_NOT_COME: 'Candidate did not come', INTERVIEWER_DID_NOT_COME: 'Interviewer did not come', OTHER: 'Other' },
  COMPLETED: { FEEDBACK_GIVEN_ANOTHER_WAY: 'Feedback was given another way', PANEL_MEMBER_CANNOT_GIVE_FEEDBACK: 'Someone on the panel cannot give feedback', OTHER: 'Other' },
};
export const ALL_REASON_WORDS = [...new Set(Object.values(REASON_WORDS).flatMap((m) => Object.values(m)))];

/** S-3. */
export const RATING_WORDS: Record<string, string> = { STRONG_YES: 'Strong yes', YES: 'Yes', NO: 'No', STRONG_NO: 'Strong no' };
/** S-3: "{rating words} · {overall} out of 5"; the rating only when overall is null; "{overall} out of 5" when the rating is missing. */
export function feedbackWords(rating: string | null | undefined, overall: number | null | undefined): string | null {
  const r = rating ? RATING_WORDS[rating] ?? null : null;
  const o = typeof overall === 'number' ? `${overall} out of 5` : null;
  if (r && o) return `${r} · ${o}`;
  return r ?? o;
}

/** The action words of M-4 that no card has built yet: none of them may show as a control. INT-UI-02 builds "Schedule an interview" and
 *  "Reschedule", so they left this list in child lock int-ui-01.1 (cards/int-ui-02.md, T-S10). */
export const ACTION_WORDS = ['Capture feedback', 'Cancel interview', 'Did not happen', 'Mark as done', 'Add panel member'] as const;

// ---------------------------------------------------------------- time (S-5, SAST)
const SAST = 2 * 3_600_000;
const DAY = 86_400_000;
/** "10:00", 24-hour, South African time. */
export const sastTime = (at: string): string => {
  const d = new Date(Date.parse(at) + SAST);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};
export { sastDay };
const sastMidnight = (ms: number) => { const d = new Date(ms + SAST); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
/** S-5 and D8: counted as `stageTime` counts (calendar days in Johannesburg); 0 days "Overdue", 1 "Overdue by 1 day". */
export const overdueWords = (dueAt: string, now: number): string => {
  const n = Math.round((sastMidnight(now) - sastMidnight(Date.parse(dueAt))) / DAY);
  return n >= 1 ? `Overdue by ${n} day${n === 1 ? '' : 's'}` : 'Overdue';
};

// ---------------------------------------------------------------- what an interview carries that is never drawn
export const NEVER = {
  comment: 'MARK-raw-vote-comment', voterId: 'MARK-voter-id', closedBy: 'Marked Closedby-Name', personId: 'MARK-person-id',
  staleType: 'STALE_OLD_TYPE', staleTypeWords: 'Stale old type', adhocName: 'Marked Adhoc-Guest', adhocEmail: 'mark.adhoc@example.org', adhocRole: 'MARK-adhoc-role',
  criteria: 'MARK criteria label',
} as const;
/** A day no interview in these tests is on: `closed_at` and the stale `scheduledAt` use it, and it must never show. */
export const NEVER_DAY_AT = '2025-03-03T08:00:00.000Z';
export const NEVER_DAY = '3 Mar 2025';

// ---------------------------------------------------------------- the interviews

export type Can = { reschedule: boolean; cancel: boolean; did_not_happen: boolean; mark_done: boolean; capture_feedback: boolean };
export const CAN_KEYS = ['reschedule', 'cancel', 'did_not_happen', 'mark_done', 'capture_feedback'] as const;
export const canOf = (on: Partial<Can> | 'all' | 'none' = 'none'): Can => {
  const all = on === 'all';
  const base: Can = { reschedule: all, cancel: all, did_not_happen: all, mark_done: all, capture_feedback: all };
  return typeof on === 'object' ? { ...base, ...on } : base;
};

/** One panel line as a test writes it; `entryOf` fills the rest from the file. A key set to `undefined` is left out of the answer. */
export type Entry = {
  kind: 'PERSON' | 'GUEST'; name: string | null; feedback: 'GIVEN' | 'WAITING'; due_at: string | null;
  vote?: { rating: string | null; overall: number | null; on_behalf_by_name: string | null }; no_feedback?: boolean; email?: string | null; person_id?: string;
};
export const person = (name: string | null, feedback: 'GIVEN' | 'WAITING', extra: Partial<Entry> = {}): Entry => ({ kind: 'PERSON', name, feedback, due_at: null, ...extra });
export const guest = (name: string | null, feedback: 'GIVEN' | 'WAITING', extra: Partial<Entry> = {}): Entry => ({ kind: 'GUEST', name, feedback, due_at: null, ...extra });
export const voted = (name: string, rating: string | null, overall: number | null, on_behalf_by_name: string | null = null, extra: Partial<Entry> = {}): Entry =>
  person(name, 'GIVEN', { vote: { rating, overall, on_behalf_by_name }, ...extra });

export type Status = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'DID_NOT_HAPPEN' | null;
/** One interview as a test writes it (the new fields of INT-01); `interviewOf` fills the rest. A key set to `undefined` is left out. */
export type Iv = {
  id: string; type: string | null; at: string | null; status: Status; length_minutes: number | null; where: 'IN_PERSON' | 'ONLINE' | null;
  place: string | null; video_link: string | null; sequence: number | null; closed_reason: string | null; closed_note?: string | null;
  candidate_note?: string | null; can: Can; panel: Entry[]; votes?: Array<Record<string, unknown>>;
};
export const DEFAULT_PLACE = 'Durban depot, 14 Quay Road';
/** An interview with the kit's defaults: Technical, 60 minutes, in person at the Durban depot, nothing closed, every `can` false. */
export const iv = (id: string, at: string | null, status: Status, extra: Partial<Iv> = {}): Iv => ({
  id, type: 'TECHNICAL', at, status, length_minutes: 60, where: 'IN_PERSON', place: DEFAULT_PLACE, video_link: null, sequence: 1,
  closed_reason: null, can: canOf('none'), panel: [], ...extra,
});

/** What the read says about the required interviews: null before the Interview stage (S-1). */
export type Required = { done: number; total: number } | null;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, idempotency-key',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, OPTIONS',
};
const JWT = /^Bearer eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/;
const isListPath = (pathname: string): RegExpExecArray | null => /\/v1\/candidates\/([^/]+)\/interviews$/.exec(pathname);

export type InterviewsRefusal = { status?: number; body?: unknown; abort?: boolean; hold?: boolean; once?: boolean; id?: string };

type Props = Record<string, unknown>;
const schemaProps = (): { item: Props; entry: Props } => {
  const s = contract().doc.components?.schemas as Record<string, { properties?: Props }> | undefined;
  const list = s?.['InterviewList'] as { properties?: { interviews?: { items?: { properties?: Props } } } } | undefined;
  return { item: list?.properties?.interviews?.items?.properties ?? {}, entry: s?.['PanelEntry']?.properties ?? {} };
};

export class InterviewsFake {
  readonly calls: Call[] = [];
  /** The full address of every interviews request, in order (AC-8 replays one with another candidate's id). */
  readonly urls: string[] = [];
  readonly contractErrors: string[] = [];
  private readonly lists = new Map<string, { interviews: Iv[]; required: Required }>();
  private readonly emails = new Map<string, Who>();
  private readonly refusals: InterviewsRefusal[] = [];
  private readonly held: Array<() => void> = [];
  private seq = 0;

  constructor(private readonly hire: HireFake, private readonly record: RecordFake, private readonly subOf: (email: string) => string | undefined, private readonly modulesOf: (co: Co) => string[]) {}

  assign(who: Who): void { this.emails.set(who.email.toLowerCase(), who); }
  /** One candidate's interviews, in the order the server would send them (oldest first), and its `required`. */
  set(id: string, interviews: Iv[], required: Required = null): void { this.lists.set(id, { interviews, required }); }
  refuse(r: InterviewsRefusal): void { this.refusals.push({ once: true, ...r }); }
  lift(): void { this.refusals.length = 0; }
  release(): void { for (const go of this.held.splice(0)) go(); }
  get heldCount(): number { return this.held.length; }

  get requests(): Call[] { return this.calls.filter((c) => c.method !== 'OPTIONS'); }
  reads(id?: string): Call[] { return this.requests.filter((c) => c.method === 'GET' && (!id || c.path.endsWith(`/v1/candidates/${id}/interviews`))); }

  async install(context: BrowserContext): Promise<void> {
    await context.route((url) => !!isListPath(url.pathname), (route) => this.handle(route));
  }

  /** One panel line of the answer, built over the file's `PanelEntry` property list. */
  entryOf(e: Entry, n: number): Record<string, unknown> {
    const values: Record<string, unknown> = { ...e };
    if (e.kind === 'PERSON' && values['person_id'] === undefined) values['person_id'] = `${NEVER.personId}-${n}`;
    const props = schemaProps().entry;
    const unknown = Object.keys(values).filter((k) => !(k in props));
    if (unknown.length) throw new Error(`interviews fake: api/openapi.yaml PanelEntry has no ${unknown.join(', ')}`);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(props)) if (values[k] !== undefined) out[k] = values[k];
    return out;
  }

  /** One interview of the answer, built over the file's `InterviewList` item property list. */
  interviewOf(candidateId: string, x: Iv, n: number): Record<string, unknown> {
    const values: Record<string, unknown> = {
      ...x,
      closed_by_name: x.status === 'CANCELLED' || x.status === 'DID_NOT_HAPPEN' || x.closed_reason ? NEVER.closedBy : null,
      closed_at: x.status === 'CANCELLED' || x.status === 'DID_NOT_HAPPEN' || x.closed_reason ? NEVER_DAY_AT : null,
      panel: x.panel.map((e, i) => this.entryOf(e, n * 100 + i)),
      votes: x.votes ?? [{
        voterId: NEVER.voterId, rating: 'STRONG_NO', weightedScore: 1.1, interviewId: x.id, submittedAt: NEVER_DAY_AT, submittedByTA: false,
        scores: { technical: 1 }, comment: NEVER.comment,
      }],
      // The old kept fields (N-1 of the record lock): stale copies a page must never read.
      interviewId: x.id, candidateId, interviewType: NEVER.staleType, scheduledAt: NEVER_DAY_AT,
      adhocPanelMembers: [{ name: NEVER.adhocName, email: NEVER.adhocEmail, role: NEVER.adhocRole }],
      criteria_snapshot: [{ key: 'technical', label: NEVER.criteria }],
    };
    const props = schemaProps().item;
    const unknown = Object.keys(values).filter((k) => !(k in props));
    if (unknown.length) throw new Error(`interviews fake: api/openapi.yaml InterviewList has no ${unknown.join(', ')}`);
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
    const raw = `${request.method()} ${url.pathname}${url.search}\n${JSON.stringify(request.headers())}\n`;
    const call: Call = {
      seq: ++this.seq, method: request.method(), path: url.pathname, query: Object.fromEntries(url.searchParams), idempotencyKey: request.headers()['idempotency-key'] ?? null,
      body: null, authorization, email: who?.email ?? null, company: who?.company ?? null, raw, status: 0,
    };
    this.calls.push(call);
    this.urls.push(request.url());
    const id = decodeURIComponent(isListPath(url.pathname)![1]!);
    const refusal = this.refusals.find((r) => !r.id || r.id === id);
    if (refusal) {
      if (refusal.once) this.refusals.splice(this.refusals.indexOf(refusal), 1);
      if (refusal.hold) await new Promise<void>((go) => this.held.push(go));
      if (refusal.abort) { call.status = -1; return route.abort('internetdisconnected'); }
      if (!refusal.hold || refusal.status) return this.send(route, call, refusal.status ?? 500, refusal.body ?? { error: 'Failed to fetch interviews' });
    }
    if (!authorization || !JWT.test(authorization)) return this.send(route, call, 401, { message: 'Unauthorized' }, false);
    if (!who) return this.send(route, call, 403, { error: 'Forbidden' });
    const wrong = requestProblems(call.method, call.path, call.query);
    if (wrong.length) { this.contractErrors.push(...wrong); return this.send(route, call, 404, { message: 'Not Found' }, false); }
    if (!this.modulesOf(who.company).includes('recruitment')) return this.send(route, call, 403, { error: 'Forbidden' });
    const c: Cand | undefined = this.hire.world.cands.find((x) => x.id === id);
    // Another company's candidate, or none: 404 (ownsRow), before any interview is read.
    if (!c || this.record.companyOf(c) !== who.company) return this.send(route, call, 404, { error: 'Not found' });
    const recruiter = who.groups.includes('hr_staff') && who.groups.includes('perm-recruitment');
    if (!recruiter) return this.send(route, call, 404, { error: 'Not found' });
    const l = this.lists.get(id) ?? { interviews: [], required: null };
    return this.send(route, call, 200, { interviews: l.interviews.map((x, i) => this.interviewOf(id, x, i)), required: l.required });
  }

  private send(route: Route, call: Call, status: number, body: unknown, checked = true): Promise<void> {
    call.status = status;
    if (checked) {
      const schema = contract().doc.paths?.['/v1/candidates/{id}/interviews']?.get?.responses?.[String(status)]?.content?.['application/json']?.schema;
      if (!schema) this.contractErrors.push(`GET /v1/candidates/{id}/interviews ${status}: api/openapi.yaml describes no such answer`);
      else this.contractErrors.push(...contract().check(schema, body).map((p) => `GET /v1/candidates/{id}/interviews ${status}: ${p}`));
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
type Fx = { interviews: InterviewsFake | null };
export const test = base.extend<Fx>({
  interviews: [
    async ({ context, cognito, modules, hire, record }, use) => {
      if (ON_DEV) return use(null);
      const m = modules as ModulesFake;
      const fake = new InterviewsFake(hire!, record!, (email) => cognito!.subOf(email), (co) => m.answers[co]);
      for (const who of Object.values(WHO)) fake.assign(who);
      // Registered after the harness, the record fake and the history fake, so this one answers the interviews read first.
      await fake.install(context);
      await use(fake);
      expect(fake.contractErrors, 'every interviews request and answer matches api/openapi.yaml (REC-15 rule 31)').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect, main, tab };

// ---------------------------------------------------------------- page helpers

/** Chooses the Interviews tab. */
export async function chooseInterviews(page: Page): Promise<void> {
  await tab(page, IW.tab).click();
  await expect(tab(page, IW.tab)).toHaveAttribute('aria-selected', 'true');
}
/** T-I1: the region the Interviews tab labels (as Notes, T-N1): an element in `main` whose `aria-labelledby` holds the tab's `id`. */
export async function interviewsRegion(page: Page): Promise<Locator> {
  const id = await tab(page, IW.tab).getAttribute('id');
  expect(id, 'the Interviews tab has an id a region can point at').toBeTruthy();
  return main(page).locator(`[aria-labelledby~="${id}"]`);
}
/** T-I2: the list of interviews is the kit's list labelled "Interviews"; each of its items is one interview. */
export const LIST = 'ul[aria-label="Interviews"], ol[aria-label="Interviews"]';
export const rowsOf = (page: Page): Locator => main(page).locator(`:is(${LIST}) > li`);
/** T-I3: the chosen interview is the one `.pp-card` in the tab that is neither inside the list nor holds it. */
export const CHOSEN = `.pp-card:not(:is(${LIST}) *):not(:has(:is(${LIST}))):not(:has(.pp-empty-state))`;
export const chosenOf = (page: Page): Locator => main(page).locator(CHOSEN);

/** The tab has drawn: rows, the empty line or the failure line. */
export async function interviewsDrawn(page: Page): Promise<void> {
  await expect(rowsOf(page).first().or(main(page).getByText(IW.empty, { exact: true })).or(main(page).getByText(IW.failed, { exact: true })).first()).toBeVisible();
}

export type RowRead = { text: string; avatars: number; selected: boolean };
/** Each row as a person reads it (decorative and visually hidden parts dropped), how many people its avatars stand for, and whether it is the chosen one. */
export async function readRows(page: Page): Promise<RowRead[]> {
  return rowsOf(page).evaluateAll((lis) => lis.map((li) => {
    const c = li.cloneNode(true) as HTMLElement;
    const shown = c.querySelectorAll('.pp-avatar:not(.pp-avatar-group__more)').length;
    const more = Number((c.querySelector('.pp-avatar-group__more')?.textContent ?? '').replace(/[^0-9]/g, '') || '0');
    c.querySelectorAll('[aria-hidden="true"], svg, .pp-visually-hidden, .pp-avatar').forEach((x) => x.remove());
    // Text nodes joined with a space, so words of two elements side by side stay two words.
    const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
    const parts: string[] = [];
    while (w.nextNode()) parts.push(w.currentNode.nodeValue ?? '');
    return { text: parts.join(' ').replace(/[\s  ]+/g, ' ').trim(), avatars: shown + more, selected: li.classList.contains('pp-card--selected') || !!li.querySelector('.pp-card--selected') };
  }));
}

export type ChosenRead = { title: string; text: string; people: Array<{ text: string; times: string[] }>; links: Array<{ href: string; target: string | null; rel: string | null; text: string }> };
/** The chosen interview as a person reads it: its title, all its text, each person line (with the words of any `time` in it), and its links. */
export async function readChosen(page: Page): Promise<ChosenRead> {
  const card = chosenOf(page);
  await expect(card, 'one chosen interview').toHaveCount(1);
  return card.evaluate((el) => {
    const t = (n: Element | null) => {
      if (!n) return '';
      const c = n.cloneNode(true) as HTMLElement;
      c.querySelectorAll('[aria-hidden="true"], svg, .pp-visually-hidden, .pp-avatar').forEach((x) => x.remove());
      const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
      const parts: string[] = [];
      while (w.nextNode()) parts.push(w.currentNode.nodeValue ?? '');
      return parts.join(' ').replace(/[\s  ]+/g, ' ').trim();
    };
    const lines = [...el.querySelectorAll('.pp-person')].map((p) => p.closest('li') ?? p.parentElement!).filter((x, i, a) => a.indexOf(x) === i);
    return {
      title: t(el.querySelector('.pp-card__title')),
      text: t(el),
      people: lines.map((li) => ({ text: t(li), times: [...li.querySelectorAll('time')].map((x) => t(x)) })),
      links: [...el.querySelectorAll('a')].map((a) => ({ href: a.getAttribute('href') ?? '', target: a.getAttribute('target'), rel: a.getAttribute('rel'), text: t(a) })),
    };
  });
}

/**
 * What is left of a line once the expected parts are taken out, in order, and the separators the kit uses (" · ", commas) and a
 * weekday name are dropped. A line that shows exactly its parts leaves ''. Anything else (a role, "null", a vote it was not sent) stays.
 */
export function leftover(text: string, parts: Array<string | null | undefined>): string {
  let rest = ` ${text} `;
  for (const p of parts) {
    if (!p) continue;
    const i = rest.indexOf(p);
    if (i < 0) return `MISSING "${p}" in "${text}"`;
    rest = `${rest.slice(0, i)} ${rest.slice(i + p.length)}`;
  }
  return rest.replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/g, ' ').replace(/[·,|:-]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Another record reached inside the app with no page load, with its own query (the pattern of rec-ui-02.4 AC-N1). */
export const inApp = (page: Page, path: string) => page.evaluate((x) => { history.pushState({}, '', x); dispatchEvent(new PopStateEvent('popstate', { state: {} })); }, path);
