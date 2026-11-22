import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ON_DEV, expect, test } from './support/fixtures';
import { LAMBDA, REPO, type Run } from './support/chat-05/harness';
import {
  A, B, BANK, EXPECTED_DOCUMENTS, EXPECTED_VERIFICATION_IDS, ID, ID_NUMBER, KEY, LABELS, LEGACY_ENV, MATRIC, NOMSA, PENDING, RESULTS, SENTENCE, SIPHO, T, TERTIARY, WORDS,
  agentApi, answerCalls, ask, askAbout, callTool, checksOf, deniedCalls, doc, dynamo, httpCalls, justAnswer, logsOf, lookUp, modelCalls, personAnswer, route, routeTables, tablesOf, writes,
  type Doc, type Out,
} from './support/chat-05/world';
import { baseTables } from './support/chat-02/world';
import { policyLines, tfText } from './support/chat-02/infra';

/**
 * CHAT-05 · Ask Batsi answers carry the check rows the screen expects (red).
 * One test per acceptance criterion, written from the card before any code.
 * Spec: /mnt/project-files/ask-batsi-chat/CHAT-05-answer-shape.md (18 Nov 2026, after the independent check of the same day), decisions in
 * /mnt/project-files/ask-batsi-chat/DECISIONS.md. Card notes and what is pinned beyond the text: cards/chat-05.md.
 *
 * CHAT-05 builds only the check rows (`structuredData.checks`) of an answer from nalekoAiChat, and the route behind them
 * (getDocumentVerifications with `employee_id`) now answers one person's documents with their check. The register-employee proposal is CHAT-06:
 * the answer has no `proposals` key here and no row is written to naleko-pending-actions.
 *
 * The tests run the real Lambdas in a fresh Node process each, against a fake AWS and a fake Agent API (support/chat-05/fake-aws, copied from
 * CHAT-02's with code added only). The model answers from a script the test wrote; a call with no script is refused and recorded, so nothing
 * here reaches Bedrock or any AI service. The Terraform checks read both stacks as text. Everything runs once (desktop-1280): there is no screen.
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS or reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};

let numberRule: ((text: string) => boolean) | undefined;
/** The shared rule (lambda/shared/pii-redact.mjs) for "this text still holds a number". */
async function hasNumberRun(text: string): Promise<boolean> {
  numberRule ??= (await import(pathToFileURL(join(LAMBDA, 'shared', 'pii-redact.mjs')).href)).hasNumberRun;
  return numberRule!(text);
}

const AT = (day: number) => `2026-11-${String(day).padStart(2, '0')}T08:00:00.000Z`;
const rowsOf = (o: Out) => checksOf(o);
const row = (label: string, result: string) => ({ label, result });
const noChecksKey = (o: Out) => !Object.prototype.hasOwnProperty.call(o.json?.structuredData ?? {}, 'checks');
const noProposals = (o: Out) => !('proposals' in (o.json ?? {})) && !('proposals' in (o.json?.structuredData ?? {}));
const WHAT = (o: Out) => (o.run.error ? `crashed: ${o.run.error.message.slice(0, 160)}` : `status ${o.status}: ${o.text.slice(0, 160)}`);
const noModel = (r: Run) => expect.soft(modelCalls(r), 'no call reached the model').toEqual([]);
const sortedDocs = (v: any[]) => [...(v ?? [])].sort((x, y) => String(x.document_id).localeCompare(String(y.document_id)));

test.describe('CHAT-05 · Ask Batsi answers carry the check rows', () => {
  test.beforeEach(({}, testInfo) => once(testInfo.project.name));

  // ---------------------------------------------------------------- the rows

  test('AC-1 One person\'s documents answer check rows in the screen words: required first, newest upload wins, Missing and Being checked told apart', async () => {
    test.setTimeout(240_000);
    // The ID is read and Matches, the bank letter is read and Needs a look (listed the other way round).
    const a = askAbout(NOMSA, [doc('d-bank', BANK, 'NEEDS_A_LOOK', AT(2)), doc('d-id', ID, 'MATCHES', AT(1))]);
    expect(a.status, `the answer is 200 (${WHAT(a)})`).toBe(200);
    expect(rowsOf(a), 'exactly two rows: ID document, then Bank letter, in the screen words').toEqual([row(WORDS.ID, WORDS.MATCHES), row(WORDS.BANK, WORDS.LOOK)]);
    expect(a.json.message, 'the model\'s one sentence is the message').toBe(SENTENCE);
    expect(a.json.toolCallsMade, 'the tool call is told as before').toEqual([{ tool: 'list_verifications', isError: false }]);
    expect(a.json.status, 'and the status is as before').toBe('COMPLETE');
    expect(noProposals(a), 'no proposals key in this card').toBe(true);
    // The old field stays: the raw tool answer, for the old app.
    expect(a.json.structuredData.verifications, 'structuredData.verifications is still the Agent API\'s own answer').toEqual(personAnswer(NOMSA, [doc('d-bank', BANK, 'NEEDS_A_LOOK', AT(2)), doc('d-id', ID, 'MATCHES', AT(1))]));

    // The question reaches the Agent API as one person's list (the new employee_id argument), with the key, and the tool offers it to the model.
    const calls = httpCalls(a.run);
    expect(calls.map((c) => c.method), 'one GET').toEqual(['GET']);
    expect(calls[0]?.url, 'to the verifications route with the person asked about').toMatch(new RegExp(`^https://agent\\.example\\.test/agent/v1/verifications\\?(.*&)?employee_id=${NOMSA}(&.*)?$`));
    expect(calls[0]?.headers['x-api-key'], 'with the server\'s key').toBe(KEY);
    const tool = (answerCalls(a.run)[0]?.body?.tools ?? []).find((t: any) => t.name === 'list_verifications');
    expect(tool?.input_schema?.properties?.employee_id?.type, 'list_verifications offers employee_id (a string) to the model').toBe('string');
    expect(String(tool?.description ?? ''), 'and its description says to use it for one person').toMatch(/\b(one|single) (person|employee)\b/i);

    // Only the bank letter is in: the ID is Missing.
    const bankOnly = askAbout(NOMSA, [doc('d-bank', BANK, 'MATCHES', AT(2))]);
    expect(rowsOf(bankOnly), 'only the bank letter uploaded: the ID row is Missing').toEqual([row(WORDS.ID, WORDS.MISSING), row(WORDS.BANK, WORDS.MATCHES)]);

    // Nothing is in at all: both required documents are Missing.
    const none = askAbout(NOMSA, []);
    expect(rowsOf(none), 'nothing uploaded: both required rows are Missing').toEqual([row(WORDS.ID, WORDS.MISSING), row(WORDS.BANK, WORDS.MISSING)]);

    // The ID is still being read (uploaded, no verification yet): Being checked, never Missing.
    const reading = askAbout(NOMSA, [doc('d-id', ID, 'READING', AT(3)), doc('d-bank', BANK, 'MATCHES', AT(2))]);
    expect(rowsOf(reading), 'an ID still being read is Being checked, not Missing').toEqual([row(WORDS.ID, WORDS.READING), row(WORDS.BANK, WORDS.MATCHES)]);

    // Two ID uploads: the newer one's check is shown, whichever order the list comes in.
    const older = doc('d-id-old', ID, 'MATCHES', AT(1));
    const newer = doc('d-id-new', ID, 'DOESNT_MATCH', AT(5));
    const bank = doc('d-bank', BANK, 'MATCHES', AT(2));
    for (const [name, docs] of [['older first', [older, newer, bank]], ['newer first', [newer, older, bank]]] as const) {
      expect(rowsOf(askAbout(NOMSA, [...docs])), `two ID uploads (${name}): the newer one's check is shown`).toEqual([row(WORDS.ID, WORDS.DIFFERS), row(WORDS.BANK, WORDS.MATCHES)]);
    }
    // The same minute: the larger document id is the newer.
    const tieLow = doc('doc-0001', ID, 'MATCHES', AT(4));
    const tieHigh = doc('doc-0002', ID, 'DOESNT_MATCH', AT(4));
    expect(rowsOf(askAbout(NOMSA, [tieHigh, tieLow, bank])), 'two ID uploads at the same time: the larger document id wins').toEqual([row(WORDS.ID, WORDS.DIFFERS), row(WORDS.BANK, WORDS.MATCHES)]);

    // The other two types follow the required ones, matric then tertiary, newest of each.
    const more = askAbout(NOMSA, [doc('d-tert', TERTIARY, 'NEEDS_A_LOOK', AT(8)), doc('d-matric-new', MATRIC, 'READING', AT(7)), doc('d-matric-old', MATRIC, 'MATCHES', AT(6)), bank, doc('d-id', ID, 'MATCHES', AT(1))]);
    expect(rowsOf(more), 'then one row for each other type the person has, in the word table\'s order').toEqual([
      row(WORDS.ID, WORDS.MATCHES), row(WORDS.BANK, WORDS.MATCHES), row(WORDS.MATRIC, WORDS.READING), row(WORDS.TERTIARY, WORDS.LOOK),
    ]);
    const matricOnly = askAbout(NOMSA, [doc('d-matric', MATRIC, 'MATCHES', AT(6))]);
    expect(rowsOf(matricOnly), 'a person with only a matric certificate: both required Missing, then the matric row').toEqual([
      row(WORDS.ID, WORDS.MISSING), row(WORDS.BANK, WORDS.MISSING), row(WORDS.MATRIC, WORDS.MATCHES),
    ]);
  });

  test('AC-2 The check is the stored one, else the 90 rule; the answer holds no number', async () => {
    test.setTimeout(180_000);
    // The route works the check out (shared checkOf): a stored check wins; none stored uses 90 or more = Matches, under 90 = Needs a look;
    // no verification yet: still being read is Being checked, a finished one without a verification Needs a look (never Matches).
    const r = route('agentA', routeTables(), { employee_id: T.id });
    expect(r.status, `the route answers 200 (${WHAT(r)})`).toBe(200);
    const byId = Object.fromEntries(sortedDocs(r.json?.documents).map((d: Doc) => [d.document_id, d.check]));
    expect(byId, 'stored MATCHES with a low confidence is Matches; no stored check: 97 and exactly 90 are Matches, 85 Needs a look; being read; accepted with no verification Needs a look').toEqual({
      'doc-t-bank-new': 'NEEDS_A_LOOK', 'doc-t-bank-old': 'MATCHES', 'doc-t-id-new': 'MATCHES', 'doc-t-id-old': 'MATCHES', 'doc-t-matric': 'READING', 'doc-t-tertiary': 'NEEDS_A_LOOK',
    });
    // A stored DOESNT_MATCH against a high confidence, and a verification of another company that a document names, are told the same way.
    const t = routeTables();
    t['document-verification']!.push(
      { verificationId: { S: 'ver-x-differs' }, employeeId: { S: 'EMP-X' }, documentId: { S: 'doc-x-1' }, documentType: { S: ID }, confidence: { N: '99' }, decision: { S: 'PASS' }, createdAt: { S: AT(1) }, check: { S: 'DOESNT_MATCH' }, tenant_id: { S: A } },
      { verificationId: { S: 'ver-x-foreign' }, employeeId: { S: 'EMP-X' }, documentId: { S: 'doc-x-2' }, documentType: { S: BANK }, confidence: { N: '99' }, decision: { S: 'PASS' }, createdAt: { S: AT(1) }, check: { S: 'MATCHES' }, tenant_id: { S: B } },
    );
    t['documents']!.push(
      { employee_id: { S: 'EMP-X' }, document_id: { S: 'doc-x-1' }, document_type: { S: ID }, ocr_status: { S: 'COMPLETED' }, verification_id: { S: 'ver-x-differs' }, upload_timestamp: { S: AT(1) }, tenant_id: { S: A } },
      { employee_id: { S: 'EMP-X' }, document_id: { S: 'doc-x-2' }, document_type: { S: BANK }, ocr_status: { S: 'COMPLETED' }, verification_id: { S: 'ver-x-foreign' }, upload_timestamp: { S: AT(2) }, tenant_id: { S: A } },
    );
    t['employees']!.push({ employee_id: { S: 'EMP-X' }, first_name: { S: 'Xola' }, last_name: { S: 'Mbeki' }, tenant_id: { S: A } });
    const x = route('agentA', t, { employee_id: 'EMP-X' });
    const xById = Object.fromEntries(sortedDocs(x.json?.documents).map((d: Doc) => [d.document_id, d.check]));
    expect(xById, 'a stored DOESNT_MATCH is kept at 99; a verification of another company is not the document\'s (it Needs a look, never its Matches)').toEqual({ 'doc-x-1': 'DOESNT_MATCH', 'doc-x-2': 'NEEDS_A_LOOK' });

    // The answer holds no number: confidence 97, an ID number and odd values planted in the tool answer reach nowhere in the rows.
    const planted = personAnswer(NOMSA, [doc('d-id', ID, 'MATCHES', AT(1)), doc('d-bank', BANK, 'NEEDS_A_LOOK', AT(2))]);
    (planted.documents as any[]).forEach((d) => Object.assign(d, { confidence: 97, id_number: ID_NUMBER, note: `ID ${ID_NUMBER}` }));
    (planted.items as any[]).forEach((it) => Object.assign(it, { id_number: ID_NUMBER, confidence: 97 }));
    const a = askAbout(NOMSA, [], { answer: planted });
    const rows = rowsOf(a) ?? [];
    expect(rows, 'the rows are the words and nothing from the tool answer').toEqual([row(WORDS.ID, WORDS.MATCHES), row(WORDS.BANK, WORDS.LOOK)]);
    const text = JSON.stringify(rows);
    expect.soft(text, 'the 13-digit ID number is nowhere in the rows').not.toContain(ID_NUMBER);
    expect.soft(/\d/.test(text), 'no digit at all in the rows (so no 97 either)').toBe(false);
    for (const r2 of rows) {
      expect.soft(await hasNumberRun(r2.label), `no number run in the label "${r2.label}"`).toBe(false);
      expect.soft(await hasNumberRun(r2.result), `no number run in the result "${r2.result}"`).toBe(false);
    }

    // Values the tool answer carries that are not the screen's words never become a row or a result: a check that is not one of the four,
    // a type that is not one of the four (with a number in it).
    const odd = askAbout(NOMSA, [
      doc('d-id', ID, `MATCHES ${ID_NUMBER}` as any, AT(1)), doc('d-bank', BANK, 'NEEDS_A_LOOK', AT(2)), doc('d-x', `NATIONAL_ID ${ID_NUMBER}`, 'MATCHES', AT(3)),
    ]);
    const oddRows = rowsOf(odd);
    expect.soft(JSON.stringify(oddRows ?? []), 'a check or a type with a number in it reaches no row').not.toMatch(/\d/);
    for (const r2 of oddRows ?? []) {
      expect.soft(LABELS, `label "${r2.label}" is one of the four`).toContain(r2.label);
      expect.soft(RESULTS, `result "${r2.result}" is one of the screen's five`).toContain(r2.result);
    }

    // A check that is not one of the four never shows Matches (the screen must not say a document is fine when the tool did not say so).
    const unknown = askAbout(NOMSA, [doc('d-id', ID, 'SOMETHING_NEW' as any, AT(1)), doc('d-bank', BANK, 'MATCHES', AT(2))]);
    const unknownRows = rowsOf(unknown) ?? [];
    const idRow = unknownRows.find((r2) => r2.label === WORDS.ID);
    expect.soft(idRow, 'the ID document of an unknown check is still a row').toBeTruthy();
    expect.soft(idRow?.result, 'an unknown check never shows Matches').not.toBe(WORDS.MATCHES);
    expect.soft(RESULTS, 'an unknown check shows one of the screen\'s five results').toContain(idRow?.result);
    expect.soft(JSON.stringify(unknownRows), 'the raw check value is never shown').not.toContain('SOMETHING_NEW');
  });

  test('AC-3 No checks key (not an empty one) without one person\'s successful lookup; a type the word table does not know gives no row', async () => {
    test.setTimeout(240_000);
    const body = [doc('d-id', ID, 'MATCHES', AT(1)), doc('d-bank', BANK, 'MATCHES', AT(2))];

    // A list for several people.
    const two = ask('Are both new people complete?', {
      bedrock: lookUp(NOMSA, SIPHO),
      fetch: agentApi([{ person: NOMSA, json: personAnswer(NOMSA, body) }, { person: SIPHO, json: personAnswer(SIPHO, body) }]),
    });
    expect(two.status, `two people asked about: 200 (${WHAT(two)})`).toBe(200);
    expect(httpCalls(two.run).length, 'both lookups were made').toBe(2);
    expect(noChecksKey(two), 'a list for several people has no checks key').toBe(true);

    // A call without employee_id.
    const unfiltered = ask('Which documents are waiting?', { bedrock: callTool('list_verifications', {}), fetch: agentApi([{ url: '/agent/v1/verifications', json: { items: [{ verification_id: 'v1', employee_id: NOMSA, document_type: ID, document_id: 'd1', confidence: 91, decision: 'PASS', created_at: AT(1) }], count: 1 } }]) });
    expect(unfiltered.status, `a plain list: 200 (${WHAT(unfiltered)})`).toBe(200);
    expect(httpCalls(unfiltered.run)[0]?.url, 'no employee_id was sent').not.toContain('employee_id');
    expect(noChecksKey(unfiltered), 'a call without employee_id has no checks key').toBe(true);
    expect(unfiltered.json.structuredData.verifications?.count, 'and the old field is still the raw answer').toBe(1);

    // A failed tool call.
    const failed = ask('Is Nomsa complete?', { bedrock: lookUp(NOMSA), fetch: agentApi([{ person: NOMSA, status: 500, json: { message: 'Internal' } }]) });
    expect(failed.status, `a failed tool call still answers 200 (${WHAT(failed)})`).toBe(200);
    expect(failed.json.toolCallsMade, 'the failure is told as before').toEqual([{ tool: 'list_verifications', isError: true }]);
    expect(noChecksKey(failed), 'a failed call has no checks key').toBe(true);

    // A question with no verification call, and another tool.
    const talk = ask('Hello', { bedrock: justAnswer('Hello. How can I help?') });
    expect(talk.status).toBe(200);
    expect(noChecksKey(talk), 'a question with no verification call has no checks key').toBe(true);
    expect(talk.json.structuredData, 'and structuredData is as before: empty').toEqual({});
    const other = ask('Show Nomsa', { bedrock: callTool('get_employee', { id: NOMSA }), fetch: agentApi([{ url: `/agent/v1/employees/${NOMSA}`, json: { employee_id: NOMSA, first_name: 'Nomsa' } }]) });
    expect(noChecksKey(other), 'another tool gives no checks key').toBe(true);
    expect(other.json.structuredData.employee, 'and its raw answer stays under employee').toEqual({ employee_id: NOMSA, first_name: 'Nomsa' });

    // A type the word table does not know gives no row, and the raw code is never shown.
    const unknown = askAbout(NOMSA, [doc('d-id', ID, 'MATCHES', AT(1)), doc('d-licence', 'DRIVERS_LICENCE', 'MATCHES', AT(2)), doc('d-passport', 'PASSPORT_COPY', 'DOESNT_MATCH', AT(3))]);
    expect(rowsOf(unknown), 'a type the word table does not know has no row (the bank letter is Missing)').toEqual([row(WORDS.ID, WORDS.MATCHES), row(WORDS.BANK, WORDS.MISSING)]);
    expect.soft(JSON.stringify(rowsOf(unknown)), 'the raw type code is not shown').not.toMatch(/LICENCE|PASSPORT|_/);
  });

  // ---------------------------------------------------------------- the route

  test('AC-4 The route answers one person in full: every page, both read paths, no confidence or file; other requests are byte for byte as before', async () => {
    test.setTimeout(300_000);
    for (const [path, world, env] of [['the company index (tenant-index)', routeTables({ twinInB: true }), undefined], ['the legacy company\'s Scan', routeTables({ legacy: true, twinInB: true }), LEGACY_ENV]] as const) {
      for (const who of ['agentA', 'hrA'] as const) {
        const r = route(who, world, { employee_id: T.id }, { env });
        const label = `${who}, ${path}`;
        expect(r.status, `${label}: 200 (${WHAT(r)})`).toBe(200);
        expect(r.run.error, `${label}: no crash`).toBeUndefined();
        // The person's rows sit after the first page of rows (the fake pages four at a time): all are answered.
        expect(r.json?.items?.map((i: any) => i.verification_id).sort(), `${label}: items hold all four of the person's verifications`).toEqual(EXPECTED_VERIFICATION_IDS);
        expect(r.json?.count, `${label}: count is 4`).toBe(4);
        for (const item of r.json?.items ?? []) {
          expect.soft(Object.keys(item).sort(), `${label}: an item is as before`).toEqual(['confidence', 'created_at', 'decision', 'document_id', 'document_type', 'employee_id', 'employee_name', 'verification_id']);
          expect.soft(item.employee_name, `${label}: with the person's name`).toBe(`${T.first} ${T.last}`);
        }
        // documents: one item per read document, six keys (chat-05.2: HR's decision and when, for CHAT-09), no confidence, no file.
        const docs = sortedDocs(r.json?.documents);
        expect(docs, `${label}: documents hold one item per read document with its check (an upload link with no file is not there)`).toEqual(EXPECTED_DOCUMENTS);
        for (const d of docs) expect.soft(Object.keys(d).sort(), `${label}: a document item has exactly six keys`).toEqual(['arrived_at', 'check', 'document_id', 'document_type', 'hr_decided_at', 'hr_decision']);
        expect.soft(r.text, `${label}: no file key or file name`).not.toMatch(/SECRET|uploads\/|s3_key|file_name/);
        expect.soft(r.text, `${label}: nothing of company B's row that names this person`).not.toMatch(/ver-b-twin|doc-b-twin/);
        expect.soft(r.text, `${label}: no other person's row`).not.toMatch(/ver-other|ver-b-|doc-other|doc-b-/);
        expect.soft(deniedCalls(r.run), `${label}: every call is one the route's role may make (Query on the two tenant-indexes, Query and Scan on the base tables)`).toEqual([]);
        expect.soft(writes(r.run), `${label}: nothing was written`).toEqual([]);
      }
    }
    // The legacy company is read with a Scan, the others through the index (so the two tests above really are two paths).
    const legacy = route('agentA', routeTables({ legacy: true }), { employee_id: T.id }, { env: LEGACY_ENV });
    expect(dynamo(legacy.run, 'document-verification').some((c) => c.op === 'Scan'), 'the legacy company is read with a Scan').toBe(true);
    const indexed = route('agentA', routeTables(), { employee_id: T.id });
    expect(dynamo(indexed.run, 'document-verification').some((c) => c.op === 'Query' && c.input?.IndexName === 'tenant-index'), 'another company is read through its tenant-index').toBe(true);

    // The others are byte for byte as before (the golden answers were taken from develop c00bf96 on the same stored rows).
    const golden = (name: string) => readFileSync(join(__dirname, 'support', 'chat-05', 'baseline', name), 'utf8');
    const same = (name: string, o: Out) => {
      expect.soft(o.status, `${name}: status`).toBe(200);
      expect.soft(o.text, `${name}: the answer is byte for byte as before`).toBe(golden(`${name}.json`));
    };
    const world = routeTables({ twinInB: true });
    same('agent-plain', route('agentA', world, {}));
    same('hr-plain', route('hrA', world, {}));
    same('hr-limit-2', route('hrA', world, { limit: '2' }));
    same('hr-waiting', route('hrA', world, { waiting: 'true' }));
    same('agent-plain-legacy', route('agentA', routeTables({ legacy: true, twinInB: true }), {}, { env: LEGACY_ENV }));

    // Company B has a row that names the same person id: B is answered its own row for it (every page), and company A's rows never.
    const b = route('agentB', routeTables({ twinInB: true }), { employee_id: T.id });
    expect(b.json?.items?.map((i: any) => i.verification_id), 'company B is answered its own row for that id, and only that').toEqual(['ver-b-twin']);
    expect(sortedDocs(b.json?.documents).map((d: Doc) => d.document_id), 'and its own document').toEqual(['doc-b-twin']);
    expect(b.text, 'and none of company A\'s').not.toMatch(/ver-t-|doc-t-|Nomsa/);
  });

  test('AC-5 Company: the route answers a company its own rows only, whatever the request says; the chat still refuses company B', async () => {
    test.setTimeout(240_000);
    const worlds = [['tenant-index', routeTables(), undefined], ['legacy Scan', routeTables({ legacy: true }), LEGACY_ENV]] as const;
    const FOREIGN_A = { query: { tenant_id: A, tenantId: A, company: A }, headers: { 'x-tenant-id': A, 'x-company': A }, path: { tenant_id: A, id: T.id }, body: { tenant_id: A } };
    const FOREIGN_B = { query: { tenant_id: B, tenantId: B, company: B }, headers: { 'x-tenant-id': B, 'x-company': B }, path: { tenant_id: B, id: 'x' }, body: { tenant_id: B } };
    for (const [path, world, env] of worlds) {
      for (const who of ['agentB', 'hrB'] as const) {
        for (const [how, forged] of [['plain', undefined], ['naming company A in the query, headers, path and body', FOREIGN_A]] as const) {
          const r = route(who, world, { employee_id: T.id }, { env, forged });
          const label = `${who} asking for company A's person (${how}, ${path})`;
          expect.soft(r.status, `${label}: 200 (${WHAT(r)})`).toBe(200);
          expect.soft(r.json?.items ?? [], `${label}: no items`).toEqual([]);
          expect.soft(r.json?.count, `${label}: count 0`).toBe(0);
          expect.soft(r.json?.documents ?? [], `${label}: no documents`).toEqual([]);
          expect.soft(r.text, `${label}: nothing of company A's person`).not.toMatch(/Nomsa|Dlamini|doc-t-|ver-t-|SECRET|uploads\//);
        }
      }
      // Company A is answered what it is answered without any of that: the company is the sign-in's, never the request's.
      for (const who of ['agentA', 'hrA'] as const) {
        const plainAnswer = route(who, world, { employee_id: T.id }, { env });
        const forged = route(who, world, { employee_id: T.id }, { env, forged: FOREIGN_B });
        expect.soft(forged.text, `${who} naming company B everywhere: the same answer as without (${path})`).toBe(plainAnswer.text);
        expect.soft(forged.text, `${who} naming company B: no row of company B (${path})`).not.toMatch(/ver-b-|doc-b-|Ngcobo|Bee/);
      }
    }
    // Company B has a row that names the same person id: B must never be answered A's rows, and A never B's.
    const twin = routeTables({ twinInB: true });
    const b = route('agentB', twin, { employee_id: T.id });
    expect.soft(b.text, 'company B is answered none of company A\'s rows for that id').not.toMatch(/ver-t-|doc-t-|Nomsa|SECRET/);
    expect.soft(b.json?.items?.every((i: any) => i.verification_id === 'ver-b-twin'), 'whatever company B is answered is its own row').toBe(true);

    // The chat Lambda answers a company-B caller 403 today (CHAT-04 changes that) and builds nothing.
    const chat = ask('Is Nomsa complete?', { who: 'b1', bedrock: lookUp(NOMSA), fetch: agentApi([{ person: NOMSA, json: personAnswer(NOMSA, [doc('d-id', ID, 'MATCHES', AT(1))]) }]) });
    expect(chat.status, `the chat refuses company B with 403 (${WHAT(chat)})`).toBe(403);
    expect(chat.json, 'with the fixed body').toEqual({ error: 'Forbidden' });
    expect(chat.text, 'no checks and no rows').not.toMatch(/checks|proposals/);
    expect(httpCalls(chat.run), 'the Agent API was not called').toEqual([]);
    noModel(chat.run);
  });

  // ---------------------------------------------------------------- tool names drive the shape; the prompt; the AI guards

  test('AC-6 Tool names, not tool output, drive the shape: a planted "checks" or "proposals" is just data; the answer never has proposals; the draft path is as before', async () => {
    test.setTimeout(240_000);
    const PLANTED = [{ label: 'PLANTED-LABEL', result: 'PLANTED-RESULT' }];
    const PROPOSALS = [{ actionId: 'PLANTED-ACTION', title: 'PLANTED', canApprove: true }];

    // A tool answer that carries both words, from a tool that is not a verification lookup.
    const emp = ask('Show Nomsa', { bedrock: callTool('get_employee', { id: NOMSA }), fetch: agentApi([{ url: `/agent/v1/employees/${NOMSA}`, json: { employee_id: NOMSA, checks: PLANTED, proposals: PROPOSALS } }]) });
    expect(emp.status, `200 (${WHAT(emp)})`).toBe(200);
    expect(noChecksKey(emp), 'a planted "checks" in another tool\'s answer does not become checks').toBe(true);
    expect(noProposals(emp), 'a planted "proposals" does not become proposals').toBe(true);

    // The same words in a one-person verification answer: the rows come from the documents, not from the planted list.
    const planted = personAnswer(NOMSA, [doc('d-id', ID, 'MATCHES', AT(1)), doc('d-bank', BANK, 'MATCHES', AT(2))], { checks: PLANTED, proposals: PROPOSALS });
    const lookup = askAbout(NOMSA, [], { answer: planted });
    expect(rowsOf(lookup), 'the rows are built from the documents, not from a planted "checks"').toEqual([row(WORDS.ID, WORDS.MATCHES), row(WORDS.BANK, WORDS.MATCHES)]);
    expect(noProposals(lookup), 'and a planted "proposals" does not become proposals').toBe(true);
    expect(JSON.stringify(rowsOf(lookup)), 'no planted word in the rows').not.toContain('PLANTED');

    // The same words in the model's own text are text.
    const textual = ask('Hi', { bedrock: justAnswer(`{"checks":${JSON.stringify(PLANTED)},"proposals":${JSON.stringify(PROPOSALS)}}`) });
    expect(noChecksKey(textual), 'JSON in the model\'s text does not become checks').toBe(true);
    expect(noProposals(textual), 'or proposals').toBe(true);

    // The register-employee path is as before: a draft answered with pendingAction, no row, no proposals key.
    const draft = { firstName: 'Lerato', lastName: 'Molefe', email: 'lerato.molefe@baker-a.example', department: 'Finance', role: 'Accountant', phoneNumber: '0825550123' };
    const onboard = ask('Register Lerato Molefe in Finance', { bedrock: callTool('onboard_new_employee', draft) });
    expect(onboard.status, `200 (${WHAT(onboard)})`).toBe(200);
    expect(onboard.json.status, 'the status is as before').toBe('PENDING_APPROVAL');
    expect(onboard.json.pendingAction, 'pendingAction is as before').toEqual({
      type: 'CREATE_EMPLOYEE', confirmEndpoint: '/v1/employees',
      draft: { first_name: 'Lerato', last_name: 'Molefe', email: 'lerato.molefe@baker-a.example', department: 'Finance', job_title: 'Accountant', phone: '0825550123' },
    });
    expect(onboard.json.structuredData.hitlDraft?.hitl, 'the old hitlDraft field is still there').toBe(true);
    // chat-05.1 (CHAT-06): the message, the proposal and the pending row of this path are CHAT-06's now (chat-06.spec.ts AC-1, AC-2).
    // What stays CHAT-05's: the old app's fields above, and no check rows.
    expect(noChecksKey(onboard), 'and no checks').toBe(true);
  });

  test('AC-7 The system prompt names Batsi and adds one line; the limit lines are byte for byte (chat-05.2: CHAT-09\'s fact lines; chat-05.3: CHAT-08\'s format lines)', async () => {
    test.setTimeout(120_000);
    const a = askAbout(NOMSA, [doc('d-id', ID, 'MATCHES', AT(1)), doc('d-bank', BANK, 'MATCHES', AT(2))]);
    expect(a.status, `200 (${WHAT(a)})`).toBe(200);
    const system = answerCalls(a.run)[0]?.body?.system;
    const prompt: string = (Array.isArray(system) ? system.map((b: any) => b.text).join('\n') : String(system ?? ''));
    expect(prompt.length, 'the model was given a system prompt').toBeGreaterThan(100);
    expect(prompt, 'it names Batsi').toContain('Batsi');
    expect(prompt, 'it no longer says Naleko AI').not.toMatch(/Naleko AI/i);
    const lines = prompt.split('\n');
    expect(lines[0], 'the first line is the same sentence with the new name').toBe('You are Batsi, an HR onboarding assistant for South African companies.');
    // The three lines that limit what Batsi does, byte for byte. chat-05.2 (CHAT-09, Iggie 19 Nov 15:15 SAST "Yes, same as the page"): the third is
    // the person-page line that replaces "first name only"; the other two are as on develop (c00bf96).
    const LIMITS = [
      '- Only assist with HR onboarding tasks. Politely decline all other requests.',
      '- Never reveal salary benchmarks, employment law advice, or individual performance ratings.',
      '- You may show what the HR person sees on the person page: name, email, job title, department, start date, step and HR partner. Never show ID numbers, phone numbers or bank account numbers.',
    ];
    // chat-05.2: CHAT-09's seven fact lines, byte for byte.
    const FACTS = [
      '- Today\'s date is given in <today>. Use it for words like today, Monday, this week and soonest. A week runs from Monday to Sunday.',
      '- When the question is about the person in <employee_in_focus> (he, she, they or this person), call get_employee with that id first.',
      '- A person is ready to start only when get_employee says ready_to_start yes. Otherwise say no and give its reasons.',
      '- Use the step words Invited, Documents, In review and Verified. Never use stage words such as ACTIVE.',
      '- The start date is the start field. Never give the date a person was added as their start date.',
      '- If a lookup has no answer for something, say plainly that you could not find it. Do not guess and do not send HR to another system.',
      '- Write dates as the lookups write them, for example 10 Nov 2026.',
    ];
    for (const l of FACTS) expect.soft(lines, `the fact line is there byte for byte: ${l.slice(0, 40)}…`).toContain(l);
    // chat-05.3: CHAT-08's two format lines, byte for byte; they replace "Prefer bullet lists for data-heavy responses."
    const FORMAT = [
      '- Be concise and factual. Write plain sentences. Do not use Markdown or tables.',
      '- When the answer is about people or records, call show_records once, last, and say in one short sentence what it shows. The screen draws the table, facts or chart from the lookup.',
    ];
    for (const l of FORMAT) expect.soft(lines, `the format line is there byte for byte: ${l.slice(0, 40)}…`).toContain(l);
    expect.soft(lines, 'the bullet-list line is gone').not.toContain('- Be concise and factual. Prefer bullet lists for data-heavy responses.');
    for (const l of LIMITS) expect.soft(lines, `the limit line is kept byte for byte: ${l.slice(0, 40)}…`).toContain(l);
    // Everything else is as it was, and exactly one line is added.
    const OLD = [
      'You help HR clerks with onboarding tasks: checking employee status, risk assessments, document verifications, and audit logs.',
      '',
      'Rules:',
      ...LIMITS,
      '- When onboarding a new employee, always return a draft for human review (the onboard_new_employee tool handles this automatically).',
      '- If a lookup fails, say so in plain words and use its say sentence when it gives one. Never show tool names, record ids or error codes.',
      '- Always operate on behalf of the authenticated HR clerk. Never impersonate another user.',
    ];
    for (const l of OLD) expect.soft(lines, `the old line is kept: ${l.slice(0, 40)}…`).toContain(l);
    const added = lines.slice(1).filter((l) => !OLD.includes(l) && !FACTS.includes(l) && !FORMAT.includes(l));
    expect(added.length, `exactly one line is added: ${JSON.stringify(added)}`).toBe(1);
    expect(added[0], 'it says the screen shows each check as a row, so one short sentence').toMatch(/row/i);
    expect(added[0], 'about the checks').toMatch(/check/i);
    expect(added[0], 'in one short sentence').toMatch(/sentence/i);
    expect(prompt.endsWith('\n'), 'nothing is appended after the last line').toBe(false);
  });

  test('AC-8 The AI off switch, a robot, the 51st question in an hour and a cached answer behave as today: no new field, no row, no model call', async () => {
    test.setTimeout(240_000);
    const keysOf = (o: Out) => Object.keys(o.json ?? {}).sort();
    const noNew = (o: Out, label: string) => {
      expect.soft(noChecksKey(o) && noProposals(o), `${label}: no checks and no proposals`).toBe(true);
      expect.soft(o.text, `${label}: no documents key either`).not.toMatch(/"documents"|"proposals"|"checks"/);
    };

    // AI_CALLS_ENABLED=false wins over everything.
    const off = ask('Is Nomsa complete?', { env: { AI_CALLS_ENABLED: 'false' }, bedrock: lookUp(NOMSA), fetch: agentApi([{ person: NOMSA, json: personAnswer(NOMSA, [doc('d-id', ID, 'MATCHES', AT(1))]) }]) });
    expect(off.status, `AI off: 200 (${WHAT(off)})`).toBe(200);
    expect(off.json.guardrailAction, 'AI off: the stand-in answer').toBe('AI_DISABLED');
    expect(off.json.structuredData, 'AI off: structuredData is empty').toEqual({});
    expect(keysOf(off), 'AI off: the answer has the fields it has today').toEqual(['cacheHit', 'conversationId', 'guardrailAction', 'latencyMs', 'message', 'status', 'structuredData', 'toolCallsMade']);
    noNew(off, 'AI off');
    noModel(off.run);
    expect(httpCalls(off.run), 'AI off: the Agent API was not called').toEqual([]);
    expect(writes(off.run), 'AI off: nothing was written').toEqual([]);

    // A robot (a test login) never reaches the model.
    const robot = ask('Is Nomsa complete?', { who: 'aRobot', bedrock: lookUp(NOMSA), fetch: agentApi([{ person: NOMSA, json: personAnswer(NOMSA, [doc('d-id', ID, 'MATCHES', AT(1))]) }]) });
    expect(robot.status, `a robot: 200 (${WHAT(robot)})`).toBe(200);
    expect(robot.json.guardrailAction, 'a robot: the stand-in answer').toBe('AI_DISABLED');
    expect(robot.json.structuredData, 'a robot: structuredData is empty').toEqual({});
    expect(keysOf(robot), 'a robot: the answer has the fields it has today').toEqual(keysOf(off));
    noNew(robot, 'a robot');
    noModel(robot.run);
    expect(httpCalls(robot.run), 'a robot: the Agent API was not called').toEqual([]);
    expect(writes(robot.run), 'a robot: nothing was written').toEqual([]);

    // The 51st question in an hour: 429 before any model call, as today.
    const windowStart = Math.floor(Date.now() / 3_600_000) * 3600;
    const tables = baseTables('on');
    tables['NalekoAiRateLimit']!.push({ pk: { S: `rateLimit#STAFF-A1#${windowStart}` }, requestCount: { N: '50' }, expiresAt: { N: String(windowStart + 3600) } });
    const limited = ask('Is Nomsa complete?', { tables, bedrock: lookUp(NOMSA), fetch: agentApi([{ person: NOMSA, json: personAnswer(NOMSA, [doc('d-id', ID, 'MATCHES', AT(1))]) }]) });
    expect(limited.status, `the 51st question: 429 (${WHAT(limited)})`).toBe(429);
    expect(limited.json?.error, 'the 51st question: the same words as today').toBe('Rate limit exceeded. Please try again later.');
    noNew(limited, 'the 51st question');
    noModel(limited.run);
    expect(httpCalls(limited.run), 'the 51st question: the Agent API was not called').toEqual([]);
    expect(writes(limited.run, PENDING), 'the 51st question: no pending row').toEqual([]);

    // A cached SIMPLE answer is returned as before, with an empty structuredData and no model answer call.
    const first = ask('What is HR onboarding?', { bedrock: { intent: 'SIMPLE', answers: [{ text: 'It is how a new person is brought into a company.' }] } });
    expect(first.status, `first SIMPLE question: 200 (${WHAT(first)})`).toBe(200);
    expect(tablesOf(first.run, 'naleko-prompt-cache').length, 'the answer was cached').toBe(1);
    const second = ask('What is HR onboarding?', { tables: first.run.tables, bedrock: { intent: 'SIMPLE', answers: [] } });
    expect(second.status, `the same question again: 200 (${WHAT(second)})`).toBe(200);
    expect(second.json.cacheHit, 'it came from the cache').toBe(true);
    expect(second.json.message, 'with the cached words').toBe('It is how a new person is brought into a company.');
    expect(second.json.structuredData, 'and an empty structuredData').toEqual({});
    noNew(second, 'a cached answer');
    expect(answerCalls(second.run), 'no model answer call').toEqual([]);
    expect(httpCalls(second.run), 'the Agent API was not called').toEqual([]);
    expect(writes(second.run, PENDING), 'no pending row').toEqual([]);
  });

  // ---------------------------------------------------------------- the route's errors, Terraform and imports

  test('AC-9 A failure on the person branch answers the fixed body and logs the error name only (be-18\'s rule for the new branch)', async () => {
    test.setTimeout(120_000);
    const MARKER = 'SECRET-INTERNAL-MARKER-4471';
    for (const [who, env, world] of [['agentA', undefined, routeTables()], ['hrA', undefined, routeTables()], ['agentA', LEGACY_ENV, routeTables({ legacy: true })]] as const) {
      const r = route(who, world, { employee_id: T.id }, { env, fail: { message: MARKER } });
      const label = `${who}${env ? ' (legacy)' : ''}`;
      expect.soft(r.run.error, `${label}: the handler does not throw`).toBeUndefined();
      expect.soft(r.status, `${label}: 500`).toBe(500);
      expect.soft(r.json, `${label}: the fixed answer and nothing else`).toEqual({ error: 'Something went wrong' });
      expect.soft(r.text, `${label}: the answer carries no error text`).not.toContain(MARKER);
      expect.soft(logsOf(r.run), `${label}: the logs carry no error text`).not.toContain(MARKER);
      expect.soft(logsOf(r.run), `${label}: but the error's name is logged`).toContain('InternalServerError');
    }
  });

  test('AC-10 No Terraform changes (the route\'s role is as it is, no table items) and no import outside lambda/shared and the packages the Lambdas already have', async () => {
    // Terraform: read as text. The route's role may Query the two tenant-indexes and Query and Scan the three base tables. No more.
    const pairs = policyLines()['infra/get_document_verifications']?.pairs ?? [];
    expect(pairs, 'getDocumentVerifications\' role is exactly what it is on develop (c00bf96): Query on the two tenant-indexes, Query and Scan on the three base tables, logs, trace, the PII key').toEqual([
      'Allow dynamodb:Query ${aws_dynamodb_table.document_verification.arn}/index/tenant-index null',
      'Allow dynamodb:Query ${aws_dynamodb_table.documents.arn}/index/tenant-index null',
      'Allow dynamodb:Query arn:aws:dynamodb:af-south-1:000000000000:table/document-verification null',
      'Allow dynamodb:Query arn:aws:dynamodb:af-south-1:000000000000:table/documents null',
      'Allow dynamodb:Query arn:aws:dynamodb:af-south-1:000000000000:table/employees null',
      'Allow dynamodb:Scan arn:aws:dynamodb:af-south-1:000000000000:table/document-verification null',
      'Allow dynamodb:Scan arn:aws:dynamodb:af-south-1:000000000000:table/documents null',
      'Allow dynamodb:Scan arn:aws:dynamodb:af-south-1:000000000000:table/employees null',
      'Allow kms:Decrypt module.kms_pii.key_arn null',
      'Allow kms:DescribeKey module.kms_pii.key_arn null',
      'Allow kms:GenerateDataKey module.kms_pii.key_arn null',
      'Allow kms:GenerateDataKeyWithoutPlaintext module.kms_pii.key_arn null',
      'Allow logs:CreateLogGroup arn:aws:logs:af-south-1:000000000000:log-group:/aws/lambda/getDocumentVerifications:* null',
      'Allow logs:CreateLogStream arn:aws:logs:af-south-1:000000000000:log-group:/aws/lambda/getDocumentVerifications:* null',
      'Allow logs:PutLogEvents arn:aws:logs:af-south-1:000000000000:log-group:/aws/lambda/getDocumentVerifications:* null',
      'Allow xray:PutTelemetryRecords * null',
      'Allow xray:PutTraceSegments * null',
    ]);
    expect(tfText(), 'Terraform never manages table data (no aws_dynamodb_table_item)').not.toMatch(/aws_dynamodb_table_item/);

    // Imports: only what the Lambdas have today, lambda/shared, and their own folder. Node's own modules and the SDK Lambda provides are fine.
    const BASELINE: Record<string, string[]> = {
      'lambda/getDocumentVerifications/index.mjs': ['@aws-lambda-powertools/logger', '@aws-lambda-powertools/tracer', '@aws-sdk/client-dynamodb', '@aws-sdk/util-dynamodb'],
      'lambda/nalekoAiChat': ['@aws-lambda-powertools/logger', '@aws-lambda-powertools/tracer', '@aws-sdk/client-bedrock-runtime', '@aws-sdk/client-dynamodb', '@aws-sdk/client-secrets-manager', '@aws-sdk/util-dynamodb'],
    };
    const files = [
      'lambda/getDocumentVerifications/index.mjs',
      ...readdirSync(join(REPO, 'lambda', 'nalekoAiChat')).filter((f) => f.endsWith('.mjs')).map((f) => `lambda/nalekoAiChat/${f}`),
    ];
    for (const file of files) {
      const dir = file.replace(/\/[^/]+$/, '');
      const allowed = BASELINE[file] ?? BASELINE[dir]!;
      const src = readFileSync(join(REPO, file), 'utf8');
      const specifiers = [...src.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]!);
      for (const s of specifiers) {
        if (s.startsWith('node:') || ['crypto', 'fs', 'path', 'url', 'util'].includes(s)) continue;
        if (s.startsWith('../shared/') || s.startsWith('./')) {
          expect.soft(existsSync(join(REPO, dir, s)), `${file}: ${s} exists`).toBe(true);
          continue;
        }
        expect.soft(allowed, `${file}: imports only a package it has today (${s})`).toContain(s);
      }
    }
  });
});

