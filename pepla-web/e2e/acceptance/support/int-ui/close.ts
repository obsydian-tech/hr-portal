import type { BrowserContext, Locator, Page, Route } from '@playwright/test';
import { ON_DEV } from '../fixtures';
import type { ModulesFake } from '../mod-02/modules-fake';
import { COMPANY_ID, WHO, contract, requestProblems, routeOf, type Call, type Cand, type Co, type HireFake, type Who } from '../rec-ui/harness';
import type { RecordFake } from '../rec-ui-02/record';
import { canOf, main, typeWords, type Iv } from './interviews';
import { SW, expect, test as base, type ScheduleFake } from './schedule';

/**
 * INT-UI-03 · Cancel, did not happen, mark as done (Jira NH-272, epic NH-223, amber; lock acceptance-lock/int-ui-03 on the child lock
 * acceptance-lock/int-ui-02.1, which sits on acceptance-lock/int-ui-02; the builder also merges child lock acceptance-lock/int-ui-01.2):
 * the words, the fake of the three close actions and the page helpers of int-ui-03.spec.ts.
 * Spec: specs/interview-journey/cards/INT-UI-03.md, section "Changes after spec check round 1 (27 Nov)" (it wins over the text above it):
 * M-1, M-2, S-1 to S-7, final AC-1 to AC-10, decisions INT-UI-03-D1 to D15; its check INT-UI-03-spec-check-r2.md (leftovers L-1 to L-5).
 * Where the spec is silent, cards/int-ui-03.md says what these tests take (T-C1 up).
 *
 * The INT-UI-02 fake (schedule.ts) answers `PATCH /v1/candidates/{id}/interviews/{interviewId}` for `action: 'reschedule'` only. This
 * file adds one route on the same browser context, registered after it so it answers first, for the same PATCH with any other action
 * (a reschedule is handed back to the INT-UI-02 fake). It answers as lambda/scheduleInterview/int01.mjs `act` and request-key.mjs do on
 * develop 62a20d9, for `cancel`, `did_not_happen` and `complete`:
 *   - front: not a Recruiter 403; Recruitment off 403; no `Idempotency-Key` 400 INVALID_FIELD Idempotency-Key; a body that is not an
 *     object 400 INVALID_FIELD body;
 *   - another company's candidate, or none, 404 before the key is kept;
 *   - the key: same key and same body after a 2xx gives that answer again; another body after a 2xx is 409 KEY_REUSED; a key whose
 *     request is still running is 409 KEY_IN_USE; any refusal releases the key;
 *   - `action` not one of the four 400 action; any key but action, reason, reason_note 400 with that key; a reason not in the action's
 *     list 400 reason; `reason_note` required with OTHER, 1 to 500 characters (NOT trimmed, gap G-3), allowed with the other reasons, an
 *     empty string refused 400 reason_note;
 *   - an interview that is not under the candidate 404; then refusalOf: cancel needs SCHEDULED and the start not reached
 *     (NOT_CANCELLABLE); did_not_happen needs SCHEDULED, started and nobody's feedback given (NOT_ALLOWED_NOW, gap G-1); complete needs
 *     SCHEDULED and started (NOT_ALLOWED_NOW). The fake's clock is the INT-UI-02 fake's `now` (the page clock unless a test moves it);
 *   - 200 `{ interview_id, status, sequence }`; a cancel raises `sequence`. The interview the interviews read sends next changes: its
 *     status, `closed_reason`, `closed_note` when sent, every `can` false, and on a marked-done one `no_feedback` on each waiting line.
 * Every answer is checked against api/openapi.yaml. `refuse()` stands for a gateway or network failure, or a hold.
 * Nothing here calls Bedrock or any paid AI.
 */

// ---------------------------------------------------------------- the words (approved 25 Nov, existing app words, W-N1..W-N3)
export type Action = 'cancel' | 'did_not_happen' | 'complete';
export const ACTIONS: Action[] = ['cancel', 'did_not_happen', 'complete'];
export const CW = {
  cancel: 'Cancel interview',
  didNotHappen: 'Did not happen',
  markDone: 'Mark as done',
  keep: 'Keep interview',
  secondary: 'Cancel',
  save: 'Save',
  reason: 'Reason',
  other: 'Other',
  describe: 'Describe the reason',
  /** The dialog's close button (design system, an existing app word). */
  close: 'Close',
  /** The cancel line's second sentence (approved). */
  cancelGuest: 'The guest\'s link stops working.',
  /** The cancel line's first sentence (approved, but never shown in this card: D7). */
  cancelFirst: 'Everyone invited gets an email saying it is cancelled.',
  /** The mark-as-done line with the guest clause (approved). */
  doneGuest: 'Anyone who has not given feedback will show "No feedback", and the guest\'s link stops working. This cannot be undone.',
  /** W-N2: the mark-as-done line without the guest clause. */
  doneNoGuest: 'Anyone who has not given feedback will show "No feedback". This cannot be undone.',
  /** W-N1. */
  changed: 'This interview has changed, so this can\'t be saved.',
  /** W-9c (approved). */
  hasFeedback: SW.hasFeedback,
  /** Approved. */
  saveFail: SW.saveFail,
  noFeedback: 'No feedback',
} as const;
/** The lower-cased type words inside a sentence (S-5 of INT-UI-02). */
export const lower = (typeKey: string) => (typeWords(typeKey) ?? '').toLowerCase();
/** W-N3: the menu button's name. */
export const menuName = (typeKey: string) => `More actions for the ${lower(typeKey)} interview`;
export const ACTION_WORDS: Record<Action, string> = { cancel: CW.cancel, did_not_happen: CW.didNotHappen, complete: CW.markDone };
/** The W-5 titles (approved). */
export const titleOf = (a: Action, typeKey: string): string => {
  const t = lower(typeKey);
  return a === 'cancel' ? `Cancel the ${t} interview?` : a === 'did_not_happen' ? `Record that the ${t} interview did not happen` : `Mark the ${t} interview as done?`;
};
/** The did-not-happen line (approved). */
export const dnhLine = (typeKey: string) => `Nobody is emailed. You can book a ${lower(typeKey)} interview again afterwards.`;
/** Footer: secondary, then primary (desktop order). */
export const FOOTER: Record<Action, [string, string]> = { cancel: [CW.keep, CW.cancel], did_not_happen: [CW.secondary, CW.save], complete: [CW.secondary, CW.markDone] };
/** The reasons in rule 3's order, with the code each is sent as. */
export const REASONS: Record<Action, Array<[string, string]>> = {
  cancel: [['CANDIDATE_ASKED', 'Candidate asked'], ['PANEL_NOT_AVAILABLE', 'Panel not available'], ['CANDIDATE_WITHDREW', 'Candidate withdrew'], ['OTHER', 'Other']],
  did_not_happen: [['CANDIDATE_DID_NOT_COME', 'Candidate did not come'], ['INTERVIEWER_DID_NOT_COME', 'Interviewer did not come'], ['OTHER', 'Other']],
  complete: [['FEEDBACK_GIVEN_ANOTHER_WAY', 'Feedback was given another way'], ['PANEL_MEMBER_CANNOT_GIVE_FEEDBACK', 'Someone on the panel cannot give feedback'], ['OTHER', 'Other']],
};
export const STATUS_OF: Record<Action, NonNullable<Iv['status']>> = { cancel: 'CANCELLED', did_not_happen: 'DID_NOT_HAPPEN', complete: 'COMPLETED' };
export const CODE_OF: Record<Action, string> = { cancel: 'NOT_CANCELLABLE', did_not_happen: 'NOT_ALLOWED_NOW', complete: 'NOT_ALLOWED_NOW' };
const CAN_OF: Record<Action, 'cancel' | 'did_not_happen' | 'mark_done'> = { cancel: 'cancel', did_not_happen: 'did_not_happen', complete: 'mark_done' };
export const canKey = (a: Action) => CAN_OF[a];

/** Every string AC-8 allows in the menu and the three dialogs, for an interview of this type; `extra` is what the test typed. */
export function allowedWords(typeKey: string, extra: string[] = []): Set<string> {
  return new Set<string>([
    ...ACTIONS.map((a) => titleOf(a, typeKey)), ...ACTIONS.flatMap((a) => FOOTER[a]), ...ACTIONS.flatMap((a) => REASONS[a].map((r) => r[1])),
    CW.reason, CW.describe, CW.close, CW.cancelGuest, CW.doneGuest, CW.doneNoGuest, CW.changed, CW.hasFeedback, CW.saveFail, dnhLine(typeKey),
    menuName(typeKey), CW.cancel, CW.didNotHappen, CW.markDone, '*', ...extra,
  ]);
}

// ---------------------------------------------------------------- the fake

export type CloseRefusal = {
  status?: number; body?: unknown; abort?: boolean; once?: boolean;
  /** Wait for `release()` before doing anything. */
  hold?: boolean;
  /** Do the work, then drop the connection (a lost answer). */
  thenAbort?: boolean;
};
export type CloseCall = Call & { action: string | null };

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, idempotency-key',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, OPTIONS',
};
const JWT = /^Bearer eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/;
const actPath = (p: string) => /\/v1\/candidates\/([^/]+)\/interviews\/([^/]+)$/.exec(p);
const KEYS = ['action', 'reason', 'reason_note'];
const fieldOf = (k: string) => (/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(k) ? k : 'body');
const isNote = (v: unknown) => typeof v === 'string' && v.length >= 1 && v.length <= 500;

export class CloseFake {
  readonly calls: CloseCall[] = [];
  readonly contractErrors: string[] = [];
  private readonly emails = new Map<string, Who>();
  private readonly refusals: CloseRefusal[] = [];
  private readonly held: Array<() => void> = [];
  private readonly keys = new Map<string, { body: string; status: number; answer: unknown }>();
  private readonly running = new Set<string>();
  private seq = 0;

  constructor(private readonly hire: HireFake, private readonly record: RecordFake, private readonly sched: ScheduleFake,
    private readonly subOf: (email: string) => string | undefined, private readonly modulesOf: (co: Co) => string[]) {}

  assign(who: Who): void { this.emails.set(who.email.toLowerCase(), who); }
  refuse(r: CloseRefusal): void { this.refusals.push({ once: true, ...r }); }
  lift(): void { this.refusals.length = 0; }
  release(): void { for (const go of this.held.splice(0)) go(); }
  get heldCount(): number { return this.held.length; }
  /** Every close request sent (PATCH with an action other than reschedule). */
  get writes(): CloseCall[] { return this.calls.filter((c) => c.method === 'PATCH'); }

  async install(context: BrowserContext): Promise<void> {
    await context.route((url) => !!actPath(url.pathname), (route) => this.handle(route));
  }

  private who(sub: string | null): Who | null {
    if (!sub) return null;
    for (const [email, who] of this.emails) if (this.subOf(email) === sub) return who;
    return null;
  }
  private companyOf(c: Cand): Co | null { return this.hire.world.roles.find((r) => r.role_id === c.role_id)?.company ?? c.company ?? null; }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    if (request.method() !== 'PATCH') return route.fallback();
    let body: unknown = null;
    try { body = request.postData() ? JSON.parse(request.postData()!) : null; } catch { body = request.postData(); }
    // A reschedule is the INT-UI-02 fake's.
    if (body && typeof body === 'object' && (body as Record<string, unknown>)['action'] === 'reschedule') return route.fallback();
    const url = new URL(request.url());
    const authorization = request.headers()['authorization'] ?? null;
    const who = authorization && JWT.test(authorization) ? this.who(subOfBearer(authorization)) : null;
    const raw = `${request.method()} ${url.pathname}${url.search}\n${JSON.stringify(request.headers())}\n${request.postData() ?? ''}`;
    const call: CloseCall = {
      seq: ++this.seq, method: request.method(), path: url.pathname, query: Object.fromEntries(url.searchParams), idempotencyKey: request.headers()['idempotency-key'] ?? null,
      body, authorization, email: who?.email ?? null, company: who?.company ?? null, raw, status: 0,
      action: body && typeof body === 'object' && typeof (body as Record<string, unknown>)['action'] === 'string' ? (body as Record<string, string>)['action']! : null,
    };
    this.calls.push(call);
    const refusal = this.refusals.shift();
    if (refusal && !refusal.once) this.refusals.unshift(refusal);
    const memo = this.memoOf(call, who);
    if (refusal?.hold) {
      if (memo) this.running.add(memo);
      await new Promise<void>((go) => this.held.push(go));
      if (memo) this.running.delete(memo);
    }
    if (refusal?.abort) { call.status = -1; return route.abort('internetdisconnected'); }
    if (refusal?.status) return this.send(route, call, refusal.status, refusal.body ?? { error: 'Internal error' }, false);
    const [status, answer] = this.answer(call, who, memo);
    if (refusal?.thenAbort) { call.status = status; return route.abort('internetdisconnected'); }
    return this.send(route, call, status, answer);
  }

  /** The request key's scope (request-key.mjs): company, route, caller, candidate, interview and key. */
  private memoOf(call: CloseCall, who: Who | null): string | null {
    const m = actPath(call.path);
    if (!who || !m || !call.idempotencyKey) return null;
    return `${COMPANY_ID[who.company]}|PATCH|${who.email}|${decodeURIComponent(m[1]!)}|${decodeURIComponent(m[2]!)}|${call.idempotencyKey}`;
  }

  private answer(call: CloseCall, who: Who | null, memo: string | null): [number, unknown] {
    if (!call.authorization || !JWT.test(call.authorization)) return [401, { message: 'Unauthorized' }];
    if (!who) return [403, { error: 'Forbidden' }];
    const wrong = requestProblems(call.method, call.path, call.query);
    if (wrong.length) { this.contractErrors.push(...wrong); return [404, { message: 'Not Found' }]; }
    const bad = (field: string): [number, unknown] => [400, { error: 'Bad request', code: 'INVALID_FIELD', field }];
    const conflict = (code: string): [number, unknown] => [409, { error: 'Conflict', code }];
    const notFound: [number, unknown] = [404, { error: 'Not found' }];
    const co = who.company;
    // front (int01.mjs): Recruiter, then the company and Recruitment, then the key header and the body.
    if (!(who.groups.includes('hr_staff') && who.groups.includes('perm-recruitment'))) return [403, { error: 'Forbidden' }];
    if (!this.modulesOf(co).includes('recruitment')) return [403, { error: 'Forbidden' }];
    const key = call.idempotencyKey;
    if (!key || key.length > 200) return bad('Idempotency-Key');
    const b = call.body;
    if (!b || typeof b !== 'object' || Array.isArray(b)) return bad('body');
    const m = actPath(call.path)!;
    const candId = decodeURIComponent(m[1]!);
    const c = this.hire.world.cands.find((x) => x.id === candId);
    // withKey: another company's candidate is 404 before the key is kept.
    if (!c || this.companyOf(c) !== co) return notFound;
    const bodyText = JSON.stringify(b);
    const seen = this.keys.get(memo!);
    if (seen) return seen.body === bodyText ? [seen.status, seen.answer] : conflict('KEY_REUSED');
    if (this.running.has(memo!)) return conflict('KEY_IN_USE');
    const [status, answer] = this.act(b as Record<string, unknown>, candId, decodeURIComponent(m[2]!), bad, conflict, notFound);
    // A refusal releases the key (request-key.mjs finish); a 2xx is kept with its body.
    if (status >= 200 && status < 300) this.keys.set(memo!, { body: bodyText, status, answer });
    return [status, answer];
  }

  private act(b: Record<string, unknown>, candId: string, interviewId: string, bad: (f: string) => [number, unknown], conflict: (c: string) => [number, unknown], notFound: [number, unknown]): [number, unknown] {
    const action = b['action'];
    if (typeof action !== 'string' || !['reschedule', ...ACTIONS].includes(action)) return bad('action');
    const extra = Object.keys(b).find((k) => !KEYS.includes(k));
    if (extra !== undefined) return bad(fieldOf(extra));
    const a = action as Action;
    if (!REASONS[a].some((r) => r[0] === b['reason'])) return bad('reason');
    if (b['reason'] === 'OTHER' ? !isNote(b['reason_note']) : b['reason_note'] !== undefined && !isNote(b['reason_note'])) return bad('reason_note');
    const x = this.sched.listOf(candId).find((i) => i.id === interviewId);
    if (!x) return notFound;
    const at = Date.parse(x.at ?? '');
    const started = this.sched.now >= at;
    const scheduled = x.status === 'SCHEDULED';
    const feedback = x.panel.some((e) => e.feedback === 'GIVEN');
    const allowed = a === 'cancel' ? scheduled && !started : a === 'did_not_happen' ? scheduled && started && !feedback : scheduled && started;
    if (!allowed) return conflict(CODE_OF[a]);
    x.status = STATUS_OF[a];
    x.closed_reason = b['reason'] as string;
    if (b['reason_note'] !== undefined) x.closed_note = b['reason_note'] as string;
    x.can = canOf('none');
    if (a === 'cancel') x.sequence = (x.sequence ?? 0) + 1;
    if (a === 'complete') x.panel = x.panel.map((e) => (e.feedback === 'WAITING' ? { ...e, no_feedback: true } : e));
    return [200, { interview_id: x.id, status: x.status, sequence: x.sequence ?? 1 }];
  }

  private send(route: Route, call: CloseCall, status: number, body: unknown, checked = true): Promise<void> {
    call.status = status;
    if (checked && status !== 401) {
      const template = routeOf(call.method, call.path)?.split(' ')[1] ?? '';
      const schema = contract().doc.paths?.[template]?.patch?.responses?.[String(status)]?.content?.['application/json']?.schema;
      if (!schema) this.contractErrors.push(`PATCH ${template} ${status}: api/openapi.yaml describes no such answer`);
      else this.contractErrors.push(...contract().check(schema, body).map((x) => `PATCH ${template} ${status}: ${x}`));
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
type Fx = { closer: CloseFake | null };
export const test = base.extend<Fx>({
  closer: [
    async ({ context, cognito, modules, hire, record, sched }, use) => {
      if (ON_DEV) return use(null);
      const m = modules as ModulesFake;
      const fake = new CloseFake(hire!, record!, sched!, (email) => cognito!.subOf(email), (co) => m.answers[co]);
      for (const who of Object.values(WHO)) fake.assign(who);
      // Registered after the INT-UI-02 fake, so this one answers the close actions first and hands a reschedule back.
      await fake.install(context);
      await use(fake);
      expect(fake.contractErrors, 'every close request and answer matches api/openapi.yaml').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect, main };

// ---------------------------------------------------------------- page helpers

export const isPhone = (): boolean => test.info().project.name === 'phone-390';
/** The desktop menu button of the chosen interview (any type). */
export const moreActions = (page: Page): Locator => main(page).getByRole('button', { name: /More actions/ });
/** The open menu (it floats in the overlay layer, outside main). */
export const menuOf = (page: Page): Locator => page.getByRole('menu');
/** A phone action button in the tab. */
export const actionButton = (page: Page, a: Action): Locator => main(page).getByRole('button', { name: ACTION_WORDS[a], exact: true });
/** The dialog of an action, by its title. */
export const dialogOf = (page: Page, a: Action, typeKey: string): Locator => page.getByRole('dialog', { name: titleOf(a, typeKey), exact: true });
export const anyDialog = (page: Page): Locator => page.locator('.pp-modal-dialog');
export const footerOf = (d: Locator): Locator => d.locator('.pp-modal-dialog__footer');
export const mainButtonOf = (d: Locator, a: Action): Locator => footerOf(d).getByRole('button', { name: FOOTER[a][1], exact: true });
export const secondaryOf = (d: Locator, a: Action): Locator => footerOf(d).getByRole('button', { name: FOOTER[a][0], exact: true });
export const closeButtonOf = (d: Locator): Locator => d.locator('.pp-modal-dialog__header').getByRole('button', { name: CW.close, exact: true });
export const reasonOf = (d: Locator, words: string): Locator => d.getByRole('radio', { name: words, exact: true });
export const noteOf = (d: Locator): Locator => d.getByLabel(CW.describe, { exact: true });
export const dangerOf = (d: Locator): Locator => d.locator('.pp-section-message--danger');
/** A control that is off: `disabled`, or `aria-disabled="true"`. */
export const isOff = (l: Locator): Promise<boolean> => l.evaluate((el) => (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true');

/** The menu items of the chosen interview's menu, in order (opens the menu and closes it again with Escape). */
export async function menuItems(page: Page): Promise<string[]> {
  await moreActions(page).click();
  await expect(menuOf(page)).toBeVisible();
  const names = (await menuOf(page).getByRole('menuitem').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  await page.keyboard.press('Escape');
  await expect(menuOf(page)).toHaveCount(0);
  return names;
}
/** The action controls the page shows for the chosen interview, in order: the menu's items on desktop, the buttons on a phone. */
export async function actionsShown(page: Page): Promise<string[]> {
  if (isPhone()) {
    const names = await main(page).getByRole('button').evaluateAll((bs) => bs.map((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim()));
    return names.filter((n) => [CW.cancel, CW.didNotHappen, CW.markDone].includes(n as never));
  }
  return (await moreActions(page).count()) ? menuItems(page) : [];
}
/** Opens an action's dialog the way a person does: More actions then the item on desktop, the plain button on a phone. */
export async function openAction(page: Page, a: Action, typeKey: string): Promise<Locator> {
  if (isPhone()) await actionButton(page, a).click();
  else {
    await moreActions(page).click();
    await menuOf(page).getByRole('menuitem', { name: ACTION_WORDS[a], exact: true }).click();
  }
  const d = dialogOf(page, a, typeKey);
  await expect(d).toBeVisible();
  return d;
}
/** What opened the dialog, where focus must come back: the menu button on desktop, the phone button on a phone. */
export const openerOf = (page: Page, a: Action): Locator => (isPhone() ? actionButton(page, a) : moreActions(page));

/** The dialog body's own text outside the reason field and any message: the line(s) rule 4 gives, or '' for none. */
export async function lineOf(d: Locator): Promise<string> {
  return d.locator('.pp-modal-dialog__body').evaluate((b) => {
    const c = b.cloneNode(true) as HTMLElement;
    c.querySelectorAll('.pp-field, fieldset, pp-field, .pp-section-message, pp-section-message, [aria-hidden="true"], svg, .pp-visually-hidden').forEach((x) => x.remove());
    return (c.textContent ?? '').replace(/[\s  ]+/g, ' ').trim();
  });
}
/** The reason radios in order, with which is checked. */
export async function reasonsIn(d: Locator): Promise<Array<{ name: string; checked: boolean }>> {
  const radios = d.getByRole('radio');
  const n = await radios.count();
  const out: Array<{ name: string; checked: boolean }> = [];
  for (let i = 0; i < n; i++) {
    const r = radios.nth(i);
    const id = await r.getAttribute('id');
    const label = id ? (await d.locator(`label[for="${id}"]`).count() ? (await d.locator(`label[for="${id}"]`).first().innerText()) : null) : null;
    out.push({ name: (label ?? (await r.evaluate((el) => (el.closest('label')?.textContent ?? el.getAttribute('aria-label') ?? '')))).replace(/\s+/g, ' ').trim(), checked: await r.isChecked() });
  }
  return out;
}
