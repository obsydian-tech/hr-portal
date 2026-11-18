import type { Browser, BrowserContext, Locator, Page, Route } from '@playwright/test';
import { HELP_NEW_EMPLOYEES } from '../../fixtures/help-company';
import { HELP_TODAY } from '../../support/help';
import { CognitoFake } from './cognito-fake';
import { SignInPage } from './fixtures';
import { PHONE } from './help-02';
import { scrollAs, type Scroll } from './help-03';
import { stepOfStage } from './employees-fake';
import { HELP_HR, projectUse, type Box, type Width } from './journey-harness';
import { settleFonts } from './fonts';

/**
 * HELP-04 · Help pictures: HR adds a new employee (Jira NH-173).
 *
 * What the card says the seven pictures show, the reference pictures built
 * from it, and the recorder script that watches the journey's page.
 * Nothing here calls an AI service or any AWS service.
 */

const APP = process.env['E2E_BASE_URL'] ?? 'http://localhost:4310'; // acceptance playwright.config.ts

// ---------------------------------------------------------------- the card's tables

/** "Data" in the card (spec HELP-04, Iggie's answers of 16 Nov 2026). */
export const CARD = {
  employee: { id: 'sunbird-thandi-mahlangu', first: 'Thandi', last: 'Mahlangu', name: 'Thandi Mahlangu', email: 'thandi@example.com' },
  phone: '000 000 0000',
  department: 'Operations',
  jobTitle: 'Junior baker',
  start: '2026-03-16',
  startWords: '16 Mar 2026',
  partner: { name: 'Pieter van Wyk', staffId: 'HR-001', email: 'pieter@example.com' },
  invite: {
    sent: { status: 'ok', sentAt: '2026-03-02T09:00:00+02:00', expiresAt: '2026-03-09T09:00:00+02:00', sentTo: 'thandi@example.com' },
    resent: { status: 'ok', sentAt: '2026-03-02T09:05:00+02:00', expiresAt: '2026-03-09T09:05:00+02:00', sentTo: 'thandi@example.com', email: { sent: true } },
    sentWords: { sent: '2 Mar 2026, 09:00, to thandi@example.com', expires: '9 Mar 2026, 09:00' },
    resentWords: { sent: '2 Mar 2026, 09:05, to thandi@example.com', expires: '9 Mar 2026, 09:05' },
  },
  welcome: 'A welcome email was sent to thandi@example.com.',
  steps: ['Personal information', 'Job and start date', 'HR partner', 'Confirmation'],
} as const;

/** The register page's heading, and the registered page's. */
export const FORM_HEADING = 'Register a new employee';
export const REGISTERED_HEADING = `${CARD.employee.name} is registered`;

/** HELP_PEOPLE as HELP-01 locked it. It must not change. */
export const LOCKED_PEOPLE = [
  { key: 'admin', name: 'Nomsa Dlamini', role: 'Admin', title: 'Owner', email: 'nomsa@example.com' },
  { key: 'hr', name: 'Pieter van Wyk', role: 'HR', title: 'People and payroll', email: 'pieter@example.com' },
  { key: 'manager', name: 'Ayesha Patel', role: 'Manager', title: 'Head baker', email: 'ayesha@example.com' },
  { key: 'employee', name: 'Sipho Mokoena', role: 'Employee', title: 'Baker', email: 'sipho@example.com' },
  { key: 'employee2', name: 'Lerato Nkosi', role: 'Employee', title: 'Shop assistant', email: 'lerato@example.com' },
  { key: 'employee3', name: 'Johan Botha', role: 'Employee', title: 'Delivery driver', email: 'johan@example.com' },
  { key: 'new', name: 'Thandi Mahlangu', role: 'Employee', title: 'Junior baker (starting soon)', email: 'thandi@example.com' },
];

export const PICTURES = [
  '01-personal-information',
  '02-job-and-start-date',
  '03-hr-partner',
  '04-confirmation',
  '05-registered',
  '06-invite-link',
  '07-link-resent',
] as const;

// ---------------------------------------------------------------- the watcher, inside the recorder

/**
 * More recorder script (journey-harness FrontMode 'record', `extra`). It sends:
 * - scroll "x,y,mx,my" when the window (x,y) or the app's main area (#main: mx,my) moves (every 40 ms);
 * - shot "x,y,mx,my" when the help caption is taken down, which help.shot does right before a picture,
 *   and right after it facts {"idRow","idDigits","heading"}: an "ID number" row on the page, 13 digits
 *   in a row in the page text, and the page's h1;
 * - input "<label>" when a select changes (the recorder itself only sees inputs), for "Choose Department";
 * - text "email:<address>" and "phone:<number>" for each one the page text shows;
 * - call {"m","u","auth","body"} for every request the page itself makes (fetch and XHR);
 * - answer {"m","u","status","body"} for every answer from the two APIs.
 */
export function watcher(employeesApi: string, documentApi: string): string {
  return `
  const apis = [${JSON.stringify(employeesApi)}, ${JSON.stringify(documentApi)}];
  const phone = new RegExp(${JSON.stringify(PHONE.source)}, 'g');
  const isBeacon = (u) => String(u).includes('/__journey/event');
  const isApi = (u) => apis.some((a) => u.startsWith(a));
  const bearer = (v) => /^Bearer \\S+$/.test(String(v || ''));
  const say = (type, o) => send(type, JSON.stringify(o));

  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (isBeacon(u)) return realFetch(input, init);
    let auth = false;
    try {
      const h = new Headers((init && init.headers) || (input instanceof Request ? input.headers : undefined));
      auth = bearer(h.get('authorization'));
    } catch (e) {}
    const m = ((init && init.method) || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const full = new URL(u, location.href).href;
    say('call', { m, u: full, auth, body: init && typeof init.body === 'string' ? init.body : '' });
    const answer = realFetch(input, init);
    if (isApi(full)) answer.then((r) => r.clone().text().then((body) => say('answer', { m, u: full, status: r.status, body }))).catch(() => {});
    return answer;
  };
  const open = XMLHttpRequest.prototype.open;
  const setHeader = XMLHttpRequest.prototype.setRequestHeader;
  const xsend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__m = String(m).toUpperCase(); this.__u = new URL(u, location.href).href; this.__auth = false; return open.apply(this, arguments); };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) { if (String(k).toLowerCase() === 'authorization') this.__auth = bearer(v); return setHeader.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (body) {
    const x = this;
    if (!isBeacon(x.__u)) {
      say('call', { m: x.__m, u: x.__u, auth: x.__auth, body: typeof body === 'string' ? body : '' });
      if (isApi(x.__u)) x.addEventListener('loadend', () => say('answer', { m: x.__m, u: x.__u, status: x.status, body: typeof x.responseText === 'string' ? x.responseText : '' }));
    }
    return xsend.apply(this, arguments);
  };

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLSelectElement)) return;
    send('input', (t.labels && t.labels[0] && t.labels[0].textContent) || t.getAttribute('aria-label') || '');
  }, true);

  let lastScroll = '';
  let captionUp = false;
  const said = new Set();
  setInterval(() => {
    const main = document.getElementById('main');
    const at = [window.scrollX, window.scrollY, main ? main.scrollLeft : 0, main ? main.scrollTop : 0].map(Math.round).join(',');
    if (at !== lastScroll) { lastScroll = at; send('scroll', at); }
    const c = document.getElementById('__help_caption');
    const up = !!c && c.style.display !== 'none';
    const text = document.body ? document.body.innerText : '';
    if (captionUp && !up) {
      send('shot', at);
      const h1 = document.querySelector('h1');
      say('facts', {
        idRow: [...document.querySelectorAll('dt, th, .pp-dl__term')].some((d) => d.textContent.trim() === 'ID number'),
        idDigits: /\\d{13}/.test(text.replace(/[ \\t-]/g, '')),
        heading: h1 ? h1.textContent.trim() : '',
        path: location.pathname,
      });
    }
    captionUp = up;
    for (const m of text.match(/[\\w.+-]+@[\\w-]+(\\.[\\w-]+)+/g) || []) if (!said.has('e' + m)) { said.add('e' + m); send('text', 'email:' + m); }
    for (const m of text.match(phone) || []) if (!said.has('p' + m)) { said.add('p' + m); send('text', 'phone:' + m); }
  }, 40);`;
}

/** What the watcher's "facts" event says about the page at a picture. */
export type ShotFacts = { idRow: boolean; idDigits: boolean; heading: string; path: string };
export type Call = { m: string; u: string; auth: boolean; body: string };
export type Answer = { m: string; u: string; status: number; body: string };

// ---------------------------------------------------------------- the two APIs, from the card

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, idempotency-key', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const PARTNER_ID = 'reference-partner';

/** The employees and document APIs as the card describes them, for the reference. */
async function answerApis(context: BrowserContext, employeesApi: string, documentApi: string): Promise<void> {
  const employees = new URL(employeesApi).host;
  const documents = new URL(documentApi).host;
  const id = CARD.employee.id;
  let registered = false;
  await context.route(
    (url) => url.host === employees || url.host === documents,
    (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const m = req.method();
      if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      if (!/^Bearer \S+$/.test(req.headers()['authorization'] ?? '')) return json(route, 401, { message: 'Unauthorized' });
      const at = `${url.host === employees ? 'E' : 'D'} ${m} ${url.pathname}`;
      if (at === 'E GET /v1/employees') {
        // HR home lists the other three until Thandi is registered.
        const people = HELP_NEW_EMPLOYEES.filter((p) => registered || p.employee_id !== id);
        const items = people.map((p) => ({ ...p, middle_name: '', phone: '', job_title: '', id_number_last4: '', hr_staff_email: HELP_HR.email, step: stepOfStage(p.stage) }));
        return json(route, 200, { items, count: items.length });
      }
      if (at === 'E GET /v1/company/modules') return json(route, 200, { modules: ['onboarding'] }); // MOD-02, as e2e/support/help.ts answers it
      if (at === 'E GET /v1/employees/email-check') return json(route, 200, { inUse: false });
      if (at === 'E GET /v1/hr-partners') return json(route, 200, { items: [{ id: PARTNER_ID, ...CARD.partner }] });
      if (at === 'E POST /v1/employees') {
        registered = true;
        return json(route, 201, { employee: { employee_id: id }, email: { sent: true } });
      }
      if (at === `E GET /v1/employees/${id}/invite`) return json(route, 200, CARD.invite.sent);
      if (at === `E POST /v1/employees/${id}/invite`) return json(route, 200, CARD.invite.resent);
      if (at === `D GET /v1/employees/${id}/verifications`) {
        return json(route, 200, {
          employee: {
            employee_id: id, first_name: CARD.employee.first, last_name: CARD.employee.last, email: CARD.employee.email, phone: CARD.phone,
            department: CARD.department, job_title: CARD.jobTitle, step: 'INVITED', planned_start_date: CARD.start, hr_staff_name: CARD.partner.name,
          },
          documents: [],
        });
      }
      return json(route, 404, { message: 'Not found' });
    },
  );
}

// ---------------------------------------------------------------- reference pictures

/** Where the page heading (01 to 05) or the Invite link card heading (06, 07) sits, in CSS pixels. */
export type Placement = { heading: string; top: number; barBottom: number; uncovered: boolean };

export type AddsAnEmployeeReference = {
  width: Width;
  cssWidth: number;
  /** HR home after signing in, without Thandi: the video's first frame. */
  home: Buffer;
  pictures: Buffer[];
  regions: Record<string, Box>[];
  /** One per picture. */
  placements: Placement[];
};

async function box(loc: Locator, what: string): Promise<Box> {
  const b = await loc.boundingBox();
  if (!b) throw new Error(`reference: ${what} has no box`);
  return b;
}

async function isUncovered(loc: Locator): Promise<boolean> {
  return loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight || r.height === 0) return false;
    const hit = document.elementFromPoint(r.left + Math.min(8, r.width / 2), r.top + r.height / 2);
    return !!hit && (el === hit || el.contains(hit));
  });
}

async function uncovered(loc: Locator, what: string): Promise<void> {
  let ok = false;
  for (let i = 0; i < 30 && !ok; i++) {
    ok = await isUncovered(loc);
    if (!ok) await loc.page().waitForTimeout(100);
  }
  if (!ok) throw new Error(`reference: ${what} is not fully in the picture and uncovered`);
}

async function barBottom(page: Page): Promise<number> {
  return page.evaluate(() =>
    Math.max(
      0,
      ...[...document.querySelectorAll('[role=banner]')]
        .filter((b) => ['fixed', 'sticky'].includes(getComputedStyle(b).position))
        .map((b) => b.getBoundingClientRect().bottom),
    ),
  );
}

async function placement(page: Page, heading: Locator, name: string): Promise<Placement> {
  return { heading: name, top: (await box(heading, name)).y, barBottom: await barBottom(page), uncovered: await isUncovered(heading) };
}

/**
 * The seven pictures as they should look, taken here with the journeys' own
 * settings (size, scale, clock, locale), the same Cognito fake, and both APIs
 * answered from the card's tables (not from the builder's fixture exports).
 * Each picture is checked against the card before it is used.
 *
 * `shots` are where the journey's window was at each picture; the reference
 * scrolls to the same place. On the phone a picture whose heading sits in the
 * top third (AC-8) cannot hold the whole form, so parts marked "desktop" are
 * required in view on the desktop only; the rest on both widths.
 */
export async function addsAnEmployeeReference(
  browser: Browser,
  width: Width,
  shots: Scroll[],
  apis: { employees: string; documents: string },
): Promise<AddsAnEmployeeReference> {
  if (shots.length !== PICTURES.length) throw new Error(`reference: the journey took ${shots.length} pictures, not ${PICTURES.length}`);
  const use = projectUse(width);
  const desktop = width === 'desktop';
  const context = await browser.newContext({ ...use, baseURL: APP });
  try {
    const fake = new CognitoFake([{ email: HELP_HR.email, givenName: HELP_HR.givenName, familyName: HELP_HR.familyName, groups: ['hr_staff'] }]);
    await fake.install(context);
    await answerApis(context, apis.employees, apis.documents);
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    await page.clock.setFixedTime(HELP_TODAY);
    const main = page.locator('main');
    const heading = (name: string) => page.getByRole('heading', { name, exact: true });
    const field = (label: string) => page.getByLabel(label, { exact: true });
    const current = main.locator('li[aria-current="step"]');
    const idField = page.getByLabel(/^ID number/);
    const shot = async (i: number) => {
      await page.mouse.move(1, 1);
      await scrollAs(page, shots[i]!);
      await page.waitForLoadState('networkidle');
      await settleFonts(page);
      return page.screenshot({ animations: 'disabled', caret: 'hide' });
    };
    const regions: Record<string, Box>[] = [];
    const placements: Placement[] = [];
    const pictures: Buffer[] = [];
    /** Each part must be in the picture and uncovered (desktop-only parts on the desktop only). */
    const take = async (i: number, parts: Record<string, Locator>, desktopOnly: Record<string, Locator>, head: Locator, headName: string) => {
      await scrollAs(page, shots[i]!);
      await page.mouse.move(1, 1);
      const r: Record<string, Box> = {};
      for (const [part, loc] of Object.entries({ ...parts, ...(desktop ? desktopOnly : {}) })) {
        await uncovered(loc, `${PICTURES[i]} ${part}`);
        r[part] = await box(loc, part);
      }
      regions.push(r);
      placements.push(await placement(page, head, headName));
      pictures.push(await shot(i));
    };
    const expectStep = async (n: number) => {
      const text = (await current.innerText()).replace(/\s+/g, ' ');
      if (!text.includes(CARD.steps[n - 1]!) || !text.includes(`Step ${n} of 4`)) throw new Error(`reference: the tracker is not on ${CARD.steps[n - 1]} (${text})`);
    };

    // Sign in. HR home, without Thandi, is the video's first frame.
    const signIn = new SignInPage(page);
    await signIn.open();
    await signIn.email.fill(HELP_HR.email);
    await signIn.password.fill('made-up-password');
    await signIn.submit.click();
    await heading(`Welcome back, ${HELP_HR.givenName}`).waitFor({ state: 'visible' });
    await page.getByText('Lerato Nkosi', { exact: true }).first().waitFor({ state: 'visible' });
    if ((await page.getByText(CARD.employee.name, { exact: true }).count()) !== 0) throw new Error('reference: Thandi is on HR home before she is registered');
    await page.waitForLoadState('networkidle');
    await settleFonts(page);
    const home = await page.screenshot({ animations: 'disabled', caret: 'hide' });

    // 01: step 1 filled, Personal information current. Middle name and ID number empty.
    await page.getByRole('link', { name: 'Add new employee', exact: true }).click();
    await heading(FORM_HEADING).waitFor({ state: 'visible' });
    await field('First name').fill(CARD.employee.first);
    await field('Last name').fill(CARD.employee.last);
    await field('Email address').fill(CARD.employee.email);
    await field('Phone number').fill(CARD.phone);
    await expectStep(1);
    if ((await page.getByLabel(/^Middle name/).inputValue()) !== '' || (await idField.inputValue()) !== '') throw new Error('reference 01: Middle name or ID number is not empty');
    await take(
      0,
      { 'current step': current, 'First name': field('First name') },
      { 'Last name': field('Last name'), 'Email address': field('Email address'), 'Phone number': field('Phone number'), 'ID number (empty)': idField },
      heading(FORM_HEADING),
      FORM_HEADING,
    );

    // 02: step 2 filled. Offer accepted empty.
    await page.getByRole('button', { name: 'Next: job and start date', exact: true }).click();
    await current.getByText('Step 2 of 4').waitFor({ state: 'visible' });
    await field('Department').selectOption({ label: CARD.department });
    await field('Job title').fill(CARD.jobTitle);
    await field('Start date').fill(CARD.startWords);
    await field('Start date').press('Tab');
    await expectStep(2);
    if ((await field('Start date').inputValue()) !== CARD.startWords) throw new Error('reference 02: Start date does not show the date');
    await take(1, { 'current step': current, Department: field('Department') }, { 'Job title': field('Job title'), 'Start date': field('Start date') }, heading(FORM_HEADING), FORM_HEADING);

    // 03: Pieter van Wyk chosen.
    await page.getByRole('button', { name: 'Next: HR partner', exact: true }).click();
    const tile = page.getByRole('radio', { name: new RegExp(`^${CARD.partner.name}`) });
    await tile.waitFor({ state: 'attached' });
    if (!(await tile.isChecked())) throw new Error('reference 03: Pieter van Wyk is not chosen');
    if ((await page.getByRole('radio').count()) !== 1) throw new Error('reference 03: more than one HR partner');
    await expectStep(3);
    const tileLabel = tile.locator('xpath=ancestor::label[1] | ../label').first();
    if (!(await tileLabel.innerText()).includes(`Staff ID ${CARD.partner.staffId} · ${CARD.partner.email}`)) throw new Error('reference 03: the tile does not show the staff ID and email');
    await take(2, { 'current step': current, 'Pieter van Wyk tile': tileLabel }, {}, heading(FORM_HEADING), FORM_HEADING);

    // 04: the three Confirmation cards, no ID number row.
    await page.getByRole('button', { name: 'Next: check details', exact: true }).click();
    await heading('Assigned HR partner').waitFor({ state: 'visible' });
    await expectStep(4);
    const card = (name: string) => main.locator('pp-card').filter({ has: heading(name) });
    const want: Record<string, string[]> = {
      'Personal details': ['Full name', CARD.employee.name, 'Email', CARD.employee.email, 'Phone', CARD.phone],
      'Job and start date': ['Department', CARD.department, 'Job title', CARD.jobTitle, 'Start date', CARD.startWords],
      'Assigned HR partner': ['Name', CARD.partner.name, 'Staff ID', CARD.partner.staffId, 'Email', CARD.partner.email],
    };
    for (const [name, parts] of Object.entries(want)) {
      const text = await card(name).innerText();
      for (const p of parts) if (!text.includes(p)) throw new Error(`reference 04: ${name} does not show "${p}" (${text})`);
    }
    if (/ID number/.test(await main.innerText())) throw new Error('reference 04: there is an ID number row');
    await take(
      3,
      { 'Personal details heading': heading('Personal details') },
      { 'Personal details': card('Personal details'), 'Job and start date': card('Job and start date'), 'Assigned HR partner': card('Assigned HR partner') },
      heading(FORM_HEADING),
      FORM_HEADING,
    );

    // 05: registered, the welcome email was sent.
    await page.getByRole('button', { name: `Register ${CARD.employee.first}`, exact: true }).click();
    await heading(REGISTERED_HEADING).waitFor({ state: 'visible' });
    const welcome = page.getByText(CARD.welcome, { exact: true });
    await take(4, { heading: heading(REGISTERED_HEADING), 'welcome email sent': welcome, 'View employee': page.getByRole('link', { name: 'View employee', exact: true }) }, {}, heading(REGISTERED_HEADING), REGISTERED_HEADING);

    // 06: Thandi's page, the Invite link card with the 09:00 times.
    await page.getByRole('link', { name: 'View employee', exact: true }).click();
    await heading('Invite link').waitFor({ state: 'visible' });
    const invite = main.locator('pp-card').filter({ has: heading('Invite link') });
    const rows = async (w: { sent: string; expires: string }, n: string) => {
      const text = (await invite.innerText()).replace(/\s+/g, ' ');
      if (!text.includes(`Link sent ${w.sent}`) || !text.includes(`Link expires ${w.expires}`)) throw new Error(`reference ${n}: the Invite link card is not as on the card (${text})`);
      return { heading: heading('Invite link'), 'Link sent': invite.getByText(w.sent, { exact: true }), 'Link expires': invite.getByText(w.expires, { exact: true }), 'Resend link': invite.getByRole('button', { name: 'Resend link', exact: true }) };
    };
    await take(5, await rows(CARD.invite.sentWords, '06'), {}, heading('Invite link'), 'Invite link');

    // 07: after Resend link, the 09:05 times.
    await invite.getByRole('button', { name: 'Resend link', exact: true }).click();
    await invite.getByText(CARD.invite.resentWords.sent, { exact: true }).waitFor({ state: 'visible' });
    await take(6, await rows(CARD.invite.resentWords, '07'), {}, heading('Invite link'), 'Invite link');

    return { width, cssWidth: use.viewport.width, home, pictures, regions, placements };
  } finally {
    await context.close();
  }
}
