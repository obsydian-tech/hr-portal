import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { LAMBDA, REPO, logLines, runHandler, runScript, type Row, type Run, type Tables } from './support/ten-03/lambda-harness';
import {
  A, B, ID, NAME, SUB, TABLE, TENANTS, av, ask, authorizerOf, bodyOf, calls, describe, plain, rowsOf, runEvent, sentText, settings, statusOf, tables, type Ask,
} from './support/ten-03/world';
import { ROUTES } from './support/ten-03/routes';
import { attributes, blocks } from './support/infra-harness';
import { isCardGrant } from './support/ten-04.2/grants';
import { policyOf, squash as tfSquash } from './support/onb-15/tf-policy';
import { devEnv } from './support/ten-02/dev';
import { legacyWorld } from './support/ten-03/legacy';
import { changed, masked, notReads, sent, withB, wrote } from './support/ten-03/checks';

/**
 * TEN-03 · TalentFlow and IT routes take the company only from the sign-in (Jira NH-195, epic NH-192).
 * Red. One test per acceptance criterion, written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/TEN-03.md (16 Nov 2026, amended 17 Nov). Notes: TEN-03-tests-for-review.md.
 *
 * The Lambda tests run the real handlers, each call in its own Node process, against a fake AWS (support/ten-03/fake-aws,
 * copied from TEN-02's and added to: SQS, Lambda and Step Functions clients, and the CommonJS hook the TalentFlow,
 * IT and bundle handlers need). Company A is the founding company; B is a second company. No run sets a legacy
 * company: a token without tenant_id belongs to nobody. Any AI client fails; outbound HTTP is refused.
 * AC-2 (second half), AC-9 and AC-10 read code, Terraform and client files as text. AC-11 runs on pepla-dev only.
 *
 * Pinned by the verifier (written down in the notes):
 *  - P1 Order: CORS OPTIONS, the group or role check the route has today, the company check (403 {"error":"Forbidden"}
 *    without tenant_id), then everything else. The tests give every caller every role, so only the company is judged.
 *  - P2 Another company's record, tile, task or bundle answers 404 {"error":"Not found"} to every caller, with no
 *    write and no call to any service but DynamoDB reads. Tiles are judged through the candidate they name.
 *  - P3 A request that names company B (query, body, headers) gets exactly the answer it gets when it names A.
 *  - P4 Rows a route writes carry tenant_id; the TalentFlow keys that embed TENANT#<id> use the token's company.
 *  - P5 The move script: node scripts/tenancy/move-default.mjs --env dev|prod --tenant <id> [--profile x] [--apply | --check].
 *    Dry run by default, counts only on output. Tables are the fixed TalentFlow, IT and bundle table names.
 * Nothing here calls AWS or any AI. Locked once accepted: see cards/ten-03.md.
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS or reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};
const NOT_FOUND = { error: 'Not found' };
const FORBIDDEN = { error: 'Forbidden' };
/** Pinned (P6): Step 0 cannot be read from the cloud, so the test assumes TalentFlow pool tokens do reach the API (the old app signs in with that pool). Flip only through a re-lock if Step 0 says they never do. */
const TALENTFLOW_TOKENS_REACH_API = true;
const PEOPLE = /John|Doe\b|Jane|Smith|Bea\b|Ndlovu|Sipho|Khumalo|Pia\b|Paul\b|@example\.test/;
/** Events a run put on the bus, as { DetailType, Detail (text) }. */
const putEvents = (r: Run) => (r.calls as any[]).filter((c) => c.service === 'events' && c.op === 'PutEvents').map((c) => ({ DetailType: c.detailType as string, Detail: JSON.stringify(c.detail) }));
const ev = (detail: Record<string, unknown>) => ({ source: 'talent-flow.test', 'detail-type': 'TEN03', detail });
const stream = (image: Record<string, unknown>) => ({ Records: [{ eventID: 'ev-1', eventName: 'MODIFY', dynamodb: { NewImage: image } }] });
/** A candidate SAGA row as a stream hands it over (company A's, or none), with extra attributes. */
function sagaImage(company: string | null, extra: Record<string, string> = {}): Record<string, unknown> {
  const base = (tables()[TABLE.state] ?? []).find((r) => plain(r)['PK'] === `CANDIDATE#${ID.a1}` && plain(r)['SK'] === 'SAGA')!;
  const out: Record<string, unknown> = { ...base, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, { S: v }])) };
  if (company === null) for (const k of ['tenant_id', 'tenantId', 'GSI1PK', 'GSI1SK']) delete out[k];
  return out;
}
/** createItTask's EventBridge detail for a provisioning bundle of company `c` (company under tenant_id only). */
function itDetail(c: string, cand = ID.a1): Record<string, unknown> {
  return { bundleId: c === A ? ID.bundleA : ID.bundleB, candidateId: cand, tenant_id: c, candidateName: NAME.a1, candidateRole: 'Junior baker', seniority: 'MID', department: 'Operations', startDate: '2026-12-01', approvedBy: SUB.hmA, items: [{ type: 'LAPTOP', label: 'Laptop', queue: 'Laptops' }] };
}
const EVERY = [B, NAME.b1, NAME.b2, 'weights of B', ID.b1, ID.b2];

// ---------------------------------------------------------------- AC-1

test.describe('TEN-03 · TalentFlow and IT routes take the company only from the sign-in', () => {
  const AC1 = ['getCandidates', 'createOffer', 'getIntelligenceTiles', 'dismissTile', 'manageTalentFlowConfig', 'getItTasks', 'captureSentiment', 'markNotificationRead', 'generateScoringLink'];

  test('Control: every route works for its own company', async ({}, testInfo) => {
    once(testInfo.project.name);
    // Not an acceptance criterion: it keeps every other test honest. A request that is wrong in itself would make a
    // refusal look right, so each route must answer 2xx for the company that owns the record, today and after the build.
    for (const route of ROUTES) {
      const r = ask(route.handler, route.caller ?? 'staffA', route.own);
      expect.soft([200, 201].includes(statusOf(r) ?? 0), `${route.name} for its own company answers 2xx (got ${describe(r)})`).toBe(true);
    }
  });

  test('AC-1 The request cannot choose the company', async ({}, testInfo) => {
    once(testInfo.project.name);
    for (const route of ROUTES.filter((r) => AC1.includes(r.handler))) {
      const caller = route.caller ?? 'staffA';
      const plainAsk = ask(route.handler, caller, route.own);
      const asB = ask(route.handler, caller, withB(route.own));
      const label = `${route.name} as company A naming B`;
      expect.soft(statusOf(asB), `${label}: the answer is the one for A's own request (got ${describe(asB)})`).toBe(statusOf(plainAsk));
      expect.soft(masked(bodyOf(asB)), `${label}: the same answer as when it names A`).toBe(masked(bodyOf(plainAsk)));
      expect.soft(sent(asB), `${label}: no recorded key, filter or value names B`).not.toContain(B);
      for (const w of EVERY) expect.soft(JSON.stringify(bodyOf(asB)), `${label}: the answer holds none of B's data (${w})`).not.toContain(w);
      for (const c of changed(tables(), asB.tables)) {
        expect.soft(JSON.stringify(c.row), `${label}: ${c.table} row written holds nothing of B`).not.toContain(B);
      }
    }
    // The list routes show A's people and nobody of B's.
    const list = ask('getCandidates', 'staffA', { query: { tenantId: B } });
    expect.soft(statusOf(list), `getCandidates naming B: 200 (got ${describe(list)})`).toBe(200);
    expect.soft(JSON.stringify(bodyOf(list)), 'getCandidates naming B lists A\'s candidate').toContain(ID.a1);
    const tasks = ask('getItTasks', 'itA', { query: { tenantId: B } });
    expect.soft(JSON.stringify(bodyOf(tasks)), 'getItTasks naming B lists A\'s tasks').toContain('task-a-0001');
    expect.soft(JSON.stringify(bodyOf(tasks)), 'getItTasks naming B lists none of B\'s').not.toContain('task-b-0001');
    // A caller of B is served B's data from the sign-in alone, with a request that names A.
    const fromB = ask('getCandidates', 'staffB', { query: { tenantId: A } });
    expect.soft(JSON.stringify(bodyOf(fromB)), 'getCandidates as company B naming A lists B\'s own').toContain(ID.b1);
    expect.soft(JSON.stringify(bodyOf(fromB)), 'getCandidates as company B naming A lists none of A\'s').not.toContain(ID.a1);
  });

  // ---------------------------------------------------------------- AC-2

  test('AC-2 No DEFAULT: a token without a company is refused', async ({}, testInfo) => {
    once(testInfo.project.name);
    for (const route of ROUTES) {
      const caller = route.caller === 'itA' ? 'noTenantIt' : 'noTenant';
      const r = ask(route.handler, caller, route.own);
      expect.soft(statusOf(r), `${route.name} without tenant_id: 403 (got ${describe(r)})`).toBe(403);
      expect.soft(bodyOf(r), `${route.name} without tenant_id: {"error":"Forbidden"}`).toEqual(FORBIDDEN);
      expect.soft(calls(r).map((c) => `${c.service} ${c.op}${c.table ? ' ' + c.table : ''}`), `${route.name} without tenant_id: no AWS call`).toEqual([]);
    }
  });

  test('AC-2 No DEFAULT or NALEKO as a company in code or Terraform', async ({}, testInfo) => {
    once(testInfo.project.name);
    const files = handlerFiles();
    expect(files.length, 'the handler files are found').toBeGreaterThan(40);
    for (const f of files) {
      const code = stripComments(readFileSync(f, 'utf8'));
      const rel = f.slice(REPO.length + 1);
      expect.soft(code.match(/['"`]DEFAULT['"`]|TENANT#DEFAULT/g) ?? [], `${rel} names no DEFAULT company`).toEqual([]);
      expect.soft(code.match(/['"`]NALEKO['"`]|TENANT#NALEKO/g) ?? [], `${rel} names no NALEKO company`).toEqual([]);
    }
    for (const must of ['config-reader.js']) {
      const copies = files.filter((f) => f.endsWith(`/${must}`));
      expect(copies.length, 'the config-reader copies are among the files checked').toBeGreaterThanOrEqual(6);
    }
    const toolResolver = stripComments(readFileSync(join(LAMBDA, 'talentFlowAiChat', 'tool-resolver.mjs'), 'utf8'));
    expect.soft(toolResolver.match(/NALEKO/g) ?? [], 'tool-resolver.mjs names no NALEKO company').toEqual([]);
    const tf = readdirSync(join(REPO, 'talent-flow-infra')).filter((f) => f.endsWith('.tf')).map((f) => stripTfComments(readFileSync(join(REPO, 'talent-flow-infra', f), 'utf8'))).join('\n');
    expect.soft(tf.match(/TENANT_ID\s*=\s*"[^"]*NALEKO[^"]*"/g) ?? [], 'no TalentFlow Terraform TENANT_ID is NALEKO').toEqual([]);
    expect.soft(tf.match(/TENANT_ID\s*=\s*"DEFAULT"/g) ?? [], 'no TalentFlow Terraform TENANT_ID is DEFAULT').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-3

  test('AC-3 A record by id of another company is not found', async ({}, testInfo) => {
    once(testInfo.project.name);
    const byId = ROUTES.filter((r) => r.byId);
    expect(byId.length, 'the by-id routes are listed').toBeGreaterThan(20);
    for (const route of byId) {
      const caller = route.caller === 'itA' ? 'staffB' : 'staffB';
      const before = tables();
      const r = ask(route.handler, caller, route.own, { tables: before });
      expect.soft(statusOf(r), `${route.name} by company B aimed at A's record: 404 (got ${describe(r)})`).toBe(404);
      expect.soft(bodyOf(r), `${route.name}: {"error":"Not found"}`).toEqual(NOT_FOUND);
      expect.soft(notReads(r).map((c: any) => `${c.service} ${c.op}`), `${route.name}: no write and no call but DynamoDB reads`).toEqual([]);
      expect.soft(wrote(before, r.tables), `${route.name}: no row changed`).toBe(false);
      for (const w of [NAME.a1, NAME.a2, 'weights of A']) expect.soft(JSON.stringify(bodyOf(r)), `${route.name}: nothing of A's in the answer (${w})`).not.toContain(w);
    }
    // The answer for B's own record is still 2xx (the control: B has records, the route works for B).
    const own = ask('getCandidate', 'staffB', { path: { id: ID.b1 } });
    expect.soft(statusOf(own), `B reads B's own candidate (got ${describe(own)})`).toBe(200);
    const ownTask = ask('getItTask', 'staffB', { path: { taskId: ID.taskB } });
    expect.soft(statusOf(ownTask), `B reads B's own IT task (got ${describe(ownTask)})`).toBe(200);
    const unknown = ask('getCandidate', 'staffA', { path: { id: 'CAND-DOES-NOT-EXIST' } });
    const foreign = ask('getCandidate', 'staffB', { path: { id: ID.a1 } });
    expect.soft(statusOf(foreign), 'another company\'s candidate answers with the status of one that does not exist (no way to tell them apart)').toBe(statusOf(unknown));
    expect.soft(JSON.stringify(bodyOf(foreign)), 'and its answer does not name the candidate').not.toContain(ID.a1);
  });

  test('AC-3 An update that loses the company race answers 404', async ({}, testInfo) => {
    once(testInfo.project.name);
    // The row is A's when the route reads it and B's when it writes: the write's condition must fail and the route answer 404.
    // Routes that write with UpdateItem today; if a build writes another way the row is not flipped and the route is skipped.
    const RACE: { handler: string; table: string }[] = [
      { handler: 'updateCandidate', table: TABLE.state }, { handler: 'captureSentiment', table: TABLE.state }, { handler: 'advanceOfferState', table: TABLE.state },
      { handler: 'claimItTask', table: TABLE.itTasks }, { handler: 'completeItTask', table: TABLE.itTasks }, { handler: 'releaseItTask', table: TABLE.itTasks },
      { handler: 'approveProvisioningBundle', table: TABLE.bundles }, { handler: 'updateProvisioningBundle', table: TABLE.bundles }, { handler: 'markNotificationRead', table: TABLE.notifications },
    ];
    let flipped = 0;
    for (const { handler, table } of RACE) {
      const route = ROUTES.find((r) => r.handler === handler)!;
      const run = ask(handler, route.caller ?? 'staffA', route.own, { flipOnUpdate: { table, set: { tenant_id: { S: B }, tenantId: { S: B } } } });
      const seeded = rowsOf(tables(), table);
      const row = rowsOf(run.tables, table).filter((r) => r['tenant_id'] === B && !seeded.some((x) => JSON.stringify(x) === JSON.stringify(r)));
      if (!row.length) continue;
      flipped++;
      expect.soft(statusOf(run), `${handler}: the row became B's before the write, so 404 (got ${describe(run)})`).toBe(404);
      // The row is as it was seeded but for the company the flip set: the write itself changed nothing.
      const noCompany = (r: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'tenant_id' && k !== 'tenantId').sort(([x], [y]) => x.localeCompare(y))));
      for (const r of row) expect.soft(seeded.some((x) => noCompany(x) === noCompany(r)), `${handler}: the write changed nothing of the row but the flip`).toBe(true);
    }
    expect(flipped, 'the race was staged for at least some routes').toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------- AC-4

  test('AC-4 New records carry the company', async ({}, testInfo) => {
    once(testInfo.project.name);
    const rowsOfRun = (r: Run) => changed(tables(), r.tables);
    const eventsOf = (r: Run) => putEvents(r);
    // Every route that writes, as company A, naming B everywhere a client could: every new or changed row, in every table, is A's.
    for (const route of ROUTES.filter((x) => x.writes)) {
      const r = ask(route.handler, route.caller ?? 'staffA', withB(route.own));
      for (const c of rowsOfRun(r)) {
        if (c.table === TABLE.idempotency) continue;
        expect.soft(c.row['tenant_id'], `${route.name}: ${c.table} row ${c.row['PK'] ?? c.row['taskId'] ?? c.row['bundleId'] ?? c.row['actionId']}/${c.row['SK'] ?? ''} carries tenant_id A`).toBe(A);
        expect.soft(JSON.stringify(c.row), `${route.name}: ${c.table} row holds no other company`).not.toMatch(/DEFAULT|NALEKO|ten_b/);
      }
      for (const e of eventsOf(r)) {
        const detail = JSON.parse(e.Detail ?? '{}');
        expect.soft(detail['tenant_id'], `${route.name}: the ${e.DetailType} event carries tenant_id A`).toBe(A);
        expect.soft(e.Detail, `${route.name}: the ${e.DetailType} event names no other company`).not.toMatch(/DEFAULT|NALEKO|ten_b/);
      }
    }
    // createCandidate: the key that holds the company is the token's.
    const created = ask('createCandidate', 'staffA', withB(ROUTES.find((x) => x.handler === 'createCandidate')!.own));
    const saga = changed(tables(), created.tables).find((c) => c.row['SK'] === 'SAGA');
    expect.soft(saga?.row['GSI1PK'], 'createCandidate: the new candidate sits under TENANT#<A>').toBe(`TENANT#${A}`);
    // trackUserActions: the user row it touches names the company of the record that was changed.
    const tracked = runEvent('trackUserActions', stream(sagaImage(A, { updatedBy: SUB.staffA })));
    const userRows = changed(tables(), tracked.tables).filter((c) => c.table === TABLE.users);
    expect.soft(userRows.length, `trackUserActions writes the user's last action (got ${describe(tracked)})`).toBeGreaterThan(0);
    for (const c of userRows) expect.soft(c.row['tenant_id'], 'trackUserActions: the user row carries tenant_id A').toBe(A);
    // createItTask (EventBridge): the tasks carry the event's company.
    const made = runEvent('createItTask', ev(itDetail(A)));
    const tasks = changed(tables(), made.tables).filter((c) => c.table === TABLE.itTasks);
    expect.soft(tasks.length, `createItTask makes tasks from the event (got ${describe(made)})`).toBeGreaterThan(0);
    for (const c of tasks) expect.soft(c.row['tenant_id'], 'createItTask: every task carries tenant_id A').toBe(A);
  });

  // ---------------------------------------------------------------- AC-5

  test('AC-5 Events and jobs keep the company', async ({}, testInfo) => {
    once(testInfo.project.name);
    const JOBS: { name: string; handler: string; detail: (c: string, cand: string) => Record<string, unknown>; cand: Record<string, string>; unversioned?: boolean }[] = [
      { name: 'createOffer', handler: 'createOffer', detail: (c, cand) => ({ candidateId: cand, tenant_id: c, outcome: 'PASSED', configVersion: '1' }), cand: { [A]: ID.a2, [B]: ID.b2 } },
      { name: 'orchestrateTalentFlowWorkflow', handler: 'orchestrateTalentFlowWorkflow', detail: (c, cand) => ({ candidateId: cand, tenant_id: c, positionLevel: 'MID' }), cand: { [A]: ID.a2, [B]: ID.b2 }, unversioned: true },
      { name: 'completeEvaluation', handler: 'completeEvaluation', detail: (c, cand) => ({ candidateId: cand, tenant_id: c, averageScore: 7.5, result: 'PASS' }), cand: { [A]: ID.a1, [B]: ID.b1 } },
      { name: 'createItTask', handler: 'createItTask', detail: (c, cand) => itDetail(c, cand), cand: { [A]: ID.a1, [B]: ID.b1 } },
    ];
    const world = (j: { unversioned?: boolean }) => {
      const t = tables();
      if (j.unversioned) t[TABLE.state] = t[TABLE.state]!.map((r) => (['SAGA'].includes(plain(r)['SK']) ? Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'configVersion')) : r));
      return t;
    };
    for (const j of JOBS) {
      // Control: today's detail (company under tenantId, as the producers still send it) runs, so the cases below mean something.
      const control = runEvent(j.handler, ev({ ...j.detail(A, j.cand[A]!), tenantId: A }), { tables: world(j) });
      expect.soft(control.error, `${j.name}: control, an event with both names runs (${control.error?.message})`).toBeUndefined();
      // The company only in tenant_id: runs against A's records and writes A's.
      const own = runEvent(j.handler, ev(j.detail(A, j.cand[A]!)), { tables: world(j) });
      expect.soft(own.error, `${j.name}: an event with tenant_id A runs (${own.error?.message})`).toBeUndefined();
      const wrote = changed(world(j), own.tables);
      expect.soft(wrote.length, `${j.name}: an event with tenant_id A writes A's records`).toBeGreaterThan(0);
      for (const c of wrote) expect.soft(JSON.stringify(c.row), `${j.name}: what it wrote holds no other company`).not.toMatch(/DEFAULT|NALEKO|ten_b/);
      for (const c of wrote) expect.soft(c.row['tenant_id'], `${j.name}: ${c.table} row carries tenant_id A`).toBe(A);
      for (const e of putEvents(own)) {
        expect.soft(JSON.parse(e.Detail ?? '{}')['tenant_id'], `${j.name}: the event it sends on carries tenant_id A`).toBe(A);
      }
      // No company: nothing is read, written or sent, and the log holds no name or address.
      const none = runEvent(j.handler, ev(Object.fromEntries(Object.entries(j.detail(A, j.cand[A]!)).filter(([k]) => k !== 'tenant_id'))), { tables: world(j) });
      expect.soft(calls(none).map((c) => `${c.service} ${c.op}`), `${j.name}: an event without a company makes no AWS call`).toEqual([]);
      expect.soft(logLines(none.calls).join('\n'), `${j.name}: and logs no name or address`).not.toMatch(PEOPLE);
      // Another company's record: B's event aimed at A's candidate (or the reverse) writes nothing.
      if (j.name !== 'createItTask') {
        const wrong = runEvent(j.handler, ev(j.detail(B, j.cand[A]!)), { tables: world(j) });
        expect.soft(calls(wrong).filter((c) => c.service !== 'dynamodb').map((c) => `${c.service} ${c.op}`), `${j.name}: B's event aimed at A's candidate sends nothing on`).toEqual([]);
        expect.soft(wrote.length && changed(world(j), wrong.tables).length, `${j.name}: and changes no row`).toBe(0);
      }
    }
    // evaluateIntelligenceRules: a stream record of A reads A's rules and writes A's snapshot; one without a company does nothing.
    const evalOwn = runEvent('evaluateIntelligenceRules', stream(sagaImage(A)));
    expect.soft(evalOwn.error, `evaluateIntelligenceRules: a record of A runs (${evalOwn.error?.message})`).toBeUndefined();
    expect.soft(sent(evalOwn), 'evaluateIntelligenceRules: reads A\'s rules only').toContain(`TENANT#${A}`);
    expect.soft(sent(evalOwn), 'evaluateIntelligenceRules: never DEFAULT or B').not.toMatch(/DEFAULT|NALEKO|ten_b/);
    const snap = changed(tables(), evalOwn.tables).find((c) => String(c.row['PK']).includes('#SNAP'));
    expect.soft(snap?.row['PK'], 'evaluateIntelligenceRules: the snapshot is under A').toBe(`TENANT#${A}#SNAP`);
    expect.soft(snap?.row['tenant_id'], 'evaluateIntelligenceRules: and carries tenant_id A').toBe(A);
    const evalNone = runEvent('evaluateIntelligenceRules', stream(sagaImage(null)));
    expect.soft(calls(evalNone).map((c) => `${c.service} ${c.op}${c.table ? ' ' + c.table : ''}`), 'evaluateIntelligenceRules: a record without a company makes no AWS call (no DEFAULT rules)').toEqual([]);
    expect.soft(logLines(evalNone.calls).join('\n'), 'evaluateIntelligenceRules: logs no name or address').not.toMatch(PEOPLE);
    // trackUserActions: a record without a company changes nothing.
    const trackNone = runEvent('trackUserActions', stream(sagaImage(null, { updatedBy: SUB.staffA })));
    expect.soft(calls(trackNone).map((c) => `${c.service} ${c.op}`), 'trackUserActions: a record without a company makes no AWS call').toEqual([]);
    expect.soft(logLines(trackNone.calls).join('\n'), 'trackUserActions: logs no name or address').not.toMatch(PEOPLE);
    // Notification sender: an SQS message of A writes A's notification and sends the email; one without a company does neither.
    const msg = (company: Record<string, string>) => ({ Records: [{ messageId: 'm-1', body: JSON.stringify({ type: 'INTERVIEW_SCHEDULED', recipientEmail: 'hm.a@example.test', recipientId: SUB.hmA, candidateId: ID.a1, ...company }) }] });
    const sentControl = runEvent('sendTalentFlowNotification', msg({ tenant_id: A, tenantId: A }));
    expect.soft(sentControl.error, `sendTalentFlowNotification: control, a message with both names runs (${sentControl.error?.message})`).toBeUndefined();
    expect.soft((sentControl.calls as any[]).filter((c) => c.service === 'postmark').length, 'sendTalentFlowNotification: control, the email is sent').toBeGreaterThan(0);
    const sentOwn = runEvent('sendTalentFlowNotification', msg({ tenant_id: A }));
    const notif = changed(tables(), sentOwn.tables).filter((c) => c.table === TABLE.notifications);
    expect.soft(notif.length, `sendTalentFlowNotification: a message of A writes a notification (got ${describe(sentOwn)})`).toBe(1);
    for (const c of notif) expect.soft(c.row['tenant_id'], 'sendTalentFlowNotification: the notification carries tenant_id A').toBe(A);
    expect.soft((sentOwn.calls as any[]).filter((c) => c.service === 'postmark').length, 'sendTalentFlowNotification: and the email is sent').toBeGreaterThan(0);
    const sentNone = runEvent('sendTalentFlowNotification', msg({}));
    expect.soft(changed(tables(), sentNone.tables), 'sendTalentFlowNotification: a message without a company writes no notification').toEqual([]);
    expect.soft((sentNone.calls as any[]).filter((c) => c.service === 'postmark'), 'sendTalentFlowNotification: and sends no email').toEqual([]);
    expect.soft(logLines(sentNone.calls).join('\n'), 'sendTalentFlowNotification: logs no name or address').not.toMatch(PEOPLE);
  });

  // ---------------------------------------------------------------- AC-6

  test('AC-6 Agent routes and vote by token', async ({}, testInfo) => {
    once(testInfo.project.name);
    // The agent key authorizer passes the company from its setting.
    const key = { headers: { 'x-api-key': 'ten03-agent-key' } };
    const auth = (env: Record<string, string | undefined>, headers: Record<string, string> = key.headers) => runEvent('talentFlowAuthorizer', { headers, routeKey: 'POST /approve', requestContext: { http: { method: 'POST' } } }, { env });
    const okRun = auth({});
    expect.soft(okRun.response?.isAuthorized, `a good key is authorised (got ${JSON.stringify(okRun.response)} ${okRun.error?.message ?? ''})`).toBe(true);
    expect.soft(okRun.response?.context, 'and the context carries the actor and tenant_id from AGENT_TENANT_ID').toEqual({ actor: 'AGENT', tenant_id: A });
    expect.soft(auth({}, { 'x-api-key': 'not-the-key' }).response?.isAuthorized ?? false, 'a wrong key is refused').toBe(false);
    // The request cannot choose the company: names of B in headers change nothing.
    const namedB = auth({}, { 'x-api-key': 'ten03-agent-key', 'x-tenant': B, 'x-tenant-id': B, tenantid: B, tenant_id: B });
    expect.soft(namedB.response?.context, 'a key that comes with headers naming B still gets the setting\'s company').toEqual({ actor: 'AGENT', tenant_id: A });
    for (const [what, value] of [['not set', undefined], ['empty', ''], ['DEFAULT', 'DEFAULT'], ['NALEKO', 'NALEKO'], ['not a company id', 'ten_short']] as const) {
      const run = auth({ AGENT_TENANT_ID: value });
      expect.soft(run.response?.isAuthorized === true, `AGENT_TENANT_ID ${what}: no call is authorised (got ${JSON.stringify(run.response)})`).toBe(false);
      expect.soft(logLines(run.calls).some((l) => l.includes('Missing setting AGENT_TENANT_ID')), `AGENT_TENANT_ID ${what}: logs "Missing setting AGENT_TENANT_ID"`).toBe(true);
    }
    // talentFlowApproveAction: the agent reads an action of its own company, never another's.
    const get = (id: string, caller: 'agentA' | 'agentNoTenant') => ask('talentFlowApproveAction', caller, { rawPath: `/v1/actions/${id}` });
    const own = get(ID.actionA, 'agentA');
    expect.soft(statusOf(own), `the agent reads A's action (got ${describe(own)})`).toBe(200);
    const unknown = get('act-does-not-exist', 'agentA');
    const foreign = get(ID.actionB, 'agentA');
    expect.soft(`${statusOf(foreign)} ${JSON.stringify(bodyOf(foreign))}`, 'B\'s action answers the agent of A exactly as an unknown id').toBe(`${statusOf(unknown)} ${JSON.stringify(bodyOf(unknown))}`);
    const noCompany = get(ID.actionA, 'agentNoTenant');
    expect.soft(statusOf(noCompany), 'an agent without a company is 403').toBe(403);
    expect.soft(bodyOf(noCompany), 'with {"error":"Forbidden"}').toEqual(FORBIDDEN);
    expect.soft(calls(noCompany), 'and no AWS call').toEqual([]);
    // HR: lists and decisions stay inside the company.
    const list = ask('talentFlowApproveAction', 'staffA', { rawPath: '/v1/actions/pending' });
    expect.soft(JSON.stringify(bodyOf(list)), 'HR of A lists A\'s pending action').toContain(ID.actionA);
    expect.soft(JSON.stringify(bodyOf(list)), 'HR of A does not list B\'s pending action').not.toContain(ID.actionB);
    for (const verb of ['approve', 'reject']) {
      const before = tables();
      const r = ask('talentFlowApproveAction', 'staffA', { method: 'POST', rawPath: `/v1/actions/${ID.actionB}/${verb}`, body: {} }, { tables: before });
      const u = ask('talentFlowApproveAction', 'staffA', { method: 'POST', rawPath: `/v1/actions/act-does-not-exist/${verb}`, body: {} });
      expect.soft(`${statusOf(r)} ${JSON.stringify(bodyOf(r))}`, `HR of A ${verb}s B's action: answered as an unknown id`).toBe(`${statusOf(u)} ${JSON.stringify(bodyOf(u))}`);
      expect.soft(notReads(r).map((c: any) => `${c.service} ${c.op}`), `HR of A ${verb}s B's action: nothing written or sent`).toEqual([]);
      expect.soft(wrote(before, r.tables), `HR of A ${verb}s B's action: no row changed`).toBe(false);
    }
    const approved = ask('talentFlowApproveAction', 'staffA', { method: 'POST', rawPath: `/v1/actions/${ID.actionA}/approve`, body: {} });
    expect.soft(statusOf(approved), `HR of A approves A's action (got ${describe(approved)})`).toBe(200);
    for (const e of putEvents(approved)) {
      expect.soft(JSON.parse(e.Detail ?? '{}')['tenant_id'], 'the ActionApproved event carries tenant_id A').toBe(A);
    }
    const noTenantHr = ask('talentFlowApproveAction', 'noTenant', { method: 'POST', rawPath: `/v1/actions/${ID.actionA}/approve`, body: {} });
    expect.soft(statusOf(noTenantHr), 'HR without a company: 403').toBe(403);
    expect.soft(calls(noTenantHr), 'HR without a company: no AWS call').toEqual([]);

    // Vote by token (public): the company is the token record's.
    const vote = { rating: 'YES', scores: { technical: 4, communication: 4, culturalFit: 4, problemSolving: 4 } };
    for (const [who, token, cand, company] of [['A', ID.voteTokenA, ID.a1, A], ['B', ID.voteTokenB, ID.b1, B]] as const) {
      const before = tables();
      const r = ask('submitVoteByToken', 'public', { method: 'POST', path: { token }, body: vote }, { tables: before });
      expect.soft(statusOf(r), `a token of ${who} works as today (got ${describe(r)})`).toBe(200);
      const rows = changed(before, r.tables);
      const voteRow = rows.find((c) => String(c.row['SK']).startsWith('VOTE#'));
      expect.soft(voteRow?.row['PK'], `the vote is recorded on ${who}'s candidate`).toBe(`CANDIDATE#${cand}`);
      expect.soft(voteRow?.row['tenant_id'], `the vote row carries tenant_id ${who}`).toBe(company);
      for (const e of putEvents(r)) {
        expect.soft(JSON.parse(e.Detail ?? '{}')['tenant_id'], `the event of ${who}'s vote carries tenant_id ${who}`).toBe(company);
      }
      const other = company === A ? B : A;
      expect.soft(sent(r), `the vote of ${who} touches nothing of the other company`).not.toContain(other);
      expect.soft(sent(r), `and never DEFAULT`).not.toMatch(/DEFAULT|NALEKO/);
    }
    // A token cannot be turned on another company's candidate through a request that names one.
    const named = ask('submitVoteByToken', 'public', { method: 'POST', path: { token: ID.voteTokenA }, body: { ...vote, tenantId: B, tenant_id: B, candidateId: ID.b1 }, query: { tenantId: B } });
    expect.soft(sent(named), 'a vote that names B and B\'s candidate still lands on the token\'s candidate').not.toContain(ID.b1);
    const bad = ask('submitVoteByToken', 'public', { method: 'POST', path: { token: 'no-such-token' }, body: vote });
    expect.soft(statusOf(bad), 'an unknown token is refused as today (403)').toBe(403);
  });

  // ---------------------------------------------------------------- AC-7

  test('AC-7 TalentFlow pool tokens carry the company', async ({}, testInfo) => {
    once(testInfo.project.name);
    const TRIGGER = join(LAMBDA, 'talentFlowPreTokenTrigger', 'index.js');
    const SUBX = '5d2f8a41-7e3c-4b9a-a1d6-3c8e0f2b9a77';
    const GROUPS = ['TalentFlowAdmin', 'HiringManager', 'ITAdmin'];
    const member = (sub: string, tenant: string) => av({ pk: `USER#${sub}`, sk: `TENANT#${tenant}`, tenant_id: tenant });
    const event = (extra: Record<string, unknown> = {}) => ({
      version: '1', triggerSource: 'TokenGeneration_Authentication', region: 'af-south-1', userPoolId: 'af-south-1_TenFakeTF', userName: SUBX,
      callerContext: { awsSdkVersion: 'x', clientId: 'ten03' },
      request: { userAttributes: { sub: SUBX, email: 'iris.mokoena@example.test', email_verified: 'true', ...(extra['attrs'] as object ?? {}) }, groupConfiguration: { groupsToOverride: GROUPS, iamRolesToOverride: [], preferredRole: null }, ...(extra['clientMetadata'] ? { clientMetadata: extra['clientMetadata'] } : {}) },
      response: {},
    });
    const NOISE = [av({ pk: `TENANT#${A}`, sk: 'PROFILE', tenant_id: A }), av({ pk: `TENANT#${B}`, sk: 'PROFILE', tenant_id: B }), av({ pk: 'USER#someone-else', sk: `TENANT#${B}`, tenant_id: B }), av({ pk: `USER#${SUBX}`, sk: 'PREFS', tenant_id: B })];
    const run = (opts: { members?: Row[]; legacy?: string; fail?: boolean; extra?: Record<string, unknown> } = {}) => runHandler(TRIGGER, event(opts.extra), {
      tables: { [TENANTS]: [...NOISE, ...(opts.members ?? [])] },
      env: { TENANTS_TABLE: TENANTS, ...(opts.legacy ? { LEGACY_TENANT_ID: opts.legacy } : {}) },
      ...(opts.fail ? { fail: { service: 'dynamodb' as const, message: 'ProvisionedThroughputExceededException: Rate of requests exceeds the allowed throughput' } } : {}),
    });
    const tenantClaims = (r: Run): string[] => {
      const o = r.response?.response ?? {};
      return [o.claimsOverrideDetails?.claimsToAddOrOverride?.tenant_id, o.claimsAndScopeOverrideDetails?.idTokenGeneration?.claimsToAddOrOverride?.tenant_id, o.claimsAndScopeOverrideDetails?.accessTokenGeneration?.claimsToAddOrOverride?.tenant_id].filter((x) => x !== undefined);
    };
    const existing = (r: Run) => r.response?.response?.claimsOverrideDetails?.claimsToAddOrOverride ?? {};
    const expectOld = (what: string, r: Run) => {
      expect.soft(r.error, `${what}: never throws (${r.error?.message})`).toBeUndefined();
      expect.soft(existing(r)['custom:isAdmin'], `${what}: custom:isAdmin unchanged`).toBe('true');
      expect.soft(existing(r)['custom:roles'], `${what}: custom:roles unchanged`).toBe(JSON.stringify(['ADMIN', 'HM', 'IT']));
      expect.soft(existing(r)['custom:activeRole'], `${what}: custom:activeRole unchanged`).toBe('ADMIN');
    };
    if (!TALENTFLOW_TOKENS_REACH_API) {
      // Step 0 said these tokens never reach the API: the trigger stays as it is.
      const r = run({ members: [member(SUBX, A)] });
      expectOld('unchanged', r);
      expect.soft(tenantClaims(r), 'no company claim is added').toEqual([]);
      expect.soft(calls(r), 'and no AWS call is made').toEqual([]);
      return;
    }
    const one = run({ members: [member(SUBX, A)] });
    expectOld('one Member row', one);
    expect.soft(tenantClaims(one).length, 'one Member row: tenant_id is added').toBeGreaterThan(0);
    expect.soft([...new Set(tenantClaims(one))], 'one Member row: it is the Member row\'s company').toEqual([A]);
    expect.soft(calls(one).map((c) => `${c.service} ${c.op} ${c.table}`), 'one Member row: one Query on the tenants table, nothing else').toEqual([`dynamodb Query ${TENANTS}`]);
    const second = run({ members: [member(SUBX, B)], legacy: A });
    expect.soft([...new Set(tenantClaims(second))], 'a person of company B keeps B even while the legacy company is A').toEqual([B]);
    const legacy = run({ legacy: A });
    expectOld('legacy', legacy);
    expect.soft([...new Set(tenantClaims(legacy))], 'no Member row, legacy company set: the legacy company').toEqual([A]);
    const none = run({});
    expectOld('no Member row', none);
    expect.soft(tenantClaims(none), 'no Member row, no legacy company: no company claim (never DEFAULT)').toEqual([]);
    const several = run({ members: [member(SUBX, A), member(SUBX, B)], legacy: A });
    expectOld('several Member rows', several);
    expect.soft(tenantClaims(several), 'several Member rows: no company claim').toEqual([]);
    const failing = run({ members: [member(SUBX, A)], fail: true });
    expectOld('a failing read', failing);
    expect.soft(tenantClaims(failing), 'a failing read: no company claim').toEqual([]);
    const forged = run({ members: [member(SUBX, A)], extra: { attrs: { 'custom:tenant_id': B, 'custom:tenantId': B, tenant_id: B }, clientMetadata: { tenant_id: B, tenantId: B } } });
    expect.soft([...new Set(tenantClaims(forged))], 'a company named in user attributes or client metadata is never used').toEqual([A]);
    expect.soft(logLines(none.calls).some((l) => l.includes('Tenant claim skipped')), 'a skipped claim is logged ("Tenant claim skipped")').toBe(true);
  });
  test('AC-3 Lists show only the company\'s own', async ({}, testInfo) => {
    once(testInfo.project.name);
    const lists: { name: string; handler: string; caller: 'staffA' | 'staffB'; own: Ask; mine: string[]; theirs: string[] }[] = [
      { name: 'GET /v1/candidates', handler: 'getCandidates', caller: 'staffA', own: {}, mine: [ID.a1], theirs: [NAME.b1, ID.b1] },
      { name: 'GET /v1/it/tasks', handler: 'getItTasks', caller: 'staffA', own: {}, mine: [ID.taskA], theirs: [ID.taskB, NAME.b1] },
      { name: 'GET /v1/provisioning/bundles', handler: 'getProvisioningBundles', caller: 'staffA', own: {}, mine: [ID.bundleA], theirs: [ID.bundleB, NAME.b1] },
      { name: 'GET /v1/notifications', handler: 'getUserNotifications', caller: 'staffA', own: {}, mine: [ID.notifA], theirs: [ID.notifB] },
      // TEN-04.2 (re-locked by acceptance-lock/ten-03.3): GET /v1/hiring-managers and GET /v1/panel-members read people from Cognito, which holds
      // no company, and narrow them by the Member rows of the tenants table (ten-04.2.spec.ts judges the detail). Here: A's person listed, B's not.
      { name: 'GET /v1/panel-members', handler: 'getPanelMembers', caller: 'staffA', own: {}, mine: ['panel.a@example.test'], theirs: ['panel.b@example.test', 'Paul', 'sub-panel-b'] },
      { name: 'GET /v1/hiring-managers', handler: 'getHiringManagers', caller: 'staffA', own: {}, mine: ['hm.a@example.test'], theirs: ['hm.b@example.test', 'Hugo', 'sub-hm-b'] },
      { name: 'GET /v1/intelligence/tiles', handler: 'getIntelligenceTiles', caller: 'staffA', own: { query: { role: 'TA' } }, mine: [ID.a1], theirs: [ID.b1, NAME.b1] },
    ];
    for (const l of lists) {
      const a = ask(l.handler, l.caller, l.own);
      expect.soft(statusOf(a), `${l.name} as company A: 200 (got ${describe(a)})`).toBe(200);
      const text = JSON.stringify(bodyOf(a));
      for (const m of l.mine) expect.soft(text, `${l.name} as company A holds A's ${m}`).toContain(m);
      for (const t of l.theirs) expect.soft(text, `${l.name} as company A holds nothing of B's (${t})`).not.toContain(t);
      // The same list for B, mirrored: nothing of A's.
      const mirrored = (x: string) => x.replace('-a-', '-b-').replace('hm-a', 'hm-b').replace('panel-a', 'panel-b').replace('hmA', 'hmB');
      const b = ask(l.handler, 'staffB', l.own);
      const bt = JSON.stringify(bodyOf(b));
      expect.soft(statusOf(b), `${l.name} as company B: 200 (got ${describe(b)})`).toBe(200);
      for (const m of l.mine) expect.soft(bt, `${l.name} as company B holds none of A's (${m})`).not.toContain(m);
      void mirrored;
    }
    // Bundles by id, by result: B's bundle is invisible to A and A's to B, on every bundle route.
    for (const route of ROUTES.filter((x) => x.handler.endsWith('ProvisioningBundle') || x.handler.endsWith('ProvisioningBundleProgress'))) {
      const own = ask(route.handler, 'staffA', route.own);
      expect.soft([200, 201].includes(statusOf(own) ?? 0), `${route.name}: A reads and changes A's bundle (got ${describe(own)})`).toBe(true);
    }
    const bOnA = ask('getProvisioningBundle', 'staffA', { path: { bundleId: ID.bundleB } });
    expect.soft(statusOf(bOnA), 'A asks for B\'s bundle: 404').toBe(404);
    expect.soft(bodyOf(bOnA), 'A asks for B\'s bundle: {"error":"Not found"}').toEqual(NOT_FOUND);
  });

  // ---------------------------------------------------------------- AC-8

  test('AC-8 The move is safe', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(5 * 60_000);
    const SCRIPT = join(REPO, 'scripts', 'tenancy', 'move-default.mjs');
    expect(existsSync(SCRIPT), 'scripts/tenancy/move-default.mjs exists').toBe(true);
    const { world, legacy } = legacyWorld();
    const base = ['--env', 'dev', '--tenant', A];
    const run = (args: string[], w: { tables: Tables; fail?: any } = world) => runScript(SCRIPT, args, w);
    const keyOf = (t: string, r: Record<string, any>) => (KEY_OF[t] ?? []).map((k) => r[k]).join('|');
    const KEY_OF: Record<string, string[]> = { [TABLE.state]: ['PK', 'SK'], [TABLE.config]: ['PK', 'SK'], [TABLE.dismissals]: ['PK', 'SK'], [TABLE.notifications]: ['PK', 'SK'], [TABLE.events]: ['PK', 'SK'], [TABLE.users]: ['PK', 'SK'], [TABLE.pending]: ['actionId'], [TABLE.itTasks]: ['taskId'], [TABLE.bundles]: ['bundleId'] };

    // Dry run: writes nothing, prints counts only.
    const dry = run(base);
    expect(dry.code, `the dry run exits 0 (output: ${dry.stdout.slice(-400)}${dry.stderr.slice(-400)})`).toBe(0);
    expect(dry.writes.map((c) => `${c.op} ${c.table}`), 'the dry run writes nothing').toEqual([]);
    expect.soft(dry.stdout + dry.stderr, 'the dry run prints no name, address or record id').not.toMatch(PEOPLE);
    expect.soft(dry.stdout + dry.stderr, 'the dry run prints no id').not.toMatch(/CAND-|task-|bundle-|\d{6,}|act-/);
    const countsOf = (out: string) => (out.match(/\d+/g) ?? []).map(Number).reduce((a, b) => a + b, 0);
    const lessWorld = { tables: Object.fromEntries(Object.entries(world.tables).map(([t, rows]) => [t, rows.filter((r) => !legacy.has(plain(r)['m']))])) as Tables };
    expect.soft(countsOf(dry.stdout), 'the dry run counts the records it would move (the counts change with the data)').toBeGreaterThan(countsOf(run(base, lessWorld).stdout));
    const before = run([...base, '--check']);
    expect(before.code, 'check before the move exits 1').toBe(1);
    expect(before.writes, 'check writes nothing').toEqual([]);

    // Apply.
    const applied = run([...base, '--apply']);
    expect(applied.code, `apply exits 0 (${applied.stderr.slice(-300)}${applied.stdout.slice(-200)})`).toBe(0);
    expect.soft(applied.stdout + applied.stderr, 'apply prints counts only: no name, address or record id').not.toMatch(PEOPLE);
    expect.soft(applied.stdout + applied.stderr, 'and no id').not.toMatch(/CAND-|task-|bundle-|\d{6,}|act-/);
    for (const [table, rows] of Object.entries(world.tables)) {
      const after = applied.tables[table] ?? [];
      expect.soft(after.length, `${table}: as many rows after as before (moved, none lost or made)`).toBe(rows.length);
      // Legacy rows: found by their marker, company A everywhere, no DEFAULT or NALEKO left in any key or value.
      for (const r of rows.map(plain).filter((x) => legacy.has(x['m']))) {
        const now = after.map(plain).find((x) => x['m'] === r['m']);
        expect.soft(now, `${table}: the ${r['m']} record is still there`).toBeTruthy();
        if (!now) continue;
        expect.soft(now['tenant_id'], `${table}: ${r['m']} carries tenant_id A`).toBe(A);
        if ('tenantId' in r) expect.soft(now['tenantId'], `${table}: ${r['m']}'s tenantId is A`).toBe(A);
        expect.soft(JSON.stringify(now), `${table}: ${r['m']} names neither DEFAULT nor NALEKO anywhere (keys, index keys, values)`).not.toMatch(/DEFAULT|NALEKO/);
        const { PK, SK, GSI1PK, GSI1SK, tenant_id, tenantId, ...rest } = now;
        const { PK: _p, SK: _s, GSI1PK: _g, GSI1SK: _gs, tenant_id: _t, tenantId: _ti, ...was } = r;
        void [PK, SK, GSI1PK, GSI1SK, tenant_id, tenantId, _p, _s, _g, _gs, _t, _ti];
        expect.soft(rest, `${table}: ${r['m']} keeps everything else it held`).toEqual(was);
        if (typeof r['GSI1PK'] === 'string' && /^TENANT#(DEFAULT|NALEKO)/.test(r['GSI1PK'])) expect.soft(now['GSI1PK'], `${table}: ${r['m']}'s index key moved to A`).toBe(String(r['GSI1PK']).replace(/DEFAULT|NALEKO/, A));
        if (r['SK'] === 'SAGA') expect.soft(now['GSI1PK'], `${table}: ${r['m']} is listed under company A (GSI1PK TENANT#<A>)`).toBe(`TENANT#${A}`);
        if (typeof r['PK'] === 'string' && /^TENANT#(DEFAULT|NALEKO)/.test(r['PK'])) expect.soft(now['PK'], `${table}: ${r['m']}'s key moved to A`).toBe(String(r['PK']).replace(/DEFAULT|NALEKO/, A));
      }
      // Everything else, byte for byte: A, B, other companies, the company table.
      const untouched = rows.filter((r) => !legacy.has(plain(r)['m'])).map((r) => JSON.stringify(sortedKeys(r))).sort();
      const untouchedAfter = after.filter((r) => !legacy.has(plain(r)['m'])).map((r) => JSON.stringify(sortedKeys(r))).sort();
      expect.soft(untouchedAfter, `${table}: every record of A, of B and of any other company is exactly as it was`).toEqual(untouched);
    }
    expect.soft(JSON.stringify(sortedKeys(applied.tables[TENANTS] ?? [])), 'the company table is exactly as it was').toBe(JSON.stringify(sortedKeys(world.tables[TENANTS] ?? [])));
    // Copy before delete, one transaction per record: a record whose key changes is written under the new key and
    // removed from the old in the same TransactWriteItems; nothing is deleted on its own.
    const deletes = applied.writes.filter((c: any) => c.op === 'DeleteItem' || c.op === 'BatchWriteItem');
    expect.soft(deletes.map((c: any) => `${c.op} ${c.table ?? ''}`), 'no delete outside a transaction that holds the copy').toEqual([]);
    const moved = applied.writes.filter((c: any) => c.op === 'TransactWriteItems');
    expect.soft(moved.length, 'records whose key held the company moved with TransactWriteItems').toBeGreaterThan(0);
    for (const t of moved) {
      const items = (t.input.TransactItems ?? []) as any[];
      const dels = items.filter((i) => i.Delete);
      const puts = items.filter((i) => i.Put);
      expect.soft(dels.length, 'one record per transaction (at most one delete)').toBeLessThanOrEqual(1);
      if (dels.length) expect.soft(puts.length, 'every transaction that deletes an old key also writes the new one').toBe(1);
      for (const p of puts) expect.soft(JSON.stringify(p.Put.Item), 'the copy names neither DEFAULT nor NALEKO').not.toMatch(/DEFAULT|NALEKO/);
    }
    // A copy that fails deletes nothing.
    const broken = run([...base, '--apply'], { tables: world.tables, fail: { service: 'dynamodb', ops: ['TransactWriteItems'], message: 'ProvisionedThroughputExceededException: Rate of requests exceeds the allowed throughput' } });
    expect.soft(broken.code, 'when the copy fails the script exits 1').not.toBe(0);
    for (const [table, rows] of Object.entries(world.tables)) {
      for (const r of rows.map(plain).filter((x) => legacy.has(x['m']) && /DEFAULT|NALEKO/.test(String(x['PK'] ?? '')))) {
        expect.soft((broken.tables[table] ?? []).map(plain).some((x) => keyOf(table, x) === keyOf(table, r)), `${table}: when the copy fails the old ${r['m']} is not deleted`).toBe(true);
      }
    }
    // A second apply changes nothing; check passes.
    const again = run([...base, '--apply'], { tables: applied.tables });
    expect(again.code, 'a second apply exits 0').toBe(0);
    expect(again.writes, 'a second apply writes nothing').toEqual([]);
    const after = run([...base, '--check'], { tables: applied.tables });
    expect(after.code, `check after the move exits 0 (${after.stdout.slice(-300)})`).toBe(0);
    // Check fails on each kind of gap alone.
    const regress = (table: string, make: (r: Row) => Row, pick: (r: Record<string, any>) => boolean) => {
      const t = structuredClone(applied.tables);
      const i = t[table]!.findIndex((r) => pick(plain(r)));
      t[table]![i] = make(t[table]![i]!);
      return run([...base, '--check'], { tables: t }).code;
    };
    expect.soft(regress(TABLE.itTasks, (r) => ({ ...r, tenantId: { S: 'NALEKO' } }), (r) => r['taskId'] === ID.taskA), 'check exits 1 when one IT task names NALEKO').toBe(1);
    expect.soft(regress(TABLE.bundles, (r) => { const { tenant_id, tenantId, ...x } = r; void [tenant_id, tenantId]; return x; }, (r) => r['bundleId'] === ID.bundleA), 'check exits 1 when one bundle has no company').toBe(1);
    expect.soft(regress(TABLE.state, (r) => ({ ...r, GSI1PK: { S: 'TENANT#DEFAULT' } }), (r) => r['PK'] === `CANDIDATE#${ID.a1}` && r['SK'] === 'SAGA'), 'check exits 1 when one candidate is indexed under DEFAULT').toBe(1);
    // Records of any other company are listed by count, never touched (shown above), and check does not fail for them.
    expect.soft(applied.stdout + applied.stderr + dry.stdout, 'other companies\' records are counted in the output').toMatch(/\d/);
    // Arguments: the company must be a real company id, and prod is never moved without the named yes.
    for (const bad of [[], ['--tenant', 'DEFAULT'], ['--tenant', 'NALEKO'], ['--tenant', 'ten_short']]) {
      const r = run(['--env', 'dev', ...bad, '--apply']);
      expect.soft(r.code, `${JSON.stringify(bad)}: refused`).not.toBe(0);
      expect.soft(r.writes, `${JSON.stringify(bad)}: nothing written`).toEqual([]);
    }
    const prodNoYes = run(['--env', 'prod', '--tenant', A, '--apply']);
    expect.soft(prodNoYes.code, 'prod --apply without --prod-account 937137806477 is refused').not.toBe(0);
    expect.soft(prodNoYes.writes, 'and writes nothing').toEqual([]);
    const prodDry = run(['--env', 'prod', '--tenant', A]);
    expect.soft(prodDry.code, 'a prod dry run needs no yes').toBe(0);
    expect.soft(prodDry.writes, 'and writes nothing').toEqual([]);
    const prodYes = run(['--env', 'prod', '--tenant', A, '--apply', '--prod-account', '937137806477']);
    expect.soft(prodYes.code, 'prod --apply with --prod-account 937137806477 runs').toBe(0);
  });

  // ---------------------------------------------------------------- AC-9

  test('AC-9 Clients send no company', async ({}, testInfo) => {
    once(testInfo.project.name);
    const SERVICES = ['talent-flow', 'it-provisioning', 'admin'].flatMap((f) => files(join(REPO, 'hr-portal', 'src', 'app', 'features', f), /\.service\.ts$/));
    expect(SERVICES.length, 'the old app\'s TalentFlow, IT and admin services are found').toBeGreaterThan(2);
    const URLS = /\/(candidates|it\/tasks|provisioning|intelligence|config|notifications|panel-members|hiring-managers|admin)\b/;
    const PEPLA = files(join(REPO, 'pepla-web', 'src'), /\.service\.ts$/).filter((f) => URLS.test(readFileSync(f, 'utf8')));
    for (const f of [...SERVICES, ...PEPLA]) {
      const code = stripComments(readFileSync(f, 'utf8'));
      const rel = f.slice(REPO.length + 1);
      expect.soft(code.match(/tenantId|tenant_id|talentFlow\.tenantId/g) ?? [], `${rel} adds no company to a request`).toEqual([]);
    }
    for (const env of ['environment.ts', 'environment.prod.ts']) {
      const p = join(REPO, 'hr-portal', 'src', 'environments', env);
      if (!existsSync(p)) continue;
      expect.soft(stripComments(readFileSync(p, 'utf8')).match(/tenantId\s*:\s*['"`]NALEKO['"`]/g) ?? [], `${env} holds no NALEKO company`).toEqual([]);
    }
  });

  // ---------------------------------------------------------------- AC-10

  test('AC-10 Roles hold exactly this', async ({}, testInfo) => {
    once(testInfo.project.name);
    // MOD-01 rule 8 (re-locked by acceptance-lock/mod-01): the roles of the Lambdas that ask the module check may GetItem the
    // tenants table, nothing more; getCompanyModules' own role has only its log group, X-Ray and that GetItem.
    const MOD01_ROLES = new Set([
      ...['get_company_modules', 'get_candidate_events', 'get_hiring_managers'].map((r) => `infra/${r}`),
      ...['acknowledge_tile', 'advance_candidate_stage', 'advance_offer_state', 'ai_chat', 'approve_action', 'capture_sentiment', 'create_candidate', 'create_offer',
        'dismiss_tile', 'evaluate_intelligence_rules', 'generate_scoring_link', 'get_candidate', 'get_candidates', 'get_intelligence_tiles', 'get_notifications',
        'get_offer', 'get_panel_members', 'manage_config', 'mark_notif_read', 'orchestrate_workflow', 'schedule_interview', 'send_notification', 'snooze_tile',
        'submit_vote', 'submit_vote_by_token', 'update_candidate'].map((r) => `talent-flow-infra/${r}`),
    ]);
    const MOD01_ROLE = (key: string, role: string) => MOD01_ROLES.has(`${key.split('/')[0]}/${role}`);
    // TEN-04.2 (re-locked by acceptance-lock/ten-03.3): more table-level grants, each one (role, action, table) and nothing broader (support/ten-04.2/grants.ts):
    // the card's own three (createProvisioningBundle on the state table, getPanelMembers and getHiringManagers on the tenants table) and PR 407's five (dev read grants).
    const TEN042_QUERY = (p: string, key: string, role: string) => isCardGrant(p, key.split('/')[0]!, role);
    const MOD01_GET = (p: string) => /^Allow dynamodb:GetItem (aws_dynamodb_table\.tenants\.arn|arn:aws:dynamodb:[^:]+:[^:]+:table\/(\$\{local\.tf_tenants_table\}|naleko-people-\$\{var\.environment\}-tenants)) null$/.test(p);
    const MOD01_OWN = (p: string) => /^Allow logs:(CreateLogGroup|CreateLogStream|PutLogEvents) arn:aws:logs:[^:]+:[^:]+:log-group:\/aws\/lambda\/getCompanyModules:\* null$/.test(p) || /^Allow xray:(PutTraceSegments|PutTelemetryRecords) \* null$/.test(p);
    const baseline = JSON.parse(readFileSync(join(__dirname, 'support', 'ten-03', 'iam-6123d0e', 'policies.json'), 'utf8')) as Record<string, { pairs?: string[]; squash?: string }>;
    const L = (v: unknown): string[] => (v === undefined ? [] : Array.isArray(v) ? (v as string[]) : [v as string]);
    const now: Record<string, { pairs?: string[]; squash?: string; role: string }> = {};
    for (const stack of ['infra', 'talent-flow-infra']) {
      const fs = readdirSync(join(REPO, stack)).filter((f) => f.endsWith('.tf')).map((f) => join(REPO, stack, f));
      for (const b of blocks(fs, 'resource').filter((x) => x.labels[0] === 'aws_iam_role_policy')) {
        const r = { type: 'aws_iam_role_policy', name: b.labels[1]!, raw: b.raw, body: b.body, attrs: attributes(b.body) };
        const role = (attributes(b.body).get('role') ?? '').replace(/^aws_iam_role\./, '').replace(/\.(name|id)$/, '');
        try {
          const doc: any = policyOf(r);
          const st = Array.isArray(doc.Statement) ? doc.Statement : [doc.Statement];
          now[`${stack}/${b.labels[1]}`] = { role, pairs: st.flatMap((x: any) => L(x.Action).flatMap((a) => L(x.Resource).map((res) => `${x.Effect ?? ''} ${a} ${res} ${JSON.stringify(x.Condition ?? null)}`))).sort() };
        } catch {
          now[`${stack}/${b.labels[1]}`] = { role, squash: tfSquash(b.body) };
        }
      }
    }
    const TALENT_TABLE = /aws_dynamodb_table\.(talent_flow_[\w]+|it_tasks|provisioning_bundles)\.arn|table\/(talent-flow-[\w-]+|it-tasks|provisioning-bundles)\b/;
    const tableOf = (res: string) => /aws_dynamodb_table\.([\w]+)\.arn|table\/([\w-]+)/.exec(res)?.slice(1).find(Boolean)?.replace(/_/g, '-');
    for (const [key, was] of Object.entries(baseline)) {
      const cur = now[key];
      expect.soft(!!cur, `role policy ${key} is still there`).toBe(true);
      if (!cur) continue;
      if (was.squash !== undefined) { expect.soft(cur.squash, `role policy ${key}: unchanged (its text cannot be read as a policy)`).toBe(was.squash); continue; }
      const had = new Set(was.pairs);
      const gained = (cur.pairs ?? []).filter((p) => !had.has(p));
      const lost = (was.pairs ?? []).filter((p) => !(cur.pairs ?? []).includes(p));
      const querying = new Set((cur.pairs ?? []).filter((p) => p.startsWith('Allow dynamodb:Query ') && p.includes('/index/')).map((p) => tableOf(p.split(' ')[2]!)));
      const isPreToken = /pre_token/.test(key) || /pre_token/.test(cur.role);
      expect.soft(lost.filter((p) => !(/^Allow dynamodb:Scan /.test(p) && querying.has(tableOf(p.split(' ')[2]!)))), `role policy ${key}: nothing it had is taken away (a Scan only where the table gained an index Query)`).toEqual([]);
      for (const p of gained) {
        const [effect, action, res, cond] = [p.split(' ')[0], p.split(' ')[1], p.split(' ')[2], p.split(' ').slice(3).join(' ')];
        const tenants = /tenants/i.test(res!) && isPreToken;
        const indexOfTalent = /\/index\//.test(res!) && (TALENT_TABLE.test(res!) || /^(it-tasks|provisioning-bundles)$/.test(tableOf(res!) ?? ''));
        // TEN-06 (re-lock ten-03.2): the sign-in trigger moves a TalentFlow person in (ten-06.spec.ts AC-7 pins it).
        const ten06 = /cognito_post_auth/.test(key) && ((/^dynamodb:(PutItem|DeleteItem)$/.test(action!) && /tenants/i.test(res!)) || (action === 'cognito-idp:AdminAddUserToGroup' && /naleko_dev/.test(res!)));
        if (effect === 'Allow' && cond === 'null' && ten06) continue;
        expect.soft((effect === 'Allow' && action === 'dynamodb:Query' && cond === 'null' && (tenants || indexOfTalent)) || (MOD01_GET(p) && MOD01_ROLE(key, cur.role)) || TEN042_QUERY(p, key, cur.role), `role policy ${key}: new grant "${p}" is only a Query on the tenants table (TalentFlow trigger) or on an index of a TalentFlow, IT or bundle table, or one of the TEN-04.2 table grants`).toBe(true);
      }
    }
    // Policies that are new: only the TalentFlow pre-token trigger's, and only a Query on the tenants table.
    for (const [key, cur] of Object.entries(now)) {
      if (baseline[key]) continue;
      if (/send_document_reminders/.test(key) || /send_document_reminders/.test(cur.role)) continue; // ONB-21 (re-lock ten-03.4): its own role, locked in onb-21.spec.ts AC-8.
      if (/user_migration/.test(key) || /user_migration/.test(cur.role)) continue; // TEN-06 (re-lock ten-03.2): locked in ten-06.spec.ts AC-7.
      // MOD-01 rule 8: a new policy may also be the modules read (GetItem on the tenants table only), or getCompanyModules' own.
      const mod01 = (cur.pairs ?? []).length > 0 && MOD01_ROLE(key, cur.role) && (cur.pairs ?? []).every((p) => MOD01_GET(p) || (key === 'infra/get_company_modules' && MOD01_OWN(p)));
      // TEN-04.2: or it is one of the three table Queries of that card, on its role, and nothing else.
      const ten042 = (cur.pairs ?? []).length > 0 && (cur.pairs ?? []).every((p) => TEN042_QUERY(p, key, cur.role));
      expect.soft(/pre_token/.test(key) || /pre_token/.test(cur.role) || mod01 || ten042, `new role policy ${key} belongs to the TalentFlow pre-token trigger`).toBe(true);
      for (const p of cur.pairs ?? []) {
        const [effect, action, res, cond] = [p.split(' ')[0], p.split(' ')[1], p.split(' ')[2], p.split(' ').slice(3).join(' ')];
        expect.soft((effect === 'Allow' && action === 'dynamodb:Query' && cond === 'null' && /tenants/i.test(res!)) || (mod01 && (MOD01_GET(p) || MOD01_OWN(p))) || (ten042 && TEN042_QUERY(p, key, cur.role)), `new role policy ${key}: "${p}" is only a Query on the tenants table`).toBe(true);
      }
    }
    // The move script's needs go to no Lambda role: no TransactWriteItems anywhere.
    for (const [key, cur] of Object.entries(now)) {
      expect.soft((cur.pairs ?? []).filter((p) => p.includes('dynamodb:TransactWriteItems')), `role policy ${key}: no TransactWriteItems (that is the move script's)`).toEqual([]);
    }
    if (TALENTFLOW_TOKENS_REACH_API) {
      const mine = Object.entries(now).filter(([k, v]) => /pre_token/.test(k) || /pre_token/.test(v.role));
      const withTenants = mine.filter(([, v]) => (v.pairs ?? []).some((p) => /dynamodb:Query .*tenants/i.test(p)));
      expect(withTenants.length, 'the TalentFlow pre-token trigger\'s role may Query the tenants table').toBeGreaterThan(0);
      const kms = readFileSync(join(REPO, 'infra', 'kms.tf'), 'utf8');
      expect(tfSquash(kms), 'the PII key lets the TalentFlow pre-token trigger\'s role read the encrypted tenants table (dynamodb_read_role_arns)').toMatch(/dynamodb_read_role_arns=\[[^\]]*talentFlowPreTokenTrigger[^\]]*\]/);
    }
  });

  // ---------------------------------------------------------------- AC-11

  test('AC-11 Today\'s TalentFlow user still sees their candidates @pepla-dev', async ({ page }, testInfo) => {
    test.skip(!ON_DEV, 'pepla-dev only: the no-backend run covers this in AC-8.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width.');
    const env = (k: string) => process.env[k] ?? '';
    const counts = join(REPO, 'scripts', 'tenancy', 'dev-move-count.json');
    test.skip(!existsSync(counts), 'The merger records the number of candidates the TalentFlow test login saw before the dev move in scripts/tenancy/dev-move-count.json ({ "candidates": <n> }); not recorded yet.');
    const before = (JSON.parse(readFileSync(counts, 'utf8')) as { candidates: number }).candidates;
    const login = { email: env('E2E_TF_EMAIL') || env('E2E_HR_EMAIL'), password: env('E2E_TF_PASSWORD') || env('E2E_HR_PASSWORD') };
    expect(login.email, 'the TalentFlow test login is set (E2E_TF_EMAIL, or E2E_HR_EMAIL)').toBeTruthy();
    const { clientId, region } = devEnv();
    // The TalentFlow API, not the employees API: CI writes its address into the old app's environment file (scripts/ci/dev-frontend-env.sh).
    const oldEnv = join(REPO, 'hr-portal', 'src', 'environments', 'environment.ts');
    const tfApi = (/talentFlow\s*:\s*\{[^}]*?apiUrl\s*:\s*['"`]([^'"`]+)['"`]/s.exec(existsSync(oldEnv) ? readFileSync(oldEnv, 'utf8') : '')?.[1] ?? '').replace(/\/+$/, '');
    expect(tfApi, 'the TalentFlow API address is written for pepla-dev (hr-portal environment.ts, talentFlow.apiUrl)').toMatch(/^https:\/\/[^/]+\.execute-api\./);
    const api = tfApi;
    const r = await page.request.post(`https://cognito-idp.${region}.amazonaws.com/`, {
      headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
      data: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: clientId, AuthParameters: { USERNAME: login.email, PASSWORD: login.password } }),
    });
    expect(r.status(), 'signs in at Cognito').toBe(200);
    const token = ((await r.json()) as any).AuthenticationResult.IdToken as string;
    const get = async (path: string) => page.request.get(`${api}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const plainList = await get('/candidates');
    expect(plainList.status(), 'GET /v1/candidates: 200').toBe(200);
    const list = (await plainList.json()) as { candidates?: unknown[] };
    expect(list.candidates?.length ?? 0, 'the same number of candidates as before the move').toBe(before);
    expect(before, 'there were candidates to see').toBeGreaterThan(0);
    const named = await get('/candidates?tenantId=ten_00000000000000000000000000');
    expect(named.status(), 'a made-up tenantId in the query: 200').toBe(200);
    expect(((await named.json()) as { candidates?: unknown[] }).candidates?.length ?? 0, 'a made-up tenantId changes nothing: the same list').toBe(before);
  });
});

// ---------------------------------------------------------------- text helpers

function files(dir: string, pattern: RegExp): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...files(p, pattern));
    else if (pattern.test(e) && !/\.(spec|test)\./.test(e)) out.push(p);
  }
  return out;
}
const sortedKeys = (o: any): any => (Array.isArray(o) ? o.map(sortedKeys) : o && typeof o === 'object' ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortedKeys(o[k])])) : o);
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}
function stripTfComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(#|\/\/).*$/gm, '').replace(/\s+#.*$/gm, '');
}
/** Every TalentFlow, IT and bundle handler file (not tests, not node_modules), and every config-reader copy. */
function handlerFiles(): string[] {
  const names = new Set<string>([...ROUTES.map((r) => r.handler), 'createItTask', 'completeEvaluation', 'orchestrateTalentFlowWorkflow', 'evaluateIntelligenceRules', 'talentFlowAiChat',
    'submitVoteByToken', 'trackUserActions', 'talentFlowApproveAction', 'monitorTalentFlowSLAs', 'adminGetDashboard', 'getPanelMembers', 'talentFlowAuthorizer', 'sendTalentFlowNotification']);
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      if (e === 'node_modules' || e.startsWith('.')) continue;
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|mjs|cjs)$/.test(e) && !/\.test\./.test(e)) out.push(p);
    }
  };
  for (const n of names) if (existsSync(join(LAMBDA, n))) walk(join(LAMBDA, n));
  const shared = join(LAMBDA, 'shared', 'config-reader.js');
  if (existsSync(shared)) out.push(shared);
  return [...new Set(out)];
}
void [A, SUB, TENANTS, plain, runEvent, sentText, settings, authorizerOf, logLines, runScript, readFileSync];
type _Ask = Ask;
