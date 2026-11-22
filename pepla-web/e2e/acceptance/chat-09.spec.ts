import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ON_DEV, expect, test } from './support/fixtures';
import { LAMBDA, PROBE, runHandler, type FetchRule, type Run } from './support/chat-09/harness';
import { countBySteps, isOverdue, orderNewEmployees, toNewEmployee } from '../../src/app/core/employees/employee';
import { settings } from './support/chat-02/world';
import {
  A, B, CHECK_WORD, DECISION_WORD, DOCS_UNREAD, DOC_ROW_KEYS, DOC_WORD, FACT_KEYS, KEY, LIST_KEYS, LIST_PERSON_KEYS, NOW, PIETER, RISK, SAY, SECRET,
  SECRET_VALUES, SENTENCE, START_NOT_SET, STEP_WORD, TODAY, TODAY_PEOPLE, TODAY_WRITTEN, WHAT,
  agentApi, answerCalls, ask, askList, askPerson, calls, contentOf, documentRow, employeeRoute, employeeRow, httpCalls, listItem, listPeople, listRules,
  lookUpPerson, manyPeople, modelCalls, personRules, pieterRow, systemText, tablesWith, turnText, verificationRow, writes,
  type ListPerson, type Out,
} from './support/chat-09/world';

/**
 * CHAT-09 · Ask Batsi gets the person page's facts (red).
 * One test per acceptance criterion, written from the card before any code.
 * Spec: /mnt/project-files/ask-batsi-chat/CHAT-09-person-page-facts.md (19 Nov 2026, after the independent check of the same day),
 * question sheet: CHAT-10-question-check-list.md (its "auto" rows are AC-16). Card notes and what is pinned beyond the text: cards/chat-09.md.
 *
 * The tests run the real Lambdas in a fresh Node process each (a cold Lambda), against CHAT-05's fake AWS with a fixed clock
 * (support/chat-09). The Agent API is a fake whose answers, for one person, come from the real getEmployee and getDocumentVerifications
 * Lambdas run on the same tables first. The model answers from a script the test wrote: the script says which lookup the model calls;
 * the tests then read what the lookup gave the model. Nothing here reaches Bedrock, AWS or any outside host. Runs once (desktop-1280).
 *
 * Today in every test is Thursday 19 Nov 2026, 10:00 in South Africa, unless a test says otherwise.
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};

let numberRule: ((text: string) => boolean) | undefined;
/** The shared rule (lambda/shared/pii-redact.mjs, CHAT-02) for "this text still holds a number". */
async function hasNumberRun(text: string): Promise<boolean> {
  numberRule ??= (await import(pathToFileURL(join(LAMBDA, 'shared', 'pii-redact.mjs')).href)).hasNumberRun;
  return numberRule!(text);
}

const sorted = (a: string[]) => [...a].sort();
const AT = (day: number) => `2026-11-${String(day).padStart(2, '0')}T08:00:00.000Z`;
const ID = 'NATIONAL_ID';
const CHAT_ROWS = 'ask-batsi-chats'; // CHAT-02's chat rows table
const BANK = 'BANK_CONFIRMATION';
const MATRIC = 'MATRIC_CERTIFICATE';

/** What the page shows for these people (HR home's own functions on the same rows and today). */
const asHome = (people: ListPerson[]) => people.map((p) => toNewEmployee(listItem(p) as any));
const homeOrder = (people: ListPerson[]) => orderNewEmployees(asHome(people), TODAY).map((p) => p.name);
const namesOf = (list: any): string[] => (list?.people ?? []).map((p: any) => p.name);
const nameOf = (p: ListPerson) => `${p.first} ${p.last}`;
const pick = (...ids: string[]) => TODAY_PEOPLE.filter((p) => ids.includes(p.id));
const listUrls = (r: Run) => httpCalls(r).filter((c) => new URL(c.url).pathname === '/agent/v1/employees');

/** One person in company A with documents: the rows, and the Agent API rules the real routes answer on them. */
function personWith(over: Parameters<typeof employeeRow>[0], docs: { documents?: Record<string, unknown>[]; verifications?: Record<string, unknown>[] } = {}) {
  const tables = tablesWith([employeeRow(over)], docs);
  return { tables, id: over.id };
}

/** Every string in the JSON with the key it sits under. */
function stringsOf(v: unknown, key = ''): { key: string; value: string }[] {
  if (typeof v === 'string') return [{ key, value: v }];
  if (Array.isArray(v)) return v.flatMap((x) => stringsOf(x, key));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => stringsOf(x, k));
  return [];
}

test.describe('CHAT-09 · Ask Batsi gets the person page\'s facts', () => {
  test.beforeEach(({}, testInfo) => once(testInfo.project.name));

  // ---------------------------------------------------------------- the person route

  test('AC-1 getEmployee answers the 16 keys: step from the old stage, due date, HR partner, risk date; nothing private; another company 404', async () => {
    test.setTimeout(120_000);
    const P = 'EMP-A-0101';
    const tables = tablesWith([
      employeeRow({ id: P, first: 'Kagiso', last: 'Molefe', job_title: 'Bookkeeper', department: 'Finance', stage: 'ACTIVE', start: '2026-11-30', partnerId: 'STAFF-THANDI', partnerName: 'Thandi Demo-HR', riskBand: 'LOW', riskReason: 'Both documents match.', riskAt: '2026-11-12T08:00:00.000Z' }),
      employeeRow({ id: 'EMP-A-0102', first: 'Lerato', last: 'Sithole', stage: 'VERIFIED', step: 'VERIFIED', start: '', riskBand: 'LOW', riskReason: 'Fine.', riskAt: '2026-11-13T08:00:00.000Z', job_title: 'Clerk' }),
    ]);
    const r = employeeRoute(tables, P);
    expect(r.status, `getEmployee answers 200 (${WHAT(r)})`).toBe(200);
    const e = r.json?.employee ?? {};
    expect(sorted(Object.keys(e)), 'exactly the 10 old keys and the 6 new ones').toEqual(sorted([
      'created_at', 'department', 'email', 'employee_id', 'first_name', 'last_name', 'risk_band', 'risk_reason', 'stage', 'updated_at',
      'job_title', 'step', 'planned_start_date', 'documents_due', 'hr_staff_name', 'risk_assessed_at',
    ]));
    expect(e.step, 'the step comes from the old stage: ACTIVE with no step is DOCUMENTS').toBe('DOCUMENTS');
    expect(e.planned_start_date, 'the start date as stored').toBe('2026-11-30');
    expect(e.documents_due, 'documents are due 7 days before the start').toBe('2026-11-23');
    expect([e.job_title, e.hr_staff_name, e.risk_assessed_at], 'job title, HR partner and when the risk was checked').toEqual(['Bookkeeper', 'Thandi Demo-HR', '2026-11-12T08:00:00.000Z']);
    expect(e.stage, 'the old key stays as it was').toBe('ACTIVE');
    for (const [what, value] of Object.entries({ phone: SECRET_VALUES.phone, 'ID digits': SECRET_VALUES.last4, 'HR partner email': SECRET_VALUES.partnerEmail, 'encrypted ID': SECRET_VALUES.encrypted, company: A }))
      expect(r.text, `the body holds no ${what}`).not.toContain(value);
    expect(r.text, 'and no private key name').not.toMatch(/"phone"|id_number|hr_staff_email|tenant_id|encrypted/);

    const noDate = employeeRoute(tables, 'EMP-A-0102');
    expect(noDate.json?.employee?.planned_start_date ?? '', 'no start date gives an empty start').toBe('');
    expect(noDate.json?.employee?.documents_due ?? '', 'and an empty due date').toBe('');
    expect(noDate.json?.employee?.step, 'a stored step is kept').toBe('VERIFIED');

    const other = employeeRoute(tables, P, B);
    expect(other.status, 'another company asking for this person gets 404').toBe(404);
    expect(other.text, 'and learns nothing about them').not.toMatch(/Kagiso|Molefe|Finance|Bookkeeper|Thandi/);
  });

  // ---------------------------------------------------------------- one person's facts

  test('AC-2 Pieter\'s case: step Documents, the start and due dates written out, both documents Missing, not ready, overdue, not assessed; the raw answer is kept', async () => {
    test.setTimeout(120_000);
    const tables = tablesWith([pieterRow()]);
    const { out, facts, content } = askPerson(PIETER, tables, { focus: PIETER });
    expect(out.status, `the answer is 200 (${WHAT(out)})`).toBe(200);
    expect(out.json?.message, 'the model\'s sentence is the message').toBe(SENTENCE);
    expect(content, 'the model was given a get_employee result').toBeTruthy();
    expect(content!.isError, 'and it is not an error').toBe(false);
    expect(sorted(Object.keys(facts ?? {})), 'the model gets exactly the facts keys').toEqual(sorted(FACT_KEYS));
    expect(facts).toMatchObject({
      name: 'Pieter van Wyk', email: 'pieter.vanwyk@sunbird.example', department: 'Operations', job_title: 'Warehouse Lead', hr_partner: 'Thandi Demo-HR',
      step: STEP_WORD.DOCUMENTS, start: '2026-11-10', start_written: '10 Nov 2026', due: '2026-11-03', due_written: '3 Nov 2026',
      ready_to_start: 'no', days_until_start: -9, documents_overdue: true,
    });
    expect(facts.because, 'the reasons, in the page\'s words').toEqual([`${DOC_WORD.NATIONAL_ID}: ${CHECK_WORD.MISSING}`, `${DOC_WORD.BANK_CONFIRMATION}: ${CHECK_WORD.MISSING}`]);
    expect(facts.risk?.result, 'no risk check yet: the page\'s "Not assessed"').toBe(RISK.NONE);
    expect(facts.risk?.assessed_written ?? '', 'and no date').toBe('');
    expect(facts.risk?.reason || '', 'and no reason').toBe('');
    expect(facts.documents, 'one row per required document, both Missing').toEqual([
      { document: DOC_WORD.NATIONAL_ID, required: true, check: CHECK_WORD.MISSING, hr_decision: '', uploaded_written: '', decided_written: '' },
      { document: DOC_WORD.BANK_CONFIRMATION, required: true, check: CHECK_WORD.MISSING, hr_decision: '', uploaded_written: '', decided_written: '' },
    ]);
    expect(content!.text, 'no old stage word').not.toContain('ACTIVE');
    expect(content!.text, 'no created date, stage or company').not.toMatch(/created|stage|tenant/i);

    // Two Agent API calls: the person, then their documents (CHAT-05's per-person route), both with the server key.
    const urls = httpCalls(out.run).map((c) => c.url);
    expect(urls, 'the person, then their documents').toEqual([
      `https://agent.example.test/agent/v1/employees/${PIETER}`,
      `https://agent.example.test/agent/v1/verifications?employee_id=${PIETER}`,
    ]);
    // CHAT-05 AC-3's pin: the raw answer stays under structuredData.employee.
    expect(out.json?.structuredData?.employee, 'structuredData.employee is still the Agent API\'s raw answer').toEqual(employeeRoute(tables, PIETER).json);
    expect(out.json?.toolCallsMade, 'the call is told as before').toEqual([{ tool: 'get_employee', isError: false }]);

    // September is written the page's way ("Sep", as dateText in core/deadline.ts).
    const sep = askPerson('EMP-SEP', tablesWith([employeeRow({ id: 'EMP-SEP', first: 'Sep', last: 'Tember', stage: 'INVITED', start: '2026-09-30' })]));
    expect([sep.facts?.start_written, sep.facts?.due_written], 'a September start and due date').toEqual(['30 Sep 2026', '23 Sep 2026']);
  });

  test('AC-3 Ready to start only at Verified with a start date; the reasons are the page\'s own words: document, check and HR\'s decision', async () => {
    test.setTimeout(240_000);
    const docsOf = (id: string, d: { id: [string, string, boolean]; bank: [string, string, boolean]; matric?: boolean }) => ({
      documents: [
        documentRow(id, `${id}-d-id`, ID, d.id[1], { verification: `${id}-v-id`, at: AT(10), reviewed: d.id[2] ? AT(11) : undefined }),
        documentRow(id, `${id}-d-bank`, BANK, d.bank[1], { verification: `${id}-v-bank`, at: AT(10), reviewed: d.bank[2] ? AT(12) : undefined }),
        ...(d.matric ? [documentRow(id, `${id}-d-matric`, MATRIC, 'PASSED', { verification: `${id}-v-matric`, at: AT(9) })] : []),
      ],
      verifications: [
        verificationRow(`${id}-v-id`, id, `${id}-d-id`, ID, d.id[0]),
        verificationRow(`${id}-v-bank`, id, `${id}-d-bank`, BANK, d.bank[0]),
        ...(d.matric ? [verificationRow(`${id}-v-matric`, id, `${id}-d-matric`, MATRIC, 'MATCHES')] : []),
      ],
    });
    const factsOf = (row: Parameters<typeof employeeRow>[0], d: Parameters<typeof docsOf>[1]) => {
      const p = personWith(row, docsOf(row.id, d));
      const r = askPerson(p.id, p.tables);
      expect(r.out.status, `200 (${WHAT(r.out)})`).toBe(200);
      return r.facts ?? {};
    };

    // Verified, a start date, both required documents Matches and accepted (and a matric, not required).
    const ready = factsOf({ id: 'EMP-R1', first: 'Ready', last: 'One', step: 'VERIFIED', stage: 'VERIFIED', start: '2026-12-01' }, { id: ['MATCHES', 'PASSED', true], bank: ['MATCHES', 'PASSED', true], matric: true });
    expect([ready.ready_to_start, ready.because], 'Verified with a start date: yes, no reasons').toEqual(['yes', []]);
    expect(ready.documents, 'required rows first, then the other upload; written dates; HR\'s decision').toEqual([
      { document: DOC_WORD.NATIONAL_ID, required: true, check: CHECK_WORD.MATCHES, hr_decision: DECISION_WORD.ACCEPTED, uploaded_written: '10 Nov 2026', decided_written: '11 Nov 2026' },
      { document: DOC_WORD.BANK_CONFIRMATION, required: true, check: CHECK_WORD.MATCHES, hr_decision: DECISION_WORD.ACCEPTED, uploaded_written: '10 Nov 2026', decided_written: '12 Nov 2026' },
      { document: DOC_WORD.MATRIC_CERTIFICATE, required: false, check: CHECK_WORD.MATCHES, hr_decision: DECISION_WORD.NONE, uploaded_written: '9 Nov 2026', decided_written: '' },
    ]);
    for (const row of ready.documents ?? []) expect(sorted(Object.keys(row)), 'each row has exactly the row keys').toEqual(sorted(DOC_ROW_KEYS));
    expect([ready.step, ready.days_until_start, ready.documents_overdue], 'Verified, 12 days to go, not overdue').toEqual([STEP_WORD.VERIFIED, 12, false]);

    // In review, both Matches, neither decided.
    const review = factsOf({ id: 'EMP-R2', first: 'Review', last: 'Two', step: 'IN_REVIEW', stage: 'DOCUMENTS_SUBMITTED', start: '2026-12-01' }, { id: ['MATCHES', 'PASSED', false], bank: ['MATCHES', 'PASSED', false] });
    expect([review.ready_to_start, review.because], 'In review: no, each document waits for HR').toEqual(['no', [
      `${DOC_WORD.NATIONAL_ID}: ${CHECK_WORD.MATCHES}, HR decision: ${DECISION_WORD.NONE}`,
      `${DOC_WORD.BANK_CONFIRMATION}: ${CHECK_WORD.MATCHES}, HR decision: ${DECISION_WORD.NONE}`,
    ]]);

    // Documents, the ID Matches but HR asked for a new one, the bank letter accepted.
    const newOne = factsOf({ id: 'EMP-R3', first: 'Again', last: 'Three', step: 'DOCUMENTS', stage: 'ACTIVE', start: '2026-12-01' }, { id: ['MATCHES', 'FAILED', true], bank: ['NEEDS_A_LOOK', 'PASSED', true] });
    expect([newOne.ready_to_start, newOne.because], 'only the document HR has not accepted is a reason').toEqual(['no', [`${DOC_WORD.NATIONAL_ID}: ${CHECK_WORD.MATCHES}, HR decision: ${DECISION_WORD.NEW_ONE_ASKED}`]]);
    expect(newOne.documents?.[1]?.check, 'the bank letter\'s check is its own (Needs a look), whatever HR decided').toBe(CHECK_WORD.NEEDS_A_LOOK);

    // Verified with no start date.
    const noDate = factsOf({ id: 'EMP-R4', first: 'Nodate', last: 'Four', step: 'VERIFIED', stage: 'VERIFIED', start: '' }, { id: ['MATCHES', 'PASSED', true], bank: ['MATCHES', 'PASSED', true] });
    expect([noDate.ready_to_start, noDate.because], 'Verified without a start date: no, "Start date not set"').toEqual(['no', [START_NOT_SET]]);
    expect([noDate.start, noDate.start_written, noDate.due, noDate.due_written, noDate.days_until_start], 'no date: empty dates and no day count').toEqual(['', '', '', '', null]);

    // The newest upload of a type wins, whatever order the rows come in: HR refused the older ID and the person sent a new one.
    for (const order of ['older row first', 'newer row first'] as const) {
      const id = order === 'older row first' ? 'EMP-R6' : 'EMP-R7';
      const older = documentRow(id, `${id}-d-id-old`, ID, 'FAILED', { verification: `${id}-v-id-old`, at: AT(4), reviewed: AT(5) });
      const newer = documentRow(id, `${id}-d-id-new`, ID, 'PASSED', { verification: `${id}-v-id-new`, at: AT(14) });
      const bank = documentRow(id, `${id}-d-bank`, BANK, 'PASSED', { verification: `${id}-v-bank`, at: AT(10), reviewed: AT(12) });
      const p = personWith({ id, first: 'Second', last: 'Upload', step: 'DOCUMENTS', stage: 'ACTIVE', start: '2026-12-01' }, {
        documents: order === 'older row first' ? [older, newer, bank] : [newer, older, bank],
        verifications: [verificationRow(`${id}-v-id-old`, id, `${id}-d-id-old`, ID, 'DOESNT_MATCH'), verificationRow(`${id}-v-id-new`, id, `${id}-d-id-new`, ID, 'MATCHES'), verificationRow(`${id}-v-bank`, id, `${id}-d-bank`, BANK, 'MATCHES')],
      });
      const f = askPerson(p.id, p.tables).facts ?? {};
      expect(f.documents?.[0], `${order}: the ID row is the newer upload (Matches, not decided, 14 Nov), not the refused one`).toEqual({ document: DOC_WORD.NATIONAL_ID, required: true, check: CHECK_WORD.MATCHES, hr_decision: DECISION_WORD.NONE, uploaded_written: '14 Nov 2026', decided_written: '' });
      expect(f.because, `${order}: the reason is the new ID waiting for HR`).toEqual([`${DOC_WORD.NATIONAL_ID}: ${CHECK_WORD.MATCHES}, HR decision: ${DECISION_WORD.NONE}`]);
      expect((f.documents ?? []).length, `${order}: one row per type`).toBe(2);
    }

    // In review with the due date passed: documents are with HR, so not overdue (HR home's rule).
    const late = factsOf({ id: 'EMP-R8', first: 'Late', last: 'Review', step: 'IN_REVIEW', stage: 'DOCUMENTS_SUBMITTED', start: '2026-11-20' }, { id: ['MATCHES', 'PASSED', false], bank: ['MATCHES', 'PASSED', false] });
    expect([late.due_written, late.documents_overdue, late.days_until_start], 'due 13 Nov has passed, but In review is never overdue').toEqual(['13 Nov 2026', false, 1]);

    // A stage that gives no step (stepOf null): no step word is made up, and not ready.
    const odd = factsOf({ id: 'EMP-R5', first: 'Odd', last: 'Five', stage: 'ODD_STAGE', start: '2026-12-01' }, { id: ['MATCHES', 'PASSED', true], bank: ['MATCHES', 'PASSED', true] });
    expect([odd.step, odd.ready_to_start, odd.documents_overdue], 'no step: step null, not ready, not overdue').toEqual([null, 'no', false]);
    expect(JSON.stringify(odd), 'the raw stage is never given').not.toContain('ODD_STAGE');

    // Every word given is one of the page's or CHAT-05's.
    const allowed = new Set<string>([...Object.values(CHECK_WORD), ...Object.values(DECISION_WORD), '']);
    for (const f of [ready, review, newOne, noDate]) {
      for (const row of f.documents ?? []) {
        expect(Object.values(DOC_WORD) as string[], 'a document word of CHAT-05\'s rows').toContain(row.document);
        expect(allowed.has(row.check) && allowed.has(row.hr_decision), `check and decision are the page's words: ${row.check} / ${row.hr_decision}`).toBe(true);
      }
      for (const b of f.because ?? []) expect(b, 'each reason is document: check[, HR decision: decision] or Start date not set').toMatch(new RegExp(`^((${Object.values(DOC_WORD).join('|')}): (${Object.values(CHECK_WORD).join('|')})(, HR decision: (${Object.values(DECISION_WORD).join('|')}))?|${START_NOT_SET})$`));
    }
  });

  test('AC-4 The documents call fails (500, or no answer): the facts still come, documents unknown, never Missing, and the lookup is not an error', async () => {
    test.setTimeout(120_000);
    const tables = tablesWith([pieterRow()]);
    const failures: [string, FetchRule][] = [
      ['a 500', { method: 'GET', url: '/agent/v1/verifications?', status: 500, json: { message: 'Internal server error' } }],
      ['no answer', { method: 'GET', url: '/agent/v1/verifications?', fail: true }],
    ];
    for (const [what, rule] of failures) {
      const { out, facts, content } = askPerson(PIETER, tables, { extra: [rule] });
      expect(out.status, `${what}: still 200 (${WHAT(out)})`).toBe(200);
      expect(sorted(Object.keys(facts ?? {})), `${what}: the facts keys and documents_unknown`).toEqual(sorted([...FACT_KEYS, 'documents_unknown']));
      expect([facts.documents, facts.documents_unknown], `${what}: documents null and unknown`).toEqual([null, true]);
      expect([facts.ready_to_start, facts.because], `${what}: not ready, because the documents could not be read`).toEqual(['no', [DOCS_UNREAD]]);
      expect([facts.name, facts.step, facts.start_written], `${what}: the person's own facts are still there`).toEqual(['Pieter van Wyk', STEP_WORD.DOCUMENTS, '10 Nov 2026']);
      expect(content!.text, `${what}: never "Missing"`).not.toContain(CHECK_WORD.MISSING);
      expect(content!.isError, `${what}: the get_employee result is not an error`).toBe(false);
      expect(out.json?.toolCallsMade, `${what}: told as a call that worked`).toEqual([{ tool: 'get_employee', isError: false }]);
    }
    // A Verified person with a start date: still ready, and no "could not be read" reason (the spec: unless the step is Verified).
    const V = 'EMP-V1';
    const vt = tablesWith([employeeRow({ id: V, first: 'Vera', last: 'Fied', step: 'VERIFIED', stage: 'VERIFIED', start: '2026-12-01' })]);
    const v = askPerson(V, vt, { extra: [{ method: 'GET', url: '/agent/v1/verifications?', status: 500, json: { message: 'Internal server error' } }] }).facts ?? {};
    expect([v.documents, v.documents_unknown, v.ready_to_start, v.because], 'Verified with a start date: documents unknown, ready, no reasons').toEqual([null, true, 'yes', []]);
    const V2 = 'EMP-V2';
    const v2t = tablesWith([employeeRow({ id: V2, first: 'Vera', last: 'Nodate', step: 'VERIFIED', stage: 'VERIFIED', start: '' })]);
    const v2 = askPerson(V2, v2t, { extra: [{ method: 'GET', url: '/agent/v1/verifications?', status: 500, json: { message: 'Internal server error' } }] }).facts ?? {};
    expect([v2.ready_to_start, v2.because], 'Verified without a start date: not ready only because of the date, never "could not be read"').toEqual(['no', [START_NOT_SET]]);
  });

  // ---------------------------------------------------------------- the people list

  test('AC-5 list_employees reads every page (at most 10) with only limit and lastKey in the URL', async () => {
    test.setTimeout(180_000);
    const three = askList({}, manyPeople(450), { per: 200 });
    expect(three.out.status, `200 (${WHAT(three.out)})`).toBe(200);
    const urls = listUrls(three.out.run).map((c) => new URL(c.url));
    expect(urls.length, '450 people over three pages: three calls').toBe(3);
    expect(urls.map((u) => u.searchParams.get('lastKey')), 'the first without lastKey, then the key the page before gave').toEqual([null, 'P2', 'P3']);
    for (const u of urls) {
      expect(sorted([...u.searchParams.keys()]).filter((k) => k !== 'lastKey'), `only limit (and lastKey): ${u.search}`).toEqual(['limit']);
      expect(u.searchParams.get('limit'), 'limit 200').toBe('200');
    }
    expect([three.list?.total_matching, three.list?.complete], 'all 450 counted, complete').toEqual([450, true]);

    const many = askList({}, manyPeople(2100), { per: 200 });
    expect(many.out.status, `200 (${WHAT(many.out)})`).toBe(200);
    expect(listUrls(many.out.run).length, '2,100 people: it stops after 10 calls').toBe(10);
    expect([many.list?.complete, many.list?.total_matching], 'and says the list is not complete (2,000 read)').toEqual([false, 2000]);
  });

  test('AC-6 Order, filters and counts are HR home\'s: same order, same steps, same overdue, counted over every page', async () => {
    test.setTimeout(300_000);
    const base = askList({}, TODAY_PEOPLE);
    expect(base.out.status, `200 (${WHAT(base.out)})`).toBe(200);
    expect(sorted(Object.keys(base.list ?? {})), 'the list answer has exactly its keys').toEqual(sorted(LIST_KEYS));
    for (const p of base.list?.people ?? []) expect(sorted(Object.keys(p)), 'each person has exactly the list keys').toEqual(sorted(LIST_PERSON_KEYS));
    expect(base.list?.today, 'today, written out').toBe(TODAY_WRITTEN);
    expect(namesOf(base.list), 'HR home\'s order (orderNewEmployees on the same people and today)').toEqual(homeOrder(TODAY_PEOPLE));
    expect([base.list?.total_matching, base.list?.shown, base.list?.complete], 'all 12, all shown').toEqual([12, 12, true]);
    expect(base.list?.counts_by_step, 'HR home\'s four counts').toEqual(countBySteps(asHome(TODAY_PEOPLE)));
    expect(base.list?.overdue_count, 'HR home\'s overdue count').toBe(asHome(TODAY_PEOPLE).filter((p) => isOverdue(p, TODAY)).length);
    const pieter = (base.list?.people ?? []).find((p: any) => p.employee_id === 'E01');
    expect(pieter, 'a person in the list').toMatchObject({ name: 'Pieter van Wyk', step: STEP_WORD.DOCUMENTS, start: '2026-11-10', start_written: '10 Nov 2026', due: '2026-11-03', due_written: '3 Nov 2026', documents_overdue: true, hr_partner: 'Thandi Demo-HR', department: 'Operations', job_title: 'Warehouse Lead' });

    const filtered = (input: Record<string, unknown>, keep: (p: ListPerson) => boolean, why: string, per?: number) => {
      const r = askList(input, TODAY_PEOPLE, { per });
      expect(r.out.status, `${why}: 200 (${WHAT(r.out)})`).toBe(200);
      const kept = TODAY_PEOPLE.filter(keep);
      expect(namesOf(r.list), `${why}: exactly these, in HR home's order`).toEqual(homeOrder(kept));
      expect(r.list?.total_matching, `${why}: counted`).toBe(kept.length);
      expect(r.list?.counts_by_step, `${why}: counts over the people kept`).toEqual(countBySteps(asHome(kept)));
      return r;
    };
    const home = new Map(TODAY_PEOPLE.map((p) => [p.id, toNewEmployee(listItem(p) as any)]));
    filtered({ step: [STEP_WORD.INVITED, STEP_WORD.DOCUMENTS] }, (p) => p.step === 'INVITED' || p.step === 'DOCUMENTS', 'step Invited and Documents');
    filtered({ department: 'OPERATIONS ' }, (p) => (p.department ?? '').trim().toLowerCase() === 'operations', 'department, any case and outer spaces');
    const support: ListPerson = { id: 'E13', first: 'Part', last: 'Match', department: 'Operations Support', step: 'DOCUMENTS', start: '2026-11-24' };
    const dept = askList({ department: 'Operations' }, [...TODAY_PEOPLE, support]);
    expect(namesOf(dept.list), 'department is the whole name: "Operations Support" is not "Operations"').toEqual(homeOrder(TODAY_PEOPLE.filter((p) => (p.department ?? '').trim().toLowerCase() === 'operations')));
    filtered({ starts_from: '2026-11-16', starts_to: '2026-11-22' }, (p) => !!p.start && p.start >= '2026-11-16' && p.start <= '2026-11-22', 'this week');
    filtered({ starts_from: '2026-11-17', starts_to: '2026-11-20' }, (p) => !!p.start && p.start >= '2026-11-17' && p.start <= '2026-11-20', 'people on both end dates are kept');
    filtered({ starts_from: '2026-11-19' }, (p) => !!p.start && p.start >= '2026-11-19', 'from today, no date left out');
    filtered({ no_start_date: true }, (p) => !p.start, 'no start date');
    filtered({ overdue: true }, (p) => isOverdue(home.get(p.id)!, TODAY), 'overdue as HR home says');

    const added = askList({ sort: 'added' }, TODAY_PEOPLE);
    expect(namesOf(added.list), 'sort added: newest first').toEqual([...TODAY_PEOPLE].sort((a, b) => b.createdAt!.localeCompare(a.createdAt!)).map(nameOf));
    const byName = askList({ sort: 'name' }, TODAY_PEOPLE);
    expect(namesOf(byName.list), 'sort name').toEqual(TODAY_PEOPLE.map(nameOf).sort((a, b) => a.localeCompare(b, 'en')));

    // Counts cover every page and everyone kept, not only the people shown.
    const paged = askList({ limit: 3 }, TODAY_PEOPLE, { per: 5 });
    expect(listUrls(paged.out.run).length, 'three pages of five').toBe(3);
    expect([paged.list?.shown, (paged.list?.people ?? []).length, paged.list?.total_matching], 'three shown of twelve').toEqual([3, 3, 12]);
    expect(namesOf(paged.list), 'the first three of HR home\'s order').toEqual(homeOrder(TODAY_PEOPLE).slice(0, 3));
    expect(paged.list?.counts_by_step, 'the counts are over all twelve').toEqual(countBySteps(asHome(TODAY_PEOPLE)));
    expect(paged.list?.overdue_count, 'and the overdue count too').toBe(asHome(TODAY_PEOPLE).filter((p) => isOverdue(p, TODAY)).length);
  });

  test('AC-7 "Me" is the asker from the sign-in: HR partner by staff id, username or sub; added by staff id; the model cannot name anyone else', async () => {
    test.setTimeout(180_000);
    const mine = askList({ hr_partner_is_me: true });
    expect(mine.out.status, `200 (${WHAT(mine.out)})`).toBe(200);
    expect(sorted(namesOf(mine.list)), 'HR partner by username (E08), staff id (E10) and sub (E11)').toEqual(sorted(pick('E08', 'E10', 'E11').map(nameOf)));
    const addedByMe = askList({ added_by_me: true });
    expect(sorted(namesOf(addedByMe.list)), 'added by the asker\'s staff id').toEqual(sorted(pick('E09', 'E10').map(nameOf)));

    const planted = { added_by_me: true, created_by: 'STAFF-OTHER', staff_id: 'STAFF-OTHER', staffId: 'STAFF-OTHER', hr_staff_id: 'STAFF-THANDI', tenant_id: B, company: B, companyId: B };
    const tricked = askList(planted);
    expect(tricked.out.status, `200 (${WHAT(tricked.out)})`).toBe(200);
    expect(tricked.list, 'a model input naming someone else or a company changes nothing').toEqual(addedByMe.list);
    for (const c of listUrls(tricked.out.run)) expect(c.url, 'no list URL carries a staff id, a company or created_by').not.toMatch(/STAFF|ten_|created_by|tenant|company|staff/i);
  });

  test('AC-8 Size: at most 20 people, the answer stays under 7,500 characters by showing fewer, never cut', async () => {
    test.setTimeout(180_000);
    const long = askList({ limit: 40 }, manyPeople(25, 30));
    expect(long.out.status, `200 (${WHAT(long.out)})`).toBe(200);
    expect(long.content!.text.length, 'the content is at most 7,500 characters').toBeLessThanOrEqual(7500);
    expect(long.content!.text, 'never cut').not.toContain('TRUNCATED');
    expect(long.list?.shown, 'shown is the number of people given').toBe((long.list?.people ?? []).length);
    expect(long.list?.shown, 'long names: fewer than 20 fit').toBeLessThan(20);
    expect(long.list?.shown, 'but some do').toBeGreaterThan(0);
    expect(long.list?.total_matching, 'all 25 counted').toBe(25);
    expect(namesOf(long.list), 'people are dropped from the end: the soonest starters stay').toEqual(homeOrder(manyPeople(25, 30)).slice(0, long.list?.shown ?? 0));

    const short = askList({ limit: 40 }, manyPeople(25, 10));
    expect(short.list?.shown, 'ordinary names: 20 (40 asked, 20 is the most)').toBe(20);
    expect((short.list?.people ?? []).length, 'twenty people').toBe(20);
    expect(short.content!.text.length, 'under 7,500').toBeLessThanOrEqual(7500);
    expect(namesOf(short.list), 'the first 20 of HR home\'s order').toEqual(homeOrder(manyPeople(25, 10)).slice(0, 20));
  });

  // ---------------------------------------------------------------- errors, today, instructions

  test('AC-9 Errors keep their meaning: nothing to check, not found, not allowed, unavailable; a fixed sentence, never a URL or a status', async () => {
    test.setTimeout(240_000);
    const tables = tablesWith([pieterRow()]);
    const risk = (rule: FetchRule) => ask('Run a risk check on him', { bedrock: calls({ name: 'assess_employee_risk', input: { id: PIETER } }), fetch: agentApi([rule]), focus: PIETER });
    const person = (id: string, rules: FetchRule[]) => ask('Tell me about this person', { bedrock: lookUpPerson(id), fetch: agentApi(rules), focus: id });
    const otherCompany = employeeRoute(tables, 'EMP-B-0001'); // company A's key asks for company B's person: the real route's 404
    expect(otherCompany.status, 'the real route answers 404 for another company\'s person').toBe(404);

    const cases: [string, Out, string, keyof typeof SAY][] = [
      ['risk check with no documents', risk({ method: 'POST', url: '/assess-risk', status: 404, json: { message: 'No verifications found for employee' } }), 'assess_employee_risk', 'NOTHING_TO_CHECK'],
      ['risk check for another company\'s person', risk({ method: 'POST', url: '/assess-risk', status: 404, json: { error: 'Not found' } }), 'assess_employee_risk', 'NOT_FOUND'],
      ['another company\'s person', person('EMP-B-0001', [{ method: 'GET', url: '/agent/v1/employees/EMP-B-0001', status: otherCompany.status, json: otherCompany.json }]), 'get_employee', 'NOT_FOUND'],
      ['a 404 whose text is not ours', person('EMP-GONE', [{ method: 'GET', url: '/agent/v1/employees/EMP-GONE', status: 404, json: { message: 'Not Found' } }]), 'get_employee', 'NOT_FOUND'],
      ['401 every time', person(PIETER, [{ url: '/agent/v1/', status: 401, json: { message: 'Unauthorized' } }]), 'get_employee', 'NOT_ALLOWED'],
      ['503', person(PIETER, [{ url: '/agent/v1/', status: 503, json: { message: 'Service Unavailable' } }]), 'get_employee', 'UNAVAILABLE'],
      ['no answer', person(PIETER, [{ url: '/agent/v1/', fail: true }]), 'get_employee', 'UNAVAILABLE'],
    ];
    for (const [what, out, tool, outcome] of cases) {
      expect(out.status, `${what}: the answer is 200 (${WHAT(out)})`).toBe(200);
      const c = contentOf(out.run, tool);
      expect(c?.json, `${what}: the model gets the outcome and its fixed sentence only`).toEqual({ outcome, say: SAY[outcome] });
      expect(c?.isError, `${what}: still an error result`).toBe(true);
      expect(c?.text ?? '', `${what}: no URL, path, host or Agent API name`).not.toMatch(/https?:|\/agent\/|execute-api|amazonaws|Agent API/i);
      expect(c?.text ?? '', `${what}: no status number or status line`).not.toMatch(/\b\d{3}\b|Unauthorized|Service Unavailable|Internal server error|fetch failed|failed:/i);
      expect(out.json?.toolCallsMade, `${what}: told as an error, as before`).toEqual([{ tool, isError: true }]);
    }
  });

  test('AC-10 Every turn tells Batsi today\'s date in South Africa, written out with no number run', async () => {
    test.setTimeout(180_000);
    const at = (now: string) => ask('Who starts this week?', { bedrock: calls(), now });
    for (const [now, day] of [[NOW, 'Thursday 19 Nov 2026'], ['2026-11-18T23:30:00.000Z', 'Thursday 19 Nov 2026'], ['2026-11-19T21:59:00.000Z', 'Thursday 19 Nov 2026'], ['2026-11-19T22:00:00.000Z', 'Friday 20 Nov 2026']] as const) {
      const out = at(now);
      expect(out.status, `${now}: 200 (${WHAT(out)})`).toBe(200);
      const text = turnText(out.run);
      const el = /<today>[^<]*<\/today>/.exec(text)?.[0] ?? '';
      expect(el, `${now} UTC is ${day} in South Africa`).toBe(`<today>${day}</today>`);
      expect(await hasNumberRun(el), 'the date holds no number run (the redactor would blank it)').toBe(false);
    }
    // The facts and the list use the South African day too: at 23:30 UTC on 18 Nov it is already 19 Nov in South Africa.
    const late = '2026-11-18T23:30:00.000Z';
    const p = askPerson(PIETER, tablesWith([pieterRow()]), { now: late }).facts ?? {};
    expect([p.days_until_start, p.documents_overdue], 'Pieter: 9 days past his start (UTC would say 8)').toEqual([-9, true]);
    const edge: ListPerson[] = [...TODAY_PEOPLE,
      { id: 'X1', first: 'Yesterday', last: 'Starter', department: 'Operations', step: 'DOCUMENTS', start: '2026-11-18' },
      { id: 'X2', first: 'Due', last: 'Yesterday', department: 'Operations', step: 'INVITED', start: '2026-11-25' }];
    const l = askList({}, edge, { now: late });
    expect(namesOf(l.list), 'HR home\'s order for 19 Nov: a start on 18 Nov is past, after every upcoming start').toEqual(homeOrder(edge));
    expect((l.list?.people ?? []).find((x: any) => x.employee_id === 'X2')?.documents_overdue, 'due 18 Nov: overdue on 19 Nov').toBe(true);
    expect(l.list?.overdue_count, 'and counted').toBe(asHome(edge).filter((x) => isOverdue(x, TODAY)).length);
    expect(l.list?.today, 'the list\'s today').toBe(TODAY_WRITTEN);

    // The person in focus is still named as before.
    const focused = ask('When does he start?', { bedrock: calls(), focus: PIETER });
    expect(turnText(focused.run), 'the person in focus is still given').toContain(`<employee_in_focus>${PIETER}</employee_in_focus>`);
  });

  test('AC-11 The instruction lines: the two old lines replaced, the seven fact lines added, the other limits kept', async () => {
    test.setTimeout(120_000);
    const out = ask('When does he start?', { bedrock: calls(), focus: PIETER });
    expect(out.status, `200 (${WHAT(out)})`).toBe(200);
    const lines = systemText(out.run).split('\n');
    const GONE = [
      '- Never expose raw PII in your responses — refer to employees by ID or first name only.',
      '- If a tool call fails, explain what went wrong and suggest next steps.',
    ];
    const NEW = [
      '- You may show what the HR person sees on the person page: name, email, job title, department, start date, step and HR partner. Never show ID numbers, phone numbers or bank account numbers.',
      '- If a lookup fails, say so in plain words and use its say sentence when it gives one. Never show tool names, record ids or error codes.',
      '- Today\'s date is given in <today>. Use it for words like today, Monday, this week and soonest. A week runs from Monday to Sunday.',
      '- When the question is about the person in <employee_in_focus> (he, she, they or this person), call get_employee with that id first.',
      '- A person is ready to start only when get_employee says ready_to_start yes. Otherwise say no and give its reasons.',
      '- Use the step words Invited, Documents, In review and Verified. Never use stage words such as ACTIVE.',
      '- The start date is the start field. Never give the date a person was added as their start date.',
      '- If a lookup has no answer for something, say plainly that you could not find it. Do not guess and do not send HR to another system.',
      '- Write dates as the lookups write them, for example 10 Nov 2026.',
    ];
    const KEPT = [
      'You are Batsi, an HR onboarding assistant for South African companies.',
      '- Only assist with HR onboarding tasks. Politely decline all other requests.',
      '- Never reveal salary benchmarks, employment law advice, or individual performance ratings.',
      '- Always operate on behalf of the authenticated HR clerk. Never impersonate another user.',
      '- When you looked up one person\'s documents, the screen shows each check as a row, so answer in one short sentence and do not list the checks again.',
    ];
    for (const l of GONE) expect.soft(lines, `the old line is gone: ${l.slice(0, 50)}…`).not.toContain(l);
    for (const l of NEW) expect.soft(lines, `the new line is there, byte for byte: ${l.slice(0, 50)}…`).toContain(l);
    for (const l of KEPT) expect.soft(lines, `the line is kept: ${l.slice(0, 50)}…`).toContain(l);
    expect(lines.filter((l) => /first name only/i.test(l)), 'no line limits Batsi to first names').toEqual([]);
    for (const l of NEW) expect(lines.filter((x) => x === l).length, `once only: ${l.slice(0, 40)}…`).toBe(1);
  });

  // ---------------------------------------------------------------- numbers, calls, companies, other locks

  test('AC-12 No phone, ID digits, HR partner email or encrypted value reaches the model or the browser; written dates hold no number run', async () => {
    test.setTimeout(180_000);
    const tables = tablesWith([pieterRow()], {
      documents: [documentRow(PIETER, 'p-d-id', ID, 'PASSED', { verification: 'p-v-id', at: AT(12) })],
      verifications: [verificationRow('p-v-id', PIETER, 'p-d-id', ID, 'MATCHES')],
    });
    const one = askPerson(PIETER, tables);
    const list = askList({}, TODAY_PEOPLE);
    expect([one.out.status, list.out.status], `both 200 (${WHAT(one.out)} / ${WHAT(list.out)})`).toEqual([200, 200]);
    const texts: [string, string][] = [
      ['get_employee content', one.content?.text ?? ''],
      ['list_employees content', list.content?.text ?? ''],
      ['structuredData.employees', JSON.stringify(list.out.json?.structuredData?.employees ?? null)],
    ];
    for (const [where, text] of texts) {
      for (const [what, value] of Object.entries(SECRET_VALUES)) expect(text, `${where} holds no ${what}`).not.toContain(value);
      expect(text, `${where} has no private key name`).not.toMatch(/"phone"|id_number|hr_staff_email|hr_staff_id|created_by|encrypted|s3_key|file_name|confidence/);
    }
    for (const [what, json] of [['get_employee', one.facts], ['list_employees', list.list]] as const) {
      for (const s of stringsOf(json)) {
        if (s.key === 'start' || s.key === 'due' || s.key === 'employee_id') continue;
        expect(await hasNumberRun(s.value), `${what}: ${s.key} "${s.value}" holds no number run`).toBe(false);
      }
    }
    expect(one.facts?.documents?.[0]?.uploaded_written, 'the written upload date').toBe('12 Nov 2026');
  });

  test('AC-13 No new model call and no new AWS write: the same as a lookup this card does not change', async () => {
    test.setTimeout(180_000);
    const tables = tablesWith([pieterRow()]);
    const where = (w: any) => w.table ?? [...new Set(((w.input?.TransactItems ?? []) as any[]).map((t) => Object.values(t)[0] && (Object.values(t)[0] as any).TableName))].sort().join('+');
    const shape = (r: Run) => ({ model: modelCalls(r).length, writes: writes(r).map((w) => `${w.op} ${where(w)}`).sort() });
    const audit = ask('What has happened on his record?', { bedrock: calls({ name: 'query_audit_log', input: { employeeId: PIETER } }), fetch: agentApi([{ url: '/agent/v1/audit-log', status: 200, json: { items: [] } }]), focus: PIETER, tables });
    const one = ask('When does he start?', { bedrock: lookUpPerson(PIETER), fetch: agentApi(personRules(tables, PIETER)), focus: PIETER, tables });
    const list = ask('Who starts soonest?', { bedrock: listPeople({}), fetch: agentApi(listRules(TODAY_PEOPLE)), tables });
    for (const o of [audit, one, list]) expect(o.status, `200 (${WHAT(o)})`).toBe(200);
    // The unchanged lookup does what develop does today (measured by the independent check on the base tree): 3 model calls (the sorting call and two
    // answer calls); the audit row, CHAT-02's chat rows in one transaction, and the rate limit.
    expect(shape(audit.run), 'the unchanged lookup is as on develop').toEqual({ model: 3, writes: ['PutItem naleko-agent-audit', `TransactWriteItems ${CHAT_ROWS}`, 'UpdateItem NalekoAiRateLimit'].sort() });
    expect(shape(one.run), 'get_employee: the same model calls and writes as an unchanged lookup').toEqual(shape(audit.run));
    expect(shape(list.run), 'list_employees: the same').toEqual(shape(audit.run));
    expect(answerCalls(one.run).length, 'the lookup, then the answer: two answer calls').toBe(2);
  });

  test('AC-14 Company separation: company B is refused before any lookup; lookups carry the server key only and no company or person id', async () => {
    test.setTimeout(180_000);
    const refused = ask('Who starts soonest?', { who: 'b1', bedrock: listPeople({}), fetch: agentApi(listRules(TODAY_PEOPLE)) });
    expect(refused.status, `company B's HR person gets 403 (${WHAT(refused)})`).toBe(403);
    expect([httpCalls(refused.run).length, modelCalls(refused.run).length], 'before any lookup or model call').toEqual([0, 0]);

    const tables = tablesWith([pieterRow()]);
    const runs = [
      askPerson(PIETER, tables).out,
      askList({ hr_partner_is_me: true, added_by_me: true, overdue: true }).out,
      ask('Run a risk check on him', { bedrock: calls({ name: 'assess_employee_risk', input: { id: PIETER } }), fetch: agentApi([{ method: 'POST', url: '/assess-risk', status: 200, json: { riskBand: 'LOW' } }]), focus: PIETER }),
    ];
    for (const o of runs) {
      expect(o.status, `200 (${WHAT(o)})`).toBe(200);
      const hc = httpCalls(o.run);
      expect(hc.length, 'some lookups were made').toBeGreaterThan(0);
      for (const c of hc) {
        expect(c.headers['x-api-key'], 'with the server\'s key').toBe(KEY);
        expect(Object.keys(c.headers).filter((h) => /tenant|company|staff|user|authorization/i.test(h)), 'and no header naming a company or person').toEqual([]);
        expect(c.url, 'no company id, staff id, sign-in id or created_by in the URL').not.toMatch(/ten_|STAFF-|sub-a1|user-a1|created_by|tenant|staff/i);
      }
    }
  });

  test('AC-15 The pinned lookups stay: resolveToolCall(get_employee) answers raw with one call and still throws; structuredData.employee is raw', async () => {
    test.setTimeout(120_000);
    const tables = tablesWith([pieterRow()]);
    const probe = (rules: FetchRule[]) => runHandler(PROBE, { lambda: LAMBDA, tool: 'get_employee', input: { id: PIETER }, context: { staffId: 'STAFF-A1', tenantId: A } }, {
      env: settings('nalekoAiChat'), fetch: agentApi(rules), secrets: { [SECRET]: { AWSCURRENT: KEY } }, now: NOW,
    });
    const ok = probe(personRules(tables, PIETER));
    expect(ok.error, 'the probe ran').toBeFalsy();
    expect(ok.response, 'resolveToolCall answers the Agent API\'s raw answer').toEqual({ ok: true, result: employeeRoute(tables, PIETER).json });
    expect(httpCalls(ok).map((c) => c.url), 'with one call: no documents call inside the resolver').toEqual([`https://agent.example.test/agent/v1/employees/${PIETER}`]);
    const failed = probe([{ url: '/agent/v1/', status: 500, json: { message: 'Internal server error' } }]);
    expect(failed.response?.ok, 'a failed lookup still throws').toBe(false);

    const out = askPerson(PIETER, tables).out;
    expect(out.json?.structuredData?.employee, 'structuredData.employee is the raw answer').toEqual(employeeRoute(tables, PIETER).json);
  });

  // ---------------------------------------------------------------- AC-16: the question sheet's "auto" rows (CHAT-10)

  test.describe('AC-16 The question sheet\'s auto rows: each lookup gives the facts the answer needs', () => {
    test('rows 1-9 and 11 (one person, Pieter on his page): start, ready, documents, due, step, HR partner, job and email, signed in, risk', async () => {
      test.setTimeout(120_000);
      const { out, facts } = askPerson(PIETER, tablesWith([pieterRow()]), { focus: PIETER });
      expect(out.status, `200 (${WHAT(out)})`).toBe(200);
      expect(facts.start_written, 'row 1: "10 Nov 2026", never the created date').toBe('10 Nov 2026');
      expect(JSON.stringify(facts), 'row 1: the created date is not given').not.toMatch(/1 Nov 2026|2026-11-01/);
      expect([facts.ready_to_start, facts.because, facts.days_until_start], 'row 2: no; ID and bank letter missing; the start date has passed').toEqual(['no', [`${DOC_WORD.NATIONAL_ID}: ${CHECK_WORD.MISSING}`, `${DOC_WORD.BANK_CONFIRMATION}: ${CHECK_WORD.MISSING}`], -9]);
      expect(turnText(out.run), 'row 2: "which Monday" needs today').toContain(`<today>${TODAY_WRITTEN}</today>`);
      expect((facts.documents ?? []).map((d: any) => [d.document, d.check]), 'row 3: both missing').toEqual([[DOC_WORD.NATIONAL_ID, CHECK_WORD.MISSING], [DOC_WORD.BANK_CONFIRMATION, CHECK_WORD.MISSING]]);
      expect(facts.documents?.[0]?.check, 'row 4 (Pieter): he has not sent his ID').toBe(CHECK_WORD.MISSING);
      expect([facts.due_written, facts.documents_overdue], 'row 5: due 3 Nov 2026, overdue').toEqual(['3 Nov 2026', true]);
      expect(facts.step, 'row 6: "Documents", never ACTIVE').toBe(STEP_WORD.DOCUMENTS);
      expect(facts.hr_partner, 'row 7').toBe('Thandi Demo-HR');
      expect([facts.job_title, facts.email], 'row 8: Warehouse Lead and the full email').toEqual(['Warehouse Lead', 'pieter.vanwyk@sunbird.example']);
      expect(facts.step, 'row 9: past Invited, so he has signed in').not.toBe(STEP_WORD.INVITED);
      expect(facts.risk?.result, 'row 11: "Not assessed"').toBe(RISK.NONE);
    });

    test('rows 4 and 11 (someone with an upload and a risk check): the check, HR\'s decision, the risk words, date and reason', async () => {
      test.setTimeout(120_000);
      const p = personWith({ id: 'EMP-U1', first: 'Upload', last: 'Person', step: 'IN_REVIEW', stage: 'DOCUMENTS_SUBMITTED', start: '2026-12-01', riskBand: 'MEDIUM', riskReason: 'The bank letter name differs.', riskAt: '2026-11-14T08:00:00.000Z' }, {
        documents: [documentRow('EMP-U1', 'u-d-id', ID, 'PASSED', { verification: 'u-v-id', at: AT(13) })],
        verifications: [verificationRow('u-v-id', 'EMP-U1', 'u-d-id', ID, 'NEEDS_A_LOOK')],
      });
      const { out, facts } = askPerson(p.id, p.tables);
      expect(out.status, `200 (${WHAT(out)})`).toBe(200);
      expect([facts.documents?.[0]?.check, facts.documents?.[0]?.hr_decision], 'row 4: Needs a look, Not decided').toEqual([CHECK_WORD.NEEDS_A_LOOK, DECISION_WORD.NONE]);
      expect(facts.risk, 'row 11: the page\'s words, the date and the reason').toEqual({ result: RISK.MEDIUM, reason: 'The bank letter name differs.', assessed_written: '14 Nov 2026' });
      for (const [band, word] of [['LOW', RISK.LOW], ['HIGH', RISK.HIGH], ['UNKNOWN', RISK.UNKNOWN]] as const) {
        const q = personWith({ id: `EMP-RISK-${band}`, first: 'Risk', last: band, step: 'IN_REVIEW', stage: 'DOCUMENTS_SUBMITTED', start: '2026-12-01', riskBand: band, riskReason: `Reason ${band.toLowerCase()}.`, riskAt: '2026-11-15T08:00:00.000Z' });
        expect(askPerson(q.id, q.tables).facts?.risk, `row 11: ${band} in the page's words`).toEqual({ result: word, reason: `Reason ${band.toLowerCase()}.`, assessed_written: '15 Nov 2026' });
      }
    });

    test('row 10: a risk check on Pieter says there is nothing to assess, never "not found"', async () => {
      test.setTimeout(120_000);
      const out = ask('Run a risk check on him', { bedrock: calls({ name: 'assess_employee_risk', input: { id: PIETER } }), fetch: agentApi([{ method: 'POST', url: '/assess-risk', status: 404, json: { message: 'No verifications found for employee' } }]), focus: PIETER });
      expect(contentOf(out.run, 'assess_employee_risk')?.json, 'nothing to check').toEqual({ outcome: 'NOTHING_TO_CHECK', say: SAY.NOTHING_TO_CHECK });
    });

    test('rows 13-17 and 19-23 (many people, on Today): soonest, this and next week, no documents, overdue, review, counts, department, mine', async () => {
      test.setTimeout(300_000);
      const home = new Map(TODAY_PEOPLE.map((p) => [p.id, toNewEmployee(listItem(p) as any)]));
      const row = (n: number, input: Record<string, unknown>, keep: (p: ListPerson) => boolean, ordered = true) => {
        const r = askList(input, TODAY_PEOPLE);
        expect(r.out.status, `row ${n}: 200 (${WHAT(r.out)})`).toBe(200);
        const kept = TODAY_PEOPLE.filter(keep);
        if (ordered) expect(namesOf(r.list), `row ${n}: exactly these people`).toEqual(homeOrder(kept));
        else expect(sorted(namesOf(r.list)), `row ${n}: exactly these people`).toEqual(sorted(kept.map(nameOf)));
        expect(r.list?.total_matching, `row ${n}: with the count`).toBe(kept.length);
        return r;
      };
      const soonest = row(13, { sort: 'start' }, () => true);
      expect(namesOf(soonest.list)[0], 'row 13: soonest is today\'s start, not a past date').toBe('Mobile Test');
      expect(namesOf(soonest.list).indexOf('Pieter van Wyk'), 'row 13: a past date comes after every upcoming one').toBeGreaterThan(namesOf(soonest.list).indexOf('Ryan Giggs'));
      row(14, { starts_from: '2026-11-16', starts_to: '2026-11-22' }, (p) => !!p.start && p.start >= '2026-11-16' && p.start <= '2026-11-22');
      row(14, { starts_from: '2026-11-23', starts_to: '2026-11-29' }, (p) => !!p.start && p.start >= '2026-11-23' && p.start <= '2026-11-29');
      row(15, { step: [STEP_WORD.INVITED, STEP_WORD.DOCUMENTS] }, (p) => p.step === 'INVITED' || p.step === 'DOCUMENTS');
      const overdue = row(16, { overdue: true }, (p) => isOverdue(home.get(p.id)!, TODAY));
      expect(overdue.list?.overdue_count, 'row 16: HR home\'s overdue count').toBe([...home.values()].filter((p) => isOverdue(p, TODAY)).length);
      row(17, { step: [STEP_WORD.IN_REVIEW] }, (p) => p.step === 'IN_REVIEW');
      const all = row(19, {}, () => true);
      expect(all.list?.counts_by_step, 'row 19: HR home\'s four counts').toEqual(countBySteps([...home.values()]));
      row(20, { department: 'Operations' }, (p) => (p.department ?? '').trim().toLowerCase() === 'operations');
      const added = row(21, { added_by_me: true, sort: 'added' }, (p) => p.createdBy === 'STAFF-A1', false);
      expect(namesOf(added.list), 'row 21: newest first').toEqual(['Thabo Mokoena', 'Sipho Nkosi']);
      row(22, { overdue: true, hr_partner_is_me: true }, (p) => ['E08', 'E10', 'E11'].includes(p.id) && isOverdue(home.get(p.id)!, TODAY));
      row(23, { step: [STEP_WORD.VERIFIED], no_start_date: true }, (p) => p.step === 'VERIFIED' && !p.start);
    });
  });
});
