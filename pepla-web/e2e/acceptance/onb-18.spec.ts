import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { DocumentsFake, storedEmployee as screenPerson, type FakePerson } from './support/documents-fake';
import { ON_DEV, expect, test as base, type Login, type SignInPage } from './support/fixtures';
import { blocks, stripComments, tfFiles } from './support/infra-harness';
import { policyOf, resourcesNamed } from './support/onb-15/tf-policy';
import { tablesIn, tenancyGrant } from './support/ten-02/relock';
import type { Statement } from './support/ops-05/iam-eval';
import { AGENT, EMPLOYEE } from './support/onb-03/lambda-harness';
import { InviteFake, type InviteState } from './support/onb-18/invite-fake';
import {
  COMPANY, DAY, GOOD_PASSWORD, HR, INVITES, LINK, PARTNER, REPO, ROBOT_ADDRESS, ROBOT_HR, T0, at, cognitoCalls, create, current, devEnv, dynamoCalls,
  existingUser, getInvite, inviteEmail, inviteRow, invites, issue, issueArgs, logLines, lookup, mails, plain, redeem, resend, sha256, signInForToken,
  storedEmployee, tokenOf, userOf, validBody, withUser, worldWithPool, type Run, type World18,
} from './support/onb-18/lambda-harness';

/**
 * ONB-18 · Resend the link (Jira NH-172, epic NH-150). Follows ONB-04 (NH-170) and ONB-04.2 (NH-191).
 * One test per acceptance criterion, written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/ONB-18.md (16 Nov 2026, develop 9057160)
 *
 * Lambda tests (AC-2 to AC-10, and the backend half of AC-1) run the real getInvite, resendInvite, createEmployee,
 * lookupInvite and redeemInvite handlers and lambda/shared/invite.mjs, each in a fresh Node process, against
 * support/onb-18/fake-aws (ONB-04.2's fake AWS plus a Postmark that can fail), with a fixed clock. They run once,
 * in desktop-1280. Screen tests (AC-1, AC-2, AC-3, AC-7, AC-13) run at 1280 and 390 on the employee page with the
 * document fake (support/documents-fake.ts) and a fake of the two new routes (support/onb-18/invite-fake.ts).
 * AC-11 reads infra/*.tf, the Lambda folders and the API descriptions as text. AC-12 runs on pepla-dev only and is
 * red until the merge. Nothing here calls AWS, Postmark or any AI service.
 *
 * AC-14 (the company check) is not written: TEN-01 is not merged. If it is merged before the builder starts, the
 * verifier adds AC-14 under a re-lock (acceptance-lock/onb-18.1), as the spec says.
 *
 * These files are locked once the lock check accepts them: see ./README.md and cards/onb-18.md.
 */

// ---------------------------------------------------------------- the words on the screen
// Every word the page shows lives here, so a wording change from Iggie is a change to this block only.
// "For Iggie" in the spec: 1 = expiredLabel, 2 = notShown, 3 = line, 4 = notSent. Iggie approved the recommended words on 16 Nov 2026.
const WORDS = {
  heading: 'Invite link',
  /** "For Iggie" 3: no she/her. */
  line: (first: string) => `${first} sets their own password from this link`,
  sentLabel: 'Link sent',
  expiresLabel: 'Link expires',
  /** "For Iggie" 1: the label when the link is past its 7 days, replaced or closed. */
  expiredLabel: 'Link expired',
  resendLine: 'Resending closes this link and sends a new one that works for 7 days.',
  button: 'Resend link',
  /** "For Iggie" 4: ONB-03's words, reused for every resend that does not go out. */
  notSent: 'The welcome email was not sent.',
  /** "For Iggie" 2: the kit's status row is left out, since nothing records when a link is opened. */
  notShown: ['Not opened yet', 'Status'],
};
/** The API-only refusals (never on screen). */
const ONLY_HR_GET = 'Only HR can see the invite link';
const ONLY_HR_POST = 'Only HR can send a new link';

const SUBJECT = `${COMPANY}: set your password for Naleko People`;
const TOKEN43 = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/;
const WRITES = ['PutItem', 'UpdateItem', 'DeleteItem', 'BatchWriteItem', 'TransactWriteItems'];

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function lambdaOnce(testInfo: TestInfo): void {
  test.skip(ON_DEV, 'No-backend run only: it runs the Lambdas against a fake AWS.');
  test.skip(testInfo.project.name !== 'desktop-1280', 'Runs the Lambdas once: they have no screen width.');
}
const textOnce = (testInfo: TestInfo) => {
  test.skip(ON_DEV, 'No-backend run only: it reads the repository as text.');
  test.skip(testInfo.project.name !== 'desktop-1280', 'Reads the repository once: it has no screen width.');
};
const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs made-up people.');

function expectStatus(run: Run, status: number, what: string): void {
  expect(run.error, `${what}: the handler did not throw (${run.error?.message})`).toBeUndefined();
  expect(run.status, `${what}: HTTP ${status} (got ${run.status}, ${run.raw.slice(0, 300)})`).toBe(status);
}

/** A log line as one string: its message and every extra field. */
const said = (l: { message: string; extra?: unknown }) => `${l.message} ${JSON.stringify(l.extra ?? '')}`;
const failedLines = (run: Run) => logLines(run).filter((l) => l.message.includes('Invite failed'));
const inviteWrites = (run: Run) => dynamoCalls(run).filter((c) => c.table === INVITES && WRITES.includes(c.op));
const awsCalls = (run: Run) => run.calls.filter((c) => c.service !== 'log');
const rowFor = (w: World18, token: string) => invites(w).find((r) => sha256(token).includes(String(r['token_hash'])));

// ---------------------------------------------------------------- Lambda set-up

/** The stored person every Lambda test uses: Lindiwe Mokoena, Invited, HR partner Thandi Nkosi (saved). */
const PERSON = storedEmployee();
const ID = String(plain(PERSON)!['employee_id']);
const EMAIL = String(plain(PERSON)!['email']).toLowerCase();

/** A world where PERSON is stored and was sent a first link at `now` (issueInvite, as createEmployee does). */
function invited(over: Record<string, string> = {}, now = T0): { w: World18; token: string; person: ReturnType<typeof storedEmployee> } {
  const person = storedEmployee(over);
  const w0 = worldWithPool();
  w0.tables.employees.push(person);
  const first = issue(w0, issueArgs(person), { now });
  expect(first.error, `the first link is made (${first.error?.message})`).toBeUndefined();
  return { w: first.world, token: String(first.response?.token ?? ''), person };
}

/** Resends as HR and hands back the run and the new token (from the email, or invite.link when shown). */
function resent(w: World18, caller = HR, opts: Parameters<typeof resend>[3] = {}): { run: Run; token: string } {
  const run = resend(w, caller, ID, opts);
  expectStatus(run, 200, 'resendInvite');
  const fromLink = LINK.exec(String(run.body?.invite?.link ?? ''))?.[1];
  const token = fromLink ?? (mails(run).filter((m) => !(m as any).failed).length === 1 ? tokenOf(run) : '');
  return { run, token };
}

/** Does a CloudWatch Logs filter pattern match this log line (ONB-04 AC-11's reading of a pattern)? */
function filterMatches(pattern: string, line: { level: string; message: string; extra?: unknown }): boolean {
  const powertools = !line.level.startsWith('console.');
  const extra = Array.isArray(line.extra) && line.extra[0] && typeof line.extra[0] === 'object' ? (line.extra[0] as Record<string, unknown>) : {};
  const json: Record<string, unknown> | null = powertools ? { level: line.level.toUpperCase(), message: line.message, ...extra } : null;
  const text = json ? JSON.stringify(json) : line.message;
  const p = pattern.trim();
  if (p.startsWith('{')) {
    if (!json) return false;
    const inner = p.replace(/^\{|\}$/g, '').trim();
    const clause = (c: string): boolean => {
      const m = /^\(?\s*\$\.([\w.]+)\s*(=|!=)\s*(?:"((?:[^"\\]|\\.)*)"|([^\s)]+))\s*\)?$/.exec(c.trim());
      if (!m) throw new Error(`filter pattern clause not understood by the test: ${c}`);
      const got = m[1]!.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), json);
      const want = (m[3] ?? m[4]!).replace(/\\(.)/g, '$1');
      const re = new RegExp(`^${want.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
      const hit = got !== undefined && re.test(String(got));
      return m[2] === '=' ? hit : !hit;
    };
    return inner.split('||').some((alt) => alt.split('&&').every(clause));
  }
  const terms = [...p.matchAll(/(-?)(?:"((?:[^"\\]|\\.)*)"|(\S+))/g)].map((m) => ({ not: m[1] === '-', t: (m[2] ?? m[3]!).replace(/\\(.)/g, '$1') }));
  return terms.length > 0 && terms.every(({ not, t }) => text.includes(t) !== not);
}
const hclString = (v: string) => (/^"(.*)"$/s.exec(v.trim())?.[1] ?? v).replace(/\\(["\\])/g, '$1');

// ---------------------------------------------------------------- the screen

type Fixtures = { docs: DocumentsFake | null; inv: InviteFake | null };
const test = base.extend<Fixtures>({
  docs: async ({ context, baseURL }, use) => {
    if (ON_DEV) return use(null);
    const fake = new DocumentsFake(new URL(baseURL!).origin);
    await fake.install(context);
    await use(fake);
  },
  inv: async ({ context, baseURL }, use) => {
    if (ON_DEV) return use(null);
    const fake = new InviteFake(new URL(baseURL!).origin);
    await fake.install(context);
    await use(fake);
  },
});

const personPath = (id: string) => `/hr/employees/${encodeURIComponent(id)}`;

/** Ayanda Zulu, Invited, no documents yet. */
function ayanda(over: Partial<FakePerson['employee']> = {}): FakePerson {
  return { employee: screenPerson({ first_name: 'Ayanda', last_name: 'Zulu', email: 'ayanda.zulu@mokoena.co.za', stage: 'INVITED', job_title: 'Bookkeeper', department: 'Finance', ...over }), documents: [] };
}
/** Sent 11 Nov 2026 14:32 and expiring 18 Nov 2026 14:32, South Africa time. */
const SENT = { iso: '2026-11-11T12:32:00.000Z', shown: '11 Nov 2026, 14:32' };
const EXPIRES = { iso: '2026-11-18T12:32:00.000Z', shown: '18 Nov 2026, 14:32' };
/** What a resend answers in the screen tests: 14 Nov 2026 09:05, until 21 Nov 2026 09:05. */
const NEW_SENT = { iso: '2026-11-14T07:05:00.000Z', shown: '14 Nov 2026, 09:05' };
const NEW_EXPIRES = { iso: '2026-11-21T07:05:00.000Z', shown: '21 Nov 2026, 09:05' };
const okState = (email: string, status: 'ok' | 'expired' | 'used' = 'ok'): InviteState => ({ status, sentAt: SENT.iso, expiresAt: EXPIRES.iso, sentTo: email });

async function openPerson(page: Page, signIn: SignInPage, hr: Login, id: string): Promise<void> {
  await page.goto(personPath(id));
  await expect(signIn.email).toBeVisible();
  await signIn.signInAs(hr);
  await expect(page).toHaveURL(new RegExp(`${esc(personPath(id))}$`));
}
const heading1 = (page: Page) => page.getByRole('heading', { level: 1 });
const cardHeading = (page: Page) => page.getByRole('heading', { name: WORDS.heading, exact: true });
const card = (page: Page): Locator => page.locator('.pp-card').filter({ has: cardHeading(page) });
const resendButton = (page: Page) => page.getByRole('button', { name: WORDS.button, exact: true });
const cardText = async (page: Page) => clean(await card(page).innerText());
const row = (label: string, value: string) => new RegExp(`${esc(label)}:?\\s*${esc(value)}`);

/** The card as the spec draws it, for an Invited person whose link is `ok` (or `expired`). */
async function expectCard(page: Page, first: string, email: string, sent: string, expires: string, label = WORDS.expiresLabel): Promise<void> {
  await expect(cardHeading(page), 'the card "Invite link"').toBeVisible();
  await expect(card(page), 'the card is one pp-card').toHaveCount(1);
  const t = await cardText(page);
  expect(t, `"${WORDS.line(first)}"`).toContain(WORDS.line(first));
  expect(t, `${WORDS.sentLabel} ${sent}, to ${email}`).toMatch(row(WORDS.sentLabel, `${sent}, to ${email}`));
  expect(t, `${label} ${expires}`).toMatch(row(label, expires));
  expect(t, `"${WORDS.resendLine}"`).toContain(WORDS.resendLine);
  for (const w of WORDS.notShown) expect(t, `no "${w}" row`).not.toContain(w);
  expect(t, 'no she, her, he or his').not.toMatch(/\b(she|her|he|his)\b/i);
  await expect(card(page).getByRole('button', { name: WORDS.button, exact: true }), 'the button Resend link, in the card').toBeVisible();
}

/** Busy and disabled: aria-busy="true", and disabled or aria-disabled. */
async function busyAndDisabled(b: Locator): Promise<boolean> {
  const busy = (await b.getAttribute('aria-busy')) === 'true';
  const disabled = (await b.isDisabled()) || (await b.getAttribute('aria-disabled')) === 'true';
  return busy && disabled;
}

/** Whether `text` sits inside a polite live region (aria-live="polite" or role="status"). */
async function inPoliteRegion(page: Page, text: string): Promise<boolean> {
  return page.evaluate((text) => {
    const all = [...document.querySelectorAll('main *')].filter((el) => (el as HTMLElement).innerText?.includes(text));
    const deepest = all.filter((el) => !all.some((o) => o !== el && el.contains(o)));
    return deepest.some((el) => {
      for (let x: Element | null = el; x; x = x.parentElement) {
        if (x.getAttribute('aria-live') === 'polite' || x.getAttribute('role') === 'status') return true;
      }
      return false;
    });
  }, text);
}

async function noSidewaysScroll(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    if (document.documentElement.scrollWidth > window.innerWidth) out.push(`page ${document.documentElement.scrollWidth} > ${window.innerWidth}`);
    for (const el of document.querySelectorAll('main *')) {
      const s = getComputedStyle(el);
      if (/(auto|scroll)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 1) out.push(`${el.tagName.toLowerCase()}.${el.className} ${el.scrollWidth} > ${el.clientWidth}`);
    }
    return out;
  });
}

/** The elements of `root` a person can see: inside the screen's width and below the top bar (ONB-15 AC-8's check). */
async function hiddenOrCovered(root: Locator): Promise<string[]> {
  return root.evaluate(async (box) => {
    const out: string[] = [];
    const bar = document.querySelector('.pp-top-navigation, [role="banner"]');
    const barBottom = bar ? bar.getBoundingClientRect().bottom : 0;
    const els = [box, ...box.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"],a[href],button,dt,dd,p')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== 'hidden' && (el as HTMLElement).offsetParent !== null;
    });
    const name = (el: Element) => `${el.tagName.toLowerCase()} "${(el as HTMLElement).innerText.replace(/\s+/g, ' ').trim().slice(0, 40)}"`;
    for (const el of els) {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const r = el.getBoundingClientRect();
      if (r.top < barBottom - 1) out.push(`${name(el)} is under the top bar`);
      if (r.left < -1 || r.right > window.innerWidth + 1) out.push(`${name(el)} is outside the screen's width`);
      if (/^(A|BUTTON)$/.test(el.tagName)) {
        const hit = document.elementFromPoint(Math.min(window.innerWidth - 1, Math.max(0, r.left + r.width / 2)), r.top + r.height / 2);
        if (!hit || !(el === hit || el.contains(hit) || hit.contains(el))) out.push(`${name(el)} is covered by ${hit ? hit.tagName.toLowerCase() + '.' + hit.className : 'nothing'}`);
      }
    }
    window.scrollTo(0, 0);
    return out;
  });
}

// ================================================================ the tests

test.describe('ONB-18 Resend the link', () => {
  // -------------------------------------------------------------- AC-1
  test('AC-1 An Invited person\'s page shows the link: sent, to which address, when it expires, and Resend link; getInvite answers exactly that', async ({ page, signIn, hr, docs, inv }, testInfo) => {
    if (!ON_DEV && testInfo.project.name === 'desktop-1280') {
      // ---- the backend half: getInvite for the four states, and the latest of three rows
      const { w, token } = invited();
      const row0 = rowFor(w, token)!;
      const ok = getInvite(w, HR, ID);
      expectStatus(ok, 200, 'getInvite, live link');
      expect(ok.body, 'ok: exactly status, sentAt, expiresAt, sentTo').toEqual({ status: 'ok', sentAt: row0['created_at'], expiresAt: row0['expires_at'], sentTo: EMAIL });
      expect(Date.parse(String(ok.body.expiresAt)) - Date.parse(String(ok.body.sentAt)), 'expires seven days after it was sent').toBe(7 * DAY * 1000);

      const late = getInvite(w, HR, ID, { now: at(T0, 8 * DAY) });
      expectStatus(late, 200, 'getInvite, 8 days on');
      expect(late.body, 'expired after 7 days, same fields').toEqual({ status: 'expired', sentAt: row0['created_at'], expiresAt: row0['expires_at'], sentTo: EMAIL });

      const five = structuredClone(w);
      five.tables[INVITES] = five.tables[INVITES]!.map((r) => ({ ...r, failed_attempts: { N: '5' } }));
      expect(getInvite(five, HR, ID).body?.status, 'five refused passwords: expired').toBe('expired');

      const used = redeem(w, token, GOOD_PASSWORD, { now: at(T0, 3600) });
      expectStatus(used, 204, 'redeem');
      const u = getInvite(used.world, HR, ID, { now: at(T0, 7200) });
      expectStatus(u, 200, 'getInvite after the password is set');
      expect(u.body, 'used, same fields').toEqual({ status: 'used', sentAt: row0['created_at'], expiresAt: row0['expires_at'], sentTo: EMAIL });

      const none = worldWithPool();
      none.tables.employees.push(PERSON);
      const n = getInvite(none, HR, ID);
      expectStatus(n, 200, 'getInvite with no link at all');
      expect(n.body, 'none: only { status: "none" }').toEqual({ status: 'none' });

      // Three rows: the latest (sent a day ago) is stored between two older, replaced ones.
      const three = worldWithPool();
      three.tables.employees.push(PERSON);
      const mk = (hash: string, created: string, replaced?: string) => inviteRow({ token_hash: hash, employee_id: ID, created_at: created, expires_at: at(created, 7 * DAY), ...(replaced ? { replaced_at: replaced } : {}) });
      three.tables[INVITES] = [
        mk('a'.repeat(64), at(T0, -3 * DAY), at(T0, -2 * DAY)),
        mk('b'.repeat(64), at(T0, -1 * DAY)),
        mk('c'.repeat(64), at(T0, -2 * DAY), at(T0, -1 * DAY)),
      ];
      const latest = getInvite(three, HR, ID);
      expectStatus(latest, 200, 'getInvite with three rows');
      expect(latest.body, 'the latest row answers').toEqual({ status: 'ok', sentAt: at(T0, -1 * DAY), expiresAt: at(T0, 6 * DAY), sentTo: EMAIL });
    }
    if (ON_DEV) return;

    // ---- the screen
    const p = ayanda();
    docs!.add(p);
    inv!.set(p.employee.employee_id, okState(p.employee.email));
    await openPerson(page, signIn, hr, p.employee.employee_id);
    await expect(heading1(page)).toHaveText('Ayanda Zulu');
    await expectCard(page, 'Ayanda', p.employee.email, SENT.shown, EXPIRES.shown);
    const t = await cardText(page);
    expect(t, 'a live link reads "Link expires", not "Link expired"').not.toContain(WORDS.expiredLabel);
    expect(t, 'nothing failed').not.toContain(WORDS.notSent);
    expect(inv!.gets(p.employee.employee_id).every((c) => /^Bearer /.test(c.authorization ?? '')), 'the GET is signed in').toBe(true);
    // After the person header and before Documents.
    const order = await page.evaluate(() => {
      const c = [...document.querySelectorAll('.pp-card')].find((x) => /Invite link/.test((x as HTMLElement).innerText));
      const h = document.querySelector('.pp-person-header');
      const d = [...document.querySelectorAll('h2')].find((x) => (x as HTMLElement).innerText.trim() === 'Documents');
      if (!c || !h || !d) return 'missing';
      const after = !!(h.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING);
      const before = !!(c.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING);
      return after && before ? 'ok' : `after header ${after}, before Documents ${before}`;
    });
    expect(order, 'the card sits after the person header and before Documents').toBe('ok');

    // expired: same card, "Link expired".
    inv!.set(p.employee.employee_id, okState(p.employee.email, 'expired'));
    await page.reload();
    await expect(heading1(page)).toHaveText('Ayanda Zulu');
    await expectCard(page, 'Ayanda', p.employee.email, SENT.shown, EXPIRES.shown, WORDS.expiredLabel);
    expect(await cardText(page), 'not "Link expires"').not.toMatch(row(WORDS.expiresLabel, EXPIRES.shown));

    // none: no date rows, the not-sent message, and Resend link.
    inv!.set(p.employee.employee_id, { status: 'none' });
    await page.reload();
    await expect(heading1(page)).toHaveText('Ayanda Zulu');
    await expect(cardHeading(page)).toBeVisible();
    const tn = await cardText(page);
    expect(tn).toContain(WORDS.line('Ayanda'));
    expect(tn, `"${WORDS.notSent}"`).toContain(WORDS.notSent);
    for (const l of [WORDS.sentLabel, WORDS.expiresLabel, WORDS.expiredLabel]) expect(tn, `no "${l}" row`).not.toContain(l);
    await expect(card(page).getByRole('button', { name: WORDS.button, exact: true })).toBeVisible();
  });

  // -------------------------------------------------------------- AC-2
  test('AC-2 Resend sends one new link and closes the old one: one POST even on a double click, busy until the answer, then the new times', async ({ page, signIn, hr, docs, inv }, testInfo) => {
    if (!ON_DEV && testInfo.project.name === 'desktop-1280') {
      // ---- the backend half
      const { w, token: old } = invited();
      const { run, token } = resent(w);
      expect(run.body, '200: status, sentAt, expiresAt, sentTo, email { sent: true }, nothing else').toEqual({ status: 'ok', sentAt: expect.any(String), expiresAt: expect.any(String), sentTo: EMAIL, email: { sent: true } });
      expect(run.body.sentAt, 'sent now').toBe(T0);
      expect(run.body.expiresAt, 'works for 7 days').toBe(at(T0, 7 * DAY));
      const sent = mails(run);
      expect(sent, 'one Postmark message').toHaveLength(1);
      expect(String(sent[0]!.message.To).toLowerCase(), 'to the saved address').toBe(EMAIL);
      expect(sent[0]!.message.Subject, 'ONB-04\'s subject').toBe(SUBJECT);
      expect(token, 'a new 43-character token in the email').toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(token, 'not the old one').not.toBe(old);
      expect(String(sent[0]!.message.HtmlBody), 'the HTML carries the new link').toContain(`set-password#token=${token}`);
      expect(lookup(run.world, old).body?.status, 'the old link says expired').toBe('expired');
      const oldRedeem = redeem(run.world, old, GOOD_PASSWORD, { now: at(T0, 60) });
      expectStatus(oldRedeem, 410, 'redeem of the old link');
      expect(oldRedeem.body, '410 expired').toEqual({ status: 'expired' });
      expect(lookup(run.world, token).body?.status, 'the new link says ok').toBe('ok');
      expect(current(run.world), 'exactly one row is current').toHaveLength(1);
      expect(sha256(token), 'and it is the new one').toContain(String(current(run.world)[0]!['token_hash']));
      expect(Number(rowFor(run.world, token)?.['failed_attempts'] ?? 0), 'the new row starts with no refused passwords').toBe(0);
      expect(rowFor(run.world, token)?.['sent_by'], 'sent_by is the resending HR person\'s staff id').toBe('E2EHR01');
      expectStatus(redeem(run.world, token, GOOD_PASSWORD, { now: at(T0, 60) }), 204, 'redeem of the new link');

      // Three resends: only the last link is usable.
      let world = w;
      const tokens = [old];
      for (let i = 1; i <= 3; i++) {
        const r = resent(world, HR, { now: at(T0, i * 600) });
        tokens.push(r.token);
        world = r.run.world;
      }
      expect(new Set(tokens).size, 'four different links').toBe(4);
      for (const t of tokens.slice(0, 3)) expect(lookup(world, t, { now: at(T0, 2400) }).body?.status, 'every earlier link is expired').toBe('expired');
      expect(lookup(world, tokens[3]!, { now: at(T0, 2400) }).body?.status, 'the last link works').toBe('ok');
      expect(current(world), 'one current row').toHaveLength(1);
    }
    if (ON_DEV) return;

    // ---- the screen
    const p = ayanda();
    docs!.add(p);
    inv!.set(p.employee.employee_id, okState(p.employee.email));
    await openPerson(page, signIn, hr, p.employee.employee_id);
    await expectCard(page, 'Ayanda', p.employee.email, SENT.shown, EXPIRES.shown);
    inv!.hold = true;
    inv!.next.push({ kind: 'ok', sentAt: NEW_SENT.iso, expiresAt: NEW_EXPIRES.iso, sentTo: p.employee.email, email: { sent: true } });
    await resendButton(page).click();
    await expect.poll(() => inv!.posts(p.employee.employee_id).length, 'one POST').toBe(1);
    await expect.poll(() => busyAndDisabled(resendButton(page)), 'the button is busy and disabled until the answer').toBe(true);
    await resendButton(page).click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(300);
    expect(inv!.posts(p.employee.employee_id), 'a click while busy sends nothing').toHaveLength(1);
    expect(inv!.posts(p.employee.employee_id)[0]!.authorization, 'signed in').toMatch(/^Bearer /);
    expect(inv!.posts(p.employee.employee_id)[0]!.body ?? '', 'no body').toBe('');
    inv!.release();
    await expect.poll(async () => cardText(page), 'the rows show the new times').toMatch(row(WORDS.sentLabel, `${NEW_SENT.shown}, to ${p.employee.email}`));
    expect(await cardText(page)).toMatch(row(WORDS.expiresLabel, NEW_EXPIRES.shown));
    expect(await cardText(page), 'the old times are gone').not.toContain(SENT.shown);
    expect(await cardText(page), 'sent: no failure message').not.toContain(WORDS.notSent);
    expect(await inPoliteRegion(page, NEW_SENT.shown), 'the new times are in a polite live region').toBe(true);
    await expect(resendButton(page), 'the button works again').toBeEnabled();
    expect(await resendButton(page).getAttribute('aria-busy'), 'and is no longer busy').not.toBe('true');

    // A double click sends one request.
    inv!.hold = true;
    await resendButton(page).dblclick();
    await page.waitForTimeout(300);
    inv!.release();
    await page.waitForLoadState('networkidle');
    expect(inv!.posts(p.employee.employee_id), 'a double click sends one more POST, not two').toHaveLength(2);

    // A resend that works replaces whatever the card showed before: from "none" (the first email never went)
    // the date rows appear and the message goes; from an expired link the label is "Link expires" again.
    for (const [from, first, last, email] of [
      ['none', 'Fikile', 'Ndlovu', 'fikile.ndlovu@mokoena.co.za'],
      ['expired', 'Gugu', 'Khumalo', 'gugu.khumalo@mokoena.co.za'],
    ] as const) {
      const r = ayanda({ first_name: first, last_name: last, email });
      docs!.add(r);
      inv!.set(r.employee.employee_id, from === 'none' ? { status: 'none' } : okState(email, 'expired'));
      await page.goto(personPath(r.employee.employee_id));
      await expect(heading1(page)).toHaveText(`${first} ${last}`);
      await expect(cardHeading(page), `${from}: the card`).toBeVisible();
      if (from === 'none') await expect(card(page).getByText(WORDS.notSent), 'none: the message before the resend').toBeVisible();
      else expect(await cardText(page), 'expired: "Link expired" before the resend').toMatch(row(WORDS.expiredLabel, EXPIRES.shown));
      inv!.next.push({ kind: 'ok', sentAt: NEW_SENT.iso, expiresAt: NEW_EXPIRES.iso, sentTo: email, email: { sent: true } });
      await resendButton(page).click();
      await expect.poll(async () => cardText(page), `${from}: then "${WORDS.sentLabel} ${NEW_SENT.shown}, to ${email}"`).toMatch(row(WORDS.sentLabel, `${NEW_SENT.shown}, to ${email}`));
      await page.waitForLoadState('networkidle');
      const t = await cardText(page);
      expect(t, `${from}: then "${WORDS.expiresLabel} ${NEW_EXPIRES.shown}"`).toMatch(row(WORDS.expiresLabel, NEW_EXPIRES.shown));
      expect(t, `${from}: then no "${WORDS.expiredLabel}"`).not.toContain(WORDS.expiredLabel);
      expect(t, `${from}: then no "${WORDS.notSent}"`).not.toContain(WORDS.notSent);
      expect(t, `${from}: the line stays`).toContain(WORDS.line(first));
    }
  });

  // -------------------------------------------------------------- AC-3
  test('AC-3 No Resend once the password is set: used shows no card; other steps make no call; resendInvite refuses CONFIRMED and non-Invited people', async ({ page, signIn, hr, docs, inv }, testInfo) => {
    if (!ON_DEV && testInfo.project.name === 'desktop-1280') {
      const { w, token } = invited();
      const done = redeem(w, token, GOOD_PASSWORD, { now: at(T0, 60) });
      expectStatus(done, 204, 'redeem');
      const before = invites(done.world);
      const r = resend(done.world, HR, ID, { now: at(T0, 120) });
      expectStatus(r, 409, 'resend after the password is set');
      expect(r.body, '409 { status: "refused" }').toEqual({ status: 'refused' });
      expect(mails(r), 'nothing sent').toEqual([]);
      expect(inviteWrites(r).map((c) => c.op), 'nothing written').toEqual([]);
      expect(invites(r.world), 'the rows are unchanged').toEqual(before);
      expect(cognitoCalls(r, 'AdminAddUserToGroup'), 'no group change').toEqual([]);
      expect(userOf(r.world, EMAIL)?.status, 'the sign-in stays CONFIRMED').toBe('CONFIRMED');

      for (const stage of ['ACTIVE', 'DOCUMENTS_SUBMITTED', 'VERIFIED']) {
        const x = invited({ stage });
        const n = resend(x.w, HR, ID);
        expectStatus(n, 409, `resend for stage ${stage}`);
        expect(n.body, `${stage}: 409 { status: "not-invited" }`).toEqual({ status: 'not-invited' });
        expect(cognitoCalls(n), `${stage}: no Cognito call`).toEqual([]);
        expect(inviteWrites(n), `${stage}: nothing written`).toEqual([]);
        expect(mails(n), `${stage}: nothing sent`).toEqual([]);
        expect(lookup(n.world, x.token).body?.status, `${stage}: the earlier link is untouched`).toBe('ok');
      }
    }
    if (ON_DEV) return;

    // ---- used: no card, no Resend link
    const p = ayanda();
    const other = { employee: screenPerson({ first_name: 'Bongani', last_name: 'Nkosi', stage: 'ACTIVE' }), documents: [] } satisfies FakePerson;
    docs!.add(p, other);
    inv!.set(p.employee.employee_id, okState(p.employee.email, 'used'));
    inv!.set(other.employee.employee_id, okState(other.employee.email));
    await openPerson(page, signIn, hr, p.employee.employee_id);
    await expect(heading1(page)).toHaveText('Ayanda Zulu');
    await expect.poll(() => inv!.gets(p.employee.employee_id).length, 'the page asks for the link').toBeGreaterThan(0);
    await page.waitForLoadState('networkidle');
    await expect(cardHeading(page), 'used: no card').toHaveCount(0);
    await expect(resendButton(page), 'used: no Resend link').toHaveCount(0);

    // ---- a person at another step: neither, and no call to the invite route
    await page.goto(personPath(other.employee.employee_id));
    await expect(heading1(page)).toHaveText('Bongani Nkosi');
    await page.waitForLoadState('networkidle');
    await expect(cardHeading(page)).toHaveCount(0);
    await expect(resendButton(page)).toHaveCount(0);
    expect(inv!.calls.filter((c) => c.id === other.employee.employee_id).map((c) => c.method), 'no call to the invite route').toEqual([]);

    // ---- 409 not-invited: the page reads the person again, and the card goes.
    const c = ayanda({ first_name: 'Chipo', last_name: 'Banda', email: 'chipo.banda@mokoena.co.za' });
    docs!.add(c);
    inv!.set(c.employee.employee_id, okState(c.employee.email));
    await page.goto(personPath(c.employee.employee_id));
    await expect(heading1(page)).toHaveText('Chipo Banda');
    await expect(cardHeading(page)).toBeVisible();
    const reads = docs!.gets().length;
    c.employee.stage = 'ACTIVE';
    docs!.add(c);
    inv!.next.push({ kind: 'not-invited' });
    await resendButton(page).click();
    await expect.poll(() => docs!.gets().length, 'the person is read again').toBeGreaterThan(reads);
    await expect(cardHeading(page), 'the card goes').toHaveCount(0);
    await expect(resendButton(page)).toHaveCount(0);
    await expect(heading1(page)).toHaveText('Chipo Banda');
  });

  // -------------------------------------------------------------- AC-4
  test('AC-4 Only HR: an employee, no group, a look-alike group, the agent and no claims get 403 from both routes with no AWS call', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    const { w } = invited();
    const callers: Array<[string, Parameters<typeof resend>[1]]> = [
      ['an employee login', EMPLOYEE],
      ['a login with no group', { ...HR, groups: [] }],
      ['groups that only contain hr_staff inside another name', { ...HR, groups: ['hr_staff_readonly', 'not-hr_staff'] }],
      ['the same, as one string', { ...HR, groups: ['hr_staffing'], form: 'name' }],
      ['the agent', AGENT],
      ['no claims at all', { kind: 'none' }],
    ];
    for (const [who, caller] of callers) {
      for (const [route, run, words] of [['GET', getInvite, ONLY_HR_GET], ['POST', resend, ONLY_HR_POST]] as const) {
        const r = run(w, caller, ID);
        expectStatus(r, 403, `${route} as ${who}`);
        expect(r.body, `${route} as ${who}: { error: "${words}" }`).toEqual({ error: words });
        expect(awsCalls(r).map((c) => `${c.service} ${c.op}`), `${route} as ${who}: no AWS call at all`).toEqual([]);
      }
    }
    for (const form of ['bracket', 'array', 'name'] as const) {
      expectStatus(getInvite(w, { ...HR, form }, ID), 200, `GET as HR (groups as ${form})`);
      expectStatus(resend(w, { ...HR, form }, ID), 200, `POST as HR (groups as ${form})`);
    }
    expectStatus(getInvite(w, { ...HR, groups: ['employee', 'hr_staff'] }, ID), 200, 'GET as HR who is also in employee');
  });

  // -------------------------------------------------------------- AC-5
  test('AC-5 Test logins never get a real email: Postmark is skipped, the link is still made, and invite.link only for a test login, a test address and INVITE_TEST_LINK', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    const ON = { INVITE_TEST_LINK: 'true' };
    const robotPerson = invited({ email: ROBOT_ADDRESS });
    const normal = invited();

    const cases: Array<[string, World18, string, Parameters<typeof resend>[1], Record<string, string>, boolean, boolean]> = [
      // what, world, old token, caller, env, skipped?, link shown?
      ['test login, test address, INVITE_TEST_LINK=true', robotPerson.w, robotPerson.token, ROBOT_HR, ON, true, true],
      ['normal HR, test address, INVITE_TEST_LINK=true', robotPerson.w, robotPerson.token, HR, ON, true, false],
      ['test login, normal address, INVITE_TEST_LINK=true', normal.w, normal.token, ROBOT_HR, ON, true, false],
      ['test login, test address, INVITE_TEST_LINK unset', robotPerson.w, robotPerson.token, ROBOT_HR, {}, true, false],
      ['test login, test address, INVITE_TEST_LINK=false', robotPerson.w, robotPerson.token, ROBOT_HR, { INVITE_TEST_LINK: 'false' }, true, false],
      ['normal HR, normal address, INVITE_TEST_LINK=true', normal.w, normal.token, HR, ON, false, false],
    ];
    for (const [what, w, old, caller, env, skipped, shown] of cases) {
      const r = resend(w, caller, ID, { env });
      expectStatus(r, 200, what);
      if (skipped) {
        expect(mails(r), `${what}: Postmark is never called`).toEqual([]);
        expect(r.body?.email, `${what}: email { sent: false, skipped: "test" }`).toEqual({ sent: false, skipped: 'test' });
      } else {
        expect(mails(r), `${what}: the person is mailed`).toHaveLength(1);
        expect(r.body?.email, `${what}: email { sent: true }`).toEqual({ sent: true });
      }
      expect(lookup(r.world, old).body?.status, `${what}: the old link is closed`).toBe('expired');
      expect(current(r.world), `${what}: a new link is made`).toHaveLength(1);
      expect(sha256(old), `${what}: and it is not the old one`).not.toContain(String(current(r.world)[0]!['token_hash']));
      if (shown) {
        const m = LINK.exec(String(r.body?.invite?.link ?? ''));
        expect(m, `${what}: invite.link is the new link`).toBeTruthy();
        expect(sha256(m![1]!), `${what}: invite.link opens the current row`).toContain(String(current(r.world)[0]!['token_hash']));
        expect(Object.keys(r.body.invite), `${what}: invite holds only link`).toEqual(['link']);
      } else {
        expect(r.body?.invite, `${what}: no invite in the answer`).toBeUndefined();
        expect(r.raw, `${what}: no link anywhere in the answer`).not.toMatch(/set-password|token=/);
      }
    }
  });

  // -------------------------------------------------------------- AC-6
  test('AC-6 A disabled sign-in is refused (L-1): no resend, no new sign-up link from createEmployee, and an old link cannot set the password', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    // (a) resendInvite
    const { w, token } = invited();
    const off = withUser(w, EMAIL, (u) => { u.enabled = false; });
    expect(userOf(off, EMAIL), 'the sign-in waits for its first password, in employee, and is disabled').toMatchObject({ status: 'FORCE_CHANGE_PASSWORD', groups: ['employee'], enabled: false });
    const rowsBefore = invites(off);
    const userBefore = structuredClone(userOf(off, EMAIL));
    const a = resend(off, HR, ID);
    expectStatus(a, 409, '(a) resend for a disabled sign-in');
    expect(a.body, '(a) 409 { status: "refused" }').toEqual({ status: 'refused' });
    expect(cognitoCalls(a, 'AdminAddUserToGroup'), '(a) no AdminAddUserToGroup').toEqual([]);
    expect(inviteWrites(a).map((c) => c.op), '(a) no invite PutItem and no replaced_at update').toEqual([]);
    expect(invites(a.world), '(a) the rows are unchanged').toEqual(rowsBefore);
    expect(lookup(a.world, token).body?.status, '(a) the old link still says ok').toBe('ok');
    expect(mails(a), '(a) no email').toEqual([]);
    expect(userOf(a.world, EMAIL), '(a) the sign-in is exactly as it was').toEqual(userBefore);
    const fl = failedLines(a);
    expect(fl, `(a) one "Invite failed" line (lines: ${logLines(a).map((l) => l.message).join(' | ').slice(0, 300)})`).toHaveLength(1);
    expect(fl[0]!.level, '(a) logged as an error').toMatch(/error/i);
    expect(said(fl[0]!), '(a) with the employee id').toContain(ID);
    expect(said(fl[0]!), '(a) and InviteRefused').toContain('InviteRefused');

    // (b) createEmployee for that address
    const w2 = worldWithPool();
    w2.cognito.users.push({ ...existingUser('ayanda.zulu@mokoena.co.za', 'FORCE_CHANGE_PASSWORD', ['employee']), enabled: false });
    const b = create(w2, HR, validBody());
    expectStatus(b, 201, '(b) createEmployee for an address whose sign-in is disabled');
    expect(b.body?.cognito?.userCreated, '(b) cognito.userCreated: false').toBe(false);
    expect(b.body?.email?.sent, '(b) email.sent: false').toBe(false);
    expect(b.body?.invite, '(b) no invite').toBeUndefined();
    expect(mails(b), '(b) no email').toEqual([]);
    expect(invites(b.world), '(b) no invite row').toEqual([]);
    expect(cognitoCalls(b, 'AdminAddUserToGroup'), '(b) no group change').toEqual([]);

    // (c) redeem a link made before the user was disabled
    const reg = create(worldWithPool(), HR, validBody());
    expectStatus(reg, 201, '(c) registration');
    const regToken = tokenOf(reg);
    const regId = String(reg.body?.employee?.employee_id ?? '');
    const disabled = withUser(reg.world, 'ayanda.zulu@mokoena.co.za', (u) => { u.enabled = false; });
    const c = redeem(disabled, regToken, GOOD_PASSWORD, { now: at(T0, 3600) });
    expectStatus(c, 410, '(c) redeem for a disabled sign-in');
    expect(c.body, '(c) 410 { status: "used" }').toEqual({ status: 'used' });
    expect(cognitoCalls(c, 'AdminSetUserPassword'), '(c) no AdminSetUserPassword').toEqual([]);
    expect(lookup(c.world, regToken, { now: at(T0, 3660) }).body?.status, '(c) lookup then says used').toBe('used');
    const refused = logLines(c).filter((l) => l.message.includes('Invite redeem refused'));
    expect(refused, '(c) one "Invite redeem refused" line').toHaveLength(1);
    expect(said(refused[0]!), '(c) with the employee id').toContain(regId);
    expect(said(refused[0]!), '(c) and the reason disabled').toMatch(/\bdisabled\b/);
    expect(said(refused[0]!).toLowerCase(), '(c) and no address').not.toContain('ayanda.zulu@mokoena.co.za');
    expect(said(refused[0]!), '(c) and no token or password').not.toMatch(new RegExp(`${esc(regToken)}|${esc(GOOD_PASSWORD)}`));
    const back = withUser(c.world, 'ayanda.zulu@mokoena.co.za', (u) => { u.enabled = true; });
    const again = redeem(back, regToken, GOOD_PASSWORD, { now: at(T0, 3720) });
    expectStatus(again, 410, '(c) re-enabled: the same link');
    expect(again.body, '(c) re-enabling does not bring the link back').toEqual({ status: 'used' });
    expect(cognitoCalls(again, 'AdminSetUserPassword'), '(c) still nothing set').toEqual([]);
  });

  // -------------------------------------------------------------- AC-7
  test('AC-7 A failure is shown, not hidden: a failed send keeps the new link and says so; a Cognito failure is 502 and changes nothing; the page says the email was not sent', async ({ page, signIn, hr, docs, inv }, testInfo) => {
    if (!ON_DEV && testInfo.project.name === 'desktop-1280') {
      // (a) Postmark fails
      const { w, token: old } = invited();
      const sick: World18 = { ...w, postmarkFail: true };
      const a = resend(sick, HR, ID);
      expectStatus(a, 200, '(a) resend when Postmark fails');
      expect(a.body?.email, '(a) email { sent: false }, no skipped').toEqual({ sent: false });
      expect(lookup(a.world, old).body?.status, '(a) the old link is closed').toBe('expired');
      expect(current(a.world), '(a) the new link stands').toHaveLength(1);
      expect(sha256(old), '(a) and is new').not.toContain(String(current(a.world)[0]!['token_hash']));
      const fa = failedLines(a);
      expect(fa, '(a) one "Invite failed" line').toHaveLength(1);
      expect(fa[0]!.level, '(a) as an error').toMatch(/error/i);
      expect(said(fa[0]!), '(a) with step: "email"').toMatch(/"step":"email"/);
      expect(said(fa[0]!), '(a) and the employee id').toContain(ID);

      // (b) Cognito fails
      const b = resend({ ...w, cognitoFail: ['AdminGetUser'] }, HR, ID);
      expectStatus(b, 502, '(b) resend when Cognito AdminGetUser fails');
      expect(b.body, '(b) 502 { status: "failed" }').toEqual({ status: 'failed' });
      expect(inviteWrites(b).map((c) => c.op), '(b) nothing written').toEqual([]);
      expect(mails(b), '(b) no email').toEqual([]);
      expect(lookup(b.world, old).body?.status, '(b) the old link still says ok').toBe('ok');
      const fb = failedLines(b);
      expect(fb, '(b) one "Invite failed" line').toHaveLength(1);
      expect(said(fb[0]!), '(b) with the error name').toContain('InternalErrorException');
      expect(said(fb[0]!), '(b) and the employee id').toContain(ID);
    }
    if (ON_DEV) return;

    // (c) the screen
    const p = ayanda();
    docs!.add(p);
    inv!.set(p.employee.employee_id, okState(p.employee.email));
    await openPerson(page, signIn, hr, p.employee.employee_id);
    await expectCard(page, 'Ayanda', p.employee.email, SENT.shown, EXPIRES.shown);
    for (const kind of ['refused', 'failed', 'offline'] as const) {
      await page.reload();
      await expectCard(page, 'Ayanda', p.employee.email, SENT.shown, EXPIRES.shown);
      await expect(card(page).getByText(WORDS.notSent), `${kind}: no message before the click`).toHaveCount(0);
      const before = inv!.posts(p.employee.employee_id).length;
      inv!.next.push({ kind });
      await resendButton(page).click();
      await expect.poll(() => inv!.posts(p.employee.employee_id).length, `${kind}: one POST`).toBe(before + 1);
      await expect(card(page).getByText(WORDS.notSent), `${kind}: "${WORDS.notSent}"`).toBeVisible();
      const t = await cardText(page);
      expect(t, `${kind}: the old rows stay`).toMatch(row(WORDS.sentLabel, `${SENT.shown}, to ${p.employee.email}`));
      expect(t, `${kind}: the old expiry stays`).toMatch(row(WORDS.expiresLabel, EXPIRES.shown));
      await expect(resendButton(page), `${kind}: Resend link works again`).toBeEnabled();
      expect(await resendButton(page).getAttribute('aria-busy'), `${kind}: not busy`).not.toBe('true');
      await expect(page.getByRole('button', { name: 'Try again', exact: true }), `${kind}: the card adds no Try again button`).toHaveCount(0);
    }
    const tries = inv!.posts(p.employee.employee_id).length;
    expect(tries, 'one POST per click').toBe(3);

    // A failed resend, then one that works: the message goes.
    await expect(card(page).getByText(WORDS.notSent), 'after the failed resend: the message').toBeVisible();
    inv!.next.push({ kind: 'ok', sentAt: NEW_SENT.iso, expiresAt: NEW_EXPIRES.iso, sentTo: p.employee.email, email: { sent: true } });
    await resendButton(page).click();
    await expect.poll(async () => cardText(page), 'then a resend that works: the new times').toMatch(row(WORDS.sentLabel, `${NEW_SENT.shown}, to ${p.employee.email}`));
    await page.waitForLoadState('networkidle');
    await expect(card(page).getByText(WORDS.notSent), `then a resend that works: no "${WORDS.notSent}"`).toHaveCount(0);

    // 200 but the email did not go: the new times, and the message.
    inv!.next.push({ kind: 'ok', sentAt: NEW_SENT.iso, expiresAt: NEW_EXPIRES.iso, sentTo: p.employee.email, email: { sent: false } });
    await resendButton(page).click();
    await expect.poll(async () => cardText(page), 'the new times').toMatch(row(WORDS.sentLabel, `${NEW_SENT.shown}, to ${p.employee.email}`));
    await expect(card(page).getByText(WORDS.notSent), 'and the message').toBeVisible();

    // 200 for a test address (skipped): the new times and no message.
    const q = ayanda({ first_name: 'Dineo', last_name: 'Mabaso', email: 'e2e.run-onb18-0001@blackhole.postmarkapp.com' });
    docs!.add(q);
    inv!.set(q.employee.employee_id, okState(q.employee.email));
    await page.goto(personPath(q.employee.employee_id));
    await expect(heading1(page)).toHaveText('Dineo Mabaso');
    await expect(cardHeading(page)).toBeVisible();
    inv!.next.push({ kind: 'ok', sentAt: NEW_SENT.iso, expiresAt: NEW_EXPIRES.iso, sentTo: q.employee.email, email: { sent: false, skipped: 'test' } });
    await resendButton(page).click();
    await expect.poll(async () => cardText(page), 'the new times').toMatch(row(WORDS.sentLabel, `${NEW_SENT.shown}, to ${q.employee.email}`));
    await page.waitForLoadState('networkidle');
    expect(await cardText(page), 'skipped for a test address: no message').not.toContain(WORDS.notSent);

    // A failed GET: no card and nothing extra (no second Try again).
    const g = ayanda({ first_name: 'Elias', last_name: 'Moyo', email: 'elias.moyo@mokoena.co.za' });
    docs!.add(g);
    for (const mode of ['error', 'offline'] as const) {
      inv!.getMode = mode;
      inv!.set(g.employee.employee_id, okState(g.employee.email));
      await page.goto(personPath(g.employee.employee_id));
      await expect(heading1(page)).toHaveText('Elias Moyo');
      await page.waitForLoadState('networkidle');
      await expect(cardHeading(page), `GET ${mode}: no card`).toHaveCount(0);
      await expect(resendButton(page), `GET ${mode}: no Resend link`).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Try again', exact: true }), `GET ${mode}: no Try again button`).toHaveCount(0);
      await expect(page.getByText(WORDS.notSent), `GET ${mode}: no message`).toHaveCount(0);
    }
    inv!.getMode = 'ok';
  });

  // -------------------------------------------------------------- AC-7 (d)
  test('AC-7 (d) The InviteFailed filter on resendInvite\'s log group matches the lines it logs, and no line of a good resend', async ({}, testInfo) => {
    textOnce(testInfo);
    const modules = join(REPO, 'infra', 'modules');
    const allTf = [...tfFiles(), ...readdirSync(modules, { withFileTypes: true }).filter((d) => d.isDirectory()).flatMap((d) => tfFiles(join(modules, d.name)))];
    const alarmsTf = tfFiles(join(modules, 'alarms'));
    const attr = (b: { body: string }, name: string) => new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, 'm').exec(b.body)?.[1]?.trim() ?? '';
    const metricOf = (b: { body: string }) => /metric_transformation\s*\{[^}]*name\s*=\s*"([^"]+)"/.exec(b.body)?.[1];
    const nsOf = (b: { body: string }) => /metric_transformation\s*\{[^}]*namespace\s*=\s*"([^"]+)"/.exec(b.body)?.[1];
    const filters = blocks(alarmsTf, 'resource').filter((b) => b.labels[0] === 'aws_cloudwatch_log_metric_filter' && /resendInvite/.test(attr(b, 'log_group_name')));
    expect(filters, 'a metric filter on /aws/lambda/resendInvite in infra/modules/alarms').not.toHaveLength(0);
    expect(blocks(tfFiles(), 'resource').filter((b) => b.labels[0] === 'aws_cloudwatch_log_metric_filter' && /resendInvite/.test(b.body)), 'not in infra/*.tf (ONB-03 AC-12 counts infra/alarms.tf)').toEqual([]);
    const alarm = blocks(allTf, 'resource').find((b) => b.labels[0] === 'aws_cloudwatch_metric_alarm' && /InviteFailed/.test(attr(b, 'alarm_name')));
    expect(alarm, 'the InviteFailed alarm').toBeTruthy();
    const watched = filters.filter((f) => `"${metricOf(f)}"` === attr(alarm!, 'metric_name') && `"${nsOf(f)}"` === attr(alarm!, 'namespace'));
    expect(watched, 'the filter makes the metric the InviteFailed alarm counts (same name and namespace)').not.toHaveLength(0);
    const patterns = watched.map((b) => hclString(/^\s*pattern\s*=\s*("(?:[^"\\]|\\.)*")\s*$/m.exec(b.body)?.[1] ?? '""'));

    const { w } = invited();
    const runs: Array<[string, Run]> = [
      ['refused (disabled sign-in)', resend(withUser(w, EMAIL, (u) => { u.enabled = false; }), HR, ID)],
      ['Postmark fails', resend({ ...w, postmarkFail: true }, HR, ID)],
      ['Cognito fails', resend({ ...w, cognitoFail: ['AdminGetUser'] }, HR, ID)],
    ];
    for (const [what, r] of runs) {
      const lines = logLines(r).filter((l) => /error/i.test(l.level));
      expect(patterns.some((pat) => lines.some((l) => filterMatches(pat, l))), `${what}: the filter (${patterns.join(' | ')}) matches the line logged (${lines.map((l) => l.message).join(' | ').slice(0, 300)})`).toBe(true);
    }
    const good = resend(w, HR, ID);
    expectStatus(good, 200, 'a good resend');
    expect(patterns.some((pat) => logLines(good).some((l) => filterMatches(pat, l))), 'the filter matches no line of a good resend').toBe(false);
  });

  // -------------------------------------------------------------- AC-8
  test('AC-8 Unknown people: both routes answer 404 Not found, with no invite query, no write and no email', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    const { w } = invited();
    for (const id of ['00000000-0000-4000-8000-000000000000', 'EMP-9999999']) {
      for (const [route, run] of [['GET', getInvite], ['POST', resend]] as const) {
        const r = run(w, HR, id);
        expectStatus(r, 404, `${route} for ${id}`);
        expect(r.body, `${route} ${id}: { error: "Not found" }`).toEqual({ error: 'Not found' });
        expect(dynamoCalls(r).filter((c) => c.table === INVITES).map((c) => c.op), `${route} ${id}: the invite table is not touched`).toEqual([]);
        expect(dynamoCalls(r).filter((c) => WRITES.includes(c.op)).map((c) => `${c.op} ${c.table}`), `${route} ${id}: nothing written`).toEqual([]);
        expect(cognitoCalls(r), `${route} ${id}: no Cognito call`).toEqual([]);
        expect(mails(r), `${route} ${id}: no email`).toEqual([]);
      }
    }
  });

  // -------------------------------------------------------------- AC-9
  test('AC-9 Nothing secret leaves: no token, link or address in logs, tables or answers, and nothing is taken from the request', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    const { w, token: old } = invited();
    // The body, query string and headers all name someone else.
    const decoy = { email: 'mallory@evil.example', employee_id: 'EMP-0000001', hr_staff_name: 'Mallory Mbeki', first_name: 'Mallory' };
    const r = resend(w, HR, ID, { body: decoy, query: { email: decoy.email, employee_id: decoy.employee_id }, headers: { 'x-employee-id': decoy.employee_id, 'x-email': decoy.email } });
    expectStatus(r, 200, 'resend with a body, query and headers naming someone else');
    const mail = mails(r);
    expect(mail, 'one email').toHaveLength(1);
    expect(String(mail[0]!.message.To).toLowerCase(), 'to the saved address, not the body\'s').toBe(EMAIL);
    const text = String(mail[0]!.message.TextBody);
    expect(text, 'the saved HR partner is named').toContain(PARTNER.name);
    expect(text + String(mail[0]!.message.HtmlBody), 'no word from the request').not.toMatch(/Mallory|mallory|evil\.example/);
    expect(text, 'to the saved first name').toContain('Hi Lindiwe.');
    const token = tokenOf(r);
    expect(rowFor(r.world, token)?.['employee_id'], 'the new row is for the path id').toBe(ID);
    expect(invites(r.world).map((x) => x['employee_id']), 'no row for the body\'s id').not.toContain(decoy.employee_id);
    expect(r.body?.sentTo, 'sentTo is the saved address').toBe(EMAIL);

    const g = getInvite(r.world, HR, ID, { body: decoy, query: { email: decoy.email }, headers: { 'x-email': decoy.email } });
    expectStatus(g, 200, 'getInvite with a body, query and headers naming someone else');
    expect(g.body?.sentTo, 'getInvite answers the saved address').toBe(EMAIL);
    expect(Object.keys(g.body).sort(), 'getInvite: only status, sentAt, expiresAt, sentTo').toEqual(['expiresAt', 'sentAt', 'sentTo', 'status']);
    expect(g.raw, 'no token_hash, sent_by or failed_attempts').not.toMatch(/token_hash|sent_by|failed_attempts|ttl/);
    for (const h of [...sha256(token), ...sha256(old)]) expect(g.raw, 'no hash of any token').not.toContain(h);

    // Every log line, table, call and answer of a resend (normal caller), a refused one and a failed send.
    const runs: Array<[string, Run]> = [
      ['a resend', r],
      ['getInvite', g],
      ['a refused resend', resend(withUser(w, EMAIL, (u) => { u.enabled = false; }), HR, ID)],
      ['a failed send', resend({ ...w, postmarkFail: true }, HR, ID)],
      ['a Cognito failure', resend({ ...w, cognitoFail: ['AdminGetUser'] }, HR, ID)],
    ];
    for (const [what, run] of runs) {
      for (const l of logLines(run)) {
        const s = said(l);
        expect(s.toLowerCase(), `${what}: no log line carries the address (${s.slice(0, 200)})`).not.toContain(EMAIL);
        expect(s, `${what}: no log line carries a token or a link`).not.toMatch(new RegExp(`${TOKEN43.source}|set-password#token=`));
        for (const t of [old, token]) expect(s, `${what}: no log line carries a token`).not.toContain(t);
      }
      const tables = JSON.stringify(run.world.tables);
      for (const t of [old, token]) expect(tables, `${what}: no table holds a raw token`).not.toContain(t);
      expect(tables, `${what}: no table holds a link`).not.toContain('set-password#token=');
      const other = run.calls.filter((c) => c.service !== 'postmark' && c.service !== 'log');
      expect(JSON.stringify(other), `${what}: no AWS call carries a token or a link`).not.toMatch(new RegExp(`set-password#token=|${esc(old)}|${esc(token)}`));
      expect(run.raw, `${what}: the answer carries no link (no test login here)`).not.toMatch(/set-password|token=/);
    }
  });

  // -------------------------------------------------------------- AC-10
  test('AC-10 One email, one builder: createEmployee and resendInvite send what inviteEmail() makes, and invite-email.mjs imports no AWS package', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    const shared = join(REPO, 'lambda', 'shared', 'invite-email.mjs');
    expect(existsSync(shared), 'lambda/shared/invite-email.mjs exists').toBe(true);
    const src = readFileSync(shared, 'utf8');
    expect(src, 'it imports no AWS package').not.toMatch(/['"]@aws-sdk\/|['"]@aws-lambda-powertools\/|['"]aws-sdk['"]/);
    expect(src, 'it exports inviteEmail').toMatch(/export\s+(async\s+)?function\s+inviteEmail\b|export\s+const\s+inviteEmail\b|export\s*\{[^}]*\binviteEmail\b/);
    for (const fn of ['createEmployee', 'resendInvite']) {
      const code = readFileSync(join(REPO, 'lambda', fn, 'index.mjs'), 'utf8');
      expect(code, `${fn} imports the shared builder`).toMatch(/from\s+['"]\.\.\/shared\/invite-email\.mjs['"]/);
      for (const own of ['buildInviteEmail', 'buildInviteText', 'footerText', 'leadText']) {
        expect(code, `${fn} no longer defines its own ${own}`).not.toMatch(new RegExp(`function\\s+${own}\\b|const\\s+${own}\\s*=`));
      }
      expect(code, `${fn} writes no subject of its own`).not.toContain('set your password for Naleko People');
    }

    const same = (what: string, msg: any, want: any) => {
      expect(msg.Subject, `${what}: the same subject`).toBe(want.subject);
      expect(msg.HtmlBody, `${what}: the same HTML`).toBe(want.html);
      expect(msg.TextBody, `${what}: the same text`).toBe(want.text);
    };
    const linkOf = (msg: any) => /(http:\/\/localhost:4300\/set-password#token=[A-Za-z0-9_-]{43})/.exec(String(msg.TextBody))![1]!;

    // createEmployee, HR partner chosen.
    const c = create(worldWithPool(), HR, validBody({ hr_staff_id: PARTNER.id }));
    expectStatus(c, 201, 'createEmployee');
    const cm = mails(c)[0]!.message;
    const cRow = invites(c.world)[0]!;
    const ce = inviteEmail({ company: COMPANY, firstName: 'Ayanda', hrName: PARTNER.name, link: linkOf(cm), sentAt: T0, expiresAt: cRow['expires_at'] });
    expect(ce.error, `inviteEmail() runs (${ce.error?.message})`).toBeUndefined();
    same('createEmployee', cm, ce.response);
    expect(Object.keys(ce.response ?? {}).sort(), 'inviteEmail returns { subject, html, text }').toEqual(['html', 'subject', 'text']);

    // resendInvite, saved HR partner.
    const { w } = invited();
    const r = resend(w, HR, ID, { now: at(T0, 600) });
    expectStatus(r, 200, 'resendInvite');
    const rm = mails(r)[0]!.message;
    const re = inviteEmail({ company: COMPANY, firstName: 'Lindiwe', hrName: 'Thandi Nkosi', link: linkOf(rm), sentAt: at(T0, 600), expiresAt: at(T0, 600 + 7 * DAY) });
    same('resendInvite (saved partner)', rm, re.response);

    // resendInvite, no saved partner: the resending HR person.
    const x = invited({ hr_staff_name: '', hr_staff_id: '', hr_staff_email: '' });
    const r2 = resend(x.w, HR, ID, { now: at(T0, 600) });
    expectStatus(r2, 200, 'resendInvite with no saved partner');
    const rm2 = mails(r2)[0]!.message;
    const re2 = inviteEmail({ company: COMPANY, firstName: 'Lindiwe', hrName: 'Jane Smith', link: linkOf(rm2), sentAt: at(T0, 600), expiresAt: at(T0, 600 + 7 * DAY) });
    same('resendInvite (no saved partner)', rm2, re2.response);
    expect(String(rm2.TextBody), 'names the resending HR person').toContain('Sent by Jane Smith');
  });

  // -------------------------------------------------------------- AC-11
  test('AC-11 Terraform and the API description match: two HR routes, two roles with exactly their actions, the KMS list, the settings, the logs and the docs', async ({}, testInfo) => {
    textOnce(testInfo);
    const files = tfFiles();
    const res = (type: string) => blocks(files, 'resource').filter((b) => b.labels[0] === type);
    const attr = (b: { body: string }, name: string) => new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, 'm').exec(b.body)?.[1]?.trim().replace(/\s+/g, '') ?? '';
    const flat = (s: Statement | Statement[]) => (Array.isArray(s) ? s : [s]).flatMap((st) => {
      const actions = ([] as string[]).concat((st.Action as string | string[] | undefined) ?? []);
      const resources = ([] as string[]).concat((st.Resource as string | string[] | undefined) ?? []);
      return actions.flatMap((action) => resources.map((resource) => ({ effect: st.Effect, action, resource: resource.replace(/\$\{([^}]+)\}/g, '$1') })));
    });
    const ordinary = (a: string) => !a.startsWith('logs:') && !a.startsWith('xray:');
    const T = res('aws_dynamodb_table').find((b) => attr(b, 'name') === `"${INVITES}"`)?.labels[1] ?? INVITES;
    const isTable = (r: string) => r === `arn:aws:dynamodb:af-south-1:000000000000:table/${INVITES}` || r === `aws_dynamodb_table.${T}.arn`;
    const isIndex = (r: string) => r === `arn:aws:dynamodb:af-south-1:000000000000:table/${INVITES}/index/employee-index` || r === `aws_dynamodb_table.${T}.arn/index/employee-index`;
    const isEmployees = (r: string) => r === 'arn:aws:dynamodb:af-south-1:000000000000:table/employees' || r === 'aws_dynamodb_table.employees.arn';
    const isPool = (r: string) => /^arn:aws:cognito-idp:af-south-1:000000000000:userpool\/aws_cognito_user_pool\.naleko_dev\.id$/.test(r) || r === 'aws_cognito_user_pool.naleko_dev.arn';

    const NEW = [
      { fn: 'getInvite', route: 'GET /v1/employees/{id}/invite', want: [['dynamodb:GetItem', isEmployees], ['dynamodb:Query', isIndex]] as const },
      {
        fn: 'resendInvite', route: 'POST /v1/employees/{id}/invite',
        want: [
          ['dynamodb:GetItem', isEmployees], ['dynamodb:Query', isIndex], ['dynamodb:PutItem', isTable], ['dynamodb:UpdateItem', isTable],
          ['cognito-idp:AdminCreateUser', isPool], ['cognito-idp:AdminAddUserToGroup', isPool], ['cognito-idp:AdminGetUser', isPool], ['cognito-idp:AdminListGroupsForUser', isPool],
        ] as const,
      },
    ];
    const stage = res('aws_apigatewayv2_stage').find((b) => b.labels[1] === 'employees_api_default');
    expect(stage, 'the employees API stage').toBeTruthy();
    // A route key holds {id}, so a block may hold one pair of braces inside it.
    const routeSettings = [...stage!.body.matchAll(/route_settings\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)].map((m) => m[1]!);
    const roles: string[] = [];
    for (const n of NEW) {
      expect(existsSync(join(REPO, 'lambda', n.fn, 'index.mjs')), `lambda/${n.fn}/index.mjs exists`).toBe(true);
      expect(existsSync(join(REPO, 'lambda', n.fn, 'package.json')), `lambda/${n.fn}/package.json exists (the build ships every folder that has one)`).toBe(true);
      const fn = res('aws_lambda_function').find((b) => attr(b, 'function_name') === `"${n.fn}"`);
      expect(fn, `a Terraform function named ${n.fn}`).toBeTruthy();
      expect(attr(fn!, 'handler'), `${n.fn}: handler`).toBe('"index.handler"');
      expect(attr(fn!, 'runtime'), `${n.fn}: runtime`).toBe('"nodejs22.x"');
      expect(fn!.body, `${n.fn}: X-Ray on`).toMatch(/tracing_config\s*\{\s*mode\s*=\s*"Active"/);
      expect(fn!.body, `${n.fn}: ignore_changes for code`).toMatch(/ignore_changes\s*=\s*\[[^\]]*filename/);
      const roleRef = /aws_iam_role\.(\w+)\.arn/.exec(attr(fn!, 'role'));
      expect(roleRef, `${n.fn}: a role of its own`).toBeTruthy();
      roles.push(roleRef![1]!);
      expect(res('aws_lambda_function').filter((b) => attr(b, 'role') === attr(fn!, 'role')).map((b) => attr(b, 'function_name')), `${n.fn}: the role is used by this function only`).toEqual([`"${n.fn}"`]);
      const policies = res('aws_iam_role_policy').filter((b) => attr(b, 'role') === `aws_iam_role.${roleRef![1]}.name` || attr(b, 'role') === `aws_iam_role.${roleRef![1]}.id`);
      expect(policies, `${n.fn}: one inline policy`).toHaveLength(1);
      expect(res('aws_iam_role_policy_attachment').filter((b) => attr(b, 'role').includes(`aws_iam_role.${roleRef![1]}.`)), `${n.fn}: no attached managed policy`).toEqual([]);
      const rows = flat(policyOf(resourcesNamed('aws_iam_role_policy', policies[0]!.labels[1]!)[0]!).Statement);
      expect(rows.every((r) => r.effect === 'Allow'), `${n.fn}: Allow only`).toBe(true);
      for (const r of rows) {
        expect(r.action, `${n.fn}: no wildcard action (${r.action})`).not.toMatch(/\*/);
        if (r.resource === '*') expect(r.action, `${n.fn}: Resource "*" only for X-Ray`).toMatch(/^xray:/);
      }
      expect(rows.filter((r) => r.action.startsWith('logs:')).every((r) => r.resource.includes(`/aws/lambda/${n.fn}`)), `${n.fn}: logs only into its own group`).toBe(true);
      // TEN-02 (re-lock): the company grants (Member rows on the tenants table) are TEN-02's, not this card's.
      const reaches = tablesIn(rows.filter((r) => !/tenant-index/.test(r.resource)).map((r) => r.resource));
      const extra = rows.filter((r) => ordinary(r.action) && !tenancyGrant(r.action, r.resource, reaches, n.fn === 'resendInvite'));
      for (const [action, on] of n.want) expect(extra.some((r) => r.action === action && on(r.resource)), `${n.fn}: may ${action} on the right resource`).toBe(true);
      expect(extra.filter((r) => !n.want.some(([action, on]) => r.action === action && on(r.resource))).map((r) => `${r.action} ${r.resource}`), `${n.fn}: nothing else (no AdminSetUserPassword)`).toEqual([]);

      const route = res('aws_apigatewayv2_route').find((b) => attr(b, 'route_key') === `"${n.route}"`.replace(/\s+/g, ''));
      expect(route, `a route ${n.route}`).toBeTruthy();
      expect(attr(route!, 'api_id'), `${n.route}: on the employees API`).toBe('aws_apigatewayv2_api.employees_api.id');
      expect(attr(route!, 'authorization_type'), `${n.route}: JWT`).toBe('"JWT"');
      expect(attr(route!, 'authorizer_id'), `${n.route}: the employees API's Cognito authorizer`).toBe('aws_apigatewayv2_authorizer.employees_api_cognito.id');
      const integration = /aws_apigatewayv2_integration\.(\w+)\.id/.exec(attr(route!, 'target'));
      const ib = res('aws_apigatewayv2_integration').find((b) => b.labels[1] === integration?.[1]);
      expect(ib, `${n.route}: has an integration`).toBeTruthy();
      expect(attr(ib!, 'integration_uri'), `${n.route}: calls ${n.fn}`).toContain(`aws_lambda_function.${fn!.labels[1]}.invoke_arn`);
      const perm = res('aws_lambda_permission').find((b) => attr(b, 'function_name').includes(`aws_lambda_function.${fn!.labels[1]}.`));
      expect(perm, `${n.fn}: API Gateway may invoke it`).toBeTruthy();
      expect(attr(perm!, 'principal'), 'principal').toBe('"apigateway.amazonaws.com"');
      if (n.fn === 'resendInvite') {
        const limit = routeSettings.find((s) => new RegExp(`route_key\\s*=\\s*"${esc(n.route)}"`).test(s));
        expect(limit, `${n.route}: has its own route settings on the stage`).toBeTruthy();
        expect(limit, `${n.route}: burst 10`).toMatch(/throttling_burst_limit\s*=\s*10\b/);
        expect(limit, `${n.route}: 5 per second`).toMatch(/throttling_rate_limit\s*=\s*5\b/);
      }
    }

    // KMS: both roles read through DynamoDB only.
    const kms = blocks(files, 'module').find((b) => b.labels[0] === 'kms_pii');
    expect(kms, 'module kms_pii').toBeTruthy();
    const list = (name: string) => /\[([^\]]*)\]/.exec(new RegExp(`${name}\\s*=\\s*\\[[^\\]]*\\]`).exec(kms!.body)?.[0] ?? '')?.[1] ?? '';
    for (const role of roles) {
      expect(list('dynamodb_read_role_arns'), `${role} is in kms_pii dynamodb_read_role_arns`).toContain(`aws_iam_role.${role}.arn`);
      expect(list('allowed_role_arns'), `${role} is not in allowed_role_arns`).not.toContain(`aws_iam_role.${role}.arn`);
    }

    // Settings: what each reads is set; INVITE_TEST_LINK on resendInvite only, and true on pepla-dev only.
    const variables = blocks(files, 'variable');
    const dev = stripComments(readFileSync(join(REPO, 'infra', 'env', 'dev.tfvars'), 'utf8'));
    const tfvar = (name: string) => new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, 'm').exec(dev)?.[1]?.trim();
    const defaultOf = (name: string) => /default\s*=\s*(.+)/.exec(variables.find((v) => v.labels[0] === name)?.body ?? '')?.[1]?.trim();
    const sourceOf = (fn: string) => {
      const own = readFileSync(join(REPO, 'lambda', fn, 'index.mjs'), 'utf8');
      // resendInvite's settings include the helpers it calls (issueInvite reads APP_URL and COGNITO_POOL_ID);
      // getInvite only reads rows, so it is judged on its own code.
      if (fn === 'getInvite') return own;
      const sharedFiles = [...own.matchAll(/from\s+['"]\.\.\/shared\/([\w.-]+)['"]/g)].map((m) => join(REPO, 'lambda', 'shared', m[1]!)).filter(existsSync);
      return [own, ...sharedFiles.map((f) => readFileSync(f, 'utf8'))].join('\n');
    };
    const envOf = (fn: string) => {
      const b = res('aws_lambda_function').find((x) => attr(x, 'function_name') === `"${fn}"`);
      return /environment\s*\{\s*variables\s*=\s*\{([\s\S]*?)\}\s*\}/.exec(b?.body ?? '')?.[1] ?? '';
    };
    for (const n of NEW) {
      const src = sourceOf(n.fn);
      const env = envOf(n.fn);
      if (/COMPANY_NAME/.test(src)) expect(env, `${n.fn} reads COMPANY_NAME, so it is set from var.company_name`).toMatch(/COMPANY_NAME\s*=\s*var\.company_name\b/);
      if (/APP_URL/.test(src)) expect(env, `${n.fn} reads APP_URL, so it is set from var.app_url`).toMatch(/APP_URL\s*=\s*var\.app_url\b/);
      if (/COGNITO_POOL_ID/.test(src)) expect(env, `${n.fn} reads COGNITO_POOL_ID, so it is set`).toMatch(/COGNITO_POOL_ID\s*=/);
      for (const name of ['POSTMARK_API_TOKEN', 'POSTMARK_SENDER_EMAIL']) {
        if (n.fn === 'getInvite') expect(env, `getInvite: no ${name}`).not.toMatch(new RegExp(`${name}\\s*=`));
        else expect(env, `resendInvite: ${name} is set`).toMatch(new RegExp(`${name}\\s*=`));
      }
    }
    expect(envOf('getInvite'), 'getInvite: no INVITE_TEST_LINK').not.toMatch(/INVITE_TEST_LINK/);
    const flag = /INVITE_TEST_LINK\s*=\s*(.+)/.exec(envOf('resendInvite'))?.[1]?.trim() ?? '';
    expect(flag, 'resendInvite has INVITE_TEST_LINK').not.toBe('');
    const byEnv = /^var\.environment\s*==\s*"dev"\s*\?\s*"true"\s*:\s*"false"$/.test(flag);
    const byVar = /^(?:tostring\()?var\.(\w+)\)?$/.exec(flag);
    expect(byEnv || !!byVar, `INVITE_TEST_LINK is var.environment == "dev" ? "true" : "false", or a variable (got ${flag})`).toBe(true);
    if (byVar) {
      expect(String(defaultOf(byVar[1]!) ?? ''), `var.${byVar[1]}: prod default is not true`).toMatch(/^(false|"false")$/);
      expect(String(tfvar(byVar[1]!) ?? ''), `dev.tfvars sets ${byVar[1]} to true`).toMatch(/^(true|"true")$/);
    }

    // Log groups and dashboards: every list that names createEmployee names both.
    for (const file of ['cloudwatch.tf', 'dashboards.tf']) {
      const text = stripComments(readFileSync(join(REPO, 'infra', file), 'utf8'));
      const named = (l: string, name: string) => new RegExp(`"(/aws/lambda/)?${name}"`).test(l);
      const lists = [...text.matchAll(/\[[^\[\]]*\]/g)].map((m) => m[0]).filter((l) => named(l, 'createEmployee'));
      expect(lists.length, `infra/${file} has a list naming createEmployee`).toBeGreaterThan(0);
      for (const n of NEW) for (const l of lists) expect(named(l, n.fn), `infra/${file}: every list that names createEmployee names ${n.fn}`).toBe(true);
    }

    // No table, Cognito or KMS resource moved, removed or replaced; no new table.
    const whole = files.map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n');
    const moves = [...whole.matchAll(/^\s*(moved|removed)\s*\{[^}]*\}/gm)].map((m) => m[0]);
    expect(moves.filter((m) => /aws_dynamodb_table|cognito|kms|get_invite|resend_invite/i.test(m)), 'no moved or removed block touches a table, Cognito, KMS or this card').toEqual([]);
    // No new table: OPS-05 AC-7 (locked) counts all 25.
    expect(kms!.body, 'the KMS module keeps its source').toMatch(/source\s*=\s*"\.\/modules\/kms"/);
    expect(kms!.body, 'and its alias').toMatch(/alias_name\s*=\s*"naleko-onboarding-pii"/);

    // The cleanup still removes every invite row of a cleaned person (all pages of the index query).
    const cleanup = readFileSync(join(REPO, 'scripts', 'ci', 'cleanup-dev-e2e.py'), 'utf8');
    expect(cleanup, 'cleanup-dev-e2e.py pages through employee-index on the invite table').toMatch(/get_paginator\("query"\)\.paginate\(\s*TableName="employee_invites",\s*IndexName="employee-index"/);

    // The API description, in both copies.
    for (const spec of [join(REPO, 'api', 'openapi.yaml'), join(REPO, 'lambda', 'serveDocs', 'spec.yaml')]) {
      const route = (p: string, m: string) => JSON.parse(execFileSync('python3', [join(__dirname, 'support', 'onb-15', 'openapi_route.py'), spec, p, m], { encoding: 'utf8' })) as { found: boolean; responses: string[]; fields: Record<string, string[]>; request: string[] };
      const where = spec.includes('serveDocs') ? 'serveDocs/spec.yaml' : 'api/openapi.yaml';
      const g = route('/v1/employees/{id}/invite', 'get');
      expect(g.found, `${where}: GET /v1/employees/{id}/invite`).toBe(true);
      expect(g.responses, `${where}: GET 200, 403 and 404`).toEqual(expect.arrayContaining(['200', '403', '404']));
      expect(g.fields['200'], `${where}: GET 200 fields`).toEqual(expect.arrayContaining(['status', 'sentAt', 'expiresAt', 'sentTo']));
      for (const f of ['token_hash', 'sent_by', 'failed_attempts']) expect(g.fields['200'], `${where}: GET 200 has no ${f}`).not.toContain(f);
      const p = route('/v1/employees/{id}/invite', 'post');
      expect(p.found, `${where}: POST /v1/employees/{id}/invite`).toBe(true);
      expect(p.responses, `${where}: POST 200, 403, 404, 409 and 502`).toEqual(expect.arrayContaining(['200', '403', '404', '409', '502']));
      expect(p.fields['200'], `${where}: POST 200 fields`).toEqual(expect.arrayContaining(['status', 'sentAt', 'expiresAt', 'sentTo', 'email']));
      expect(p.request, `${where}: POST takes no body fields`).toEqual([]);
    }
  });

  // -------------------------------------------------------------- AC-12 (pepla-dev)
  test('AC-12 pepla-dev: HR registers a test address, resends, the first link closes, the second works once, then a resend is refused @pepla-dev', async ({ page, signIn, hr }, testInfo) => {
    test.skip(!ON_DEV, 'Runs on pepla-dev only: the other criteria hold the rest in the no-backend run.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'Runs once, at one width.');
    test.setTimeout(180_000);
    const { api } = devEnv();
    const token = await signInForToken(page, signIn, hr);
    const auth = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const email = `e2e.run-onb18-${Date.now()}-${Math.floor(Math.random() * 1e4)}@blackhole.postmarkapp.com`;
    const created = await page.request.post(`${api}/v1/employees`, {
      headers: auth,
      data: { first_name: 'Zanele', last_name: 'Resend', email, phone: '082 000 0000', department: 'Operations', job_title: 'Test starter', planned_start_date: '2026-12-01' },
    });
    expect(created.status(), 'POST /v1/employees: 201').toBe(201);
    const c = (await created.json()) as { employee?: { employee_id?: string }; invite?: { link?: string } };
    const id = String(c.employee?.employee_id ?? '');
    const first = /\/set-password#token=([A-Za-z0-9_-]{43})$/.exec(c.invite?.link ?? '')?.[1];
    expect(first, 'the first invite.link').toBeTruthy();

    const post = await page.request.post(`${api}/v1/employees/${encodeURIComponent(id)}/invite`, { headers: { Authorization: `Bearer ${token}` } });
    expect(post.status(), 'POST /v1/employees/{id}/invite: 200').toBe(200);
    const r = (await post.json()) as { status?: string; sentTo?: string; email?: { sent?: boolean; skipped?: string }; invite?: { link?: string } };
    expect(r.status).toBe('ok');
    expect(r.email, 'email { sent: false, skipped: "test" }').toEqual({ sent: false, skipped: 'test' });
    const second = /\/set-password#token=([A-Za-z0-9_-]{43})$/.exec(r.invite?.link ?? '')?.[1];
    expect(second, 'a new invite.link').toBeTruthy();
    expect(second).not.toBe(first);

    const look = async (t: string) => {
      const x = await page.request.post(`${api}/v1/invites/lookup`, { headers: { 'content-type': 'application/json' }, data: { token: t } });
      expect(x.status(), 'lookup: 200').toBe(200);
      return ((await x.json()) as { status: string }).status;
    };
    expect(await look(first!), 'the first link says expired').toBe('expired');
    expect(await look(second!), 'the second says ok').toBe('ok');
    const g = await page.request.get(`${api}/v1/employees/${encodeURIComponent(id)}/invite`, { headers: { Authorization: `Bearer ${token}` } });
    expect(g.status(), 'GET /v1/employees/{id}/invite: 200').toBe(200);
    const gb = (await g.json()) as { status?: string; sentTo?: string };
    expect(gb.status, 'GET says ok').toBe('ok');
    expect(gb.sentTo, 'to the test address').toBe(email);

    const password = `Dev-${Math.random().toString(36).slice(2, 10)}-Aa9!`;
    const set = await page.request.post(`${api}/v1/invites/redeem`, { headers: { 'content-type': 'application/json' }, data: { token: second, password } });
    expect(set.status(), 'redeem of the second link: 204').toBe(204);
    const again = await page.request.post(`${api}/v1/employees/${encodeURIComponent(id)}/invite`, { headers: { Authorization: `Bearer ${token}` } });
    expect(again.status(), 'a resend after the password is set: 409').toBe(409);
    expect(((await again.json()) as { status?: string }).status, 'refused').toBe('refused');
    // scripts/ci/cleanup-dev-e2e.py removes the employee, every invite row and the sign-in after the run.
  });

  // -------------------------------------------------------------- AC-13
  test('AC-13 Phone: at 390 wide the card, both rows, the line and Resend link are visible, clear of the top bar, nothing wider than the screen, a 44-pixel button', async ({ page, signIn, hr, docs, inv }, testInfo) => {
    noBackendOnly();
    test.skip(testInfo.project.name !== 'phone-390', 'The phone criterion: 390 wide.');
    const p = ayanda();
    docs!.add(p);
    inv!.set(p.employee.employee_id, okState(p.employee.email));
    await openPerson(page, signIn, hr, p.employee.employee_id);
    await expectCard(page, 'Ayanda', p.employee.email, SENT.shown, EXPIRES.shown);
    for (const l of [cardHeading(page), card(page).getByText(WORDS.sentLabel, { exact: true }), card(page).getByText(WORDS.expiresLabel, { exact: true }), card(page).getByText(WORDS.resendLine), resendButton(page)]) {
      await l.scrollIntoViewIfNeeded();
      await expect(l).toBeVisible();
    }
    expect(await hiddenOrCovered(card(page)), 'every part of the card is on screen and not under the top bar').toEqual([]);
    expect(await noSidewaysScroll(page), 'nothing is wider than the screen').toEqual([]);
    const bb = (await resendButton(page).boundingBox())!;
    expect(bb.height, 'Resend link is at least 44 pixels tall').toBeGreaterThanOrEqual(44);
    const box = (await card(page).boundingBox())!;
    expect(box.x, 'the card starts on screen').toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, 'and ends on screen').toBeLessThanOrEqual(390.5);
  });
});
