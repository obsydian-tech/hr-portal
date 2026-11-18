import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { date, runModule, sharedModule, REPO as ROOT } from './support/onb-21/due-date-run';
import {
  HANDLER, LAMBDA, LEGACY_NONE, LOGIN_URL, REMINDERS, SENDER, SETTINGS, TENANTS, claims, dynamo, expanded, logLines, plain, projected, runReminders, scheduledEvent,
  type Email, type PostmarkKind, type Row, type Run, type RunOpts, type Tables,
} from './support/onb-21/runner';
import {
  A, B, C, D, DUE, HR_EMAIL, HR_NAME, ID_NUMBER_LAST4, ACCOUNT_NUMBER, NOT_AN_ID, P, START, at, company, doc, oneDue, person, world, type DocState, type Person,
} from './support/onb-21/world';
import { BUTTON, KIT_NAME, SIGNED, w1, w2, w3Text, type DocType } from './support/onb-21/words';
import {
  FUNCTION_NAME, INFRA, REMINDERS_TF, ROLE_NAME, attributes, blocks, conditionKeys, fn, fnLabel, infraFiles, kmsLists, nested, policy, resources, roleLabel, settings, squash,
  targetOf, tablesByLabel, tfvarRaw, unquote,
} from './support/onb-21/terraform';
import { stripComments } from './support/infra-harness';
import { tfvar } from './support/ten-01/tf';

/**
 * ONB-21 · Reminder email (Jira NH-180, epic NH-150 Onboarding). Red.
 * One test per acceptance criterion (some criteria have several tests), written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/ONB-21.md (18 Nov 2026, with the security conditions C-1 to C-8 and AC-9),
 * and ONB-21-security-review.md. Notes: ./cards/onb-21.md.
 *
 * Every day at 06:00 UTC the Lambda `sendDocumentReminders` looks at each company that has the Onboarding module. A person at
 * step DOCUMENTS, with a documents due date 2 days away or less (not past), still owing a required document with no file,
 * gets ONE email listing what is still to upload. This file runs the real Lambda in a fresh Node process per run, against a
 * fake AWS (support/onb-21/fake-aws, copied from TEN-02's with code added): DynamoDB over rows as DynamoDB stores them (the
 * company list, the people, their documents, the claims table), a recording Postmark that can fail per address, a fixed
 * clock, and a Lambda context that says how much time is left. Nothing here sends an email, reaches AWS or calls an AI service:
 * any AWS service but DynamoDB, any AI client and any outbound HTTP call fails the run.
 *
 * "Today" is the Johannesburg calendar date from the clock the test fixes. Dates are never worked out from the day the test
 * runs. A person who starts on 2026-12-01 has documents due 2026-11-24 (ONB-10's rule, 7 days before the start date).
 *
 * The words (W-1 to W-3) are PROPOSED in the spec and wait for Iggie before production. They are in support/onb-21/words.ts only.
 * AC-8's infrastructure checks read infra/*.tf as text; the PR's Terraform plan and a Mac thread on pepla-dev judge the rest.
 * No criterion has a screen, so none runs at 390 wide or on pepla-dev. Locked once accepted: see ./README.md.
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS or reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};
const LAMBDA_FILE = join(LAMBDA, 'sendDocumentReminders', 'index.mjs');
const rel = (f: string) => f.slice(ROOT.length + 1);

// ---------------------------------------------------------------- reading a run

const go = (tables: Tables, today = '2026-11-22', extra: Partial<RunOpts> = {}): Run => runReminders({ tables, now: at(today), ...extra });
const recipients = (run: Run) => run.sent.map((e) => e.To);
const idsClaimed = (run: Run) => [...new Set(claims(run.tables).map((c) => c['employee_id'] as string))].sort();
const list = (...types: DocType[]) => types.map((t) => KIT_NAME[t]).join(', ');
const BOTH: DocType[] = ['NATIONAL_ID', 'BANK_CONFIRMATION'];
const squashWhite = (s: string) => s.replace(/\s+/g, ' ').trim();
const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&apos;': "'" };
/** What a mail program shows from the HTML: tags out, entities read, white space as one space. */
const shownFromHtml = (html: string) =>
  squashWhite(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&(amp|lt|gt|quot|#39|#x27|apos);/g, (m) => ENTITIES[m]!));
const allText = (e: Email) => [e.Subject, e.TextBody, e.HtmlBody, e.To, e.From].map((x) => String(x ?? '')).join('\n');
/** The addresses a message goes to, whatever header carries them. */
const addressesOf = (e: Email) => [e['To'], e['Cc'], e['Bcc']].filter(Boolean).map(String);

/** The one summary line of a run (it names what was sent, refused and failed), or undefined. */
const summaryOf = (run: Run) => logLines(run).find((l) => /\bsent\b/i.test(l) && /\brefused\b/i.test(l) && /\bfailed\b/i.test(l));
/** The number right after a word in the summary line: `"sent":2`, `sent 2`, `sent: 2`. */
const countIn = (line: string | undefined, word: string): number | undefined => {
  const m = new RegExp(`\\b${word}\\W{1,4}(\\d+)`, 'i').exec(line ?? '');
  return m ? Number(m[1]) : undefined;
};

const NAMES = Object.values(P).flatMap((p) => [p.first, p.last]);
const ADDRESSES = Object.values(P).map((p) => p.email);
const POSTMARK_WORDS = [
  'Inactive recipients', 'hard bounce', 'Found inactive addresses', 'Illegal email domain', 'Invalid email request', 'ETIMEDOUT', 'ENOTFOUND', 'api.postmarkapp.com',
  'Postmark had a problem', 'Rate limit exceeded', 'No Account or Server API tokens',
];
/** AC-3, C-6a: no address, no name, no Postmark text and no `.message` in a log line or in the error the run ends with. */
function expectNoPersonalText(run: Run, why: string) {
  const texts = [...logLines(run), run.error?.message ?? '', run.error?.stack ?? ''];
  for (const t of texts) {
    for (const a of ADDRESSES) expect(t, `${why}: an address in "${t.slice(0, 160)}"`).not.toContain(a);
    for (const n of NAMES) expect(t, `${why}: the name ${n} in "${t.slice(0, 160)}"`).not.toContain(n);
    for (const w of POSTMARK_WORDS) expect(t, `${why}: Postmark's words "${w}" in "${t.slice(0, 160)}"`).not.toContain(w);
  }
  for (const t of [...logLines(run), run.error?.message ?? '']) expect(t, `${why}: an "@" in "${t.slice(0, 160)}"`).not.toContain('@');
}

/** Three people of A, all owing both documents. */
const three = () => world({ people: [person(P.naledi, A), person(P.sipho, A), person(P.thandi, A)] });

// ---------------------------------------------------------------- a copy of the Lambda tree with one shared file replaced

/** Copies lambda/sendDocumentReminders and lambda/shared to a new folder, changes the files given, returns the handler there. */
function treeWith(changes: Record<string, (src: string) => string>): string {
  const root = mkdtempSync(join(tmpdir(), 'onb-21-tree-'));
  for (const dir of ['sendDocumentReminders', 'shared']) {
    cpSync(join(LAMBDA, dir), join(root, dir), { recursive: true, filter: (s) => !/node_modules|coverage|\.test\.(m?js)$/.test(s) });
  }
  for (const [file, change] of Object.entries(changes)) {
    const p = join(root, file);
    writeFileSync(p, change(existsSync(p) ? readFileSync(p, 'utf8') : ''));
  }
  return join(root, 'sendDocumentReminders', 'index.mjs');
}

// ================================================================ AC-1 One reminder, inside the window

test.describe('AC-1 one reminder, inside the window', () => {
  test('AC-1 a person at step Documents, due 2026-11-24, owing both documents, gets exactly one email on 2026-11-22, listing both', ({}, testInfo) => {
    once(testInfo.project.name);
    const run = go(oneDue());
    expect(run.error, `the run ends without an error: ${run.error?.message}`).toBeUndefined();
    expect(run.sent).toHaveLength(1);
    expect(addressesOf(run.sent[0]!)).toEqual([P.naledi.email]);
    expect(run.sent[0]!.From).toBe(SENDER);
    const shown = shownFromHtml(run.sent[0]!.HtmlBody ?? '');
    expect(shown).toContain(list(...BOTH));
    expect(shown).toContain('24 Nov 2026');
    expect(run.refused).toHaveLength(0);
  });

  for (const [today, count, why] of [
    ['2026-11-20', 0, '4 days before the due date'],
    ['2026-11-21', 0, '3 days before the due date'],
    ['2026-11-22', 1, '2 days before the due date'],
    ['2026-11-23', 1, '1 day before the due date'],
    ['2026-11-24', 1, 'the due date itself'],
    ['2026-11-25', 0, 'the day after the due date (overdue)'],
    ['2026-12-01', 0, 'the start date (long overdue)'],
  ] as const) {
    test(`AC-1 on ${today}, ${why}: ${count ? 'one email' : 'nothing is sent'}`, ({}, testInfo) => {
      once(testInfo.project.name);
      const run = go(oneDue(), today);
      expect(run.error, `the run ends without an error: ${run.error?.message}`).toBeUndefined();
      expect(run.sent).toHaveLength(count);
      expect(claims(run.tables)).toHaveLength(count ? 2 : 0);
    });
  }

  test('AC-1 the Johannesburg calendar date decides, not the UTC one', ({}, testInfo) => {
    once(testInfo.project.name);
    // 22:30 UTC on the 21st is 00:30 on the 22nd in South Africa: inside the window (UTC would still say the 21st).
    const early = runReminders({ tables: oneDue(), now: '2026-11-21T22:30:00Z' });
    expect(early.error, `no error: ${early.error?.message}`).toBeUndefined();
    expect(early.sent, 'the 22nd has begun in South Africa').toHaveLength(1);
    // 22:30 UTC on the 24th is 00:30 on the 25th in South Africa: overdue (UTC would still say the 24th).
    const late = runReminders({ tables: oneDue(), now: '2026-11-24T22:30:00Z' });
    expect(late.error, `no error: ${late.error?.message}`).toBeUndefined();
    expect(late.sent, 'the 25th has begun in South Africa').toHaveLength(0);
    // 21:59 UTC on the 21st is 23:59 on the 21st: still outside.
    const before = runReminders({ tables: oneDue(), now: '2026-11-21T21:59:00Z' });
    expect(before.sent, 'it is still the 21st in South Africa').toHaveLength(0);
  });

  test('AC-1 a start date that is empty, malformed, impossible or missing gets nothing and never stops the run', ({}, testInfo) => {
    once(testInfo.project.name);
    const bad = ['', 'soon', '2026-02-30', '2026-13-01', '2026-12-1', undefined].map((start, i) => ({ id: `EMP-29${i}0`, first: 'Test', last: `Person${i}`, email: `bad.start.${i}@kestrel.example`, start }));
    const people = [
      ...bad.map((b) => person(b, A, { planned_start_date: b.start })),
      person(P.naledi, A),
    ];
    const run = go(world({ people }));
    expect(run.error, `the run does not stop: ${run.error?.message}`).toBeUndefined();
    expect(recipients(run), 'only the person with a real start date is emailed').toEqual([P.naledi.email]);
    expect(idsClaimed(run)).toEqual([P.naledi.id]);
  });

  test('AC-1 the module lambda/shared/due-date.mjs: todayInJohannesburg and daysBetween', ({}, testInfo) => {
    once(testInfo.project.name);
    const f = sharedModule('due-date');
    const r = runModule(f, [
      { fn: 'todayInJohannesburg', args: [date('2026-11-18T22:30:00Z')] },
      { fn: 'todayInJohannesburg', args: [date('2026-11-18T21:59:59Z')] },
      { fn: 'todayInJohannesburg', args: [date('2026-12-31T22:00:00Z')] },
      { fn: 'daysBetween', args: ['2026-11-22', '2026-11-24'] },
      { fn: 'daysBetween', args: ['2026-11-30', '2026-12-02'] },
      { fn: 'daysBetween', args: ['2026-12-31', '2027-01-02'] },
      { fn: 'daysBetween', args: ['2028-02-28', '2028-03-01'] },
      { fn: 'daysBetween', args: ['2026-02-28', '2026-03-01'] },
      { fn: 'daysBetween', args: ['2026-11-24', '2026-11-22'] },
      { fn: 'daysBetween', args: ['2026-11-24', '2026-11-24'] },
    ]);
    expect(r.importError, 'the module loads on its own').toBeUndefined();
    expect(r.results.map((x) => x.threw ?? x.value)).toEqual(['2026-11-19', '2026-11-18', '2027-01-01', 2, 2, 2, 2, 1, -2, 0]);
    expect(r.exports['REMINDER_DAYS_BEFORE_DUE'], 'REMINDER_DAYS_BEFORE_DUE is 2').toBe('2');
  });

  test('AC-1 the module lambda/shared/due-date.mjs: reminderDue is true from 2 days before the due date to the due date, never throws', ({}, testInfo) => {
    once(testInfo.project.name);
    const f = sharedModule('due-date');
    const calls = [
      ['2026-11-24', '2026-11-20'], ['2026-11-24', '2026-11-21'], ['2026-11-24', '2026-11-22'], ['2026-11-24', '2026-11-23'], ['2026-11-24', '2026-11-24'],
      ['2026-11-24', '2026-11-25'], ['2026-12-01', '2026-11-30'], ['2026-12-01', '2026-12-01'],
      ['2027-01-01', '2026-12-30'], ['2027-01-01', '2026-12-29'],
    ].map(([due, today]) => ({ fn: 'reminderDue', args: [due, today] }));
    const odd = [
      [null, '2026-11-22'], ['', '2026-11-22'], ['soon', '2026-11-22'], ['2026-02-30', '2026-02-28'], [undefined, '2026-11-22'], [20261124, '2026-11-22'], ['2026-11-24', null], ['2026-11-24', 'today'], ['2026-11-24', '2026-11-31'],
    ].map(([due, today]) => ({ fn: 'reminderDue', args: [due ?? { __undefined: true }, today] }));
    const r = runModule(f, [...calls, ...odd]);
    expect(r.importError).toBeUndefined();
    expect(r.results.slice(0, calls.length).map((x) => x.threw ?? x.value)).toEqual([false, false, true, true, true, false, true, true, true, false]);
    expect(r.results.slice(calls.length).map((x) => x.threw ?? x.value), 'a date that is not one gives false and never throws').toEqual(odd.map(() => false));
  });
});

// ================================================================ AC-2 Never a second one

test.describe('AC-2 never a second one', () => {
  test('AC-2 the same run twice on one day sends one email', ({}, testInfo) => {
    once(testInfo.project.name);
    const first = go(oneDue());
    const second = go(first.tables);
    expect(first.sent).toHaveLength(1);
    expect(second.error, `no error: ${second.error?.message}`).toBeUndefined();
    expect(second.sent, 'the second run finds both documents already reminded').toHaveLength(0);
    expect(claims(second.tables)).toHaveLength(2);
  });

  test('AC-2 a person with one type already reminded and one not gets an email naming only the new one, and one new claim', ({}, testInfo) => {
    once(testInfo.project.name);
    const first = go(oneDue());
    expect(first.sent).toHaveLength(1);
    const tables = { ...first.tables, [REMINDERS]: (first.tables[REMINDERS] ?? []).filter((r) => plain(r)['document_type'] !== 'BANK_CONFIRMATION') };
    expect(claims(tables).map((c) => c['document_type']), 'setup: only the National ID has been reminded').toEqual(['NATIONAL_ID']);
    const second = go(tables);
    expect(second.error, `no error: ${second.error?.message}`).toBeUndefined();
    expect(second.sent, 'one email for the type not yet reminded').toHaveLength(1);
    const shown = shownFromHtml(second.sent[0]!.HtmlBody ?? '');
    expect(shown).toContain(KIT_NAME.BANK_CONFIRMATION);
    expect(shown, 'the type reminded yesterday is not listed again').not.toContain(KIT_NAME.NATIONAL_ID);
    expect(second.sent[0]!.TextBody ?? '').not.toContain(KIT_NAME.NATIONAL_ID);
    expect(claims(second.tables).map((c) => c['document_type']).sort(), 'both types are claimed now, one new row').toEqual(['BANK_CONFIRMATION', 'NATIONAL_ID']);
  });

  test('AC-2 run on the 22nd, the 23rd and the 24th: one email in all', ({}, testInfo) => {
    once(testInfo.project.name);
    let tables = oneDue();
    const sent: string[] = [];
    for (const day of ['2026-11-22', '2026-11-23', '2026-11-24']) {
      const run = go(tables, day);
      expect(run.error, `${day}: no error: ${run.error?.message}`).toBeUndefined();
      sent.push(...recipients(run));
      tables = run.tables;
    }
    expect(sent).toEqual([P.naledi.email]);
  });

  test('AC-2 a person registered late (due date 1 day away) is reminded once, on the first run inside the window', ({}, testInfo) => {
    once(testInfo.project.name);
    // Start 2026-11-30 gives due 2026-11-23: already 1 day away on the 22nd, and it was never reminded before.
    const tables = oneDue(P.naledi, { planned_start_date: '2026-11-30' });
    const first = go(tables, '2026-11-22');
    const second = go(first.tables, '2026-11-23');
    expect(first.sent).toHaveLength(1);
    expect(second.sent).toHaveLength(0);
  });

  test('AC-2 two runs started at the same moment send one email, because only one claim succeeds', ({}, testInfo) => {
    once(testInfo.project.name);
    const run = go(oneDue(), '2026-11-22', { concurrent: 2 });
    expect(run.errors, 'neither run ends with an error').toEqual([null, null]);
    expect(run.sent, 'one email in all').toHaveLength(1);
    expect(claims(run.tables), 'one claim per document').toHaveLength(2);
  });

  test('AC-2 two runs at the same moment, several people: each person is emailed once', ({}, testInfo) => {
    once(testInfo.project.name);
    const run = go(three(), '2026-11-23', { concurrent: 2 });
    expect(run.errors).toEqual([null, null]);
    expect(recipients(run).sort()).toEqual([P.naledi.email, P.sipho.email, P.thandi.email].sort());
    expect(claims(run.tables)).toHaveLength(6);
  });

  test('AC-2 a start date moved after a reminder gives one new reminder in its own window, still one per due date', ({}, testInfo) => {
    once(testInfo.project.name);
    const first = go(oneDue(), '2026-11-22');
    expect(first.sent).toHaveLength(1);
    // The start date moves to 2026-12-03: the due date is now 2026-11-26. On the 24th that is 2 days away.
    const moved: Tables = { ...first.tables, employees: [person(P.naledi, A, { planned_start_date: '2026-12-03' })] };
    const second = go(moved, '2026-11-24');
    expect(second.error, `no error: ${second.error?.message}`).toBeUndefined();
    expect(second.sent, 'a new due date, a new reminder').toHaveLength(1);
    expect(shownFromHtml(second.sent[0]!.HtmlBody ?? '')).toContain('26 Nov 2026');
    const third = go(second.tables, '2026-11-25');
    expect(third.sent, 'but not a second one for that due date').toHaveLength(0);
    expect([...new Set(claims(third.tables).map((c) => c['due_date']))].sort()).toEqual(['2026-11-24', '2026-11-26']);
  });

  test('AC-2 a claim is written before the email goes, one per document, with a condition that refuses a second', ({}, testInfo) => {
    once(testInfo.project.name);
    const run = go(oneDue());
    expect(run.sent).toHaveLength(1);
    const order = run.calls.filter((c) => (c.service === 'dynamodb' && (c as any).table === REMINDERS && (c as any).op === 'PutItem') || (c.service === 'postmark' && c.op === 'sendEmail'));
    const firstMail = order.findIndex((c) => c.service === 'postmark');
    const putsBefore = order.slice(0, firstMail).filter((c) => c.service === 'dynamodb').length;
    expect(putsBefore, 'both claims are written before the email is sent').toBe(2);
    for (const put of dynamo(run).filter((c) => c.table === REMINDERS && c.op === 'PutItem')) {
      expect(expanded(put.input, 'ConditionExpression'), 'the claim is a conditional write').toMatch(/attribute_not_exists\(\s*pk\s*\)/);
    }
  });

  test('AC-2 a claim is keyed by company, person, document type and due date, and holds the company, person, type, due date, a send time and a TTL', ({}, testInfo) => {
    once(testInfo.project.name);
    const run = go(oneDue());
    const rows = claims(run.tables).sort((a, b) => String(a['pk']).localeCompare(String(b['pk'])));
    expect(rows.map((r) => r['pk'])).toEqual([`TENANT#${A}#REMINDER#${P.naledi.id}#BANK_CONFIRMATION#${DUE}`, `TENANT#${A}#REMINDER#${P.naledi.id}#NATIONAL_ID#${DUE}`]);
    const ttl = Date.parse(`${DUE}T00:00:00Z`) / 1000 + 30 * 86400;
    for (const r of rows) {
      expect(r['tenant_id']).toBe(A);
      expect(r['employee_id']).toBe(P.naledi.id);
      expect(r['due_date']).toBe(DUE);
      expect(['BANK_CONFIRMATION', 'NATIONAL_ID']).toContain(r['document_type']);
      expect(r['sent_at'], 'a send time').toBeTruthy();
      expect(typeof r['expires_at'], 'expires_at is a number (epoch seconds), the table TTL').toBe('number');
      expect(Math.abs((r['expires_at'] as number) - ttl), 'due date + 30 days').toBeLessThanOrEqual(86400);
    }
    // No personal text in a claim: ids, a type and dates only.
    for (const r of rows) {
      const text = JSON.stringify(r);
      for (const n of [...NAMES, ...ADDRESSES, HR_NAME, ID_NUMBER_LAST4, ACCOUNT_NUMBER]) expect(text, `no ${n} in a claim`).not.toContain(n);
    }
  });
});

// ================================================================ AC-3 A failed send is tried again

test.describe('AC-3 a failed send is tried again', () => {
  test('AC-3 when Postmark refuses one person, the others still get theirs, the run ends with an error, the next day sends the missed one', ({}, testInfo) => {
    once(testInfo.project.name);
    const run = go(three(), '2026-11-22', { postmark: { byAddress: { [P.sipho.email]: 'server' } } });
    expect(run.error, 'the run ends by throwing, so the error alarm fires').toBeDefined();
    expect(recipients(run).sort(), 'the other two are emailed').toEqual([P.naledi.email, P.thandi.email].sort());
    expect(run.refused.map((r) => r.message.To), 'Postmark was asked once about the failing address').toEqual([P.sipho.email]);
    expect(idsClaimed(run), 'the failed person claims are removed').toEqual([P.naledi.id, P.thandi.id].sort());
    expect(claims(run.tables)).toHaveLength(4);
    const next = go(run.tables, '2026-11-23');
    expect(next.error, `the next run ends without an error: ${next.error?.message}`).toBeUndefined();
    expect(recipients(next), 'the next day sends only the one missed reminder').toEqual([P.sipho.email]);
    expect(claims(next.tables)).toHaveLength(6);
  });

  test('AC-3 the logs and the error hold no address, no name and no Postmark text (C-6a, BE-18)', ({}, testInfo) => {
    once(testInfo.project.name);
    for (const kind of ['server', 'inactive', 'invalid', 'timeout', 'network', 'rate'] as PostmarkKind[]) {
      const run = go(three(), '2026-11-22', { postmark: { byAddress: { [P.sipho.email]: kind } } });
      expect(logLines(run).length, `${kind}: the run logged something`).toBeGreaterThan(0);
      expectNoPersonalText(run, kind);
    }
    // A clean run too, and a run that skips a test login.
    const clean = go(world({ people: [person(P.naledi, A), person({ ...P.sipho, email: 'robot.sipho@blackhole.postmarkapp.com' }, A)] }));
    expectNoPersonalText(clean, 'a clean run');
    for (const l of logLines(clean)) expect(l).not.toContain('robot.sipho');
  });

  for (const [kind, code] of [['inactive', 406], ['invalid', 300]] as const) {
    test(`AC-3 a definite refusal (Postmark code ${code}) keeps its claim, logs the code only, counts it as refused and does not throw`, ({}, testInfo) => {
      once(testInfo.project.name);
      const run = go(three(), '2026-11-22', { postmark: { byAddress: { [P.sipho.email]: kind } } });
      expect(run.errors, 'the run does not throw').toEqual([null]);
      expect(recipients(run).sort()).toEqual([P.naledi.email, P.thandi.email].sort());
      expect(run.refused).toHaveLength(1);
      expect(idsClaimed(run), 'the refused person keeps their claims').toEqual([P.naledi.id, P.sipho.id, P.thandi.id].sort());
      expect(logLines(run).some((l) => l.includes(String(code))), `the code ${code} is in a log line`).toBe(true);
      expectNoPersonalText(run, `code ${code}`);
      const summary = summaryOf(run);
      expect(summary, 'one summary line names sent, refused and failed').toBeDefined();
      expect(countIn(summary, 'sent'), 'sent').toBe(2);
      expect(countIn(summary, 'refused'), 'refused').toBe(1);
      expect(countIn(summary, 'failed'), 'failed').toBe(0);
      const next = go(run.tables, '2026-11-23');
      expect(next.error).toBeUndefined();
      expect(next.sent, 'the next day sends nothing to that address, nor to anyone').toHaveLength(0);
      expect(next.refused, 'and does not ask Postmark again').toHaveLength(0);
    });
  }

  for (const kind of ['server', 'rate', 'timeout', 'network'] as PostmarkKind[]) {
    test(`AC-3 a ${kind} failure releases the claim and the run throws; the next day tries again`, ({}, testInfo) => {
      once(testInfo.project.name);
      const run = go(oneDue(), '2026-11-22', { postmark: { all: kind } });
      expect(run.error, 'the run ends with an error').toBeDefined();
      expect(run.sent).toHaveLength(0);
      expect(run.refused).toHaveLength(1);
      expect(claims(run.tables), 'the claims are released').toHaveLength(0);
      expectNoPersonalText(run, kind);
      const next = go(run.tables, '2026-11-23');
      expect(next.error).toBeUndefined();
      expect(recipients(next)).toEqual([P.naledi.email]);
    });
  }

  test('AC-3 a failure for one person never stops the people after them, and the summary counts it as failed', ({}, testInfo) => {
    once(testInfo.project.name);
    const people = [P.naledi, P.sipho, P.thandi, P.lebo];
    const tables = world({ people: people.map((p) => person(p, A)) });
    const run = go(tables, '2026-11-22', { postmark: { byAddress: { [P.naledi.email]: 'timeout' } } });
    expect(run.error).toBeDefined();
    expect(recipients(run).sort(), 'everyone else is emailed, whatever their place in the list').toEqual([P.sipho.email, P.thandi.email, P.lebo.email].sort());
    expect(countIn(summaryOf(run), 'failed')).toBe(1);
    expect(countIn(summaryOf(run), 'sent')).toBe(3);
  });

  test('AC-3 a token refusal stops the run at the first one, releases that person claim and throws', ({}, testInfo) => {
    once(testInfo.project.name);
    const tables = world({ people: [P.naledi, P.sipho, P.thandi, P.lebo].map((p) => person(p, A)) });
    const run = go(tables, '2026-11-22', { postmark: { all: 'token' } });
    expect(run.error, 'the run ends with an error').toBeDefined();
    expect(run.refused, 'Postmark was asked once: the run does not loop through everyone').toHaveLength(1);
    expect(run.sent).toHaveLength(0);
    expect(claims(run.tables), 'nothing stays claimed').toHaveLength(0);
    expectNoPersonalText(run, 'token');
  });

  test('AC-3 a missing Postmark token stops the run at the start with one log line and sends nothing; it is never treated as sent', ({}, testInfo) => {
    once(testInfo.project.name);
    for (const [how, opts] of [['missing', { unset: ['POSTMARK_API_TOKEN'] }], ['empty', { env: { POSTMARK_API_TOKEN: '' } }]] as const) {
      const run = go(oneDue(), '2026-11-22', opts as Partial<RunOpts>);
      expect(run.error, `${how}: the run ends with an error`).toBeDefined();
      expect(run.sent, `${how}: nothing is sent`).toHaveLength(0);
      expect(run.refused).toHaveLength(0);
      expect(dynamo(run).filter((c) => c.table === REMINDERS && c.op !== 'Query' && c.op !== 'GetItem'), `${how}: nothing is claimed`).toHaveLength(0);
      expect(claims(run.tables)).toHaveLength(0);
      const lines = logLines(run).filter((l) => l.includes('POSTMARK_API_TOKEN'));
      expect(lines, `${how}: one log line names the setting`).toHaveLength(1);
      expect(lines[0]).not.toContain(SETTINGS['POSTMARK_API_TOKEN']!);
    }
  });

  test('AC-3 any other missing or empty setting stops the run at the start too: nothing is sent, nothing is claimed', ({}, testInfo) => {
    once(testInfo.project.name);
    const control = go(oneDue());
    expect(control.sent, 'with every setting the same run sends its email').toHaveLength(1);
    for (const name of ['EMPLOYEES_TABLE', 'DOCUMENTS_TABLE', 'TENANTS_TABLE', 'REMINDERS_TABLE', 'POSTMARK_SENDER_EMAIL', 'LOGIN_URL', 'MAX_REMINDERS_PER_RUN']) {
      for (const how of ['missing', 'empty'] as const) {
        const run = go(oneDue(), '2026-11-22', how === 'missing' ? { unset: [name] } : { env: { [name]: '' } });
        expect(run.error, `${name} ${how}: the run ends with an error`).toBeDefined();
        expect(run.sent, `${name} ${how}: nothing is sent`).toHaveLength(0);
        expect(claims(run.tables), `${name} ${how}: nothing is claimed`).toHaveLength(0);
      }
    }
  });

  test('AC-3 an empty LEGACY_TENANT_ID is a valid setting (the legacy rule ends with TEN-02 step 2): the run works', ({}, testInfo) => {
    once(testInfo.project.name);
    const run = go(oneDue(), '2026-11-22', { env: { LEGACY_TENANT_ID: '' } });
    expect(run.error, `the run works with the legacy rule off: ${run.error?.message}`).toBeUndefined();
    expect(recipients(run)).toEqual([P.naledi.email]);
  });
});

// ================================================================ AC-4 Nothing for what is already given

test.describe('AC-4 nothing for what is already given', () => {
  for (const state of ['WITH_HR', 'ACCEPTED', 'READING', 'LINK_STARTED', 'LINK_DONE'] as DocState[]) {
    test(`AC-4 a required document with a file (${state}) is not listed; the other is`, ({}, testInfo) => {
      once(testInfo.project.name);
      const tables = world({ people: [person(P.naledi, A)], docs: [doc(P.naledi, 'NATIONAL_ID', state, A)] });
      const run = go(tables);
      expect(run.sent).toHaveLength(1);
      const shown = shownFromHtml(run.sent[0]!.HtmlBody ?? '');
      expect(shown).toContain(w2(P.naledi.first, '24 Nov 2026', list('BANK_CONFIRMATION')));
      expect(shown).not.toContain(KIT_NAME.NATIONAL_ID);
      expect(claims(run.tables).map((c) => c['document_type'])).toEqual(['BANK_CONFIRMATION']);
    });
    test(`AC-4 when both required documents have a file (${state}) there is no email and no claim`, ({}, testInfo) => {
      once(testInfo.project.name);
      const tables = world({ people: [person(P.naledi, A)], docs: [doc(P.naledi, 'NATIONAL_ID', state, A), doc(P.naledi, 'BANK_CONFIRMATION', state, A)] });
      const run = go(tables);
      expect(run.error, `no error: ${run.error?.message}`).toBeUndefined();
      expect(run.sent).toHaveLength(0);
      expect(claims(run.tables)).toHaveLength(0);
    });
  }

  test('AC-4 a document sent back is not listed and does not by itself cause an email', ({}, testInfo) => {
    once(testInfo.project.name);
    const onlyBack = world({ people: [person(P.naledi, A)], docs: [doc(P.naledi, 'NATIONAL_ID', 'SENT_BACK', A), doc(P.naledi, 'BANK_CONFIRMATION', 'WITH_HR', A)] });
    const none = go(onlyBack);
    expect(none.sent, 'a sent-back type alone gets no reminder (the person got the sent-back email)').toHaveLength(0);
    expect(claims(none.tables)).toHaveLength(0);
    const both = world({ people: [person(P.naledi, A)], docs: [doc(P.naledi, 'NATIONAL_ID', 'SENT_BACK', A)] });
    const run = go(both);
    expect(run.sent).toHaveLength(1);
    const shown = shownFromHtml(run.sent[0]!.HtmlBody ?? '');
    expect(shown).toContain(w2(P.naledi.first, '24 Nov 2026', list('BANK_CONFIRMATION')));
    expect(shown, 'the sent-back type is not in the list').not.toContain(KIT_NAME.NATIONAL_ID);
  });

  test('AC-4 an optional document is never listed and never causes an email', ({}, testInfo) => {
    once(testInfo.project.name);
    const bothGiven = world({ people: [person(P.naledi, A)], docs: [doc(P.naledi, 'NATIONAL_ID', 'WITH_HR', A), doc(P.naledi, 'BANK_CONFIRMATION', 'ACCEPTED', A)] });
    const run = go(bothGiven);
    expect(run.sent, 'Matric certificate and Tertiary qualifications are not required: no email').toHaveLength(0);
    const none = go(oneDue());
    expect(none.sent).toHaveLength(1);
    const text = allText(none.sent[0]!);
    expect(text).not.toContain(KIT_NAME.MATRIC_CERTIFICATE);
    expect(text).not.toContain(KIT_NAME.TERTIARY_QUALIFICATION);
    expect(claims(none.tables).map((c) => c['document_type']).sort()).toEqual(['BANK_CONFIRMATION', 'NATIONAL_ID']);
  });

  test('AC-4 an upload link with no file counts as not uploaded, as the checklist says (the `counts` rule)', ({}, testInfo) => {
    once(testInfo.project.name);
    const tables = world({ people: [person(P.naledi, A)], docs: [doc(P.naledi, 'NATIONAL_ID', 'LINK_ONLY', A), doc(P.naledi, 'BANK_CONFIRMATION', 'LINK_ONLY', A)] });
    const run = go(tables);
    expect(run.sent).toHaveLength(1);
    expect(shownFromHtml(run.sent[0]!.HtmlBody ?? '')).toContain(list(...BOTH));
  });

  // [name, row overrides, what the step is]
  const STEPS: [string, Record<string, string | undefined>, boolean][] = [
    ['step DOCUMENTS', { step: 'DOCUMENTS', stage: 'ACTIVE' }, true],
    ['no stored step, stage ACTIVE (which is DOCUMENTS)', { step: undefined, stage: 'ACTIVE' }, true],
    ['step INVITED', { step: 'INVITED', stage: 'INVITED' }, false],
    ['no stored step, stage INVITED', { step: undefined, stage: 'INVITED' }, false],
    ['step IN_REVIEW', { step: 'IN_REVIEW', stage: 'DOCUMENTS_SUBMITTED' }, false],
    ['no stored step, stage DOCUMENTS_SUBMITTED', { step: undefined, stage: 'DOCUMENTS_SUBMITTED' }, false],
    ['step VERIFIED', { step: 'VERIFIED', stage: 'VERIFIED' }, false],
    ['no stored step, stage ONBOARDED', { step: undefined, stage: 'ONBOARDED' }, false],
    ['no stored step, stage TRAINING', { step: undefined, stage: 'TRAINING' }, false],
    ['no step and no stage', { step: undefined, stage: undefined }, false],
    ['a step that is none of the four', { step: 'SOMETHING', stage: undefined }, false],
  ];
  for (const [name, over, reminded] of STEPS) {
    test(`AC-4 a person at ${name} ${reminded ? 'is reminded' : 'gets nothing'}`, ({}, testInfo) => {
      once(testInfo.project.name);
      const run = go(world({ people: [person(P.naledi, A, over)] }));
      expect(run.error, `no error: ${run.error?.message}`).toBeUndefined();
      expect(run.sent).toHaveLength(reminded ? 1 : 0);
      expect(claims(run.tables)).toHaveLength(reminded ? 2 : 0);
    });
  }

  test('AC-4 lambda/shared/required-documents.mjs typesToGive: the required types with no row that has a file, in the order of the list', ({}, testInfo) => {
    once(testInfo.project.name);
    const row = (document_type: string, ocr_status?: string, over: Record<string, string> = {}) => ({ document_type, ocr_status, document_id: `doc_${Math.random()}`, ...over });
    const required = ['NATIONAL_ID', 'BANK_CONFIRMATION'];
    const cases: [string, unknown[], string[]][] = [
      ['no rows', [], ['NATIONAL_ID', 'BANK_CONFIRMATION']],
      ['a row that waits for HR', [row('NATIONAL_ID', 'MANUAL_REVIEW')], ['BANK_CONFIRMATION']],
      ['an accepted row', [row('BANK_CONFIRMATION', 'PASSED', { hr_reviewed_at: '2026-11-12T09:00:00.000Z' })], ['NATIONAL_ID']],
      ['a sent-back row has a file', [row('NATIONAL_ID', 'FAILED')], ['BANK_CONFIRMATION']],
      ['a row being read', [row('NATIONAL_ID', 'PROCESSING')], ['BANK_CONFIRMATION']],
      ['a PENDING row with nothing else is not a file', [row('NATIONAL_ID', 'PENDING')], ['NATIONAL_ID', 'BANK_CONFIRMATION']],
      ['a PENDING row the reader started on is a file', [row('NATIONAL_ID', 'PENDING', { ocr_started_at: '2026-11-12T08:01:00.000Z' })], ['BANK_CONFIRMATION']],
      ['a PENDING row the reader finished is a file', [row('NATIONAL_ID', 'PENDING', { ocr_completed_at: '2026-11-12T08:02:00.000Z' })], ['BANK_CONFIRMATION']],
      ['a PENDING row beside a row with a file', [row('NATIONAL_ID', 'PENDING'), row('NATIONAL_ID', 'MANUAL_REVIEW')], ['BANK_CONFIRMATION']],
      ['an optional type is never owed', [row('MATRIC_CERTIFICATE', 'MANUAL_REVIEW')], ['NATIONAL_ID', 'BANK_CONFIRMATION']],
      ['both given', [row('NATIONAL_ID', 'MANUAL_REVIEW'), row('BANK_CONFIRMATION', 'PASSED')], []],
    ];
    const r = runModule(sharedModule('required-documents'), cases.map(([, docs]) => ({ fn: 'typesToGive', args: [docs, required] })));
    expect(r.importError).toBeUndefined();
    cases.forEach(([why, , want], i) => expect(r.results[i]!.threw ?? r.results[i]!.value, why).toEqual(want));
    const other = runModule(sharedModule('required-documents'), [{ fn: 'typesToGive', args: [[], ['TERTIARY_QUALIFICATION', 'NATIONAL_ID']] }]);
    expect(other.results[0]!.value, 'the order of the required list').toEqual(['TERTIARY_QUALIFICATION', 'NATIONAL_ID']);
  });

  test('AC-4 the Lambda takes the types to list from typesToGive in required-documents.mjs, not from a copy of the rule', ({}, testInfo) => {
    once(testInfo.project.name);
    // Both required documents have a file, so nothing is owed by the real rule. A copy of the rule in the Lambda sends nothing.
    // With typesToGive replaced by one that says the bank letter is owed, the email lists exactly that.
    const handler = treeWith({
      'shared/required-documents.mjs': (src) => {
        const m = /export\s+(?:async\s+)?function\s+typesToGive\b|export\s+const\s+typesToGive\b/.exec(src);
        if (!m) throw new Error('lambda/shared/required-documents.mjs must export typesToGive (function or const)');
        return `${src.replace(/\btypesToGive\b/, 'typesToGiveReal')}\nexport function typesToGive() { return ['BANK_CONFIRMATION']; }\n`;
      },
    });
    const tables = world({ people: [person(P.naledi, A)], docs: [doc(P.naledi, 'NATIONAL_ID', 'WITH_HR', A), doc(P.naledi, 'BANK_CONFIRMATION', 'WITH_HR', A)] });
    const run = go(tables, '2026-11-22', { handler });
    expect(run.error, `no error: ${run.error?.message}`).toBeUndefined();
    expect(run.sent).toHaveLength(1);
    expect(shownFromHtml(run.sent[0]!.HtmlBody ?? '')).toContain(w2(P.naledi.first, '24 Nov 2026', list('BANK_CONFIRMATION')));
    expect(claims(run.tables).map((c) => c['document_type'])).toEqual(['BANK_CONFIRMATION']);
  });
});

// ================================================================ AC-5 Test logins get no real email

test.describe('AC-5 test logins get no real email', () => {
  const ROBOT = { id: 'EMP-2150', first: 'Rory', last: 'Botha', email: 'pepla-demo-robot.rory@blackhole.postmarkapp.com' };
  test('AC-5 a person whose email ends @blackhole.postmarkapp.com is skipped: no claim, no Postmark call, one log line; the run carries on', ({}, testInfo) => {
    once(testInfo.project.name);
    const tables = world({ people: [person(ROBOT, A), person(P.naledi, A)] });
    const run = go(tables);
    expect(run.error, `no error: ${run.error?.message}`).toBeUndefined();
    expect(recipients(run), 'only the real person is emailed').toEqual([P.naledi.email]);
    expect(run.refused, 'Postmark was never asked about the test login').toHaveLength(0);
    expect(idsClaimed(run), 'no claim for the test login').toEqual([P.naledi.id]);
    expect(logLines(run).filter((l) => l.includes('Reminder skipped: test employee')), 'one log line').toHaveLength(1);
    expect(logLines(run).join('\n')).not.toContain(ROBOT.email);
    expect(logLines(run).join('\n')).not.toContain('Rory');
    expect(JSON.stringify(run.calls.filter((c) => c.service !== 'log')), 'the address is nowhere in a call to Postmark').not.toContain(`"To":"${ROBOT.email}"`);
  });

  test('AC-5 the test domain is matched at the end of the address, in any case, and only the exact domain', ({}, testInfo) => {
    once(testInfo.project.name);
    const shout = { ...ROBOT, id: 'EMP-2151', email: 'Pepla-Demo-Shout@BlackHole.PostmarkApp.com' };
    const lookalike = { id: 'EMP-2152', first: 'Lola', last: 'Look', email: 'lola.look@blackhole.postmarkapp.com.evil.example' };
    const run = go(world({ people: [person(shout, A), person(lookalike, A)] }));
    expect(recipients(run), 'the exact test domain is skipped in any case; a lookalike is a real address').toEqual([lookalike.email]);
    expect(idsClaimed(run)).toEqual([lookalike.id]);
  });

  test('AC-5 a test login is not counted as sent', ({}, testInfo) => {
    once(testInfo.project.name);
    const run = go(world({ people: [person(ROBOT, A), person({ ...ROBOT, id: 'EMP-2153', email: 'two@blackhole.postmarkapp.com' }, A)] }));
    expect(run.sent).toHaveLength(0);
    expect(countIn(summaryOf(run), 'sent')).toBe(0);
    expect(run.error, 'a run with only test logins is a clean run').toBeUndefined();
  });

  test('AC-5 nothing in a run calls an AI service (the fake refuses any AI client and records any call)', ({}, testInfo) => {
    once(testInfo.project.name);
    const run = go(three());
    expect(run.sent, 'a real run: three people emailed').toHaveLength(3);
    expect(run.calls.filter((c) => /bedrock|textract|anthropic|comprehend/i.test(c.service))).toEqual([]);
    expect(run.calls.filter((c) => c.service === 'http')).toEqual([]);
  });
});

// ================================================================ AC-6 The words

test.describe('AC-6 the words', () => {
  const email = (over: Record<string, unknown> = {}) => ({ firstName: 'Naledi', typeNames: [KIT_NAME.NATIONAL_ID, KIT_NAME.BANK_CONFIRMATION], dueIso: '2026-11-24', loginUrl: LOGIN_URL, ...over });
  const build = (args: Record<string, unknown>[], tz = 'UTC') => {
    const r = runModule(sharedModule('reminder-email'), args.map((a) => ({ fn: 'reminderEmail', args: [a] })), tz);
    expect(r.importError, 'lambda/shared/reminder-email.mjs loads on its own (it imports no AWS package)').toBeUndefined();
    return r.results.map((x) => {
      if (x.threw !== undefined) throw new Error(`reminderEmail threw: ${x.threw}`);
      return x.value as { subject: string; html: string; text: string };
    });
  };

  test('AC-6 reminderEmail: the subject, the heading, the first line, the list, the date, the button and the link, exactly (W-1 to W-3)', ({}, testInfo) => {
    once(testInfo.project.name);
    const [m] = build([email()]);
    expect(m!.subject).toBe(w1('24 Nov 2026'));
    const shown = shownFromHtml(m!.html);
    expect(shown).toContain(w1('24 Nov 2026'));
    expect(shown).toContain(w2('Naledi', '24 Nov 2026', list(...BOTH)));
    expect(shown).toContain(BUTTON);
    expect(shown).toContain(SIGNED);
    const links = [...m!.html.matchAll(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)];
    expect(links.map((l) => l[1]!.replace(/&amp;/g, '&')), 'the one link is LOGIN_URL').toEqual([LOGIN_URL]);
    expect(squashWhite(links[0]![2]!.replace(/<[^>]+>/g, ''))).toBe(BUTTON);
    // The plain-text twin carries the same words.
    const text = squashWhite(m!.text);
    expect(text).toContain(w2('Naledi', '24 Nov 2026', list(...BOTH)));
    expect(text).toContain(w3Text(LOGIN_URL));
    expect(text).toContain(SIGNED);
  });

  test('AC-6 reminderEmail: one document, three documents, the list as given, the order kept', ({}, testInfo) => {
    once(testInfo.project.name);
    const [one, three3] = build([email({ typeNames: [KIT_NAME.BANK_CONFIRMATION] }), email({ typeNames: [KIT_NAME.NATIONAL_ID, KIT_NAME.BANK_CONFIRMATION, KIT_NAME.MATRIC_CERTIFICATE] })]);
    expect(shownFromHtml(one!.html)).toContain(w2('Naledi', '24 Nov 2026', KIT_NAME.BANK_CONFIRMATION));
    expect(squashWhite(one!.text)).toContain(w2('Naledi', '24 Nov 2026', KIT_NAME.BANK_CONFIRMATION));
    expect(shownFromHtml(three3!.html)).toContain(w2('Naledi', '24 Nov 2026', 'National ID, Bank account confirmation letter, Matric certificate'));
  });

  test('AC-6 reminderEmail: the date is the calendar date it is given, in any time zone of the machine', ({}, testInfo) => {
    once(testInfo.project.name);
    for (const tz of ['UTC', 'Pacific/Pago_Pago', 'Pacific/Kiritimati', 'Africa/Johannesburg']) {
      const out = build([email({ dueIso: '2026-11-24' }), email({ dueIso: '2026-12-31' }), email({ dueIso: '2027-01-01' }), email({ dueIso: '2028-02-29' })], tz);
      expect(out.map((m) => m.subject), tz).toEqual([w1('24 Nov 2026'), w1('31 Dec 2026'), w1('1 Jan 2027'), w1('29 Feb 2028')]);
    }
  });

  test('AC-6 reminderEmail: every value put into the HTML is escaped; a name with < & " or an apostrophe throws nothing', ({}, testInfo) => {
    once(testInfo.project.name);
    const nasty = '<b>Sam</b> & "Co"';
    const [m, o] = build([email({ firstName: nasty }), email({ firstName: "D'Arcy" })]);
    expect(m!.html, 'no tag made of the name').not.toContain('<b>Sam');
    expect(m!.html).not.toMatch(/<b>/i);
    expect(shownFromHtml(m!.html), 'the name shows as text').toContain(w2(nasty, '24 Nov 2026', list(...BOTH)));
    expect(m!.text, 'the text twin holds the name as it is').toContain(nasty);
    expect(shownFromHtml(o!.html)).toContain(w2("D'Arcy", '24 Nov 2026', list(...BOTH)));
    const [u] = build([email({ loginUrl: 'https://people.naleko.example/sign-in?from=email&x=1' })]);
    expect(u!.html, 'an & in the link is escaped in the HTML').toContain('sign-in?from=email&amp;x=1');
    expect(u!.text, 'and is as it is in the text').toContain('https://people.naleko.example/sign-in?from=email&x=1');
  });

  test('AC-6 reminderEmail: no other words (everything the spec words take out, nothing is left), and no "password", "Masked" or "Work email"', ({}, testInfo) => {
    once(testInfo.project.name);
    const [m] = build([email()]);
    const date = '24 Nov 2026';
    const strip = (s: string) =>
      [w1(date), w2('Naledi', date, list(...BOTH)), w3Text(LOGIN_URL), BUTTON, SIGNED, LOGIN_URL, m!.subject].reduce((acc, w) => acc.split(w).join(' '), s).replace(/[\s.,:;|-]+/g, ' ').trim();
    expect(strip(shownFromHtml(m!.html)), 'the HTML holds only the proposed words').toBe('');
    expect(strip(squashWhite(m!.text)), 'the text holds only the proposed words').toBe('');
    for (const t of [m!.subject, m!.html, m!.text]) {
      expect(t).not.toMatch(/password/i);
      expect(t).not.toMatch(/masked/i);
      expect(t).not.toMatch(/work email/i);
    }
  });

  test('AC-6 the email the Lambda sends is what reminderEmail builds: the subject, the HTML and the text, with the first name as stored, the kit names in order, the due date and LOGIN_URL', ({}, testInfo) => {
    once(testInfo.project.name);
    const handler = treeWith({
      'shared/reminder-email.mjs': () => `export function reminderEmail(args) {
  const echo = JSON.stringify(args);
  return { subject: 'STUB-SUBJECT', html: '<p>STUB-HTML ' + echo.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</p>', text: 'STUB-TEXT ' + echo };
}\n`,
    });
    const run = go(oneDue(P.naledi, { first_name: '<b>Naledi</b> & "Co"' }), '2026-11-22', { handler });
    expect(run.error, `no error: ${run.error?.message}`).toBeUndefined();
    expect(run.sent).toHaveLength(1);
    const m = run.sent[0]!;
    expect(m.Subject, 'the subject is the module’s, word for word: no word of the email is in the Lambda').toBe('STUB-SUBJECT');
    expect(m.HtmlBody!.startsWith('<p>STUB-HTML ')).toBe(true);
    expect(m.HtmlBody!.endsWith('</p>')).toBe(true);
    expect(m.TextBody!.startsWith('STUB-TEXT ')).toBe(true);
    const args = JSON.parse(m.TextBody!.slice('STUB-TEXT '.length));
    expect(args).toEqual({ firstName: '<b>Naledi</b> & "Co"', typeNames: [KIT_NAME.NATIONAL_ID, KIT_NAME.BANK_CONFIRMATION], dueIso: DUE, loginUrl: LOGIN_URL });
    expect(m.HtmlBody!.replace(/^<p>STUB-HTML |<\/p>$/g, '').replace(/&lt;/g, '<').replace(/&amp;/g, '&'), 'the HTML is the module’s, nothing added').toBe(m.TextBody!.slice('STUB-TEXT '.length));
  });

  test('AC-6 the email a person is sent holds W-1 to W-3, only their own first name and list, and is sent from the sender address to that person alone', ({}, testInfo) => {
    once(testInfo.project.name);
    const run = go(oneDue());
    const m = run.sent[0]!;
    expect(m.Subject).toBe(w1('24 Nov 2026'));
    expect(addressesOf(m)).toEqual([P.naledi.email]);
    expect(m['Cc'] ?? '').toBe('');
    expect(m['Bcc'] ?? '').toBe('');
    const shown = shownFromHtml(m.HtmlBody ?? '');
    expect(shown).toContain(w2('Naledi', '24 Nov 2026', list(...BOTH)));
    expect(squashWhite(m.TextBody ?? '')).toContain(w3Text(LOGIN_URL));
    expect(shown).toContain(BUTTON);
  });

  test('AC-6 the email holds no ID number, no account number, no HR name or address, no surname, no document text and no "password"', ({}, testInfo) => {
    once(testInfo.project.name);
    const run = go(oneDue());
    const text = allText(run.sent[0]!);
    for (const secret of [ID_NUMBER_LAST4, '9803145800876', ACCOUNT_NUMBER, HR_NAME, 'Jane', HR_EMAIL, P.naledi.last, '000 000 0000', 'Junior baker', 'Operations']) {
      expect(text, `no ${secret}`).not.toContain(secret);
    }
    expect(text).not.toMatch(/password/i);
    expect(text).not.toMatch(/masked/i);
    expect(text).not.toMatch(/work email/i);
    expect(text, 'the document text itself is never in it').not.toContain('national_id.pdf');
  });

  test('AC-6 a blank or missing first name sends nothing (W-4), and the run carries on with the others', ({}, testInfo) => {
    once(testInfo.project.name);
    const blank = [
      person({ id: 'EMP-2160', first: '', last: 'Blank', email: 'blank.first@kestrel.example' }, A, { first_name: '' }),
      person({ id: 'EMP-2161', first: '', last: 'Spaces', email: 'spaces.first@kestrel.example' }, A, { first_name: '   ' }),
      person({ id: 'EMP-2162', first: '', last: 'Missing', email: 'missing.first@kestrel.example' }, A, { first_name: undefined }),
      person({ id: 'EMP-2163', first: 'Noel', last: 'NoMail', email: '' }, A, { email: undefined }),
      person({ id: 'EMP-2164', first: 'Emma', last: 'EmptyMail', email: '' }, A, { email: '' }),
      person(P.naledi, A),
    ];
    const run = go(world({ people: blank }));
    expect(run.error, `no error: ${run.error?.message}`).toBeUndefined();
    expect(recipients(run), 'only the person with a first name and an address is emailed').toEqual([P.naledi.email]);
    expect(idsClaimed(run), 'and only they have claims').toEqual([P.naledi.id]);
  });

  test('AC-6 the send carries TrackOpens false, TrackLinks None and a named message stream (C-6c)', ({}, testInfo) => {
    once(testInfo.project.name);
    const run = go(oneDue());
    const m = run.sent[0]!;
    expect(m.TrackOpens, 'no open tracking').toBe(false);
    expect(m.TrackLinks, 'no link tracking (it would send the sign-in link through a third-party address)').toBe('None');
    expect(typeof m.MessageStream, 'a message stream is named').toBe('string');
    expect(String(m.MessageStream).length).toBeGreaterThan(0);
  });

  test('AC-6 the link is exactly the LOGIN_URL setting, with nothing added: no id, no email, no query string (C-6d)', ({}, testInfo) => {
    once(testInfo.project.name);
    for (const url of [LOGIN_URL, 'https://people.naleko.example/sign-in?from=email&x=1', 'http://localhost:4300/sign-in']) {
      const run = go(oneDue(), '2026-11-22', { env: { LOGIN_URL: url } });
      const m = run.sent[0]!;
      const hrefs = [...(m.HtmlBody ?? '').matchAll(/href="([^"]*)"/gi)].map((h) => h[1]!.replace(/&amp;/g, '&'));
      expect(hrefs, 'the one link in the HTML').toEqual([url]);
      const urls = [...allText(m).replace(/&amp;/g, '&').matchAll(/https?:\/\/[^\s"'<>]+/g)].map((u) => u[0]);
      expect([...new Set(urls)], 'no other address in the email').toEqual([url]);
      expect(m.TextBody ?? '').toContain(` ${url}`);
    }
  });

  test('AC-6 a person with the legacy first_name etc. gets one email with only the words of W-1 to W-3 in it', ({}, testInfo) => {
    once(testInfo.project.name);
    const run = go(oneDue(P.thandi));
    const m = run.sent[0]!;
    const date = '24 Nov 2026';
    const left = [w1(date), w2('Thandi', date, list(...BOTH)), w3Text(LOGIN_URL), BUTTON, SIGNED, LOGIN_URL, m.Subject ?? ''].reduce((acc, w) => acc.split(w).join(' '), shownFromHtml(m.HtmlBody ?? '')).replace(/[\s.,:;|-]+/g, ' ').trim();
    expect(left, 'nothing else is in the email').toBe('');
  });
});

// ================================================================ AC-7 Each company only sees its own

test.describe('AC-7 each company only sees its own', () => {
  const twoCompanies = () =>
    world({
      people: [person(P.naledi, A), person(P.bongani, B)],
      docs: [doc(P.bongani, 'NATIONAL_ID', 'ACCEPTED', B)],
    });

  test('AC-7 company A and company B each have one person due: each gets one email with only their own list; claims carry their own company', ({}, testInfo) => {
    once(testInfo.project.name);
    const run = go(twoCompanies());
    expect(run.error, `no error: ${run.error?.message}`).toBeUndefined();
    expect(run.sent).toHaveLength(2);
    const to = (p: Person) => run.sent.find((e) => e.To === p.email)!;
    expect(shownFromHtml(to(P.naledi).HtmlBody ?? '')).toContain(w2('Naledi', '24 Nov 2026', list(...BOTH)));
    expect(shownFromHtml(to(P.bongani).HtmlBody ?? ''), 'B owes only the bank letter').toContain(w2('Bongani', '24 Nov 2026', list('BANK_CONFIRMATION')));
    for (const e of run.sent) {
      const other = e.To === P.naledi.email ? ['Bongani', P.bongani.email] : ['Naledi', P.naledi.email];
      for (const w of other) expect(allText(e), 'nothing of the other company').not.toContain(w!);
    }
    const rows = claims(run.tables);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      const own = r['employee_id'] === P.naledi.id ? A : B;
      expect(r['tenant_id']).toBe(own);
      expect(String(r['pk']).startsWith(`TENANT#${own}#`), `the key of ${r['pk']} starts with its own company`).toBe(true);
    }
  });

  test('AC-7 the same employee_id in both companies claims twice, once each, and one company documents never hide the other', ({}, testInfo) => {
    once(testInfo.project.name);
    const same = { ...P.bongani, id: P.naledi.id };
    const tables = world({
      people: [person(P.naledi, A), person(same, B)],
      // Company B's person has both documents accepted. They carry the same employee_id as company A's person, who has none.
      docs: [doc(same, 'NATIONAL_ID', 'ACCEPTED', B), doc(same, 'BANK_CONFIRMATION', 'ACCEPTED', B)],
    });
    const run = go(tables);
    expect(run.error, `no error: ${run.error?.message}`).toBeUndefined();
    expect(recipients(run), 'A person is reminded; B person has nothing owed').toEqual([P.naledi.email]);
    expect(shownFromHtml(run.sent[0]!.HtmlBody ?? '')).toContain(list(...BOTH));
    // And the other way round: both owe documents, the same id, one claim each per type.
    const both = go(world({ people: [person(P.naledi, A), person(same, B)] }));
    expect(both.sent).toHaveLength(2);
    expect(claims(both.tables)).toHaveLength(4);
    expect(new Set(claims(both.tables).map((c) => c['pk'])).size, 'four different keys').toBe(4);
  });

  test('AC-7 a company without the Onboarding module, a company that is not ACTIVE and a row with no valid company id get nothing, and are not read', ({}, testInfo) => {
    once(testInfo.project.name);
    const tables = world({
      companies: [
        company(A),
        company(C, {}, ['recruitment']),
        company(D, { status: 'SUSPENDED' }, ['onboarding']),
        company(NOT_AN_ID, {}, ['onboarding']),
        company('ten_UPPERCASEUPPERCASEUPPERCASE', {}, ['onboarding']),
      ],
      people: [person(P.naledi, A), person(P.sipho, C), person(P.thandi, D), person(P.lebo, NOT_AN_ID), person(P.bongani, 'ten_UPPERCASEUPPERCASEUPPERCASE')],
    });
    const run = go(tables);
    expect(run.error, `no error: ${run.error?.message}`).toBeUndefined();
    expect(recipients(run), 'only company A, which has the module and is ACTIVE').toEqual([P.naledi.email]);
    const read = JSON.stringify(dynamo(run).filter((c) => c.table === 'employees' || c.table === 'documents').map((c) => c.input));
    for (const other of [C, D, NOT_AN_ID, 'ten_UPPERCASEUPPERCASEUPPERCASE']) expect(read, `the run never reads the people of ${other}`).not.toContain(other);
  });

  test('AC-7 a company row with no modules counts as every module only when it is the founding company (MOD-01)', ({}, testInfo) => {
    once(testInfo.project.name);
    const tables = world({
      companies: [company(A, { founding: true }, null), company(B, {}, null)],
      people: [person(P.naledi, A), person(P.bongani, B)],
    });
    const run = go(tables);
    expect(recipients(run), 'the founding company has every module; a company with no modules attribute has none').toEqual([P.naledi.email]);
  });

  test('AC-7 one unreadable company does not stop the next; the run logs the company id and the error name only', ({}, testInfo) => {
    once(testInfo.project.name);
    const tables = world({ people: [person(P.naledi, A), person(P.bongani, B)] });
    const run = go(tables, '2026-11-22', { failFor: { table: 'employees', ops: ['Query', 'Scan'], company: A } });
    expect(recipients(run), 'company B is still reminded').toEqual([P.bongani.email]);
    const lines = logLines(run).filter((l) => l.includes('Company skipped'));
    expect(lines, 'one "Company skipped" line').toHaveLength(1);
    expect(lines[0]).toContain(A);
    expect(lines[0]).toContain('ServiceUnavailable');
    expect(lines[0]).not.toContain('The service is unavailable');
    expectNoPersonalText(run, 'an unreadable company');
  });

  test('AC-7 an event carrying tenant_id, employee_id, today, a list of people or a cap changes nothing: the run is the same', ({}, testInfo) => {
    once(testInfo.project.name);
    const tables = () => world({ people: [person(P.naledi, A), person(P.bongani, B)], docs: [doc(P.bongani, 'NATIONAL_ID', 'ACCEPTED', B)] });
    const plainRun = go(tables());
    const hostile = {
      tenant_id: B,
      employee_id: P.bongani.id,
      today: '2026-11-30',
      now: '2026-11-30T06:00:00Z',
      MAX_REMINDERS_PER_RUN: 0,
      limit: 0,
      people: [{ employee_id: 'EMP-9999', email: 'someone.else@elsewhere.example', tenant_id: B }],
      companies: [B],
      dryRun: true,
      time: '2026-11-30T06:00:00Z',
      tenantId: B,
      companyId: B,
      company: B,
      employeeId: P.bongani.id,
      date: '2026-11-30',
      maxPerRun: 0,
      maxReminders: 0,
      cap: 0,
      max: 0,
      companyIds: [B],
      detail: { tenant_id: B, employee_id: P.bongani.id, today: '2026-11-30', people: ['EMP-9999'], company: B, limit: 0 },
    };
    const run = go(tables(), '2026-11-22', { event: scheduledEvent(hostile) });
    expect(run.error, `no error: ${run.error?.message}`).toBeUndefined();
    const key = (r: Run) => JSON.stringify({ mail: r.sent.map((e) => [e.To, e.Subject, e.HtmlBody, e.TextBody]).sort(), claims: claims(r.tables).map((c) => JSON.stringify(c)).sort() });
    expect(key(run), 'the same emails and the same claims').toBe(key(plainRun));
    expect(run.sent).toHaveLength(2);
    const bare = go(tables(), '2026-11-22', { event: {} });
    expect(key(bare), 'an empty event is the same run').toBe(key(plainRun));
    const none = go(tables(), '2026-11-22', { event: null as unknown });
    expect(key(none), 'no event at all is the same run').toBe(key(plainRun));
  });

  test('AC-7 the legacy company is read the old way while the legacy rule is on (rows with no company), and claims carry its own id', ({}, testInfo) => {
    once(testInfo.project.name);
    const tables = world({ people: [person(P.naledi, undefined), person(P.sipho, A), person(P.bongani, B)] });
    const on = go(tables, '2026-11-22', { env: { LEGACY_TENANT_ID: A } });
    expect(on.error, `no error: ${on.error?.message}`).toBeUndefined();
    expect(recipients(on).sort(), 'the legacy company reads its rows with no company; company B does not').toEqual([P.naledi.email, P.sipho.email, P.bongani.email].sort());
    for (const c of claims(on.tables)) expect(String(c['pk']).startsWith(`TENANT#${c['employee_id'] === P.bongani.id ? B : A}#`)).toBe(true);
    for (const c of claims(on.tables)) expect(c['tenant_id']).toBe(c['employee_id'] === P.bongani.id ? B : A);
    const off = go(tables, '2026-11-22', { env: { LEGACY_TENANT_ID: '' } });
    expect(off.error, `no error: ${off.error?.message}`).toBeUndefined();
    expect(recipients(off).sort(), 'a row with no company belongs to nobody once the legacy rule ends').toEqual([P.sipho.email, P.bongani.email].sort());
  });

  test('AC-7 the company list is read with one Scan of five attributes, only company rows, every page (C-4)', ({}, testInfo) => {
    once(testInfo.project.name);
    const many = ['ten_00000000000000000000000001', 'ten_00000000000000000000000002', 'ten_00000000000000000000000003'];
    const tables = world({
      companies: [...many.map((id) => company(id, {}, ['recruitment'])), company(A), company(B)],
      people: [person(P.naledi, A), person(P.bongani, B)],
    });
    // One row per page: A and B are on the last pages.
    const run = go(tables, '2026-11-22', { pageSize: 1 });
    expect(run.error, `no error: ${run.error?.message}`).toBeUndefined();
    expect(recipients(run).sort(), 'the companies on the last pages are reminded').toEqual([P.naledi.email, P.bongani.email].sort());
    const scans = dynamo(run).filter((c) => c.table === TENANTS && c.op === 'Scan');
    expect(scans.length, 'every page is read').toBeGreaterThanOrEqual(6);
    for (const s of scans) {
      expect(projected(s.input).sort(), 'only these five attributes are read').toEqual(['founding', 'modules', 'pk', 'sk', 'status']);
      const filter = expanded(s.input, 'FilterExpression');
      expect(filter, 'only company rows').toMatch(/begins_with\(\s*pk\s*,\s*'TENANT#'\s*\)/);
      expect(filter, 'only company rows').toMatch(/\bsk\s*=\s*'PROFILE'/);
      expect(s.input.IndexName, 'no index on the tenants table').toBeUndefined();
    }
    for (const s of scans.slice(1)) expect(s.input.ExclusiveStartKey, 'a later page continues the earlier one').toBeDefined();
    expect(dynamo(run).filter((c) => c.table === TENANTS && !['Scan', 'GetItem'].includes(c.op)), 'the tenants table is only scanned and read by key').toEqual([]);
  });

  test('AC-7 people are read one company at a time through its index with only the fields the reminder needs; documents by the person, never a Scan', ({}, testInfo) => {
    once(testInfo.project.name);
    const run = go(world({ people: [person(P.naledi, A), person(P.bongani, B)] }));
    const reads = dynamo(run).filter((c) => c.table === 'employees');
    expect(reads.length).toBeGreaterThanOrEqual(2);
    for (const r of reads) {
      expect(r.op, 'employees are read by the company index, not scanned (the legacy company is not in this world)').toBe('Query');
      expect(r.input.IndexName).toBe('tenant-index');
      const values = JSON.stringify(r.input.ExpressionAttributeValues);
      expect([A, B].some((id) => values.includes(id)), 'the read names its company').toBe(true);
      const want = projected(r.input);
      expect(want.length, 'a projection: only the fields the reminder needs').toBeGreaterThan(0);
      for (const secret of ['id_number_encrypted', 'id_number_last4', 'bank_account_number', 'phone', 'hr_staff_name', 'hr_staff_email', 'last_name', 'department', 'position']) {
        expect(want, `${secret} is not read`).not.toContain(secret);
      }
    }
    expect(new Set(reads.map((r) => JSON.stringify(r.input.ExpressionAttributeValues).includes(A))).size, 'each company has its own read').toBe(2);
    expect(dynamo(run).filter((c) => c.table === 'documents' && c.op === 'Scan'), 'documents are never scanned').toEqual([]);
    expect(dynamo(run).filter((c) => c.table === 'documents').length, 'documents are read').toBeGreaterThan(0);
  });
});

// ================================================================ AC-8 Terraform, settings and scope

test.describe('AC-8 terraform, settings and scope', () => {
  const src = () => readFileSync(LAMBDA_FILE, 'utf8');
  const code = () => stripComments(src().replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1'));
  const SETTING_NAMES = ['EMPLOYEES_TABLE', 'DOCUMENTS_TABLE', 'TENANTS_TABLE', 'REMINDERS_TABLE', 'POSTMARK_API_TOKEN', 'POSTMARK_SENDER_EMAIL', 'LOGIN_URL', 'LEGACY_TENANT_ID', 'MAX_REMINDERS_PER_RUN'];

  test('AC-8 infra/reminders.tf holds the table, the function, the role and its policy, the rule, its target and its permission', ({}, testInfo) => {
    once(testInfo.project.name);
    expect(existsSync(REMINDERS_TF), 'infra/reminders.tf exists').toBe(true);
    const own = (type: string) => blocks([REMINDERS_TF], 'resource').filter((b) => b.labels[0] === type);
    for (const type of ['aws_dynamodb_table', 'aws_lambda_function', 'aws_iam_role', 'aws_iam_role_policy', 'aws_cloudwatch_event_rule', 'aws_cloudwatch_event_target', 'aws_lambda_permission']) {
      expect(own(type).length, `infra/reminders.tf defines an ${type}`).toBeGreaterThanOrEqual(1);
    }
    expect(own('aws_lambda_function').map((b) => unquote(attributes(b.body).get('function_name')))).toEqual([FUNCTION_NAME]);
    expect(own('aws_iam_role').map((b) => unquote(attributes(b.body).get('name'))), `the role is named ${ROLE_NAME}`).toEqual([ROLE_NAME]);
  });

  test('AC-8 the claims table: on demand, key pk, TTL on expires_at, point-in-time recovery, protected, on the default encryption', ({}, testInfo) => {
    once(testInfo.project.name);
    const t = [...tablesByLabel().values()].filter((x) => /-reminders$/.test(x.name));
    expect(t, 'one table named naleko-people-<env>-reminders').toHaveLength(1);
    expect(t[0]!.name).toBe('naleko-people-${var.environment}-reminders');
    expect(t[0]!.block.file, 'in infra/reminders.tf').toBe(REMINDERS_TF);
    const a = attributes(t[0]!.block.body);
    expect(a.get('billing_mode')).toBe('"PAY_PER_REQUEST"');
    expect(a.get('hash_key')).toBe('"pk"');
    expect(a.has('range_key'), 'one key').toBe(false);
    const body = squash(t[0]!.block.body);
    expect(body, 'TTL on expires_at').toMatch(/ttl\{attribute_name="expires_at"enabled=true\}/);
    expect(body, 'point-in-time recovery').toMatch(/point_in_time_recovery\{enabled=true\}/);
    expect(body, 'protected from destroy').toMatch(/lifecycle\{[^}]*prevent_destroy=true/);
    expect(body, 'AWS deletion protection (ops-05 AC-7 protects every table)').toMatch(/deletion_protection_enabled=true/);
    expect(body, 'no customer key: the rows hold ids, a type and a date, so no KMS grant is needed').not.toMatch(/kms_key_arn/);
    expect(body).not.toContain('global_secondary_index');
  });

  test('AC-8 the rule is cron(0 6 * * ? *) on the default bus, enabled only by document_reminders_enabled, with one target and one permission for events.amazonaws.com', ({}, testInfo) => {
    once(testInfo.project.name);
    const rules = blocks([REMINDERS_TF], 'resource').filter((b) => b.labels[0] === 'aws_cloudwatch_event_rule');
    expect(rules).toHaveLength(1);
    const rule = rules[0]!;
    const ra = attributes(rule.body);
    expect(/schedule_expression\s*=\s*"([^"]*)"/.exec(rule.body)?.[1], 'every day at 06:00 UTC, 08:00 in South Africa').toBe('cron(0 6 * * ? *)');
    expect(ra.has('event_bus_name'), 'the default bus: no event_bus_name').toBe(false);
    expect(ra.has('event_pattern'), 'a schedule, not a pattern').toBe(false);
    expect(ra.get('state')).toBe('var.document_reminders_enabled?"ENABLED":"DISABLED"');
    const ruleRef = `aws_cloudwatch_event_rule.${rule.labels[1]}`;
    const targets = blocks([REMINDERS_TF], 'resource').filter((b) => b.labels[0] === 'aws_cloudwatch_event_target');
    expect(targets).toHaveLength(1);
    const ta = attributes(targets[0]!.body);
    expect(ta.get('rule')).toMatch(new RegExp(`^${ruleRef}\\.name$`));
    expect(ta.get('arn')).toBe(`aws_lambda_function.${fnLabel()}.arn`);
    expect(ta.has('event_bus_name'), 'the target is on the default bus too').toBe(false);
    const perms = resources('aws_lambda_permission').filter((b) => squash(b.body).includes(fnLabel()) || squash(b.body).includes(FUNCTION_NAME));
    expect(perms, 'the only permission for the function').toHaveLength(1);
    const pa = attributes(perms[0]!.body);
    expect(unquote(pa.get('principal'))).toBe('events.amazonaws.com');
    expect(pa.get('source_arn'), 'only this rule may invoke it').toBe(`${ruleRef}.arn`);
    expect(unquote(pa.get('action'))).toBe('lambda:InvokeFunction');
    expect(pa.get('function_name') ?? '').toMatch(new RegExp(`aws_lambda_function\\.${fnLabel()}\\.(function_name|arn)$`));
  });

  test('AC-8 variable document_reminders_enabled defaults to false; dev.tfvars sets it true; prod does not set it', ({}, testInfo) => {
    once(testInfo.project.name);
    const v = blocks([join(INFRA, 'variables.tf')], 'variable').filter((b) => b.labels[0] === 'document_reminders_enabled');
    expect(v, 'one variable document_reminders_enabled in variables.tf').toHaveLength(1);
    const va = attributes(v[0]!.body);
    expect(va.get('type')).toBe('bool');
    expect(va.get('default')).toBe('false');
    expect(tfvarRaw(join(INFRA, 'env', 'dev.tfvars'), 'document_reminders_enabled'), 'dev is enabled (every seeded person is a test login)').toBe('true');
    for (const f of infraFiles().filter((p) => /\.tfvars$/.test(p) && !/dev\.tfvars$/.test(p))) {
      expect(tfvarRaw(f, 'document_reminders_enabled'), `${f.slice(INFRA.length + 1)} leaves prod switched off until go-live (OPS-04)`).not.toBe('true');
    }
  });

  test('AC-8 the function: 300 seconds, no function URL, one concurrent run if the account allows, tracing on, its own log group', ({}, testInfo) => {
    once(testInfo.project.name);
    const f = fn();
    const a = attributes(f.body);
    expect(a.get('timeout'), 'timeout = 300 (C-2)').toBe('300');
    if (a.has('reserved_concurrent_executions')) expect(a.get('reserved_concurrent_executions'), 'at most one run at a time').toBe('1');
    expect(a.get('role')).toBe(`aws_iam_role.${roleLabel()}.arn`);
    expect(f.file, 'in infra/reminders.tf').toBe(REMINDERS_TF);
    expect(squash(f.body)).toContain('logging_config{log_format="JSON"log_group="/aws/lambda/sendDocumentReminders"}');
    expect(squash(f.body)).toMatch(/tracing_config\{mode="Active"\}/);
    expect(resources('aws_lambda_function_url').filter((b) => squash(b.body).includes(fnLabel()) || squash(b.body).includes(FUNCTION_NAME)), 'no function URL').toEqual([]);
    expect(resources('aws_lambda_alias').filter((b) => squash(b.body).includes(fnLabel())), 'no alias').toEqual([]);
  });

  test('AC-8 every setting the Lambda reads is set in Terraform and has no fallback value in code; MAX_REMINDERS_PER_RUN is 500', ({}, testInfo) => {
    once(testInfo.project.name);
    const set = settings();
    for (const name of SETTING_NAMES) expect(set.has(name), `${name} is set on the function`).toBe(true);
    expect(set.get('MAX_REMINDERS_PER_RUN')).toBe('"500"');
    expect(set.get('POSTMARK_API_TOKEN'), 'the token comes from the SSM data source, as sendNotificationEmail gets it').toBe('data.aws_ssm_parameter.postmark_token.value');
    expect(set.get('LOGIN_URL')).toBe('var.login_url');
    const tables = tablesByLabel();
    const named = (setting: string) => {
      const m = /^aws_dynamodb_table\.([\w-]+)\.name$/.exec(set.get(setting) ?? '');
      return m ? tables.get(m[1]!)?.name : (set.get(setting) ?? '').replace(/"/g, '');
    };
    expect(named('EMPLOYEES_TABLE')).toBe('employees');
    expect(named('DOCUMENTS_TABLE')).toBe('documents');
    expect(named('TENANTS_TABLE')).toMatch(/-tenants$/);
    expect(named('REMINDERS_TABLE')).toMatch(/-reminders$/);
    const body = code();
    const read = new Set([...body.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g), ...body.matchAll(/process\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g)].map((m) => m[1]!));
    for (const name of read) {
      if (/^(AWS_|LAMBDA_|_HANDLER|TZ$|NODE_|POWERTOOLS_|AI_CALLS_ENABLED$)/.test(name)) continue;
      expect(set.has(name), `${name} is read by the Lambda and is set in Terraform`).toBe(true);
    }
    for (const name of SETTING_NAMES.filter((n) => n !== 'LEGACY_TENANT_ID')) {
      expect(body, `${name} has no fallback value in code`).not.toMatch(new RegExp(`process\\.env(?:\\.${name}|\\[\\s*['"]${name}['"]\\s*\\])\\s*(?:\\|\\||\\?\\?)`));
    }
    expect(body, 'the cap comes from the setting (C-7)').toMatch(/MAX_REMINDERS_PER_RUN/);
  });

  test('AC-8 the role: logs, X-Ray and the DynamoDB actions named, no `*` on a DynamoDB resource, no write on employees, documents or the tenants table', ({}, testInfo) => {
    once(testInfo.project.name);
    const { statements, managed } = policy();
    expect(managed.filter((m) => !/AWSXRayDaemonWriteAccess"?$/.test(m)), 'no managed policy beyond X-Ray').toEqual([]);
    const scans: string[] = [];
    for (const s of statements) {
      expect(s.Effect).toBe('Allow');
      expect(s['NotAction'] ?? s['NotResource'], 'no NotAction or NotResource').toBeUndefined();
      const resourcesOf = Array.isArray(s.Resource) ? s.Resource : s.Resource === undefined ? [] : [s.Resource];
      const actions = Array.isArray(s.Action) ? s.Action : s.Action === undefined ? [] : [s.Action];
      for (const a of actions) {
        expect(a, `no wildcard action: ${a}`).not.toMatch(/\*/);
        if (/^logs:/.test(a)) {
          expect(['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents']).toContain(a);
          expect(resourcesOf.every((r) => String(r).includes('log-group:/aws/lambda/sendDocumentReminders')), 'logs only on its own log group').toBe(true);
          continue;
        }
        if (/^xray:/.test(a)) {
          expect(['xray:PutTraceSegments', 'xray:PutTelemetryRecords']).toContain(a);
          continue;
        }
        expect(a, `${a}: only logs, X-Ray and DynamoDB`).toMatch(/^dynamodb:/);
        for (const res of resourcesOf) {
          const t = targetOf(String(res));
          expect(t.star, `${a}: no * on a DynamoDB resource (${res})`).toBe(false);
          const ok: Record<string, (x: typeof t) => boolean> = {
            'dynamodb:Query': (x) => (x.table === 'employees' && (x.index === undefined || x.index === 'tenant-index')) || (x.table === 'documents'),
            'dynamodb:Scan': (x) => (x.table === 'employees' || x.table === 'tenants') && x.index === undefined,
            'dynamodb:GetItem': (x) => x.table === 'tenants' && x.index === undefined,
            'dynamodb:PutItem': (x) => x.table === 'reminders' && x.index === undefined,
            'dynamodb:DeleteItem': (x) => x.table === 'reminders' && x.index === undefined,
          };
          expect(ok[a] !== undefined, `${a} is not an action the role needs`).toBe(true);
          expect(ok[a]!(t), `${a} on ${res} (${t.table}${t.index ? '/' + t.index : ''}) is not allowed`).toBe(true);
          if (a === 'dynamodb:Scan' && t.table === 'tenants') scans.push(JSON.stringify(s.Condition ?? null));
        }
      }
    }
    // The actions the role needs are all there.
    const have = new Set(statements.flatMap((s) => (Array.isArray(s.Action) ? s.Action : [s.Action as string])));
    for (const a of ['dynamodb:Query', 'dynamodb:Scan', 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:DeleteItem']) expect(have.has(a), `${a} is granted`).toBe(true);
    // C-4: the tenants Scan may read the five attributes only.
    expect(scans, 'the tenants table is scanned by one statement').toHaveLength(1);
    const cond = conditionKeys(JSON.parse(scans[0]!) as unknown);
    const attrs = cond.find((c) => c.key === 'dynamodb:Attributes');
    expect(attrs, 'the Scan statement limits dynamodb:Attributes (C-4)').toBeDefined();
    expect(attrs!.operator, 'every attribute asked for must be one of these').toMatch(/^ForAllValues:/);
    expect([...attrs!.values].sort()).toEqual(['founding', 'modules', 'pk', 'sk', 'status']);
    expect(cond.find((c) => c.key === 'dynamodb:Select')?.values, 'and only a projection may be asked for').toEqual(['SPECIFIC_ATTRIBUTES']);
  });

  test('AC-8 no bedrock, textract, ssm, kms, secrets, S3, SES, SNS, SQS, events or lambda right on the role; Scan only on employees and the tenants table', ({}, testInfo) => {
    once(testInfo.project.name);
    const text = squash(JSON.stringify(policy().statements));
    for (const bad of ['bedrock', 'textract', 'ssm:', 'kms:', 'secretsmanager', 's3:', 'ses:', 'sns:', 'sqs:', 'events:', 'lambda:', 'states:', 'cognito', 'iam:', 'comprehend']) {
      expect(text.toLowerCase(), `the role has no ${bad} right`).not.toContain(bad);
    }
    const scanTargets = policy().statements.filter((s) => (Array.isArray(s.Action) ? s.Action : [s.Action]).includes('dynamodb:Scan')).flatMap((s) => (Array.isArray(s.Resource) ? s.Resource : [s.Resource as string]));
    expect(scanTargets.map((r) => targetOf(String(r)).table).sort(), 'Scan on employees and the tenants table, never on documents or the claims table (C-8)').toEqual(['employees', 'tenants']);
  });

  test('AC-8 the role is in dynamodb_read_role_arns and not in allowed_role_arns; no role leaves either list', ({}, testInfo) => {
    once(testInfo.project.name);
    const mine = `aws_iam_role.${roleLabel()}.arn`;
    const now = kmsLists();
    expect(now.readers, 'the role may decrypt through DynamoDB').toContain(mine);
    expect(now.allowed, 'and may not encrypt or make data keys').not.toContain(mine);
    const base = JSON.parse(readFileSync(join(__dirname, 'support', 'onb-21', 'kms-lists-c859f0f.json'), 'utf8')) as { lists: { allowed: string[]; readers: string[] } };
    for (const e of base.lists.allowed) expect(now.allowed, `allowed_role_arns keeps ${e}`).toContain(e);
    for (const e of base.lists.readers) expect(now.readers, `dynamodb_read_role_arns keeps ${e}`).toContain(e);
  });

  test('AC-8 the function is in lambda_names of alarms.tf and dashboards.tf, and its log group is in cloudwatch.tf (C-5)', ({}, testInfo) => {
    once(testInfo.project.name);
    for (const f of ['alarms.tf', 'dashboards.tf']) {
      const m = blocks([join(INFRA, f)], 'module')[0]!;
      const names = [...(/lambda_names\s*=\s*\[([\s\S]*?)\]/.exec(m.body)?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((x) => x[1]);
      expect(names, `${f}: lambda_names lists ${FUNCTION_NAME}`).toContain(FUNCTION_NAME);
    }
    expect(readFileSync(join(INFRA, 'cloudwatch.tf'), 'utf8'), 'cloudwatch.tf lists the log group').toContain('"/aws/lambda/sendDocumentReminders"');
  });

  test('AC-8 only the rule can invoke the function: no other file in infra/ names it, no URL, no other invoker (C-7)', ({}, testInfo) => {
    once(testInfo.project.name);
    const allowed = ['reminders.tf', 'alarms.tf', 'dashboards.tf', 'cloudwatch.tf'];
    const label = fnLabel();
    for (const f of infraFiles().filter((p) => !/\.(tfstate|backup)$|\.terraform|\.tfbackend$|\.lock\.hcl$/.test(p))) {
      const name = f.slice(INFRA.length + 1);
      if (allowed.includes(name)) continue;
      const text = readFileSync(f, 'utf8');
      expect(text, `${name} does not name ${FUNCTION_NAME}`).not.toContain(FUNCTION_NAME);
      expect(text, `${name} does not refer to aws_lambda_function.${label}`).not.toMatch(new RegExp(`aws_lambda_function\\.${label}\\b`));
    }
    for (const name of ['alarms.tf', 'dashboards.tf', 'cloudwatch.tf']) {
      const text = stripComments(readFileSync(join(INFRA, name), 'utf8'));
      expect(text, `${name} mentions it only as a name in a list`).not.toMatch(new RegExp(`aws_lambda_function\\.${label}\\b`));
    }
    const invokers = resources('aws_lambda_permission').filter((b) => squash(b.body).includes(FUNCTION_NAME) || squash(b.body).includes(`aws_lambda_function.${label}`));
    expect(invokers).toHaveLength(1);
    expect(infraFiles().filter((p) => p.endsWith('reminders.tf') && p !== REMINDERS_TF)).toEqual([]);
    expect(squash(readFileSync(REMINDERS_TF, 'utf8')), 'nothing in the file grants lambda:InvokeFunction but the one permission').not.toMatch(/Action="?\[?"?lambda:/);
  });

  test('AC-8 the tenants table gets no new index, and Terraform manages no table data (C-4, LESSONS 16 Nov)', ({}, testInfo) => {
    once(testInfo.project.name);
    const tenants = tablesByLabel().get('tenants')!;
    expect(tenants, 'aws_dynamodb_table.tenants').toBeDefined();
    const gsi = [...tenants.block.body.matchAll(/global_secondary_index\s*\{\s*name\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(gsi, 'the company index only').toEqual(['tenant-index']);
    expect(resources('aws_dynamodb_table_item'), 'no table data in Terraform').toEqual([]);
    expect(squash(readFileSync(REMINDERS_TF, 'utf8'))).not.toContain('aws_dynamodb_table_item');
  });

  test('AC-8 the Lambda imports the shared tenant, due-date, reminder-email and required-documents modules, and reads no company, person or date from the event', ({}, testInfo) => {
    once(testInfo.project.name);
    const body = code();
    for (const m of ['tenant', 'due-date', 'reminder-email', 'required-documents']) {
      expect(body, `imports ../shared/${m}.mjs`).toMatch(new RegExp(`from\\s+['"]\\.\\./shared/${m}\\.mjs['"]`));
    }
    expect(body, 'the event is never read').not.toMatch(/\bevent\s*(?:\?\.|\.|\[)/);
    expect(body, 'no company, person or date from an event, a body or a query').not.toMatch(/(?:body|queryStringParameters|pathParameters|headers|detail)\s*(?:\?\.|\.|\[)/);
    expect(body, 'a number of days is not typed here: the rule is in due-date.mjs').not.toMatch(/\b(?:days?|DAYS|Days)\w*\s*[=:]\s*[0-9]/);
    expect(body, 'a day count is not worked out here').not.toMatch(/\b86400000\b|\b24\s*\*\s*60\s*\*\s*60/);
  });

  test('AC-8 the Lambda uses lambda/shared/due-date.mjs for the due date and the window: a different rule there changes who is reminded, and nothing in the Lambda holds 7 or 2 days', ({}, testInfo) => {
    once(testInfo.project.name);
    const handler = treeWith({
      'shared/due-date.mjs': () => `// Test stand-in: 10 days before the start date, a window of 1 day.
export const DOCUMENTS_DUE_DAYS_BEFORE_START = 10;
export const REMINDER_DAYS_BEFORE_DUE = 1;
const ok = (s) => typeof s === 'string' && /^\\d{4}-\\d{2}-\\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const day = (s) => Date.parse(s + 'T00:00:00Z');
const add = (s, n) => new Date(day(s) + n * 86400000).toISOString().slice(0, 10);
export function dueDaysFor() { return 10; }
export function documentsDueDate(start) { return ok(start) ? add(start, -10) : null; }
export function todayInJohannesburg(now = new Date()) { return new Date(now.getTime() + 2 * 3600000).toISOString().slice(0, 10); }
export function daysBetween(from, to) { return Math.round((day(to) - day(from)) / 86400000); }
export function reminderDue(due, today) { if (!ok(due) || !ok(today)) return false; const n = daysBetween(today, due); return n >= 0 && n <= 1; }
`,
    });
    // Start 2026-12-01 is due 2026-11-21 under the stand-in: the window is the 20th and the 21st. Under the real rule it is 11-24.
    const on20 = go(oneDue(), '2026-11-20', { handler });
    expect(on20.error, `no error: ${on20.error?.message}`).toBeUndefined();
    expect(on20.sent, 'the window and the due date come from due-date.mjs: reminded on the 20th').toHaveLength(1);
    expect(shownFromHtml(on20.sent[0]!.HtmlBody ?? '')).toContain('21 Nov 2026');
    const on22 = go(oneDue(), '2026-11-22', { handler });
    expect(on22.sent, 'and not on the 22nd, which is past the stand-in due date').toHaveLength(0);
  });

  test('AC-8 nothing in the Lambda calls Bedrock or any paid AI; no word of the email is in it; "Masked", "password" and "Work email" are in no new file', ({}, testInfo) => {
    once(testInfo.project.name);
    const all = src();
    expect(all).not.toMatch(/bedrock|textract|anthropic|openai|comprehend|rekognition|invokeModel/i);
    for (const file of [LAMBDA_FILE, join(LAMBDA, 'shared', 'reminder-email.mjs'), REMINDERS_TF]) {
      const text = readFileSync(file, 'utf8');
      expect(text, `${rel(file)} has no "password"`).not.toMatch(/password/i);
      expect(text, `${rel(file)} has no "Masked"`).not.toMatch(/masked/i);
      expect(text, `${rel(file)} has no "Work email"`).not.toMatch(/work email/i);
    }
    for (const w of [w1(''), 'Still to upload', 'Hi ${', BUTTON, 'Sign in to Naleko People', 'are due on']) {
      expect(all, `the Lambda holds no email words: "${w.trim()}"`).not.toContain(w.trim());
    }
    expect(all, 'no sentence of the email is typed in the Lambda (C-1a)').not.toMatch(/Your documents|upload your documents/i);
  });

  test('AC-8 getMyDocuments no longer holds its own copy of the rule that a file arrived; the shared rule serves both', ({}, testInfo) => {
    once(testInfo.project.name);
    const mine = stripComments(readFileSync(join(LAMBDA, 'getMyDocuments', 'index.mjs'), 'utf8'));
    expect(mine, 'no private `counts` rule in getMyDocuments').not.toMatch(/ocr_status\s*[!=]==?\s*['"]PENDING['"]/);
    expect(mine).toMatch(/from\s+['"]\.\.\/shared\/required-documents\.mjs['"]/);
    expect(code(), 'no private `counts` rule in the reminder Lambda').not.toMatch(/ocr_status\s*[!=]==?\s*['"]PENDING['"]/);
  });

  test('AC-8 tenant-retrofit.json stays [], and no route, no api/openapi.yaml entry and no API Gateway reference is added', ({}, testInfo) => {
    once(testInfo.project.name);
    expect(existsSync(LAMBDA_FILE), 'lambda/sendDocumentReminders/index.mjs exists').toBe(true);
    expect(JSON.parse(readFileSync(join(LAMBDA, 'shared', 'tenant-retrofit.json'), 'utf8'))).toEqual([]);
    expect(readFileSync(join(ROOT, 'api', 'openapi.yaml'), 'utf8')).not.toMatch(/DocumentReminders|document-reminders|reminders/i);
    expect(readFileSync(join(INFRA, 'apigateway.tf'), 'utf8')).not.toMatch(/DocumentReminders/);
  });
});

// ================================================================ AC-9 Time and brakes (C-2, C-7)

test.describe('AC-9 time and brakes', () => {
  test('AC-9 with the time falling below the safe margin part-way, the run stops cleanly before the next person, releases what it claimed and throws; the next run finishes the rest, with no repeats', ({}, testInfo) => {
    once(testInfo.project.name);
    const tables = world({ people: [P.naledi, P.sipho, P.thandi, P.lebo].map((p) => person(p, A)) });
    // 300 s left at first; after two emails have been tried only 1 s is left (below any margin for releasing and throwing).
    const run = go(tables, '2026-11-22', { remaining: [300_000, 300_000, 1_000] });
    expect(run.error, 'the run ends by throwing').toBeDefined();
    expect(run.sent, 'two people were emailed before the time ran low').toHaveLength(2);
    expect(run.refused).toHaveLength(0);
    const done = recipients(run);
    expect(idsClaimed(run), 'claims only for the people emailed: nothing is left claimed and unsent').toEqual(
      [P.naledi, P.sipho, P.thandi, P.lebo].filter((p) => done.includes(p.email)).map((p) => p.id).sort(),
    );
    expect(claims(run.tables)).toHaveLength(4);
    const next = go(run.tables, '2026-11-23');
    expect(next.error, `the next run finishes without an error: ${next.error?.message}`).toBeUndefined();
    expect(recipients(next).sort(), 'the two left are emailed').toEqual([P.naledi, P.sipho, P.thandi, P.lebo].map((p) => p.email).filter((e) => !done.includes(e)).sort());
    expect(claims(next.tables)).toHaveLength(8);
  });

  test('AC-9 with plenty of time left (300 s, or 20 s) the run does not stop early', ({}, testInfo) => {
    once(testInfo.project.name);
    const tables = world({ people: [P.naledi, P.sipho, P.thandi, P.lebo].map((p) => person(p, A)) });
    for (const left of [300_000, 120_000]) {
      const run = go(tables, '2026-11-22', { remaining: [left] });
      expect(run.error, `${left} ms left: no error: ${run.error?.message}`).toBeUndefined();
      expect(run.sent).toHaveLength(4);
    }
  });

  test('AC-9 an exception between the claim and the send releases the claim (the claim-to-send try/finally)', ({}, testInfo) => {
    once(testInfo.project.name);
    const handler = treeWith({ 'shared/reminder-email.mjs': () => `export function reminderEmail() { throw new Error('stand-in: the email could not be built'); }\n` });
    const run = go(three(), '2026-11-22', { handler });
    expect(run.sent, 'nothing is sent').toHaveLength(0);
    expect(run.refused).toHaveLength(0);
    expect(claims(run.tables), 'nothing stays claimed: an error releases').toHaveLength(0);
    expect(run.error, 'the run ends with an error').toBeDefined();
  });

  test('AC-9 with MAX_REMINDERS_PER_RUN at 2 and 3 people due, exactly 2 are emailed, the third one claims are released, and the run throws', ({}, testInfo) => {
    once(testInfo.project.name);
    const run = go(three(), '2026-11-22', { env: { MAX_REMINDERS_PER_RUN: '2' } });
    expect(run.error, 'the run throws').toBeDefined();
    expect(run.sent, 'exactly 2 are emailed').toHaveLength(2);
    expect(idsClaimed(run), 'the person left out has no claim').toHaveLength(2);
    expect(claims(run.tables)).toHaveLength(4);
    const next = go(run.tables, '2026-11-23');
    expect(recipients(next), 'the next run sends the third').toHaveLength(1);
    expect(new Set([...recipients(run), ...recipients(next)]).size).toBe(3);
  });

  test('AC-9 the cap counts people emailed, not documents, and a run under the cap is a clean run', ({}, testInfo) => {
    once(testInfo.project.name);
    const capped = go(three(), '2026-11-22', { env: { MAX_REMINDERS_PER_RUN: '2' } });
    expect(capped.sent, 'three people owe two documents each: the cap is on emails').toHaveLength(2);
    const under = go(world({ people: [person(P.naledi, A), person(P.sipho, A)] }), '2026-11-22', { env: { MAX_REMINDERS_PER_RUN: '3' } });
    expect(under.error, `under the cap: no error: ${under.error?.message}`).toBeUndefined();
    expect(under.sent).toHaveLength(2);
  });

  test('AC-9 a start-date import that puts a whole company in the window cannot email more than the cap', ({}, testInfo) => {
    once(testInfo.project.name);
    const people = Array.from({ length: 12 }, (_v, i) => person({ id: `EMP-30${String(i).padStart(2, '0')}`, first: `Person${i}`, last: 'Import', email: `person${i}.import@kestrel.example` }, A));
    const run = go(world({ people }), '2026-11-22', { env: { MAX_REMINDERS_PER_RUN: '5' } });
    expect(run.sent).toHaveLength(5);
    expect(run.error).toBeDefined();
    expect(claims(run.tables)).toHaveLength(10);
  });

  test('AC-9 the cap is read from the setting, not from the event', ({}, testInfo) => {
    once(testInfo.project.name);
    const capped = go(three(), '2026-11-22', { env: { MAX_REMINDERS_PER_RUN: '2' }, event: scheduledEvent({ cap: 100, limit: 100, MAX_REMINDERS_PER_RUN: 100, detail: { MAX_REMINDERS_PER_RUN: 100, max: 100, cap: 100, limit: 100, maxReminders: 100 } }) });
    expect(capped.sent, 'an event that asks for 100 does not raise the cap').toHaveLength(2);
    const roomy = go(three(), '2026-11-22', { env: { MAX_REMINDERS_PER_RUN: '500' }, event: scheduledEvent({ cap: 1, limit: 1, MAX_REMINDERS_PER_RUN: 1, detail: { MAX_REMINDERS_PER_RUN: 1, max: 1, cap: 1, limit: 1, maxReminders: 1 } }) });
    expect(roomy.error, `an event that asks for 1 does not lower it: ${roomy.error?.message}`).toBeUndefined();
    expect(roomy.sent).toHaveLength(3);
  });
});
