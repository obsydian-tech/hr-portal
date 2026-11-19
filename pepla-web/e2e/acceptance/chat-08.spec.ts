import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Locator, Page } from '@playwright/test';
import { ON_DEV, expect, test as base, type Login, type SignInPage } from './support/fixtures';
import { STEPS } from '../../src/app/core/employees/employee';
import { RISK_HEADING, RISK_NONE, RISK_WORD } from '../../src/app/core/employees/risk-words';
import { baseTables } from './support/chat-02/world';
import { PIETER, SECRET_VALUES, TODAY_PEOPLE, employeeRow, pieterRow, type ListPerson } from './support/chat-09/world';
import { LAMBDA, REPO } from './support/chat-08/harness';
import {
  W, UUID, agentApi, answerCalls, ask, blocksOf, chartsOf, checksBlocksOf, factsOf, headersOf, httpCalls, kindsOf, listApi, listRules, look, openChat,
  personRules, recordsOf, rowsOf, say, show, stringsOf, tablesOf, tablesWith, toolResults, toolsOffered, turns, uuidOf, wordsOf, WHAT,
  type Block, type Out,
} from './support/chat-08/world';
import { Chat08Fake, type Reply } from './support/chat-08/chat-fake';

/**
 * CHAT-08 · Batsi's answers read as text, lists, tables and charts (red).
 * One test per acceptance criterion, written from the card before any code.
 * Spec: /mnt/project-files/ask-batsi-chat/CHAT-08-answer-formats.md (19 Nov 2026, after the independent check of the same day).
 * Card notes, what is pinned beyond the text, and where these tests differ from the spec's wording: cards/chat-08.md.
 *
 * The Lambda tests run the real chat Lambda (and askBatsiChats) in a fresh Node process each, against CHAT-05's fake AWS with CHAT-09's
 * fixed clock and fake Agent API (support/chat-08). The lookups are CHAT-09's, so the tables and charts are built from what CHAT-09 gives
 * the model. The model answers from a script; a scripted message may hold a sentence and lookups at once (support/chat-08/fake-aws).
 * Nothing here reaches Bedrock, AWS or any outside host. The Lambda tests run once (desktop-1280).
 *
 * The screen tests run the app at 1280 and 390 against a fake chat API (support/chat-08/chat-fake.ts) that answers `blocks`.
 *
 * Today in every Lambda test is Thursday 19 Nov 2026, 10:00 in South Africa.
 */

// The screen tests' fake chat API (set up before any describe uses `test`).
type Fixtures = { chat: Chat08Fake | null };
const test = base.extend<Fixtures>({
  chat: [
    async ({ context, baseURL }, use) => {
      if (ON_DEV) return use(null);
      const fake = new Chat08Fake(new URL(baseURL!).origin);
      await fake.install(context);
      await use(fake);
    },
    { auto: true },
  ],
});

let numberRule: ((text: string) => boolean) | undefined;
async function hasNumberRun(text: string): Promise<boolean> {
  numberRule ??= (await import(pathToFileURL(join(LAMBDA, 'shared', 'pii-redact.mjs')).href)).hasNumberRun;
  return numberRule!(text);
}

const SENTENCE = 'Here they are, soonest first.';
const STEP_OF: Record<string, string> = { INVITED: STEPS[0], DOCUMENTS: STEPS[1], IN_REVIEW: STEPS[2], VERIFIED: STEPS[3] };
const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};

/** Five people with UUID ids around today: one with no start date and no HR partner, one with a step that is none of the four. */
const FIVE: ListPerson[] = [
  { id: uuidOf(1), first: 'Pieter', last: 'van Wyk', department: 'Operations', job_title: 'Warehouse Lead', step: 'DOCUMENTS', start: '2026-11-10', partnerName: 'Thandi Demo-HR' },
  { id: uuidOf(2), first: 'Mobile', last: 'Test', department: 'Engineering', job_title: 'Developer', step: 'INVITED', start: '2026-11-19', partnerName: 'Thandi Demo-HR' },
  { id: uuidOf(3), first: 'Test', last: 'EmailDev', department: 'Operations', job_title: 'Manager', step: 'IN_REVIEW', start: '2026-11-23', partnerName: 'Iggie Asker' },
  { id: uuidOf(4), first: 'Ayesha', last: 'Patel', department: 'Marketing', step: 'VERIFIED', start: '2026-09-07', partnerName: 'Thandi Demo-HR' },
  { id: uuidOf(5), first: 'Lindiwe', last: 'Khumalo', department: 'Finance', step: 'DOCUMENTS', start: '' },
];

/** The list CHAT-09 gave the model in this turn (the people the table must show, in that order). */
function listGiven(o: Out): any {
  const r = toolResults(o.run).filter((t) => t.tool === 'list_employees').pop();
  try { return r ? JSON.parse(r.text) : undefined; } catch { return undefined; }
}
/** The table rows the people view must show for the list CHAT-09 gave. */
const expectedRows = (list: any): string[][] => (list?.people ?? []).map((p: any) => [p.name, p.step ?? W.notSet, p.start_written || W.notSet, p.hr_partner || W.notAssigned]);
const peopleTable = (o: Out): Block | undefined => tablesOf(o).find((t) => JSON.stringify(headersOf(t)) === JSON.stringify(W.people));
const showResult = (o: Out) => toolResults(o.run).filter((t) => t.tool === 'show_records');

test.describe('CHAT-08 · Batsi\'s answers as text, lists, tables and charts (Lambda)', () => {
  test.beforeEach(({}, testInfo) => once(testInfo.project.name));

  // ---------------------------------------------------------------- the people table

  test('AC-1 list_employees then show_records people: a table of Employee, Step, Start date, HR partner, in the lookup\'s order, in the page\'s words, each row linked by its id', async () => {
    test.setTimeout(120_000);
    const out = ask('Who starts soonest?', { bedrock: turns(look('list_employees'), { tools: [show({ view: 'people' })] }, say(SENTENCE)), fetch: listApi(FIVE) });
    expect(out.status, `200 (${WHAT(out)})`).toBe(200);
    expect(out.json?.message, 'the message is still the model\'s sentence').toBe(SENTENCE);
    const list = listGiven(out);
    expect(list?.people?.length, 'CHAT-09 gave the model the five people').toBe(5);
    const t = peopleTable(out);
    expect(t, `a people table is in blocks (${JSON.stringify(kindsOf(out))})`).toBeTruthy();
    expect(headersOf(t!), 'the Today table\'s column words, in its order').toEqual(W.people);
    expect(rowsOf(t!), 'one row per person, in the lookup\'s order, the page\'s words').toEqual(expectedRows(list));
    const byName = Object.fromEntries(rowsOf(t!).map((r) => [r[0], r]));
    expect(byName['Pieter van Wyk'], 'Pieter: Documents, 10 Nov 2026, Thandi Demo-HR').toEqual(['Pieter van Wyk', 'Documents', '10 Nov 2026', 'Thandi Demo-HR']);
    expect(byName['Lindiwe Khumalo'], 'no start date: "Not set"; no HR partner: "Not assigned"').toEqual(['Lindiwe Khumalo', 'Documents', W.notSet, W.notAssigned]);
    expect(byName['Ayesha Patel']?.[2], 'a September date is written with the house month').toBe('7 Sep 2026');
    const ids = (t!.rows ?? []).map((r: any) => r.personId);
    // From the record, not from what the model was given (today's sanitisePii masks long digit runs in what the model reads, ids included).
    const idOf: Record<string, string> = Object.fromEntries(FIVE.map((p) => [`${p.first} ${p.last}`, p.id]));
    expect(ids, 'each row carries its person\'s id, from the record').toEqual((list.people ?? []).map((p: any) => idOf[p.name]));
    for (const id of ids) expect(id, 'a UUID').toMatch(UUID);
    for (const s of stringsOf(t)) expect(s.value, `no ISO date in the table (${s.key})`).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(JSON.stringify(t), 'no URL in the table: the screen builds the link').not.toMatch(/https?:|\/hr\/employees/);
  });

  test('AC-2 Cell values come from the records: the model\'s own table with a wrong date is not shown, the record\'s date is', async () => {
    test.setTimeout(120_000);
    const wrong = 'Here they are.\n\n| Employee | Start date |\n|---|---|\n| Pieter van Wyk | 25 December 2026 |\n| Mobile Test | 1 January 2027 |';
    const out = ask('Who starts soonest?', { bedrock: turns(look('list_employees'), { tools: [show({ view: 'people' })] }, say(wrong)), fetch: listApi(FIVE) });
    expect(out.status, `200 (${WHAT(out)})`).toBe(200);
    const t = peopleTable(out);
    expect(t, 'the people table is there').toBeTruthy();
    expect(rowsOf(t!).find((r) => r[0] === 'Pieter van Wyk')?.[2], 'Pieter\'s start is the record\'s').toBe('10 Nov 2026');
    expect(tablesOf(out).length, 'only one table: the model\'s own is dropped when a records view was built').toBe(1);
    expect(JSON.stringify(blocksOf(out)), 'the model\'s wrong dates appear nowhere in blocks').not.toMatch(/25 December|1 January 2027/);
    expect(wordsOf(out), 'no pipe-table line is left in the words').not.toMatch(/\|/);
    expect(wordsOf(out), 'the sentence is kept').toContain('Here they are.');
  });

  test('AC-3 show_records takes view and limit only: anything else is refused to the model and draws nothing; private fields never reach a block', async () => {
    test.setTimeout(400_000);
    const offered = (o: Out) => toolsOffered(o.run).find((t: any) => t.name === 'show_records');
    const bad: Record<string, unknown>[] = [
      { view: 'everyone' }, { view: 'people', limit: 0 }, { view: 'people', limit: 26 }, { view: 'people', limit: 2.5 }, { view: 'people', limit: '5' },
      { view: 'people', sort: 'name' }, { view: 'people', filter: { step: 'Invited' } }, { view: 'people', columns: ['email'] }, {},
    ];
    // The same turn with no show_records call at all: what the answer is when nothing valid was asked.
    const plain = ask('Who starts soonest?', { bedrock: turns(look('list_employees'), say(SENTENCE)), fetch: listApi(FIVE) });
    expect(plain.status, `200 (${WHAT(plain)})`).toBe(200);
    for (const input of bad) {
      const out = ask('Who starts soonest?', { bedrock: turns(look('list_employees'), { tools: [show(input)] }, say(SENTENCE)), fetch: listApi(FIVE) });
      expect(out.status, `${JSON.stringify(input)}: 200 (${WHAT(out)})`).toBe(200);
      const r = showResult(out).pop();
      expect(r, `${JSON.stringify(input)}: the model got an answer to show_records`).toBeTruthy();
      expect(r!.isError, `${JSON.stringify(input)}: it is a tool error`).toBe(true);
      expect(r!.text, `${JSON.stringify(input)}: a short fixed reason, no stack`).not.toMatch(/Error:|at \w+ \(|node_modules|\.mjs/);
      expect.soft(recordsOf(out), `${JSON.stringify(input)}: draws nothing of its own (as if not called)`).toEqual(recordsOf(plain));
      expect.soft(chartsOf(out), `${JSON.stringify(input)}: no chart`).toEqual([]);
    }
    // What the model is offered: view (required, the six views) and limit (1 to 25), nothing else.
    const tool = offered(plain);
    expect(tool, 'show_records is offered to the model').toBeTruthy();
    expect(Object.keys(tool.input_schema?.properties ?? {}).sort(), 'its arguments are view and limit').toEqual(['limit', 'view']);
    expect([...(tool.input_schema?.properties?.view?.enum ?? [])].sort(), 'the six views').toEqual(['documents', 'people', 'people_by_department', 'people_by_step', 'person', 'risk']);
    expect(tool.input_schema?.required ?? [], 'view is required').toEqual(['view']);
    // Planted private fields: the list route's items carry phone, ID last four, HR partner email and email (CHAT-09's listItem).
    const shown = ask('Who starts soonest?', { bedrock: turns(look('list_employees'), { tools: [show({ view: 'people' })] }, say(SENTENCE)), fetch: listApi(FIVE) });
    const tables = tablesWith([pieterRow()]);
    const person = ask('Tell me about Pieter', { focus: PIETER, tables, bedrock: turns(look('get_employee', { id: PIETER }), { tools: [show({ view: 'person' })] }, say(SENTENCE)), fetch: agentApi(personRules(tables, PIETER)) });
    for (const o of [shown, person]) {
      expect(o.status, `200 (${WHAT(o)})`).toBe(200);
      const text = JSON.stringify(blocksOf(o));
      for (const [what, value] of Object.entries(SECRET_VALUES)) expect(text, `no ${what} in any block`).not.toContain(value);
      expect(text, 'no email address in any block').not.toMatch(/@/);
      expect(text, 'no private key name').not.toMatch(/"(email|phone|id_number|id_number_last4|hr_staff_email|file_name|s3_key)"/);
    }
  });

  // ---------------------------------------------------------------- the default view, one person

  test('AC-4 The default view: a list gives the people table, one person gives the facts and the document rows; both give the person only; a failed lookup gives nothing', async () => {
    test.setTimeout(300_000);
    // A list of 3, no show_records.
    const three = ask('Who starts soonest?', { bedrock: turns(look('list_employees'), say(SENTENCE)), fetch: listApi(FIVE.slice(0, 3)) });
    expect(three.status, `200 (${WHAT(three)})`).toBe(200);
    expect(rowsOf(peopleTable(three) ?? {} as Block), 'the people table, 3 rows').toEqual(expectedRows(listGiven(three)));
    expect(rowsOf(peopleTable(three)!).length).toBe(3);

    // One person (Pieter on dev: Documents, start 10 Nov, due 3 Nov, no documents, no risk check).
    const tables = tablesWith([pieterRow()]);
    const one = ask('Is he ready to start on Monday?', { focus: PIETER, tables, bedrock: turns(look('get_employee', { id: PIETER }), say(SENTENCE)), fetch: agentApi(personRules(tables, PIETER)) });
    expect(one.status, `200 (${WHAT(one)})`).toBe(200);
    const f = factsOf(one);
    expect(f.length, 'one facts block').toBe(1);
    expect(f[0]!.items, 'the person\'s facts, in the card\'s order and words').toEqual([
      { label: W.facts.department, value: 'Operations' },
      { label: W.facts.job, value: 'Warehouse Lead' },
      { label: W.facts.step, value: 'Documents' },
      { label: W.facts.start, value: '10 Nov 2026' },
      { label: W.facts.partner, value: 'Thandi Demo-HR' },
      { label: W.facts.due, value: '3 Nov 2026' },
      { label: RISK_HEADING, value: RISK_NONE },
    ]);
    const c = checksBlocksOf(one);
    expect(c.length, 'one checks block').toBe(1);
    expect(c[0]!.items, 'one row per required document, both Missing (CHAT-05\'s words)').toEqual([{ label: 'ID document', result: 'Missing' }, { label: 'Bank letter', result: 'Missing' }]);
    expect(tablesOf(one), 'no table for one person').toEqual([]);

    // Empty fields are left out, never "undefined" or empty.
    const bare = tablesWith([employeeRow({ id: uuidOf(77), first: 'Sipho', last: 'Nkosi', department: 'Finance', job_title: '', stage: 'INVITED', step: 'INVITED', start: '' })]);
    const thin = ask('Tell me about Sipho', { focus: uuidOf(77), tables: bare, bedrock: turns(look('get_employee', { id: uuidOf(77) }), say(SENTENCE)), fetch: agentApi(personRules(bare, uuidOf(77))) });
    expect(thin.status, `200 (${WHAT(thin)})`).toBe(200);
    const labels = (factsOf(thin)[0]?.items ?? []).map((i: any) => i.label);
    expect(labels, 'no job title, start date, HR partner or due date when there is none').toEqual([W.facts.department, W.facts.step, RISK_HEADING]);
    for (const i of factsOf(thin)[0]?.items ?? []) expect(String(i.value).trim(), `${i.label} has a value`).not.toMatch(/^$|undefined|null/);

    // The documents call fails: the facts still come, and no checks block (never "Missing" for what could not be read).
    const unread = ask('Is he ready?', { focus: PIETER, tables, bedrock: turns(look('get_employee', { id: PIETER }), say(SENTENCE)),
      fetch: agentApi([{ method: 'GET', url: `/agent/v1/verifications?employee_id=${PIETER}`, status: 500, json: { message: 'Internal Server Error' } }, ...personRules(tables, PIETER)]) });
    expect(unread.status, `200 (${WHAT(unread)})`).toBe(200);
    expect(factsOf(unread).length, 'the facts are still drawn').toBe(1);
    expect(checksBlocksOf(unread), 'no checks block when the documents could not be read').toEqual([]);
    expect(JSON.stringify(blocksOf(unread)), 'and never "Missing"').not.toContain('Missing');

    // A list and one person in the same turn: the person view only.
    const both = ask('Is Pieter ready, and who else starts soon?', { focus: PIETER, tables,
      bedrock: turns(look('list_employees'), look('get_employee', { id: PIETER }), say(SENTENCE)), fetch: agentApi([...personRules(tables, PIETER), ...listRules(FIVE)]) });
    expect(both.status, `200 (${WHAT(both)})`).toBe(200);
    expect(factsOf(both).length, 'the person\'s facts').toBe(1);
    expect(tablesOf(both), 'and no people table').toEqual([]);

    // A failed list lookup: no records block.
    const failed = ask('Who starts soonest?', { bedrock: turns(look('list_employees'), say(SENTENCE)), fetch: agentApi([{ method: 'GET', url: '/agent/v1/employees?', status: 500, json: { message: 'Internal Server Error' } }]) });
    expect(failed.status, `200 (${WHAT(failed)})`).toBe(200);
    expect(recordsOf(failed), 'a failed lookup draws nothing').toEqual([]);
    // show_records with no lookup in the turn: no block, and no default either.
    const lonely = ask('Show me a table', { bedrock: turns({ tools: [show({ view: 'people' })] }, say(SENTENCE)) });
    expect(lonely.status, `200 (${WHAT(lonely)})`).toBe(200);
    expect(recordsOf(lonely), 'nothing to draw from').toEqual([]);

    // Two different people looked up and no show_records: no person view (the default needs exactly one person).
    const SIPHO = uuidOf(78);
    const two = tablesWith([pieterRow(), employeeRow({ id: SIPHO, first: 'Sipho', last: 'Nkosi', department: 'Finance', job_title: 'Clerk', stage: 'INVITED', step: 'INVITED', start: '2026-12-01' })]);
    const twoRules = agentApi([...personRules(two, PIETER), ...personRules(two, SIPHO)]);
    const pair = ask('Pieter and Sipho', { tables: two, bedrock: turns(look('get_employee', { id: PIETER }), look('get_employee', { id: SIPHO }), say(SENTENCE)), fetch: twoRules });
    expect(pair.status, `200 (${WHAT(pair)})`).toBe(200);
    expect(recordsOf(pair), 'two people and no show_records: no records block').toEqual([]);
    // With show_records person, the last person looked up is the one drawn.
    const lastOne = ask('Pieter, then Sipho', { tables: two, bedrock: turns(look('get_employee', { id: PIETER }), look('get_employee', { id: SIPHO }), { tools: [show({ view: 'person' })] }, say(SENTENCE)), fetch: twoRules });
    expect(lastOne.status, `200 (${WHAT(lastOne)})`).toBe(200);
    expect(factsOf(lastOne)[0]?.items?.find((i: any) => i.label === W.facts.department)?.value, 'the facts are the last person\'s (Sipho, Finance)').toBe('Finance');
    // show_records twice in one turn: the last valid call wins.
    const twice = ask('Who starts soonest?', { bedrock: turns(look('list_employees'), { tools: [show({ view: 'people_by_step' })] }, { tools: [show({ view: 'people' })] }, say(SENTENCE)), fetch: listApi(FIVE) });
    expect(twice.status, `200 (${WHAT(twice)})`).toBe(200);
    expect(peopleTable(twice), 'the last show_records (people) is drawn').toBeTruthy();
    expect(chartsOf(twice), 'not the first (people_by_step)').toEqual([]);

    // One person and CHAT-05's per-person document rows in the same answer: the rows are drawn once, not twice.
    const docs = { items: [], count: 0, documents: [{ document_id: 'd1', document_type: 'NATIONAL_ID', check: 'MATCHES', arrived_at: '2026-11-12T08:00:00.000Z' }] };
    const withRows = ask('Is Pieter ready?', { focus: PIETER, tables,
      bedrock: turns(look('get_employee', { id: PIETER }), look('list_verifications', { employee_id: PIETER }), say(SENTENCE)),
      fetch: agentApi([{ method: 'GET', url: `/agent/v1/verifications?employee_id=${PIETER}`, status: 200, json: docs }, ...personRules(tables, PIETER)]) });
    expect(withRows.status, `200 (${WHAT(withRows)})`).toBe(200);
    expect(withRows.json?.structuredData?.checks?.length, 'CHAT-05 made its rows').toBeGreaterThan(0);
    expect(factsOf(withRows).length, 'the facts are drawn').toBe(1);
    expect(checksBlocksOf(withRows), 'no second set of rows in blocks').toEqual([]);

    // The documents view: list_verifications with no person, show_records documents.
    const items = [
      { verification_id: 'v1', employee_id: uuidOf(1), employee_name: 'Pieter van Wyk', document_type: 'NATIONAL_ID', document_id: 'd1', check: 'MATCHES', confidence: 97, decision: 'FAIL', created_at: '2026-11-12T08:00:00.000Z' },
      { verification_id: 'v2', employee_id: 'EMP-0000012', employee_name: 'Old Id', document_type: 'BANK_CONFIRMATION', document_id: 'd2', confidence: 70, decision: 'PASS', created_at: '2026-11-13T08:00:00.000Z' },
      { verification_id: 'v3', employee_id: uuidOf(2), employee_name: 'Mobile Test', document_type: 'PAYSLIP', document_id: 'd3', check: 'MATCHES', confidence: 99, decision: 'PASS', created_at: '2026-11-14T08:00:00.000Z' },
    ];
    const listDocs = ask('Which documents need a look?', { bedrock: turns(look('list_verifications'), { tools: [show({ view: 'documents' })] }, say(SENTENCE)),
      fetch: agentApi([{ method: 'GET', url: '/agent/v1/verifications', status: 200, json: { items, count: 3 } }]) });
    expect(listDocs.status, `200 (${WHAT(listDocs)})`).toBe(200);
    const dt = tablesOf(listDocs)[0];
    expect(dt, 'a documents table').toBeTruthy();
    expect(headersOf(dt!), 'Employee, Document, Check').toEqual(W.documents);
    expect(rowsOf(dt!), 'CHAT-05\'s document and check words, the check from the stored check or the score (never the raw decision); an unknown type is left out').toEqual([
      ['Pieter van Wyk', 'ID document', 'Matches'],
      ['Old Id', 'Bank letter', 'Needs a look'],
    ]);
    expect((dt!.rows ?? []).map((r: any) => r.personId), 'personId from the record, only when a UUID').toEqual([uuidOf(1), undefined]);
    expect(JSON.stringify(blocksOf(listDocs)), 'no raw type code or decision').not.toMatch(/PAYSLIP|NATIONAL_ID|BANK_CONFIRMATION|"FAIL"|"PASS"/);
  });

  // ---------------------------------------------------------------- charts

  test('AC-5 Charts: by step from the lookup\'s counts, by department (8 bars, the rest as Other), by risk check in the approved words; none when partial, single or all zero', async () => {
    test.setTimeout(600_000);
    const chartOf = (o: Out) => chartsOf(o)[0];
    const bars = (b: Block | undefined) => (b?.bars ?? []).map((x: any) => [x.label, x.value]);

    // By step, from counts_by_step over every person (12, complete).
    const step = ask('How many people are at each step, as a chart?', { bedrock: turns(look('list_employees'), { tools: [show({ view: 'people_by_step' })] }, say(SENTENCE)), fetch: listApi(TODAY_PEOPLE) });
    expect(step.status, `200 (${WHAT(step)})`).toBe(200);
    const counts = listGiven(step)?.counts_by_step ?? {};
    expect(chartOf(step)?.title, 'the step chart\'s title').toBe(W.byStep);
    expect(chartOf(step)?.type, 'a bar chart').toBe('bar');
    expect(bars(chartOf(step)), 'one bar per step in the page\'s order, the lookup\'s counts').toEqual(STEPS.map((s) => [s, counts[s]]));
    expect(tablesOf(step), 'only the chart: no people table as well').toEqual([]);

    // Not complete (2,100 people, 10 pages read): no step chart.
    const many: ListPerson[] = Array.from({ length: 2100 }, (_, i) => ({ id: `M${i}`, first: `F${i}`, last: `L${i}`, step: 'DOCUMENTS', start: '2026-12-01' }));
    const partial = ask('Chart of steps', { bedrock: turns(look('list_employees'), { tools: [show({ view: 'people_by_step' })] }, say(SENTENCE)), fetch: agentApi(listRules(many)) });
    expect(partial.status, `200 (${WHAT(partial)})`).toBe(200);
    expect(listGiven(partial)?.complete, 'the lookup says it is not complete').toBe(false);
    expect(chartsOf(partial), 'no chart from partial counts').toEqual([]);

    // By department: 11 departments, every person in the list (13 people <= 20): 8 bars, largest first, ties by name, the 8th Other.
    const depts = ['Finance', 'Finance', 'Finance', 'Operations', 'Operations', 'People', 'Sales', 'Legal', 'Marketing', 'IT', 'Audit', 'Risk', ''];
    const deptPeople: ListPerson[] = depts.map((d, i) => ({ id: uuidOf(200 + i), first: `P${i}`, last: 'X', department: d, step: 'INVITED', start: '2026-12-01' }));
    const byDept = ask('People by department, as a chart', { bedrock: turns(look('list_employees'), { tools: [show({ view: 'people_by_department' })] }, say(SENTENCE)), fetch: listApi(deptPeople) });
    expect(byDept.status, `200 (${WHAT(byDept)})`).toBe(200);
    expect(chartOf(byDept)?.title, 'the department chart\'s title').toBe(W.byDepartment);
    // Counts: Finance 3, Operations 2, then 1 each sorted by name: Audit, IT, Legal, Marketing, People; the rest (Risk, Sales, no department) are Other: 3.
    expect(bars(chartOf(byDept)), '8 bars: largest first, ties by name, Other last with the rest summed (no department counts as Other)').toEqual([
      ['Finance', 3], ['Operations', 2], ['Audit', 1], ['IT', 1], ['Legal', 1], ['Marketing', 1], ['People', 1], [W.other, 3],
    ]);
    // More people match than the list holds (25 > 20): no department chart (the counts would be wrong).
    const cut = ask('People by department', { bedrock: turns(look('list_employees'), { tools: [show({ view: 'people_by_department' })] }, say(SENTENCE)),
      fetch: listApi(Array.from({ length: 25 }, (_, i) => ({ id: uuidOf(300 + i), first: `Q${i}`, last: 'Y', department: i % 2 ? 'Finance' : 'Sales', step: 'INVITED', start: '2026-12-01' }))) });
    expect(cut.status, `200 (${WHAT(cut)})`).toBe(200);
    expect((listGiven(cut)?.people ?? []).length, 'the list holds fewer people than match').toBeLessThan(listGiven(cut)?.total_matching ?? 0);
    expect(chartsOf(cut), 'no department chart from a partial list').toEqual([]);
    // One department only: fewer than 2 bars, no chart.
    const single = ask('People by department', { bedrock: turns(look('list_employees'), { tools: [show({ view: 'people_by_department' })] }, say(SENTENCE)),
      fetch: listApi(deptPeople.slice(0, 3)) });
    expect(chartsOf(single), 'one bar is not a chart').toEqual([]);

    // By risk check: the four bands in order, in the approved words.
    const report = { high: [{ employeeId: 'r1' }], medium: [{ employeeId: 'r2' }, { employeeId: 'r3' }], low: [{ employeeId: 'r4' }, { employeeId: 'r5' }, { employeeId: 'r6' }], no_data: [{ employeeId: 'r7' }], generated_at: '2026-11-19T08:00:00.000Z' };
    const risk = ask('Risk across everyone, as a chart', { bedrock: turns(look('get_high_risk_report'), { tools: [show({ view: 'risk' })] }, say(SENTENCE)),
      fetch: agentApi([{ method: 'GET', url: '/agent/v1/employees/risk-report', status: 200, json: report }]) });
    expect(risk.status, `200 (${WHAT(risk)})`).toBe(200);
    expect(chartOf(risk)?.title, 'the risk chart\'s title').toBe(W.byRisk);
    expect(bars(chartOf(risk)), 'high, medium, low, not assessed: the approved words and the four counts').toEqual([[RISK_WORD.HIGH.text, 1], [RISK_WORD.MEDIUM.text, 2], [RISK_WORD.LOW.text, 3], [RISK_NONE, 1]]);
    // All zero: no chart.
    const empty = ask('Risk chart', { bedrock: turns(look('get_high_risk_report'), { tools: [show({ view: 'risk' })] }, say(SENTENCE)),
      fetch: agentApi([{ method: 'GET', url: '/agent/v1/employees/risk-report', status: 200, json: { high: [], medium: [], low: [], no_data: [] } }]) });
    expect(empty.status, `200 (${WHAT(empty)})`).toBe(200);
    expect(chartsOf(empty), 'all bars 0: no chart').toEqual([]);
    for (const o of [step, byDept, risk]) for (const b of chartsOf(o)[0]?.bars ?? []) expect(Number.isInteger(b.value) && b.value >= 0 && b.value <= 10_000, `${b.label}: a whole number 0 to 10,000`).toBe(true);
  });

  // ---------------------------------------------------------------- the model's own words

  test('AC-6 The text parser: the five answers from Iggie\'s screenshots become paragraphs and lists with no Markdown marks left', async () => {
    test.setTimeout(300_000);
    for (const [name, text, mustRead] of SCREENSHOT_ANSWERS) {
      const out = ask('A question', { bedrock: turns(say(text)) });
      expect(out.status, `${name}: 200 (${WHAT(out)})`).toBe(200);
      const blocks = blocksOf(out);
      expect(blocks.length, `${name}: the answer is drawn as blocks`).toBeGreaterThan(0);
      for (const s of stringsOf(blocks)) {
        if (s.key === 'kind' || s.key === 'personId') continue;
        expect.soft(s.value, `${name}: no ** or __ left (${s.key})`).not.toMatch(/\*\*|__/);
        expect.soft(s.value, `${name}: no backtick left (${s.key})`).not.toContain('`');
        expect.soft(s.value, `${name}: no heading mark left (${s.key})`).not.toMatch(/^#{1,6}\s/m);
        expect.soft(s.value, `${name}: no pipe-table line left (${s.key})`).not.toMatch(/^\s*\|.*\|\s*$|\|\s*-{3,}/m);
      }
      for (const b of blocks.filter((x) => x.kind === 'text')) expect.soft(b.text, `${name}: a paragraph does not start with a bullet`).not.toMatch(/^\s*([-*•]|\d+\.)\s/);
      for (const want of mustRead) expect.soft(wordsOf(out), `${name}: the words "${want}" are kept`).toContain(want);
    }
    // With no records view, the model's own pipe table is kept as a table block with its own headers (the fallback).
    const fallback: [string, string[]][] = [['2 the data table', ['Field', 'Value']], ['5 soonest list', ['Employee', 'Department', 'Role', 'Planned Start', 'Status']]];
    for (const [name, headers] of fallback) {
      const text = SCREENSHOT_ANSWERS.find((x) => x[0] === name)![1];
      const out = ask('A question', { bedrock: turns(say(text)) });
      const t = tablesOf(out);
      expect(t.length, `${name}: one table block`).toBe(1);
      expect(headersOf(t[0]!), `${name}: the model's headers, marks removed`).toEqual(headers);
      expect(rowsOf(t[0]!).length, `${name}: its rows`).toBeGreaterThan(1);
    }
    // Two lines "- a" and "- b" make one list of two items; numbered lines make an ordered list.
    const two = ask('A question', { bedrock: turns(say('Two things:\n- a\n- b\n\nThen:\n1. first\n2. second')) });
    expect(two.status, `200 (${WHAT(two)})`).toBe(200);
    const lists = blocksOf(two).filter((b) => b.kind === 'list');
    expect(lists.map((l) => [l.ordered, l.items]), 'one bullet list of two, one numbered list of two').toEqual([[false, ['a', 'b']], [true, ['first', 'second']]]);
    expect(blocksOf(two).filter((b) => b.kind === 'text').map((b) => b.text), 'the two sentences are paragraphs').toEqual(['Two things:', 'Then:']);
  });

  // ---------------------------------------------------------------- limits and numbers

  test('AC-7 Limits: the table shows what the lookup shows and says how many match; limit cuts it; long text, lists and cells are cut by code', async () => {
    test.setTimeout(400_000);
    const forty: ListPerson[] = Array.from({ length: 40 }, (_, i) => ({ id: uuidOf(400 + i), first: `Name${i}`, last: 'Surname', department: 'Ops', step: 'DOCUMENTS', start: `2026-12-${String((i % 28) + 1).padStart(2, '0')}`, partnerName: 'Thandi' }));
    const all = ask('Everyone', { bedrock: turns(look('list_employees'), { tools: [show({ view: 'people' })] }, say(SENTENCE)), fetch: listApi(forty) });
    expect(all.status, `200 (${WHAT(all)})`).toBe(200);
    const list = listGiven(all);
    const t = peopleTable(all)!;
    expect(rowsOf(t), 'the rows are the people the lookup showed').toEqual(expectedRows(list));
    expect(t.more, 'and it says how many match').toBe(W.showing(list.people.length, 40));
    const five = ask('Top five', { bedrock: turns(look('list_employees'), { tools: [show({ view: 'people', limit: 5 })] }, say(SENTENCE)), fetch: listApi(forty) });
    expect(five.status, `200 (${WHAT(five)})`).toBe(200);
    expect(rowsOf(peopleTable(five)!), 'limit 5: the first five, in order').toEqual(expectedRows(listGiven(five)).slice(0, 5));
    expect(peopleTable(five)!.more, '"Showing 5 of 40."').toBe(W.showing(5, 40));
    const exact = ask('Five people', { bedrock: turns(look('list_employees'), { tools: [show({ view: 'people' })] }, say(SENTENCE)), fetch: listApi(FIVE) });
    expect(peopleTable(exact)?.more, 'all shown: no "Showing" line').toBeUndefined();

    // Long cells are cut at 120 characters.
    const longName: ListPerson[] = [FIVE[0]!, { ...FIVE[1]!, first: 'A'.repeat(90), last: 'B'.repeat(90) }];
    const wide = ask('Two people', { bedrock: turns(look('list_employees'), { tools: [show({ view: 'people' })] }, say(SENTENCE)), fetch: listApi(longName) });
    for (const r of rowsOf(peopleTable(wide)!)) for (const cell of r) expect(cell.length, 'a cell is at most 120 characters').toBeLessThanOrEqual(120);

    // The model's text: 20 paragraphs, one of 3,000 characters, and a list of 30 long items.
    // The long paragraph and the long list come first, so the 8-block cut cannot hide them.
    const long = ['z'.repeat(3000), Array.from({ length: 30 }, (_, i) => `- item ${'w'.repeat(400)} ${i}`).join('\n'), ...Array.from({ length: 19 }, (_, i) => `Paragraph ${'x'.repeat(10)} number ${'y'.repeat(i)}.`)].join('\n\n');
    const text = ask('Say a lot', { bedrock: turns(say(long)) });
    expect(text.status, `200 (${WHAT(text)})`).toBe(200);
    const blocks = blocksOf(text);
    expect(blocks.length, 'at most 8 blocks').toBeLessThanOrEqual(8);
    expect(blocks.filter((b) => b.kind === 'list').length, 'the long list is drawn (cut, not dropped)').toBe(1);
    for (const b of blocks.filter((x) => x.kind === 'text')) expect(b.text.length, 'a paragraph is at most 1,200 characters').toBeLessThanOrEqual(1200);
    for (const b of blocks.filter((x) => x.kind === 'list')) {
      expect(b.items.length, 'a list has at most 20 items').toBeLessThanOrEqual(20);
      for (const i of b.items) expect(i.length, 'an item is at most 300 characters').toBeLessThanOrEqual(300);
    }
  });

  test('AC-8 No number runs in any block: dates are written with the month word, a planted ID number is removed, a non-UUID id is dropped', async () => {
    test.setTimeout(300_000);
    const planted: ListPerson[] = [
      { id: uuidOf(501), first: 'Kagiso', last: 'Molefe', department: 'Finance', job_title: 'Clerk', step: 'DOCUMENTS', start: '2026-09-14', partnerName: `Thandi ${SECRET_VALUES.idNumber}` },
      { id: 'EMP-0000012', first: 'Old', last: 'Id', department: 'Finance', step: 'INVITED', start: '2026-11-30', partnerName: 'Thandi' },
    ];
    const out = ask('Who starts soonest?', { bedrock: turns(look('list_employees'), { tools: [show({ view: 'people' })] }, say(`Kagiso's ID is ${SECRET_VALUES.idNumber} and he starts 2026-09-14.`)), fetch: listApi(planted) });
    expect(out.status, `200 (${WHAT(out)})`).toBe(200);
    const t = peopleTable(out)!;
    expect(t, 'the people table').toBeTruthy();
    for (const s of stringsOf(blocksOf(out))) {
      if (s.key === 'personId') continue;
      expect(await hasNumberRun(s.value), `"${s.value}" (${s.key}) holds no number run`).toBe(false);
    }
    const kagiso = rowsOf(t).find((r) => r[0] === 'Kagiso Molefe');
    expect(kagiso?.[2], 'September is "Sep", never "Sept"').toBe('14 Sep 2026');
    expect(JSON.stringify(blocksOf(out)), 'no "Sept" anywhere').not.toMatch(/Sept\b/);
    const old = (t.rows ?? []).find((r: any) => Object.values(r.cells ?? {}).includes('Old Id'));
    expect(old, 'the old-id person is still a row').toBeTruthy();
    expect(old!.personId, 'with no personId (not a UUID)').toBeUndefined();
    expect((t.rows ?? []).find((r: any) => Object.values(r.cells ?? {}).includes('Kagiso Molefe'))?.personId, 'a UUID id is kept').toBe(uuidOf(501));

    // A number run planted in a person's facts (job title and department) is removed there too.
    const id = uuidOf(502);
    const rows = tablesWith([employeeRow({ id, first: 'Lerato', last: 'Dube', department: `Finance ${SECRET_VALUES.idNumber}`, job_title: `Clerk 0821234567`, stage: 'INVITED', step: 'INVITED', start: '2026-12-01' })]);
    const person = ask('Tell me about Lerato', { focus: id, tables: rows, bedrock: turns(look('get_employee', { id }), say(SENTENCE)), fetch: agentApi(personRules(rows, id)) });
    expect(person.status, `200 (${WHAT(person)})`).toBe(200);
    const f = factsOf(person)[0];
    expect(f, 'the facts block').toBeTruthy();
    for (const s of stringsOf(f)) expect(await hasNumberRun(s.value), `fact "${s.value}" (${s.key}) holds no number run`).toBe(false);
  });

  // ---------------------------------------------------------------- the instruction lines, the page's words

  test('AC-9 The instruction lines: "Prefer bullet lists" is gone, the two formatting lines are there byte for byte, the pinned lines are kept', async () => {
    test.setTimeout(120_000);
    const out = ask('Who starts soonest?', { bedrock: turns(look('list_employees'), say(SENTENCE)), fetch: listApi(FIVE) });
    expect(out.status, `200 (${WHAT(out)})`).toBe(200);
    const system = answerCalls(out.run)[0]?.body?.system;
    const prompt: string = Array.isArray(system) ? system.map((b: any) => b.text).join('\n') : String(system ?? '');
    const lines = prompt.split('\n');
    expect(lines, 'the bullet-list line is gone').not.toContain('- Be concise and factual. Prefer bullet lists for data-heavy responses.');
    expect(prompt, 'no line asks for bullet lists').not.toMatch(/Prefer bullet lists/);
    for (const l of FORMAT_LINES) expect(lines.filter((x) => x === l).length, `once, byte for byte: ${l.slice(0, 50)}…`).toBe(1);
    // The lines the locks already pin (chat-05.2: CHAT-05's, CHAT-09's) are all still there. "Nothing else added" is CHAT-05 AC-7's job
    // (child lock chat-05.3), so a later prompt card needs one child lock, not two.
    for (const l of KNOWN_LINES) expect.soft(lines, `kept: ${l.slice(0, 50)}…`).toContain(l);
    expect(prompt, 'no "Naleko AI"').not.toMatch(/Naleko AI/i);
    // Not a guardrail change: the guardrail file is as CHAT-02 pinned it.
    const now = readFileSync(join(REPO, 'infra', 'ai_guardrail.tf'), 'utf8');
    const pinned = readFileSync(join(__dirname, 'support', 'chat-02', 'baseline', 'ai_guardrail.c859f0f.tf.txt'), 'utf8');
    expect(now, 'infra/ai_guardrail.tf is unchanged').toBe(pinned);
  });

  test('AC-10 The words are the screens\' own: step words as the Today page, risk words as Iggie approved them', async () => {
    test.setTimeout(300_000);
    // Each of the four steps, and a stage that is none of them.
    const people: ListPerson[] = [
      ...Object.keys(STEP_OF).map((code, i) => ({ id: uuidOf(600 + i), first: `S${i}`, last: 'Z', step: code, start: '2026-12-01' })),
      { id: uuidOf(609), first: 'S9', last: 'Z', step: null, start: '2026-12-02' },
    ];
    const out = ask('Steps', { bedrock: turns(look('list_employees'), { tools: [show({ view: 'people' })] }, say(SENTENCE)), fetch: listApi(people) });
    expect(out.status, `200 (${WHAT(out)})`).toBe(200);
    const step = Object.fromEntries(rowsOf(peopleTable(out)!).map((r) => [r[0], r[1]]));
    Object.keys(STEP_OF).forEach((code, i) => expect(step[`S${i} Z`], `${code} reads as the Today page reads it`).toBe(STEP_OF[code]));
    expect(step['S9 Z'], 'a step that is none of the four reads "Not set", never the raw code').toBe(W.notSet);
    expect(JSON.stringify(blocksOf(out)), 'no raw step code').not.toMatch(/INVITED|IN_REVIEW|VERIFIED|ODD_STAGE|"DOCUMENTS"/);
    // Risk words on one person (each band), as the person page shows them.
    for (const band of ['LOW', 'MEDIUM', 'HIGH'] as const) {
      const id = uuidOf(700);
      const t = tablesWith([employeeRow({ id, first: 'Risk', last: 'Person', department: 'Finance', stage: 'INVITED', step: 'INVITED', start: '2026-12-01', riskBand: band, riskReason: 'A reason.', riskAt: '2026-11-12T08:00:00.000Z' })]);
      const r = ask('Tell me about them', { focus: id, tables: t, bedrock: turns(look('get_employee', { id }), say(SENTENCE)), fetch: agentApi(personRules(t, id)) });
      expect(r.status, `${band}: 200 (${WHAT(r)})`).toBe(200);
      const risk = (factsOf(r)[0]?.items ?? []).find((i: any) => i.label === RISK_HEADING);
      expect(risk?.value, `${band}: the approved words`).toBe(RISK_WORD[band].text);
    }
  });

  // ---------------------------------------------------------------- what does not change

  test('AC-11 AI off, a robot, the 51st question, the company switch off and a cached answer: no blocks key, no model call, show_records never reached', async () => {
    test.setTimeout(300_000);
    const script = turns(look('list_employees'), { tools: [show({ view: 'people' })] }, say(SENTENCE));
    const noBlocks = (o: Out, label: string) => {
      expect.soft(Object.prototype.hasOwnProperty.call(o.json ?? {}, 'blocks'), `${label}: no blocks key at all`).toBe(false);
      expect.soft(answerCalls(o.run), `${label}: no model answer call`).toEqual([]);
      expect.soft(httpCalls(o.run), `${label}: no Agent API call`).toEqual([]);
    };
    noBlocks(ask('Who starts soonest?', { env: { AI_CALLS_ENABLED: 'false' }, bedrock: script, fetch: listApi(FIVE) }), 'AI off');
    noBlocks(ask('Who starts soonest?', { who: 'aRobot', bedrock: script, fetch: listApi(FIVE) }), 'a robot');
    const windowStart = Math.floor(Date.parse('2026-11-19T08:00:00.000Z') / 3_600_000) * 3600;
    const limited = tablesWith([]);
    limited['NalekoAiRateLimit'] = [...(limited['NalekoAiRateLimit'] ?? []), { pk: { S: `rateLimit#STAFF-A1#${windowStart}` }, requestCount: { N: '50' }, expiresAt: { N: String(windowStart + 3600) } }];
    const l = ask('Who starts soonest?', { tables: limited, bedrock: script, fetch: listApi(FIVE) });
    expect(l.status, `the 51st question: 429 (${WHAT(l)})`).toBe(429);
    noBlocks(l, 'the 51st question');
    const off = ask('Who starts soonest?', { tables: { ...baseTables('off') } as any, bedrock: script, fetch: listApi(FIVE) });
    expect(off.status, `switch off: 403 (${WHAT(off)})`).toBe(403);
    noBlocks(off, 'the company switch off');
    const first = ask('What is HR onboarding?', { bedrock: { intent: 'SIMPLE', answers: [{ text: 'It is how a new person is brought into a company.' }] } });
    expect(first.status, `first SIMPLE question: 200 (${WHAT(first)})`).toBe(200);
    const second = ask('What is HR onboarding?', { tables: first.run.tables, bedrock: { intent: 'SIMPLE', answers: [] } });
    expect(second.json?.cacheHit, `it came from the cache (${WHAT(second)})`).toBe(true);
    noBlocks(second, 'a cached answer');
  });

  test('AC-12 A stored chat gives back the same blocks and check rows; unknown or over-limit stored blocks are dropped on the way out; others\' chats stay unseen', async () => {
    test.setTimeout(300_000);
    // A table answer and a check-rows answer (CHAT-05's per-person documents) in one chat.
    const first = ask('Who starts soonest?', { bedrock: turns(look('list_employees'), { tools: [show({ view: 'people' })] }, say(SENTENCE)), fetch: listApi(FIVE) });
    expect(first.status, `200 (${WHAT(first)})`).toBe(200);
    const chatId = first.json?.chatId;
    expect(chatId, 'the chat was stored').toBeTruthy();
    const docs = { items: [], count: 0, documents: [{ document_id: 'd1', document_type: 'NATIONAL_ID', check: 'MATCHES', arrived_at: '2026-11-12T08:00:00.000Z' }] };
    const second = ask('Is Pieter\'s paperwork complete?', { chatId, focus: PIETER, tables: first.run.tables,
      bedrock: turns(look('list_verifications', { employee_id: PIETER }), say('His ID matches; the bank letter is missing.')),
      fetch: agentApi([{ method: 'GET', url: `/agent/v1/verifications?employee_id=${PIETER}`, status: 200, json: docs }]) });
    expect(second.status, `200 (${WHAT(second)})`).toBe(200);
    expect(second.json?.structuredData?.checks?.length, 'CHAT-05\'s check rows were made').toBeGreaterThan(0);
    const opened = openChat(chatId, second.run.tables);
    expect(opened.status, `the chat opens (${WHAT(opened)})`).toBe(200);
    const batsi = (opened.json?.messages ?? []).filter((m: any) => m.role === 'batsi');
    expect(batsi.length, 'two answers').toBe(2);
    expect(batsi[0].blocks, 'the first answer\'s blocks come back as they were').toEqual(first.json.blocks);
    expect(batsi[1].blocks, 'the second\'s too').toEqual(second.json.blocks);
    expect(batsi[1].checks, 'and its check rows (today they are lost)').toEqual(second.json.structuredData.checks);

    // Stored rows read back through the same limits: a block of unknown kind, a 30-row table and a non-UUID id are cleaned on the way out.
    const t = structuredClone(second.run.tables);
    const rows = (t['ask-batsi-chats'] ?? []) as any[];
    const target = rows.filter((r) => r.role?.S === 'batsi' && r.chat_id?.S === chatId).sort((x, y) => String(x.sk?.S).localeCompare(String(y.sk?.S)))[0];
    expect(target, 'the stored answer row').toBeTruthy();
    const planted = [
      { kind: 'text', text: `Kept. Started 2026-09-14, ID ${SECRET_VALUES.idNumber}.` },
      { kind: 'script', html: '<img src=x onerror=alert(1)>' },
      { kind: 'table', columns: [{ key: 'name', label: 'Employee' }], rows: Array.from({ length: 30 }, (_, i) => ({ cells: { name: `N${i}` }, personId: i === 0 ? 'EMP-0000012' : uuidOf(800 + i) })) },
    ];
    target.blocks = { S: JSON.stringify(planted) };
    const back = openChat(chatId, t);
    expect(back.status, `200 (${WHAT(back)})`).toBe(200);
    const got: Block[] = (back.json?.messages ?? []).filter((m: any) => m.role === 'batsi')[0]?.blocks ?? [];
    expect(got.map((b) => b.kind), 'the unknown kind is dropped').toEqual(['text', 'table']);
    expect(got[0]!.text, 'a stored date is written with the month word, and a stored ID number is removed on the way out').toMatch(/^Kept\. Started 14 Sep 2026, ID (?!.*\d{6})/);
    expect(JSON.stringify(back.json), 'no ID number is sent').not.toContain(SECRET_VALUES.idNumber);
    expect(got[1]!.rows.length, 'the table is cut to 25 rows').toBeLessThanOrEqual(25);
    expect(got[1]!.rows[0].personId, 'a non-UUID id is dropped').toBeUndefined();
    expect(JSON.stringify(back.json), 'the planted HTML is not sent').not.toContain('onerror');

    // Another person and another company cannot open it.
    expect(openChat(chatId, second.run.tables, 'a2').status, 'another HR person: not found').toBe(404);
    expect(openChat(chatId, second.run.tables, 'b1').status, 'another company: not found').toBe(404);

    // Over 20 KB of blocks (two long tables the model wrote, no lookup): the fresh answer has them, the stored answer keeps only the text blocks.
    const row = (n: number) => `| ${['a', 'b', 'c', 'd', 'e'].map((c) => `${c}${n} ${'w'.repeat(130)}`).join(' | ')} |`;
    const bigTable = ['| One | Two | Three | Four | Five |', '|---|---|---|---|---|', ...Array.from({ length: 25 }, (_, i) => row(i))].join('\n');
    const big = ask('Two big tables', { bedrock: turns(say(`First table.\n\n${bigTable}\n\nSecond table.\n\n${bigTable}`)) });
    expect(big.status, `200 (${WHAT(big)})`).toBe(200);
    expect(tablesOf(big).length, 'the fresh answer has the two tables').toBe(2);
    expect(Buffer.byteLength(JSON.stringify(big.json.blocks)), 'and is over 20 KB').toBeGreaterThan(20 * 1024);
    const bigBack = openChat(big.json.chatId, big.run.tables);
    expect(bigBack.status, `200 (${WHAT(bigBack)})`).toBe(200);
    const stored: Block[] = (bigBack.json?.messages ?? []).filter((m: any) => m.role === 'batsi')[0]?.blocks ?? [];
    expect(stored.map((b) => b.kind), 'over 20 KB: only the text blocks are kept').toEqual(['text', 'text']);
  });

  test('AC-21 No extra model call: a sentence and show_records in one message ends the turn there; show_records alone carries on as today', async () => {
    test.setTimeout(200_000);
    const together = ask('Who starts soonest?', { bedrock: turns(look('list_employees'), { text: SENTENCE, tools: [show({ view: 'people' })] }), fetch: listApi(FIVE) });
    expect(together.status, `200 (${WHAT(together)})`).toBe(200);
    expect(answerCalls(together.run).length, 'two model answer calls, as a listing without show_records').toBe(2);
    expect(together.json?.message, 'the answer is that sentence').toBe(SENTENCE);
    expect(peopleTable(together), 'and the table is drawn').toBeTruthy();
    const alone = ask('Who starts soonest?', { bedrock: turns(look('list_employees'), { tools: [show({ view: 'people' })] }, say(SENTENCE)), fetch: listApi(FIVE) });
    expect(alone.status, `200 (${WHAT(alone)})`).toBe(200);
    expect(answerCalls(alone.run).length, 'show_records with no text: three calls, as today').toBe(3);
    const without = ask('Who starts soonest?', { bedrock: turns(look('list_employees'), say(SENTENCE)), fetch: listApi(FIVE) });
    expect(answerCalls(without.run).length, 'the same listing without show_records: two').toBe(2);
    expect(httpCalls(together.run).length, 'show_records calls no Agent API').toBe(httpCalls(without.run).length);
    // A sentence, show_records AND another lookup in one message: the lookup's answer goes back to the model, so the turn carries on.
    const LATER = 'Here is everyone, with Pieter first.';
    const tables = tablesWith([pieterRow()]);
    const mixed = ask('Who starts soonest, and Pieter?', { tables, bedrock: turns(look('list_employees'), { text: SENTENCE, tools: [show({ view: 'people' }), { name: 'get_employee', input: { id: PIETER } }] }, say(LATER)),
      fetch: agentApi([...personRules(tables, PIETER), ...listRules(FIVE)]) });
    expect(mixed.status, `200 (${WHAT(mixed)})`).toBe(200);
    expect(answerCalls(mixed.run).length, 'three model calls: the other lookup is answered first').toBe(3);
    expect(mixed.json?.message, 'the answer is the model\'s last sentence').toBe(LATER);
  });

  test('AC-22 The whole answer carries no phone, ID digits, HR partner email or ID number from any lookup', async () => {
    test.setTimeout(200_000);
    const tables = tablesWith([pieterRow()]);
    const assess = { employeeId: PIETER, risk: 'LOW', reason: 'Fine.', phone: SECRET_VALUES.phone, id_number_last4: SECRET_VALUES.last4, hr_staff_email: SECRET_VALUES.partnerEmail, idNumber: SECRET_VALUES.idNumber };
    const out = ask('Everything about Pieter and the others', { focus: PIETER, tables,
      bedrock: turns(look('list_employees'), look('get_employee', { id: PIETER }), look('list_verifications'), look('assess_employee_risk', { id: PIETER }), say(SENTENCE)),
      fetch: agentApi([
        { method: 'POST', url: `/agent/v1/employees/${PIETER}/assess-risk`, status: 200, json: assess },
        { method: 'GET', url: '/agent/v1/verifications?', status: 200, json: { items: [{ verification_id: 'v1', employee_id: PIETER, employee_name: 'Pieter van Wyk', document_type: 'NATIONAL_ID', document_id: 'd1', confidence: 97, decision: 'PASS', created_at: '2026-11-12T08:00:00.000Z', idNumber: SECRET_VALUES.idNumber }], count: 1 } },
        ...personRules(tables, PIETER), ...listRules(FIVE),
      ]) });
    expect(out.status, `200 (${WHAT(out)})`).toBe(200);
    for (const [what, value] of Object.entries(SECRET_VALUES)) expect(out.text, `the answer holds no ${what}`).not.toContain(value);
    expect(out.text, 'no private key name').not.toMatch(/"(phone|id_number_last4|hr_staff_email|idNumber)"/);
  });
});

// ================================================================ the screen (AC-14 to AC-19)

const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs the fake Agent API.');
const log = (page: Page): Locator => page.getByRole('log', { name: 'Conversation with Batsi' });
const composer = (page: Page): Locator => page.getByRole('textbox', { name: 'Message Batsi' });
const PERSON_LINK = (id: string) => new RegExp(`/hr/employees/${id}$`);

const TABLE_BLOCKS: Block[] = [
  { kind: 'text', text: 'Here they are, soonest first.' },
  { kind: 'table', columns: W.people.map((label, i) => ({ key: ['name', 'step', 'start', 'partner'][i]!, label })), more: W.showing(3, 9), rows: [
    { cells: { name: 'Mobile Test', step: 'Invited', start: '19 Nov 2026', partner: 'Thandi Demo-HR' }, personId: uuidOf(2) },
    { cells: { name: 'Test EmailDev', step: 'In review', start: '23 Nov 2026', partner: 'Iggie Asker' }, personId: uuidOf(3) },
    { cells: { name: 'Old Id Person', step: 'Documents', start: W.notSet, partner: W.notAssigned }, personId: 'EMP-0000012' },
  ] },
];
const CHART_BLOCKS: Block[] = [
  { kind: 'text', text: 'Most people are waiting on documents.' },
  { kind: 'chart', type: 'bar', title: W.byStep, bars: [{ label: 'Invited', value: 3 }, { label: 'Documents', value: 5 }, { label: 'In review', value: 2 }, { label: 'Verified', value: 1 }] },
];

/** Asks one question and waits until the answer is drawn (`seen`: words the answer shows; by default its first block's or its message). */
async function openAndAsk(page: Page, signIn: SignInPage, hr: Login, chat: Chat08Fake, reply: Reply, seen?: string): Promise<Locator> {
  await signIn.open();
  await signIn.signInAs(hr);
  await expect(page).toHaveURL(/\/hr$/);
  await page.getByRole('button', { name: /^Ask Batsi/ }).click();
  chat.reply = () => reply;
  await composer(page).fill('Who starts soonest?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const l = log(page);
  await expect(l.getByText(seen ?? String(reply.blocks?.[0]?.text ?? reply.message), { exact: true }).first(), 'the answer is drawn').toBeVisible();
  return l;
}

test.describe('CHAT-08 · the answer on the screen', () => {
  test('AC-14 A table answer is a real table with column headers; at 390 its rows stack, each value with its column word, with no sideways scroll', async ({ page, signIn, hr, chat }, testInfo) => {
    noBackendOnly();
    const l = await openAndAsk(page, signIn, hr, chat!, { message: 'Here they are, soonest first.', blocks: TABLE_BLOCKS });
    const table = l.getByRole('table');
    await expect(table, 'one table').toHaveCount(1);
    for (const h of W.people) await expect(table.getByRole('columnheader', { name: h, exact: true }), `the "${h}" column header`).toHaveCount(1);
    await expect(table.getByRole('row'), 'a header row and three rows').toHaveCount(4);
    await expect(l.getByText(W.showing(3, 9), { exact: true }), 'the "Showing" line').toBeVisible();
    const cells = table.locator('td');
    const labels = await cells.evaluateAll((els) => els.map((e) => e.getAttribute('data-label')));
    expect(labels, 'each value carries its column word').toEqual([...W.people, ...W.people, ...W.people]);
    await expect(l.getByText('*', { exact: false }).filter({ hasText: /^\*+$/ }), 'no stray marks').toHaveCount(0);
    if (testInfo.project.name !== 'desktop-1280') {
      const overflow = await l.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(overflow, 'the conversation does not scroll sideways at 390').toBeLessThanOrEqual(1);
      const headerShown = await table.locator('thead').evaluate((el) => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0);
      const cellBox = await cells.first().boundingBox();
      const rowBox = await table.locator('tbody tr').first().boundingBox();
      expect(!headerShown || (cellBox!.width > rowBox!.width * 0.6), 'rows stack: each cell takes the row\'s width (or the header row is hidden)').toBe(true);
      for (const b of await page.getByRole('button').all()) {
        if (!(await b.isVisible())) continue;
        const box = await b.boundingBox();
        if (box) expect(box.x + box.width, 'no button runs off the right edge').toBeLessThanOrEqual(page.viewportSize()!.width + 1);
      }
    }
  });

  test('AC-15 The person\'s name opens their page, built by the app from personId; a non-UUID id gives the name without a link', async ({ page, signIn, hr, chat }) => {
    noBackendOnly();
    const l = await openAndAsk(page, signIn, hr, chat!, { message: 'Here they are, soonest first.', blocks: TABLE_BLOCKS });
    const table = l.getByRole('table');
    await expect(table.getByRole('link', { name: 'Mobile Test', exact: true }), 'Mobile Test is a link').toHaveAttribute('href', PERSON_LINK(uuidOf(2)));
    await expect(table.getByRole('link', { name: 'Test EmailDev', exact: true })).toHaveAttribute('href', PERSON_LINK(uuidOf(3)));
    await expect(table.getByRole('link', { name: 'Old Id Person' }), 'no link for an id that is not a UUID').toHaveCount(0);
    await expect(table.getByText('Old Id Person', { exact: true }), 'but the name is shown').toBeVisible();
    await table.getByRole('link', { name: 'Mobile Test', exact: true }).click();
    await expect(page, 'the person\'s page opens').toHaveURL(PERSON_LINK(uuidOf(2)));
  });

  test('AC-16 A chart shows each bar\'s words and number as text, the same numbers as a table for screen readers, and nothing moves', async ({ page, signIn, hr, chat }, testInfo) => {
    noBackendOnly();
    const l = await openAndAsk(page, signIn, hr, chat!, { message: 'Most people are waiting on documents.', blocks: CHART_BLOCKS });
    await expect(l.getByText(W.byStep, { exact: true }).first(), 'the chart\'s title').toBeVisible();
    const chart = l.locator('pp-bar-chart');
    await expect(chart, 'one bar chart, the design system\'s').toHaveCount(1);
    // What a sighted person sees: the chart without its screen-reader table.
    const seen = (await chart.evaluate((el) => { const c = el.cloneNode(true) as HTMLElement; c.querySelectorAll('table').forEach((t) => t.remove()); return c.textContent ?? ''; })).replace(/\s+/g, ' ');
    for (const b of CHART_BLOCKS[1]!.bars) {
      expect(seen, `"${b.label}" is written next to its bar`).toContain(b.label);
      expect(seen, `and its number ${b.value}`).toMatch(new RegExp(`(^|\\D)${b.value}(\\D|$)`));
    }
    // Each bar's words and its own number are written together (not just somewhere in the chart).
    for (const b of CHART_BLOCKS[1]!.bars) {
      const together = await chart.getByText(b.label, { exact: true }).first().evaluate((el) => (el.parentElement?.textContent ?? '').replace(/\s+/g, ' ').trim());
      expect(together, `"${b.label}" sits with its own number ${b.value}`).toMatch(new RegExp(`^${b.label}\\D*${b.value}$`));
    }
    if (testInfo.project.name !== 'desktop-1280') {
      expect(await l.evaluate((el) => el.scrollWidth - el.clientWidth), 'the chart answer does not scroll sideways at 390').toBeLessThanOrEqual(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 'nor does the page').toBeLessThanOrEqual(1);
      const box = await chart.boundingBox();
      expect(box!.x + box!.width, 'the chart fits the screen').toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    }
    const a11y = await chart.getByRole('table', { includeHidden: true }).evaluateAll((ts) => ts.map((t) => (t.textContent ?? '').replace(/\s+/g, ' ')));
    expect(a11y.length, 'a table holds the same numbers for screen readers').toBe(1);
    for (const b of CHART_BLOCKS[1]!.bars) expect(a11y[0], `the table has ${b.label} ${b.value}`).toMatch(new RegExp(`${b.label}\\D*${b.value}`));
    const moving = await chart.evaluate((el) => [el, ...el.querySelectorAll('*')].filter((e) => {
      const s = getComputedStyle(e);
      return (s.animationName && s.animationName !== 'none') || (s.transitionDuration && s.transitionDuration.split(',').some((d) => parseFloat(d) > 0));
    }).length);
    expect(moving, 'nothing in the chart animates or transitions').toBe(0);
  });

  test('AC-17 Safe drawing: HTML in any part of an answer shows as text; no element is made from it; the code never sets HTML', async ({ page, signIn, hr, chat }) => {
    noBackendOnly();
    const BAD = '<img src=x onerror=alert(1)> <b>bold</b>';
    const dialogs: string[] = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });
    const blocks: Block[] = [
      { kind: 'text', text: `Text ${BAD}` },
      { kind: 'list', ordered: false, items: [`Item ${BAD}`] },
      { kind: 'facts', title: `Facts ${BAD}`, items: [{ label: `Label ${BAD}`, value: `Value ${BAD}` }] },
      { kind: 'checks', items: [{ label: `Check ${BAD}`, result: 'Missing' }] },
      { kind: 'table', title: `Table ${BAD}`, columns: [{ key: 'a', label: `Column ${BAD}` }], rows: [{ cells: { a: `Cell ${BAD}` } }], more: `More ${BAD}` },
      { kind: 'chart', type: 'bar', title: `Chart ${BAD}`, bars: [{ label: `Bar ${BAD}`, value: 2 }, { label: 'Other', value: 1 }] },
    ];
    const l = await openAndAsk(page, signIn, hr, chat!, { message: `Text ${BAD}`, blocks });
    for (const where of ['Item', 'Facts', 'Label', 'Value', 'Check', 'Column', 'Cell', 'Chart', 'Bar']) {
      await expect(l.getByText(`${where} ${BAD}`, { exact: true }).first(), `${where}: the characters are shown as text`).toBeAttached();
    }
    expect(await l.locator('img, b, script, iframe').count(), 'no img, b, script or iframe element in the conversation').toBe(0);
    await page.waitForTimeout(300);
    expect(dialogs, 'no dialog opened').toEqual([]);
    // Source check: nothing in the panel, the chart or the chat sets HTML.
    const root = join(__dirname, '..', '..', 'src', 'app');
    const files = [
      ...readdirSync(join(root, 'ds', 'agent'), { recursive: true, encoding: 'utf8' }).map((f) => join(root, 'ds', 'agent', f)),
      ...readdirSync(join(root, 'features', 'hr-assistant'), { recursive: true, encoding: 'utf8' }).map((f) => join(root, 'features', 'hr-assistant', f)),
      ...readdirSync(join(root, 'ds'), { recursive: true, encoding: 'utf8' }).filter((f) => /bar-chart/.test(f)).map((f) => join(root, 'ds', f)),
    ].filter((f) => /\.(ts|html)$/.test(f) && existsSync(f));
    expect(files.some((f) => /bar-chart/.test(f)), 'the bar chart\'s file is there').toBe(true);
    for (const f of files) expect(readFileSync(f, 'utf8'), `${f.slice(root.length)} never sets HTML`).not.toMatch(/innerhtml|outerhtml|bypasssecuritytrust|domsanitizer/i);
  });

  test('AC-18 An old answer with only a message: the marks are gone, its bullet lines are a list', async ({ page, signIn, hr, chat }) => {
    noBackendOnly();
    const l = await openAndAsk(page, signIn, hr, chat!, { message: '**Status:** ACTIVE\n- a\n- b' }, 'Status: ACTIVE');
    await expect(l.getByText('Status: ACTIVE', { exact: true }), '"Status: ACTIVE" with no marks').toBeVisible();
    const items = l.getByRole('listitem').filter({ hasText: /^(a|b)$/ });
    await expect(items, 'a two-item list').toHaveCount(2);
    const lastAnswer = (await l.innerText());
    expect(lastAnswer, 'no * shown').not.toContain('*');
  });

  test('AC-19 An unknown block kind is skipped; the rest still shows', async ({ page, signIn, hr, chat }) => {
    noBackendOnly();
    const l = await openAndAsk(page, signIn, hr, chat!, { message: 'Before.', blocks: [{ kind: 'text', text: 'Before.' }, { kind: 'video', src: 'x', text: 'NOT SHOWN' }, { kind: 'list', ordered: false, items: ['After.'] }] });
    await expect(l.getByText('Before.', { exact: true }).first()).toBeVisible();
    await expect(l.getByRole('listitem').filter({ hasText: 'After.' }), 'the block after it').toBeVisible();
    expect(await l.innerText(), 'the unknown block is not drawn as text').not.toContain('NOT SHOWN');
  });

  test('AC-19 (also) Document rows show their label and result word; a numbered list is a numbered list', async ({ page, signIn, hr, chat }) => {
    noBackendOnly();
    const l = await openAndAsk(page, signIn, hr, chat!, { message: 'Two checks.', blocks: [
      { kind: 'text', text: 'Two checks.' },
      { kind: 'checks', items: [{ label: 'ID document', result: 'Matches' }, { label: 'Bank letter', result: 'Missing' }] },
      { kind: 'list', ordered: true, items: ['First step', 'Second step'] },
    ] });
    for (const [label, result] of [['ID document', 'Matches'], ['Bank letter', 'Missing']]) {
      const row = l.getByRole('listitem').filter({ hasText: label });
      await expect(row, `the "${label}" row`).toHaveCount(1);
      await expect(row, `shows "${result}"`).toContainText(result);
    }
    await expect(l.locator('ol > li'), 'the numbered list is an ol with two items').toHaveCount(2);
    await expect(l.locator('ol > li').first()).toHaveText('First step');
  });
});

// ================================================================ fixtures: the five answers from Iggie's screenshots (19 Nov 15:07 SAST)

/** [name, the model's text as typed from the screenshot, words that must still read after the marks are gone]. */
const SCREENSHOT_ANSWERS: [string, string, string[]][] = [
  ['1 ready on Monday',
    "Based on the records, here's Pieter's status:\n\n**Employee:** Pieter van Wyk (Operations)\n**Status:** ACTIVE\n**Email:** pepla-demo-pieter.blackhole.postmarkapp.com ✅\n\n**Ready to start:** Pieter's profile shows an ACTIVE stage, which indicates he's approved and onboarded. However, to confirm he's fully ready for Monday, you should verify:\n- **Document verifications** – Are all required documents verified?\n- **Risk assessment** – Has a risk check been completed?\n- **Any pending IT/facilities setup** – Check with relevant departments\n\nWould you like me to run a risk assessment or check his document verification status?",
    ['Employee: Pieter van Wyk (Operations)', 'Document verifications – Are all required documents verified?', 'Would you like me to run a risk assessment']],
  ['2 the data table',
    "Here's the data for **Pieter**:\n\n| Field | Value |\n|-------|-------|\n| **Name** | Pieter van Wyk |\n| **Department** | Operations |\n| **Status** | ACTIVE |\n| **Created** | 1 November 2026 |\n\nWould you like me to:\n- Run a **risk assessment** for this employee?\n- Check **document verifications**?\n- Pull the **audit log** for any activity history?",
    ["Here's the data for Pieter:", 'Run a risk assessment for this employee?', 'Pull the audit log for any activity history?']],
  ['3 risk failed',
    "The risk assessment failed — the employee was not found in the system.\n\n**Next steps:**\n- Verify the employee is correct\n- Check that the employee record has been fully created and saved\n- Use `list_employees` to confirm the employee exists\n\nWould you like me to help you verify the employee record?",
    ['Next steps:', 'Check that the employee record has been fully created and saved']],
  ['4 start date',
    "The employee record for Pieter does not include a specific start date field in the current data. However, the record shows:\n- **Status:** ACTIVE\n- **Created:** 1 November 2026\n- **Department:** Operations\n\nThe employee was created/onboarded on **1 November 2026**. If you need more detailed timeline information, please check the audit log.",
    ['Status: ACTIVE', 'Department: Operations', 'The employee was created/onboarded on 1 November 2026.']],
  ['5 soonest list',
    "Based on your employee list, here are the employees due to start **soonest**, sorted by planned start date:\n\n| Employee | Department | Role | Planned Start | Status |\n|----------|-----------|------|---------------|--------|\n| **Test** (EmailDev) | Operations | Manager | **17 Nov 2026** | Documents Submitted |\n| **Mobile** (Test) | Engineering | Developer | **19 Nov 2026** | Invited |\n| **Robot** (TestEmployee) | Engineering | — | **20 Nov 2026** | Invited |\n\n**Key actions needed:**\n- **Pieter** (Warehouse Lead) – Documents are **overdue**. Follow up urgently.\n- **Mobile** & **Robot** – Both invited and starting mid-late November; ensure document submission.\n\nWould you like me to check document verification status?",
    ['Key actions needed:', 'Pieter (Warehouse Lead) – Documents are overdue. Follow up urgently.']],
];

/** The two formatting lines this card adds (child lock chat-05.3 pins them in CHAT-05 AC-7 too). */
const FORMAT_LINES = [
  '- Be concise and factual. Write plain sentences. Do not use Markdown or tables.',
  '- When the answer is about people or records, call show_records once, last, and say in one short sentence what it shows. The screen draws the table, facts or chart from the lookup.',
];
/** Every other line of the instructions as the locks pin them after CHAT-09 (chat-05.2's AC-7 and chat-09's AC-11), the bullet-list line gone. */
const KNOWN_LINES = [
  'You are Batsi, an HR onboarding assistant for South African companies.',
  'You help HR clerks with onboarding tasks: checking employee status, risk assessments, document verifications, and audit logs.',
  '',
  'Rules:',
  '- Only assist with HR onboarding tasks. Politely decline all other requests.',
  '- Never reveal salary benchmarks, employment law advice, or individual performance ratings.',
  '- You may show what the HR person sees on the person page: name, email, job title, department, start date, step and HR partner. Never show ID numbers, phone numbers or bank account numbers.',
  '- When onboarding a new employee, always return a draft for human review (the onboard_new_employee tool handles this automatically).',
  '- If a lookup fails, say so in plain words and use its say sentence when it gives one. Never show tool names, record ids or error codes.',
  '- Always operate on behalf of the authenticated HR clerk. Never impersonate another user.',
  '- When you looked up one person\'s documents, the screen shows each check as a row, so answer in one short sentence and do not list the checks again.',
  '- Today\'s date is given in <today>. Use it for words like today, Monday, this week and soonest. A week runs from Monday to Sunday.',
  '- When the question is about the person in <employee_in_focus> (he, she, they or this person), call get_employee with that id first.',
  '- A person is ready to start only when get_employee says ready_to_start yes. Otherwise say no and give its reasons.',
  '- Use the step words Invited, Documents, In review and Verified. Never use stage words such as ACTIVE.',
  '- The start date is the start field. Never give the date a person was added as their start date.',
  '- If a lookup has no answer for something, say plainly that you could not find it. Do not guess and do not send HR to another system.',
  '- Write dates as the lookups write them, for example 10 Nov 2026.',
];
