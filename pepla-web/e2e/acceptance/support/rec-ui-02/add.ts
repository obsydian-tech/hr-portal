import type { BrowserContext, Locator, Page, Route } from '@playwright/test';
import { ON_DEV } from '../fixtures';
import { readBoard, showStage } from '../ang-01/gallery';
import { contract, expect, iso, test as base, type Call, type Cand, type HireFake, type Role, type Who } from '../rec-ui/harness';
import { operation } from '../rec-14/schema';

/**
 * REC-UI-02 step 2 · Add candidate (Jira NH-228, lock acceptance-lock/rec-ui-02.1): the words, the fake of
 * `POST /v1/candidates` and the helpers of rec-ui-02-add.spec.ts.
 * Spec: onboarding-cards/specs/REC-UI-02-next-slice.md (rules 1 to 10, section 5 A-1 to A-8, AC-1 to AC-17).
 * Backend: REC-15 step B (PR 506), lambda/shared/recruitment-actions/add-candidate.mjs; api/openapi.yaml NewCandidate,
 * NewCandidateAnswer, NewCandidateError. Notes: ../../cards/rec-ui-02.1.md.
 *
 * The harness (support/rec-ui/harness.ts) is locked by rec-ui-01 and does not answer `POST /v1/candidates`. This file adds
 * one more route on the same browser context, registered after the harness's, so Playwright asks it first: it answers
 * `POST /v1/candidates` and passes every other request on to the harness (route.fallback). Its calls are written into the
 * harness's own `calls`, so `hire.to(...)` and `companyIdIn(...)` see them; its contract problems go into the harness's
 * `contractErrors`, which the harness fixture checks after every test (REC-14 rule 17, REC-15 rule 31):
 *   - every request body is checked against `NewCandidate` (no other key, ever);
 *   - every answer it gives is checked against the file's answer for that status (201 and 200 NewCandidateAnswer, the rest
 *     NewCandidateError), so the fake cannot answer what the real Lambda cannot.
 * It answers as the real Lambda does: Recruiter only; the key from the Idempotency-Key header; one stored answer per company
 * and key (a re-sent key gets the first answer back with 200 and writes nothing); the role read by its id inside the caller's
 * company (another company's role and an unknown role alike: 404 `{ error: 'Not found' }`); a closed role 409 ROLE_CLOSED.
 * A new candidate goes into the harness world as an Applied row of that role, so the lists and the board read it back.
 * Nothing here calls Bedrock or any paid AI.
 */

// ---------------------------------------------------------------- the words (kit text, reused approved lines, D-RUI-02.7)
export const A = {
  button: 'Add candidate',
  title: 'Add candidate',
  line: 'Fill in the details to add a candidate to the pipeline.',
  close: 'Close',
  first: 'First name',
  last: 'Last name',
  email: 'Email address',
  role: 'Role',
  choose: 'Choose a role',
  more: 'More details',
  moreMeta: 'Phone, source',
  phone: 'Phone',
  source: 'Source',
  optional: '(optional)',
  phonePlaceholder: '082 000 0000',
  sources: ['Referral', 'LinkedIn'],
  cancel: 'Cancel',
  create: 'Create candidate',
  /** The notice line (kit text), with the typed first name. */
  notice: (first: string) => `${first} gets an email saying what we keep, why and for how long.`,
  // Checks before sending: Register an employee's approved lines, reused (D-RUI-02.9), and the kit's "Choose a role".
  firstEmpty: 'Enter the first name',
  lastEmpty: 'Enter the last name',
  emailEmpty: 'Enter an email address',
  emailWrong: 'Enter an email address, like name@company.co.za',
  roleEmpty: 'Choose a role',
  phoneWrong: 'Use numbers and spaces only, like 081 234 5678.',
  /** Register an employee's summary heading for the same number of problems. */
  summary: (n: number) => `Fix ${n} ${n === 1 ? 'thing' : 'things'} to continue`,
  // Answers (rule 7).
  roleClosed: 'This role is closed. Choose another role.', // D-RUI-02.7, rule 7a
  roleNotFound: 'This role could not be found.',
  saveFail: 'Your change could not be saved. Try again.',
  rolesFail: 'Role choices could not be loaded.',
  tryAgain: 'Try again',
  noRoles: 'No open roles yet',
} as const;

/** What a refusal must never show: a code, a status number or the server's own `error` words (AC-10). */
export const NEVER_SHOWN = /\b(ROLE_CLOSED|ROLE_REQUIRED|INVALID_FIELD|INVALID_BODY|IDEMPOTENCY_KEY_REQUIRED|IN_PROGRESS|Bad request|Forbidden|Conflict|Not found|Something went wrong|Internal Server Error|400|403|404|409|500)\b/;
/** Words no Recruitment screen uses (REC-UI-00, the words check). */
export const OLD_WORDS = /\b(Masked|Rejected|Work email|Provisioning|sentiment|Evaluation)\b/i;

// ---------------------------------------------------------------- the fake of POST /v1/candidates

/** How one coming `POST /v1/candidates` is answered instead of the server's own answer. */
export type AddRefusal = {
  status?: number; body?: unknown; abort?: boolean; hold?: boolean;
  /** The server stores the candidate and keeps the answer for the key, then the connection drops before the page hears it. */
  storeThenDrop?: boolean;
  once?: boolean;
};

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, idempotency-key', 'access-control-allow-methods': 'GET, POST, PUT, OPTIONS' };
const POST_PATH = /\/v1\/candidates$/;
const ROLES_PATH = /\/v1\/roles$/;
const JWT = /^Bearer eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/;
const DAY = 86_400_000;

export class AddFake {
  /** Every candidate this fake made, in order. */
  readonly made: Cand[] = [];
  private readonly refusals: AddRefusal[] = [];
  private readonly held: Array<() => void> = [];
  private readonly keyed = new Map<string, { status: number; body: unknown }>();
  private next = 1;

  constructor(private readonly hire: HireFake, private readonly whoOf: (authorization: string | null) => Who | null) {}

  /** Answers the next `POST /v1/candidates` with this instead (once by default). */
  refuse(r: AddRefusal): void { this.refusals.push({ once: true, ...r }); }
  /** Lets every held request answer. */
  release(): void { for (const go of this.held.splice(0)) go(); }
  get heldCount(): number { return this.held.length; }

  async install(context: BrowserContext): Promise<void> {
    await context.route((url) => POST_PATH.test(url.pathname), (route) => this.handle(route));
    await context.route((url) => ROLES_PATH.test(url.pathname) && !url.searchParams.has('status'), (route) => this.allRoles(route));
  }

  /**
   * Lock check F3: the real `GET /v1/roles` (lambda/shared/recruitment-actions/roles.mjs listRoles) answers EVERY role of the
   * company, open and closed, when no status is asked for. The REC-UI-01 harness (locked) answers only open ones, so a page
   * that left out status=OPEN would look right here and show closed roles on dev. This answers it as the real server does.
   */
  private async allRoles(route: Route): Promise<void> {
    const request = route.request();
    if (request.method() !== 'GET') return route.fallback();
    const url = new URL(request.url());
    const authorization = request.headers()['authorization'] ?? null;
    const who = authorization && JWT.test(authorization) ? this.whoOf(authorization) : null;
    if (!who) return route.fallback();
    const call: Call = {
      seq: 10_000 + this.hire.calls.length, method: 'GET', path: url.pathname, query: Object.fromEntries(url.searchParams),
      idempotencyKey: null, body: null, authorization, email: who.email, company: who.company,
      raw: `GET ${url.pathname}${url.search}\n${JSON.stringify(request.headers())}\n`, status: 0,
    };
    this.hire.calls.push(call);
    const recruiter = who.groups.includes('hr_staff') && who.groups.includes('perm-recruitment');
    if (!recruiter) return this.send(route, call, 403, { error: 'Forbidden', code: 'FORBIDDEN' }, false);
    const row = (r: Role) => (this.hire as unknown as { roleRow(r: Role): unknown }).roleRow(r);
    return this.send(route, call, 200, { roles: this.hire.world.roles.filter((r) => r.company === who.company).map(row) }, false);
  }

  /** The `POST /v1/candidates` calls, in order. */
  get posts(): Call[] { return this.hire.to('POST', POST_PATH); }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    if (request.method() !== 'POST') return route.fallback();
    const url = new URL(request.url());
    const authorization = request.headers()['authorization'] ?? null;
    const who = authorization && JWT.test(authorization) ? this.whoOf(authorization) : null;
    let body: unknown = null;
    try { body = request.postData() ? JSON.parse(request.postData()!) : null; } catch { body = request.postData(); }
    const call: Call = {
      seq: 10_000 + this.hire.calls.length, method: 'POST', path: url.pathname, query: Object.fromEntries(url.searchParams),
      idempotencyKey: request.headers()['idempotency-key'] ?? null, body, authorization, email: who?.email ?? null, company: who?.company ?? null,
      raw: `POST ${url.pathname}${url.search}\n${JSON.stringify(request.headers())}\n${request.postData() ?? ''}`, status: 0,
    };
    this.hire.calls.push(call);
    // The body is checked against the file whatever the answer: the page may never send a key the file does not have.
    this.hire.contractErrors.push(...bodyProblems(body));

    const refusal = this.refusals[0];
    if (refusal) {
      if (refusal.once) this.refusals.shift();
      if (refusal.hold) await new Promise<void>((go) => this.held.push(go));
      if (refusal.abort) { call.status = -1; return route.abort('internetdisconnected'); }
      if (refusal.storeThenDrop) {
        const [status] = who ? this.answer(call, who) : [401];
        call.status = -1;
        if (status !== 201) this.hire.contractErrors.push(`storeThenDrop: the server did not store (status ${status})`);
        return route.abort('internetdisconnected');
      }
      if (refusal.status) return this.send(route, call, refusal.status, refusal.body ?? { error: 'Something went wrong' });
    }
    if (!authorization || !JWT.test(authorization)) return this.send(route, call, 401, { message: 'Unauthorized' }, false);
    if (!who) return this.send(route, call, 403, { error: 'Forbidden' });
    const [status, answer] = this.answer(call, who);
    return this.send(route, call, status, answer);
  }

  private send(route: Route, call: Call, status: number, body: unknown, checked = true): Promise<void> {
    call.status = status;
    if (checked) this.hire.contractErrors.push(...answerProblemsOf(status, body));
    return route.fulfill({ status, headers: { ...CORS, 'cache-control': 'private, no-store', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }

  /** The real Lambda's rules (lambda/shared/recruitment-actions/add-candidate.mjs), in its order. */
  private answer(call: Call, who: Who): [number, unknown] {
    const recruiter = who.groups.includes('hr_staff') && who.groups.includes('perm-recruitment');
    if (!recruiter) return [403, { error: 'Forbidden' }];
    const b = call.body;
    const bad = (code: string, field?: string): [number, unknown] => [400, { error: 'Bad request', code, ...(field ? { field } : {}) }];
    if (!b || typeof b !== 'object' || Array.isArray(b)) return bad('INVALID_BODY');
    const o = b as Record<string, unknown>;
    const key = call.idempotencyKey?.trim() ? call.idempotencyKey : typeof o['idempotencyKey'] === 'string' && o['idempotencyKey'].trim() ? o['idempotencyKey'] : null;
    if (!key) return bad('IDEMPOTENCY_KEY_REQUIRED');
    const allowed = new Set(['first_name', 'last_name', 'email', 'role_id', 'phone', 'source', 'idempotencyKey']);
    for (const k of Object.keys(o)) if (!allowed.has(k)) return bad('INVALID_FIELD', k);
    const text = (v: unknown, max: number) => typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= max;
    if (!text(o['first_name'], 80)) return bad('INVALID_FIELD', 'first_name');
    if (!text(o['last_name'], 80)) return bad('INVALID_FIELD', 'last_name');
    if (typeof o['email'] !== 'string' || o['email'].trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o['email'].trim())) return bad('INVALID_FIELD', 'email');
    if (o['phone'] !== undefined && !(typeof o['phone'] === 'string' && o['phone'].length >= 1 && o['phone'].length <= 30 && /^[0-9 +\-()]+$/.test(o['phone']))) return bad('INVALID_FIELD', 'phone');
    if (o['source'] !== undefined && !text(o['source'], 80)) return bad('INVALID_FIELD', 'source');
    if (typeof o['role_id'] !== 'string' || !o['role_id']) return bad('ROLE_REQUIRED');
    // One stored answer per company and key (the real key is tenantKey(company, key)).
    const memo = `${who.company}|${key}`;
    const seen = this.keyed.get(memo);
    if (seen) return [200, seen.body];
    const w = this.hire.world;
    const role = w.roles.find((r) => r.role_id === o['role_id'] && r.company === who.company);
    if (!role) return [404, { error: 'Not found' }];
    if (role.status !== 'OPEN') return [409, { error: 'Conflict', code: 'ROLE_CLOSED' }];
    const first = (o['first_name'] as string).trim(), last = (o['last_name'] as string).trim();
    const c: Cand = {
      id: `CAND-01JDA${String(this.next++).padStart(21, '0')}`, name: `${first} ${last}`, stage: 'APPLIED', role_id: role.role_id, level: role.level,
      email: (o['email'] as string).trim().toLowerCase(), stage_entered_at: iso(w.now), applied_at: iso(w.now), due_at: iso(w.now + 4 * DAY), sla_status: 'ON_TRACK', mine: true,
      ...(typeof o['source'] === 'string' ? { source: (o['source'] as string).trim() } : {}),
    };
    w.cands.push(c);
    this.made.push(c);
    const answer = { candidateId: c.id, candidate: this.hire.candRow(c) };
    this.keyed.set(memo, { status: 201, body: answer });
    return [201, answer];
  }
}

function bodyProblems(body: unknown): string[] {
  const schema = operation(contract().doc, 'POST /v1/candidates')?.requestBody?.content?.['application/json']?.schema;
  if (!schema) return ['api/openapi.yaml has no body for POST /v1/candidates'];
  return contract().check(schema, body).map((p) => `POST /v1/candidates body: ${p}`);
}

function answerProblemsOf(status: number, body: unknown): string[] {
  const responses = (operation(contract().doc, 'POST /v1/candidates')?.responses ?? {}) as Record<string, { content?: Record<string, { schema?: unknown }> }>;
  const schema = responses[String(status)]?.content?.['application/json']?.schema;
  if (!schema) return [`POST /v1/candidates ${status}: api/openapi.yaml describes no such answer`];
  return contract().check(schema, body).map((p) => `POST /v1/candidates ${status}: ${p}`);
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

/** The people the add fake may meet; signIn() adds each one before they sign in (see `meet`). */
const MET = new WeakMap<HireFake, Who[]>();
/** Lets the add fake know a person the harness was told about (the harness keeps its own list private). */
export function meet(hire: HireFake | null, who: Who): void {
  if (!hire) return;
  const list = MET.get(hire) ?? [];
  if (!list.includes(who)) list.push(who);
  MET.set(hire, list);
}

export const test = base.extend<{ add: AddFake | null }>({
  add: [
    async ({ context, cognito, hire }, use) => {
      if (ON_DEV || !hire) return use(null);
      const fake = new AddFake(hire, (authorization) => {
        const sub = subOfBearer(authorization ?? '');
        return (MET.get(hire) ?? []).find((w) => cognito!.subOf(w.email) === sub) ?? null;
      });
      await fake.install(context);
      await use(fake);
    },
    { auto: true },
  ],
});
export { expect };

// ---------------------------------------------------------------- finding things on the page

/** The drawer, wherever the design system puts it (it is an overlay, outside main). */
export const drawer = (page: Page): Locator => page.getByRole('dialog', { name: A.title, exact: true });
/** The page's Add candidate button (in the page header, not in the drawer). */
export const addButton = (page: Page): Locator => page.locator('main').getByRole('button', { name: A.button, exact: true });
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A control by its label; an optional field's label carries "(optional)" after its words. */
export const field = (d: Locator, label: string): Locator => d.getByLabel(new RegExp(`^${esc(label)}\\s*(\\(optional\\))?$`));
/** The pp-field that holds a control (its label, the control, its help and its error). */
export const fieldBox = (d: Locator, label: string): Locator => d.locator('.pp-field').filter({ has: d.page().getByLabel(new RegExp(`^${esc(label)}\\s*(\\(optional\\))?$`)) }).last();
export const createButton = (d: Locator): Locator => d.getByRole('button', { name: A.create, exact: true });
export const cancelButton = (d: Locator): Locator => d.getByRole('button', { name: A.cancel, exact: true });
export const closeButton = (d: Locator): Locator => d.getByRole('button', { name: A.close, exact: true });
/** "More details": the accordion's own header (a summary element, or a button). */
export const moreDetails = (d: Locator): Locator => d.locator('summary, button').filter({ hasText: A.more }).first();

/** Opens "More details" if it is closed. */
export async function openMore(d: Locator): Promise<void> {
  const details = d.locator('details').filter({ has: d.page().locator('summary', { hasText: A.more }) }).first();
  if (await details.count()) {
    if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) await moreDetails(d).click();
    await expect(details).toHaveJSProperty('open', true);
    return;
  }
  const head = moreDetails(d);
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
}

/** The options of a picker in the drawer, as a person reads them (a native select, or a listbox). */
export async function optionsOf(d: Locator, label: string): Promise<string[]> {
  const f = field(d, label);
  if ((await f.evaluate((el) => el.tagName)) === 'SELECT') return (await f.locator('option').allTextContents()).map((t) => t.trim());
  await f.click();
  const out = (await d.page().getByRole('option').allTextContents()).map((t) => t.trim());
  await d.page().keyboard.press('Escape');
  return out;
}

/** What the picker shows as chosen ('' when nothing is). */
export async function chosen(d: Locator, label: string): Promise<string> {
  const f = field(d, label);
  if ((await f.evaluate((el) => el.tagName)) === 'SELECT') return f.evaluate((el) => { const s = el as HTMLSelectElement; return (s.selectedOptions[0]?.textContent ?? '').trim(); });
  return ((await f.textContent()) ?? '').trim();
}

export async function choose(d: Locator, label: string, option: string): Promise<void> {
  const f = field(d, label);
  if ((await f.evaluate((el) => el.tagName)) === 'SELECT') await f.selectOption({ label: option });
  else { await f.click(); await d.page().getByRole('option', { name: option, exact: true }).click(); }
}

export type Form = { first?: string; last?: string; email?: string; role?: string; phone?: string; source?: string };
/** A good form: Amahle's, on Warehouse supervisor (company A). */
export const GOOD: Required<Pick<Form, 'first' | 'last' | 'email' | 'role'>> = { first: 'Nandi', last: 'Khumalo', email: 'nandi.khumalo@example.org', role: 'Warehouse supervisor' };

/** Fills what is given (a field not named is left as it is). */
export async function fill(d: Locator, f: Form): Promise<void> {
  if (f.first !== undefined) await field(d, A.first).fill(f.first);
  if (f.last !== undefined) await field(d, A.last).fill(f.last);
  if (f.email !== undefined) await field(d, A.email).fill(f.email);
  if (f.role !== undefined) await choose(d, A.role, f.role);
  if (f.phone !== undefined || f.source !== undefined) await openMore(d);
  if (f.phone !== undefined) await field(d, A.phone).fill(f.phone);
  if (f.source !== undefined) await choose(d, A.source, f.source);
}

/** Opens the drawer from the page's button and waits for its role choices. */
export async function openDrawer(page: Page): Promise<Locator> {
  await addButton(page).click();
  const d = drawer(page);
  await expect(d).toBeVisible();
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
  return d;
}

/** The three pages that carry the button, by address. */
export const PAGES = {
  board: { url: '/hire/pipeline?role=role-fleet&view=board', h1: 'Fleet controller' },
  list: { url: '/hire/pipeline', h1: 'Pipeline' },
  candidates: { url: '/hire/candidates', h1: 'Candidates' },
} as const;
export type Where = keyof typeof PAGES;

export async function openPage(page: Page, where: Where, url?: string, heading?: string): Promise<void> {
  await page.goto(url ?? PAGES[where].url);
  await expect(page.locator('main h1').first()).toHaveText(heading ?? PAGES[where].h1);
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(300);
}

/** Where every card of the board is: stage to names, whatever the width shows (a phone shows one stage at a time). */
export async function boardNow(page: Page): Promise<Record<string, string[]>> {
  const scope = page.locator('main');
  const picker = scope.getByLabel('Stage', { exact: true });
  if (await picker.isVisible()) {
    const out: Record<string, string[]> = {};
    for (const t of await picker.locator('option').allTextContents()) {
      const stage = t.replace(/\s*\(\d+\)\s*$/, '').trim();
      await showStage(scope, stage);
      out[stage] = (await readBoard(scope)).find((c) => c.stage === stage)?.cards ?? [];
    }
    return out;
  }
  return Object.fromEntries((await readBoard(scope)).map((c) => [c.stage, c.cards]));
}

/** Every visible line of text in the drawer (labels, words, buttons), trimmed, in order. */
export async function linesOf(d: Locator): Promise<string[]> {
  return (await d.innerText()).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** Ids a company's roles carry (to prove another company's role never reaches the page). */
export const A_ROLE_TITLES = ['Fleet controller', 'Warehouse supervisor', 'Senior accountant'];
