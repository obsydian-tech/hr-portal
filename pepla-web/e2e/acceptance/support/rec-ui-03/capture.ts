import type { BrowserContext, Locator, Page, Route } from '@playwright/test';
import { ON_DEV } from '../fixtures';
import type { ModulesFake } from '../mod-02/modules-fake';
import { COMPANY_ID, WHO, contract, requestProblems, type Call, type Co, type HireFake, type Who } from '../rec-ui/harness';
import type { RecordFake } from '../rec-ui-02/record';
import type { InterviewsFake, Iv } from '../int-ui/interviews';
import type { ScheduleFake } from '../int-ui/schedule';
import { expect, main, test as base } from '../int-ui/close';

/**
 * REC-UI-03 step 2 · HR captures feedback for a panel member from the Interviews tab (Jira NH-229, epic NH-223, red; lock
 * acceptance-lock/rec-ui-03.2 on the child locks acceptance-lock/int-ui-03.1, int-ui-02.2 and int-ui-01.3): the words, the fake of
 * `POST /v1/interviews/{id}/votes` and the page helpers of rec-ui-03.2-capture.spec.ts.
 * Spec: onboarding-cards/specs/REC-UI-03-next-slices.md, "Step 2" (rules 1 to 8, AC-2.1 to AC-2.11) and its notes; its check
 * REC-UI-03-next-slices-spec-check.md (2 rounds). Decisions D-RUI-03.12 to .20 in DECISIONS.md. Where the spec is silent,
 * cards/rec-ui-03.2.md says what these tests take (T-F1 up).
 *
 * The fake answers as lambda/submitVote/rec07.mjs `vote` does on develop 47cdf6d, for the calls this page makes:
 *   - no or a bad sign-in token 401; a caller the fake does not know 403; Recruitment off 403 `{ error: 'Forbidden' }`;
 *   - the interview is found by its id among the caller's own company's candidates only (`ownsRow`); none, or another company's,
 *     is 404 `{ error: 'Not found' }`, before anything else is judged;
 *   - with `on_behalf_of`: a caller who is not a Recruiter 403; the company's PANEL_CONFIG `hrMayEnterForMember === false` 403; an id
 *     that is not a person on the panel (a guest, a stranger, not a string) 400 INVALID_FIELD on_behalf_of. Without it: a caller not on
 *     the panel 403;
 *   - the body as `checkBody` judges it against the interview's `criteria_snapshot` (when it is a non-empty list): `scores` exactly
 *     those keys, whole numbers 1 to 5, else 400 INVALID_SCORES; `rating` one of the four, else 400 INVALID_FIELD rating; `comment`,
 *     when sent, a string of at most 2000, else 400 INVALID_FIELD comment;
 *   - `voteRefusalOf`: COMPLETED 409 ALREADY_DONE; any other status but SCHEDULED 409 NOT_ALLOWED_NOW; before the start 409
 *     NOT_STARTED (the fake's clock is the INT-UI-02 fake's `now`); a voter who already has a vote 409 ALREADY_SCORED;
 *   - 201 `{ vote: {...} }`. The interviews read then sends that panel line as GIVEN with `vote: { rating, overall, on_behalf_by_name }`
 *     (overall: the mean of the scores to one decimal; on_behalf_by_name: the caller's name), and `can.capture_feedback` false once
 *     no person is WAITING.
 * The server ignores `Idempotency-Key` on this route; the fake records it. `refuse()` stands for a gateway or network failure, a hold
 * or a scripted answer. Every answer is checked against api/openapi.yaml. Nothing here calls Bedrock or any paid AI.
 *
 * The interviews read (support/int-ui/interviews.ts) always sends one fixed `criteria_snapshot`. This file lets a test give an
 * interview its own (or none, or `[]`) through `snapshot()`; the answer is still checked against the file.
 */

// ---------------------------------------------------------------- the words (kit, parent spec, W-9b, D-RUI-03.6, D-RUI-03.12)
export const FW = {
  capture: 'Capture feedback',
  title: (first: string, last: string) => `Interview feedback for ${first} ${last}`,
  /** D-RUI-03.12. */
  from: 'Feedback from',
  decision: 'Decision',
  notes: 'Notes',
  optional: '(optional)',
  cancel: 'Cancel',
  submit: 'Submit feedback',
  /** W-9b (approved 25 Nov). */
  notStarted: 'You can give feedback once the interview has started.',
  /** D-RUI-03.6, the app's save-failure line. */
  saveFail: 'Your change could not be saved. Try again.',
  /** The kit's drawer close button (an existing design system word). */
  close: 'Close',
} as const;
export const SCALE = ['1 out of 5, poor', '2 out of 5, fair', '3 out of 5, good', '4 out of 5, strong', '5 out of 5, excellent'];
export const DECISIONS: Array<{ label: string; help: string; code: string }> = [
  { label: 'Strong no', help: 'Do not hire, and say why', code: 'STRONG_NO' },
  { label: 'No', help: 'Not this time', code: 'NO' },
  { label: 'Yes', help: 'Hire', code: 'YES' },
  { label: 'Strong yes', help: 'Hire, and move fast', code: 'STRONG_YES' },
];
/** "{role} · {type} interview on {date}" (D-RUI-03.8 and .9); the role and its " · " left out when there is none. */
export const lineOf = (role: string | null, typeWords: string, day: string) => `${role ? `${role} · ` : ''}${typeWords} interview on ${day}`;

// ---------------------------------------------------------------- the fake

export type Snapshot = Array<{ key: string; label: string }>;
export type VoteRefusal = {
  status?: number; body?: unknown; abort?: boolean; once?: boolean;
  /** Wait for `release()` first. */
  hold?: boolean;
  /** Do the work, then drop the connection (a lost answer: the vote is saved). */
  thenAbort?: boolean;
};
export type VoteCall = Call & { interviewId: string };

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, idempotency-key',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, OPTIONS',
};
const JWT = /^Bearer eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/;
const votePath = (p: string) => /\/v1\/interviews\/([^/]+)\/votes$/.exec(p);
const RATINGS = ['STRONG_NO', 'NO', 'YES', 'STRONG_YES'];
/** The company's default criteria the vote judges an interview with no snapshot against (lambda/shared/recruitment-settings.mjs DEFAULTS). */
export const DEFAULT_CRITERIA: Snapshot = [
  { key: 'technical', label: 'Technical' }, { key: 'communication', label: 'Communication' },
  { key: 'culturalFit', label: 'Cultural fit' }, { key: 'problemSolving', label: 'Problem solving' },
];
const oneDecimal = (x: number) => Math.round(x * 10) / 10;

export class VoteFake {
  readonly calls: VoteCall[] = [];
  readonly contractErrors: string[] = [];
  private readonly emails = new Map<string, Who>();
  private readonly refusals: VoteRefusal[] = [];
  private readonly held: Array<() => void> = [];
  /** Per interview id: its stored snapshot ('missing' leaves the key out of the read). */
  private readonly snaps = new Map<string, Snapshot | 'missing'>();
  /** Candidates whose list in the read is a forged display: the server holds none of those interviews under them. */
  private readonly forged = new Set<string>();
  /** Votes kept, by `interviewId|voter`. */
  readonly votes = new Map<string, Record<string, unknown>>();
  private seq = 0;

  constructor(private readonly hire: HireFake, private readonly record: RecordFake, private readonly sched: ScheduleFake, interviews: InterviewsFake,
    private readonly subOf: (email: string) => string | undefined, private readonly modulesOf: (co: Co) => string[]) {
    // The read sends each interview's own snapshot (or none) instead of the fixed one.
    const own = interviews.interviewOf.bind(interviews);
    interviews.interviewOf = (candidateId: string, x: Iv, n: number) => {
      const out = own(candidateId, x, n);
      const s = this.snaps.get(x.id);
      if (s === 'missing') delete out['criteria_snapshot'];
      else if (s) out['criteria_snapshot'] = s.map((c) => ({ ...c }));
      return out;
    };
  }

  assign(who: Who): void { this.emails.set(who.email.toLowerCase(), who); }
  snapshot(interviewId: string, s: Snapshot | 'missing'): void { this.snaps.set(interviewId, s); }
  forge(candidateId: string): void { this.forged.add(candidateId); }
  refuse(r: VoteRefusal): void { this.refusals.push({ once: true, ...r }); }
  lift(): void { this.refusals.length = 0; }
  release(): void { for (const go of this.held.splice(0)) go(); }
  get heldCount(): number { return this.held.length; }
  get posts(): VoteCall[] { return this.calls.filter((c) => c.method === 'POST'); }

  async install(context: BrowserContext): Promise<void> {
    await context.route((url) => !!votePath(url.pathname), (route) => this.handle(route));
  }

  private who(sub: string | null): Who | null {
    if (!sub) return null;
    for (const [email, who] of this.emails) if (this.subOf(email) === sub) return who;
    return null;
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(request.url());
    let body: unknown = null;
    try { body = request.postData() ? JSON.parse(request.postData()!) : null; } catch { body = request.postData(); }
    const authorization = request.headers()['authorization'] ?? null;
    const who = authorization && JWT.test(authorization) ? this.who(subOfBearer(authorization)) : null;
    const raw = `${request.method()} ${url.pathname}${url.search}\n${JSON.stringify(request.headers())}\n${request.postData() ?? ''}`;
    const call: VoteCall = {
      seq: ++this.seq, method: request.method(), path: url.pathname, query: Object.fromEntries(url.searchParams), idempotencyKey: request.headers()['idempotency-key'] ?? null,
      body, authorization, email: who?.email ?? null, company: who?.company ?? null, raw, status: 0, interviewId: decodeURIComponent(votePath(url.pathname)![1]!),
    };
    this.calls.push(call);
    const refusal = this.refusals.shift();
    if (refusal && !refusal.once) this.refusals.unshift(refusal);
    if (refusal?.hold) await new Promise<void>((go) => this.held.push(go));
    if (refusal?.abort) { call.status = -1; return route.abort('internetdisconnected'); }
    if (refusal?.status) return this.send(route, call, refusal.status, refusal.body ?? { error: 'Internal error' }, refusal.status !== 500 && refusal.status !== 502 && refusal.status !== 503);
    const [status, answer] = this.answer(call, who);
    if (refusal?.thenAbort) { call.status = status; return route.abort('internetdisconnected'); }
    return this.send(route, call, status, answer);
  }

  /** The interview with this id among the caller's own company's real lists (never a forged one), and its candidate. */
  private find(id: string, co: Co): { iv: Iv; candId: string } | null {
    for (const c of this.hire.world.cands) {
      if (this.forged.has(c.id) || this.record.companyOf(c) !== co) continue;
      const x = this.sched.listOf(c.id).find((i) => i.id === id);
      if (x) return { iv: x, candId: c.id };
    }
    return null;
  }

  private answer(call: VoteCall, who: Who | null): [number, unknown] {
    if (call.method !== 'POST') return [404, { message: 'Not Found' }];
    if (!call.authorization || !JWT.test(call.authorization)) return [401, { message: 'Unauthorized' }];
    if (!who) return [403, { error: 'Forbidden' }];
    const wrong = requestProblems(call.method, call.path, call.query);
    if (wrong.length) { this.contractErrors.push(...wrong); return [404, { message: 'Not Found' }]; }
    if (!this.modulesOf(who.company).includes('recruitment')) return [403, { error: 'Forbidden' }];
    const found = this.find(call.interviewId, who.company);
    if (!found) return [404, { error: 'Not found' }];
    const x = found.iv;
    const b = call.body && typeof call.body === 'object' && !Array.isArray(call.body) ? (call.body as Record<string, unknown>) : null;
    const me = this.subOf(who.email)!;
    const recruiter = who.groups.includes('hr_staff') && who.groups.includes('perm-recruitment');
    const persons = x.panel.filter((e) => e.kind === 'PERSON');
    let voter = me;
    let onBehalf = false;
    if (b && b['on_behalf_of'] !== undefined) {
      if (!recruiter) return [403, { error: 'Forbidden' }];
      if (this.sched.panelConfig[who.company]?.hrMayEnterForMember === false) return [403, { error: 'Forbidden' }];
      const target = persons.find((e) => typeof b['on_behalf_of'] === 'string' && e.person_id === b['on_behalf_of']);
      if (!target) return [400, { error: 'Bad request', code: 'INVALID_FIELD', field: 'on_behalf_of' }];
      voter = b['on_behalf_of'] as string;
      onBehalf = true;
    } else if (!persons.some((e) => e.person_id === me)) return [403, { error: 'Forbidden' }];
    if (!b) return [400, { error: 'Bad request', code: 'INVALID_SCORES' }];
    const snap = this.snaps.get(x.id);
    const criteria = Array.isArray(snap) && snap.length ? snap : snap === undefined ? [{ key: 'technical', label: 'x' }] : DEFAULT_CRITERIA;
    const s = b['scores'];
    if (!s || typeof s !== 'object' || Array.isArray(s)) return [400, { error: 'Bad request', code: 'INVALID_SCORES' }];
    const keys = criteria.map((c) => c.key);
    const got = Object.keys(s);
    const sc = s as Record<string, unknown>;
    if (got.length !== keys.length || !keys.every((k) => got.includes(k))) return [400, { error: 'Bad request', code: 'INVALID_SCORES' }];
    if (!keys.every((k) => Number.isInteger(sc[k]) && (sc[k] as number) >= 1 && (sc[k] as number) <= 5)) return [400, { error: 'Bad request', code: 'INVALID_SCORES' }];
    if (!RATINGS.includes(b['rating'] as string)) return [400, { error: 'Bad request', code: 'INVALID_FIELD', field: 'rating' }];
    if (b['comment'] !== undefined && (typeof b['comment'] !== 'string' || (b['comment'] as string).length > 2000)) return [400, { error: 'Bad request', code: 'INVALID_FIELD', field: 'comment' }];
    if (x.status === 'COMPLETED') return [409, { error: 'Conflict', code: 'ALREADY_DONE' }];
    if (x.status !== 'SCHEDULED') return [409, { error: 'Conflict', code: 'NOT_ALLOWED_NOW' }];
    if (this.sched.now < Date.parse(x.at ?? '')) return [409, { error: 'Conflict', code: 'NOT_STARTED' }];
    const memo = `${x.id}|${voter}`;
    const line = x.panel.find((e) => e.kind === 'PERSON' && e.person_id === voter);
    if (this.votes.has(memo) || line?.feedback === 'GIVEN') return [409, { error: 'Conflict', code: 'ALREADY_SCORED' }];
    const at = new Date(this.sched.now).toISOString();
    const vote = { interview_id: x.id, voter_id: voter, scores: sc, rating: b['rating'], comment: b['comment'] ?? null, on_behalf: onBehalf, submitted_at: at };
    this.votes.set(memo, vote);
    if (line) {
      const nums = keys.map((k) => sc[k] as number);
      line.feedback = 'GIVEN';
      line.vote = { rating: b['rating'] as string, overall: oneDecimal(nums.reduce((p, q) => p + q, 0) / nums.length), on_behalf_by_name: onBehalf ? who.full : null };
    }
    if (!x.panel.some((e) => e.kind === 'PERSON' && e.feedback === 'WAITING')) x.can = { ...x.can, capture_feedback: false };
    return [201, { vote }];
  }

  private send(route: Route, call: VoteCall, status: number, body: unknown, checked = true): Promise<void> {
    call.status = status;
    if (checked && status !== 401) {
      const schema = contract().doc.paths?.['/v1/interviews/{id}/votes']?.post?.responses?.[String(status)]?.content?.['application/json']?.schema;
      if (!schema) this.contractErrors.push(`POST /v1/interviews/{id}/votes ${status}: api/openapi.yaml describes no such answer`);
      else this.contractErrors.push(...contract().check(schema, body).map((x) => `POST /v1/interviews/{id}/votes ${status}: ${x}`));
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
type Fx = { voter: VoteFake | null };
export const test = base.extend<Fx>({
  voter: [
    async ({ context, cognito, modules, hire, record, sched, interviews }, use) => {
      if (ON_DEV) return use(null);
      const m = modules as ModulesFake;
      const fake = new VoteFake(hire!, record!, sched!, interviews!, (email) => cognito!.subOf(email), (co) => m.answers[co]);
      for (const who of Object.values(WHO)) fake.assign(who);
      await fake.install(context);
      await use(fake);
      expect(fake.contractErrors, 'every vote request and answer matches api/openapi.yaml').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect, main, COMPANY_ID };

// ---------------------------------------------------------------- page helpers

export const isPhone = (): boolean => test.info().project.name === 'phone-390';
/** T-F1: the button, in the chosen interview (main). */
export const captureButton = (page: Page): Locator => main(page).getByRole('button', { name: FW.capture, exact: true });
/**
 * T-F2: the sheet. At 1280 the drawer, a dialog named by its title. At 390 the full page in `main`, whose level-1 heading is the
 * title (the kit's phone screen), and no drawer.
 */
export const sheetOf = (page: Page, title: string): Locator =>
  (isPhone() ? main(page).filter({ has: page.getByRole('heading', { level: 1, name: title, exact: true }) }) : page.getByRole('dialog', { name: title, exact: true }));
export const anyDrawer = (page: Page): Locator => page.locator('.pp-drawer');
/** T-F3: the picker is a single choice (a select) labelled "Feedback from". */
export const picker = (sheet: Locator): Locator => sheet.getByLabel(FW.from, { exact: true });
export const sliders = (sheet: Locator): Locator => sheet.getByRole('slider');
export const decisionRadios = (sheet: Locator): Locator => sheet.getByRole('radio');
export const notesBox = (sheet: Locator): Locator => sheet.getByRole('textbox', { name: /^Notes/ });
export const submitOf = (sheet: Locator): Locator => sheet.getByRole('button', { name: FW.submit, exact: true });
export const cancelOf = (sheet: Locator): Locator => sheet.getByRole('button', { name: FW.cancel, exact: true });
export const dangerOf = (sheet: Locator): Locator => sheet.locator('.pp-section-message--danger');
export const isOff = (l: Locator): Promise<boolean> => l.evaluate((el) => (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true');

/** The picker's choices, in order (the empty placeholder left out), and the chosen one's words ('' for none). */
export async function pickerChoices(sheet: Locator): Promise<{ choices: string[]; chosen: string }> {
  return picker(sheet).evaluate((el) => {
    const s = el as HTMLSelectElement;
    return {
      choices: [...s.options].filter((o) => o.value !== '').map((o) => (o.textContent ?? '').replace(/\s+/g, ' ').trim()),
      chosen: s.value === '' ? '' : (s.selectedOptions[0]?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    };
  });
}
export async function pickPerson(sheet: Locator, name: string): Promise<void> {
  await picker(sheet).selectOption({ label: name });
}
/** Each slider's label and its value words, shown and read out. */
export async function sliderTexts(sheet: Locator): Promise<Array<{ label: string; shown: string; spoken: string | null; min: string | null; max: string | null; step: string | null }>> {
  return sliders(sheet).evaluateAll((els) => els.map((el) => {
    const input = el as HTMLInputElement;
    const box = input.closest('.pp-slider') ?? input.parentElement!;
    return {
      label: (input.labels?.[0]?.textContent ?? '').replace(/\s+/g, ' ').trim(), shown: (box.querySelector('output')?.textContent ?? '').trim(),
      spoken: input.getAttribute('aria-valuetext'), min: input.getAttribute('min'), max: input.getAttribute('max'), step: input.getAttribute('step'),
    };
  }));
}
/** The Decision radios: label, helper line (from aria-describedby), checked. */
export async function radioTexts(sheet: Locator): Promise<Array<{ label: string; help: string; checked: boolean }>> {
  return decisionRadios(sheet).evaluateAll((els) => els.map((el) => {
    const input = el as HTMLInputElement;
    const help = (input.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
    const full = (input.labels?.[0]?.textContent ?? '').replace(/\s+/g, ' ').trim();
    return { label: full.replace(help, '').trim(), help, checked: input.checked };
  }));
}
export async function setScore(sheet: Locator, label: string, value: number): Promise<void> {
  await sheet.getByRole('slider', { name: label, exact: true }).fill(String(value));
}
export async function decide(sheet: Locator, label: string): Promise<void> {
  const i = DECISIONS.findIndex((d) => d.label === label);
  await decisionRadios(sheet).nth(i).check({ force: true });
  await expect(decisionRadios(sheet).nth(i)).toBeChecked();
}
/** Picks the person, sets every criterion in order and the Decision. */
export async function fillSheet(sheet: Locator, f: { person?: string; scores: number[]; decision: string; notes?: string; criteria: Snapshot }): Promise<void> {
  if (f.person) await pickPerson(sheet, f.person);
  for (const [i, c] of f.criteria.entries()) await setScore(sheet, c.label, f.scores[i]!);
  await decide(sheet, f.decision);
  if (f.notes !== undefined) await notesBox(sheet).fill(f.notes);
}
/** What the sheet holds now: the person, each slider's value, the Decision, the Notes. */
export async function heldIn(sheet: Locator): Promise<{ person: string; values: string[]; decision: string | null; notes: string }> {
  const { chosen } = await pickerChoices(sheet);
  const values = await sliders(sheet).evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  const r = await radioTexts(sheet);
  return { person: chosen, values, decision: r.find((x) => x.checked)?.label ?? null, notes: await notesBox(sheet).inputValue() };
}
/** Every visible text line and accessible name in the sheet (labels, options, buttons, help, messages), the typed Notes left out. */
export async function wordsOf(sheet: Locator): Promise<string[]> {
  return sheet.evaluate((root) => {
    const out = new Set<string>();
    const add = (t: string | null | undefined) => { const s = (t ?? '').replace(/[\s ]+/g, ' ').trim(); if (s) out.add(s); };
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const n = w.currentNode as Text;
      const el = n.parentElement;
      if (!el || el.closest('textarea, [aria-hidden="true"], svg, script, style')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      add(n.nodeValue);
    }
    root.querySelectorAll('[aria-label]').forEach((e) => add(e.getAttribute('aria-label')));
    root.querySelectorAll('input[placeholder], textarea[placeholder]').forEach((e) => add(e.getAttribute('placeholder')));
    return [...out];
  });
}
