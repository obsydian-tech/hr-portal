import type { BrowserContext, Locator, Page, Route } from '@playwright/test';
import { ON_DEV } from '../fixtures';
import type { ModulesFake } from '../mod-02/modules-fake';
import { WHO, contract, iso, requestProblems, type Call, type Cand, type Co, type HireFake, type Who } from '../rec-ui/harness';
import type { RecordFake } from './record';
import { SOURCE, expect, moved, test as base, type EventsFake, type Row } from './notes';

/**
 * REC-UI-02 step 9 · Reopen a Not hired candidate from the record (Jira NH-280 AC-8, epic NH-223, amber). Lock
 * acceptance-lock/rec-ui-02.9. Spec: onboarding-cards/specs/REC-UI-02-later-steps.md section 5b (rules 1 to 7, AC-RO1 to AC-RO11),
 * its checks REC-UI-02-step9-spec-check-r1.md (F-1 to F-4, S-1 to S-3) and -r2.md (PASS, notes N-1 and N-2); words D-RUI-02.35.
 *
 * Neither the harness (support/rec-ui/harness.ts), the record fake (record.ts) nor the history fake (notes.ts) answers
 * `POST /v1/candidates/{id}/reopen`; this file adds its own route for that one call, on the same browser context and the same
 * harness world, so a reopen changes the candidate the record and the board are read from.
 *
 * The record fake sends no `stage_before_not_hired` (record.ts at rec-ui-02.3). Spec check r2 N-1 asks for the field, absent by
 * default, so the locked AC-R3 and AC-R8 lines keep passing unchanged. It is added here, the way hired.ts adds `employee_id`: a
 * wrapper on `recordOf` that puts the field on the candidates a test names, and nowhere else. record.ts does not move. The answer
 * is still checked against api/openapi.yaml `CandidateRecord` (which has `stage_before_not_hired`) before it is sent.
 *
 * The fake answers as lambda/shared/recruitment-actions/record-not-hired.mjs `reopenCandidate` does at develop 64b5750, behind
 * lambda/recordNotHired/index.mjs (which passes only `body.reason` and reads no Idempotency-Key):
 *   - no or a bad sign-in token is 401; a caller without the Recruiter groups, or whose company has Recruitment off, is 403;
 *   - another company's candidate, or none, is 404 `{ error: 'Not found' }` (ownsRow), never a 403;
 *   - a missing or blank reason is 400 REASON_REQUIRED, one over 1000 characters (MAX_TEXT) 400 REASON_TOO_LONG;
 *   - a candidate that is not Not hired, or whose `stage_before_not_hired` is not one of the four open stages, is 409 NOT_OPEN;
 *   - otherwise the candidate goes back to `stage_before_not_hired`, the history gets one stage-history row from NOT_HIRED to that
 *     stage carrying the reason (the route's writeHistory), and the answer is `200 { candidateId, stage }`. As on the server,
 *     `stage_before_not_hired` stays on the row after the reopen (the update does not remove it).
 * Every refusal body carries a marker (`MARK-reopen-server-text`) so a page that prints server text fails.
 * Nothing here calls Bedrock or any paid AI.
 */

// ---------------------------------------------------------------- the words (Iggie's "Approve all", 28 Nov 2026 09:38 SAST)
export const OW = {
  /** U-8a. */
  reopen: 'Reopen',
  /** U-8b. */
  title: 'Reopen this candidate',
  /** U-8c: the label, exactly; no "(required)" (F-1). */
  reason: 'Reason',
  cancel: 'Cancel',
  /** U-8e: the line every failed save on the record and the board uses (REC-UI-01). */
  saveFail: 'Your change could not be saved. Try again.',
  /** The kit's close button of a dialog. */
  close: 'Close',
} as const;
/** The route's MAX_TEXT. */
export const MAX_REASON = 1000;
/** The stages a reopen may go back to (record-not-hired.mjs OPEN_STAGES). */
export const OPEN = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER'] as const;
/** Marker text in every refusal body, and the codes; none may reach the screen. */
export const SERVER_TEXT = 'MARK-reopen-server-text';
export const SERVER_WORDS = /MARK-reopen|NOT_OPEN|REASON_REQUIRED|REASON_TOO_LONG|Conflict|Forbidden|Not found|Bad request|Internal Server Error|\b(400|403|404|409|500)\b/;

// ---------------------------------------------------------------- the record answer: stage_before_not_hired per candidate
/**
 * Lets a test put `stage_before_not_hired` on one candidate's record answer (any string, as the server copies the row's value).
 * `null` leaves the key out. Every other candidate's answer has no such key (spec check r2 N-1).
 */
export function beforeRecords(record: RecordFake): { set: (id: string, stage: string | null) => void } {
  const over = new Map<string, string | null>();
  const base = record.recordOf.bind(record);
  record.recordOf = (c: Cand) => {
    const out = base(c);
    if (over.has(c.id)) { const v = over.get(c.id); if (v === null) delete out['stage_before_not_hired']; else out['stage_before_not_hired'] = v; }
    return out;
  };
  return { set: (id, stage) => over.set(id, stage) };
}

// ---------------------------------------------------------------- the reopen route
export type ReopenRefusal = { status?: number; body?: unknown; abort?: boolean; hold?: boolean; once?: boolean; id?: string; before?: () => void };

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, idempotency-key',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, OPTIONS',
};
const JWT = /^Bearer eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/;
const isReopenPath = (pathname: string): RegExpExecArray | null => /\/v1\/candidates\/([^/]+)\/reopen$/.exec(pathname);
const DAY = 86_400_000;

export class ReopenFake {
  readonly calls: Call[] = [];
  readonly contractErrors: string[] = [];
  /** The `stage_before_not_hired` each candidate's row holds (what the server reopens to). */
  private readonly before = new Map<string, string | null>();
  private readonly history = new Map<string, Row[]>();
  private readonly emails = new Map<string, Who>();
  private readonly refusals: ReopenRefusal[] = [];
  private readonly held: Array<() => void> = [];
  private readonly records: { set: (id: string, stage: string | null) => void };
  private seq = 0;

  constructor(private readonly hire: HireFake, private readonly record: RecordFake, private readonly events: EventsFake, private readonly subOf: (email: string) => string | undefined, private readonly modulesOf: (co: Co) => string[]) {
    this.records = beforeRecords(record);
  }

  assign(who: Who): void { this.emails.set(who.email.toLowerCase(), who); }
  /** The row's `stage_before_not_hired`: sent on the record answer and used by the route. `null` is a row without one. */
  setBefore(id: string, stage: string | null): void { this.before.set(id, stage); this.records.set(id, stage); }
  /** The candidate's history before any reopen (passed to the history fake; a reopen adds its row on top). */
  setHistory(id: string, rows: Row[]): void { this.history.set(id, rows); this.events.set(id, rows); }
  refuse(r: ReopenRefusal): void { this.refusals.push({ once: true, ...r }); }
  release(): void { for (const go of this.held.splice(0)) go(); }
  get heldCount(): number { return this.held.length; }
  /** Every reopen request but preflights. */
  get requests(): Call[] { return this.calls.filter((c) => c.method !== 'OPTIONS'); }
  posts(id?: string): Call[] { return this.requests.filter((c) => c.method === 'POST' && (!id || c.path.endsWith(`/v1/candidates/${id}/reopen`))); }

  async install(context: BrowserContext): Promise<void> {
    await context.route((url) => !!isReopenPath(url.pathname), (route) => this.handle(route));
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
    const authorization = request.headers()['authorization'] ?? null;
    const who = authorization && JWT.test(authorization) ? this.who(subOfBearer(authorization)) : null;
    const text = request.postData() ?? '';
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    const call: Call = {
      seq: ++this.seq, method: request.method(), path: url.pathname, query: Object.fromEntries(url.searchParams), idempotencyKey: request.headers()['idempotency-key'] ?? null,
      body, authorization, email: who?.email ?? null, company: who?.company ?? null, raw: `${request.method()} ${url.pathname}${url.search}\n${JSON.stringify(request.headers())}\n${text}`, status: 0,
    };
    this.calls.push(call);
    if (request.method() !== 'POST') return this.send(route, call, 404, { message: 'Not Found' }, false);
    const id = decodeURIComponent(isReopenPath(url.pathname)![1]!);
    const refusal = this.refusals.find((r) => !r.id || r.id === id);
    if (refusal) {
      if (refusal.once) this.refusals.splice(this.refusals.indexOf(refusal), 1);
      if (refusal.hold) await new Promise<void>((go) => this.held.push(go));
      refusal.before?.();
      if (refusal.abort) { call.status = -1; return route.abort('internetdisconnected'); }
      if (!refusal.hold || refusal.status) return this.send(route, call, refusal.status ?? 500, refusal.body ?? { error: `Internal Server Error ${SERVER_TEXT}` }, false);
    }
    if (!authorization || !JWT.test(authorization)) return this.send(route, call, 401, { message: 'Unauthorized' }, false);
    if (!who) return this.send(route, call, 403, { error: 'Forbidden' });
    const wrong = requestProblems(call.method, call.path, call.query);
    if (wrong.length) { this.contractErrors.push(...wrong); return this.send(route, call, 404, { message: 'Not Found' }, false); }
    const recruiter = who.groups.includes('hr_staff') && who.groups.includes('perm-recruitment');
    if (!recruiter || !this.modulesOf(who.company).includes('recruitment')) return this.send(route, call, 403, { error: 'Forbidden' });
    const b = (body && typeof body === 'object' ? body : {}) as { reason?: unknown };
    if (typeof b.reason !== 'string' || b.reason.trim() === '') return this.send(route, call, 400, { error: 'Bad request', code: 'REASON_REQUIRED' });
    if (b.reason.length > MAX_REASON) return this.send(route, call, 400, { error: 'Bad request', code: 'REASON_TOO_LONG' });
    const c = this.hire.world.cands.find((x) => x.id === id);
    if (!c || this.record.companyOf(c) !== who.company) return this.send(route, call, 404, { error: 'Not found' });
    const to = this.before.get(id) ?? null;
    if (c.stage !== 'NOT_HIRED' || !to || !(OPEN as readonly string[]).includes(to)) return this.send(route, call, 409, { error: 'Conflict', code: 'NOT_OPEN' });
    const now = this.hire.world.now;
    c.stage = to as Cand['stage'];
    c.stage_entered_at = iso(now);
    c.due_at = iso(now + 4 * DAY);
    c.sla_status = 'ON_TRACK';
    delete c.not_hired_reason;
    const row: Row = { ...moved(iso(now - 30_000), 'NOT_HIRED', to, who.full), source: SOURCE.stage, reason: b.reason };
    this.events.set(id, [...(this.history.get(id) ?? []), row]);
    this.history.set(id, [...(this.history.get(id) ?? []), row]);
    return this.send(route, call, 200, { candidateId: id, stage: to });
  }

  private send(route: Route, call: Call, status: number, body: unknown, checked = true): Promise<void> {
    call.status = status;
    if (checked && status !== 200) {
      // The file describes 400, 403, 404 and 409 as `{ error }`; 200 has no schema.
      const schema = contract().doc.paths?.['/v1/candidates/{id}/reopen']?.post?.responses?.[String(status)]?.content?.['application/json']?.schema;
      if (!schema) this.contractErrors.push(`POST /v1/candidates/{id}/reopen ${status}: api/openapi.yaml describes no such answer`);
      else this.contractErrors.push(...contract().check(schema, body).map((p) => `POST /v1/candidates/{id}/reopen ${status}: ${p}`));
    }
    if (checked && status === 200 && !contract().doc.paths?.['/v1/candidates/{id}/reopen']?.post?.responses?.['200']) this.contractErrors.push('POST /v1/candidates/{id}/reopen 200: api/openapi.yaml describes no such answer');
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
type Fx = { reopen: ReopenFake | null };
export const test = base.extend<Fx>({
  reopen: [
    async ({ context, cognito, modules, hire, record, events }, use) => {
      if (ON_DEV) return use(null);
      const m = modules as ModulesFake;
      const fake = new ReopenFake(hire!, record!, events!, (email) => cognito!.subOf(email), (co) => m.answers[co]);
      for (const who of Object.values(WHO)) fake.assign(who);
      // Registered after the harness, so this one answers the reopen first (Playwright runs the last match first).
      await fake.install(context);
      await use(fake);
      expect(fake.contractErrors, 'every reopen request and answer matches api/openapi.yaml (REC-15 rule 31)').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

// ---------------------------------------------------------------- page helpers
const mainOf = (page: Page): Locator => page.locator('main');
/** "Reopen" on the page (a button, or a link if a builder made one), shown or not; never one inside the dialog. */
export const reopenButton = (page: Page): Locator =>
  mainOf(page).getByRole('button', { name: OW.reopen, exact: true }).or(mainOf(page).getByRole('link', { name: OW.reopen, exact: true }));
/** Anything named "Reopen…" on the page, to prove there is none. */
export const anyReopen = (page: Page): Locator =>
  mainOf(page).getByRole('button', { name: /^Reopen/ }).or(mainOf(page).getByRole('link', { name: /^Reopen/ })).or(mainOf(page).getByRole('menuitem', { name: /^Reopen/ }));
export const dialogOf = (page: Page): Locator => page.getByRole('dialog', { name: OW.title, exact: true });
export const reasonField = (page: Page): Locator => dialogOf(page).getByLabel(OW.reason, { exact: true });
export const confirmButton = (page: Page): Locator => dialogOf(page).getByRole('button', { name: OW.reopen, exact: true });
export const cancelButton = (page: Page): Locator => dialogOf(page).getByRole('button', { name: OW.cancel, exact: true });
export const closeButton = (page: Page): Locator => dialogOf(page).getByRole('button', { name: OW.close, exact: true });

/** The dialog as a person reads it: its title, every label, each button's name, its other visible text (the field's own value left out). */
export async function readDialog(page: Page): Promise<{ title: string; labels: string[]; buttons: string[]; text: string; fields: Array<{ tag: string; maxlength: string | null; name: string }> }> {
  await expect(dialogOf(page)).toBeVisible();
  return dialogOf(page).evaluate((d) => {
    const t = (n: Element | null | undefined) => {
      if (!n) return '';
      const c = n.cloneNode(true) as HTMLElement;
      c.querySelectorAll('[aria-hidden="true"], .pp-visually-hidden, textarea, input').forEach((x) => x.remove());
      return (c.textContent ?? '').replace(/[\s ]+/g, ' ').trim();
    };
    const fields = [...d.querySelectorAll('textarea, input:not([type="hidden"]), select')].map((f) => {
      const id = f.getAttribute('id');
      const lab = (id ? d.querySelector(`label[for="${id}"]`) : null) ?? f.closest('label');
      return { tag: f.tagName.toLowerCase(), maxlength: f.getAttribute('maxlength'), name: t(lab) };
    });
    return {
      title: t(d.querySelector('h1, h2, h3, .pp-modal-dialog__title')),
      labels: [...d.querySelectorAll('label, legend, .pp-field__label')].map((l) => t(l)).filter((x, i, a) => x && a.indexOf(x) === i),
      buttons: [...d.querySelectorAll('button')].filter((b) => (b as HTMLElement).offsetParent !== null).map((b) => (b.getAttribute('aria-label') ?? t(b)).trim()),
      // A placeholder, title or tooltip on the field is words a person reads too (B-5: no other words).
      text: [t(d), ...[...d.querySelectorAll('textarea, input')].flatMap((f) => ['placeholder', 'title', 'aria-description'].map((k) => f.getAttribute(k) ?? ''))].join(' ').replace(/\s+/g, ' ').trim(),
      fields,
    };
  });
}

/** The text a person sees in the dialog with every allowed piece taken out: what is left must be nothing (no error words, no codes). */
export function leftOver(text: string, failing: boolean): string {
  let rest = ` ${text} `;
  for (const w of [OW.title, failing ? OW.saveFail : '\u0000', OW.reason, OW.cancel, OW.reopen]) rest = rest.split(w).join(' ');
  // The design system's character count, if a builder shows one ("12/1000", "12 / 1000").
  rest = rest.replace(/\b\d{1,4}\s*\/\s*1000\b/g, ' ');
  return rest.replace(/\s+/g, ' ').trim();
}

/** Opens the dialog from the page's "Reopen". */
export async function openDialog(page: Page): Promise<void> {
  await reopenButton(page).click();
  await expect(dialogOf(page)).toBeVisible();
}
