import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { attributes } from './support/infra-harness';
import { policyOf, type TfResource } from './support/onb-15/tf-policy';
import { common, expectOnly, grants, lambdaNamed, list, resources, roleOf, settingsOf, squash as tfSquash } from './support/ten-01/tf';
import {
  A, AGENT_SECRET, B, D, HR, P, REPO, REVIEW_NAME, V, auditRows, awsCalls, bedrockOf, bodyOf, call, callEvent, callTogether, describe, document, eventFor, find, httpIn, httpOf, invokesOf, logLines,
  mcpBundle, mcpEvent, plain, publishedOf, row, rowsOf, rpcOf, runSteps, statusOf, tables, verification, writesOf, writesTo, handlerOf,
  type Answer, type Caller, type Run, type Step, type Tables,
} from './support/onb-22/harness';

/**
 * ONB-22 · The same rules through the Agent API and MCP (Jira NH-183, epic NH-150 Onboarding). Tier red.
 * One test per acceptance criterion (more where a criterion has parts), written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/ONB-22.md (18 Nov 2026). Notes: cards/onb-22.md.
 *
 * No screen: every test runs once, at desktop-1280. The Lambda tests run the real handlers, each call in its own Node
 * process (a cold Lambda), against a fake AWS (support/onb-22/fake-aws, copied from TEN-02's): DynamoDB over rows as
 * DynamoDB stores them, a Lambda client that runs the real reviewDocumentVerification against the same tables, EventBridge
 * that hands every event to the real auditLogConsumer, Secrets Manager with versions, and a fake fetch. Bedrock, Textract
 * and every other AI client fail the import or the call, so a test that reaches a paid AI service fails. The MCP server
 * is built the way CI builds it (python3 scripts/ci/build-lambdas.py nalekoMcpServer) and run out of the zip.
 *
 * Pinned by the verifier where the spec leaves a choice (the reasons are in cards/onb-22.md):
 *  - P1  A run that ends REFUSED or FAILED still answers 200 { status, run_status, error_code } (spec, "Approve and decline").
 *  - P2  The id of a proposal is `action_id` in every answer and event; the 409 for an open duplicate carries it.
 *  - P3  expiresAt is epoch seconds (a number), as the table's TTL needs; createdAt is an ISO time (the index range).
 *  - P4  approved_by and rejected_by are the person's email (as hr_reviewed_by is); approved_by_name is the name.
 *  - P5  The review Lambda is named by REVIEW_FUNCTION_NAME (a setting). The test gives it a name that is not the folder name.
 *  - P6  summariseVerification fails closed for a subject with no email on record (ONB-11's review, F-3): no Bedrock call.
 *  - P7  The seed contract for pepla-dev (AC-7) is support/onb-22/dev-ids.json: scripts/ci/seed-dev.py must write those rows.
 *  - P8  `step` is null (the key is present) when the stored stage and step say nothing.
 * Locked once accepted: see cards/onb-22.md.
 */

const once = (testInfo: { project: { name: string } }) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the Lambdas against a fake AWS and reads files.');
  test.skip(testInfo.project.name !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};
const here = __dirname;
const inDays = (d: number) => Math.floor(Date.now() / 1000) + Math.round(d * 86400);
const ISO = (day: number) => `2026-11-${String(day).padStart(2, '0')}T08:00:00.000Z`;
const baseline = JSON.parse(readFileSync(join(here, 'support', 'onb-22', 'baseline-c859f0f.json'), 'utf8')) as Record<string, any>;
const devIds = JSON.parse(readFileSync(join(here, 'support', 'onb-22', 'dev-ids.json'), 'utf8')) as Record<string, string>;
const text = (rel: string) => (existsSync(join(REPO, rel)) ? readFileSync(join(REPO, rel), 'utf8') : '');
const OLD_EMPLOYEE_KEYS = ['employee_id', 'email', 'first_name', 'last_name', 'department', 'stage', 'risk_band', 'risk_reason', 'created_at', 'updated_at'];
const sorted = (a: unknown[]) => [...a].sort();

// ------------------------------------------------------------------------------------------------ the routes, as callers use them

const PROPOSALS = { method: 'POST', path: '/agent/v1/proposals' };
const propose = (caller: Caller, body: unknown, t: Tables = tables(), extra: { headers?: Record<string, string>; env?: Record<string, string> } = {}): Run =>
  call('createProposal', caller, { ...PROPOSALS, body, headers: extra.headers }, { tables: t, env: extra.env });
const accept = (doc: string) => ({ type: 'ACCEPT_DOCUMENT', document_id: doc });
const listActions = (caller: Caller, t: Tables): Run => call('approveAgentAction', caller, { path: '/agent/v1/actions', route: '/agent/v1/actions' }, { tables: t });
const getAction = (caller: Caller, id: string, t: Tables): Run =>
  call('approveAgentAction', caller, { path: `/agent/v1/actions/${id}`, route: '/agent/v1/actions/{actionId}', pathParameters: { actionId: id } }, { tables: t });
const decide = (verb: 'approve' | 'reject', caller: Caller, id: string, t: Tables, body?: unknown, opts: { invokeFail?: string; noLambdaClient?: boolean; fail?: unknown; eventBridgeDown?: boolean | string; eventBridgeFailFirst?: number } = {}): Run =>
  call('approveAgentAction', caller, { method: 'POST', path: `/agent/v1/actions/${id}/${verb}`, route: `/agent/v1/actions/{actionId}/${verb}`, pathParameters: { actionId: id }, body }, { tables: t, ...opts });

type PendingOver = Partial<{ id: string; doc: string; emp: string; name: string; docType: string; check: string; tenant: string; status: string; created: string; expires: number; run: string; approvedBy: string; approvedByName: string; approvedAt: string }>;
/** A proposal row as the spec's decision 7 describes it. */
function pending(o: PendingOver = {}) {
  const row_ = row({
    actionId: o.id ?? 'act-onb22-0001', type: 'ACCEPT_DOCUMENT', document_id: o.doc ?? D.nomsaBank, employee_id: o.emp ?? P.nomsa.id,
    employee_name: o.name ?? `${P.nomsa.first} ${P.nomsa.last}`, document_type: o.docType ?? 'BANK_CONFIRMATION', check: o.check ?? 'MATCHES',
    proposed_by_kind: 'AGENT', proposed_by_id: 'default', status: o.status ?? 'PENDING_APPROVAL', createdAt: o.created ?? ISO(16),
    expiresAt: o.expires ?? inDays(7), tenant_id: o.tenant ?? A,
    ...(o.run ? { run_status: o.run } : {}), ...(o.approvedBy ? { approved_by: o.approvedBy } : {}), ...(o.approvedByName ? { approved_by_name: o.approvedByName } : {}), ...(o.approvedAt ? { approved_at: o.approvedAt } : {}),
  });
  return row_;
}
const withPending = (rows: ReturnType<typeof pending>[], base: Tables = tables()): Tables => ({ ...base, 'naleko-pending-actions': rows });
const eventOf = (r: Run, t: string) => publishedOf(r.calls, t).map((c) => c.detail);
const actionRow = (t: Tables, id: string) => find(t, 'naleko-pending-actions', { actionId: id });
const docRow = (t: Tables, emp: string, doc: string) => rowsOf(t, 'documents').find((r) => r['employee_id'] === emp && r['document_id'] === doc);
const empRow = (t: Tables, emp: string) => rowsOf(t, 'employees').find((r) => r['employee_id'] === emp);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const noExceptionText = (what: string, ...parts: unknown[]) => expect(JSON.stringify(parts), `${what}: only codes, never an exception's words`).not.toMatch(/boom|secret detail|424556617428|Task timed out|SECRET-MESSAGE-TEXT/i);

test.describe('ONB-22 The same rules through the Agent API and MCP', () => {
  // ---------------------------------------------------------------------------------------------- AC-1

  test('AC-1 An agent can ask for the documents waiting for HR and read an employee\'s step (Lambda)', async ({}, testInfo) => {
    once(testInfo);
    // The waiting list: the same body as for HR, for the agent's company only.
    const asAgent = call('getDocumentVerifications', 'agentA', { path: '/agent/v1/verifications', query: { waiting: 'true' } });
    const asHr = call('getDocumentVerifications', 'hrA', { path: '/v1/verifications', query: { waiting: 'true' } });
    expect(statusOf(asAgent), `the agent asks for the documents waiting (${describe(asAgent)})`).toBe(200);
    expect(statusOf(asHr), 'HR asks the same').toBe(200);
    const body = bodyOf(asAgent);
    expect(sorted(Object.keys(body ?? {})), 'items, count and counts, as ONB-13 answers').toEqual(['count', 'counts', 'items']);
    expect(body, 'the same body as HR gets').toEqual(bodyOf(asHr));
    const ids = (body.items as any[]).map((i) => i.document_id).sort();
    expect(ids, 'every document of company A still waiting for HR, and nothing decided, and nothing of company B').toEqual([D.nomsaBank, D.siphoId, D.siphoBank, D.thabo, D.lerato, D.piet].sort());
    expect(body.counts, 'the check words by count (Batsi\'s words, from checkOf)').toEqual({ READING: 1, MATCHES: 3, NEEDS_A_LOOK: 1, DOESNT_MATCH: 1 });
    const one = (body.items as any[]).find((i) => i.document_id === D.nomsaBank);
    expect(sorted(Object.keys(one)), 'six fields each').toEqual(['arrived_at', 'check', 'document_id', 'document_type', 'employee_id', 'employee_name']);
    expect(one, 'the check and the name').toMatchObject({ check: 'MATCHES', employee_name: 'Nomsa Dlamini', employee_id: P.nomsa.id, document_type: 'BANK_CONFIRMATION' });
    expect(JSON.stringify(body), 'no file link, no number, no name of a file').not.toMatch(/uploads\/|s3_key|letter\.pdf|confidence|national_id_number/i);
    expect(bodyOf(call('getDocumentVerifications', 'agentB', { path: '/agent/v1/verifications', query: { waiting: 'true' } })).items.map((i: any) => i.document_id), 'the agent of company B sees B\'s only').toEqual([D.bea]);
    expect(bedrockOf(asAgent.calls), 'no AI call').toEqual([]);
  });

  test('AC-1 An employee\'s step is in the agent\'s answer: Invited, Documents, In review, Verified, or null (Lambda)', async ({}, testInfo) => {
    once(testInfo);
    const mk = (id: string, extra: Record<string, string | undefined>) =>
      row({ employee_id: id, first_name: 'Ayanda', last_name: 'Zwane', email: 'ayanda.zwane@baker-a.example', department: 'Bakery', created_at: ISO(10), updated_at: ISO(12), riskBand: 'LOW', riskReason: 'Everything agrees.', tenant_id: A, ...extra });
    const cases: [string, string | null, Record<string, string | undefined>][] = [
      ['INVITED', 'INVITED', { stage: 'INVITED' }],
      ['DOCUMENTS', 'DOCUMENTS', { stage: 'ACTIVE', step: 'DOCUMENTS' }],
      ['IN_REVIEW', 'IN_REVIEW', { stage: 'DOCUMENTS_SUBMITTED', step: 'IN_REVIEW' }],
      ['VERIFIED', 'VERIFIED', { stage: 'VERIFIED', step: 'VERIFIED' }],
      ['an unknown stage and no step', null, { stage: 'SOMETHING_ELSE' }],
    ];
    for (const [i, [name, step, extra]] of cases.entries()) {
      const id = `3f1a7c52-1000-4d7e-9a11-aaaaaaaa000${i}`;
      const t = tables();
      t.employees!.push(mk(id, extra));
      const r = call('getEmployee', 'agentA', { path: `/agent/v1/employees/${id}`, route: '/agent/v1/employees/{id}', pathParameters: { id } }, { tables: t });
      expect(statusOf(r), `${name}: 200 (${describe(r)})`).toBe(200);
      const e = bodyOf(r).employee;
      expect(e, `${name}: the answer has a step key`).toHaveProperty('step');
      expect(e.step, `${name}: step is ${String(step)}`).toBe(step);
      for (const k of OLD_EMPLOYEE_KEYS) expect(e, `${name}: the old key ${k} stays`).toHaveProperty(k);
      expect(e, `${name}: stage and the risk words as before`).toMatchObject({ stage: extra['stage'], risk_band: 'LOW', risk_reason: 'Everything agrees.', employee_id: id });
    }
    const other = call('getEmployee', 'agentA', { path: `/agent/v1/employees/${P.bea.id}`, route: '/agent/v1/employees/{id}', pathParameters: { id: P.bea.id } });
    expect(statusOf(other), 'company B\'s person: 404 for the agent of A').toBe(404);
    expect(bodyOf(other), 'with the usual words').toEqual({ error: 'Not found' });
    expect(JSON.stringify(other.response), 'and nothing of B\'s person').not.toMatch(/Bea|Ngcobo|baker-b/);
  });

  test('AC-1 The MCP server passes list_verifications (waiting), get_employee, the summary and the risk check through (handler)', async ({}, testInfo) => {
    once(testInfo);
    test.setTimeout(8 * 60_000);
    const b = mcpBundle();
    expect(b.built, `CI builds nalekoMcpServer: python3 scripts/ci/build-lambdas.py nalekoMcpServer makes dist/lambdas/nalekoMcpServer.zip (${b.log})`).toBe(true);
    const KEY = 'k-live-one';
    const empId = '3f1a7c52-0001-4d7e-9a11-aaaaaaaa0001';
    const verId = '9a1f0000-0001-4d7e-9a11-aaaaaaaa0001';
    const waiting = { items: [{ document_id: D.nomsaBank, employee_id: empId, employee_name: 'Nomsa Dlamini', document_type: 'BANK_CONFIRMATION', check: 'MATCHES', arrived_at: ISO(11) }], count: 1, counts: { READING: 0, MATCHES: 1, NEEDS_A_LOOK: 0, DOESNT_MATCH: 0 } };
    const emp = { employee: { employee_id: empId, stage: 'DOCUMENTS_SUBMITTED', step: 'IN_REVIEW', first_name: 'Nomsa' } };
    const rpc = (id: number, method: string, params?: unknown) => ({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
    const steps: Step[] = [
      { fetch: { keys: [KEY], rules: [
        { url: '/agent/v1/verifications?', json: waiting }, { url: `/agent/v1/employees/${empId}/assess-risk`, json: { risk_band: 'LOW' } },
        { url: `/agent/v1/employees/${empId}`, json: emp }, { url: `/agent/v1/verifications/${verId}/summary`, json: { summary: 'Fine.' } },
      ] } },
      { call: mcpEvent(rpc(1, 'tools/list'), KEY) },
      { call: mcpEvent(rpc(2, 'tools/call', { name: 'list_verifications', arguments: { waiting: true } }), KEY) },
      { call: mcpEvent(rpc(3, 'tools/call', { name: 'get_employee', arguments: { id: empId } }), KEY) },
      { call: mcpEvent(rpc(4, 'tools/call', { name: 'get_verification_summary', arguments: { id: verId } }), KEY) },
      { call: mcpEvent(rpc(5, 'tools/call', { name: 'assess_employee_risk', arguments: { id: empId } }), KEY) },
    ];
    const run = runSteps('mcp', b.handlerFile, steps, { secrets: { [AGENT_SECRET]: { AWSCURRENT: KEY } } }, {}, b.dir);
    expect(run.error?.message, 'the MCP handler ran').toBeUndefined();
    const [listed, waitingAns, empAns, sumAns, riskAns] = run.answers;
    const names = (rpcOf(listed!)?.result?.tools ?? []).map((t: any) => t.name);
    for (const n of ['list_verifications', 'get_employee', 'get_verification_summary', 'assess_employee_risk']) expect(names, `${n} is listed`).toContain(n);
    const payload = (a: Answer) => { try { return JSON.parse(rpcOf(a)?.result?.content?.[0]?.text ?? 'null'); } catch { return undefined; } };
    expect(payload(waitingAns!), 'list_verifications {waiting: true} answers what the agent API answered').toEqual(waiting);
    const w = httpIn(run, waitingAns!);
    expect(w.map((c) => `${c.method} ${new URL(c.url).pathname}`), 'one GET on the agent API\'s verifications').toEqual(['GET /agent/v1/verifications']);
    expect(new URL(w[0]!.url).searchParams.get('waiting'), 'asking for the waiting documents').toBe('true');
    expect(w[0]!.headers['x-api-key'], 'with the key').toBe(KEY);
    expect(payload(empAns!), 'get_employee answers the employee with the step').toEqual(emp);
    expect(httpIn(run, empAns!).map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([`GET /agent/v1/employees/${empId}`]);
    expect(payload(sumAns!), 'the summary passes through').toEqual({ summary: 'Fine.' });
    expect(httpIn(run, sumAns!).map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([`GET /agent/v1/verifications/${verId}/summary`]);
    expect(payload(riskAns!), 'the risk check passes through').toEqual({ risk_band: 'LOW' });
    expect(httpIn(run, riskAns!).map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([`POST /agent/v1/employees/${empId}/assess-risk`]);
  });

  // ---------------------------------------------------------------------------------------------- AC-2

  test('AC-2 An agent proposes Accept document: one waiting proposal, nothing decided, the creation published (Lambda)', async ({}, testInfo) => {
    once(testInfo);
    const before = tables();
    const r = propose('agentA', accept(D.nomsaBank), before);
    expect(statusOf(r), `201 (${describe(r)})`).toBe(201);
    const body = bodyOf(r);
    expect(body, 'the answer').toMatchObject({ status: 'PENDING_APPROVAL', type: 'ACCEPT_DOCUMENT', document_id: D.nomsaBank, employee_id: P.nomsa.id });
    expect(typeof body.action_id, 'with its id').toBe('string');
    expect(body.action_id, 'a real id').not.toBe('');
    const rows = rowsOf(r.tables, 'naleko-pending-actions');
    expect(rows.length, 'one row in the pending table').toBe(1);
    const stored = rows[0]!;
    expect(stored, 'the row as decision 7 says').toMatchObject({
      actionId: body.action_id, type: 'ACCEPT_DOCUMENT', document_id: D.nomsaBank, employee_id: P.nomsa.id, employee_name: 'Nomsa Dlamini', document_type: 'BANK_CONFIRMATION',
      check: 'MATCHES', proposed_by_kind: 'AGENT', proposed_by_id: 'default', status: 'PENDING_APPROVAL', tenant_id: A,
    });
    expect(typeof stored['expiresAt'], 'expiresAt is epoch seconds (the table\'s TTL)').toBe('number');
    const week = 7 * 86400;
    expect(Math.abs((stored['expiresAt'] as number) - (Math.floor(Date.now() / 1000) + week)), 'the proposal lives 7 days').toBeLessThan(3600);
    expect(Math.abs(Date.parse(String(stored['createdAt'])) - Date.now()), 'createdAt is now (an ISO time)').toBeLessThan(10 * 60_000);
    for (const k of ['approved_by', 'approved_by_name', 'approved_at', 'rejected_by']) expect(stored, `no ${k} yet`).not.toHaveProperty(k);
    for (const t of ['employees', 'documents', 'document-verification']) {
      expect(writesTo(r.calls, t), `no write to ${t}`).toEqual([]);
      expect(rowsOf(r.tables, t), `${t} unchanged`).toEqual(rowsOf(before, t));
    }
    const created = eventOf(r, 'proposal.created');
    expect(created.length, 'proposal.created is published once').toBe(1);
    expect(created[0], 'by the agent, for company A').toMatchObject({ actor: 'AGENT', tenant_id: A, document_id: D.nomsaBank, employee_id: P.nomsa.id });
    expect(publishedOf(r.calls).map((c) => c.detailType), 'and nothing else is published (no decision event)').toEqual(['proposal.created']);
    expect(JSON.stringify(created), 'no file name, no link in the event').not.toMatch(/letter\.pdf|uploads\/|s3/i);
    expect(auditRows(r.tables).map((a) => `${a['detailType']} ${a['actor']}`), 'the audit table holds it, tagged AGENT').toEqual(['proposal.created AGENT']);
    expect(bedrockOf(r.calls), 'no AI call').toEqual([]);
    // ONB-22.1 (M-2): no idempotency table. The open-proposal check (decision 14) is what stops a second proposal, so an Idempotency-Key
    // changes nothing: the same key twice is a 201 and then a 409 that names the first, and the table is never touched.
    const k = { 'idempotency-key': 'onb22-key-0001' };
    const first = propose('agentA', accept(D.nomsaBank), tables(), { headers: k });
    expect(statusOf(first), 'the first call with a key: 201').toBe(201);
    const second = propose('agentA', accept(D.nomsaBank), first.tables, { headers: k });
    expect(statusOf(second), `the same key again: 409 with the first one's id (${describe(second)})`).toBe(409);
    expect(bodyOf(second), 'it names the first proposal').toMatchObject({ action_id: bodyOf(first).action_id });
    expect(rowsOf(second.tables, 'naleko-pending-actions').length, 'still one row').toBe(1);
    expect(publishedOf(second.calls), 'and no second event').toEqual([]);
    for (const run of [r, first, second]) expect(awsCalls(run.calls).filter((c) => /idempotency/i.test(c)), 'createProposal reads and writes no idempotency table').toEqual([]);
  });

  test('AC-2 A proposal is refused: another type, extra keys, no id; another company\'s or unknown document; a document that is not waiting with a Matches check', async ({}, testInfo) => {
    once(testInfo);
    const nothing = (name: string, r: Run) => {
      expect(rowsOf(r.tables, 'naleko-pending-actions'), `${name}: no proposal written`).toEqual([]);
      expect(publishedOf(r.calls), `${name}: no event`).toEqual([]);
      expect(r.error, `${name}: the Lambda answered`).toBeUndefined();
    };
    for (const type of ['APPROVE_DOCUMENT', 'ASK_FOR_A_NEW_ONE', 'DECLINE_DOCUMENT', 'accept_document', '', 'ACCEPT_DOCUMENT ']) {
      const r = propose('agentA', { type, document_id: D.nomsaBank });
      expect(statusOf(r), `type "${type}": 400 (${describe(r)})`).toBe(400);
      expect(bodyOf(r), `type "${type}": { "error": "Unknown proposal" }`).toEqual({ error: 'Unknown proposal' });
      nothing(`type "${type}"`, r);
    }
    for (const [name, body] of [
      ['an extra key', { type: 'ACCEPT_DOCUMENT', document_id: D.nomsaBank, note: 'please' }],
      ['an extra key that names a company', { type: 'ACCEPT_DOCUMENT', document_id: D.nomsaBank, tenant_id: B }],
      ['an extra key that names an approver', { type: 'ACCEPT_DOCUMENT', document_id: D.nomsaBank, approved_by: HR.a.email }],
      ['no document id', { type: 'ACCEPT_DOCUMENT' }],
      ['a document id that is not text', { type: 'ACCEPT_DOCUMENT', document_id: 12 }],
      ['an empty document id', { type: 'ACCEPT_DOCUMENT', document_id: '' }],
      ['no body', ''],
      ['a body that is not JSON', '{not json'],
    ] as [string, unknown][]) {
      const r = propose('agentA', body);
      expect(statusOf(r), `${name}: 400 (${describe(r)})`).toBe(400);
      nothing(name, r);
    }
    // Another company's document and an unknown one are the same: 404, no row, no event.
    for (const [name, caller, doc] of [['company B\'s document', 'agentA', D.bea], ['an unknown document', 'agentA', 'dd000000-9999-4d7e-9a11-aaaaaaaa9999'], ['company A\'s document as the agent of B', 'agentB', D.nomsaBank]] as [string, Caller, string][]) {
      const r = propose(caller, accept(doc));
      expect(statusOf(r), `${name}: 404 (${describe(r)})`).toBe(404);
      expect(bodyOf(r), `${name}: the usual words`).toEqual({ error: 'Not found' });
      nothing(name, r);
      expect(JSON.stringify(r.response), `${name}: nothing of the other company`).not.toMatch(/Bea|Ngcobo|Nomsa|Dlamini/);
    }
    // 409: being read, already decided, check not Matches.
    for (const [name, doc] of [['a document still being read', D.lerato], ['a document HR already decided (accepted)', D.zanele], ['a document HR accepted earlier on the same person', D.nomsaId], ['a check that Needs a look', D.thabo], ['a check that Doesn\'t match', D.piet]] as [string, string][]) {
      const r = propose('agentA', accept(doc));
      expect(statusOf(r), `${name}: 409 (${describe(r)})`).toBe(409);
      nothing(name, r);
    }
    // A decided document stays refused when its check is Matches; a verification row with no check field reads by its confidence (checkOf).
    const lowConfidence = tables();
    lowConfidence['document-verification'] = lowConfidence['document-verification']!.map((v) => (plain(v)['verificationId'] === V(D.nomsaBank) ? row({ ...plain(v) as any, check: undefined, confidence: 61 }) : v));
    const low = propose('agentA', accept(D.nomsaBank), lowConfidence);
    expect(statusOf(low), `a read with no stored check and confidence 61 reads as Needs a look: 409 (${describe(low)})`).toBe(409);
    nothing('low confidence', low);
  });

  test('AC-2 A second open proposal for the same document is a 409 with the first one\'s id; a declined or expired one does not block (Lambda)', async ({}, testInfo) => {
    once(testInfo);
    const open = pending({ id: 'act-open-0001' });
    const dup = propose('agentA', accept(D.nomsaBank), withPending([open]));
    expect(statusOf(dup), `409 (${describe(dup)})`).toBe(409);
    expect(bodyOf(dup).action_id, 'with the first one\'s id').toBe('act-open-0001');
    expect(rowsOf(dup.tables, 'naleko-pending-actions').length, 'no second row').toBe(1);
    expect(publishedOf(dup.calls), 'no event').toEqual([]);
    for (const [name, old] of [['a declined one', pending({ id: 'act-old-0001', status: 'REJECTED' })], ['an expired one', pending({ id: 'act-old-0002', expires: inDays(-1) })]] as const) {
      const r = propose('agentA', accept(D.nomsaBank), withPending([old]));
      expect(statusOf(r), `${name} does not block (${describe(r)})`).toBe(201);
      expect(rowsOf(r.tables, 'naleko-pending-actions').length, `${name}: the new row is the second`).toBe(2);
    }
    // Another company's open proposal for a made-up same id is not seen: B's agent proposing B's document is its own.
    const b = propose('agentB', accept(D.bea), withPending([open]));
    expect(statusOf(b), `company B's agent proposes B's document (${describe(b)})`).toBe(201);
    expect(rowsOf(b.tables, 'naleko-pending-actions').find((x) => x['actionId'] !== 'act-open-0001')?.['tenant_id'], 'stamped with B').toBe(B);
  });

  test('AC-2 Only HR answers a proposal: the agent key, an employee, hr_staff_readonly, a manager and an access token are refused before any table is read; HR of A lists A\'s, HR of B none of A\'s', async ({}, testInfo) => {
    once(testInfo);
    const t = withPending([pending({ id: 'act-a-0001' }), pending({ id: 'act-b-0001', doc: D.bea, emp: P.bea.id, name: 'Bea Ngcobo', tenant: B })]);
    const refusedFor: Caller[] = ['agentA', 'agentB', 'employeeA', 'hrReadonlyA', 'managerA', 'accessTokenA'];
    for (const caller of refusedFor) {
      for (const [name, r] of [
        ['lists', listActions(caller, t)], ['approves', decide('approve', caller, 'act-a-0001', t)], ['declines', decide('reject', caller, 'act-a-0001', t)],
        ['approves with a body that names an approver', decide('approve', caller, 'act-a-0001', t, { staffId: 'HRA001', approved_by: HR.a.email })],
      ] as [string, Run][]) {
        expect(statusOf(r), `${caller} ${name}: 403 (${describe(r)})`).toBe(403);
        expect(bodyOf(r), `${caller} ${name}: { "error": "Only HR can answer a proposal" }`).toEqual({ error: 'Only HR can answer a proposal' });
        expect(awsCalls(r.calls), `${caller} ${name}: no table, no event, no invoke: refused before anything is read`).toEqual([]);
        expect(rowsOf(r.tables, 'naleko-pending-actions'), `${caller} ${name}: the proposal is unchanged`).toEqual(rowsOf(t, 'naleko-pending-actions'));
      }
    }
    const noTenant = listActions('noTenantHr', t);
    expect(statusOf(noTenant), 'an HR sign-in with no company: 403').toBe(403);
    expect(awsCalls(noTenant.calls), 'and nothing read').toEqual([]);
    const mine = listActions('hrA', t);
    expect(statusOf(mine), `HR of A lists (${describe(mine)})`).toBe(200);
    expect((bodyOf(mine).items as any[]).map((i) => i.action_id), 'exactly A\'s proposals').toEqual(['act-a-0001']);
    expect(bodyOf(mine).count, 'count').toBe(1);
    const theirs = listActions('hrB', t);
    expect((bodyOf(theirs).items as any[]).map((i) => i.action_id), 'HR of B sees only B\'s').toEqual(['act-b-0001']);
    expect(JSON.stringify(bodyOf(theirs)), 'and nothing of A\'s').not.toMatch(/Nomsa|Dlamini|act-a-0001/);
  });

  test('AC-2 HR\'s list: open first and newest first, then the last 20 decided; each item has the fields HR needs and no file link (Lambda)', async ({}, testInfo) => {
    once(testInfo);
    const rows = [
      pending({ id: 'act-open-old', created: ISO(15) }), pending({ id: 'act-open-new', created: ISO(17), doc: D.siphoId, emp: P.sipho.id, name: 'Sipho Khumalo', docType: 'NATIONAL_ID' }),
      ...Array.from({ length: 25 }, (_v, i) => pending({
        id: `act-done-${String(i).padStart(2, '0')}`, created: `2026-10-${String(i + 1).padStart(2, '0')}T08:00:00.000Z`, status: i % 2 ? 'REJECTED' : 'APPROVED', run: i % 2 ? undefined : 'RAN',
        ...(i % 2 ? {} : { approvedBy: HR.a2.email, approvedByName: 'Pieter Van Wyk', approvedAt: `2026-10-${String(i + 1).padStart(2, '0')}T09:00:00.000Z` }),
      })),
    ];
    const r = listActions('hrA', withPending(rows));
    expect(statusOf(r), `200 (${describe(r)})`).toBe(200);
    const items = bodyOf(r).items as any[];
    expect(items.slice(0, 2).map((i) => i.action_id), 'the two open ones first, newest first').toEqual(['act-open-new', 'act-open-old']);
    expect(items.length, 'two open and the last 20 decided').toBe(22);
    expect(bodyOf(r).count, 'count is the number of items').toBe(22);
    const decided = items.slice(2).map((i) => i.action_id);
    expect(decided, 'the 20 decided are the newest 20 (act-done-05 to act-done-24), newest first').toEqual(Array.from({ length: 20 }, (_v, i) => `act-done-${String(24 - i).padStart(2, '0')}`));
    expect(items[0], 'an open item').toMatchObject({
      action_id: 'act-open-new', type: 'ACCEPT_DOCUMENT', status: 'PENDING_APPROVAL', document_id: D.siphoId, employee_id: P.sipho.id, employee_name: 'Sipho Khumalo', document_type: 'NATIONAL_ID', check: 'MATCHES',
      proposed_by: { kind: 'AGENT', id: 'default' }, created_at: ISO(17),
    });
    expect(items[0], 'and when it expires').toHaveProperty('expires_at');
    const approved = items.find((i) => i.action_id === 'act-done-24')!;
    expect(approved, 'a decided item names who and when').toMatchObject({ status: 'APPROVED', run_status: 'RAN', approved_by_name: 'Pieter Van Wyk', approved_at: '2026-10-25T09:00:00.000Z' });
    expect(JSON.stringify(items), 'no file link, no number, no file name').not.toMatch(/uploads\/|s3_key|s3|letter\.pdf|toolArgs/);
    const listKeys = ['action_id', 'type', 'status', 'run_status', 'error_code', 'document_id', 'employee_id', 'employee_name', 'document_type', 'check', 'proposed_by', 'created_at', 'expires_at', 'approved_by_name', 'approved_at', 'rejected_by_name', 'rejected_at'];
    expect(items.flatMap((i) => Object.keys(i).filter((k) => !listKeys.includes(k)).map((k) => `${i.action_id}.${k}`)), 'only the keys the spec lists on every item: no file link, no number, nothing else').toEqual([]);
    const own = getAction('agentA', 'act-open-new', withPending(rows));
    expect(statusOf(own), `the agent reads the status of its own proposal (${describe(own)})`).toBe(200);
    const allowed = ['action_id', 'type', 'document_id', 'status', 'run_status', 'created_at', 'decided_at'];
    expect(Object.keys(bodyOf(own)).filter((k) => !allowed.includes(k)), 'only the fields the spec lists: no names, no emails, no check').toEqual([]);
    expect(bodyOf(own), 'and the ones that matter').toMatchObject({ action_id: 'act-open-new', type: 'ACCEPT_DOCUMENT', document_id: D.siphoId, status: 'PENDING_APPROVAL' });
    expect(JSON.stringify(bodyOf(own)), 'no name or email').not.toMatch(/Sipho|Khumalo|@/);
    const other = getAction('agentB', 'act-open-new', withPending(rows));
    expect(statusOf(other), 'the agent of B asking for A\'s proposal: 404').toBe(404);
  });

  test('AC-2 No tool decides, declines, approves, sends, shows a number or creates an employee (text)', async ({}, testInfo) => {
    once(testInfo);
    const manifest = JSON.parse(text('api/agent-tools.json')) as { tools: { name: string; method: string; path: string }[] };
    const BAD = /accept(?!_document$)|approve|decline|reject|decide|review|send|notify|email|create|onboard|number|download|link|url/i;
    for (const t of manifest.tools) {
      if (t.name === 'propose_accept_document') continue;
      expect(t.name, `manifest tool ${t.name} is not a decision, a send or a creation`).not.toMatch(BAD);
    }
    for (const t of manifest.tools) {
      expect(`${t.method} ${t.path}`, `manifest tool ${t.name}: its route is a read, or the proposal itself`).toMatch(/^(GET \/(employees|verifications|audit-log|actions)|POST \/(employees\/\{id\}\/assess-risk|proposals$))/);
      expect(`${t.method} ${t.path}`, `manifest tool ${t.name} does not reach the approve or decline routes`).not.toMatch(/\/(approve|reject)\b/);
    }
    // The MCP server's own source (every file that is deployed): tool names and the routes it calls.
    const b = mcpBundle();
    expect(b.built, `the MCP server builds (${b.log})`).toBe(true);
    const names = readdirSync(b.dir).filter((f) => /\.(mjs|js)$/.test(f));
    const src = names.map((f) => readFileSync(join(b.dir, f), 'utf8')).join('\n');
    const registered = [...src.matchAll(/\.tool\(\s*['"]([a-z_]+)['"]/g)].map((m) => m[1]!);
    expect(registered.length, 'the server registers its tools with server.tool(name, ...)').toBeGreaterThan(5);
    for (const n of registered) if (n !== 'propose_accept_document') expect(n, `MCP tool ${n}`).not.toMatch(BAD);
    expect(src, 'the MCP server never calls the approve or decline routes').not.toMatch(/\/actions\/[^'"`]*\/(approve|reject)|\/(approve|reject)['"`]/);
    // Ask Batsi's tool table: nothing writes a proposal or decides a document.
    const resolver = text('lambda/nalekoAiChat/tool-resolver.mjs');
    const table = /export const TOOL_MAP = \{([\s\S]*?)\n\};/.exec(resolver)?.[1] ?? '';
    expect(table.length, 'TOOL_MAP is in tool-resolver.mjs').toBeGreaterThan(50);
    expect([...table.matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]).filter((n) => /accept|approve|decline|reject|decide|propos|review/i.test(n!)), 'no TOOL_MAP tool is named like a decision or a proposal').toEqual([]);
    expect(table, 'and none calls the proposal, the approve or the review routes').not.toMatch(/\/proposals|\/actions|\/review|\/approve|\/reject|reviewDocument/);
  });

  // ---------------------------------------------------------------------------------------------- AC-3

  const approveNomsa = (extraBody?: unknown, caller: Caller = 'hrA', over: Partial<{ id: string; t: Tables }> = {}) => {
    const id = over.id ?? 'act-onb22-0001';
    const t = over.t ?? withPending([pending({ id })]);
    return { id, t, run: decide('approve', caller, id, t, extraBody) };
  };

  test('AC-3 HR approves: the real review runs as that person, Verified when the rule says, and both names are recorded (Lambda)', async ({}, testInfo) => {
    once(testInfo);
    const { id, t, run } = approveNomsa();
    expect(statusOf(run), `200 (${describe(run)})`).toBe(200);
    expect(bodyOf(run), 'approved and run').toMatchObject({ status: 'APPROVED', run_status: 'RAN' });
    expect(bodyOf(run).error_code ?? null, 'no error code').toBeNull();
    const doc = docRow(run.tables, P.nomsa.id, D.nomsaBank)!;
    expect(doc, 'the document is PASSED with this HR person\'s email and name, and the time').toMatchObject({ ocr_status: 'PASSED', hr_reviewed_by: HR.a.email, hr_reviewed_by_name: 'Thandi Mokoena' });
    expect(Math.abs(Date.parse(String(doc['hr_reviewed_at'])) - Date.now()), 'decided now').toBeLessThan(10 * 60_000);
    expect(find(run.tables, 'document-verification', { verificationId: V(D.nomsaBank) }), 'the verification is PASSED too').toMatchObject({ decision: 'PASSED' });
    expect(empRow(run.tables, P.nomsa.id), 'Nomsa has both required documents accepted: Verified (ONB-08\'s rule, by the real review Lambda)').toMatchObject({ stage: 'VERIFIED', step: 'VERIFIED' });
    const reviewed = eventOf(run, 'document.reviewed');
    expect(reviewed.length, 'document.reviewed once').toBe(1);
    expect(reviewed[0], 'it names the same person').toMatchObject({ decision: 'PASSED', decided_by: HR.a.email, decided_by_name: 'Thandi Mokoena', document_id: D.nomsaBank, employee_id: P.nomsa.id, tenant_id: A });
    expect(publishedOf(run.calls).map((c) => c.detailType), 'the events, in order').toEqual(['document.reviewed', 'employee.stage_changed', 'onboarding.completed', 'proposal.approved']);
    const done = eventOf(run, 'proposal.approved')[0];
    expect(done, 'proposal.approved holds who proposed and who approved').toMatchObject({
      action_id: id, type: 'ACCEPT_DOCUMENT', proposed_by: { kind: 'AGENT', id: 'default' }, approved_by: HR.a.email, approved_by_name: 'Thandi Mokoena', document_id: D.nomsaBank, employee_id: P.nomsa.id,
      run_status: 'RAN', actor: 'HUMAN', tenant_id: A,
    });
    expect(Number.isFinite(Date.parse(String(done?.at))), 'with the time').toBe(true);
    expect(JSON.stringify(done), 'no file name, no number, no free text').not.toMatch(/letter\.pdf|uploads\/|s3/i);
    const stored = actionRow(run.tables, id)!;
    expect(stored, 'the proposal row').toMatchObject({ status: 'APPROVED', approved_by: HR.a.email, approved_by_name: 'Thandi Mokoena', run_status: 'RAN' });
    expect(Number.isFinite(Date.parse(String(stored['approved_at']))), 'approved_at is a time').toBe(true);
    // The invoke: synchronous, the review Lambda by its setting, the approver's claims, PASSED, the id as the key.
    const invokes = invokesOf(run.calls);
    expect(invokes.length, 'one invoke').toBe(1);
    expect(invokes[0]!['functionName'], 'the review Lambda, named by REVIEW_FUNCTION_NAME (not a constant in the code)').toBe(REVIEW_NAME);
    expect(['RequestResponse', undefined], 'synchronously').toContain(invokes[0]!['invocationType'] === 'RequestResponse' ? 'RequestResponse' : invokes[0]!['invocationType']);
    const ev = invokes[0]!['payload'];
    const claims = ev?.requestContext?.authorizer?.jwt?.claims ?? {};
    expect(claims, 'with a copy of the approver\'s own verified claims').toMatchObject({ sub: HR.a.sub, email: HR.a.email, given_name: 'Thandi', family_name: 'Mokoena', tenant_id: A, token_use: 'id' });
    expect(String(claims['cognito:groups']), 'hr_staff').toContain('hr_staff');
    expect(JSON.parse(ev.body), 'PASSED for the document\'s employee').toMatchObject({ decision: 'PASSED', employee_id: P.nomsa.id });
    expect(ev.pathParameters?.id, 'for this document').toBe(D.nomsaBank);
    const key = Object.entries(ev.headers ?? {}).find(([k]) => k.toLowerCase() === 'idempotency-key')?.[1];
    expect(key, 'the Idempotency-Key is the action id').toBe(id);
    expect(find(run.tables, 'naleko-idempotency-keys', { idempotencyKey: `TENANT#${A}#${id}` }), 'and the real review stored it for this company, under that key').toMatchObject({ status: 'COMPLETE' });
    expect(bedrockOf(run.calls), 'no AI call').toEqual([]);
    expect(httpOf(run.calls), 'the approve call never calls the agent API (no tool-execute) and no outside host').toEqual([]);
    expect(run.calls.filter((c) => c.service === 'secretsmanager'), 'and never reads the agent key').toEqual([]);
    // The audit table, written by the real consumer, holds both.
    const audit = auditRows(run.tables).map((a) => `${a['detailType']} ${a['actor']}`);
    expect(audit, 'the audit log: the review and the approval, both by a person').toEqual(expect.arrayContaining(['document.reviewed HUMAN', 'proposal.approved HUMAN']));
    void t;
  });

  test('AC-3 The approver is the token\'s person only: a body naming someone else changes nothing (Lambda)', async ({}, testInfo) => {
    once(testInfo);
    const { id, run } = approveNomsa({ staffId: 'HRX999', approved_by: 'mallory@baker-a.example', approved_by_name: 'Mallory', decided_by: 'mallory@baker-a.example', employee_id: P.sipho.id, document_id: D.siphoId, decision: 'FAILED', tenant_id: B }, 'hrA2');
    expect(statusOf(run), `200 (${describe(run)})`).toBe(200);
    expect(docRow(run.tables, P.nomsa.id, D.nomsaBank), 'the document of the proposal, decided by the person who signed in').toMatchObject({ ocr_status: 'PASSED', hr_reviewed_by: HR.a2.email, hr_reviewed_by_name: 'Pieter Van Wyk' });
    expect(actionRow(run.tables, id), 'the row').toMatchObject({ approved_by: HR.a2.email, approved_by_name: 'Pieter Van Wyk', run_status: 'RAN', tenant_id: A });
    expect(docRow(run.tables, P.sipho.id, D.siphoId), 'another document is not touched').toMatchObject({ ocr_status: 'MANUAL_REVIEW' });
    expect(JSON.stringify([...invokesOf(run.calls), ...publishedOf(run.calls)]), 'nothing the body said reaches the review or the events').not.toMatch(/mallory|Mallory|HRX999/);
  });

  test('AC-3 A second approve is a 409 and runs nothing; two at once run once (Lambda)', async ({}, testInfo) => {
    once(testInfo);
    const { id, run } = approveNomsa();
    expect(statusOf(run)).toBe(200);
    const again = decide('approve', 'hrA2', id, run.tables);
    expect(statusOf(again), `409 (${describe(again)})`).toBe(409);
    expect(bodyOf(again), 'with the current status and run status').toMatchObject({ status: 'APPROVED', run_status: 'RAN' });
    expect(invokesOf(again.calls), 'nothing runs').toEqual([]);
    expect(publishedOf(again.calls), 'nothing is published').toEqual([]);
    expect(rowsOf(again.tables, 'documents'), 'nothing is written to a document').toEqual(rowsOf(run.tables, 'documents'));
    const t = withPending([pending({ id: 'act-race-0001' })]);
    const both = callTogether('approveAgentAction', [eventFor('hrA', { method: 'POST', path: '/agent/v1/actions/act-race-0001/approve', route: '/agent/v1/actions/{actionId}/approve', pathParameters: { actionId: 'act-race-0001' } }), eventFor('hrA2', { method: 'POST', path: '/agent/v1/actions/act-race-0001/approve', route: '/agent/v1/actions/{actionId}/approve', pathParameters: { actionId: 'act-race-0001' } })], { tables: t });
    expect(both.error, 'the container answered both').toBeUndefined();
    expect([statusOf(both, 0), statusOf(both, 1)].sort(), 'one winner, one 409').toEqual([200, 409]);
    expect(invokesOf(both.calls).length, 'the decision ran once').toBe(1);
    expect(eventOf(both, 'document.reviewed').length, 'one decision event').toBe(1);
    expect(eventOf(both, 'proposal.approved').length, 'one approval event').toBe(1);
  });

  test('AC-3 Company B: HR of B answering A\'s proposal is a 404 with nothing run; each company approves its own (Lambda)', async ({}, testInfo) => {
    once(testInfo);
    const t = withPending([pending({ id: 'act-a-0001' }), pending({ id: 'act-b-0001', doc: D.bea, emp: P.bea.id, name: 'Bea Ngcobo', docType: 'NATIONAL_ID', tenant: B })]);
    for (const verb of ['approve', 'reject'] as const) {
      const r = decide(verb, 'hrB', 'act-a-0001', t);
      expect(statusOf(r), `${verb} A's proposal as HR of B: 404 (${describe(r)})`).toBe(404);
      expect(bodyOf(r), `${verb}: the usual words`).toEqual({ error: 'Not found' });
      expect(invokesOf(r.calls), `${verb}: nothing run`).toEqual([]);
      expect(publishedOf(r.calls), `${verb}: nothing published`).toEqual([]);
      expect(writesOf(r.calls), `${verb}: nothing written`).toEqual([]);
      expect(rowsOf(r.tables, 'naleko-pending-actions'), `${verb}: the row is unchanged`).toEqual(rowsOf(t, 'naleko-pending-actions'));
    }
    const rev = decide('approve', 'hrA', 'act-b-0001', t);
    expect(statusOf(rev), 'HR of A answering B\'s proposal: 404').toBe(404);
    expect(invokesOf(rev.calls), 'nothing run').toEqual([]);
    const own = decide('approve', 'hrB', 'act-b-0001', t);
    expect(statusOf(own), `HR of B approves B's own (${describe(own)})`).toBe(200);
    expect(docRow(own.tables, P.bea.id, D.bea), 'decided by B\'s HR person').toMatchObject({ ocr_status: 'PASSED', hr_reviewed_by: HR.b.email });
    expect(actionRow(own.tables, 'act-a-0001'), 'A\'s row is untouched').toMatchObject({ status: 'PENDING_APPROVAL' });
    expect(eventOf(own, 'proposal.approved')[0], 'B\'s event carries B').toMatchObject({ tenant_id: B, approved_by: HR.b.email });
  });

  test('AC-3 Decline records who and nothing runs; a declined or expired proposal cannot be approved (Lambda)', async ({}, testInfo) => {
    once(testInfo);
    const t = withPending([pending({ id: 'act-onb22-0001' })]);
    const r = decide('reject', 'hrA', 'act-onb22-0001', t, { staffId: 'HRX999', rejected_by: 'mallory@baker-a.example' });
    expect(statusOf(r), `200 (${describe(r)})`).toBe(200);
    expect(bodyOf(r), 'declined').toMatchObject({ status: 'REJECTED' });
    expect(actionRow(r.tables, 'act-onb22-0001'), 'the row says who and when').toMatchObject({ status: 'REJECTED', rejected_by: HR.a.email });
    expect(Number.isFinite(Date.parse(String(actionRow(r.tables, 'act-onb22-0001')!['rejected_at']))), 'rejected_at is a time').toBe(true);
    expect(invokesOf(r.calls), 'nothing runs').toEqual([]);
    expect(rowsOf(r.tables, 'documents'), 'no document changes').toEqual(rowsOf(t, 'documents'));
    expect(publishedOf(r.calls).map((c) => c.detailType), 'proposal.rejected only').toEqual(['proposal.rejected']);
    expect(eventOf(r, 'proposal.rejected')[0], 'by a person, for A').toMatchObject({ action_id: 'act-onb22-0001', actor: 'HUMAN', tenant_id: A, document_id: D.nomsaBank, employee_id: P.nomsa.id });
    expect(JSON.stringify(r.calls.filter((c) => c.service === 'events')), 'the body\'s names reach nothing').not.toMatch(/mallory|HRX999/i);
    const later = decide('approve', 'hrA', 'act-onb22-0001', r.tables);
    expect(statusOf(later), 'approving a declined proposal: 409').toBe(409);
    expect(bodyOf(later), 'it says where it stands').toMatchObject({ status: 'REJECTED' });
    expect(invokesOf(later.calls), 'nothing runs').toEqual([]);
    const gone = decide('approve', 'hrA', 'act-old-0001', withPending([pending({ id: 'act-old-0001', expires: inDays(-0.5) })]));
    expect(statusOf(gone), `an expired proposal cannot be approved: 409 (${describe(gone)})`).toBe(409);
    expect(invokesOf(gone.calls), 'nothing runs').toEqual([]);
    expect(docRow(gone.tables, P.nomsa.id, D.nomsaBank), 'the document is still waiting').toMatchObject({ ocr_status: 'MANUAL_REVIEW' });
    const declineGone = decide('reject', 'hrA', 'act-old-0001', withPending([pending({ id: 'act-old-0001', status: 'APPROVED', run: 'RAN' })]));
    expect(statusOf(declineGone), 'declining a decided proposal: 409').toBe(409);
  });

  test('AC-3 The run ends REFUSED or FAILED with a code, never an exception\'s words, and a document is never decided twice (Lambda)', async ({}, testInfo) => {
    once(testInfo);
    const expectEnd = (name: string, r: Run, run: string, code: string, t: Tables) => {
      expect(statusOf(r), `${name}: 200 (${describe(r)})`).toBe(200);
      expect(bodyOf(r), `${name}: the answer holds the codes`).toMatchObject({ status: 'APPROVED', run_status: run, error_code: code });
      expect(actionRow(r.tables, 'act-onb22-0001'), `${name}: the row holds them`).toMatchObject({ status: 'APPROVED', run_status: run, error_code: code, approved_by: HR.a.email });
      expect(eventOf(r, 'proposal.approved')[0], `${name}: the event holds them`).toMatchObject({ run_status: run, error_code: code, approved_by: HR.a.email });
      noExceptionText(name, r.response, actionRow(r.tables, 'act-onb22-0001'), eventOf(r, 'proposal.approved'), logLines(r.calls));
      void t;
    };
    // Decided by hand since: the real review refuses, the earlier decision stays.
    const handDecided = withPending([pending({ id: 'act-onb22-0001' })]);
    handDecided.documents = handDecided.documents!.map((d) => (plain(d)['document_id'] === D.nomsaBank ? row({ ...(plain(d) as any), ocr_status: 'FAILED', hr_reviewed_at: ISO(13), hr_reviewed_by: HR.a2.email, hr_reviewed_by_name: 'Pieter Van Wyk', can_reupload: true }) : d));
    const a = decide('approve', 'hrA', 'act-onb22-0001', handDecided);
    expectEnd('decided by hand since', a, 'REFUSED', 'ALREADY_DECIDED', handDecided);
    expect(docRow(a.tables, P.nomsa.id, D.nomsaBank), 'the earlier decision stands').toMatchObject({ ocr_status: 'FAILED', hr_reviewed_by: HR.a2.email });
    expect(eventOf(a, 'document.reviewed'), 'no second decision event').toEqual([]);
    // The check changed since: refused before anything is invoked.
    const changed = withPending([pending({ id: 'act-onb22-0001' })]);
    changed['document-verification'] = changed['document-verification']!.map((v) => (plain(v)['verificationId'] === V(D.nomsaBank) ? row({ ...(plain(v) as any), check: 'NEEDS_A_LOOK' }) : v));
    const c = decide('approve', 'hrA', 'act-onb22-0001', changed);
    expectEnd('the check changed', c, 'REFUSED', 'CHECK_CHANGED', changed);
    expect(invokesOf(c.calls), 'CHECK_CHANGED: no invoke').toEqual([]);
    expect(docRow(c.tables, P.nomsa.id, D.nomsaBank), 'the document is not decided').toMatchObject({ ocr_status: 'MANUAL_REVIEW' });
    expect(docRow(c.tables, P.nomsa.id, D.nomsaBank), 'nobody is recorded as having decided').not.toHaveProperty('hr_reviewed_by');
    // Each answer of the review Lambda maps to a code.
    const base = withPending([pending({ id: 'act-onb22-0001' })]);
    expectEnd('the review answers 409', decide('approve', 'hrA', 'act-onb22-0001', base, undefined, { invokeFail: 'status409' }), 'REFUSED', 'ALREADY_DECIDED', base);
    expectEnd('the review answers 404', decide('approve', 'hrA', 'act-onb22-0001', base, undefined, { invokeFail: 'status404' }), 'REFUSED', 'NOT_FOUND', base);
    expectEnd('the review answers 403', decide('approve', 'hrA', 'act-onb22-0001', base, undefined, { invokeFail: 'status403' }), 'REFUSED', 'NOT_ALLOWED', base);
    for (const [name, fail] of [['the review answers 500', 'status500'], ['the review answers 502', 'status502'], ['the review Lambda fails', 'function-error'], ['the call times out', 'throw']] as const) {
      const r = decide('approve', 'hrA', 'act-onb22-0001', base, undefined, { invokeFail: fail });
      expectEnd(name, r, 'FAILED', 'RUN_FAILED', base);
      expect(rowsOf(r.tables, 'documents'), `${name}: no document changed`).toEqual(rowsOf(base, 'documents'));
      const again = decide('approve', 'hrA', 'act-onb22-0001', r.tables);
      expect(statusOf(again), `${name}: it is not retried or approved again: 409`).toBe(409);
      expect(invokesOf(again.calls), `${name}: nothing runs the second time`).toEqual([]);
    }
    // The document is gone: refused with a code (before or at the invoke), nothing decided.
    const gone = withPending([pending({ id: 'act-onb22-0001' })]);
    gone.documents = gone.documents!.filter((d) => plain(d)['document_id'] !== D.nomsaBank);
    const g = decide('approve', 'hrA', 'act-onb22-0001', gone);
    expectEnd('the document is gone', g, 'REFUSED', 'NOT_FOUND', gone);
  });

  // ---- ONB-22.1 (the security review: M-3 and S-1)

  const claimsOfRun = (run: Run) => run.calls.filter((c) => c.service === 'dynamodb' && c.op === 'UpdateItem' && c.table === 'naleko-pending-actions');
  const valuesOf = (c: Run['calls'][number]) => JSON.stringify(c.input?.ExpressionAttributeValues ?? {});

  test('AC-3 The claim writes RUNNING at once, and a decided row is kept 90 days, so the row and the events say what happened even if the Lambda dies mid-run (Lambda)', async ({}, testInfo) => {
    once(testInfo);
    const { id, run } = approveNomsa();
    expect(statusOf(run), `200 (${describe(run)})`).toBe(200);
    const writes = claimsOfRun(run);
    expect(writes.length, 'the claim, then the end of the run').toBeGreaterThanOrEqual(2);
    expect(valuesOf(writes[0]!), 'the claim itself carries run_status RUNNING (one write: approved and running)').toContain('"RUNNING"');
    expect(valuesOf(writes[0]!), 'and who approved').toContain(HR.a.email);
    const stored = actionRow(run.tables, id)!;
    expect(stored, 'the run ended: RAN').toMatchObject({ status: 'APPROVED', run_status: 'RAN' });
    const ninety = 90 * 86400;
    const now = Math.floor(Date.now() / 1000);
    expect(typeof stored['expiresAt'], 'expiresAt stays epoch seconds (the table\'s TTL)').toBe('number');
    expect(Math.abs((stored['expiresAt'] as number) - (now + ninety)), 'an approved row is kept 90 days from the decision').toBeLessThan(3600);
    const declined = decide('reject', 'hrA', 'act-onb22-0001', withPending([pending({ id: 'act-onb22-0001' })]));
    expect(statusOf(declined), 'a decline: 200').toBe(200);
    expect(Math.abs((actionRow(declined.tables, 'act-onb22-0001')!['expiresAt'] as number) - (now + ninety)), 'a declined row is kept 90 days from the decision too').toBeLessThan(3600);
    expect(valuesOf(claimsOfRun(declined)[0]!), 'a decline never says RUNNING').not.toContain('RUNNING');
    // A row that has not been answered keeps its 7 days (the claim only moves the time when it decides).
    const open = rowsOf(withPending([pending({ id: 'act-open-1' })]), 'naleko-pending-actions')[0]!;
    expect(Math.abs((open['expiresAt'] as number) - (now + 7 * 86400)), 'an open row keeps its 7 days').toBeLessThan(3600);
    // The table's tag says what the table now does.
    const tag = /resource "aws_dynamodb_table" "pending_actions" \{[\s\S]*?RetentionDays\s*=\s*"(\d+)"/.exec(text('infra/dynamodb.tf'))?.[1];
    expect(tag, 'the pending table\'s RetentionDays tag says 90').toBe('90');
  });

  test('AC-3 The approval and the decline events are published with one retry; with the bus down the answer is still 200, the row still holds who and what, and the log holds an error name only (Lambda)', async ({}, testInfo) => {
    once(testInfo);
    const failed = (run: Run, type: string) => run.calls.filter((c) => c.service === 'events-failed' && c.detailType === type).length;
    // One failed put, then it works: the event is there once.
    const retry = decide('approve', 'hrA', 'act-onb22-0001', withPending([pending({ id: 'act-onb22-0001' })]), undefined, { eventBridgeFailFirst: 1 });
    expect(statusOf(retry), `approve with one failed put: 200 (${describe(retry)})`).toBe(200);
    expect(bodyOf(retry), 'and run').toMatchObject({ status: 'APPROVED', run_status: 'RAN' });
    expect(failed(retry, 'proposal.approved'), 'one failed put').toBe(1);
    expect(eventOf(retry, 'proposal.approved').length, 'then the retry reaches the bus: the event is published once').toBe(1);
    expect(eventOf(retry, 'proposal.approved')[0], 'with both names').toMatchObject({ approved_by: HR.a.email, proposed_by: { kind: 'AGENT', id: 'default' }, tenant_id: A });
    expect(auditRows(retry.tables).map((a) => a['detailType']), 'and the audit table has it').toContain('proposal.approved');
    const retryReject = decide('reject', 'hrA', 'act-onb22-0001', withPending([pending({ id: 'act-onb22-0001' })]), undefined, { eventBridgeFailFirst: 1 });
    expect(statusOf(retryReject), 'decline with one failed put: 200').toBe(200);
    expect(failed(retryReject, 'proposal.rejected'), 'one failed put').toBe(1);
    expect(eventOf(retryReject, 'proposal.rejected').length, 'the retry reaches the bus').toBe(1);
    // The bus is down for good: one retry and then it stops. Nothing else is lost.
    const down = decide('approve', 'hrA', 'act-onb22-0001', withPending([pending({ id: 'act-onb22-0001' })]), undefined, { eventBridgeDown: 'proposal.' });
    expect(statusOf(down), `approve with the bus down: still 200 (${describe(down)})`).toBe(200);
    expect(bodyOf(down), 'the review ran').toMatchObject({ status: 'APPROVED', run_status: 'RAN' });
    expect(failed(down, 'proposal.approved'), 'one put and one retry, and no loop').toBe(2);
    expect(eventOf(down, 'proposal.approved'), 'nothing reached the bus').toEqual([]);
    expect(actionRow(down.tables, 'act-onb22-0001'), 'the row is the record: who, when, and how the run ended').toMatchObject({ status: 'APPROVED', approved_by: HR.a.email, approved_by_name: 'Thandi Mokoena', run_status: 'RAN' });
    expect(Number.isFinite(Date.parse(String(actionRow(down.tables, 'act-onb22-0001')!['approved_at']))), 'with the time').toBe(true);
    expect(docRow(down.tables, P.nomsa.id, D.nomsaBank), 'the document is decided').toMatchObject({ ocr_status: 'PASSED', hr_reviewed_by: HR.a.email });
    const lines = logLines(down.calls);
    const failLines = lines.filter((l) => /publish_failed/.test(l));
    expect(failLines.length, 'each failed put is logged').toBe(2);
    expect(failLines.join('\n'), 'by error name only').toContain('InternalException');
    expect(lines.join('\n'), 'never the error\'s words').not.toMatch(/fake EventBridge is down/);
    const downReject = decide('reject', 'hrA', 'act-onb22-0001', withPending([pending({ id: 'act-onb22-0001' })]), undefined, { eventBridgeDown: 'proposal.' });
    expect(statusOf(downReject), 'decline with the bus down: still 200').toBe(200);
    expect(actionRow(downReject.tables, 'act-onb22-0001'), 'and the row says who').toMatchObject({ status: 'REJECTED', rejected_by: HR.a.email, rejected_by_name: 'Thandi Mokoena' });
    expect(failed(downReject, 'proposal.rejected'), 'one put and one retry').toBe(2);
  });

  test('AC-3 An HR sign-in whose token has no email cannot approve or decline: 403 before anything is read or run (Lambda)', async ({}, testInfo) => {
    once(testInfo);
    const t = withPending([pending({ id: 'act-onb22-0001' })]);
    for (const caller of ['hrNoEmail', 'hrBlankEmail'] as Caller[]) {
      for (const verb of ['approve', 'reject'] as const) {
        const r = decide(verb, caller, 'act-onb22-0001', t);
        expect(statusOf(r), `${caller} ${verb}: 403 (${describe(r)})`).toBe(403);
        expect(bodyOf(r).error, `${caller} ${verb}: the same words as any other refusal`).toBe('Only HR can answer a proposal');
        expect(awsCalls(r.calls), `${caller} ${verb}: nothing read, nothing run`).toEqual([]);
        expect(rowsOf(r.tables, 'naleko-pending-actions'), `${caller} ${verb}: the proposal is unchanged`).toEqual(rowsOf(t, 'naleko-pending-actions'));
      }
    }
    const ok = decide('approve', 'hrA', 'act-onb22-0001', t);
    expect(statusOf(ok), 'the same proposal, with an email in the token: it works (so the 403 above is the email)').toBe(200);
  });

  test('AC-3 The agent reads the audit log: the proposal, the decision and the approval, with the type and who (Lambda)', async ({}, testInfo) => {
    once(testInfo);
    const made = propose('agentA', accept(D.nomsaBank));
    expect(statusOf(made), `the agent proposes (${describe(made)})`).toBe(201);
    const id = bodyOf(made).action_id as string;
    const approved = decide('approve', 'hrA', id, made.tables);
    expect(statusOf(approved), `HR approves (${describe(approved)})`).toBe(200);
    expect(bodyOf(approved), 'and it ran').toMatchObject({ run_status: 'RAN' });
    const log = call('queryAuditLog', 'agentA', { path: '/agent/v1/audit-log', query: { employeeId: P.nomsa.id } }, { tables: approved.tables });
    expect(statusOf(log), `GET /agent/v1/audit-log?employeeId= answers 200 (${describe(log)})`).toBe(200);
    const events = bodyOf(log).events as any[];
    const byType = (t: string) => events.find((e) => e.eventType === t);
    for (const t of ['proposal.created', 'document.reviewed', 'proposal.approved']) expect(byType(t), `the log holds ${t}, with its eventType filled`).toBeTruthy();
    expect(byType('proposal.created')?.actor, 'the proposal was made by the agent').toBe('AGENT');
    expect(byType('document.reviewed')?.actor, 'the decision by a person').toBe('HUMAN');
    expect(byType('proposal.approved')?.actor, 'the approval by a person').toBe('HUMAN');
    const detail = (e: any) => (typeof e?.detail === 'string' ? JSON.parse(e.detail) : e?.detail);
    expect(detail(byType('proposal.approved')), 'both names: the agent that proposed and the person who approved').toMatchObject({ proposed_by: { kind: 'AGENT', id: 'default' }, approved_by: HR.a.email, approved_by_name: 'Thandi Mokoena' });
    expect(detail(byType('document.reviewed')), 'the decision names the same person').toMatchObject({ decided_by_name: 'Thandi Mokoena' });
    const b = call('queryAuditLog', 'agentB', { path: '/agent/v1/audit-log', query: { employeeId: P.nomsa.id } }, { tables: approved.tables });
    expect((bodyOf(b).events as any[] | undefined) ?? [], 'the agent of company B reads none of A\'s events').toEqual([]);
  });

  test('AC-3 approveAgentAction loads without a Lambda client of its own in the fake, and the client is only needed when a run starts (Lambda)', async ({}, testInfo) => {
    once(testInfo);
    const t = withPending([pending({ id: 'act-onb22-0001' })]);
    const get = call('approveAgentAction', 'agentA', { path: '/agent/v1/actions/act-onb22-0001', route: '/agent/v1/actions/{actionId}', pathParameters: { actionId: 'act-onb22-0001' } }, { tables: t, noLambdaClient: true });
    expect(get.error?.message, 'the file loads with no @aws-sdk/client-lambda in the harness (a locked fake without one still loads it)').toBeUndefined();
    expect(statusOf(get), `the agent reads its proposal (${describe(get)})`).toBe(200);
    const list = listActions('hrA', t);
    void list;
    const no = decide('reject', 'hrA', 'act-onb22-0001', t, undefined, { noLambdaClient: true });
    expect(no.error?.message, 'a decline loads and runs the same way').toBeUndefined();
    expect(statusOf(no), `a decline needs no Lambda client (${describe(no)})`).toBe(200);
    const run = decide('approve', 'hrA', 'act-onb22-0001', t, undefined, { noLambdaClient: true });
    expect(run.error?.message, 'an approve with no client does not crash the Lambda: it answers').toBeUndefined();
    expect(docRow(run.tables, P.nomsa.id, D.nomsaBank), 'and decides nothing').toMatchObject({ ocr_status: 'MANUAL_REVIEW' });
  });

  // ---------------------------------------------------------------------------------------------- AC-4

  const TOOLS = ['list_employees', 'get_employee', 'list_verifications', 'get_verification_summary', 'assess_employee_risk', 'query_audit_log', 'propose_accept_document', 'get_proposal_status'];
  const manifest = () => JSON.parse(text('api/agent-tools.json')) as { generated_at: string; tools: { name: string; description: string; method: string; path: string; parameters: any }[] };

  test('AC-4 agent-tools.json lists exactly the eight onboarding tools with the screens\' words (data)', async ({}, testInfo) => {
    once(testInfo);
    const m = manifest();
    expect(sorted(m.tools.map((t) => t.name)), 'exactly these eight tools').toEqual(sorted(TOOLS));
    expect(String(m.generated_at) >= '2026-11-18', 'generated_at is today or later (it is regenerated with the change)').toBe(true);
    for (const t of m.tools) {
      expect(['GET', 'POST'], `${t.name}: a method`).toContain(t.method);
      expect(t.path, `${t.name}: a path`).toMatch(/^\//);
      expect(t.parameters?.type, `${t.name}: parameters are an object schema`).toBe('object');
      expect(typeof t.parameters?.properties, `${t.name}: with properties`).toBe('object');
      for (const r of t.parameters?.required ?? []) expect(Object.keys(t.parameters.properties), `${t.name}: required ${r} is a property`).toContain(r);
      expect(t.parameters?.additionalProperties, `${t.name}: no extra parameters`).toBe(false);
    }
    const tool = (n: string) => m.tools.find((t) => t.name === n)!;
    const prop = tool('propose_accept_document');
    expect(prop.method, 'propose_accept_document is a POST').toBe('POST');
    expect(prop.path, 'to /proposals').toBe('/proposals');
    expect(prop.parameters.required, 'it needs the document id').toEqual(['document_id']);
    expect(prop.parameters.properties.document_id?.type, 'a text id').toBe('string');
    expect(Object.keys(prop.parameters.properties), 'and nothing else: the type is fixed by the tool').toEqual(['document_id']);
    expect(prop.description, 'it says what it cannot do').toContain('Only proposes. A person decides.');
    expect(prop.description, 'in the screens\' words').toContain('Accept document');
    const status = tool('get_proposal_status');
    expect(status.method, 'get_proposal_status is a GET').toBe('GET');
    expect(status.path, 'of one proposal').toMatch(/^\/actions\/\{[a-zA-Z_]+\}$/);
    expect(status.parameters.required, 'by its action id').toEqual(['action_id']);
    const lv = tool('list_verifications');
    expect(lv.parameters.properties.waiting?.type, 'list_verifications takes waiting, a boolean').toBe('boolean');
    const statusEnum = (lv.parameters.properties.status?.enum ?? []) as string[];
    expect(statusEnum.filter((v) => !['PENDING', 'PROCESSING', 'PASSED', 'FAILED', 'MANUAL_REVIEW'].includes(v)), 'the status filter lists only ocr_status values the route understands (no VERIFIED)').toEqual([]);
    const words = m.tools.map((t) => `${t.name}: ${t.description} ${JSON.stringify(t.parameters)}`).join('\n');
    expect(words, 'never "Masked"').not.toMatch(/\bmask/i);
    expect(words, 'no promise of a full ID or account number, and no number in a description').not.toMatch(/(full|complete)\s+(id|identity|account|passport)\s+(number|no\b)|\b\d{13}\b/i);
    for (const wrong of ['Needs review', 'Needs a review', 'Does not match', 'Doesnt match', 'Not matching', 'Mismatch', 'Being read', 'In Review', 'Under review', 'Not started']) {
      expect(words, `no off-screen spelling "${wrong}"`).not.toContain(wrong);
    }
    expect(JSON.stringify(m), 'onboard_new_employee is gone').not.toContain('onboard_new_employee');
  });

  test('AC-4 The MCP tools/list holds the same names and required parameters as the manifest, and no onboard_new_employee (handler)', async ({}, testInfo) => {
    once(testInfo);
    test.setTimeout(8 * 60_000);
    const b = mcpBundle();
    expect(b.built, `the MCP server builds (${b.log})`).toBe(true);
    const KEY = 'k-live-one';
    const run = runSteps('mcp', b.handlerFile, [{ call: mcpEvent({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, KEY) }], { secrets: { [AGENT_SECRET]: { AWSCURRENT: KEY } } }, {}, b.dir);
    expect(run.error?.message, 'the MCP handler ran').toBeUndefined();
    const tools = (rpcOf(run.answers[0]!)?.result?.tools ?? []) as { name: string; inputSchema: any }[];
    expect(sorted(tools.map((t) => t.name)), 'the same eight names').toEqual(sorted(TOOLS));
    for (const mt of manifest().tools) {
      const live = tools.find((t) => t.name === mt.name)!;
      expect(sorted(live?.inputSchema?.required ?? []), `${mt.name}: the same required parameters`).toEqual(sorted(mt.parameters.required ?? []));
      expect(sorted(Object.keys(live?.inputSchema?.properties ?? {})), `${mt.name}: the same parameters`).toEqual(sorted(Object.keys(mt.parameters.properties)));
    }
    expect(JSON.stringify(run.answers[0]), 'no onboard_new_employee on the server').not.toContain('onboard_new_employee');
    const propose = tools.find((t) => t.name === 'propose_accept_document')!;
    expect(propose.inputSchema?.additionalProperties, 'the proposal takes nothing extra').toBe(false);
  });

  test('AC-4 openapi.yaml and the walk rows describe every new or changed route, and the route check passes on the real repo (text)', async ({}, testInfo) => {
    once(testInfo);
    const spec = JSON.parse(execFileSync('python3', [join(here, 'support', 'ten-04', 'openapi_json.py'), join(REPO, 'api', 'openapi.yaml')], { encoding: 'utf8' })) as { paths: Record<string, Record<string, any>> };
    const op = (path: string, method: string) => spec.paths?.[path]?.[method.toLowerCase()];
    const want: [string, string, unknown, string, string[] | undefined][] = [
      ['/agent/v1/proposals', 'POST', [{ AgentKey: [] }], 'agent', undefined],
      ['/agent/v1/actions', 'GET', [{ CognitoJWT: [] }], 'token', ['hr_staff']],
      // P9: the company of approve and decline is the signed-in person's, so x-tenant is token (TEN-04's route check refuses agent on a JWT route).
      // Locked ten-04 still lists both as "covered" (x-tenant agent): its AC-7 goes red on this build until its rows change (cards/onb-22.md).
      ['/agent/v1/actions/{actionId}/approve', 'POST', [{ CognitoJWT: [] }], 'token', ['hr_staff']],
      ['/agent/v1/actions/{actionId}/reject', 'POST', [{ CognitoJWT: [] }], 'token', ['hr_staff']],
      ['/agent/v1/actions/{actionId}', 'GET', [{ AgentKey: [] }], 'agent', undefined],
    ];
    for (const [path, method, security, tenant, roles] of want) {
      const o = op(path, method);
      expect(o, `${method} ${path} is described`).toBeTruthy();
      expect(o?.security, `${method} ${path}: security`).toEqual(security);
      expect(o?.['x-tenant'], `${method} ${path}: x-tenant`).toBe(tenant);
      if (roles) expect(o?.['x-roles'], `${method} ${path}: x-roles`).toEqual(roles);
      expect(Object.keys(o?.responses ?? {}).length, `${method} ${path}: has responses`).toBeGreaterThan(0);
    }
    expect(Object.keys(op('/agent/v1/proposals', 'POST')?.responses ?? {}), 'the proposal route says 201, 400, 404 and 409').toEqual(expect.arrayContaining(['201', '400', '404', '409']));
    const rows = JSON.parse(text('scripts/tenancy/ten-04-rows.json') || '{}') as Record<string, { kind: string; ids?: Record<string, string> }>;
    for (const k of ['POST /agent/v1/proposals', 'GET /agent/v1/actions', 'POST /agent/v1/actions/{actionId}/approve', 'POST /agent/v1/actions/{actionId}/reject']) expect(rows[k], `the walk has a row for ${k}`).toBeTruthy();
    expect(['agent', 'covered', 'create'], 'the proposal route is an agent route').toContain(rows['POST /agent/v1/proposals']?.kind);
    expect(rows['GET /agent/v1/actions']?.kind, 'HR\'s list is walked as a list').toBe('list');
    for (const v of ['approve', 'reject']) {
      expect(rows[`POST /agent/v1/actions/{actionId}/${v}`]?.kind, `${v} is walked by id now that a person answers`).toBe('byId');
      expect(rows[`POST /agent/v1/actions/{actionId}/${v}`]?.ids, `${v}: the id is an action of company A`).toEqual({ actionId: 'action' });
    }
    const check = spawnSync(process.execPath, [join(REPO, 'scripts', 'ci', 'routes-match-openapi.mjs')], { cwd: REPO, encoding: 'utf8' });
    expect(check.status, `TEN-04's route check passes on the real repo (${(check.stdout + check.stderr).slice(0, 400)})`).toBe(0);
    expect(JSON.parse(text('lambda/shared/tenant-retrofit.json')), 'tenant-retrofit.json stays []').toEqual([]);
  });

  // ---------------------------------------------------------------------------------------------- AC-5

  const KEYS = { one: 'k-live-one-0001', two: 'k-live-two-0002', three: 'k-live-three-0003', four: 'k-live-four-0004' };
  const agentAnswers = { rules: [{ url: '/agent/v1/employees', json: { items: [{ employee_id: 'x' }] } }] };
  const rpc = (id: number, method: string, params?: unknown) => ({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
  const mcp = (steps: Step[], secret: Record<string, string>, keys: string[] = [KEYS.one, KEYS.two, KEYS.three, KEYS.four]) => {
    const b = mcpBundle();
    expect(b.built, `the MCP server builds (${b.log})`).toBe(true);
    const run = runSteps('mcp', b.handlerFile, [{ fetch: { keys, ...agentAnswers } }, ...steps], { secrets: { [AGENT_SECRET]: secret } }, {}, b.dir);
    expect(run.error?.message, 'the MCP handler ran').toBeUndefined();
    return run;
  };

  test('AC-5 The MCP server answers 401 to a missing, empty or wrong key before any agent call or tool; the right key works; /health says only ok (handler)', async ({}, testInfo) => {
    once(testInfo);
    test.setTimeout(8 * 60_000);
    const messages = [rpc(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'acceptance', version: '1' } }), rpc(2, 'tools/list'), rpc(3, 'tools/call', { name: 'list_employees', arguments: {} })];
    const steps: Step[] = [];
    for (const m of messages) for (const key of [undefined, '', 'not-the-key', 'k-live-one-0001 ', KEYS.one.toUpperCase()]) steps.push({ call: mcpEvent(m, key) });
    for (const m of messages) steps.push({ call: mcpEvent(m, KEYS.one) });
    steps.push({ call: mcpEvent(undefined, undefined, { method: 'GET', path: '/health' }) });
    const run = mcp(steps, { AWSCURRENT: KEYS.one });
    const wrong = run.answers.slice(0, 15);
    wrong.forEach((a, i) => {
      const what = `${messages[Math.floor(i / 5)]!.method} with ${['no key', 'an empty key', 'a wrong key', 'the key and a space', 'the key in capitals'][i % 5]}`;
      expect(a.status, `${what}: 401`).toBe(401);
      expect(httpIn(run, a), `${what}: no agent API call and no tool run`).toEqual([]);
      expect(a.body ?? '', `${what}: no tool result, no tool list`).not.toMatch(/list_employees|employee_id|"tools"/);
    });
    const good = run.answers.slice(15, 18);
    expect(good.map((a) => a.status), 'the right key works for initialize, tools/list and tools/call').toEqual([200, 200, 200]);
    expect(rpcOf(good[1]!)?.result?.tools?.length, 'the tool list comes back').toBeGreaterThan(5);
    expect(httpIn(run, good[2]!).map((c) => `${c.method} ${new URL(c.url).pathname}`), 'the tool call reached the agent API').toEqual(['GET /agent/v1/employees']);
    const health = run.answers[18]!;
    expect(health.status, '/health answers 200 with no key').toBe(200);
    expect(String(health.body).trim().replace(/\s+/g, '').replace(/"/g, ''), '/health says nothing but ok').toMatch(/^(ok|\{status:ok\})$/);
    expect(httpIn(run, health), '/health makes no agent call').toEqual([]);
    const secrets = run.calls.filter((c) => c.service === 'secretsmanager');
    expect(secrets.length, 'the key is read from Secrets Manager').toBeGreaterThan(0);
    expect(secrets.every((c) => c['secretId'] === AGENT_SECRET), `the secret read is ${AGENT_SECRET}`).toBe(true);
  });

  test('AC-5 After the key rotates the new key works at once and the old one is refused; a pending key works; tool calls use the secret\'s current key (handler)', async ({}, testInfo) => {
    once(testInfo);
    test.setTimeout(8 * 60_000);
    const list = (key: string) => ({ call: mcpEvent(rpc(9, 'tools/call', { name: 'list_employees', arguments: {} }), key) }) as Step;
    const steps: Step[] = [
      list(KEYS.one), // the container caches the key
      { rotate: { secretId: AGENT_SECRET, set: { AWSCURRENT: KEYS.two, AWSPREVIOUS: KEYS.one } } },
      list(KEYS.two), // the new key: at once, inside the cache time
      list(KEYS.one), // the old key: refused
      { rotate: { secretId: AGENT_SECRET, set: { AWSCURRENT: KEYS.two, AWSPENDING: KEYS.three, AWSPREVIOUS: KEYS.one } } },
      list(KEYS.three), // a pending key works while it is pending
      list(KEYS.two),
      { rotate: { secretId: AGENT_SECRET, set: { AWSCURRENT: KEYS.four, AWSPREVIOUS: KEYS.two } } },
      list(KEYS.four),
      list(KEYS.two),
      { advance: 5 * 60_000 }, // after the cache time the same holds
      list(KEYS.four),
      // ONB-22.1 (M-1): a warm container still holds KEYS.four from the call above. The key rotates, the cache time passes, and only then is
      // the OLD key presented first. It must be refused (the cache is 4 minutes, decision 10), or rotating a leaked key cuts nothing off.
      { rotate: { secretId: AGENT_SECRET, set: { AWSCURRENT: KEYS.three, AWSPREVIOUS: KEYS.four } } },
      { advance: 5 * 60_000 },
      list(KEYS.four), // the old key, first, on a warm container
      list(KEYS.three), // the new key
    ];
    const run = mcp(steps, { AWSCURRENT: KEYS.one });
    const [a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11] = run.answers;
    expect(a1!.status, 'the first key works').toBe(200);
    expect(a2!.status, 'the new key works at once (a forced re-read, not a wait for the cache)').toBe(200);
    expect(a3!.status, 'the old key, now only the previous version, is refused').toBe(401);
    expect(httpIn(run, a3!), 'with no agent call').toEqual([]);
    expect(a4!.status, 'a key that is only pending works').toBe(200);
    expect(a5!.status, 'the current key still works').toBe(200);
    expect(a6!.status, 'after the next rotation the newest key works at once').toBe(200);
    expect(a7!.status, 'and the one before is refused').toBe(401);
    expect(a8!.status, 'after the cache time the key still works').toBe(200);
    expect(httpIn(run, a1!)[0]!.headers['x-api-key'], 'the agent API is called with the secret\'s key').toBe(KEYS.one);
    expect(httpIn(run, a2!)[0]!.headers['x-api-key'], 'after the rotation: with the new key, not the one the container started with').toBe(KEYS.two);
    expect(httpIn(run, a6!)[0]!.headers['x-api-key'], 'and after the next one: the newest').toBe(KEYS.four);
    expect(a9!.status, 'M-1: five minutes after a rotation the old key, presented first, is refused (the cache lasts 4 minutes)').toBe(401);
    expect(httpIn(run, a9!), 'with no agent call').toEqual([]);
    expect(a10!.status, 'and the new key works').toBe(200);
    expect(httpIn(run, a10!)[0]!.headers['x-api-key'], 'with the secret\'s current key').toBe(KEYS.three);
    expect(a11, 'no step lost').toBeUndefined();
    const blob = JSON.stringify([logLinesOf(run.calls), run.answers.map((a) => a.body)]);
    for (const k of Object.values(KEYS)) expect(blob, `the key ${k} is in no log line and no answer`).not.toContain(k);
    expect(run.calls.filter((c) => c.service === 'secretsmanager').every((c) => c['secretId'] === AGENT_SECRET), 'every secret read is naleko/agent/api-key').toBe(true);
  });

  const logLinesOf = (calls: Run['calls']) => logLines(calls);

  test('AC-5 A refusal from the agent API comes back as a tool error with its status and its own words, and never the key (handler)', async ({}, testInfo) => {
    once(testInfo);
    test.setTimeout(8 * 60_000);
    const doc = '9a1f0000-0003-4d7e-9a11-aaaaaaaa0003';
    const steps: Step[] = [];
    const answers: [number, unknown][] = [[401, { message: 'Unauthorized' }], [403, { error: 'Forbidden' }], [404, { error: 'Not found' }], [409, { error: 'This document was already decided or is still being read', action_id: 'act-1' }]];
    for (const [status, json] of answers) {
      steps.push({ fetch: { rules: [{ url: '/agent/v1/proposals', status, json }] } });
      steps.push({ call: mcpEvent(rpc(5, 'tools/call', { name: 'propose_accept_document', arguments: { document_id: doc } }), KEYS.one) });
    }
    const run = mcp(steps, { AWSCURRENT: KEYS.one });
    answers.forEach(([status, json], i) => {
      const a = run.answers[i]!;
      const res = rpcOf(a)?.result ?? rpcOf(a);
      const t = JSON.stringify(res);
      expect(a.status, `${status}: the MCP call itself is answered`).toBe(200);
      expect(res?.isError, `${status}: a tool error`).toBe(true);
      expect(t, `${status}: with the status`).toContain(String(status));
      expect(t, `${status}: and the API's own words`).toContain(Object.values(json as Record<string, string>)[0]!.slice(0, 20));
      expect(t, `${status}: never the key`).not.toContain(KEYS.one);
      const sent = httpIn(run, a)[0]!;
      expect(`${sent.method} ${new URL(sent.url).pathname}`, `${status}: it asked to propose`).toBe('POST /agent/v1/proposals');
      expect(JSON.parse(sent.body ?? '{}'), `${status}: for Accept document, by the tool's fixed type`).toEqual({ type: 'ACCEPT_DOCUMENT', document_id: doc });
    });
    const status = runSteps('mcp', mcpBundle().handlerFile, [{ fetch: { keys: [KEYS.one], rules: [{ url: '/agent/v1/actions/', json: { action_id: 'act-1', status: 'PENDING_APPROVAL' } }] } }, { call: mcpEvent(rpc(6, 'tools/call', { name: 'get_proposal_status', arguments: { action_id: 'act-1' } }), KEYS.one) }], { secrets: { [AGENT_SECRET]: { AWSCURRENT: KEYS.one } } }, {}, mcpBundle().dir);
    const sent = httpIn(status, status.answers[0]!)[0]!;
    expect(`${sent.method} ${new URL(sent.url).pathname}`, 'get_proposal_status reads one proposal').toBe('GET /agent/v1/actions/act-1');
  });

  test('AC-5 Ask Batsi\'s tool resolver re-reads the key once on a 401 or 403 and retries once, then answers; no loop (handler)', async ({}, testInfo) => {
    once(testInfo);
    const resolver = handlerOf('nalekoAiChat').replace(/index\.mjs$/, 'tool-resolver.mjs');
    const get = { resolve: { tool: 'get_employee', args: { id: 'emp-1' }, context: { staffId: 'HRA001', tenantId: A } } } as Step;
    const secrets = { [AGENT_SECRET]: { AWSCURRENT: 'rk-one' } };
    const ok = { rules: [{ url: '/agent/v1/employees/', json: { employee: { employee_id: 'emp-1' } } }] };
    const run = runSteps('resolver', resolver, [
      { fetch: { keys: ['rk-one'], ...ok } }, get,
      { rotate: { secretId: AGENT_SECRET, set: { AWSCURRENT: 'rk-two', AWSPREVIOUS: 'rk-one' } } }, { fetch: { keys: ['rk-two'], ...ok } }, get,
      { fetch: { keys: [] } }, get, // a second 401 is an error, no loop
      { fetch: { rules: [{ status: 403, json: { error: 'Forbidden' } }] } }, get, // a 403 is retried once too
      { fetch: { rules: [{ status: 404, json: { error: 'Not found' } }] } }, get, // anything else is not retried
    ], { secrets }, {});
    expect(run.error?.message, 'the resolver loaded').toBeUndefined();
    const [first, rotated, stuck, forbidden, missing] = run.answers;
    expect(first!.result, 'a warm container with the right key answers').toEqual({ employee: { employee_id: 'emp-1' } });
    expect(httpIn(run, first!).length, 'with one call').toBe(1);
    expect(rotated!.result, 'after a rotation the answer still comes').toEqual({ employee: { employee_id: 'emp-1' } });
    const calls = httpIn(run, rotated!);
    expect(calls.map((c) => c.headers['x-api-key']), 'one call with the old key (401), one retry with the re-read key').toEqual(['rk-one', 'rk-two']);
    expect(stuck!.error, 'a second 401 is an error').toBeTruthy();
    expect(httpIn(run, stuck!).length, 'after exactly one retry').toBe(2);
    expect(httpIn(run, forbidden!).length, 'a 403 is retried once').toBe(2);
    expect(forbidden!.error, 'and then an error').toBeTruthy();
    expect(httpIn(run, missing!).length, 'a 404 is not retried').toBe(1);
    expect(run.calls.filter((c) => c.service === 'secretsmanager').length, 'the secret was read at the start and once per retry, not on every call').toBeLessThanOrEqual(5);
  });

  test('AC-5 Terraform and CI: no key in Terraform or the settings, the role reads the real secret, CI builds the zip and deploys on a change (text and build)', async ({}, testInfo) => {
    once(testInfo);
    test.setTimeout(8 * 60_000);
    const infra = readdirSync(join(REPO, 'infra')).filter((f) => f.endsWith('.tf')).map((f) => [f, text(`infra/${f}`).replace(/^\s*(#|\/\/).*$/gm, '')] as const);
    for (const [f, src] of infra) {
      expect(src, `${f}: no NALEKO_AGENT_KEY`).not.toContain('NALEKO_AGENT_KEY');
      expect(src, `${f}: no NALEKO_HR_API_KEY`).not.toContain('NALEKO_HR_API_KEY');
      expect(src, `${f}: no secret version read into Terraform`).not.toMatch(/data\s+"aws_secretsmanager_secret_version"/);
      expect(src, `${f}: no table data managed by Terraform`).not.toContain('aws_dynamodb_table_item');
    }
    const fn = lambdaNamed('nalekoMcpServer');
    const env = settingsOf(fn);
    for (const gone of ['NALEKO_AGENT_KEY', 'NALEKO_HR_API_KEY', 'REST_API_BASE']) expect([...env.keys()], `the MCP function has no ${gone} setting`).not.toContain(gone);
    expect([...env.keys()], 'it keeps AGENT_API_BASE').toContain('AGENT_API_BASE');
    expect([...env.values()].some((v) => /aws_secretsmanager_secret\.agent_api_key\.name|"naleko\/agent\/api-key"/.test(v)), 'and has the secret\'s name').toBe(true);
    const mcpRole = roleOf(fn);
    const { statements } = grants(mcpRole);
    const secretStatements = statements.filter((s) => list(s.Action).some((a) => a.startsWith('secretsmanager:')));
    expect(secretStatements.length, 'the MCP role reads a secret').toBeGreaterThan(0);
    const LEGACY = /secret:naleko\/agent-api-key\*$/; // develop's statement (a name no secret has); locked ten-02 pins its policy, so it stays (P10)
    for (const s of secretStatements) {
      expect(list(s.Action), 'it may only read the value').toEqual(['secretsmanager:GetSecretValue']);
      expect(list(s.Resource).join(','), 'the secret is naleko/agent/api-key (the name it really has), or develop\'s old statement, left as it was').toMatch(/secret:naleko\/agent\/api-key\*$|secret:naleko\/agent-api-key\*$/);
    }
    expect(secretStatements.some((s) => !LEGACY.test(list(s.Resource).join(','))), 'one statement names the real secret naleko/agent/api-key').toBe(true);
    // CI builds the zip and deploys it.
    const b = mcpBundle();
    expect(b.built, `python3 scripts/ci/build-lambdas.py nalekoMcpServer builds dist/lambdas/nalekoMcpServer.zip (${b.log})`).toBe(true);
    for (const want of ['lambda-handler.mjs', 'server.mjs']) expect(b.entries, `the zip holds ${want}`).toContain(want);
    expect(b.entries.some((e) => e.startsWith('node_modules/@modelcontextprotocol/')), 'and the SDK').toBe(true);
    expect(b.entries.some((e) => e.startsWith('node_modules/zod/')), 'and zod').toBe(true);
    const source = ['mcp/lambda-handler.mjs', 'lambda/nalekoMcpServer/lambda-handler.mjs'].find((p) => existsSync(join(REPO, p)));
    expect(source, 'the handler source is in the repo (mcp/ or lambda/nalekoMcpServer/)').toBeTruthy();
    const wf = text('.github/workflows/deploy-lambdas.yml');
    const paths = [...(/^\s{4}paths:\n((?:\s{6}- .*\n)+)/m.exec(wf)?.[1] ?? '').matchAll(/- "([^"]+)"/g)].map((m) => m[1]!);
    expect(paths.some((p) => p.endsWith('/**') && source!.startsWith(p.slice(0, -2)) && !p.startsWith('!')), `deploy-lambdas.yml watches ${source}`).toBe(true);
    const re = /echo "lambda=\$\(has '([^']+)'\)"/.exec(wf)?.[1];
    expect(re, 'the "lambda changed" test is in the workflow').toBeTruthy();
    expect(new RegExp(re!).test(source!), `and it counts ${source} as a Lambda change`).toBe(true);
  });

  // ---------------------------------------------------------------------------------------------- AC-6

  const ROBOT = { id: '3f1a7c52-0099-4d7e-9a11-aaaaaaaa0099', doc: 'dd000000-0099-4d7e-9a11-aaaaaaaa0099', mail: 'onb22.robot@blackhole.postmarkapp.com' };
  const summaryTables = (mail: string | undefined) => {
    const t = tables();
    t.employees!.push(row({ employee_id: ROBOT.id, first_name: 'Test', last_name: 'Person', ...(mail === undefined ? {} : { email: mail }), department: 'Bakery', stage: 'ACTIVE', step: 'DOCUMENTS', created_at: ISO(10), tenant_id: A }));
    t.documents!.push(document(ROBOT.id, ROBOT.doc, 'NATIONAL_ID', A));
    t['document-verification']!.push(verification(ROBOT.id, ROBOT.doc, 'NATIONAL_ID', A, 'MATCHES'));
    return t;
  };
  const summary = (caller: Caller, t: Tables) => call('summariseVerification', caller, { path: `/agent/v1/verifications/${V(ROBOT.doc)}/summary`, route: '/agent/v1/verifications/{id}/summary', pathParameters: { id: V(ROBOT.doc) } }, { tables: t });
  const risk = (caller: Caller, t: Tables) => call('classifyOnboardingRisk', caller, { method: 'POST', path: `/agent/v1/employees/${ROBOT.id}/assess-risk`, route: '/agent/v1/employees/{id}/assess-risk', pathParameters: { id: ROBOT.id } }, { tables: t });

  test('AC-6 An agent call about a test person gets the stand-in and never reaches Bedrock; about a real person it does (so the guard is not simply off) (Lambda)', async ({}, testInfo) => {
    once(testInfo);
    const robotSummary = summary('agentA', summaryTables(ROBOT.mail));
    expect(statusOf(robotSummary), `the summary of a test person: 200 (${describe(robotSummary)})`).toBe(200);
    expect(bodyOf(robotSummary), 'it is the stand-in').toMatchObject({ aiDisabled: true });
    expect(String(bodyOf(robotSummary).summary), 'and says so').toMatch(/AI skipped/);
    expect(bedrockOf(robotSummary.calls), 'no Bedrock call').toEqual([]);
    const robotRisk = risk('agentA', summaryTables(ROBOT.mail));
    expect(statusOf(robotRisk), `the risk check of a test person answers (${describe(robotRisk)})`).toBeLessThan(500);
    expect(bedrockOf(robotRisk.calls), 'no Bedrock call').toEqual([]);
    const realSummary = summary('agentA', summaryTables('nomsa.real@baker-a.example'));
    expect(bedrockOf(realSummary.calls).length, 'a real person\'s summary does call the model (the fake refuses it, so this run answers 502)').toBeGreaterThan(0);
    const realRisk = risk('agentA', summaryTables('nomsa.real@baker-a.example'));
    expect(bedrockOf(realRisk.calls).length, 'a real person\'s risk check does call the model').toBeGreaterThan(0);
    const noMail = summary('agentA', summaryTables(undefined));
    expect(bedrockOf(noMail.calls), 'a person with no email on record fails closed: no Bedrock call (P6)').toEqual([]);
    // ONB-22.1: no employee row at all is not a robot (PII-01's locked rows have verifications with no employee row and expect the model to be asked); a row that is there but
    // empty of an email still fails closed (the line above).
    const orphan = summaryTables('nomsa.real@baker-a.example');
    orphan.employees = orphan.employees!.filter((e) => e['employee_id'] !== ROBOT.id);
    expect(bedrockOf(summary('agentA', orphan).calls).length, 'a verification with no employee row at all reaches the model path (the PII-01 rows rely on it)').toBeGreaterThan(0);
    // HR's own sign-in keeps working as before: the person's own check, not the caller's.
    const hrReal = summary('hrA', summaryTables('nomsa.real@baker-a.example'));
    expect(bedrockOf(hrReal.calls).length, 'HR asking about a real person: the model is called').toBeGreaterThan(0);
    // The agent of B cannot read A's verification at all.
    const other = summary('agentB', summaryTables(ROBOT.mail));
    expect(statusOf(other), 'another company\'s verification: 404').toBe(404);
  });

  test('AC-6 The proposal code and the MCP server import no AI client and the AI guard check passes (text)', async ({}, testInfo) => {
    once(testInfo);
    const AI = /bedrock|textract|anthropic|openai|comprehend|rekognition|sagemaker/i;
    for (const name of ['createProposal', 'approveAgentAction', 'getEmployee', 'getDocumentVerifications']) {
      const dir = join(REPO, 'lambda', name);
      expect(existsSync(dir), `lambda/${name} exists`).toBe(true);
      for (const f of readdirSync(dir).filter((x) => /\.(mjs|js)$/.test(x) && !/\.test\./.test(x))) {
        const imports = text(`lambda/${name}/${f}`).split('\n').filter((l) => /^\s*(import\b|.*\brequire\()/.test(l) || /import\(/.test(l));
        expect(imports.filter((l) => AI.test(l)), `lambda/${name}/${f}: no AI client import`).toEqual([]);
      }
    }
    const b = mcpBundle();
    expect(b.built, `the MCP server builds (${b.log})`).toBe(true);
    for (const f of readdirSync(b.dir).filter((x) => /\.(mjs|js)$/.test(x))) {
      expect(readFileSync(join(b.dir, f), 'utf8').split('\n').filter((l) => /^\s*import\b/.test(l) && AI.test(l)), `MCP ${f}: no AI client import`).toEqual([]);
    }
    const guard = spawnSync('python3', [join(REPO, 'scripts', 'ci', 'check-ai-guard.py')], { cwd: REPO, encoding: 'utf8' });
    expect(guard.status, `scripts/ci/check-ai-guard.py passes (${(guard.stdout + guard.stderr).slice(0, 300)})`).toBe(0);
    // The AI routes keep their guard: robots before any send.
    for (const fn of ['summariseVerification', 'classifyOnboardingRisk']) expect(text(`lambda/${fn}/index.mjs`), `${fn} still wraps its client in guardAi`).toMatch(/guardAi\(new BedrockRuntimeClient/);
  });

  // ---------------------------------------------------------------------------------------------- AC-7 (pepla-dev)

  test('AC-7 On pepla-dev an approved test proposal runs once @pepla-dev', async ({ page }, testInfo) => {
    test.skip(!ON_DEV, 'pepla-dev only: the no-backend run covers every rule above.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width.');
    test.setTimeout(240_000);
    const env = (k: string) => process.env[k] ?? '';
    const src = text('pepla-web/src/environments/environment.ts');
    const pick = (name: string) => new RegExp(`${name}\\s*:\\s*['"\`]([^'"\`]+)['"\`]`).exec(src)?.[1] ?? '';
    const clientId = pick('clientId');
    const region = pick('region') || 'af-south-1';
    const docApi = pick('documentUploadApiUrl').replace(/\/+$/, '');
    const agent = env('E2E_AGENT_API_URL').replace(/\/+$/, '');
    expect(agent, 'the agent API address is set (E2E_AGENT_API_URL)').toMatch(/^https:\/\//);
    expect(env('E2E_AGENT_KEY'), 'the agent key is set (E2E_AGENT_KEY)').toBeTruthy();
    expect(env('E2E_HR_EMAIL'), 'the HR test login is set').toBeTruthy();
    const signIn = await page.request.post(`https://cognito-idp.${region}.amazonaws.com/`, {
      headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
      data: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: clientId, AuthParameters: { USERNAME: env('E2E_HR_EMAIL'), PASSWORD: env('E2E_HR_PASSWORD') } }),
    });
    expect(signIn.status(), 'HR signs in at Cognito').toBe(200);
    const idToken = ((await signIn.json()) as any).AuthenticationResult.IdToken as string;
    const agentHeaders = { 'x-api-key': env('E2E_AGENT_KEY'), 'content-type': 'application/json' };
    const hrHeaders = { authorization: `Bearer ${idToken}`, 'content-type': 'application/json' };
    const get = async (url: string, headers: Record<string, string>) => page.request.fetch(url, { headers, failOnStatusCode: false });
    const post = async (url: string, headers: Record<string, string>, body?: unknown) => page.request.fetch(url, { method: 'POST', headers, data: body === undefined ? undefined : JSON.stringify(body), failOnStatusCode: false });
    // 1. The agent lists the waiting documents and finds the seeded new person's (check Matches).
    const waiting = await get(`${agent}/agent/v1/verifications?waiting=true`, agentHeaders);
    expect(waiting.status(), 'the agent asks for the waiting documents').toBe(200);
    const item = ((await waiting.json()) as any).items.find((i: any) => i.document_id === devIds['document']);
    expect(item, `the seeded document ${devIds['document']} waits for HR (scripts/ci/seed-dev.py writes it)`).toBeTruthy();
    expect(item.check, 'and its check is Matches').toBe('MATCHES');
    // 2. The agent proposes Accept document.
    const made = await post(`${agent}/agent/v1/proposals`, agentHeaders, { type: 'ACCEPT_DOCUMENT', document_id: devIds['document'] });
    expect(made.status(), 'the agent proposes').toBe(201);
    const actionId = ((await made.json()) as any).action_id as string;
    // 3. HR lists the proposals with the ID token and approves.
    const mine = await get(`${agent}/agent/v1/actions`, hrHeaders);
    expect(mine.status(), 'HR lists the proposals').toBe(200);
    expect(((await mine.json()) as any).items.map((i: any) => i.action_id), 'the new proposal is in HR\'s list').toContain(actionId);
    const asAgent = await post(`${agent}/agent/v1/actions/${actionId}/approve`, agentHeaders);
    // onb-22.6: on pepla-dev the API gateway turns the agent key away at the HR sign-in check, before any code runs, so the answer is 401 (the fake API in the other tests answers 403). Either way the key is refused.
    expect([401, 403], `the agent key cannot approve its own proposal (it got ${asAgent.status()})`).toContain(asAgent.status());
    const approved = await post(`${agent}/agent/v1/actions/${actionId}/approve`, hrHeaders);
    expect(approved.status(), 'HR approves').toBe(200);
    expect(await approved.json(), 'and it ran').toMatchObject({ status: 'APPROVED', run_status: 'RAN' });
    // 4. The decision is the screen's: HR's API shows the document accepted.
    const read = await get(`${docApi}/v1/verifications/${devIds['document']}?employee_id=${devIds['employee']}`, hrHeaders);
    expect(read.status(), 'HR reads the document').toBe(200);
    expect(await read.json(), 'it is accepted, by HR').toMatchObject({ hr_decision: 'ACCEPTED' });
    const again = await post(`${agent}/agent/v1/actions/${actionId}/approve`, hrHeaders);
    expect(again.status(), 'a second approve: 409').toBe(409);
    // 5. The audit log through the agent key: both events, with their type.
    const audit = await get(`${agent}/agent/v1/audit-log?employeeId=${devIds['employee']}`, agentHeaders);
    expect(audit.status(), 'GET /agent/v1/audit-log answers 200 (it is red today: missing KMS right)').toBe(200);
    const types = ((await audit.json()) as any).events.map((e: any) => e.eventType);
    expect(types, 'the log holds the decision and the approval, with their types').toEqual(expect.arrayContaining(['document.reviewed', 'proposal.approved']));
    // 6. Company B's seeded document: 404.
    const other = await post(`${agent}/agent/v1/proposals`, agentHeaders, { type: 'ACCEPT_DOCUMENT', document_id: devIds['documentB'] });
    expect(other.status(), 'a document of company B\'s seed row: 404').toBe(404);
  });

  test('AC-7 The pepla-dev seed writes the new person and company B\'s document the test above reads (text, P7)', async ({}, testInfo) => {
    once(testInfo);
    const seed = text('scripts/ci/seed-dev.py') + text('scripts/ci/seed-dev-files.py');
    for (const [what, v] of [['their email on the test domain', devIds['email']], ['their document', devIds['document']], ['company B\'s document', devIds['documentB']]] as const) {
      expect(seed, `scripts/ci/seed-dev.py writes ${what} (${v})`).toContain(v);
    }
    // The person's id is the one the seed derives for every demo person: uuid5 of its name space and the email.
    const ns = /^NS\s*=\s*uuid\.UUID\("([0-9a-f-]{36})"\)/m.exec(seed)?.[1] ?? '';
    expect(ns, 'the seed has its name space (NS)').not.toBe('');
    const derived = execFileSync('python3', ['-I', '-c', 'import sys,uuid;print(uuid.uuid5(uuid.UUID(sys.argv[1]), sys.argv[2]))', ns, devIds['email']!], { encoding: 'utf8' }).trim();
    expect(derived, 'the new person\'s id is uuid5(NS, their email), as the seed derives it').toBe(devIds['employee']);
    expect(seed, 'and the seed derives it that way (uuid5 of NS and the email)').toMatch(/uuid\.uuid5\(NS,\s*ONB22_EMAIL\)|uuid\.uuid5\(NS,\s*['"]onb22/);
    expect(devIds['email'], 'the test person is a robot (test-domain address)').toMatch(/@blackhole\.postmarkapp\.com$/);
    expect(seed, 'its verification row carries the check Matches').toMatch(/MATCHES/);
  });

  // ---------------------------------------------------------------------------------------------- AC-8

  const block = (src: string, header: string): string => {
    const at = src.indexOf(header);
    if (at < 0) return '';
    const open = src.indexOf('{', at);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
    }
    return '';
  };
  const sq = (s: string) => s.replace(/^\s*(#|\/\/).*$/gm, '').replace(/\s+/g, '');
  const attr = (b: string, name: string) => new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, 'm').exec(b)?.[1]?.trim();
  const routeBlocks = () => [...text('infra/agent_api.tf').replace(/^\s*(#|\/\/).*$/gm, '').matchAll(/resource "aws_apigatewayv2_route" "(\w+)"/g)].map((m) => ({ name: m[1]!, raw: block(text('infra/agent_api.tf'), `resource "aws_apigatewayv2_route" "${m[1]}"`) }));
  const routeByKey = (key: string) => routeBlocks().find((r) => attr(r.raw, 'route_key') === `"${key}"`);

  test('AC-8 Routes: approve, decline and the HR list are on the JWT authorizer, the proposal and the agent\'s status read on the key authorizer, and every change is in place (text)', async ({}, testInfo) => {
    once(testInfo);
    const JWT = 'aws_apigatewayv2_authorizer.agent_api_cognito_jwt.id';
    const KEY = 'aws_apigatewayv2_authorizer.agent_api_key.id';
    const want: [string, 'JWT' | 'CUSTOM'][] = [
      ['POST /agent/v1/actions/{actionId}/approve', 'JWT'], ['POST /agent/v1/actions/{actionId}/reject', 'JWT'], ['GET /agent/v1/actions', 'JWT'],
      ['POST /agent/v1/proposals', 'CUSTOM'], ['GET /agent/v1/actions/{actionId}', 'CUSTOM'],
    ];
    for (const [key, type] of want) {
      const r = routeByKey(key);
      expect(r, `a route "${key}" is in infra/agent_api.tf`).toBeTruthy();
      expect(attr(r!.raw, 'authorization_type'), `${key}: ${type}`).toBe(`"${type}"`);
      expect(attr(r!.raw, 'authorizer_id'), `${key}: the ${type === 'JWT' ? 'Cognito sign-in' : 'agent key'} authorizer`).toBe(type === 'JWT' ? JWT : KEY);
    }
    // Where each route goes.
    const target = (key: string) => {
      const r = routeByKey(key)!;
      const integ = /integrations\/\$\{aws_apigatewayv2_integration\.(\w+)\.id\}/.exec(attr(r.raw, 'target') ?? '')?.[1];
      const ib = block(text('infra/agent_api.tf'), `resource "aws_apigatewayv2_integration" "${integ}"`);
      return /aws_lambda_function\.(\w+)\.invoke_arn/.exec(ib)?.[1];
    };
    expect(target('POST /agent/v1/proposals'), 'the proposal goes to createProposal').toBe(roleFn('createProposal'));
    expect(target('GET /agent/v1/actions'), 'HR\'s list goes to approveAgentAction').toBe(roleFn('approveAgentAction'));
    expect(target('POST /agent/v1/actions/{actionId}/approve'), 'approve still goes to approveAgentAction').toBe(roleFn('approveAgentAction'));
    expect(text('infra/agent_api.tf').replace(/^\s*(#|\/\/).*$/gm, ''), 'API Gateway may invoke createProposal').toMatch(new RegExp(`resource "aws_lambda_permission"[^{]*\\{[^}]*aws_lambda_function\\.${roleFn('createProposal')}\\.function_name`));
    // In place: the two existing routes keep their resource name, their key and their API, so Terraform updates them.
    for (const [name, key] of [['routeApprove', 'agent_action_approve'], ['routeReject', 'agent_action_reject']] as const) {
      const now = sq(block(text('infra/agent_api.tf'), `resource "aws_apigatewayv2_route" "${key}"`));
      expect(now, `aws_apigatewayv2_route.${key} is still there (not renamed, not removed: no delete, no replace)`).not.toBe('');
      expect((attr(block(text('infra/agent_api.tf'), `resource "aws_apigatewayv2_route" "${key}"`), 'route_key') ?? '').replace(/[\s"]/g, ''), `${key}: the same route key`).toBe(/route_key="([^"]+)"/.exec(baseline[name])?.[1]);
      expect(/api_id=([\w.]+)/.exec(now)?.[1], `${key}: the same API`).toBe(/api_id=([\w.]+)/.exec(baseline[name])?.[1]);
      expect(/target="([^"]+)"/.exec(now)?.[1], `${key}: the same target`).toBe(/target="([^"]+)"/.exec(baseline[name])?.[1]);
    }
    expect(sq(block(text('infra/agent_api.tf'), 'resource "aws_apigatewayv2_route" "agent_action_get"')), 'the agent\'s status read is as it was').toBe(baseline['routeGetAction']);
    const allTf = readdirSync(join(REPO, 'infra')).filter((f) => f.endsWith('.tf')).map((f) => text(`infra/${f}`).replace(/^\s*(#|\/\/).*$/gm, '')).join('\n');
    expect(allTf, 'no moved or removed block (nothing is replaced behind a rename)').not.toMatch(/^\s*(moved|removed)\s*\{[^}]*agent_action|^\s*removed\s*\{[^}]*(pending_actions|agent_action)/m);
    // CHAT-02 (child lock onb-22.3): the agent API's CORS may also allow DELETE, for Delete chat. Nothing else: no new header, no new origin.
    const corsNow = sq(block(text('infra/agent_api.tf'), 'cors_configuration'));
    const methodsOf = (c: string) => [...(/allow_methods=\[([^\]]*)\]/.exec(c)?.[1] ?? '').split(",")].map((m) => m.replace(/^"(.*)"$/, "$1")).filter(Boolean).sort();
    const stripMethods = (c: string) => c.replace(/allow_methods=\[[^\]]*\]/, 'allow_methods=[]');
    expect(stripMethods(corsNow), 'no new request header or origin: the agent API\'s CORS is as it was, apart from its method list').toBe(stripMethods(baseline['agentCors']));
    expect([methodsOf(corsNow).join(','), methodsOf(baseline['agentCors']).join(',')].map((x, i) => (i === 0 ? x.split(',').filter((m) => m !== 'DELETE').join(',') : x)), 'the methods are the old ones, plus DELETE only (CHAT-02)').toEqual([methodsOf(baseline['agentCors']).join(','), methodsOf(baseline['agentCors']).join(',')]);
  });

  const roleFn = (fn: string) => {
    const b = lambdaNamed(fn);
    return b.labels[1]!;
  };

  test('AC-8 The pending table gains one index and nothing else; a new function with its own role; the settings and the log group (text)', async ({}, testInfo) => {
    once(testInfo);
    const ddb = text('infra/dynamodb.tf');
    const table = block(ddb, 'resource "aws_dynamodb_table" "pending_actions"');
    const clean = table.replace(/^\s*(#|\/\/).*$/gm, '');
    expect(attr(clean, 'name'), 'the same table').toBe('"naleko-pending-actions"');
    expect(attr(clean, 'hash_key'), 'the same key').toBe('"actionId"');
    expect(clean.replace(/global_secondary_index\s*\{[^}]*\}/g, ''), 'no range key on the table itself (only the new index has one)').not.toMatch(/^\s*range_key\s*=/m);
    expect(/prevent_destroy\s*=\s*true/.test(clean), 'prevent_destroy stays').toBe(true);
    expect(/deletion_protection_enabled\s*=\s*true/.test(clean), 'deletion protection stays').toBe(true);
    expect(sq(/ttl\s*\{[^}]*\}/.exec(clean)?.[0] ?? ''), 'the TTL is as it was').toBe(/ttl\{[^}]*\}/.exec(baseline['pendingTable'])?.[0]);
    const gsis = [...clean.matchAll(/global_secondary_index\s*\{([^}]*)\}/g)].map((m) => m[1]!);
    expect(gsis.length, 'exactly one index is added').toBe(1);
    expect(attr(gsis[0]!, 'name'), 'tenant-index').toBe('"tenant-index"');
    expect(attr(gsis[0]!, 'hash_key'), 'on the company').toBe('"tenant_id"');
    expect(attr(gsis[0]!, 'range_key'), 'newest first by when it was made').toBe('"createdAt"');
    expect(attr(gsis[0]!, 'projection_type'), 'with everything the list shows').toMatch(/"ALL"|"INCLUDE"/);
    const attrs = [...clean.matchAll(/^\s*attribute\s*\{([^}]*)\}/gm)].map((m) => attr(m[1]!, 'name')?.replace(/"/g, '')).sort();
    expect(attrs, 'the attribute list holds the key and the two index keys, nothing else').toEqual(['actionId', 'createdAt', 'tenant_id']);
    const countNow = (allTfText().match(/resource "aws_dynamodb_table" "/g) ?? []).length;
    // Child lock onb-22.3: no table of this card, and only two tables of other cards are allowed on top: CHAT-02's ask-batsi-chats and ONB-21's reminders.
    const otherCards = ['ask_batsi_chats', 'reminders'].filter((n) => new RegExp(`resource "aws_dynamodb_table" "${n}"`).test(allTfText())).length;
    expect(countNow, 'no new table of this card (the count is the old one plus CHAT-02\'s chats table and ONB-21\'s reminders table, when they are there)').toBe((baseline['tableCount'] as number) + otherCards);
    // The new Lambda.
    const fn = lambdaNamed('createProposal');
    const a = (name: string) => attr(fn.body, name);
    expect([a('runtime'), a('memory_size'), a('timeout')], 'Node 22, 128 MB, 15 s').toEqual(['"nodejs22.x"', '128', '15']);
    const env = settingsOf(fn);
    for (const k of ['PENDING_ACTIONS_TABLE', 'EVENT_BUS_NAME', 'LEGACY_TENANT_ID', 'KMS_KEY_ARN']) expect([...env.keys()], `createProposal has the setting ${k}`).toContain(k);
    expect(text('infra/cloudwatch.tf'), 'its log group is in the list the neighbours use').toContain('/aws/lambda/createProposal');
    const approve = settingsOf(lambdaNamed('approveAgentAction'));
    for (const k of ['EVENT_BUS_NAME', 'REVIEW_FUNCTION_NAME']) expect([...approve.keys()], `approveAgentAction gains ${k}`).toContain(k);
    expect(approve.get('REVIEW_FUNCTION_NAME') ?? '', 'REVIEW_FUNCTION_NAME names the review function').toMatch(/review_document_verification\.function_name|"reviewDocumentVerification"/);
  });
  const allTfText = () => readdirSync(join(REPO, 'infra')).filter((f) => f.endsWith('.tf')).map((f) => text(`infra/${f}`).replace(/^\s*(#|\/\/).*$/gm, '')).join('\n');

  test('AC-8 IAM: createProposal holds only what it needs; approveAgentAction\'s existing policy is byte for byte and the new rights are a second policy; the MCP role reads one secret (text)', async ({}, testInfo) => {
    once(testInfo);
    // createProposal: logs, X-Ray, Put and Query on the pending table and its index, Get on three tables, Query and Scan on documents (findDocument), PutEvents on the bus.
    const cp = lambdaNamed('createProposal');
    const role = roleOf(cp);
    const actions = expectOnly(role, 'createProposal', (a, res) => {
      const c = common('createProposal', a, res);
      if (c !== undefined) return c;
      if (a === 'dynamodb:PutItem') return res.every((r) => /pending_actions/.test(r)) ? null : `${a} only on the pending actions table and its index`;
      // ONB-22.1 (M-2): findDocument reads the company index with a Query, and the founding company's documents with a Scan (until TEN-02 step 2).
      if (a === 'dynamodb:Query') return res.every((r) => /pending_actions/.test(r) || /aws_dynamodb_table\.documents\.arn\}?(\/index\/tenant-index)?$/.test(r)) ? null : `${a} only on the pending actions table and the documents table and its company index`;
      if (a === 'dynamodb:Scan') return res.every((r) => /aws_dynamodb_table\.documents\.arn$/.test(r)) ? null : `${a} only on the documents table`;
      if (a === 'dynamodb:GetItem') return res.every((r) => /aws_dynamodb_table\.(documents|document_verification|employees)\.arn$/.test(r)) ? null : 'GetItem only on documents, document-verification and employees';
      if (a === 'events:PutEvents') return res.every((r) => /event_bus/i.test(r)) ? null : 'PutEvents only on the onboarding bus';
      return 'an action this Lambda has no use for';
    });
    expect(sorted([...new Set(actions)]), 'exactly the actions of "What gets built" 16').toEqual(sorted(['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents', 'xray:PutTraceSegments', 'xray:PutTelemetryRecords', 'dynamodb:PutItem', 'dynamodb:Query', 'dynamodb:Scan', 'dynamodb:GetItem', 'events:PutEvents']));
    // approveAgentAction: the old policy is untouched; the new one is separate.
    const iam = text('infra/iam_per_lambda.tf');
    expect(sq(block(iam, 'resource "aws_iam_role_policy" "approve_agent_action"')), 'the existing policy resource is byte for byte (ten-02 pins it)').toBe(baseline['approvePolicy']);
    // P10: the same holds for the two other roles ten-02 pins. summariseVerification and the MCP role keep their policy as it was; what they
    // gain (the employees read, the real secret name) is a second policy resource on the same role.
    expect(sq(block(iam, 'resource "aws_iam_role_policy" "summarise_verification"')), 'summariseVerification\'s existing policy is byte for byte').toBe(baseline['summarisePolicy']);
    expect(sq(block(iam, 'resource "aws_iam_role_policy" "naleko_mcp_server"')), 'the MCP role\'s existing policy is byte for byte').toBe(baseline['mcpPolicy']);
    for (const fn of ['summariseVerification', 'nalekoMcpServer']) {
      const r = roleOf(lambdaNamed(fn));
      const own = resources('aws_iam_role_policy').filter((b) => new RegExp(`^aws_iam_role\\.${r}\\.(name|id)$`).test(attr(b.body, 'role') ?? ''));
      expect(own.length, `${fn}: the new rights are a second policy resource on its role`).toBeGreaterThanOrEqual(2);
    }
    // ONB-22.1 (checker): the two small second policies hold exactly one right each, nothing more (a Scan or a PutItem here would pass the count above).
    const statementsOf = (policy: string) => {
      const b = resources('aws_iam_role_policy').find((x) => x.labels[1] === policy);
      expect(b, `the policy resource ${policy} exists`).toBeDefined();
      const r: TfResource = { type: 'aws_iam_role_policy', name: policy, raw: b!.raw, body: b!.body, attrs: attributes(b!.body) };
      const doc = policyOf(r) as unknown as { Statement: any };
      return (Array.isArray(doc.Statement) ? doc.Statement : [doc.Statement]) as Array<{ Effect?: string; Action?: string | string[]; Resource?: string | string[]; Condition?: unknown; NotAction?: unknown; NotResource?: unknown }>;
    };
    const emp = statementsOf('summarise_verification_employees');
    expect(emp.map((x) => [x.Effect, sorted(list(x.Action)), sorted(list(x.Resource).map((r) => r.replace(/\$\{|\}/g, '')))]), 'summariseVerification\'s second policy: Allow dynamodb:GetItem on the employees table and nothing else').toEqual([['Allow', ['dynamodb:GetItem'], ['aws_dynamodb_table.employees.arn']]]);
    const keyPolicy = statementsOf('naleko_mcp_server_agent_key');
    expect(keyPolicy.length, 'the MCP key policy has one statement').toBe(1);
    expect(keyPolicy[0]!.Effect, 'Allow').toBe('Allow');
    expect(sorted(list(keyPolicy[0]!.Action)), 'exactly secretsmanager:GetSecretValue').toEqual(['secretsmanager:GetSecretValue']);
    expect(list(keyPolicy[0]!.Resource).length, 'on one secret').toBe(1);
    expect(list(keyPolicy[0]!.Resource)[0], 'the real one, naleko/agent/api-key, and no wildcard beyond the version suffix').toMatch(/:secret:naleko\/agent\/api-key\*?$/);
    for (const st of [...emp, ...keyPolicy]) {
      expect(st.NotAction ?? st.NotResource, 'no NotAction or NotResource').toBeUndefined();
      expect(st.Condition, 'no condition that could widen it').toBeUndefined();
    }
    const approveRole = roleOf(lambdaNamed('approveAgentAction'));
    const mine = resources('aws_iam_role_policy').filter((b) => new RegExp(`^aws_iam_role\\.${approveRole}\\.(name|id)$`).test(attr(b.body, 'role') ?? ''));
    expect(mine.length, 'the role has a second inline policy resource').toBeGreaterThanOrEqual(2);
    const extra = mine.filter((b) => b.labels[1] !== 'approve_agent_action');
    expect(extra.length, 'the new rights are in their own resource').toBeGreaterThanOrEqual(1);
    const seen = new Set<string>();
    for (const b of extra) {
      const doc = JSON.stringify(b.body);
      expect(doc, 'no wildcard action in the new policy').not.toMatch(/"[a-z0-9]+:\*"|Action\s*=\s*"\*"/i);
    }
    const g = grants(approveRole);
    const added = g.statements.filter((s) => !JSON.stringify(s).includes('AgentApiKeyRead') && !/PendingActionsReadWrite|"Logs"|"XRay"/.test(JSON.stringify(s)));
    for (const s of added) {
      for (const a of list(s.Action)) {
        seen.add(a);
        expect(a, `approveAgentAction: ${a} has no wildcard`).not.toMatch(/\*/);
        const res = list(s.Resource);
        if (a === 'lambda:InvokeFunction') expect(res.every((r) => /review_document_verification\.arn$/.test(r)), 'it may invoke the review function and nothing else').toBe(true);
        else if (a.startsWith('xray:')) continue;
        else expect(res.includes('*'), `${a}: no "*" resource`).toBe(false);
      }
    }
    expect(sorted([...seen].filter((a) => !a.startsWith('xray:') && !a.startsWith('logs:'))), 'the new rights are exactly these').toEqual(sorted(['dynamodb:Query', 'dynamodb:GetItem', 'dynamodb:UpdateItem', 'events:PutEvents', 'lambda:InvokeFunction']));
    // The KMS lists.
    const kms = text('infra/kms.tf').replace(/^\s*(#|\/\/).*$/gm, '');
    expect(sq(/allowed_role_arns\s*=\s*\[([\s\S]*?)\]/.exec(kms)?.[1] ?? ''), 'allowed_role_arns gains nothing').toBe(baseline['kmsAllowed']);
    const reads = (/dynamodb_read_role_arns\s*=\s*\[([\s\S]*?)\n\s*\]/.exec(kms)?.[1] ?? '').split('\n').map((l) => l.trim().replace(/,$/, '')).filter(Boolean);
    // Child lock onb-22.3: the roles of other cards that read tables behind the PII key may also be listed: CHAT-02's two (ask_batsi_chats, admin_set_ask_batsi) and ONB-21's reminder sender.
    // Child lock onb-22.7: and the onboarding state machine's role (ONB-11 AC-11), which stores a task token on the employees row through DynamoDB and so needs to decrypt through it.
    const OTHER_CARDS = ['aws_iam_role.ask_batsi_chats.arn', 'aws_iam_role.admin_set_ask_batsi.arn', 'aws_iam_role.send_document_reminders.arn', 'aws_iam_role.sfn_onboarding.arn',
      // Child lock onb-22.8 (CHAT-15): the hourly leaver-chats job's role (TalentFlow stack, so a quoted ARN with the role path) may also be listed; chat-15.spec.ts AC-12 pins it exactly.
      '"arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-deleteLeaverChats"',
      // Child lock onb-22.9 (REC-02): the recordNotHired role (TalentFlow stack, quoted ARN with the role path) may also be listed; chat-15.spec.ts AC-12 lets it in at most once.
      '"arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-recordNotHired"',
      // Child lock rec-04.1 (REC-04): the manageRoles role likewise (added one merge after the role exists); chat-15.spec.ts AC-12 lets it in at most once.
      '"arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-manageRoles"'];
    const addedRoles = reads.filter((l) => !(baseline['kmsReadRoles'] as string[]).includes(l) && !OTHER_CARDS.includes(l)).sort();
    expect(addedRoles, 'dynamodb_read_role_arns gains exactly the four roles (and, apart from them, only the four roles of CHAT-02, ONB-21 and ONB-11)').toEqual(['createProposal', 'approveAgentAction', 'queryAuditLog', 'summariseVerification'].map((f) => `aws_iam_role.${roleOf(lambdaNamed(f))}.arn`).sort());
    expect((baseline['kmsReadRoles'] as string[]).filter((l) => !reads.includes(l)), 'and takes none away').toEqual([]);
    // summariseVerification reads the employee for the email.
    const sumRole = roleOf(lambdaNamed('summariseVerification'));
    const sumGets = grants(sumRole).statements.filter((s) => list(s.Action).includes('dynamodb:GetItem')).flatMap((s) => list(s.Resource));
    expect(sumGets.some((r) => /aws_dynamodb_table\.employees\.arn$/.test(r)), 'summariseVerification may read the employees table (one GetItem)').toBe(true);
  });

  test('AC-8 Every DynamoDB call createProposal makes is covered by its own Terraform policy, for a company with its own rows and for the founding company; it reads only the name fields (Lambda and text)', async ({}, testInfo) => {
    once(testInfo);
    // ONB-22.1 (M-2). The fake AWS does not enforce IAM, so a role that is too small passes every other test and fails on the real stack with a 500.
    // Here the calls the code really makes are read from the run, and each one must have an Allow in createProposal's policy.
    const own = propose('agentA', accept(D.nomsaBank));
    const founding = propose('agentA', accept(D.nomsaBank), tables(), { env: { LEGACY_TENANT_ID: A } });
    const again = propose('agentA', accept(D.nomsaBank), own.tables);
    for (const [name, run, code] of [['own rows', own, 201], ['the founding company', founding, 201], ['a second proposal', again, 409]] as [string, Run, number][]) expect(statusOf(run), `${name}: the proposal answers ${code} (${describe(run)})`).toBe(code);
    const TABLES: Record<string, string> = { 'naleko-pending-actions': 'pending_actions', documents: 'documents', 'document-verification': 'document_verification', employees: 'employees' };
    const stmts = grants(roleOf(lambdaNamed('createProposal'))).statements;
    const arnOf = (r: string) => r.replace(/\$\{|\}/g, '');
    const allowed = (op: string, table: string, index?: string) => {
      const tf = TABLES[table];
      if (!tf) return false;
      return stmts.some((s) => list(s.Action).includes(`dynamodb:${op}`) && list(s.Resource).map(arnOf).some((r) => (index ? new RegExp(`^aws_dynamodb_table\\.${tf}\\.arn/index/(\\*|${index})$`).test(r) : r === `aws_dynamodb_table.${tf}.arn`)));
    };
    const made = new Set<string>();
    for (const run of [own, founding, again]) {
      // The audit consumer runs in the same fake process and writes the audit table: that is its own Lambda's right, not createProposal's.
      for (const c of run.calls.filter((x) => x.service === 'dynamodb' && x.table !== 'onboarding-events')) {
        const key = `${c.op} ${c.table}${c.input?.IndexName ? '/' + c.input.IndexName : ''}`;
        made.add(key);
        expect(allowed(c.op!, c.table ?? '', c.input?.IndexName), `createProposal's policy allows ${key} (the code makes this call)`).toBe(true);
      }
    }
    expect([...made].some((k) => k.startsWith('Scan documents')), 'the founding company\'s run does reach the documents Scan (so the right is tested, not assumed)').toBe(true);
    expect([...made].some((k) => /idempotency/i.test(k)), 'and no idempotency table is used').toBe(false);
    // S-2: only the name fields (and the company field the ownership check needs) are read from the employee.
    for (const run of [own, founding]) {
      const gets = run.calls.filter((c) => c.service === 'dynamodb' && c.op === 'GetItem' && c.table === 'employees');
      expect(gets.length, 'one read of the employee').toBe(1);
      const input = gets[0]!.input ?? {};
      const names = input.ExpressionAttributeNames ?? {};
      const read = String(input.ProjectionExpression ?? '').split(',').map((x: string) => x.trim()).filter(Boolean).map((x: string) => names[x] ?? x);
      expect(sorted(read), 'the employee read names its fields: first_name, last_name and tenant_id only').toEqual(['first_name', 'last_name', 'tenant_id']);
    }
  });

  // ---------------------------------------------------------------------------------------------- AC-9

  test('AC-9 queryAuditLog answers the type from detailType and still from eventType, filters by company, and a row with neither says nothing (Lambda)', async ({}, testInfo) => {
    once(testInfo);
    const t = tables();
    t['onboarding-events'] = [
      row({ eventId: 'ev-1', timestamp: ISO(12), employeeId: P.nomsa.id, detailType: 'document.reviewed', source: 'naleko.onboarding', actor: 'HUMAN', detail: JSON.stringify({ decided_by_name: 'Thandi Mokoena' }), tenant_id: A }),
      row({ eventId: 'ev-2', timestamp: ISO(13), employeeId: P.nomsa.id, eventType: 'document_reviewed', actor: 'AGENT', detail: '{}', tenant_id: A }),
      row({ eventId: 'ev-3', timestamp: ISO(14), employeeId: P.nomsa.id, detailType: 'proposal.created', actor: 'AGENT', detail: '{}', tenant_id: B }),
      row({ eventId: 'ev-4', timestamp: ISO(15), employeeId: P.nomsa.id, actor: 'HUMAN', detail: '{}', tenant_id: A }),
    ];
    const r = call('queryAuditLog', 'agentA', { path: '/agent/v1/audit-log', query: { employeeId: P.nomsa.id } }, { tables: t });
    expect(statusOf(r), `200 (${describe(r)})`).toBe(200);
    const events = bodyOf(r).events as any[];
    expect(events.map((e) => e.eventId).sort(), 'company A\'s events only').toEqual(['ev-1', 'ev-2', 'ev-4']);
    const one = events.find((e) => e.eventId === 'ev-1');
    expect(one, 'a row that has only detailType: the type is its detailType, the actor is filled').toMatchObject({ eventType: 'document.reviewed', actor: 'HUMAN', employeeId: P.nomsa.id });
    expect(events.find((e) => e.eventId === 'ev-2'), 'a row that has only the old eventType keeps it').toMatchObject({ eventType: 'document_reviewed', actor: 'AGENT' });
    expect(events.find((e) => e.eventId === 'ev-4')?.eventType ?? null, 'a row with neither has no type, not a made-up one').toBeNull();
    const b = call('queryAuditLog', 'agentB', { path: '/agent/v1/audit-log', query: { employeeId: P.nomsa.id } }, { tables: t });
    expect((bodyOf(b).events as any[]).map((e) => e.eventId), 'the agent of B sees B\'s row only').toEqual(['ev-3']);
  });

  test('AC-9 getEmployee answers VERIFIED for a Verified person and keeps every old key; its errors, and the new Lambdas\', log error names only (Lambda)', async ({}, testInfo) => {
    once(testInfo);
    const t = tables();
    t.employees = t.employees!.map((e) => (plain(e)['employee_id'] === P.nomsa.id ? row({ ...(plain(e) as any), stage: 'VERIFIED', step: 'VERIFIED', riskBand: 'LOW', riskReason: 'Agrees.', updated_at: ISO(13) }) : e));
    const ok = call('getEmployee', 'agentA', { path: `/agent/v1/employees/${P.nomsa.id}`, route: '/agent/v1/employees/{id}', pathParameters: { id: P.nomsa.id } }, { tables: t });
    expect(bodyOf(ok).employee, 'a Verified person: step VERIFIED, every old key still there').toMatchObject({ step: 'VERIFIED', stage: 'VERIFIED', risk_band: 'LOW', risk_reason: 'Agrees.', updated_at: ISO(13), first_name: 'Nomsa' });
    for (const k of OLD_EMPLOYEE_KEYS) expect(bodyOf(ok).employee, `the old key ${k}`).toHaveProperty(k);
    // Errors: names only, in the log and in the answer.
    const fail = { service: 'dynamodb', message: 'SECRET-MESSAGE-TEXT arn:aws:kms:af-south-1:424556617428:key/abc', name: 'AccessDeniedException' };
    const cases: [string, Run][] = [
      ['getEmployee', call('getEmployee', 'agentA', { path: `/agent/v1/employees/${P.nomsa.id}`, route: '/agent/v1/employees/{id}', pathParameters: { id: P.nomsa.id } }, { fail })],
      ['createProposal', call('createProposal', 'agentA', { ...PROPOSALS, body: accept(D.nomsaBank) }, { fail })],
      ['approveAgentAction (approve)', decide('approve', 'hrA', 'act-onb22-0001', withPending([pending({ id: 'act-onb22-0001' })]), undefined, { fail })],
      ['approveAgentAction (list)', call('approveAgentAction', 'hrA', { path: '/agent/v1/actions', route: '/agent/v1/actions' }, { tables: withPending([pending()]), fail })],
      ['queryAuditLog', call('queryAuditLog', 'agentA', { path: '/agent/v1/audit-log', query: { employeeId: P.nomsa.id } }, { fail })],
    ];
    for (const [name, r] of cases) {
      expect(r.error, `${name}: it answers, it does not throw`).toBeUndefined();
      expect(statusOf(r), `${name}: a 5xx (${describe(r)})`).toBeGreaterThanOrEqual(500);
      expect(JSON.stringify(r.response), `${name}: the answer holds no exception text`).not.toMatch(/SECRET-MESSAGE-TEXT|424556617428|arn:aws/);
      expect(logLines(r.calls).join('\n'), `${name}: no exception text in the log`).not.toMatch(/SECRET-MESSAGE-TEXT|424556617428|arn:aws/);
      expect(logLines(r.calls).join('\n'), `${name}: the error's name is in the log`).toContain('AccessDeniedException');
    }
  });

  // ---------------------------------------------------------------------------------------------- AC-10

  test('AC-10 Nothing else moves: the review, the single read, the file link and the sign-in code are not edited (hash)', async ({}, testInfo) => {
    once(testInfo);
    // ONB-22.2 (19 Nov 2026): ONB-14 (NH-182, its AC-4 and security review C-1) takes id_number and account_number out of the
    // single-verification answer, so that one file may also be exactly ONB-14's version (PR 429 at 4ec4147). Any other edit of
    // it, and any edit of the other four files, still fails.
    const alsoAllowed: Record<string, string[]> = {
      'lambda/getSingleDocumentVerification/index.mjs': ['c3b9ffb0c78bdae0a8192dff7936bb52e6d3ba5187cbf884980b1fc8c1c0ac72'],
    };
    for (const [file, sha] of Object.entries(baseline['hashes'] as Record<string, string>)) {
      const now = createHash('sha256').update(readFileSync(join(REPO, file))).digest('hex');
      expect([sha, ...(alsoAllowed[file] ?? [])], `${file} is as it was (a hash of develop ${baseline['commit']}${alsoAllowed[file] ? ', or ONB-14\'s version' : ''}): it is run by the new code, not edited`).toContain(now);
    }
    for (const spec of ['ten-02', 'ten-04', 'be-17.1', 'be-18', 'be-19', 'be-20', 'onb-15', 'onb-20', 'ops-05']) {
      expect(existsSync(join(here, `${spec}.spec.ts`)), `${spec}.spec.ts is in the folder, and the builder runs it before the PR`).toBe(true);
    }
  });
});
