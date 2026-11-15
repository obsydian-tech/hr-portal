import type { Browser, BrowserContext, Locator, Page, Route } from '@playwright/test';
import { HELP_JOHAN_DETAIL } from '../../fixtures/help-company';
import { HELP_TODAY } from '../../support/help';
import { CognitoFake } from './cognito-fake';
import { SignInPage } from './fixtures';
import { PHONE } from './help-02';
import { HELP_HR, answerHelpEmployees, projectUse, type Box, type Width } from './journey-harness';
import { settleFonts } from './fonts';

/**
 * HELP-03 · Help pictures: HR checks a document (Jira NH-167).
 *
 * What the card says the five pictures show, the reference pictures built from
 * it, and the recorder script that watches the journey's page.
 * Nothing here calls an AI service or any AWS service.
 */

const APP = process.env['E2E_BASE_URL'] ?? 'http://localhost:4310'; // acceptance playwright.config.ts

// ---------------------------------------------------------------- the card's tables

/** The reason HR types for the bank letter (card, Decision 3). Sample data, held in help-company.ts. */
export const REASON = 'The account number cannot be read. Upload a clearer copy of the bank letter.';

/**
 * "Data" in the card. Where the card leaves a value open, the verifier chose it and the review
 * note says so: the check time (the upload minute) and how sure Batsi is of the bank letter (40,
 * "needs a check"; it is not in any picture).
 */
export const CARD = {
  employee: { id: 'sunbird-johan-botha', name: 'Johan Botha', first: 'Johan', last: 'Botha' },
  uploaded: '2026-02-26T08:00:00Z',
  checked: '2026-02-26T08:00:00Z',
  arrived: '26 Feb 2026',
  id: {
    id: 'sunbird-johan-id',
    type: 'NATIONAL_ID',
    typeName: 'National ID',
    file: 'johan-id.pdf',
    check: 'MATCHES',
    checkWord: 'Matches',
    confidence: 96,
    comparisons: [
      { field: 'SURNAME', result: 'AGREES', words: 'Surname matches the record' },
      { field: 'ID_NUMBER', result: 'AGREES', words: 'ID number ends in the same 4 digits as the record' },
    ],
    decidedAt: '2026-03-02T07:00:00Z',
    decision: 'ACCEPTED',
    lozenge: 'Accepted',
    line: 'Accepted by Pieter van Wyk on 2 Mar 2026 at 09:00.',
  },
  bank: {
    id: 'sunbird-johan-bank',
    type: 'BANK_CONFIRMATION',
    typeName: 'Bank confirmation',
    file: 'johan-bank-letter.pdf',
    check: 'NEEDS_A_LOOK',
    checkWord: 'Needs a look',
    confidence: 40,
    accountHolder: 'J Botha',
    comparisons: [{ field: 'ACCOUNT_HOLDER', result: 'AGREES', words: 'Account holder includes the surname on the record' }],
    decidedAt: '2026-03-02T07:05:00Z',
    decision: 'NEW_ONE_ASKED',
    lozenge: 'New one asked for',
    line: 'New one asked for by Pieter van Wyk on 2 Mar 2026 at 09:05.',
  },
  saved: 'Your choice is recorded with your name and the time.',
} as const;

export type CardDoc = typeof CARD.id | typeof CARD.bank;
/** The document link's name on Documents to check, and the document page's heading. */
export const docName = (d: CardDoc): string => `${d.typeName}, ${CARD.employee.name}`;

/** HELP_NEW_EMPLOYEE_STEPS as ONB-09 / HELP-02.3 left it. It must not change. */
export const LOCKED_STEPS = {
  'sunbird-thandi-mahlangu': 'INVITED',
  'sunbird-lerato-nkosi': 'DOCUMENTS',
  'sunbird-johan-botha': 'IN_REVIEW',
  'sunbird-sipho-mokoena': 'VERIFIED',
};

/** HELP_JOHAN_DETAIL as HELP-02 / HELP-02.3 left it, with its made-up ID number. It must not change. */
export const LOCKED_JOHAN_DETAIL = {
  employee: {
    employee_id: 'sunbird-johan-botha', first_name: 'Johan', last_name: 'Botha', email: 'johan@example.com', department: 'Delivery',
    stage: 'DOCUMENTS_SUBMITTED', planned_start_date: '2026-03-02', hr_staff_name: 'Pieter van Wyk', step: 'IN_REVIEW', phone: '', job_title: 'Delivery driver',
  },
  documents: [
    {
      document_id: 'sunbird-johan-id', document_type: 'NATIONAL_ID', file_name: 'johan-id.pdf', uploaded_at: '2026-02-26T08:00:00Z',
      check: 'MATCHES', hr_decision: null, hr_decided_at: null, verification: { id_number: '8500015009087', id_number_last4: '9087' },
    },
    {
      document_id: 'sunbird-johan-bank', document_type: 'BANK_CONFIRMATION', file_name: 'johan-bank-letter.pdf', uploaded_at: '2026-02-26T08:00:00Z',
      check: 'NEEDS_A_LOOK', hr_decision: null, hr_decided_at: null, verification: null,
    },
  ],
};

// ---------------------------------------------------------------- the watcher, inside the recorder

/**
 * More recorder script (journey-harness FrontMode 'record', `extra`). It sends:
 * - scroll "x,y,mx,my" when the scroll position of the window (x,y) or of the app's main area
 *   (#main, which scrolls on desktop: mx,my) changes (every 40 ms);
 * - shot "x,y,mx,my" when the help caption is taken down, which help.shot does right before a picture;
 * - reveal when a hidden value is shown (pp-masked--revealed);
 * - text "id" when the page text holds the full ID number (spaces and dashes ignored);
 * - text "email:<address>" and "phone:<number>" for each one the page text shows;
 * - input "<label>" when someone types in a text area (the recorder itself only sees inputs);
 * - call {"m","u","auth","body"} for every request the page itself makes (fetch and XHR),
 *   with whether it carried a Bearer token;
 * - answer {"u","body"} for every answer from the document upload API.
 */
export function watcher(fullId: string, documentApi: string): string {
  return `
  const full = ${JSON.stringify(fullId)};
  const docApi = ${JSON.stringify(documentApi)};
  const phone = new RegExp(${JSON.stringify(PHONE.source)}, 'g');
  const isBeacon = (u) => String(u).includes('/__journey/event');
  const bearer = (v) => /^Bearer \\S+$/.test(String(v || ''));
  const say = (type, o) => send(type, JSON.stringify(o));

  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!isBeacon(u)) {
      let auth = false;
      try {
        const h = new Headers((init && init.headers) || (input instanceof Request ? input.headers : undefined));
        auth = bearer(h.get('authorization'));
      } catch (e) {}
      const m = ((init && init.method) || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      const full = new URL(u, location.href).href;
      say('call', { m, u: full, auth, body: init && typeof init.body === 'string' ? init.body : '' });
      const answer = realFetch(input, init);
      if (full.startsWith(docApi)) answer.then((r) => r.clone().text()).then((body) => say('answer', { u: full, body }), () => {});
      return answer;
    }
    return realFetch(input, init);
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
      if (x.__u.startsWith(docApi)) x.addEventListener('loadend', () => say('answer', { u: x.__u, body: typeof x.responseText === 'string' ? x.responseText : '' }));
    }
    return xsend.apply(this, arguments);
  };

  let lastArea = '';
  document.addEventListener('click', () => { lastArea = ''; }, true);
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLTextAreaElement)) return;
    const name = (t.labels && t.labels[0] && t.labels[0].textContent) || t.getAttribute('aria-label') || '';
    if (name !== lastArea) { lastArea = name; send('input', name); }
  }, true);

  let lastScroll = '';
  let captionUp = false;
  let revealed = false;
  let idShown = false;
  const said = new Set();
  setInterval(() => {
    const main = document.getElementById('main');
    const at = [window.scrollX, window.scrollY, main ? main.scrollLeft : 0, main ? main.scrollTop : 0].map(Math.round).join(',');
    if (at !== lastScroll) { lastScroll = at; send('scroll', at); }
    const c = document.getElementById('__help_caption');
    const up = !!c && c.style.display !== 'none';
    if (captionUp && !up) send('shot', at);
    captionUp = up;
    const r = !!document.querySelector('.pp-masked--revealed');
    if (r && !revealed) send('reveal', 'hidden field');
    revealed = r;
    const text = document.body ? document.body.innerText : '';
    const has = full !== '' && text.replace(/[\\s-]/g, '').includes(full);
    if (has && !idShown) send('text', 'id');
    idShown = has;
    for (const m of text.match(/[\\w.+-]+@[\\w-]+(\\.[\\w-]+)+/g) || []) if (!said.has('e' + m)) { said.add('e' + m); send('text', 'email:' + m); }
    for (const m of text.match(phone) || []) if (!said.has('p' + m)) { said.add('p' + m); send('text', 'phone:' + m); }
  }, 40);`;
}

// ---------------------------------------------------------------- the document upload API, from the card

const json = (route: Route, status: number, body: unknown, cors: Record<string, string>) =>
  route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });

function pageAnswer(d: CardDoc, idNumber: string, decided: Record<string, unknown> | undefined): unknown {
  const read =
    d.type === 'NATIONAL_ID'
      ? { name: CARD.employee.first, surname: CARD.employee.last, id_number: idNumber, id_number_last4: idNumber.slice(-4) }
      : { account_holder: CARD.bank.accountHolder, bank_name: null, account_number: null, branch_code: null, account_type: null };
  return {
    document: { document_id: d.id, employee_id: CARD.employee.id, document_type: d.type, file_name: d.file, uploaded_at: CARD.uploaded, ocr_completed_at: CARD.checked },
    employee: { employee_id: CARD.employee.id, first_name: CARD.employee.first, last_name: CARD.employee.last },
    verification: { confidence: d.confidence, extracted_data: read },
    check: d.check,
    hr_decision: null,
    hr_decided_at: null,
    comparisons: d.comparisons.map(({ field, result }) => ({ field, result })),
    ...decided,
  };
}

/** Documents to check and the two document pages as the card describes them, keeping the decisions for the run. */
async function answerDocuments(context: BrowserContext, idNumber: string): Promise<void> {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, idempotency-key', 'access-control-allow-methods': 'GET, PATCH, OPTIONS' };
  const decided = new Map<string, Record<string, unknown>>();
  const docs: CardDoc[] = [CARD.id, CARD.bank];
  await context.route(
    (url) => url.pathname.startsWith('/v1/verifications') && url.origin !== new URL(APP).origin,
    (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (req.method() === 'GET' && url.pathname === '/v1/verifications') {
        const waiting = docs.filter((d) => !decided.has(d.id));
        const counts: Record<string, number> = {};
        for (const d of waiting) counts[d.check] = (counts[d.check] ?? 0) + 1;
        const items = waiting.map((d) => ({ document_id: d.id, employee_id: CARD.employee.id, employee_name: CARD.employee.name, document_type: d.type, check: d.check, arrived_at: CARD.uploaded }));
        return json(route, 200, { items, count: items.length, counts }, cors);
      }
      const one = docs.find((d) => url.pathname === `/v1/verifications/${d.id}`);
      if (req.method() === 'GET' && one) return json(route, 200, pageAnswer(one, idNumber, decided.get(one.id)), cors);
      const review = docs.find((d) => url.pathname === `/v1/verifications/${d.id}/review`);
      if (req.method() === 'PATCH' && review) {
        const answer = {
          hr_decision: review.decision,
          hr_decided_at: review.decidedAt,
          hr_decided_by_name: HELP_HR.name,
          hr_decision_reason: review === CARD.bank ? REASON : '',
        };
        decided.set(review.id, answer);
        return json(route, 200, answer, cors);
      }
      return json(route, 404, { message: 'Not found' }, cors);
    },
  );
}

// ---------------------------------------------------------------- reference pictures

/** A scroll position: the window's (x, y) and the app's main area's (mx, my). */
export type Scroll = { x: number; y: number; mx: number; my: number };

/** Puts the window and the app's main area where the journey had them. */
export async function scrollAs(page: Page, at: Scroll): Promise<void> {
  await page.evaluate(({ x, y, mx, my }) => {
    window.scrollTo({ left: x, top: y, behavior: 'instant' });
    document.getElementById('main')?.scrollTo({ left: mx, top: my, behavior: 'instant' });
  }, at);
}

export const PICTURES = ['01-documents-to-check', '02-id-document', '03-id-accepted', '04-reason', '05-new-one-asked'] as const;

/** Where the page heading (02) or the decision card's heading (03 to 05) sits in the picture, in CSS pixels. */
export type Placement = { heading: string; top: number; barBottom: number; uncovered: boolean };

export type ChecksADocumentReference = {
  width: Width;
  cssWidth: number;
  /** HR home, after signing in: the video's first frame. */
  home: Buffer;
  pictures: [Buffer, Buffer, Buffer, Buffer, Buffer];
  regions: [Record<string, Box>, Record<string, Box>, Record<string, Box>, Record<string, Box>, Record<string, Box>];
  /** Index 0 is picture 02, and so on to 05. */
  placements: [Placement, Placement, Placement, Placement];
};

async function box(loc: Locator, what: string): Promise<Box> {
  const b = await loc.boundingBox();
  if (!b) throw new Error(`reference: ${what} has no box`);
  return b;
}

/** The part is in the window and nothing (a top bar, a caption, a drawer) covers its middle. */
async function uncovered(loc: Locator, what: string): Promise<void> {
  // A drawer or a card may still be moving into place: give it up to 3 seconds.
  let ok = false;
  for (let i = 0; i < 30 && !ok; i++) {
    ok = await isUncovered(loc);
    if (!ok) await loc.page().waitForTimeout(100);
  }
  if (!ok) throw new Error(`reference: ${what} is not fully in the picture and uncovered`);
}

async function isUncovered(loc: Locator): Promise<boolean> {
  return loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight || r.height === 0) return false;
    const hit = document.elementFromPoint(r.left + Math.min(8, r.width / 2), r.top + r.height / 2);
    return !!hit && (el === hit || el.contains(hit));
  });
}

/** The bottom of a fixed or sticky top bar ([role=banner]), 0 when there is none. */
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
 * The five pictures as they should look, taken here with the journeys' own
 * settings (size, scale, clock, locale), the same Cognito fake and employees
 * answer as HELP-01 and HELP-02, and the document upload API answered from
 * the card's tables. Each picture is checked against the card before it is used.
 *
 * `shots` are where the journey's window was when it took each picture (the
 * watcher's "shot" events). The reference scrolls to the same place, so the
 * pictures can differ only in what the page shows.
 */
export async function checksADocumentReference(
  browser: Browser,
  width: Width,
  idNumber: string,
  shots: Scroll[],
): Promise<ChecksADocumentReference> {
  if (shots.length !== PICTURES.length) throw new Error(`reference: the journey took ${shots.length} pictures, not ${PICTURES.length}`);
  const use = projectUse(width);
  const context = await browser.newContext({ ...use, baseURL: APP });
  try {
    const fake = new CognitoFake([{ email: HELP_HR.email, givenName: HELP_HR.givenName, familyName: HELP_HR.familyName, groups: ['hr_staff'] }]);
    await fake.install(context);
    await answerHelpEmployees(context, { steps: true });
    await answerDocuments(context, idNumber);
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    await page.clock.setFixedTime(HELP_TODAY);
    const shot = async (i: number) => {
      // No hover: the pointer rests in the top-left corner, away from every button.
      await page.mouse.move(1, 1);
      await scrollAs(page, shots[i]!);
      await page.waitForLoadState('networkidle');
      await settleFonts(page);
      return page.screenshot({ animations: 'disabled', caret: 'hide' });
    };
    const heading = (name: string) => page.getByRole('heading', { name, exact: true });

    // Sign in. HR home is the video's first frame.
    const signIn = new SignInPage(page);
    await signIn.open();
    await signIn.email.fill(HELP_HR.email);
    await signIn.password.fill('made-up-password');
    await signIn.submit.click();
    await heading(`Welcome back, ${HELP_HR.givenName}`).waitFor({ state: 'visible' });
    await page.getByRole('link', { name: CARD.employee.name, exact: true }).waitFor({ state: 'visible' });
    await page.waitForLoadState('networkidle');
    await settleFonts(page);
    const home = await page.screenshot({ animations: 'disabled', caret: 'hide' });

    // 01: Documents to check, from the sidebar (on the phone, behind Open menu).
    if (width === 'phone') await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Documents to check', exact: true }).click();
    await heading('Documents to check').waitFor({ state: 'visible' });
    await page.getByRole('link', { name: docName(CARD.bank), exact: true }).waitFor({ state: 'visible' });
    const want = { Waiting: 2, 'Needs a look': 1, Matches: 1, "Doesn't match": 0 };
    const r1: Record<string, Box> = {};
    const p1 = await (async () => {
      await scrollAs(page, shots[0]!);
      for (const [label, n] of Object.entries(want)) {
        const stat = page.locator('pp-stat').filter({ has: page.getByText(label, { exact: true }) }).first();
        const text = (await stat.innerText()).replace(/\s+/g, ' ').trim();
        if (!new RegExp(`(^|\\s)${n}(\\s|$)`).test(text)) throw new Error(`reference 01: ${label} is not ${n} (${text})`);
        await uncovered(stat, `01 the ${label} count`);
        r1[`stat ${label}`] = await box(stat, label);
      }
      const rows = page.locator('table tbody tr');
      const texts = (await rows.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
      const expected = [CARD.id, CARD.bank].map((d) => [CARD.employee.name, d.typeName, d.checkWord, CARD.arrived]);
      if (texts.length !== 2) throw new Error(`reference 01: ${texts.length} rows, not 2 (${texts.join(' | ')})`);
      expected.forEach((parts, i) => {
        for (const p of parts) if (!texts[i]!.includes(p)) throw new Error(`reference 01: row ${i + 1} does not show "${p}" (${texts[i]})`);
      });
      for (let i = 0; i < 2; i++) {
        await uncovered(rows.nth(i), `01 row ${i + 1}`);
        r1[`row ${i + 1}`] = await box(rows.nth(i), `row ${i + 1}`);
      }
      return shot(0);
    })();

    // 02: the National ID page, its top: heading, What Batsi found with Matches.
    await page.getByRole('link', { name: docName(CARD.id), exact: true }).click();
    await heading(docName(CARD.id)).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Accept document', exact: true }).waitFor({ state: 'visible' });
    await scrollAs(page, shots[1]!);
    const found = page.locator('pp-verification').first();
    await uncovered(heading(docName(CARD.id)), '02 the page heading');
    await uncovered(found.getByText('What Batsi found', { exact: true }), '02 What Batsi found');
    await uncovered(found.getByText(CARD.id.checkWord, { exact: true }).first(), '02 Matches');
    for (const c of CARD.id.comparisons) await found.getByText(c.words, { exact: true }).waitFor({ state: 'visible' });
    const r2 = { heading: await box(heading(docName(CARD.id)), '02 heading'), found: await box(found.getByText('What Batsi found', { exact: true }), '02 found'), check: await box(found.getByText(CARD.id.checkWord, { exact: true }).first(), '02 check') };
    const pl2 = await placement(page, heading(docName(CARD.id)), docName(CARD.id));
    const p2 = await shot(1);

    // 03: accepted. The Decision card: Accepted, by Pieter van Wyk with the time, and the saved notice.
    await page.getByRole('button', { name: 'Accept document', exact: true }).click();
    await heading('Decision').waitFor({ state: 'visible' });
    await scrollAs(page, shots[2]!);
    const decision = page.locator('pp-card').filter({ has: heading('Decision') });
    const accepted = { lozenge: decision.getByText(CARD.id.lozenge, { exact: true }), line: decision.getByText(CARD.id.line, { exact: true }), saved: decision.getByText(CARD.saved, { exact: true }).first() };
    for (const [part, loc] of Object.entries(accepted)) await uncovered(loc, `03 ${part}`);
    const r3 = { lozenge: await box(accepted.lozenge, '03 lozenge'), line: await box(accepted.line, '03 line'), saved: await box(accepted.saved, '03 saved') };
    const pl3 = await placement(page, heading('Decision'), 'Decision');
    const p3 = await shot(2);

    // Back to the list by the breadcrumb: only the bank letter is left.
    await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Documents to check', exact: true }).click();
    await page.getByRole('link', { name: docName(CARD.bank), exact: true }).waitFor({ state: 'visible' });
    if ((await page.getByRole('link', { name: docName(CARD.id), exact: true }).count()) !== 0) throw new Error('reference: the accepted ID is still waiting');

    // 04: the bank letter, Ask for a new one, the reason typed.
    await page.getByRole('link', { name: docName(CARD.bank), exact: true }).click();
    await heading(docName(CARD.bank)).waitFor({ state: 'visible' });
    const read = page.locator('pp-card').filter({ has: heading('What Batsi read') });
    const readText = (await read.innerText()).replace(/\s+/g, ' ');
    if (!readText.includes(`Account holder ${CARD.bank.accountHolder}`) || !/Account number Not read/.test(readText) || !/Bank Not read/.test(readText)) {
      throw new Error(`reference 04: What Batsi read is not as on the card (${readText})`);
    }
    await page.getByRole('button', { name: 'Ask for a new one', exact: true }).click();
    const reason = page.getByRole('textbox', { name: 'Reason', exact: true });
    await reason.fill(REASON);
    await scrollAs(page, shots[3]!);
    const yours = page.locator('pp-card').filter({ has: heading('Your decision') });
    const asking = {
      reason,
      ask: yours.getByRole('button', { name: 'Ask for a new one', exact: true }),
      cancel: yours.getByRole('button', { name: 'Cancel', exact: true }),
    };
    if ((await reason.inputValue()) !== REASON) throw new Error('reference 04: the Reason box does not hold the reason');
    for (const [part, loc] of Object.entries(asking)) await uncovered(loc, `04 ${part}`);
    const r4 = { reason: await box(reason, '04 reason'), ask: await box(asking.ask, '04 ask'), cancel: await box(asking.cancel, '04 cancel') };
    const pl4 = await placement(page, heading('Your decision'), 'Your decision');
    const p4 = await shot(3);

    // 05: New one asked for, by Pieter van Wyk with the time, and the reason.
    await asking.ask.click();
    await heading('Decision').waitFor({ state: 'visible' });
    await scrollAs(page, shots[4]!);
    const asked = {
      lozenge: decision.getByText(CARD.bank.lozenge, { exact: true }),
      line: decision.getByText(CARD.bank.line, { exact: true }),
      reason: decision.getByText(`Reason: ${REASON}`, { exact: true }),
    };
    for (const [part, loc] of Object.entries(asked)) await uncovered(loc, `05 ${part}`);
    const r5 = { lozenge: await box(asked.lozenge, '05 lozenge'), line: await box(asked.line, '05 line'), reason: await box(asked.reason, '05 reason') };
    const pl5 = await placement(page, heading('Decision'), 'Decision');
    const p5 = await shot(4);

    return {
      width,
      cssWidth: use.viewport.width,
      home,
      pictures: [p1, p2, p3, p4, p5],
      regions: [r1, r2, r3, r4, r5],
      placements: [pl2, pl3, pl4, pl5],
    };
  } finally {
    await context.close();
  }
}

/** Data of the decision bodies the page sent, from the watcher's calls. */
export type Call = { m: string; u: string; auth: boolean; body: string };

/** The fixture strings HELP_JOHAN_DETAIL holds for the two documents, to check the card's ids. */
export const fixtureDocuments = () => HELP_JOHAN_DETAIL.documents.map((d) => ({ id: d.document_id, file: d.file_name }));
