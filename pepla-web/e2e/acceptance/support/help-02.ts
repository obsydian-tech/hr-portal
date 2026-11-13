import type { Browser, Locator, Page } from '@playwright/test';
import * as company from '../../fixtures/help-company';
import { HELP_NEW_EMPLOYEES, HELP_PEOPLE } from '../../fixtures/help-company';
import { HELP_TODAY } from '../../support/help';
import { CognitoFake } from './cognito-fake';
import { SignInPage } from './fixtures';
import { HELP_HR, answerHelpEmployees, projectUse, type Box, type Width } from './journey-harness';

/**
 * HELP-02 · Help pictures: HR sees who is starting (Jira NH-159).
 *
 * What the card says Johan Botha's page shows, the reference pictures built
 * from it, and the recorder script that watches the journey's page.
 * Nothing here calls an AI service or any AWS service.
 */

const APP = process.env['E2E_BASE_URL'] ?? 'http://localhost:4310'; // acceptance playwright.config.ts

/** The card's table "Johan's page, from the fixture". */
export const JOHAN = {
  id: 'sunbird-johan-botha',
  name: 'Johan Botha',
  jobTitle: 'Delivery driver',
  department: 'Delivery',
  email: 'johan@example.com',
  starts: 'Starts 2 Mar 2026',
  hrPartner: 'HR partner: Pieter van Wyk',
  step: 'In review',
  documents: [
    { type: 'National ID', file: 'johan-id.pdf', uploaded: 'Uploaded 26 Feb 2026', check: 'Matches', decision: 'Not decided' },
    { type: 'Bank confirmation', file: 'johan-bank-letter.pdf', uploaded: 'Uploaded 26 Feb 2026', check: 'Needs a look', decision: 'Not decided' },
  ],
  notUploaded: ['Matric certificate', 'Tertiary qualification'],
} as const;

/** HR home's four steps (ONB-02); with Sunbird Bakery's four new employees, 1 each. */
export const STEPS = ['Invited', 'Documents', 'In review', 'Verified'] as const;

// ---------------------------------------------------------------- what help-company.ts holds

/** Every string anywhere in the exports of e2e/fixtures/help-company.ts. */
export function fixtureStrings(): string[] {
  const out: string[] = [];
  const seen = new Set<unknown>();
  const walk = (v: unknown) => {
    if (typeof v === 'string') out.push(v);
    else if (v && typeof v === 'object' && !seen.has(v)) {
      seen.add(v);
      for (const x of Object.values(v as Record<string, unknown>)) walk(x);
    }
  };
  walk(company);
  return out;
}

/** Strings in the fixture that read as a 13-digit South African ID number (spaces ignored). */
export function fixtureIdNumbers(): string[] {
  return [...new Set(fixtureStrings().map((s) => s.replace(/\s/g, '')).filter((s) => /^\d{13}$/.test(s)))];
}

/** The South African ID check digit (Luhn) holds. */
export function idCheckDigitHolds(id: string): boolean {
  let total = 0;
  [...id].reverse().forEach((ch, i) => {
    let d = Number(ch);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    total += d;
  });
  return total % 10 === 0;
}

/** HELP_NEW_EMPLOYEES as it was locked by HELP-01.2. It must not change. */
export const LOCKED_NEW_EMPLOYEES = [
  { employee_id: 'sunbird-thandi-mahlangu', first_name: 'Thandi', last_name: 'Mahlangu', email: 'thandi@example.com', department: 'Bakery', stage: 'INVITED', planned_start_date: '2026-03-16', hr_staff_name: 'Pieter van Wyk' },
  { employee_id: 'sunbird-lerato-nkosi', first_name: 'Lerato', last_name: 'Nkosi', email: 'lerato@example.com', department: 'Shop', stage: 'ACTIVE', planned_start_date: '2026-03-09', hr_staff_name: 'Pieter van Wyk' },
  { employee_id: 'sunbird-johan-botha', first_name: 'Johan', last_name: 'Botha', email: 'johan@example.com', department: 'Delivery', stage: 'DOCUMENTS_SUBMITTED', planned_start_date: '2026-03-02', hr_staff_name: 'Pieter van Wyk' },
  { employee_id: 'sunbird-sipho-mokoena', first_name: 'Sipho', last_name: 'Mokoena', email: 'sipho@example.com', department: 'Bakery', stage: 'VERIFIED', planned_start_date: '2026-02-16', hr_staff_name: 'Pieter van Wyk' },
];

/** First names, last names and full names of every help-company person. */
export function peopleNames(): string[] {
  const out = new Set<string>();
  for (const p of HELP_PEOPLE) {
    const [first, ...last] = p.name.split(' ');
    out.add(p.name);
    out.add(first!);
    out.add(last.join(' '));
  }
  return [...out];
}

/** A journey's source with its comments taken out, so only code is checked. */
export function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

// ---------------------------------------------------------------- the watcher, inside the recorder

/** A South African phone number in any usual spelling. */
export const PHONE = /(?:\+27|\b0)[\s-]?\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/;

/**
 * More recorder script (journey-harness FrontMode 'record', `extra`). Every 40 ms it sends:
 * - scroll "x,y" when the window's scroll position changes;
 * - reveal when a masked value is shown (pp-masked--revealed);
 * - text "id" when the page text holds the full ID number (spaces and dashes ignored);
 * - text "email:<address>" and "phone:<number>" for each one the page text shows.
 */
export function watcher(fullId: string): string {
  return `
  const full = ${JSON.stringify(fullId)};
  const phone = new RegExp(${JSON.stringify(PHONE.source)}, 'g');
  let lastScroll = '';
  let revealed = false;
  let idShown = false;
  const said = new Set();
  setInterval(() => {
    const at = Math.round(window.scrollX) + ',' + Math.round(window.scrollY);
    if (at !== lastScroll) { lastScroll = at; send('scroll', at); }
    const r = !!document.querySelector('.pp-masked--revealed');
    if (r && !revealed) send('reveal', 'masked field');
    revealed = r;
    const text = document.body ? document.body.innerText : '';
    const has = full !== '' && text.replace(/[\\s-]/g, '').includes(full);
    if (has && !idShown) send('text', 'id');
    idShown = has;
    for (const m of text.match(/[\\w.+-]+@[\\w-]+(\\.[\\w-]+)+/g) || []) if (!said.has('e' + m)) { said.add('e' + m); send('text', 'email:' + m); }
    for (const m of text.match(phone) || []) if (!said.has('p' + m)) { said.add('p' + m); send('text', 'phone:' + m); }
  }, 40);`;
}

// ---------------------------------------------------------------- reference pictures

export type WhoIsStartingReference = {
  width: Width;
  cssWidth: number;
  pictures: [Buffer, Buffer, Buffer];
  regions: [Record<string, Box>, Record<string, Box>, Record<string, Box>];
};

/** GET <document upload API>/v1/employees/sunbird-johan-botha/verifications, on any host but the app's. */
const JOHAN_API = (url: URL): boolean => url.pathname === `/v1/employees/${JOHAN.id}/verifications` && url.origin !== new URL(APP).origin;

/** What the document upload API answers for Johan, made from the card's table and the fixture's ID number. */
function johanAnswer(idNumber: string): unknown {
  const p = HELP_PEOPLE.find((x) => x.name === JOHAN.name)!;
  const e = HELP_NEW_EMPLOYEES.find((x) => x.employee_id === JOHAN.id)!;
  return {
    employee: {
      employee_id: e.employee_id,
      first_name: e.first_name,
      last_name: e.last_name,
      email: e.email,
      phone: '',
      stage: e.stage,
      department: e.department,
      job_title: p.title,
      planned_start_date: e.planned_start_date,
      hr_staff_name: e.hr_staff_name,
    },
    documents: [
      { document_id: 'ref-id', document_type: 'NATIONAL_ID', file_name: JOHAN.documents[0].file, uploaded_at: '2026-02-26T08:00:00Z', check: 'MATCHES', hr_decision: null, hr_decided_at: null, verification: { id_number: idNumber, id_number_last4: idNumber.slice(-4) } },
      { document_id: 'ref-bank', document_type: 'BANK_CONFIRMATION', file_name: JOHAN.documents[1].file, uploaded_at: '2026-02-26T08:00:00Z', check: 'NEEDS_A_LOOK', hr_decision: null, hr_decided_at: null, verification: null },
    ],
  };
}

async function box(loc: Locator): Promise<Box> {
  const b = await loc.boundingBox();
  if (!b) throw new Error(`reference: ${loc} has no box`);
  return b;
}

/** The part is on screen and nothing (a top bar, a caption) covers its middle. */
async function uncovered(page: Page, loc: Locator, what: string): Promise<void> {
  const ok = await loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight || r.height === 0) return false;
    const hit = document.elementFromPoint(r.left + Math.min(8, r.width / 2), r.top + r.height / 2);
    return !!hit && (el === hit || el.contains(hit));
  });
  if (!ok) throw new Error(`reference 03: ${what} is not fully on screen and uncovered`);
}

/**
 * The three pictures as they should look, taken here with the journeys' own
 * settings (size, scale, clock, locale), the same Cognito fake and employees
 * answer as HELP-01, and Johan's page answered from the card's table. Each is
 * checked against the card before it is used.
 *
 * `scroll` is where the journey's window was when it took 03 (the recorder's
 * last scroll position). The reference scrolls there and checks that, at that
 * position, the Documents heading sits in the top third of the window with
 * nothing over it, and both document cards show their check and decision.
 */
export async function whoIsStartingReference(
  browser: Browser,
  width: Width,
  idNumber: string,
  scroll: { x: number; y: number },
): Promise<WhoIsStartingReference> {
  const use = projectUse(width);
  const context = await browser.newContext({ ...use, baseURL: APP });
  try {
    const fake = new CognitoFake([{ email: HELP_HR.email, givenName: HELP_HR.givenName, familyName: HELP_HR.familyName, groups: ['hr_staff'] }]);
    await fake.install(context);
    await answerHelpEmployees(context);
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, OPTIONS' };
    await context.route(JOHAN_API, (route) =>
      route.request().method() === 'OPTIONS'
        ? route.fulfill({ status: 204, headers: cors })
        : route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(johanAnswer(idNumber)) }),
    );
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    await page.clock.setFixedTime(HELP_TODAY);
    const shot = async () => {
      await page.waitForLoadState('networkidle');
      return page.screenshot({ animations: 'disabled', caret: 'hide' });
    };

    // Sign in with no pictures, as the journey does.
    const signIn = new SignInPage(page);
    await signIn.open();
    await signIn.email.fill(HELP_HR.email);
    await signIn.password.fill('made-up-password');
    await signIn.submit.click();

    // 01: HR home, the four new employees, a count of 1 per step.
    const greeting = page.getByRole('heading', { name: `Welcome back, ${HELP_HR.givenName}`, exact: true });
    await greeting.waitFor({ state: 'visible' });
    const links: Record<string, Box> = {};
    for (const p of HELP_NEW_EMPLOYEES) {
      const link = page.getByRole('link', { name: `${p.first_name} ${p.last_name}`, exact: true });
      await link.waitFor({ state: 'visible' });
      links[p.employee_id] = await box(link);
    }
    for (const step of STEPS) {
      const stat = page.locator('pp-stat').filter({ hasText: step }).first();
      await stat.waitFor({ state: 'visible' });
      const text = (await stat.innerText()).replace(/\s+/g, ' ');
      if (!/\b1\b/.test(text)) throw new Error(`reference 01: the ${step} count is not 1 (${text})`);
    }
    const stats = await box(page.locator('pp-stat').first());
    const r1 = { greeting: await box(greeting), stats, ...links };
    const p1 = await shot();

    // 02: Johan's page, the top.
    await page.getByRole('link', { name: JOHAN.name, exact: true }).click();
    const name = page.getByRole('heading', { name: JOHAN.name, exact: true });
    await name.waitFor({ state: 'visible' });
    const header = page.locator('pp-person-header');
    await header.getByText(JOHAN.hrPartner).waitFor({ state: 'visible' });
    const headerText = await header.innerText();
    const lines = headerText.split('\n').map((l) => l.replace(/^(Department|Email|Employee ID):\s*/, '').trim());
    for (const part of [JOHAN.name, JOHAN.step, JOHAN.jobTitle, JOHAN.department, JOHAN.email, JOHAN.id, JOHAN.starts, JOHAN.hrPartner]) {
      if (!lines.includes(part)) throw new Error(`reference 02: the header does not show "${part}" (${lines.join(' | ')})`);
    }
    if (PHONE.test(headerText) || /phone/i.test(headerText)) throw new Error('reference 02: the header shows a phone');
    const r2 = { header: await box(header) };
    const p2 = await shot();

    // 03: the documents, at the journey's scroll position.
    await page.evaluate(({ x, y }) => window.scrollTo({ left: x, top: y, behavior: 'instant' }), scroll);
    const documents = page.getByRole('heading', { name: 'Documents', exact: true });
    await uncovered(page, documents, 'the Documents heading');
    const headingTop = (await box(documents)).y;
    if (headingTop > use.viewport.height / 3) throw new Error(`reference 03: the Documents heading is not in the top third of the window (at ${Math.round(headingTop)} px)`);
    const r3: Record<string, Box> = { documents: await box(documents) };
    for (const d of JOHAN.documents) {
      const card = page.locator('pp-verification').filter({ hasText: d.type }).first();
      for (const line of [d.type, `${d.file} · ${d.uploaded}`, `Check: ${d.check}`, `HR decision: ${d.decision}`]) {
        await uncovered(page, card.getByText(line, { exact: true }).first(), `${d.type}: "${line}"`);
      }
      r3[d.type] = await box(card.getByText(`HR decision: ${d.decision}`, { exact: true }));
      r3[`${d.type} heading`] = await box(card.getByText(d.type, { exact: true }).first());
    }
    const masked = page.locator('pp-masked-field').first();
    const maskedText = await masked.innerText();
    if (!maskedText.includes(idNumber.slice(-4)) || maskedText.replace(/\s/g, '').includes(idNumber)) {
      throw new Error(`reference 03: the ID number is not masked to its last four digits (${maskedText})`);
    }
    await uncovered(page, masked, 'the masked ID number');
    r3['id'] = await box(masked);
    for (const t of JOHAN.notUploaded) {
      const card = page.locator('pp-card').filter({ hasText: t }).first();
      if (!(await card.innerText()).includes('Not uploaded yet')) throw new Error(`reference 03: ${t} is not "Not uploaded yet"`);
    }
    const p3 = await shot();

    return { width, cssWidth: use.viewport.width, pictures: [p1, p2, p3], regions: [r1, r2, r3] };
  } finally {
    await context.close();
  }
}
