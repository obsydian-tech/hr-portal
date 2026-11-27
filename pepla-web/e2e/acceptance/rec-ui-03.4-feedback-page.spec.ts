import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { ON_DEV, avatarButton, type SignInPage } from './support/fixtures';
import type { CognitoFake } from './support/cognito-fake';
import type { ModulesFake } from './support/mod-02/modules-fake';
import { COMPANY_ID, iso, quiet, signInAs, type HireFake, type Who } from './support/rec-ui/harness';
import { forgetSignIn } from './support/sign-in-again';
import { DECISIONS, DEFAULT_CRITERIA, SCALE, radioTexts, sliderTexts, type Snapshot } from './support/rec-ui-03/capture';
import { KIT } from './support/rec-ui-03/kit';
import { OW, P, expect, test, type OwnFake, type OwnIv, type Requests } from './support/rec-ui-03/own';

/**
 * REC-UI-03 step 4 · The panel member's own feedback page `/hire/feedback/:interviewId` (Jira NH-292, red: a signed-in page for any
 * panel member, an Employee included). Lock acceptance-lock/rec-ui-03.4 (one commit on develop 83e606c).
 * Spec: onboarding-cards/specs/REC-UI-03-next-slices.md, "Step 4" (rules 1 to 7, AC-4.1 to AC-4.9) and the dev seed table;
 * decisions D-RUI-03.13, .14, .15 and .20. The server read is step 3's `GET /v1/interviews/{id}` (PR 560) and the vote is REC-07's
 * `POST /v1/interviews/{id}/votes`; the fake answers as both do on develop (support/rec-ui-03/own.ts). Where the spec is silent,
 * cards/rec-ui-03.4.md says what these tests take (T-P1 up).
 *
 * Every test runs at 1280 and 390 wide unless it says why not. Page time is 19 Nov 2026 10:00 in Johannesburg (08:00 UTC).
 * AC-4.9 runs on pepla-dev only. No test calls Bedrock or any paid AI.
 */

const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs the fake API.');
const phone = () => test.info().project.name === 'phone-390';
const once = (why: string) => test.skip(phone(), `Once, at 1280: ${why}`);

type Fx = { page: Page; signIn: SignInPage; cognito: CognitoFake | null; modules: ModulesFake | null; hire: HireFake | null; own: OwnFake | null; requests: Requests; appOrigin: string };

/** A time on a November 2026 day, given in Johannesburg hours. */
const sast = (day: number, hh: number, mm = 0) => iso(Date.UTC(2026, 10, day, hh - 2, mm));
/** This interview's own criteria (never the company's default set). */
const SNAP: Snapshot = [{ key: 'forklift_safety', label: 'Forklift safety' }, { key: 'route_planning', label: 'Route planning' }, { key: 'customer_care', label: 'Talks to customers' }];
const SNAP2: Snapshot = [{ key: 'teamwork', label: 'Teamwork' }, { key: 'reliability', label: 'Reliability' }];
const IV = 'iv-own-1';
const TITLE = OW.title('Bongani', 'Mthembu');
const LINE = 'Fleet controller · Technical interview on 18 Nov 2026';
/** People on the panels who are not test logins: their names and votes must never reach the page. */
const LERATO = 'lerato.mokoena@sunbird-bakery.co.za';
const THABO = 'thabo.khumalo@sunbird-bakery.co.za';
const A_WORDS = ['Bongani', 'Mthembu', 'Fleet controller', 'Forklift safety', 'Route planning', 'Talks to customers', '18 Nov 2026'];
const NEVER_WORDS = /Masked|average|Passed|out of 10|Scores are advice|decides|Feedback from|Captured by/i;
const BAD_WORDS = /\b(null|undefined|NaN)\b|Invalid Date|\[object Object\]|\b(NOT_STARTED|ALREADY_SCORED|ALREADY_DONE|NOT_ALLOWED_NOW|INVALID_SCORES|INVALID_FIELD|STRONG_YES|STRONG_NO|GIVEN|WAITING|CLOSED|forklift_safety|route_planning|customer_care)\b/;

/** Started yesterday 09:00, Technical, Bongani Mthembu for Fleet controller; the three logins of AC-4.1 waiting, Lerato has voted. */
function base(fx: Fx, extra: Partial<OwnIv> = {}): OwnIv {
  return fx.own!.put({
    id: IV, company: 'A', first: 'Bongani', last: 'Mthembu', role: 'Fleet controller', type: 'TECHNICAL', at: sast(18, 9), status: 'SCHEDULED', snapshot: SNAP,
    panel: [P.employee.email, P.manager.email, P.hr.email, LERATO, THABO],
    votes: new Map([[LERATO, { scores: { forklift_safety: 2, route_planning: 2, customer_care: 1 }, rating: 'STRONG_NO', comment: 'Lerato-only remark' }]]),
    secret: { candidate_email: 'bongani.mthembu@example.test', phone: '082 555 0199' },
    ...extra,
  });
}

/** Signs `who` in at /sign-in and waits for their first page. */
async function signedIn(fx: Fx, who: Who): Promise<void> {
  await signInAs(fx.signIn, fx.cognito, fx.modules, fx.hire, who);
  await expect(fx.page).toHaveURL(who.lands!);
  // The first page's own reads (an Employee's /start asks GET /v1/me) finish before a test counts this page's calls.
  await quiet(fx.page);
}
const heading = (page: Page) => page.getByRole('heading', { level: 1 });
const sliders = (page: Page) => page.getByRole('slider');
const radios = (page: Page) => page.getByRole('radio');
const notes = (page: Page) => page.getByRole('textbox', { name: /^Notes/ });
const submit = (page: Page) => page.getByRole('button', { name: OW.submit, exact: true });
const cancel = (page: Page) => page.getByRole('button', { name: OW.cancel, exact: true });
const danger = (page: Page) => page.locator('.pp-section-message--danger');
const body = (page: Page) => page.locator('body');
/** The page has settled on one of its states: a heading with words, or the not-found or load-failure line. */
async function settled(page: Page): Promise<void> {
  await expect(heading(page).filter({ hasText: /\S/ }).or(page.getByText(OW.notFound, { exact: true })).or(page.getByText(OW.loadFailed, { exact: true })).first()).toBeVisible();
  await expect(page.locator('.pp-skeleton')).toHaveCount(0);
}
/** Opens the address with a page load, as the invite email's link does. */
async function open(page: Page, id = IV): Promise<void> {
  await page.goto(`/hire/feedback/${encodeURIComponent(id)}`);
  await settled(page);
}
/** Signs `who` in, then opens the address. */
async function as(fx: Fx, who: Who, id = IV): Promise<void> {
  await signedIn(fx, who);
  await open(fx.page, id);
}
async function setScore(page: Page, label: string, value: number): Promise<void> {
  await page.getByRole('slider', { name: label, exact: true }).fill(String(value));
}
async function decide(page: Page, label: string): Promise<void> {
  const i = DECISIONS.findIndex((d) => d.label === label);
  await radios(page).nth(i).check({ force: true });
  await expect(radios(page).nth(i)).toBeChecked();
}
async function fill(page: Page, scores: number[], decision: string, criteria: Snapshot = SNAP, text?: string): Promise<void> {
  for (const [i, c] of criteria.entries()) await setScore(page, c.label, scores[i]!);
  await decide(page, decision);
  if (text !== undefined) await notes(page).fill(text);
}
/** What the form holds now. */
async function held(page: Page): Promise<{ values: string[]; decision: string | null; notes: string }> {
  const values = await sliders(page).evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  const r = await radioTexts(body(page));
  return { values, decision: r.find((x) => x.checked)?.label ?? null, notes: await notes(page).inputValue() };
}
/** The visible lines of the page, trimmed, empty ones left out. */
async function lines(page: Page): Promise<string[]> {
  return (await body(page).innerText()).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
/** The logo's own words (pp-logo draws "Naleko People" and, by its style, "by Naleko"): the design system's, not this page's. */
const LOGO = /^(Naleko|People|Naleko People|(Naleko People ?)?by Naleko)$/i;
const shown = (page: Page) => lines(page).then((ls) => ls.filter((l) => !LOGO.test(l)));
const noForm = async (page: Page) => {
  await expect(sliders(page)).toHaveCount(0);
  await expect(radios(page)).toHaveCount(0);
  await expect(submit(page)).toHaveCount(0);
  await expect(notes(page)).toHaveCount(0);
};
const isOff = (l: Locator) => l.evaluate((el) => (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true');
/** The in-app jump the app makes for a link (no page load). */
const inApp = (page: Page, path: string) => page.evaluate((x) => { history.pushState({}, '', x); dispatchEvent(new PopStateEvent('popstate', { state: {} })); }, path);
const bodyOf = (c: { body: unknown }) => c.body as Record<string, unknown>;
/** The calls to any API since `from`, the guard's one modules read left out (it is not this page's). */
const apiOf = (fx: Fx, from: number) => fx.requests.apiSince(from, fx.appOrigin).filter((c) => c !== 'GET /v1/company/modules');

// ================================================================ AC-4.1 The page and its frame
test.describe('AC-4.1 The page and its frame', () => {
  test.beforeEach(noBackendOnly);

  for (const [kind, key] of [['an Employee', 'employee'], ['a hiring manager', 'manager'], ['HR', 'hr']] as const) {
    test(`AC-4.1 For a panel member who is ${kind}: the title, the role and interview line, one slider per criterion of the answer in its order, the four Decision tiles with their helper lines, Notes "(optional)", "Submit feedback" (off) and Cancel; no "Feedback from" picker, no "decides" line, nothing preselected; no null, undefined, NaN, Invalid Date or code`, async ({ page, signIn, cognito, modules, hire, own, requests, appOrigin }) => {
      const fx: Fx = { page, signIn, cognito, modules, hire, own, requests, appOrigin };
      base(fx);
      await as(fx, P[key]);
      await expect(heading(page)).toHaveText(TITLE);
      await expect(page.getByText(LINE, { exact: true })).toBeVisible();
      const s = await sliderTexts(body(page));
      expect(s.map((x) => x.label), 'one slider per criterion of the answer, in its order').toEqual(SNAP.map((c) => c.label));
      for (const x of s) expect([x.min, x.max, x.step], `${x.label}: 1 to 5 in steps of 1`).toEqual(['1', '5', '1']);
      expect(await radioTexts(body(page)), 'the four Decisions in order with their helper lines, none chosen').toEqual(DECISIONS.map((d) => ({ label: d.label, help: d.help, checked: false })));
      await expect(page.getByText(OW.decision, { exact: true })).toBeVisible();
      await expect(notes(page)).toBeVisible();
      await expect(notes(page)).toHaveValue('');
      await expect(page.getByText(OW.optional, { exact: true })).toBeVisible();
      await expect(submit(page)).toBeVisible();
      expect(await isOff(submit(page)), 'Submit is off until everything is set').toBe(true);
      await expect(cancel(page)).toBeVisible();
      await expect(page.getByRole('combobox')).toHaveCount(0);
      await expect(page.locator('select')).toHaveCount(0);
      const text = await body(page).innerText();
      expect(text).not.toMatch(NEVER_WORDS);
      expect(text).not.toMatch(BAD_WORDS);
      // Only the caller's own interview: nobody else on the panel, no vote of theirs, nothing the store keeps for HR.
      const html = await page.content();
      for (const v of ['Lerato', 'Mokoena', 'Thabo', 'Khumalo', 'Lerato-only remark', 'bongani.mthembu@example.test', '082 555 0199', COMPANY_ID.A, LERATO]) {
        expect(text, `the page shows no "${v}"`).not.toContain(v);
        expect(html, `the page holds no "${v}"`).not.toContain(v);
      }
    });
  }

  for (const [kind, key] of [['an Employee', 'employee'], ['a hiring manager', 'manager'], ['HR', 'hr']] as const) {
    test(`AC-4.1 The frame is the guest page's for ${kind}: the word mark "Naleko People", and no sidebar, top navigation, account menu, Modules button, Ask Batsi button or panel, no text "HR", no link to /hr, and no call to Ask Batsi, HR home or anything but the interview read`, async ({ page, signIn, cognito, modules, hire, own, requests, appOrigin }) => {
      const fx: Fx = { page, signIn, cognito, modules, hire, own, requests, appOrigin };
      base(fx);
      await signedIn(fx, P[key]);
      const from = requests.mark;
      await open(page);
      await expect(heading(page)).toHaveText(TITLE);
      await quiet(page);
      const logo = page.locator('.pp-sign-in .pp-logo');
      await expect(logo).toBeVisible();
      expect((await logo.innerText()).replace(/\s+/g, ' '), 'the word mark').toMatch(/Naleko\s*People/i);
      await expect(page.locator('.pp-sign-in')).toHaveCount(1);
      for (const name of ['Modules', 'Ask Batsi', 'Open menu', 'Close Ask Batsi']) await expect(page.getByRole('button', { name, exact: true }), name).toHaveCount(0);
      await expect(avatarButton(page), 'no account menu').toHaveCount(0);
      await expect(page.getByRole('button', { name: /^Notifications/ })).toHaveCount(0);
      await expect(page.getByRole('navigation')).toHaveCount(0);
      await expect(page.getByRole('searchbox')).toHaveCount(0);
      expect(await page.locator('.pp-app-shell, .pp-side-navigation, .pp-top-navigation, .pp-avatar, pp-app-shell, pp-side-navigation, pp-top-navigation, app-hr-shell, app-employee-shell, app-admin-shell').count(), 'no shell part').toBe(0);
      expect(await page.locator('[class*="assistant"], [class*="batsi"], app-assistant-panel').count(), 'no Ask Batsi panel').toBe(0);
      expect(await body(page).innerText(), 'no text "HR"').not.toMatch(/\bHR\b/);
      const hrefs = await page.locator('a[href]').evaluateAll((as) => as.map((a) => new URL((a as HTMLAnchorElement).href).pathname));
      expect(hrefs.filter((h) => h === '/hr' || h.startsWith('/hr/')), 'no link to /hr').toEqual([]);
      expect(apiOf(fx, from), 'the only call is the interview read').toEqual([`GET /v1/interviews/${IV}`]);
    });
  }
});

// ================================================================ AC-4.2 Who
test.describe('AC-4.2 Who', () => {
  test.beforeEach(noBackendOnly);

  test('AC-4.2 An Employee on the panel opens the page; the same login still cannot open /hire/roles, /hire/candidates or /hire/offers (each sends them to /start, as today) and none of those reads is made', async ({ page, signIn, cognito, modules, hire, own, requests, appOrigin }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, own, requests, appOrigin };
    base(fx);
    await as(fx, P.employee);
    await expect(heading(page)).toHaveText(TITLE);
    const from = requests.mark;
    for (const path of ['/hire/roles', '/hire/candidates', '/hire/offers', '/hire']) {
      await page.goto(path);
      await expect(page, `${path} sends an Employee to /start`).toHaveURL(/\/start$/);
    }
    await quiet(page);
    expect(apiOf(fx, from).filter((c) => /\/v1\/(roles|candidates|offers|hiring-managers)/.test(c)), 'no recruitment list was read').toEqual([]);
  });

  for (const [kind, key] of [['an Employee', 'employee'], ['a hiring manager', 'manager'], ['HR', 'hr']] as const) {
    test(`AC-4.2 Signed out, the address goes to sign-in with the address to come back to; ${kind} signs in and lands back on it, with the form`, async ({ page, signIn, cognito, modules, hire, own, requests, appOrigin }) => {
      const fx: Fx = { page, signIn, cognito, modules, hire, own, requests, appOrigin };
      base(fx);
      const who = P[key];
      if (cognito!.subOf(who.email) === undefined) cognito!.addAccount(who);
      modules!.assign(who.email, who.company);
      hire!.assign(who);
      await page.goto(`/hire/feedback/${IV}`);
      await expect(page, 'signed out: to sign-in, with the way back').toHaveURL(`/sign-in?returnUrl=${encodeURIComponent(`/hire/feedback/${IV}`)}`);
      expect(own!.gets, 'no read while signed out').toHaveLength(0);
      await signIn.signInAs(who);
      await expect(page).toHaveURL(`/hire/feedback/${IV}`);
      await settled(page);
      await expect(heading(page)).toHaveText(TITLE);
      await expect(sliders(page)).toHaveCount(SNAP.length);
    });
  }

  for (const [kind, key, lands] of [['an Employee', 'employee', /\/start$/], ['HR', 'hr', /\/hr(\/[\w/-]*)?$/]] as const) {
    test(`AC-4.2 (T-P2) Only an address of exactly this page is followed after sign-in: for ${kind}, a return address that leaves the page, the app or the site lands where it does today`, async ({ page, signIn, cognito, modules, hire, own, requests, appOrigin }) => {
      test.setTimeout(240_000);
      const fx: Fx = { page, signIn, cognito, modules, hire, own, requests, appOrigin };
      base(fx);
      const who = P[key];
      if (cognito!.subOf(who.email) === undefined) cognito!.addAccount(who);
      modules!.assign(who.email, who.company);
      hire!.assign(who);
      const bad = [
        `/hire/feedback/${IV}/../../hr/documents`, '/hire/feedback/../roles', '/hire/feedback/%2E%2E/roles', '/hire/feedback//evil.example', `/hire/feedback/${IV}%2F..%2F..%2Fhr`,
        `/hire/feedback/${IV}/x`, '/hire/feedback/', '/hire/roles', '/hire/candidates', `//evil.example/hire/feedback/${IV}`, `https://evil.example/hire/feedback/${IV}`,
        `/\\evil.example/hire/feedback/${IV}`, `javascript:alert(1)//hire/feedback/${IV}`, `/hire/feedback/${IV}\t`,
      ];
      for (const r of bad) {
        await forgetSignIn(page);
        await page.goto(`/sign-in?returnUrl=${encodeURIComponent(r)}`);
        await expect(signIn.email).toBeVisible();
        await signIn.signInAs(who);
        await expect.poll(() => new URL(page.url()).pathname, { message: `${who.full}, returnUrl=${r}`, timeout: 20_000 }).toMatch(lands);
        expect(new URL(page.url()).origin, `${who.full}, returnUrl=${r}: same site`).toBe(appOrigin);
      }
    });
  }

  test('AC-4.2 With Recruitment off for the company, or the modules check failing, the address sends the person to their first page and no interview is read', async ({ page, signIn, cognito, modules, hire, own, requests, appOrigin }) => {
    test.setTimeout(120_000);
    const fx: Fx = { page, signIn, cognito, modules, hire, own, requests, appOrigin };
    base(fx);
    modules!.answers.A = ['onboarding'];
    await signedIn(fx, P.employee);
    await page.goto(`/hire/feedback/${IV}`);
    await expect(page, 'Recruitment off: to /start').toHaveURL(/\/start$/);
    for (const mode of ['forbidden', 'offline', 'wrong-shape'] as const) {
      modules!.answers.A = ['onboarding', 'recruitment'];
      modules!.mode = mode;
      await page.goto(`/hire/feedback/${IV}`);
      await expect(page, `modules check ${mode}: to /start`).toHaveURL(/\/start$/);
    }
    await quiet(page);
    expect(own!.gets, 'no interview read').toHaveLength(0);
    await expect(heading(page)).not.toHaveText(TITLE);
  });
});

// ================================================================ AC-4.3 Not found, and loading
test.describe('AC-4.3 Not found and loading', () => {
  test.beforeEach(noBackendOnly);

  test('AC-4.3 A 404 (an unknown id, a person of the company not on the panel, a Recruiter not on the panel) and a 403 show only "This interview could not be found.": nothing of any candidate, no form, and the same page each time', async ({ page, signIn, cognito, modules, hire, own, requests, appOrigin }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, own, requests, appOrigin };
    base(fx);
    const seen: string[] = [];
    const check = async (where: string) => {
      await expect(page.getByText(OW.notFound, { exact: true }), where).toBeVisible();
      await noForm(page);
      expect(await shown(page), `${where}: only the not-found line`).toEqual([OW.notFound]);
      const html = await page.content();
      for (const v of A_WORDS) expect(html, `${where}: nothing of the candidate ("${v}")`).not.toContain(v);
      seen.push((await body(page).innerHTML()).replace(/\s+/g, ' ').replace(/_ng(content|host)-[\w-]+(="")?/g, ''));
    };
    await as(fx, P.employee, 'iv-never-issued');
    await check('unknown id');
    expect(own!.gets.at(-1)!.status).toBe(404);
    await forgetSignIn(page);
    await as(fx, P.other);
    await check('not on the panel');
    expect(own!.gets.at(-1)!.status).toBe(404);
    await forgetSignIn(page);
    await as(fx, P.recruiter);
    await check('a Recruiter not on the panel');
    expect(own!.gets.at(-1)!.status).toBe(404);
    own!.refuse('GET', { status: 403, body: { error: 'Forbidden' } });
    await open(page);
    await check('a 403');
    expect(new Set(seen).size, 'the same page each time').toBe(1);
  });

  for (const status of ['CANCELLED', 'DID_NOT_HAPPEN', 'COMPLETED'] as const) {
    test(`AC-4.3 A closed interview the person has not voted on (${status}, why CLOSED) shows the same not-found page, saying nothing about why or whose`, async ({ page, signIn, cognito, modules, hire, own, requests, appOrigin }) => {
      const fx: Fx = { page, signIn, cognito, modules, hire, own, requests, appOrigin };
      base(fx, { status });
      await as(fx, P.employee);
      expect([own!.gets.at(-1)!.status], 'the server answered 200 with why CLOSED').toEqual([200]);
      await expect(page.getByText(OW.notFound, { exact: true })).toBeVisible();
      await noForm(page);
      expect(await shown(page)).toEqual([OW.notFound]);
      const html = await page.content();
      for (const v of A_WORDS) expect(html, `nothing of the candidate ("${v}")`).not.toContain(v);
    });
  }

  test('AC-4.3 Company B: an Employee of company B (Recruitment on) opening company A\'s interview gets the same not-found page; the read carries only B\'s own sign-in and no company id', async ({ page, signIn, cognito, modules, hire, own, requests, appOrigin }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, own, requests, appOrigin };
    base(fx);
    modules!.answers.B = ['onboarding', 'recruitment'];
    await as(fx, P.employeeB);
    await expect(page.getByText(OW.notFound, { exact: true })).toBeVisible();
    await noForm(page);
    expect(await shown(page)).toEqual([OW.notFound]);
    const c = own!.gets.at(-1)!;
    expect([c.email, c.status, c.path], 'B\'s own sign-in, 404').toEqual([P.employeeB.email, 404, `/v1/interviews/${IV}`]);
    for (const id of Object.values(COMPANY_ID)) expect(c.raw, 'no company id in the read').not.toContain(id);
    expect(c.raw, 'no company or tenant named in the read').not.toMatch(/tenant|company/i);
    const html = await page.content();
    for (const v of A_WORDS) expect(html, `nothing of A ("${v}")`).not.toContain(v);
  });

  test('AC-4.3 Company B in the same tab: A\'s panel member fills the form and leaves with the vote on its way, signs out; B signs in on the page the app left (no reload) and opens A\'s address: nothing of A shows at any moment, also when A\'s late answers arrive; B\'s read goes with B\'s sign-in; B\'s own interview then opens empty', async ({ page, signIn, cognito, modules, hire, own, requests, appOrigin }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, own, requests, appOrigin };
    base(fx);
    own!.put({ id: 'iv-b-1', company: 'B', first: 'Mandla', last: 'Cele', role: 'Driver', type: 'BEHAVIORAL', at: sast(16, 11), status: 'SCHEDULED', snapshot: SNAP2, panel: [P.employeeB.email] });
    modules!.answers.B = ['onboarding', 'recruitment'];
    await signedIn(fx, P.employee);
    await inApp(page, `/hire/feedback/${IV}`);
    await settled(page);
    await fill(page, [4, 3, 5], 'Yes', SNAP, 'A-only feedback note');
    own!.refuse('POST', { hold: true });
    await submit(page).click();
    await expect.poll(() => own!.heldCount).toBe(1);
    await inApp(page, '/start');
    await expect(page).toHaveURL(/\/start$/);
    await avatarButton(page).dispatchEvent('click');
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).dispatchEvent('click');
    await expect(page).toHaveURL(/\/sign-in/);
    await page.evaluate((words) => {
      const seen: string[] = [];
      (window as unknown as { __seenA: string[] }).__seenA = seen;
      const check = () => {
        const all = `${document.documentElement.outerHTML} ${[...document.querySelectorAll('input, textarea, select')].map((x) => (x as HTMLInputElement).value).join(' ')}`;
        for (const w of words) if (all.includes(w)) seen.push(`${w} at ${location.pathname}`);
      };
      new MutationObserver(check).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
      document.addEventListener('input', check, true);
      check();
    }, [...A_WORDS, 'A-only feedback note']);
    const seenA = () => page.evaluate(() => (window as unknown as { __seenA?: string[] }).__seenA ?? ['the watcher is gone: the page was loaded again']);
    const who = P.employeeB;
    if (cognito!.subOf(who.email) === undefined) cognito!.addAccount(who);
    modules!.assign(who.email, who.company);
    hire!.assign(who);
    await signIn.signInAs(who);
    await expect(page).toHaveURL(/\/start$/);
    await inApp(page, `/hire/feedback/${IV}`);
    await settled(page);
    own!.release();
    await quiet(page);
    await expect(page.getByText(OW.notFound, { exact: true }), 'B sees the not-found page, also after A\'s late answer').toBeVisible();
    await noForm(page);
    const read = own!.gets.at(-1)!;
    expect([read.email, read.status], 'B\'s read, with B\'s sign-in').toEqual([who.email, 404]);
    await inApp(page, '/hire/feedback/iv-b-1');
    await settled(page);
    await expect(heading(page)).toHaveText(OW.title('Mandla', 'Cele'));
    expect(await held(page), 'B\'s form starts empty').toEqual({ values: expect.any(Array) as unknown as string[], decision: null, notes: '' });
    expect((await sliderTexts(body(page))).map((x) => x.label)).toEqual(SNAP2.map((c) => c.label));
    await decide(page, 'No');
    expect(await isOff(submit(page)), 'no criterion of B\'s is set yet: Submit stays off').toBe(true);
    expect(await seenA(), 'nothing of A at any moment').toEqual([]);
  });

  test('AC-4.3 A second interview opened in the same tab (no page load) never shows the first one\'s candidate, scores, Decision or notes, also when the first read answers late', async ({ page, signIn, cognito, modules, hire, own, requests, appOrigin }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, own, requests, appOrigin };
    base(fx);
    own!.put({ id: 'iv-own-2', company: 'A', first: 'Lindiwe', last: 'Peters', role: null, type: 'CULTURE_FIT', at: sast(17, 14), status: 'SCHEDULED', snapshot: SNAP2, panel: [P.employee.email] });
    await as(fx, P.employee);
    await fill(page, [4, 4, 4], 'Strong yes', SNAP, 'First interview note');
    await inApp(page, '/hire/feedback/iv-own-2');
    await settled(page);
    await expect(heading(page)).toHaveText(OW.title('Lindiwe', 'Peters'));
    await expect(page.getByText('Culture fit interview on 17 Nov 2026', { exact: true })).toBeVisible();
    expect(await held(page)).toEqual({ values: expect.any(Array) as unknown as string[], decision: null, notes: '' });
    expect((await sliderTexts(body(page))).map((x) => x.label)).toEqual(SNAP2.map((c) => c.label));
    await decide(page, 'No');
    expect(await isOff(submit(page)), 'no criterion of the second is set yet: Submit stays off').toBe(true);
    // Back to the first, with its read held; then on to the second before it answers.
    own!.refuse('GET', { hold: true });
    await inApp(page, `/hire/feedback/${IV}`);
    await expect.poll(() => own!.heldCount).toBe(1);
    await inApp(page, '/hire/feedback/iv-own-2');
    await settled(page);
    own!.release();
    await quiet(page);
    await expect(heading(page)).toHaveText(OW.title('Lindiwe', 'Peters'));
    const text = await body(page).innerText();
    for (const v of [...A_WORDS, 'First interview note']) expect(text, `nothing of the first ("${v}")`).not.toContain(v);
    // The vote goes to the interview on screen, not to the one the page opened first.
    await fill(page, [4, 2], 'No', SNAP2);
    await submit(page).click();
    await expect(page.getByText(OW.done, { exact: true })).toBeVisible();
    expect(own!.posts.map((p) => [p.path, p.status]), 'one vote, for the interview on screen').toEqual([['/v1/interviews/iv-own-2/votes', 201]]);
    expect(own!.ivs.get(IV)!.votes.has(P.employee.email.toLowerCase()), 'nothing stored on the first interview').toBe(false);
  });

  test('AC-4.3 While the read is on its way the kit\'s skeleton shows and no form, title or line; a failed read (500, 503, a throttle, a dropped connection) shows "Interview feedback could not be loaded." with "Try again", which reads again and shows the form', async ({ page, signIn, cognito, modules, hire, own, requests, appOrigin }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, own, requests, appOrigin };
    base(fx);
    await signedIn(fx, P.employee);
    own!.refuse('GET', { hold: true });
    await page.goto(`/hire/feedback/${IV}`);
    await expect.poll(() => own!.heldCount).toBe(1);
    await expect(page.locator('.pp-skeleton').first(), 'the skeleton while it loads').toBeVisible();
    await noForm(page);
    expect(await body(page).innerText()).not.toContain('Bongani');
    await expect(page.getByText(OW.loadFailed, { exact: true })).toHaveCount(0);
    await expect(page.getByText(OW.notFound, { exact: true })).toHaveCount(0);
    own!.release();
    await settled(page);
    await expect(heading(page)).toHaveText(TITLE);
    for (const r of [{ status: 500 }, { status: 503 }, { status: 429, body: { message: 'Too Many Requests' } }, { abort: true }, { status: 401, body: { message: 'Unauthorized' } }]) {
      own!.refuse('GET', r);
      await open(page);
      const where = JSON.stringify(r);
      await expect(page.getByText(OW.loadFailed, { exact: true }), where).toBeVisible();
      await expect(page.getByRole('button', { name: OW.tryAgain, exact: true }), where).toBeVisible();
      await noForm(page);
      expect(await shown(page), where).toEqual([OW.loadFailed, OW.tryAgain]);
      const n = own!.gets.length;
      await page.getByRole('button', { name: OW.tryAgain, exact: true }).click();
      await settled(page);
      await expect(heading(page), `${where}: Try again loads it`).toHaveText(TITLE);
      expect(own!.gets.length, `${where}: one more read`).toBe(n + 1);
    }
  });

  test('AC-4.3 (rule 3) An answer with no criteria shows "Interview feedback could not be loaded." with "Try again" and no form', async ({ page, signIn, cognito, modules, hire, own, requests, appOrigin }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, own, requests, appOrigin };
    base(fx);
    own!.answerNext({ id: IV, candidate_first: 'Bongani', candidate_last: 'Mthembu', role_title: 'Fleet controller', type: 'TECHNICAL', at: sast(18, 9), status: 'SCHEDULED', criteria: [], my_feedback: 'WAITING', my_vote: null, can: { capture_feedback: true } });
    await as(fx, P.employee);
    await expect(page.getByText(OW.loadFailed, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: OW.tryAgain, exact: true })).toBeVisible();
    await noForm(page);
    await page.getByRole('button', { name: OW.tryAgain, exact: true }).click();
    await settled(page);
    await expect(sliders(page)).toHaveCount(SNAP.length);
  });
});

// ================================================================ AC-4.4 Not yet, and already given
test.describe('AC-4.4 Not yet and already given', () => {
  test.beforeEach(noBackendOnly);

  test('AC-4.4 Before the start (why NOT_STARTED): the title, the line and "You can give feedback once the interview has started.", and no form', async ({ page, signIn, cognito, modules, hire, own, requests, appOrigin }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, own, requests, appOrigin };
    base(fx, { at: sast(20, 9) });
    await as(fx, P.employee);
    await expect(heading(page)).toHaveText(TITLE);
    await expect(page.getByText('Fleet controller · Technical interview on 20 Nov 2026', { exact: true })).toBeVisible();
    await expect(page.getByText(OW.notStarted, { exact: true })).toBeVisible();
    await noForm(page);
    expect(await shown(page)).toEqual([TITLE, 'Fleet controller · Technical interview on 20 Nov 2026', OW.notStarted]);
    expect(own!.posts).toHaveLength(0);
  });

  const cases: Array<[string, { rating: string | null; overall: number | null }, string | null]> = [
    ['Yes and 4', { rating: 'YES', overall: 4 }, 'Yes · 4 out of 5'],
    ['Strong no and 3.5', { rating: 'STRONG_NO', overall: 3.5 }, 'Strong no · 3.5 out of 5'],
    ['No and 3.7', { rating: 'NO', overall: 3.7 }, 'No · 3.7 out of 5'],
    ['Strong yes and 5', { rating: 'STRONG_YES', overall: 5 }, 'Strong yes · 5 out of 5'],
    ['an unknown code and 2', { rating: 'MAYBE', overall: 2 }, '2 out of 5'],
    ['no rating and 2.5', { rating: null, overall: 2.5 }, '2.5 out of 5'],
    ['Yes and no number', { rating: 'YES', overall: null }, 'Yes'],
    ['neither', { rating: null, overall: null }, null],
  ];
  test('AC-4.4 Already given (why GIVEN): the title, the line and the person\'s own line written as the Interviews tab writes it ("Yes · 4 out of 5", "Strong no · 3.5 out of 5", "No · 3.7 out of 5", an unknown code shows only "2 out of 5", ...), and no form', async ({ page, signIn, cognito, modules, hire, own, requests, appOrigin }) => {
    test.setTimeout(120_000);
    const fx: Fx = { page, signIn, cognito, modules, hire, own, requests, appOrigin };
    base(fx);
    await signedIn(fx, P.employee);
    for (const [label, vote, want] of cases) {
      own!.answerNext({ id: IV, candidate_first: 'Bongani', candidate_last: 'Mthembu', role_title: 'Fleet controller', type: 'TECHNICAL', at: sast(18, 9), status: 'SCHEDULED', criteria: SNAP, my_feedback: 'GIVEN', my_vote: vote, can: { capture_feedback: false }, why: 'GIVEN' });
      await open(page);
      await expect(heading(page), label).toHaveText(TITLE);
      await noForm(page);
      expect(await shown(page), label).toEqual([TITLE, LINE, ...(want ? [want] : [])]);
      expect(await body(page).innerText(), label).not.toMatch(BAD_WORDS);
    }
    expect(own!.posts).toHaveLength(0);
  });

  test('AC-4.4 The own line comes from the person\'s stored vote: scores 4, 3, 4 with Yes read "Yes · 3.7 out of 5"; a vote HR entered for them reads the same, with no "Captured by" line', async ({ page, signIn, cognito, modules, hire, own, requests, appOrigin }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, own, requests, appOrigin };
    const x = base(fx);
    x.votes.set(P.employee.email.toLowerCase(), { scores: { forklift_safety: 4, route_planning: 3, customer_care: 4 }, rating: 'YES' });
    await as(fx, P.employee);
    expect(await shown(page)).toEqual([TITLE, LINE, 'Yes · 3.7 out of 5']);
    await noForm(page);
  });

  for (const status of ['COMPLETED', 'CANCELLED'] as const) {
    test(`AC-4.4 Voted and now closed (${status}, why GIVEN): the own line shows, never "This interview could not be found."`, async ({ page, signIn, cognito, modules, hire, own, requests, appOrigin }) => {
      const fx: Fx = { page, signIn, cognito, modules, hire, own, requests, appOrigin };
      const x = base(fx, { status });
      x.votes.set(P.employee.email.toLowerCase(), { scores: { forklift_safety: 5, route_planning: 4, customer_care: 5 }, rating: 'STRONG_YES' });
      await as(fx, P.employee);
      expect(await shown(page)).toEqual([TITLE, LINE, 'Strong yes · 4.7 out of 5']);
      await expect(page.getByText(OW.notFound, { exact: true })).toHaveCount(0);
    });
  }

  test('AC-4.4 Right after a successful vote on a one-person panel (which makes the interview Done), opening the address again shows the own line', async ({ page, signIn, cognito, modules, hire, own, requests, appOrigin }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, own, requests, appOrigin };
    const x = base(fx, { panel: [P.employee.email] });
    await as(fx, P.employee);
    await fill(page, [3, 4, 4], 'No');
    await submit(page).click();
    await expect(page.getByText(OW.done, { exact: true })).toBeVisible();
    expect(x.status, 'the vote made the interview Done').toBe('COMPLETED');
    await open(page);
    expect(await shown(page)).toEqual([TITLE, LINE, 'No · 3.7 out of 5']);
    await noForm(page);
  });
});

// ================================================================ AC-4.5 Submit
test.describe('AC-4.5 Submit', () => {
  test.beforeEach(noBackendOnly);

  test('AC-4.5 Submit stays off until every criterion and the Decision are set (a slider set to 1 counts); a press then sends one POST to /v1/interviews/{that id}/votes with exactly scores and rating: whole numbers 1 to 5 for exactly the answer\'s criteria, the Decision\'s code, no on_behalf_of, no voter, no company; with one Idempotency-Key; the success line replaces the form', async ({ page, signIn, cognito, modules, hire, own, requests, appOrigin }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, own, requests, appOrigin };
    base(fx);
    await as(fx, P.employee);
    expect(await isOff(submit(page)), 'nothing set').toBe(true);
    await setScore(page, 'Forklift safety', 5);
    await setScore(page, 'Route planning', 5);
    await setScore(page, 'Talks to customers', 1);
    expect(await isOff(submit(page)), 'every criterion, no Decision').toBe(true);
    await open(page);
    expect(await isOff(submit(page)), 'opened again: nothing set').toBe(true);
    await decide(page, 'Strong no');
    expect(await isOff(submit(page)), 'only the Decision').toBe(true);
    await setScore(page, 'Forklift safety', 5);
    await setScore(page, 'Route planning', 5);
    expect(await isOff(submit(page)), 'one criterion left').toBe(true);
    await submit(page).click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(300);
    expect(own!.posts, 'nothing sent while off').toHaveLength(0);
    await setScore(page, 'Talks to customers', 1);
    expect(await isOff(submit(page)), 'all set (no vote gate: Strong no with 5, 5, 1)').toBe(false);
    await submit(page).click();
    await expect(page.getByText(OW.done, { exact: true })).toBeVisible();
    expect(own!.posts).toHaveLength(1);
    const c = own!.posts[0]!;
    expect(c.path).toBe(`/v1/interviews/${IV}/votes`);
    expect(Object.keys(bodyOf(c)).sort(), 'exactly scores and rating').toEqual(['rating', 'scores']);
    expect(bodyOf(c)['scores']).toEqual({ forklift_safety: 5, route_planning: 5, customer_care: 1 });
    expect(bodyOf(c)['rating']).toBe('STRONG_NO');
    expect(c.idempotencyKey, 'an Idempotency-Key').toMatch(/^[\w-]{8,}$/);
    expect(c.status).toBe(201);
    for (const id of Object.values(COMPANY_ID)) expect(c.raw).not.toContain(id);
    expect(c.raw, 'no voter, company or tenant in the request').not.toMatch(/tenant|company|voter|on_behalf/i);
    await noForm(page);
    expect(await shown(page), 'the success line, and only the title and line beside it').toEqual(expect.arrayContaining([OW.done]));
    expect((await shown(page)).filter((l) => ![TITLE, LINE, OW.done].includes(l))).toEqual([]);
  });

  test('AC-4.5 Each Decision sends its own code, and the notes go as typed: none sends no comment, a typed note goes whole up to 2,000 characters', async ({ page, signIn, cognito, modules, hire, own, requests, appOrigin }) => {
    test.setTimeout(120_000);
    const fx: Fx = { page, signIn, cognito, modules, hire, own, requests, appOrigin };
    await signedIn(fx, P.employee);
    const long = `${'Calm under pressure, clear routes. '.repeat(60)}`.slice(0, 2000);
    for (const [i, d] of DECISIONS.entries()) {
      const id = `iv-dec-${i}`;
      own!.put({ id, company: 'A', first: 'Bongani', last: 'Mthembu', role: 'Fleet controller', type: 'TECHNICAL', at: sast(18, 9), status: 'SCHEDULED', snapshot: SNAP, panel: [P.employee.email] });
      await open(page, id);
      const text = i === 0 ? undefined : i === 1 ? '  Spaces kept  ' : i === 2 ? long : 'Ünïcode ✓ note';
      await fill(page, [2, 3, 4], d.label, SNAP, text);
      await submit(page).click();
      await expect(page.getByText(OW.done, { exact: true })).toBeVisible();
      const b = bodyOf(own!.posts.at(-1)!);
      expect(b['rating'], d.label).toBe(d.code);
      if (text === undefined) expect('comment' in b, 'no notes: no comment key').toBe(false);
      else expect(b['comment'], 'the note as typed').toBe(text);
    }
    expect(new Set(own!.posts.map((p) => p.idempotencyKey)).size, 'each opening its own Idempotency-Key (T-P6)').toBe(DECISIONS.length);
  });

  test('AC-4.5 One press, one POST: a double click sends once, and while the vote is on its way Submit is off', async ({ page, signIn, cognito, modules, hire, own, requests, appOrigin }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, own, requests, appOrigin };
    base(fx);
    await as(fx, P.employee);
    await fill(page, [3, 3, 3], 'Yes');
    own!.refuse('POST', { hold: true });
    await submit(page).dblclick();
    await expect.poll(() => own!.heldCount).toBe(1);
    expect(await isOff(submit(page)), 'off while sending').toBe(true);
    await submit(page).click({ force: true }).catch(() => undefined);
    await page.keyboard.press('Enter').catch(() => undefined);
    await page.waitForTimeout(300);
    own!.release();
    await expect(page.getByText(OW.done, { exact: true })).toBeVisible();
    expect(own!.posts, 'one POST').toHaveLength(1);
  });

  const refusals: Array<[string, { status?: number; body?: unknown; abort?: boolean }, string]> = [
    ['409 NOT_STARTED', { status: 409, body: { error: 'Conflict', code: 'NOT_STARTED' } }, OW.notStarted],
    ['409 ALREADY_SCORED', { status: 409, body: { error: 'Conflict', code: 'ALREADY_SCORED' } }, OW.saveFail],
    ['409 ALREADY_DONE', { status: 409, body: { error: 'Conflict', code: 'ALREADY_DONE' } }, OW.saveFail],
    ['409 NOT_ALLOWED_NOW', { status: 409, body: { error: 'Conflict', code: 'NOT_ALLOWED_NOW' } }, OW.saveFail],
    ['400 INVALID_SCORES', { status: 400, body: { error: 'Bad request', code: 'INVALID_SCORES' } }, OW.saveFail],
    ['403', { status: 403, body: { error: 'Forbidden' } }, OW.saveFail],
    ['404', { status: 404, body: { error: 'Not found' } }, OW.saveFail],
    ['500', { status: 500, body: { error: 'Internal error' } }, OW.saveFail],
    ['a dropped connection', { abort: true }, OW.saveFail],
  ];
  test('AC-4.5 Refusals: 409 NOT_STARTED shows "You can give feedback once the interview has started."; 409 ALREADY_SCORED, ALREADY_DONE, NOT_ALLOWED_NOW, 400, 403, 404, 500 and a dropped connection show "Your change could not be saved. Try again."; each time the form stays with the scores, Decision and notes as typed, no code shows, and a retry goes with the same Idempotency-Key', async ({ page, signIn, cognito, modules, hire, own, requests, appOrigin }) => {
    test.setTimeout(120_000);
    const fx: Fx = { page, signIn, cognito, modules, hire, own, requests, appOrigin };
    base(fx);
    await as(fx, P.employee);
    await fill(page, [4, 2, 5], 'No', SNAP, 'Kept through refusals');
    const typed = await held(page);
    expect(typed).toEqual({ values: ['4', '2', '5'], decision: 'No', notes: 'Kept through refusals' });
    for (const [label, r, words] of refusals) {
      own!.refuse('POST', r);
      await submit(page).click();
      await expect(danger(page), label).toHaveText(words);
      await expect(danger(page), label).toHaveCount(1);
      expect(await held(page), `${label}: the form keeps what was typed`).toEqual(typed);
      expect(await body(page).innerText(), label).not.toMatch(BAD_WORDS);
      await expect(page.getByText(OW.done, { exact: true })).toHaveCount(0);
      expect(await isOff(submit(page)), `${label}: can send again`).toBe(false);
    }
    await submit(page).click();
    await expect(page.getByText(OW.done, { exact: true })).toBeVisible();
    const keys = new Set(own!.posts.map((p) => p.idempotencyKey));
    expect(own!.posts).toHaveLength(refusals.length + 1);
    expect(keys.size, 'one Idempotency-Key for every try of this opening').toBe(1);
  });

  test('AC-4.5 The real refusal paths of the server keep the form: the interview has not started by the vote\'s clock (409 NOT_STARTED, W-9b), and it was closed in between (409, the save-failure line)', async ({ page, signIn, cognito, modules, hire, own, requests, appOrigin }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, own, requests, appOrigin };
    const x = base(fx);
    await as(fx, P.employee);
    await fill(page, [3, 3, 3], 'Yes');
    x.at = sast(19, 11);
    await submit(page).click();
    await expect(danger(page)).toHaveText(OW.notStarted);
    expect(own!.posts.at(-1)!.status).toBe(409);
    x.at = sast(18, 9);
    x.status = 'CANCELLED';
    await submit(page).click();
    await expect(danger(page)).toHaveText(OW.saveFail);
    expect(own!.posts.at(-1)!.status).toBe(409);
    expect(await held(page)).toEqual({ values: ['3', '3', '3'], decision: 'Yes', notes: '' });
  });

  test('AC-4.5 An interview with no stored snapshot shows the company\'s default criteria from the answer, and the vote sent with exactly those keys is saved', async ({ page, signIn, cognito, modules, hire, own, requests, appOrigin }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, own, requests, appOrigin };
    base(fx, { snapshot: undefined });
    await as(fx, P.employee);
    expect((await sliderTexts(body(page))).map((x) => x.label)).toEqual(DEFAULT_CRITERIA.map((c) => c.label));
    await fill(page, [1, 2, 3, 4], 'Yes', DEFAULT_CRITERIA);
    await submit(page).click();
    await expect(page.getByText(OW.done, { exact: true })).toBeVisible();
    expect(Object.keys(bodyOf(own!.posts[0]!)['scores'] as object).sort()).toEqual(DEFAULT_CRITERIA.map((c) => c.key).sort());
    expect(own!.posts[0]!.status).toBe(201);
  });

  test('AC-4.5 (rule 3) Cancel sends nothing: after arriving from another page of the app it goes back there; opened straight from a link in a new tab it goes to the person\'s first page, inside the app', async ({ page, context, signIn, cognito, modules, hire, own, requests, appOrigin }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, own, requests, appOrigin };
    base(fx);
    await signedIn(fx, P.employee);
    await inApp(page, `/hire/feedback/${IV}`);
    await settled(page);
    await fill(page, [3, 3, 3], 'Yes');
    await cancel(page).click();
    await expect(page, 'back to where they came from').toHaveURL(/\/start$/);
    const fresh = await context.newPage();
    await fresh.goto(`/hire/feedback/${IV}`);
    await settled(fresh);
    await cancel(fresh).click();
    await expect(fresh, 'no history: the person\'s first page').toHaveURL(/\/start$/);
    expect(new URL(fresh.url()).origin).toBe(appOrigin);
    await fresh.close();
    await forgetSignIn(page);
    await signedIn(fx, P.hr);
    const hrTab = await context.newPage();
    await hrTab.goto(`/hire/feedback/${IV}`);
    await settled(hrTab);
    await cancel(hrTab).click();
    await expect(hrTab, 'HR\'s first page').toHaveURL(/\/hr$/);
    await hrTab.close();
    expect(own!.posts, 'Cancel sends nothing').toHaveLength(0);
  });
});

// ================================================================ AC-4.6 Requests
test.describe('AC-4.6 Requests', () => {
  test.beforeEach(noBackendOnly);

  test('AC-4.6 Across load, a refused vote, a saved vote and opening again, the only API calls are the one read per opening and the one vote per press: never the candidate, the interviews list, scores, other votes, Ask Batsi or HR home', async ({ page, signIn, cognito, modules, hire, own, requests, appOrigin }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, own, requests, appOrigin };
    base(fx);
    await signedIn(fx, P.employee);
    const from = requests.mark;
    await open(page);
    await quiet(page);
    expect(apiOf(fx, from), 'load: one read').toEqual([`GET /v1/interviews/${IV}`]);
    await fill(page, [5, 4, 3], 'Yes', SNAP, 'Requests note');
    own!.refuse('POST', { status: 500 });
    await submit(page).click();
    await expect(danger(page)).toHaveText(OW.saveFail);
    await submit(page).click();
    await expect(page.getByText(OW.done, { exact: true })).toBeVisible();
    await quiet(page);
    expect(apiOf(fx, from), 'one read, two presses').toEqual([`GET /v1/interviews/${IV}`, `POST /v1/interviews/${IV}/votes`, `POST /v1/interviews/${IV}/votes`]);
    const again = requests.mark;
    await open(page);
    await quiet(page);
    expect(apiOf(fx, again), 'opening again: one read').toEqual([`GET /v1/interviews/${IV}`]);
  });

  test('AC-4.6 In every other state (not started, given, not found, closed, load failure) the page makes the one read and nothing more', async ({ page, signIn, cognito, modules, hire, own, requests, appOrigin }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, own, requests, appOrigin };
    const x = base(fx, { at: sast(20, 9) });
    await signedIn(fx, P.employee);
    const states: Array<[string, () => void, string]> = [
      ['not started', () => undefined, IV],
      ['given', () => { x.at = sast(18, 9); x.votes.set(P.employee.email.toLowerCase(), { scores: { forklift_safety: 3, route_planning: 3, customer_care: 3 }, rating: 'YES' }); }, IV],
      ['not found', () => undefined, 'iv-never-issued'],
      ['closed', () => { x.votes.clear(); x.status = 'DID_NOT_HAPPEN'; }, IV],
      ['load failure', () => own!.refuse('GET', { status: 503 }), IV],
    ];
    for (const [where, setup, id] of states) {
      setup();
      const from = requests.mark;
      await open(page, id);
      await quiet(page);
      expect(apiOf(fx, from), where).toEqual([`GET /v1/interviews/${id}`]);
    }
  });
});

// ================================================================ AC-4.7 Desktop and phone
test.describe('AC-4.7 Desktop and phone', () => {
  test.beforeEach(noBackendOnly);

  async function allShown(page: Page, parts: Locator[], where: string): Promise<void> {
    const width = page.viewportSize()!.width;
    for (const el of parts) {
      await el.scrollIntoViewIfNeeded();
      await expect(el, where).toBeInViewport({ ratio: 0.99 });
      // A box that hides what does not fit (overflow hidden or clip) cannot be scrolled by a person: if the test had to scroll
      // it, or the part sticks out of it, the part is cut off.
      const cut = await el.evaluate((node) => {
        const target = node instanceof HTMLInputElement && node.type === 'radio' ? (node.labels?.[0] ?? node) : node;
        const r = target.getBoundingClientRect();
        const out: string[] = [];
        for (let a = target.parentElement; a && a !== document.documentElement; a = a.parentElement) {
          const s = getComputedStyle(a);
          if (!/(hidden|clip)/.test(`${s.overflowX} ${s.overflowY}`)) continue;
          const b = a.getBoundingClientRect();
          if (a.scrollTop > 0 || a.scrollLeft > 0 || r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5 || r.left < b.left - 0.5 || r.right > b.right + 0.5) out.push(a.tagName.toLowerCase() + (a.className ? '.' + String(a.className).trim().split(/\s+/).join('.') : ''));
        }
        return out;
      });
      expect(cut, `${where}: no box around it cuts it off`).toEqual([]);
      const box = (await el.boundingBox())!;
      expect(box.x, `${where}: starts inside the screen`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${where}: ends inside the screen`).toBeLessThanOrEqual(width + 0.5);
      const mine = await el.evaluate((node) => {
        const all = document.createElement('style');
        all.textContent = '* { pointer-events: auto !important; }';
        document.head.appendChild(all);
        try {
          const target = node instanceof HTMLInputElement && node.type === 'radio' ? (node.labels?.[0] ?? node) : node;
          const r = target.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !!hit && (target.contains(hit) || hit.contains(target) || (node instanceof HTMLInputElement && node.labels?.[0]?.contains(hit) === true)) && r.width > 0;
        } finally { all.remove(); }
      });
      expect(mine, `${where}: nothing covers it`).toBe(true);
    }
    const wide = await page.evaluate((w) => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth,
      ...[...document.querySelectorAll('body *')].filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowX)).map((e) => e.scrollWidth - e.clientWidth + Math.min(e.clientWidth, w))), width);
    expect(wide, `${where}: no sideways scroll`).toBeLessThanOrEqual(width);
  }

  test('AC-4.7 At 1280 and 390 wide the heading, the line, every slider, the Decisions, Notes, Submit feedback and Cancel are visible, not covered or clipped, and the page does not scroll sideways; also with the save-failure line', async ({ page, signIn, cognito, modules, hire, own, requests, appOrigin }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, own, requests, appOrigin };
    base(fx);
    await as(fx, P.employee);
    const parts = async () => [heading(page), page.getByText(LINE, { exact: true }), ...(await sliders(page).all()), ...(await radios(page).all()), notes(page), submit(page), cancel(page)];
    await allShown(page, await parts(), 'the form');
    await fill(page, [3, 3, 3], 'Yes');
    own!.refuse('POST', { status: 500 });
    await submit(page).click();
    await expect(danger(page)).toBeVisible();
    await allShown(page, [...(await parts()), danger(page)], 'with the save failure');
  });

  test('AC-4.7 Every other state at 1280 and 390: its heading and lines visible, not covered, no sideways scroll', async ({ page, signIn, cognito, modules, hire, own, requests, appOrigin }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, own, requests, appOrigin };
    const x = base(fx, { at: sast(20, 9) });
    await as(fx, P.employee);
    await allShown(page, [heading(page), page.getByText(OW.notStarted, { exact: true })], 'not started');
    x.at = sast(18, 9);
    x.votes.set(P.employee.email.toLowerCase(), { scores: { forklift_safety: 4, route_planning: 4, customer_care: 4 }, rating: 'YES' });
    await open(page);
    await allShown(page, [heading(page), page.getByText('Yes · 4 out of 5', { exact: true })], 'given');
    await open(page, 'iv-never-issued');
    await allShown(page, [page.getByText(OW.notFound, { exact: true })], 'not found');
    own!.refuse('GET', { status: 500 });
    await open(page);
    await allShown(page, [page.getByText(OW.loadFailed, { exact: true }), page.getByRole('button', { name: OW.tryAgain, exact: true })], 'load failure');
  });

  test('AC-4.7 On a phone the person can score with touch and the keyboard: a tap on a Decision tile picks it, the arrow keys move a slider by one', async ({ page, signIn, cognito, modules, hire, own, requests, appOrigin }) => {
    test.skip(!phone(), 'Phone only.');
    const fx: Fx = { page, signIn, cognito, modules, hire, own, requests, appOrigin };
    base(fx);
    await as(fx, P.employee);
    const s = page.getByRole('slider', { name: 'Route planning', exact: true });
    await s.fill('3');
    await s.focus();
    await page.keyboard.press('ArrowRight');
    await expect(s).toHaveValue('4');
    const tile = page.locator('.pp-radio--tile').nth(2);
    await tile.scrollIntoViewIfNeeded();
    await tile.tap();
    await expect(radios(page).nth(2)).toBeChecked();
  });
});

// ================================================================ AC-4.8 Words and kit
test.describe('AC-4.8 Words and kit', () => {
  test.beforeEach(noBackendOnly);

  const DS = join(__dirname, '..', '..', 'src', 'styles', 'design-system');
  const known = (): Set<string> => new Set(['components.css', 'tokens/base.css'].flatMap((f) => readFileSync(join(DS, f), 'utf8').match(/\.pp-[a-z0-9_-]+/g) ?? []).map((c: string) => c.slice(1)));

  async function onlyPp(page: Page, where: string): Promise<void> {
    const have = known();
    const found = await body(page).evaluate((el) => ({
      classes: [...new Set([...el.querySelectorAll('*')].flatMap((e) => [...e.classList]).filter((c) => !c.startsWith('ng-')))],
      styled: [...el.querySelectorAll('[style]')].filter((e) => !/^(--[\w-]+:[^;]*;?\s*)+$/.test(e.getAttribute('style') ?? '')).map((e) => e.tagName.toLowerCase()),
      styles: el.querySelectorAll('style').length,
      tags: [...new Set([...el.querySelectorAll('*')].map((e) => e.tagName.toLowerCase()).filter((t) => t.includes('-') && !t.startsWith('pp-') && !t.startsWith('app-') && t !== 'router-outlet'))],
    }));
    expect(found.classes.filter((c) => !(c.startsWith('pp-') && have.has(c)) && c !== 'lucide' && !c.startsWith('lucide-')), `${where}: only design system classes`).toEqual([]);
    expect(found.styled, `${where}: no style attribute that sets a look`).toEqual([]);
    expect(found.styles, `${where}: no style element in the page body`).toBe(0);
    expect(found.tags, `${where}: no custom element but pp-* and app-*`).toEqual([]);
    expect(await page.locator('.pp-app-shell, .pp-side-navigation, .pp-top-navigation').count(), `${where}: no shell part`).toBe(0);
  }

  test('AC-4.8 The app is synced to the design system ref the kit structure was captured at', async () => {
    once('a file check');
    const sync = JSON.parse(readFileSync(join(DS, 'sync.json'), 'utf8')) as { ref: string };
    expect(sync.ref, 'a design system change needs the structure captured again (a child lock)').toBe(KIT.ref);
  });

  test('AC-4.8 The page matches the kit screen "Guest scoring page" (and its phone screen) and uses only design system parts: the title is the sign-in card title, the line its company line, four Decision tiles, one slider per criterion, Submit primary', async ({ page, signIn, cognito, modules, hire, own, requests, appOrigin }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, own, requests, appOrigin };
    base(fx);
    await as(fx, P.employee);
    const name = phone() ? 'Guest scoring page (phone)' : 'Guest scoring page';
    const kit = (KIT.screens as Record<string, { page: readonly string[] }>)[name]!.page;
    const have = new Set(await body(page).evaluate((root) => [...new Set([...root.querySelectorAll('*')].flatMap((el) => [...el.classList]).filter((c) => c.startsWith('pp-')))]));
    const layoutOnly = [/^pp-gap-/, /^pp-inline/, /^pp-stack/, /^pp-grid/, /^pp-text(--|$)/, /^pp-sign-in--phone$/];
    expect(kit.filter((c) => !have.has(c) && !layoutOnly.some((re) => re.test(c))), `${name}: classes the kit has and the page lacks`).toEqual([]);
    await expect(page.locator('.pp-sign-in__title')).toHaveText(TITLE);
    await expect(page.locator('.pp-sign-in__company')).toHaveText(LINE);
    await expect(page.locator('.pp-radio--tile')).toHaveCount(4);
    await expect(page.locator('.pp-slider')).toHaveCount(SNAP.length);
    await expect(submit(page)).toHaveClass(/\bpp-button--primary\b/);
    await expect(cancel(page)).toHaveClass(/\bpp-button\b/);
    await expect(cancel(page)).not.toHaveClass(/\bpp-button--primary\b/);
    await onlyPp(page, name);
  });

  test('AC-4.8 Not started, given, not found, load failure, save failure and thank-you use only design system parts inside the same frame (the sign-in card), and no shell', async ({ page, signIn, cognito, modules, hire, own, requests, appOrigin }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, own, requests, appOrigin };
    const x = base(fx, { at: sast(20, 9) });
    await as(fx, P.employee);
    const frame = async (where: string) => { await expect(page.locator('.pp-sign-in .pp-sign-in__card'), `${where}: the sign-in card frame`).toHaveCount(1); await onlyPp(page, where); };
    await frame('not started');
    await expect(page.locator('.pp-sign-in__title')).toHaveText(TITLE);
    await expect(page.locator('.pp-sign-in__company')).toHaveText('Fleet controller · Technical interview on 20 Nov 2026');
    x.at = sast(18, 9);
    x.votes.set(P.employee.email.toLowerCase(), { scores: { forklift_safety: 2, route_planning: 2, customer_care: 2 }, rating: 'NO' });
    await open(page);
    await frame('given');
    await expect(page.locator('.pp-sign-in__title')).toHaveText(TITLE);
    await expect(page.locator('.pp-sign-in__company')).toHaveText(LINE);
    await open(page, 'iv-never-issued');
    await frame('not found');
    own!.refuse('GET', { status: 500 });
    await open(page);
    await frame('load failure');
    x.votes.clear();
    await page.getByRole('button', { name: OW.tryAgain, exact: true }).click();
    await settled(page);
    await fill(page, [3, 3, 3], 'Yes');
    own!.refuse('POST', { status: 500 });
    await submit(page).click();
    await expect(danger(page)).toBeVisible();
    await frame('save failure');
    await submit(page).click();
    await expect(page.getByText(OW.done, { exact: true })).toBeVisible();
    await frame('thank you');
  });

  test('AC-4.8 Every state uses only its own words: the kit\'s, the parent spec\'s, W-9b, the INT-UI-01 rating words and D-RUI-03.6, .13, .14; no "Masked", "average", "Passed", "out of 10", "decides", "Feedback from", no code, no id', async ({ page, signIn, cognito, modules, hire, own, requests, appOrigin }) => {
    test.setTimeout(120_000);
    const fx: Fx = { page, signIn, cognito, modules, hire, own, requests, appOrigin };
    const x = base(fx);
    await as(fx, P.employee);
    const formWords = [
      TITLE, LINE, ...SNAP.map((c) => c.label), ...SCALE, OW.decision, ...DECISIONS.flatMap((d) => [d.label, d.help, `${d.label}${d.help}`, `${d.label} ${d.help}`]),
      OW.notes, OW.optional, `${OW.notes} ${OW.optional}`, `${OW.notes}${OW.optional}`, OW.submit, OW.cancel,
    ];
    const states: Array<[string, string[], string[]]> = [];
    states.push(['form', await shown(page), formWords]);
    await fill(page, [5, 4, 3], 'Strong yes', SNAP, 'Words check note');
    states.push(['form, filled', (await shown(page)).filter((l) => l !== 'Words check note'), formWords]);
    own!.refuse('POST', { status: 409, body: { error: 'Conflict', code: 'NOT_STARTED' } });
    await submit(page).click();
    await expect(danger(page)).toBeVisible();
    states.push(['refused, not started', (await shown(page)).filter((l) => l !== 'Words check note'), [...formWords, OW.notStarted]]);
    own!.refuse('POST', { status: 500 });
    await submit(page).click();
    await expect(danger(page)).toHaveText(OW.saveFail);
    states.push(['save failure', (await shown(page)).filter((l) => l !== 'Words check note'), [...formWords, OW.saveFail]]);
    await submit(page).click();
    await expect(page.getByText(OW.done, { exact: true })).toBeVisible();
    states.push(['thank you', await shown(page), [TITLE, LINE, OW.done]]);
    await open(page);
    states.push(['given', await shown(page), [TITLE, LINE, 'Strong yes · 4 out of 5']]);
    x.votes.clear();
    x.at = sast(20, 9);
    await open(page);
    states.push(['not started', await shown(page), [TITLE, 'Fleet controller · Technical interview on 20 Nov 2026', OW.notStarted]]);
    await open(page, 'iv-never-issued');
    states.push(['not found', await shown(page), [OW.notFound]]);
    own!.refuse('GET', { status: 500 });
    await open(page);
    states.push(['load failure', await shown(page), [OW.loadFailed, OW.tryAgain]]);
    for (const [where, ls, allowed] of states) {
      expect(ls.filter((l) => !allowed.includes(l)), `${where}: no words beyond its own`).toEqual([]);
      const text = ls.join('\n');
      expect(text, where).not.toMatch(NEVER_WORDS);
      expect(text, where).not.toMatch(BAD_WORDS);
      expect(text, where).not.toContain(IV);
    }
  });
});

// ================================================================ AC-4.9 pepla-dev
test.describe('AC-4.9 pepla-dev', () => {
  const REPO = join(__dirname, '..', '..', '..');
  type DevIds = { candidate: string; firstName: string; lastName: string; interview: string };
  const ALL = () => JSON.parse(readFileSync(join(__dirname, 'support', 'rec-ui-03', 'dev-ids-own.json'), 'utf8')) as Record<string, DevIds>;

  test('AC-4.9 pepla-dev seed: seed-dev.py puts "REC-UI-03.4 own desktop" and "REC-UI-03.4 own phone" back every run under the ids in support/rec-ui-03/dev-ids-own.json: the dev panel login the only panel person, waiting, started yesterday, a criteria snapshot, both vote row kinds removed, company A only (text check)', async () => {
    noBackendOnly();
    once('a file check');
    const all = ALL();
    expect(Object.keys(all).sort(), 'one interview per width').toEqual(['desktop-1280', 'phone-390']);
    const flat = Object.values(all);
    for (const d of flat) expect(Object.keys(d).sort()).toEqual(['candidate', 'firstName', 'interview', 'lastName']);
    expect(new Set(flat.map((d) => d.candidate)).size, 'each on its own candidate').toBe(2);
    expect(new Set(flat.map((d) => d.interview)).size, 'each its own interview').toBe(2);
    const other = ['rec-ui-03-read/dev-ids.json', 'rec-ui-03/dev-ids-capture.json'].map((f) => readFileSync(join(__dirname, 'support', f), 'utf8')).join('\n');
    for (const d of flat) expect(other, 'ids no other test uses').not.toContain(d.interview);
    const seed = readFileSync(join(REPO, 'scripts', 'ci', 'seed-dev.py'), 'utf8');
    const fns = [...seed.matchAll(/^def (\w+)\([\s\S]*?(?=^def |^if __name__)/gm)].map((m) => ({ name: m[1]!, body: m[0] }));
    const fn = fns.find((f) => /dev-ids-own\.json/.test(f.body));
    expect(fn, 'a seed function reads support/rec-ui-03/dev-ids-own.json').toBeTruthy();
    const b = fn!.body;
    const clears = (/["']VOTE#["']/.test(b) && /["']VOTED#["']/.test(b)) || /KeyConditionExpression="PK = :pk"[\s\S]{0,400}delete_item/.test(b);
    expect.soft(clears && /delete_item\(/.test(b), `${fn!.name} removes the VOTE# and VOTED# rows (or every row under each candidate)`).toBe(true);
    for (const f of ['"SCHEDULED"', 'votesSubmitted', 'votesRequired', 'PANEL_FEEDBACK_PENDING_COUNT', 'criteria_snapshot', 'panelMemberIds', 'tenant_id', 'scheduledAt', '"SAGA"']) expect.soft(b.includes(f), `${fn!.name} writes ${f}`).toBe(true);
    // The card's signature: seed_rec_ui_03_4(ddb, tid, panel_sub, hr_sub). The panel is that third argument alone, and the
    // interview started 26 hours before the run (lock check round 1, O-2).
    const params = (/^def \w+\(([^)]*)\)/.exec(b)?.[1] ?? '').split(',').map((p) => p.trim().split(/[:=\s]/)[0]!);
    expect.soft(params.length, `${fn!.name} takes (ddb, tid, panel_sub, hr_sub)`).toBe(4);
    const panelArg = params[2] ?? 'panel_sub';
    const panels = [...b.matchAll(/["']panelMemberIds["']\s*:\s*\{\s*["']L["']\s*:\s*\[([^\]]*)\]/g)].map((m) => m[1]!.replace(/\s+/g, ''));
    expect.soft(panels.length > 0 && panels.every((p) => p === `{"S":${panelArg}}` || p === `{'S':${panelArg}}`), `${fn!.name}: the dev panel login (${panelArg}) is the only panel person`).toBe(true);
    expect.soft(/["']scheduledAt["'][^\n]{0,120}-\s*(?:26\s*\*\s*3600|93600|timedelta\(\s*hours\s*=\s*26\s*\))/.test(b), `${fn!.name}: scheduledAt is 26 hours before the run`).toBe(true);
    expect.soft(/SECOND_TENANT_ID|guest_email|guest_link_hash|scoring_link/.test(b), `${fn!.name} seeds nothing for company B and no guest`).toBe(false);
    expect.soft(/\.values\(\)|for\s+\w+\s*,\s*\w+\s+in\s+\w+\.items\(\)/.test(b), `${fn!.name} seeds every width`).toBe(true);
    const main = seed.slice(seed.indexOf('def main('));
    expect.soft(new RegExp(`\\b${fn!.name}\\(\\s*ddb\\s*,`).test(main), `main() calls ${fn!.name}`).toBe(true);
  });

  test('AC-4.9 @pepla-dev The dev panel login opens its width\'s seeded interview at /hire/feedback/{id}, scores and sees the thank-you line; opening it again shows its own line (its vote made the interview Done); the dev HR login, not on that panel, sees "This interview could not be found." on the same address', async ({ page, signIn, employee, hr }) => {
    test.skip(!ON_DEV, 'AC-4.9 runs on pepla-dev only.');
    test.setTimeout(3 * 60_000);
    const dev = ALL()[test.info().project.name];
    if (!dev) throw new Error(`dev-ids-own.json has no entry for ${test.info().project.name}`);
    const address = `/hire/feedback/${dev.interview}`;
    await signIn.open();
    await signIn.signInAs(employee);
    await expect(page).toHaveURL(/\/start$/);
    await page.goto(address);
    await settled(page);
    await expect(heading(page)).toHaveText(OW.title(dev.firstName, dev.lastName));
    const labels = (await sliderTexts(body(page))).map((x) => x.label);
    expect(labels.length, 'the seeded criteria').toBeGreaterThan(0);
    for (const l of labels) await setScore(page, l, 4);
    await decide(page, 'Yes');
    await submit(page).click();
    await expect(page.getByText(OW.done, { exact: true })).toBeVisible({ timeout: 20_000 });
    await page.goto(address);
    await settled(page);
    await expect(page.getByText('Yes · 4 out of 5', { exact: true }), 'the own line after the vote closed the interview').toBeVisible();
    await expect(page.getByText(OW.notFound, { exact: true })).toHaveCount(0);
    await forgetSignIn(page);
    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL(/\/hr$/);
    await page.goto(address);
    await settled(page);
    await expect(page.getByText(OW.notFound, { exact: true }), 'HR, not on the panel').toBeVisible();
    await expect(sliders(page)).toHaveCount(0);
  });
});
