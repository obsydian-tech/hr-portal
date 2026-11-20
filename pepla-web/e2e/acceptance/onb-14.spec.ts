import AxeBuilder from '@axe-core/playwright';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { DocumentsFake, storedDocument, storedEmployee, type FakePerson } from './support/documents-fake';
import { ON_DEV, expect, test as base, type Login, type SignInPage } from './support/fixtures';
import { INFRA, REPO, attributes, blocks, tfFiles } from './support/infra-harness';
import { WaitingFake } from './support/onb-13/waiting-fake';
import { DocumentFake, TYPE_NAME, type FakeDocument, type Read } from './support/onb-15/document-fake';
import {
  AUDIT, ENV, REVEAL, at, attempted, audit, awsCalls, busClientTimeout, dynamoCalls, eventFor, getOne, getPerson, kmsOps, logLines, openapi14, plain, published, reveal,
  runHandler, writes, type Caller, type Run,
} from './support/onb-14/lambda-harness';
import { FN, ROUTE_KEY, filesUnder, nested, read, revealInfra, unexpected } from './support/onb-14/infra';
import { RevealFake } from './support/onb-14/reveal-fake';
import {
  OLD_WORDS, SHOWN, WORDS, bodyText, expectHidden, expectShown, failureLine, focusedText, heading1, hideButton, hiddenOrCovered, holds, isBusy, keptText, main,
  noSidewaysScroll, showButton, spaced, tabTo, tryAgainButton, waitForPosts, watch,
} from './support/onb-14/screen';
import {
  ACCOUNT_LAST4, ACCOUNT_NUMBER, B_ID_NUMBER, DOC, E, E_B, E_OTHER, HR_A, HR_A_NO_NAMES, HR_B, ID_LAST4, ID_NUMBER, LEGACY_ID_NUMBER, NALEDI_EMAIL, NOT_HR, OWNER, VER, body,
  world,
} from './support/onb-14/world';
import { TENANT_A, TENANT_B, encrypted } from './support/onb-14/lambda-harness';

/**
 * ONB-14 · Every Show is logged (Jira NH-182, epic NH-150). RED card: security conditions C-1 to C-4 and S-1 to S-3 of
 * ONB-14-security-review.md are carried by the tests below.
 * One test per acceptance criterion, written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/ONB-14.md (18 Nov 2026)
 *
 * The full ID number and account number leave every answer. They come back only from POST /v1/verifications/<document id>/reveal,
 * which publishes document.field_shown to the audit bus and answers only after the bus took the entry.
 *
 * No-backend run: the browser answers the document and person routes with made-up documents (support/onb-15/document-fake.ts,
 * support/documents-fake.ts), the reveal route with a recording fake that can hold, fail or answer slowly
 * (support/onb-14/reveal-fake.ts), and Cognito with the fake. The Lambda tests run the real revealDocumentField, both GET
 * handlers and auditLogConsumer, each in its own Node process, against a fake AWS (support/onb-14/fake-aws: DynamoDB, KMS,
 * an EventBridge that records every entry and can fail the ways the real one does). The text checks read infra/*.tf,
 * api/openapi.yaml, api/agent-tools.json and lambda/ as text. Nothing here calls AWS or any AI service; AI routes are blocked.
 * AC-12 runs against pepla-dev, once, and is expected red until the card is merged and applied.
 *
 * These files are locked once the lock check accepts them: see ./README.md and cards/onb-14.md.
 */

// ---------------------------------------------------------------- fixtures: the two fakes and the reveal route

type Fixtures = { waiting: WaitingFake | null; docs: DocumentsFake | null; one: DocumentFake | null; revealFake: RevealFake | null };

const test = base.extend<Fixtures>({
  waiting: async ({ context, baseURL }, use) => {
    if (ON_DEV) return use(null);
    const fake = new WaitingFake(new URL(baseURL!).origin);
    await fake.install(context);
    await use(fake);
  },
  docs: async ({ context, baseURL }, use) => {
    if (ON_DEV) return use(null);
    const fake = new DocumentsFake(new URL(baseURL!).origin);
    await fake.install(context);
    await use(fake);
  },
  // After the waiting list, so /v1/verifications/<id> reaches this one (Playwright tries the last route first).
  one: async ({ context, baseURL, waiting }, use) => {
    void waiting;
    if (ON_DEV) return use(null);
    const fake = new DocumentFake(new URL(baseURL!).origin);
    await fake.install(context);
    await use(fake);
  },
  // Installed last, so it answers every reveal call for both pages and records every one in order.
  revealFake: async ({ context, baseURL, docs, one }, use) => {
    if (ON_DEV || !docs || !one) return use(null);
    const fake = new RevealFake(new URL(baseURL!).origin, (id, field) => docs.revealLookup(id, field) ?? one.revealLookup(id, field));
    await fake.install(context);
    await use(fake);
  },
});

const lambdaOnce = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the Lambda against a fake AWS.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: it has no screen width.');
};
const textOnce = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: it has no screen width.');
};
const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs made-up documents.');

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------------------------------------------------------------- the Lambda tests' helpers

const SHOWN_BY = HR_A.kind === 'jwt' ? HR_A.email : '';
const DETAIL_KEYS = ['document_id', 'employee_id', 'document_type', 'field', 'shown_by', 'shown_by_sub', 'shown_by_name', 'shown_at', 'actor', 'tenant_id'];
const ERROR_500 = { error: 'Internal server error' };

function ok(run: Run, what: string): any {
  expect(run.hung, `${what}: the handler answers`).toBe(false);
  expect(run.error, `${what}: the handler does not throw\n${run.error?.stack ?? ''}`).toBeUndefined();
  expect(run.status, `${what}: 200\n${run.raw.slice(0, 500)}`).toBe(200);
  return run.body;
}

/** Nothing the handler wrote anywhere but the answer's own body holds these. */
function expectNoLeak(run: Run, values: string[], what: string, opts: { body?: boolean } = {}): void {
  const logs = logLines(run).join('\n');
  const headers = JSON.stringify(run.headers);
  for (const v of values) {
    if (opts.body !== false) expect(run.raw, `${what}: the answer holds no "${v}"`).not.toContain(v);
    expect(logs, `${what}: no log line holds "${v}"`).not.toContain(v);
    expect(headers, `${what}: no header holds "${v}"`).not.toContain(v);
    expect(JSON.stringify(run.error ?? {}), `${what}: no exception holds "${v}"`).not.toContain(v);
  }
}

/** The numbers and what stands for them in a stored row: the value, its last four and the ciphertext. */
const secrets = (value: string) => [value, encrypted(value)];

const CASES: Array<{ what: string; doc: string; field: 'id_number' | 'account_number'; value: string; type: string }> = [
  { what: 'the ID number on a National ID (KMS-encrypted)', doc: DOC.id, field: 'id_number', value: ID_NUMBER, type: 'NATIONAL_ID' },
  { what: 'the plain ID number on a legacy row (read before NH-11)', doc: DOC.legacyId, field: 'id_number', value: LEGACY_ID_NUMBER, type: 'NATIONAL_ID' },
  { what: 'the account number on a Bank confirmation', doc: DOC.bank, field: 'account_number', value: ACCOUNT_NUMBER, type: 'BANK_CONFIRMATION' },
];

function showOnce(t: ReturnType<typeof world>, c: (typeof CASES)[number], caller: Caller = HR_A, extra: Record<string, unknown> = {}) {
  return reveal(t, c.doc, caller, body(c.field, E, extra));
}

// ---------------------------------------------------------------- tests

test.describe('ONB-14 Every Show is logged', () => {
  test('AC-1 Show writes one audit event, with who, which number, whose and when; and never the number', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);

    for (const legacy of [false, true]) {
      const t = world({ legacy });
      for (const c of CASES) {
        const how = `${c.what}${legacy ? ' (company rows with no tenant_id)' : ''}`;
        const before = Date.now();
        const r = showOnce(t, c);
        const after = Date.now();
        expect(ok(r, how), `${how}: { value } and nothing else`).toEqual({ value: c.value });

        const events = published(r);
        expect(events.length, `${how}: exactly one event`).toBe(1);
        const ev = events[0]!;
        expect(ev.detailType, `${how}: document.field_shown`).toBe('document.field_shown');
        expect(ev.source, `${how}: source`).toBe('naleko.onboarding');
        expect(ev.bus, `${how}: on the onboarding bus`).toBe(ENV.EVENT_BUS_NAME);
        expect(ev.detail, `${how}: who, which number, whose, when`).toMatchObject({
          document_id: c.doc, employee_id: E, document_type: c.type, field: c.field, shown_by: SHOWN_BY, shown_by_sub: 'sub-thandi-0001',
          shown_by_name: 'Thandi Demo-HR', actor: 'HUMAN', tenant_id: TENANT_A,
        });
        const shownAt = Date.parse(ev.detail.shown_at);
        expect(ev.detail.shown_at, `${how}: shown_at is an ISO time`).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
        expect(shownAt, `${how}: shown_at is the server's clock (not before the call)`).toBeGreaterThanOrEqual(before - 2_000);
        expect(shownAt, `${how}: shown_at is the server's clock (not after the call)`).toBeLessThanOrEqual(after + 2_000);
        expect(Object.keys(ev.detail).filter((k) => !DETAIL_KEYS.includes(k)), `${how}: the event holds nothing but the card's fields`).toEqual([]);
        const eventText = JSON.stringify(ev);
        for (const v of [c.value, c.value.slice(-4), encrypted(c.value)]) expect(eventText, `${how}: the event holds neither the number nor its last four ("${v}")`).not.toContain(v);

        expectNoLeak(r, secrets(c.value), how, { body: false });
        expect(r.headers['cache-control'] ?? '', `${how}: Cache-Control: no-store`).toMatch(/no-store/i);
        expect(writes(r), `${how}: no write to any table`).toEqual([]);
        expect(r.tables['naleko-idempotency'], `${how}: nothing in the idempotency table`).toEqual([]);
        if (c.field === 'id_number' && c.doc === DOC.id) expect(kmsOps(r), `${how}: decrypted with KMS`).toContain('Decrypt');

        // Run through the real consumer, the event is filed under the person and the company.
        const filed = audit({ 'onboarding-events': [] }, { source: ev.source, detailType: ev.detailType, detail: ev.detail });
        expect(filed.error, `${how}: the consumer takes the event\n${filed.error?.stack ?? ''}`).toBeUndefined();
        const rows = filed.tables['onboarding-events'].map((x) => plain(x)!);
        expect(rows.length, `${how}: one audit row`).toBe(1);
        expect(rows[0], `${how}: filed under the person and the company`).toMatchObject({ employeeId: E, tenant_id: TENANT_A, detailType: 'document.field_shown', actor: 'HUMAN' });
        expect(String(rows[0]!['detail']), `${how}: the audit row holds no number`).not.toContain(c.value.slice(-4));
      }
    }

    // A token with no names: the email stands in. A person with an unusual email still gets their own sub.
    const noNames = reveal(world(), DOC.id, HR_A_NO_NAMES, body('id_number'));
    const d = published(noNames)[0]?.detail;
    expect(ok(noNames, 'no names on the token'), 'no names: 200').toEqual({ value: ID_NUMBER });
    expect(d, 'no names: the email stands in for the name').toMatchObject({ shown_by: 'people-team@kestrel-foods.co.za', shown_by_name: 'people-team@kestrel-foods.co.za', shown_by_sub: 'sub-people-0002' });

    // Two Shows are two events: nothing is wrapped in idempotency, even when the browser sends an Idempotency-Key.
    const t = world();
    const first = reveal(t, DOC.id, HR_A, body('id_number'), { headers: { 'idempotency-key': 'onb14-same-key' } });
    const second = reveal(first.tables, DOC.id, HR_A, body('id_number'), { headers: { 'idempotency-key': 'onb14-same-key' } });
    expect(ok(first, 'first Show'), 'first Show').toEqual({ value: ID_NUMBER });
    expect(ok(second, 'second Show'), 'second Show').toEqual({ value: ID_NUMBER });
    expect(published(first).length + published(second).length, 'two Shows make two events').toBe(2);
    expect(second.tables['naleko-idempotency'], 'no idempotency row is written or read').toEqual([]);
    expect(awsCalls(second).filter((c) => /idempotency/.test(c)), 'no call touches the idempotency table').toEqual([]);

    // Hide and a plain GET make no event.
    for (const [what, r] of [
      ['GET /v1/verifications/{id}', getOne(world(), DOC.id, HR_A, E)],
      ['GET /v1/employees/{id}/verifications', getPerson(world(), E, HR_A)],
    ] as const) {
      expect(r.status, `${what}: 200`).toBe(200);
      expect(attempted(r), `${what}: no event`).toEqual([]);
    }
  });

  test('AC-2 Recorded before shown, and no record means no number', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);
    const t = world();

    // The call order: the entry is on the bus before the handler answers.
    for (const c of CASES) {
      const r = showOnce(t, c);
      ok(r, c.what);
      const put = at(r, (x) => x.service === 'events' && x.op === 'PutEvents' && x.accepted);
      const answered = at(r, (x) => x.service === 'response');
      expect(put, `${c.what}: the bus took the entry`).toBeGreaterThanOrEqual(0);
      expect(answered, `${c.what}: the handler answered`).toBeGreaterThan(put);
    }

    // The bus failing every way it can: 500, no value, no exception text, nothing written.
    // Error names may be logged (BE-18); the service's own words and ARNs never are.
    const SERVICE_BITS = ['arn:aws', 'internal id', '7f3c9a', 'could not take the entry', 'Request timed out', 'fake EventBridge'];
    for (const c of CASES.filter((x) => x.doc !== DOC.legacyId)) {
      for (const bus of ['throw', 'failedCount', 'failedCountOnly', 'errorCodeOnly'] as const) {
        const how = `${c.what}, bus ${bus}`;
        const r = reveal(t, c.doc, HR_A, body(c.field), { bus });
        expect(r.hung, `${how}: answers`).toBe(false);
        expect(r.error, `${how}: answers, does not throw`).toBeUndefined();
        expect(r.status, `${how}: 500`).toBe(500);
        expect(r.body, `${how}: { "error": "Internal server error" }`).toEqual(ERROR_500);
        expectNoLeak(r, secrets(c.value), how);
        for (const bit of SERVICE_BITS) {
          expect(r.raw, `${how}: no service text ("${bit}") in the answer`).not.toContain(bit);
          expect(logLines(r).join('\n'), `${how}: no service text ("${bit}") in a log line`).not.toContain(bit);
        }
        expect(r.raw, `${how}: not even the error's name is in the answer`).not.toContain('ServiceUnavailable');
        expect(writes(r), `${how}: nothing written`).toEqual([]);
      }
    }

    // The bus never answers: a short timeout turns it into a 500, not a long wait with the number in memory.
    const hung = reveal(t, DOC.id, HR_A, body('id_number'), { bus: 'hang', timeoutMs: 25_000 });
    expect(hung.hung, 'a bus that never answers: the handler still answers').toBe(false);
    expect(hung.status, 'a bus that never answers: 500').toBe(500);
    expect(hung.body, 'a bus that never answers: { "error": "Internal server error" }').toEqual(ERROR_500);
    expectNoLeak(hung, secrets(ID_NUMBER), 'a bus that never answers');
    expect(hung.elapsedMs, 'a bus that never answers: about 3 seconds, not 30').toBeLessThan(15_000);
    const limit = busClientTimeout(hung);
    expect(limit, 'the EventBridge client is built with a request timeout').not.toBeNull();
    expect(limit!, 'the timeout is short (about 3 seconds)').toBeGreaterThan(0);
    expect(limit!, 'the timeout is short (about 3 seconds)').toBeLessThanOrEqual(5_000);

    // The bus name missing: fail closed.
    const noBus = reveal(t, DOC.id, HR_A, body('id_number'), { env: { EVENT_BUS_NAME: undefined } });
    expect(noBus.hung, 'no EVENT_BUS_NAME: answers').toBe(false);
    expect(noBus.status, 'no EVENT_BUS_NAME: 500').toBe(500);
    expect(noBus.body, 'no EVENT_BUS_NAME: { "error": "Internal server error" }').toEqual(ERROR_500);
    expectNoLeak(noBus, secrets(ID_NUMBER), 'no EVENT_BUS_NAME');
    expect(published(noBus), 'no EVENT_BUS_NAME: nothing was accepted by any bus').toEqual([]);

    // A Show that cannot return a number writes no event.
    const none: Array<[string, Run]> = [
      ['a sentinel (KMS_UNAVAILABLE) ID number', reveal(t, DOC.sentinelId, HR_A, body('id_number'))],
      ['an empty account number', reveal(t, DOC.emptyBank, HR_A, body('account_number'))],
      ['an account number of NOT_FOUND', reveal(t, DOC.notFoundBank, HR_A, body('account_number'))],
      ['a verification with no ID number at all', reveal(t, DOC.noNumberId, HR_A, body('id_number'))],
      ['a KMS that refuses to decrypt', reveal(t, DOC.id, HR_A, body('id_number'), { key: 'fail' })],
    ];
    for (const [what, r] of none) {
      expect(r.error, `${what}: answers, does not throw`).toBeUndefined();
      expect(r.status, `${what}: 404`).toBe(404);
      expect(attempted(r), `${what}: nothing is published, not even a failed entry`).toEqual([]);
      expect(writes(r), `${what}: nothing written`).toEqual([]);
      expectNoLeak(r, secrets(ID_NUMBER), what);
      expect(r.raw, `${what}: no key or service text`).not.toMatch(/AccessDenied|kms:|arn:aws|fake KMS/i);
    }
  });

  test('AC-3 Only HR, only their company\'s documents, and the lookup is two GetItems', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);
    const t = world();
    const leaks = [...secrets(ID_NUMBER), ID_LAST4, 'Dlamini', 'NALEDI', 'Ubuntu Mutual'];

    // Not HR: 403 before any table, key or bus call.
    for (const [who, caller] of NOT_HR) {
      const how = `${who}`;
      const r = reveal(t, DOC.id, caller, body('id_number'));
      expect(r.error, `${how}: does not throw`).toBeUndefined();
      expect(r.status, `${how}: 403\n${r.raw.slice(0, 300)}`).toBe(403);
      expect(r.body, `${how}: { "error": "Only HR can show a number" }`).toEqual({ error: 'Only HR can show a number' });
      expect(awsCalls(r), `${how}: no DynamoDB, KMS or EventBridge call`).toEqual([]);
      for (const leak of leaks) expect(r.raw, `${how}: the 403 carries no "${leak}"`).not.toContain(leak);
    }
    // ... even with a body that is not valid, so the group check comes first.
    const early = reveal(t, DOC.id, NOT_HR[2]![1], 'not json {');
    expect(early.status, 'an employee with a broken body: still 403, the group check comes first').toBe(403);
    expect(awsCalls(early), 'an employee with a broken body: no AWS call').toEqual([]);

    // HR with no company on the token: nothing is read for them.
    const noCompany = reveal(t, DOC.id, { kind: 'jwt', email: SHOWN_BY, groups: ['hr_staff'], tenantId: null }, body('id_number'));
    expect([400, 401, 403, 404], `HR with no company claim: refused (got ${noCompany.status})`).toContain(noCompany.status);
    expect(attempted(noCompany), 'HR with no company claim: no event').toEqual([]);
    expect(kmsOps(noCompany), 'HR with no company claim: no decrypt').not.toContain('Decrypt');
    expectNoLeak(noCompany, secrets(ID_NUMBER), 'HR with no company claim');

    // Company B for company A's document: 404, never 403, no decrypt and no event. The company is never read from the request.
    for (const legacy of [false, true]) {
      const tw = world({ legacy });
      const tries: Array<[string, Run]> = [
        ['company B, plain request', reveal(tw, DOC.id, HR_B, body('id_number'))],
        ['company B, the body names company A', reveal(tw, DOC.id, HR_B, body('id_number', E, { tenant_id: TENANT_A, tenantId: TENANT_A }))],
        ['company B, the query names company A', reveal(tw, DOC.id, HR_B, body('id_number'), { query: { tenant_id: TENANT_A } })],
        ['company B, a header names company A', reveal(tw, DOC.id, HR_B, body('id_number'), { headers: { 'x-tenant-id': TENANT_A, 'x-company-id': TENANT_A, tenant_id: TENANT_A } })],
        ['company B, the bank letter', reveal(tw, DOC.bank, HR_B, body('account_number'))],
        ['company B, the legacy plain ID', reveal(tw, DOC.legacyId, HR_B, body('id_number'))],
      ];
      for (const [what, r] of tries) {
        const how = `${what}${legacy ? ' (company A rows with no tenant_id)' : ''}`;
        expect(r.error, `${how}: does not throw`).toBeUndefined();
        expect(r.status, `${how}: 404, not 403\n${r.raw.slice(0, 300)}`).toBe(404);
        expect(kmsOps(r), `${how}: nothing decrypted`).not.toContain('Decrypt');
        expect(attempted(r), `${how}: no event`).toEqual([]);
        expectNoLeak(r, [...secrets(ID_NUMBER), ...secrets(ACCOUNT_NUMBER), ...secrets(LEGACY_ID_NUMBER)], how);
      }
      // And the other way round: company A's HR cannot reach company B's document.
      const other = reveal(tw, DOC.b, HR_A, body('id_number', E_B));
      expect(other.status, `company A for company B's document${legacy ? ' (A rows with no tenant_id)' : ''}: 404`).toBe(404);
      expect(kmsOps(other), 'company A for company B\'s document: nothing decrypted').not.toContain('Decrypt');
      expect(attempted(other), 'company A for company B\'s document: no event').toEqual([]);
      expect(other.raw, 'company A for company B\'s document: no number').not.toContain(B_ID_NUMBER);
    }
    // Company B's own HR gets company B's number, and the event carries company B.
    const own = reveal(t, DOC.b, HR_B, body('id_number', E_B));
    expect(ok(own, 'company B for its own document'), 'company B for its own document').toEqual({ value: B_ID_NUMBER });
    expect(published(own)[0]?.detail, 'the event names company B and its HR').toMatchObject({ tenant_id: TENANT_B, employee_id: E_B, shown_by: 'sizwe.hr@companyb.example', shown_by_sub: 'sub-sizwe-0003' });

    // Bad requests.
    const bad: Array<[string, unknown, string]> = [
      ['no field', { employee_id: E }, 'Unknown field'],
      ['an empty field', { field: '', employee_id: E }, 'Unknown field'],
      ['another field name', { field: 'salary', employee_id: E }, 'Unknown field'],
      ['a field that is not a string', { field: 5, employee_id: E }, 'Unknown field'],
      ['a list for a field', { field: ['id_number'], employee_id: E }, 'Unknown field'],
      ['no employee_id', { field: 'id_number' }, 'employee_id is required'],
      ['an empty employee_id', { field: 'id_number', employee_id: '' }, 'employee_id is required'],
      ['an employee_id that is not a string', { field: 'id_number', employee_id: 7 }, 'employee_id is required'],
    ];
    for (const [what, b, words] of bad) {
      const r = reveal(t, DOC.id, HR_A, b);
      expect(r.status, `${what}: 400`).toBe(400);
      expect(r.body, `${what}: { "error": "${words}" }`).toEqual({ error: words });
      expect(awsCalls(r), `${what}: nothing is read`).toEqual([]);
    }
    const broken = reveal(t, DOC.id, HR_A, 'this is { not json');
    expect(broken.status, 'a body that is not JSON: 400').toBe(400);
    expect(awsCalls(broken), 'a body that is not JSON: nothing is read').toEqual([]);
    expect(broken.raw, 'a body that is not JSON: no parser text').not.toMatch(/Unexpected token|JSON\.parse|SyntaxError/);

    // Nothing found: 404, nothing decrypted, nothing published.
    const missing: Array<[string, Run]> = [
      ['account_number on a National ID', reveal(t, DOC.id, HR_A, body('account_number'))],
      ['id_number on a Bank confirmation', reveal(t, DOC.bank, HR_A, body('id_number'))],
      ['a field on a Matric certificate', reveal(t, DOC.matric, HR_A, body('id_number'))],
      ['a document that is not there', reveal(t, DOC.missing, HR_A, body('id_number'))],
      ['another person\'s employee_id for this document', reveal(t, DOC.id, HR_A, body('id_number', E_OTHER))],
      ['an employee_id that is not there', reveal(t, DOC.id, HR_A, body('id_number', 'EMP-0000'))],
      ['a document with no verification', reveal(t, DOC.noVerification, HR_A, body('id_number'))],
      ['a verification row that belongs to another person', reveal(t, DOC.strangersVerification, HR_A, body('id_number'))],
      ['a verification row that belongs to another company', reveal(t, DOC.otherCompanyVerification, HR_A, body('id_number'))],
    ];
    for (const [what, r] of missing) {
      expect(r.error, `${what}: does not throw`).toBeUndefined();
      expect(r.status, `${what}: 404`).toBe(404);
      expect(kmsOps(r), `${what}: nothing decrypted`).not.toContain('Decrypt');
      expect(attempted(r), `${what}: nothing published`).toEqual([]);
      expectNoLeak(r, [...secrets(ID_NUMBER), ...secrets(ACCOUNT_NUMBER)], what);
    }

    // Extra keys in the body change nothing: the time, the actor and who shows it come from the server and the token.
    const forged = reveal(t, DOC.id, HR_A, body('id_number', E, {
      shown_at: '2001-01-01T00:00:00Z', shown_by: 'attacker@evil.example', shown_by_sub: 'sub-attacker', shown_by_name: 'Mallory', actor: 'AGENT',
      tenant_id: TENANT_B, document_type: 'BANK_CONFIRMATION', time: '2001-01-01T00:00:00Z', employee: 'EMP-1599', field_shown: 'account_number',
    }));
    ok(forged, 'a forged body');
    const f = published(forged)[0]?.detail;
    expect(f, 'forged body: the event holds the token\'s person, the stored rows\' document and the server clock').toMatchObject({
      document_id: DOC.id, employee_id: E, document_type: 'NATIONAL_ID', field: 'id_number', shown_by: SHOWN_BY, shown_by_sub: 'sub-thandi-0001', shown_by_name: 'Thandi Demo-HR', actor: 'HUMAN', tenant_id: TENANT_A,
    });
    expect(Date.parse(f.shown_at), 'forged body: shown_at is now').toBeGreaterThan(Date.now() - 60_000);
    expect(JSON.stringify(published(forged)), 'forged body: no forged value reaches the event').not.toMatch(/attacker|Mallory|2001-01-01/);

    // The lookup is GetItem on documents, then GetItem on document-verification. No Scan, no Query, no write, no index.
    for (const legacy of [false, true]) {
      const r = reveal(world({ legacy }), DOC.id, HR_A, body('id_number'));
      ok(r, 'the lookup');
      const calls = dynamoCalls(r);
      expect(calls.map((c) => `${c.op} ${c.table}`), `the lookup${legacy ? ' (legacy rows)' : ''}: one GetItem on documents, then one on document-verification`).toEqual([
        'GetItem documents', 'GetItem document-verification',
      ]);
      expect(JSON.stringify(calls.map((c) => c.input)), 'the lookup uses no index').not.toMatch(/IndexName|tenant-index/);
      expect(writes(r), 'the lookup writes nothing').toEqual([]);
    }
  });

  test('AC-4 The full number leaves both GET answers; the last four and a yes/no stay; nothing else under lambda/ answers a number', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);

    const keysOf = (x: unknown, out: string[] = []): string[] => {
      if (Array.isArray(x)) x.forEach((i) => keysOf(i, out));
      else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { out.push(k); keysOf(v, out); }
      return out;
    };
    const numbers = [...secrets(ID_NUMBER), ...secrets(ACCOUNT_NUMBER), ...secrets(LEGACY_ID_NUMBER)];
    const wanted: Array<[string, string, Record<string, unknown>]> = [
      ['the ID', DOC.id, { id_number_last4: ID_LAST4, id_number_available: true, account_number_available: false }],
      ['the bank letter', DOC.bank, { account_number_last4: ACCOUNT_LAST4, account_number_available: true, id_number_available: false }],
      ['the legacy plain ID', DOC.legacyId, { id_number_available: true, account_number_available: false }],
      ['the sentinel ID', DOC.sentinelId, { id_number_available: false, account_number_available: false }],
      ['the empty account number', DOC.emptyBank, { account_number_available: false, id_number_available: false }],
      ['the NOT_FOUND account number', DOC.notFoundBank, { account_number_available: false, id_number_available: false }],
      ['the ID with no number', DOC.noNumberId, { id_number_available: false, account_number_available: false }],
    ];

    for (const legacy of [false, true]) {
      const t = world({ legacy });
      const suffix = legacy ? ' (company rows with no tenant_id)' : '';
      // GET /v1/verifications/{id}
      for (const [what, doc, expected] of wanted) {
        for (const employeeId of [E, undefined]) {
          const how = `GET /v1/verifications/{id}, ${what}${employeeId ? ', with employee_id' : ''}${suffix}`;
          const r = getOne(t, doc, HR_A, employeeId);
          const b = ok(r, how);
          const keys = keysOf(b);
          for (const k of ['id_number', 'account_number']) expect(keys, `${how}: no "${k}" key anywhere in the answer`).not.toContain(k);
          for (const n of numbers) expect(r.raw, `${how}: the answer holds no "${n}"`).not.toContain(n);
          expect(b.verification?.extracted_data, `${how}: the last four and the yes/no`).toMatchObject(expected);
          expect(writes(r), `${how}: nothing written`).toEqual([]);
        }
      }
      // GET /v1/employees/{id}/verifications, for HR and for the person it is about.
      for (const [who, caller] of [['HR', HR_A], ['the person it is about', OWNER]] as const) {
        const how = `GET /v1/employees/{id}/verifications, ${who}${suffix}`;
        const r = getPerson(t, E, caller);
        const b = ok(r, how);
        const keys = keysOf(b);
        for (const k of ['id_number', 'account_number']) expect(keys, `${how}: no "${k}" key anywhere in the answer`).not.toContain(k);
        for (const n of numbers) expect(r.raw, `${how}: the answer holds no "${n}"`).not.toContain(n);
        const byId = new Map<string, any>((b.documents ?? []).map((d: any) => [d.document_id, d]));
        for (const [what, doc, expected] of wanted) {
          const v = byId.get(doc)?.verification;
          expect(v, `${how}: ${what} answers a verification`).toBeTruthy();
          expect(v, `${how}: ${what}: the last four and the yes/no`).toMatchObject(expected);
        }
      }
    }

    // No other handler under lambda/ answers either number. A new file that names them needs a look here first.
    const names = /\bid_number\b|\baccount_number\b|idNumber|accountNumber/;
    const allowed = [
      'lambda/createEmployee/index.mjs', 'lambda/getEmployeeDocumentVerifications/index.mjs', 'lambda/getSingleDocumentVerification/index.mjs',
      'lambda/processDocumentOCR/index.mjs', 'lambda/revealDocumentField/index.mjs', 'lambda/shared/document-check.mjs', 'lambda/shared/employee-input.mjs',
    ];
    const found = filesUnder('lambda', (p) => /\.(mjs|js|py|json)$/.test(p) && !/(\.test\.|\/test\/|\/tests\/|package(-lock)?\.json$)/.test(p) && names.test(read(p)));
    expect(found, 'the files under lambda/ that name an ID number or an account number (the verifier\'s grep; see the card file)').toEqual(allowed);
    for (const f of ['lambda/getEmployees/index.mjs', 'lambda/getDocumentVerifications/index.mjs', 'lambda/getMyDocuments/index.mjs']) {
      if (existsSync(join(REPO, f))) expect(read(f), `${f} names neither number`).not.toMatch(names);
    }
    for (const f of ['lambda/getSingleDocumentVerification/index.mjs', 'lambda/getEmployeeDocumentVerifications/index.mjs']) {
      const lines = read(f).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
      expect(lines.filter((l) => /\b(id_number|account_number)\s*:/.test(l) || /\[\s*['"](id_number|account_number)['"]\s*\]/.test(l)), `${f} builds no id_number or account_number key`).toEqual([]);
    }
  });

  test('AC-8 The route\'s answers and where it is wired', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);

    // Answers.
    const good = reveal(world(), DOC.id, HR_A, body('id_number'));
    ok(good, '200');
    expect(good.headers['cache-control'] ?? '', '200: Cache-Control: no-store').toMatch(/no-store/i);
    expect(good.headers['access-control-allow-origin'], '200: CORS allow-origin').toBeTruthy();
    const methods = good.headers['access-control-allow-methods'];
    if (methods !== undefined) expect(methods, 'allowed methods include POST').toMatch(/POST/);
    expect(Object.keys(good.body as object), '200 carries value and nothing else').toEqual(['value']);
    const answers: Array<[string, Run, number, unknown]> = [
      ['400 field', reveal(world(), DOC.id, HR_A, { field: 'x', employee_id: E }), 400, { error: 'Unknown field' }],
      ['400 employee_id', reveal(world(), DOC.id, HR_A, { field: 'id_number' }), 400, { error: 'employee_id is required' }],
      ['403', reveal(world(), DOC.id, NOT_HR[2]![1], body('id_number')), 403, { error: 'Only HR can show a number' }],
      ['404', reveal(world(), DOC.missing, HR_A, body('id_number')), 404, undefined],
      ['500', reveal(world(), DOC.id, HR_A, body('id_number'), { bus: 'throw' }), 500, ERROR_500],
    ];
    for (const [what, r, status, words] of answers) {
      expect(r.status, `${what}: ${status}`).toBe(status);
      if (words !== undefined) expect(r.body, `${what}: ${JSON.stringify(words)}`).toEqual(words);
      expect(Object.keys(r.body as object), `${what}: an error body holds only "error"`).toEqual(status === 200 ? ['value'] : ['error']);
      expect(r.raw, `${what}: no exception text, no number`).not.toMatch(/Exception|stack|\bat \w+ \(|fake |arn:aws/);
      expect(r.headers['access-control-allow-origin'], `${what}: CORS allow-origin`).toBeTruthy();
      for (const n of [ID_NUMBER, ID_LAST4]) if (status !== 200) expect(r.raw, `${what}: no number`).not.toContain(n);
    }
    // A preflight is not an error, publishes nothing and reads nothing.
    const options: any = eventFor({ method: 'POST', route: '/v1/verifications/{id}/reveal', path: `/v1/verifications/${DOC.id}/reveal`, id: DOC.id, caller: HR_A });
    options.requestContext.http.method = 'OPTIONS';
    options.routeKey = 'OPTIONS /v1/verifications/{id}/reveal';
    const pre = runHandler(REVEAL, world(), options);
    expect(pre.error, 'OPTIONS: does not throw').toBeUndefined();
    expect(pre.status, 'OPTIONS: answered, not a server error').toBeLessThan(500);
    expect(attempted(pre), 'OPTIONS: no event').toEqual([]);
    expect(kmsOps(pre), 'OPTIONS: nothing decrypted').toEqual([]);
    expect(pre.raw, 'OPTIONS: no number').not.toContain(ID_NUMBER);

    // The handler's source.
    const src = read('lambda/revealDocumentField/index.mjs');
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(code, 'the handler uses requireTenant').toMatch(/requireTenant/);
    expect(code, 'the handler uses ownsItem').toMatch(/ownsItem/);
    expect(code, 'the handler imports nothing from company-rows.mjs').not.toMatch(/company-rows/);
    expect(code, 'the handler does not use findDocument').not.toMatch(/findDocument/);
    expect(code, 'the handler is not wrapped in idempotency').not.toMatch(/idempotency/i);
    expect(code, 'the handler uses no Scan, Query or write command').not.toMatch(/\b(Scan|Query|BatchGetItem|PutItem|UpdateItem|DeleteItem|BatchWriteItem|TransactWriteItems)Command\b/);
    expect(code, 'the handler uses no AI service').not.toMatch(/bedrock|anthropic|textract|comprehend|openai/i);
    expect(code, 'the handler uses the group check').toMatch(/isIdToken|inGroup|hrOnly|requireHr|hr_staff/);
    expect(code, 'the handler logs no err.message').not.toMatch(/\.message\b/);

    // The route in Terraform.
    const gw = blocks(tfFiles(), 'resource').filter((b) => b.labels[0] === 'aws_apigatewayv2_route' && new RegExp(`^"?${esc(ROUTE_KEY.replace(/\s+/g, ''))}"?$`).test(attributes(b.body).get('route_key') ?? ''));
    expect(gw.length, `infra declares the route "${ROUTE_KEY}" once`).toBe(1);
    const a = attributes(gw[0]!.body);
    expect(a.get('authorization_type'), 'the route uses the Cognito (JWT) authorizer').toMatch(/JWT/);
    expect(a.get('authorizer_id'), 'the route uses the document upload API\'s Cognito authorizer').toMatch(/document_upload_api_cognito/);
    expect(a.get('api_id'), 'the route is on the document upload API, not the Agent API').toMatch(/document_upload_api/);
    const integration = /integrations\/\$\{aws_apigatewayv2_integration\.(\w+)\.id\}/.exec(a.get('target') ?? '')?.[1];
    expect(integration, 'the route targets an integration').toBeTruthy();
    const integrationBlock = blocks(tfFiles(), 'resource').find((b) => b.labels[0] === 'aws_apigatewayv2_integration' && b.labels[1] === integration);
    const info = revealInfra();
    expect(info.found, info.found ? '' : (info as { why: string }).why).toBe(true);
    const fnResource = info.found ? info.fn.labels[1] : '';
    expect(attributes(integrationBlock?.body ?? '').get('integration_uri'), 'the integration calls revealDocumentField').toMatch(new RegExp(`aws_lambda_function\\.${fnResource}\\.invoke_arn`));
    expect(
      blocks(tfFiles(), 'resource').some((b) => b.labels[0] === 'aws_lambda_permission' && new RegExp(`aws_lambda_function\\.${fnResource}\\.(function_name|arn)`).test(b.body) && /apigateway\.amazonaws\.com/.test(b.body)),
      'API Gateway may invoke the Lambda (aws_lambda_permission)',
    ).toBe(true);
    const apiFiles = tfFiles().filter((f) => /reveal/.test(read(`infra/${f.split('/').pop()}`)) && /aws_apigatewayv2_route|aws_api_gateway_/.test(read(`infra/${f.split('/').pop()}`)));
    for (const f of apiFiles) {
      for (const b of blocks([f], 'resource').filter((x) => /^aws_api(gatewayv2_route|_gateway_method)$/.test(x.labels[0]!) && /reveal/.test(x.body))) {
        expect(b.body, 'only one route names reveal, and it is on the document upload API').toMatch(/document_upload_api/);
      }
    }
    // Throttling (S-1) and, if set, reserved concurrency.
    const gwText = read('infra/apigateway.tf');
    const stages = blocks(tfFiles(), 'resource').filter((b) => b.labels[0] === 'aws_apigatewayv2_stage');
    const settings = stages.flatMap((s) => nested(s.body, 'route_settings')).filter((x) => x.includes(ROUTE_KEY));
    expect(settings.length, 'the route has its own throttling (route_settings in the stage)').toBe(1);
    const sa = attributes(settings[0]!);
    const rate = Number(sa.get('throttling_rate_limit'));
    const burst = Number(sa.get('throttling_burst_limit'));
    expect(rate, 'the route\'s rate limit is set and low (the stage default is 50)').toBeGreaterThan(0);
    expect(rate, 'the route\'s rate limit is set and low (at most 5 per second)').toBeLessThanOrEqual(5);
    expect(burst, 'the route\'s burst limit is set and low (at most 10)').toBeGreaterThan(0);
    expect(burst, 'the route\'s burst limit is set and low (at most 10)').toBeLessThanOrEqual(10);
    // Reserved concurrency may be left out: the dev account's limit is 10 and AWS keeps 100 unreserved, so any
    // reservation fails to deploy there (as NH-71 in infra/ai_chat.tf). If it is set, it is a number from 1 to 5.
    if (info.found) {
      const fnAttrs = attributes(info.fn.body);
      if (fnAttrs.has('reserved_concurrent_executions')) {
        const raw = fnAttrs.get('reserved_concurrent_executions') ?? '';
        expect(raw, 'if the Lambda reserves concurrency, it is a plain number').toMatch(/^\d+$/);
        const reserved = Number(raw);
        expect(reserved, 'if the Lambda reserves concurrency, it is 1 to 5').toBeGreaterThanOrEqual(1);
        expect(reserved, 'if the Lambda reserves concurrency, it is 1 to 5').toBeLessThanOrEqual(5);
      }
    }
    // No new request header, so no CORS change: the allow_headers lines are as they were on develop.
    const cors = [...gwText.matchAll(/allow_headers\s*=\s*(\[[^\]]*\])/g)].map((m) => m[1]!.replace(/\s+/g, ''));
    expect(cors, 'both APIs allow the same three headers as before (no new header)').toEqual(['["authorization","content-type","idempotency-key"]', '["authorization","content-type","idempotency-key"]']);

    // OpenAPI and the agent tools.
    const spec = openapi14('/v1/verifications/{id}/reveal', 'post');
    expect(spec.found, 'POST /v1/verifications/{id}/reveal is in api/openapi.yaml').toBe(true);
    expect(spec.operation['x-tenant'], 'the route says it is company-scoped (x-tenant)').toBeTruthy();
    expect(spec.operation['x-roles'], 'x-roles is [hr_staff]').toEqual(['hr_staff']);
    for (const code of ['200', '400', '403', '404', '500']) expect(spec.responses, `the route lists ${code}`).toContain(code);
    expect(spec.fields['200'], 'the 200 answer holds only value').toEqual(['value']);
    expect(spec.request, 'the request takes field and employee_id').toEqual(expect.arrayContaining(['field', 'employee_id']));
    expect(spec.request.filter((k) => !['field', 'employee_id'].includes(k)), 'the request takes nothing else').toEqual([]);
    const yaml = read('api/openapi.yaml');
    expect(yaml.split('\n').filter((l) => /^\s{2}\/agent\/.*reveal/.test(l)), 'no Agent API route for reveal').toEqual([]);
    expect(read('api/agent-tools.json'), 'agent-tools.json has no tool for it').not.toMatch(/reveal|field_shown/i);
    expect(read('lambda/revealDocumentField/index.mjs') + yaml, 'nothing new asks for an AI call').not.toMatch(/reveal[\s\S]{0,400}bedrock/i);

    const get = openapi14('/v1/verifications/{id}', 'get');
    const person = openapi14('/v1/employees/{id}/verifications', 'get');
    for (const [what, r] of [['GET /v1/verifications/{id}', get], ['GET /v1/employees/{id}/verifications', person]] as const) {
      expect(r.found, `${what} is in api/openapi.yaml`).toBe(true);
      for (const f of ['id_number_last4', 'account_number_last4', 'id_number_available', 'account_number_available']) expect(r.fields['200'] ?? [], `${what}: 200 lists "${f}"`).toContain(f);
      for (const f of ['id_number', 'account_number']) expect(r.fields['200'] ?? [], `${what}: 200 no longer lists "${f}"`).not.toContain(f);
    }
  });

  test('AC-9 The new role can do only what it needs', async ({}, testInfo) => {
    textOnce(testInfo.project.name);
    const info = revealInfra();
    expect(info.found, info.found ? '' : (info as { why: string }).why).toBe(true);
    if (!info.found) return;
    const { role, allows } = info;
    expect(unexpected(allows), 'every line of the role\'s policy is one the card names (logs on its own group, X-Ray, GetItem on documents and document-verification, kms:Decrypt and kms:DescribeKey on the PII key, events:PutEvents on the onboarding bus)').toEqual([]);
    const has = (a: string, r: string) => allows.some(([x, y]) => x === a && y === r);
    const table = (n: string) => `arn:aws:dynamodb:af-south-1:000000000000:table/${n}`;
    expect(has('dynamodb:GetItem', table('documents')), 'GetItem on documents').toBe(true);
    expect(has('dynamodb:GetItem', table('document-verification')), 'GetItem on document-verification').toBe(true);
    expect(has('kms:Decrypt', 'module.kms_pii.key_arn'), 'kms:Decrypt on the PII key ARN').toBe(true);
    expect(has('kms:DescribeKey', 'module.kms_pii.key_arn'), 'kms:DescribeKey on the PII key ARN').toBe(true);
    expect(has('events:PutEvents', 'aws_cloudwatch_event_bus.naleko_onboarding.arn'), 'events:PutEvents on the onboarding bus').toBe(true);
    for (const a of ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents']) expect(allows.some(([x]) => x === a), `${a} (its own logs)`).toBe(true);
    for (const [a, r] of allows) {
      if (!a.startsWith('xray:')) expect(r, `${a}: no wildcard resource`).not.toMatch(/\*(?!$)|^\*$/);
      expect(a, 'no wildcard action').not.toMatch(/\*/);
    }
    for (const bad of ['kms:Encrypt', 'kms:ReEncrypt', 'kms:GenerateDataKey', 'kms:GenerateDataKeyWithoutPlaintext', 'dynamodb:Scan', 'dynamodb:Query', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:BatchGetItem']) {
      expect(allows.filter(([a]) => a.startsWith(bad)), `the role may not ${bad}`).toEqual([]);
    }
    expect(info.attachments.map((b) => b.raw), 'no managed policy is attached to the role').toEqual([]);
    const roleBlock = blocks(tfFiles(), 'resource').find((b) => b.labels[0] === 'aws_iam_role' && b.labels[1] === role);
    expect(roleBlock?.body ?? '', 'the role trusts lambda.amazonaws.com').toMatch(/lambda\.amazonaws\.com/);
    expect((roleBlock?.body ?? '').match(/Service\s*=/g)?.length ?? 0, 'and nothing else').toBe(1);

    // In no key list, and no change to the key policy files.
    const mentions = tfFiles().filter((f) => new RegExp(`aws_iam_role\\.${role}\\b`).test(readFileSync(f, 'utf8'))).map((f) => f.slice(INFRA.length + 1));
    expect(mentions.sort(), `the role is named only where a role is declared and used (not in kms.tf, nothing in modules/kms)`).toEqual(['iam_per_lambda.tf', 'lambdas.tf']);
    const kms = blocks([join(INFRA, 'kms.tf')], 'module').find((b) => b.labels[0] === 'kms_pii');
    const lists = ['allowed_role_arns', 'dynamodb_read_role_arns', 'cognito_sender_decrypt_role_arns'];
    for (const l of lists) expect(attributes(kms?.body ?? '').get(l) ?? '', `the role is not in kms_pii ${l}`).not.toContain(role);
    expect(read('infra/kms.tf'), 'infra/kms.tf does not name the role or its Lambda').not.toMatch(new RegExp(`${role}|${FN}`));
    for (const f of filesUnder('infra/modules/kms', (p) => p.endsWith('.tf'))) expect(read(f), `${f} does not name the role`).not.toContain(role);

    // The Lambda's own settings and every list a Lambda is in (as getMyDocuments, the last new one).
    expect(info.fn.body, 'the Lambda is declared once, with tracing and its own log group').toMatch(/tracing_config/);
    const env = attributes(info.fn.body);
    void env;
    const text = info.fn.raw;
    expect(text, 'KMS_KEY_ARN is the PII key').toMatch(/KMS_KEY_ARN\s*=\s*module\.kms_pii\.key_arn/);
    expect(text, 'EVENT_BUS_NAME is the onboarding bus').toMatch(/EVENT_BUS_NAME\s*=\s*aws_cloudwatch_event_bus\.naleko_onboarding\.name/);
    expect(text, 'LEGACY_TENANT_ID is set (the company rules need it)').toMatch(/LEGACY_TENANT_ID/);
    for (const f of tfFiles()) {
      const src = readFileSync(f, 'utf8');
      if (/getMyDocuments/.test(src)) expect(src, `${f.slice(INFRA.length + 1)} lists getMyDocuments, so it lists revealDocumentField`).toMatch(new RegExp(`${FN}|reveal_document_field`));
    }
  });

  test('S-2 The audit bus keeps what it could not deliver, and says so (decision: droppable if S-2 is taken as its own card)', async ({}, testInfo) => {
    textOnce(testInfo.project.name);
    const resources = blocks(tfFiles(), 'resource');
    const target = resources.find((b) => b.labels[0] === 'aws_cloudwatch_event_target' && /audit_log_consumer/.test(b.labels[1] ?? ''));
    expect(target, 'the audit consumer\'s event target is in infra/eventbridge.tf').toBeTruthy();
    const dlq = /dead_letter_config\s*\{[^}]*arn\s*=\s*aws_sqs_queue\.(\w+)\.arn/.exec(target?.body ?? '')?.[1];
    expect(dlq, 'the audit target has a dead-letter queue (dead_letter_config { arn = aws_sqs_queue.<name>.arn })').toBeTruthy();
    const queue = resources.find((b) => b.labels[0] === 'aws_sqs_queue' && b.labels[1] === dlq);
    expect(queue?.body ?? '', 'the dead-letter queue is encrypted').toMatch(/kms_master_key_id|sqs_managed_sse_enabled\s*=\s*true/);
    expect(
      resources.some((b) => b.labels[0] === 'aws_sqs_queue_policy' && new RegExp(`aws_sqs_queue\\.${dlq}\\b`).test(b.body) && /events\.amazonaws\.com/.test(b.body)),
      'EventBridge may send to that queue (aws_sqs_queue_policy)',
    ).toBe(true);
    const alarms = resources.filter((b) => b.labels[0] === 'aws_cloudwatch_metric_alarm');
    expect(alarms.some((b) => /ApproximateNumberOfMessagesVisible/.test(b.body) && new RegExp(`aws_sqs_queue\\.${dlq}\\b`).test(b.body)), 'an alarm on the dead-letter queue\'s depth').toBe(true);
    expect(read('infra/alarms.tf') + alarms.map((b) => b.body).join('\n'), 'an alarm on auditLogConsumer errors').toMatch(/auditLogConsumer/);
    const consumer = read('lambda/auditLogConsumer/index.mjs').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(consumer, 'auditLogConsumer logs the error name, not reason?.message').not.toMatch(/reason\??\.message/);
  });

  test('S-3 The seed\'s numbers are obviously made up, and the script never prints them', async ({}, testInfo) => {
    textOnce(testInfo.project.name);
    const seed = read('scripts/ci/seed-dev.py');
    const idNumbers = [...seed.matchAll(/"idNumber"\s*:\s*\{\s*"S"\s*:\s*"(\d{13})"\s*\}/g)].map((m) => m[1]!);
    const accounts = [...seed.matchAll(/"accountNumber"\s*:\s*\{\s*"S"\s*:\s*"(\d+)"\s*\}/g)].map((m) => m[1]!);
    expect(idNumbers.length, 'Naledi\'s National ID row holds one made-up plain idNumber ("idNumber": {"S": "<13 digits>"})').toBe(1);
    expect(accounts.length, 'Naledi\'s bank row holds one made-up accountNumber ("accountNumber": {"S": "<digits>"})').toBe(1);
    const luhn = (d: string) => {
      let sum = 0;
      [...d].reverse().forEach((c, i) => { let n = Number(c); if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; } sum += n; });
      return sum % 10 === 0;
    };
    expect(luhn(idNumbers[0]!), 'the made-up ID number fails the SA ID check digit (it can never be a real person\'s)').toBe(false);
    expect(accounts[0]!, 'the made-up account number is zeros, like 0000000000').toMatch(/^0{6,}\d?$/);
    for (const n of [idNumbers[0]!, accounts[0]!]) expect(seed.split(`"${n}"`).length - 1, `the made-up number "${n.slice(0, 2)}..." is written once in the script (in one place, never in a print)`).toBe(1);
    const printing = seed.split('\n').filter((l) => /\b(print|log|logging|echo|write)\b|logger\./.test(l) && /idNumber|accountNumber|id_number|account_number/.test(l));
    expect(printing, 'no print or log line names the numbers').toEqual([]);
    expect(seed, 'the docstring no longer says verification rows carry no extracted data').not.toMatch(/Verification rows carry no extracted data/);
  });
});

// ---------------------------------------------------------------- the two pages

const NALEDI = { employee_id: 'EMP-1501', first_name: 'Naledi', last_name: 'Dlamini', id_number_last4: ID_LAST4 };
const UPLOADED = '2026-11-04T08:00:00Z';
const BANK_READ: Read = { account_holder: 'MS N DLAMINI', bank_name: 'Ubuntu Mutual Bank', account_number: ACCOUNT_NUMBER, branch_code: '250655', account_type: 'Cheque' };
const ID_READ: Read = { id_number: ID_NUMBER, name: 'NALEDI THANDO', surname: 'DLAMINI', date_of_birth: '1998-03-14', gender: 'FEMALE', citizenship: 'SA CITIZEN BY BIRTH' };
const OTHER_ID = '7001015009088';
const OTHER_ACCOUNT = '40012345678';

let serial = 0;
function doc(p: Partial<FakeDocument> & Pick<FakeDocument, 'document_type'>, readOf: Read): FakeDocument {
  serial++;
  return {
    document_id: `doc_17635${String(serial).padStart(8, '0')}`,
    employee: NALEDI,
    file_name: `${p.document_type.toLowerCase().replace(/_/g, '-')}-${serial}.pdf`,
    uploaded_at: UPLOADED,
    ocr_status: 'MANUAL_REVIEW',
    ocr_completed_at: '2026-11-04T08:02:00Z',
    verification: { confidence: 95, check: 'MATCHES', read: readOf, reasoning: 'Sample data.', checks: {} },
    ...p,
  };
}

/** Kagiso: an ID read with its number, an older ID read with none, and a bank letter with an account number. */
function kagiso(): FakePerson {
  return {
    employee: storedEmployee({ first_name: 'Kagiso', last_name: 'Molefe', job_title: 'Bookkeeper', department: 'Finance', stage: 'DOCUMENTS_SUBMITTED', phone: '+27 82 941 7736' }),
    documents: [
      storedDocument({ document_type: 'NATIONAL_ID', file_name: 'kagiso-id-front.pdf', ocr_status: 'PASSED', uploaded_at: '2026-11-09T08:02:00Z', verification: { confidence: 96, idNumber: ID_NUMBER } }),
      storedDocument({ document_type: 'NATIONAL_ID', file_name: 'old-id-scan.jpg', ocr_status: 'FAILED', uploaded_at: '2026-11-02T10:00:00Z', verification: { confidence: 41 } }),
      storedDocument({ document_type: 'BANK_CONFIRMATION', file_name: 'fnb-letter-nov.pdf', ocr_status: 'MANUAL_REVIEW', uploaded_at: '2026-11-10T09:15:00Z', verification: { confidence: 72, accountNumber: ACCOUNT_NUMBER } }),
    ],
  };
}

type Surface = {
  key: string;
  noun: string;
  full: string;
  field: 'id_number' | 'account_number';
  docId: string;
  employeeId: string;
  path: string;
  heading: string;
  /** The way out of the page in the app, and what it leads to. */
  leave: { link: string; to: RegExp };
};

const HR_HOME = /\/hr$/;
const LIST_PATH = '/hr/documents';

/** The three places a Show can be: the employee page (ID), the document page (ID) and the document page (bank). */
function surfaces(docs: DocumentsFake, one: DocumentFake): Surface[] {
  const p = kagiso();
  docs.add(p);
  const idDoc = doc({ document_type: 'NATIONAL_ID' }, ID_READ);
  const bankDoc = doc({ document_type: 'BANK_CONFIRMATION' }, BANK_READ);
  one.add(idDoc, bankDoc);
  const idOnPerson = p.documents[0]!;
  return [
    {
      key: 'employee page, ID number', noun: 'ID number', full: ID_NUMBER, field: 'id_number', docId: idOnPerson.document_id, employeeId: p.employee.employee_id,
      path: `/hr/employees/${encodeURIComponent(p.employee.employee_id)}`, heading: 'Kagiso Molefe', leave: { link: 'Home', to: HR_HOME },
    },
    {
      key: 'document page, ID number', noun: 'ID number', full: ID_NUMBER, field: 'id_number', docId: idDoc.document_id, employeeId: NALEDI.employee_id,
      path: `${LIST_PATH}/${encodeURIComponent(idDoc.document_id)}`, heading: `${TYPE_NAME.NATIONAL_ID}, Naledi Dlamini`, leave: { link: 'Documents to check', to: new RegExp(`${esc(LIST_PATH)}$`) },
    },
    {
      key: 'document page, account number', noun: 'account number', full: ACCOUNT_NUMBER, field: 'account_number', docId: bankDoc.document_id, employeeId: NALEDI.employee_id,
      path: `${LIST_PATH}/${encodeURIComponent(bankDoc.document_id)}`, heading: `${TYPE_NAME.BANK_CONFIRMATION}, Naledi Dlamini`, leave: { link: 'Documents to check', to: new RegExp(`${esc(LIST_PATH)}$`) },
    },
  ];
}

/** Opens a page straight from its address, signing in first when needed. */
async function openAt(page: Page, signIn: SignInPage, hr: Login, s: Surface): Promise<void> {
  await page.goto(s.path);
  if (await signIn.email.isVisible().catch(() => false)) {
    await signIn.signInAs(hr);
  } else {
    await Promise.race([
      signIn.email.waitFor({ state: 'visible', timeout: 15_000 }).then(() => signIn.signInAs(hr)),
      heading1(page).waitFor({ state: 'visible', timeout: 15_000 }),
    ]).catch(() => undefined);
  }
  await expect(page).toHaveURL(new RegExp(`${esc(s.path)}(\\?.*)?$`), { timeout: 20_000 });
  await expect(heading1(page)).toHaveText(s.heading, { timeout: 20_000 });
}

test.describe('ONB-14 the pages', () => {
  test('AC-4 (screen) Before any Show the full number is nowhere; the only response that holds it is the answer to the Show', async ({ page, signIn, hr, docs, one, revealFake }) => {
    noBackendOnly();
    const list = surfaces(docs!, one!);
    const seen = watch(page);
    const stored = new Map<string, string>();
    for (const s of list) {
      await openAt(page, signIn, hr, s);
      await expectHidden(page, s.full, s.key);
      for (const other of [ID_NUMBER, ACCOUNT_NUMBER]) {
        const text = await bodyText(page);
        expect(holds(text, other), `${s.key}: neither full number is in the page text`).toBe(false);
        expect(holds(await page.locator('body').ariaSnapshot(), other), `${s.key}: neither full number is in the accessibility tree`).toBe(false);
      }
      const kept = await keptText(page);
      for (const other of [ID_NUMBER, ACCOUNT_NUMBER]) expect(holds(kept, other), `${s.key}: no number in the address, the title, history state or browser storage`).toBe(false);
      stored.set(s.key, kept);
    }
    for (const b of seen.bodies) for (const n of [ID_NUMBER, ACCOUNT_NUMBER]) expect(holds(b, n), 'no earlier response body holds a full number').toBe(false);
    expect(revealFake!.posts(), 'nothing was asked to be shown').toEqual([]);

    // After a Show, the answer to the reveal POST is the one response that holds the number.
    const s = list[0]!;
    await openAt(page, signIn, hr, s);
    await showButton(page).click();
    await expectShown(page, s.full, s.key);
    expect(seen.reveals.length, 'one answer from the reveal route').toBe(1);
    expect(seen.reveals[0], 'it holds the number').toContain(s.full);
    for (const b of seen.bodies) expect(holds(b, s.full), 'no other response body holds it').toBe(false);
  });

  test('AC-5 The page records, then shows; if it cannot record, the number stays hidden', async ({ page, signIn, hr, docs, one, revealFake }) => {
    noBackendOnly();
    test.setTimeout(240_000);
    const reveal = revealFake!;
    for (const s of surfaces(docs!, one!)) {
      reveal.calls.length = 0;
      reveal.mode = 'ok';
      reveal.override = undefined;
      await openAt(page, signIn, hr, s);
      await expectHidden(page, s.full, `${s.key}, before Show`);

      // One POST, with the right document and field, and no Idempotency-Key; a double click sends one; busy and hidden while held.
      reveal.mode = 'hold';
      await showButton(page).dblclick();
      await waitForPosts(reveal, 1, s.key);
      await page.waitForTimeout(400);
      expect(reveal.posts().length, `${s.key}: a double click sends one POST`).toBe(1);
      expect(await isBusy(showButton(page)), `${s.key}: while the answer is held the button is busy`).toBe(true);
      await expectHidden(page, s.full, `${s.key}, answer held`);
      reveal.release();
      await expectShown(page, s.full, s.key);
      const p = reveal.posts(s.docId)[0]!;
      expect(p.method, `${s.key}: POST`).toBe('POST');
      expect(p.body, `${s.key}: the body is { field, employee_id }`).toEqual({ field: s.field, employee_id: s.employeeId });
      expect(p.idempotencyKey, `${s.key}: no Idempotency-Key`).toBeNull();
      expect(Object.keys(p.headers).filter((h) => /idempotency/i.test(h)), `${s.key}: no Idempotency-Key header`).toEqual([]);
      expect(p.authorization, `${s.key}: the person's token goes along`).toMatch(/^Bearer /);
      expect(reveal.posts().length, `${s.key}: still one POST for one Show`).toBe(1);

      // The number on the page is the answer to that POST and nothing else.
      await hideButton(page).click();
      await expectHidden(page, s.full, `${s.key}, after Hide`);
      reveal.override = s.field === 'id_number' ? OTHER_ID : OTHER_ACCOUNT;
      await showButton(page).click();
      await expect(main(page).getByText(spaced(reveal.override)), `${s.key}: the page shows what the answer said`).toBeVisible();
      expect(holds(await bodyText(page), s.full), `${s.key}: and not the stored number from anywhere else`).toBe(false);
      await hideButton(page).click();
      reveal.override = undefined;

      // Every way the answer can fail: the number stays hidden, the design system's words, role alert, and Try again sends one more POST.
      for (const mode of ['error', 'forbidden', 'not-found', 'offline'] as const) {
        const how = `${s.key}, the reveal route says ${mode}`;
        const before = reveal.posts().length;
        reveal.mode = mode;
        await main(page).getByRole('button', { name: /^(Show|Try again)\b/ }).click();
        await expect(failureLine(page), `${how}: "${WORDS.failed}" as an alert`).toBeVisible();
        await expectHidden(page, s.full, how);
        expect(reveal.posts().length, `${how}: one POST`).toBe(before + (mode === 'offline' ? 1 : 1));
        await expect(tryAgainButton(page), `${how}: Try again`).toBeVisible();
        expect(await page.getByText(SHOWN).count(), `${how}: no "Shown to you" line`).toBe(0);
        const during = reveal.posts().length;
        await tryAgainButton(page).click();
        await waitForPosts(reveal, during + 1, `${how}, Try again`);
        await expect(failureLine(page), `${how}: still failing after Try again`).toBeVisible();
        expect(reveal.posts().length, `${how}: Try again sends exactly one more POST`).toBe(during + 1);
        await expectHidden(page, s.full, `${how}, after Try again`);
      }
      // ... and Try again works once the route does.
      reveal.mode = 'ok';
      await tryAgainButton(page).click();
      await expectShown(page, s.full, `${s.key}, Try again after the route is back`);
    }
  });

  test('AC-6 It hides again, and the app keeps nothing', async ({ page, signIn, hr, docs, one, revealFake }) => {
    noBackendOnly();
    test.setTimeout(240_000);
    const reveal = revealFake!;
    await page.clock.install();
    const seen = watch(page);
    for (const s of surfaces(docs!, one!)) {
      reveal.calls.length = 0;
      reveal.override = undefined;
      await openAt(page, signIn, hr, s);
      const A = s.field === 'id_number' ? OTHER_ID : OTHER_ACCOUNT;
      const kept = async (why: string) => {
        const text = await keptText(page);
        for (const n of [s.full, A]) {
          expect(holds(text, n), `${s.key}, ${why}: no number in storage, history state, the address or the title`).toBe(false);
          expect(seen.console.some((l) => holds(l, n)), `${s.key}, ${why}: no number in any console line`).toBe(false);
        }
      };
      let shows = 0;
      const show = async () => {
        await showButton(page).click();
        shows++;
        await waitForPosts(reveal, shows, `${s.key}, Show ${shows}`);
        await expect(hideButton(page)).toBeVisible();
      };

      // Hide. A second Show asks again, and shows what the second answer says, not the first.
      reveal.override = A;
      await show();
      await expect(main(page).getByText(spaced(A)), `${s.key}: Show 1 shows the first answer`).toBeVisible();
      await kept('shown');
      await hideButton(page).click();
      await expectHidden(page, A, `${s.key}, after Hide`, { lastFour: false });
      await expectHidden(page, s.full, `${s.key}, after Hide`);
      await kept('after Hide');
      reveal.override = undefined;
      await show();
      await expectShown(page, s.full, `${s.key}, Show 2`);
      expect(holds(await bodyText(page), A), `${s.key}: the first answer is gone, not kept`).toBe(false);

      // 2 minutes: still shown at 1:50, hidden by 2:05.
      await page.clock.fastForward('01:50');
      await expect(main(page).getByText(spaced(s.full)), `${s.key}: still shown before 2 minutes`).toBeVisible();
      await page.clock.fastForward('00:15');
      await expect(showButton(page), `${s.key}: Show is offered again after 2 minutes`).toBeVisible();
      await expectHidden(page, s.full, `${s.key}, after 2 minutes`);
      await kept('after 2 minutes');

      // Leaving the page and coming back.
      await show();
      await expectShown(page, s.full, `${s.key}, Show 3`);
      await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: s.leave.link, exact: true }).click();
      await expect(page).toHaveURL(s.leave.to);
      await page.goBack();
      await expect(heading1(page)).toHaveText(s.heading, { timeout: 20_000 });
      await expectHidden(page, s.full, `${s.key}, after leaving the page and coming back`);
      await kept('after leaving');

      // Every Show is a new call: the fourth Show is the fourth POST.
      await show();
      await expectShown(page, s.full, `${s.key}, Show 4`);
      expect(reveal.posts(s.docId).length, `${s.key}: four Shows make four POSTs`).toBe(4);
      await hideButton(page).click();
      await kept('end');
    }
  });

  test('AC-7 "Showing this is recorded" sits next to every Show, and only next to a Show', async ({ page, signIn, hr, docs, one, revealFake }) => {
    noBackendOnly();
    for (const s of surfaces(docs!, one!)) {
      await openAt(page, signIn, hr, s);
      await expect(showButton(page), `${s.key}: one Show`).toHaveCount(1);
      const text = await bodyText(page);
      expect(text.split(WORDS.line).length - 1, `${s.key}: the line "${WORDS.line}" shows once, beside the Show (before it is pressed)`).toBe(1);
      await expect(showButton(page), `${s.key}: Show is described by the line`).toHaveAccessibleDescription(new RegExp(WORDS.line));
      const near = await page.evaluate((line) => {
        const btn = [...document.querySelectorAll('main button')].find((b) => /^Show\b/.test((b as HTMLElement).innerText.trim()));
        const el = [...document.querySelectorAll('main *')].filter((e) => e.children.length === 0 && (e.textContent ?? '').trim() === line)[0];
        if (!btn || !el) return null;
        const a = btn.getBoundingClientRect();
        const b = el.getBoundingClientRect();
        return Math.min(Math.abs(a.top - b.bottom), Math.abs(b.top - a.bottom), Math.abs(a.top - b.top));
      }, WORDS.line);
      expect(near, `${s.key}: the line is beside Show (the same row or just above or below)`).not.toBeNull();
      expect(near!, `${s.key}: the line is beside Show`).toBeLessThan(120);
      for (const old of OLD_WORDS) expect(text, `${s.key}: nothing says ${old}`).not.toMatch(old);
      await showButton(page).click();
      await expect(hideButton(page)).toBeVisible();
      expect(await bodyText(page), `${s.key}: after Show, never "Revealing is recorded"`).not.toMatch(OLD_WORDS[0]!);
      expect(revealFake!.posts(s.docId).length, `${s.key}: Show sent its POST`).toBe(1);
    }

    // A number with no Show (nothing can be shown) has no line: Kagiso's older ID was read with no number.
    const p = [...docs!.people.values()][0]!;
    await page.goto(`/hr/employees/${encodeURIComponent(p.employee.employee_id)}`);
    await expect(heading1(page)).toHaveText('Kagiso Molefe');
    const shows = await showButton(page).count();
    const lines = (await bodyText(page)).split(WORDS.line).length - 1;
    expect(shows, 'Kagiso\'s page: only the ID with a number has Show').toBe(1);
    expect(lines, 'Kagiso\'s page: the line shows once, for that Show, and not for the ID with no number').toBe(1);

    // The old words are nowhere in the app's sources.
    const files: string[] = [];
    for (const f of filesUnder('pepla-web/src/app', (x) => /\.(ts|html)$/.test(x))) files.push(f);
    const old = files.filter((f) => /Revealing is recorded/.test(read(f)));
    expect(old, 'no source file under pepla-web/src/app says "Revealing is recorded"').toEqual([]);
    const adjacent = files.filter((f) => /\bpp-masked-field\b/.test(read(f)) && !/\[notice\]\s*=\s*"true"/.test(read(f)) && /(employee-detail\.page|core\/documents\/document)/.test(f));
    expect(adjacent, 'every pp-masked-field on the two pages sets [notice]="true"').toEqual([]);
  });

  test('AC-10 Keyboard, screen reader and axe in every state', async ({ page, signIn, hr, docs, one, revealFake }) => {
    noBackendOnly();
    test.setTimeout(240_000);
    const reveal = revealFake!;
    const serious = async (what: string) => {
      const result = await new AxeBuilder({ page }).analyze();
      const bad = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`);
      expect(bad, `${what}: axe finds no serious or critical issue`).toEqual([]);
    };
    for (const s of surfaces(docs!, one!)) {
      reveal.calls.length = 0;
      reveal.mode = 'ok';
      await openAt(page, signIn, hr, s);
      await serious(`${s.key}, hidden`);

      // Keyboard only: reach Show, press it, focus stays on the button, which now reads Hide.
      await tabTo(page, () => showButton(page).evaluate((b) => b === document.activeElement), `${s.key}: the Show button`);
      reveal.mode = 'hold';
      await page.keyboard.press('Enter');
      await waitForPosts(reveal, 1, s.key);
      await expect(showButton(page).or(hideButton(page)), `${s.key}: busy`).toBeVisible();
      await serious(`${s.key}, busy`);
      reveal.release();
      await expect(hideButton(page)).toBeVisible();
      expect(await focusedText(page), `${s.key}: focus stays on the button, which now reads Hide`).toMatch(/^Hide\b/);
      await expect(page.getByRole('status').filter({ hasText: SHOWN }), `${s.key}: the shown line is a polite status`).toBeVisible();
      const live = await page.getByRole('status').filter({ hasText: SHOWN }).first().evaluate((e) => e.getAttribute('aria-live') ?? 'polite');
      expect(live, `${s.key}: the status is polite`).not.toBe('assertive');
      await serious(`${s.key}, shown`);

      // Hide by keyboard, then a failed Show: the failure is an alert and Try again is reachable by keyboard.
      await page.keyboard.press('Enter');
      await expect(showButton(page)).toBeVisible();
      expect(await focusedText(page), `${s.key}: focus is still on the button after Hide`).toMatch(/^Show\b/);
      reveal.mode = 'error';
      await page.keyboard.press('Enter');
      await expect(failureLine(page), `${s.key}: the failure line is an alert`).toBeVisible();
      await serious(`${s.key}, failed`);
      await tabTo(page, () => tryAgainButton(page).evaluate((b) => b === document.activeElement), `${s.key}: Try again`);
      reveal.mode = 'ok';
      await page.keyboard.press('Enter');
      await expect(hideButton(page), `${s.key}: Try again by keyboard shows the number`).toBeVisible();
      await expectShown(page, s.full, `${s.key}, after Try again by keyboard`);
    }
  });

  test('AC-11 Phone: every state fits the screen, below the top bar, with touch-sized buttons', async ({ page, signIn, hr, docs, one, revealFake }, testInfo) => {
    noBackendOnly();
    test.skip(testInfo.project.name !== 'phone-390', 'Phone width only.');
    test.setTimeout(240_000);
    const reveal = revealFake!;
    const fits = async (what: string, buttons: Array<() => ReturnType<typeof showButton>>) => {
      expect(await hiddenOrCovered(page), `${what}: nothing is under the top bar, outside the screen or covered`).toEqual([]);
      expect(await noSidewaysScroll(page), `${what}: nothing is wider than the screen`).toEqual([]);
      for (const get of buttons) {
        const box = await get().boundingBox();
        expect(box, `${what}: the button is there`).not.toBeNull();
        expect(box!.height, `${what}: the button is at least 44 pixels tall`).toBeGreaterThanOrEqual(44);
      }
    };
    for (const s of surfaces(docs!, one!)) {
      reveal.calls.length = 0;
      reveal.mode = 'ok';
      await openAt(page, signIn, hr, s);
      await expect(main(page).getByText(WORDS.line), `${s.key}: the line shows`).toBeVisible();
      await fits(`${s.key}, hidden`, [() => showButton(page)]);

      reveal.mode = 'hold';
      await showButton(page).click();
      await waitForPosts(reveal, 1, s.key);
      await fits(`${s.key}, busy`, [() => showButton(page)]);
      reveal.release();
      await expectShown(page, s.full, s.key);
      await fits(`${s.key}, shown`, [() => hideButton(page)]);
      await expect(main(page).getByText(spaced(s.full)), `${s.key}: the whole number is visible`).toBeInViewport({ ratio: 0.99 }).catch(() => undefined);

      await hideButton(page).click();
      reveal.mode = 'error';
      await showButton(page).click();
      await expect(failureLine(page)).toBeVisible();
      await fits(`${s.key}, failed`, [() => tryAgainButton(page)]);
      await failureLine(page).scrollIntoViewIfNeeded();
      await expect(failureLine(page), `${s.key}: the failure message is fully visible`).toBeInViewport();
    }
  });
});

// ---------------------------------------------------------------- pepla-dev

function uuid5(namespace: string, name: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const h = createHash('sha1').update(Buffer.concat([ns, Buffer.from(name, 'utf8')])).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
const SEED_NS = '6f1c2b1e-5d0a-4c55-9a59-2f1f0e1d7c11';
const NALEDI_DEV_ID = uuid5(SEED_NS, 'pepla-demo-naledi.dlamini@blackhole.postmarkapp.com');
/** Naledi Dlamini's National ID in scripts/ci/seed-dev.py (ONB-13). */
const SEEDED_ID_DOC = 'doc_1762156800000';

function devSettings(): { documents: string; clientId: string; region: string } {
  const file = join(REPO, 'pepla-web', 'src', 'environments', 'environment.ts');
  const src = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const pick = (name: string) => new RegExp(`${name}\\s*:\\s*['"\`]([^'"\`]+)['"\`]`).exec(src)?.[1] ?? '';
  const documents = pick('documentUploadApiUrl');
  expect(documents, 'documentUploadApiUrl points at pepla-dev, not the placeholder').not.toMatch(/\.invalid\b|^$/);
  const clientId = pick('clientId');
  expect(clientId, 'the Cognito app client id is set for pepla-dev').not.toMatch(/^not-configured$|^$/);
  return { documents: documents.replace(/\/+$/, ''), clientId, region: pick('region') || 'af-south-1' };
}

test.describe('ONB-14 on pepla-dev', () => {
  test('AC-12 A real Show is recorded, with who and when and no number; the employee is refused @pepla-dev', async ({ page, signIn, hr, employee }, testInfo) => {
    test.skip(!ON_DEV, 'pepla-dev only: the no-backend run covers the same in the tests above.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width.');
    test.setTimeout(300_000);
    const env = (k: string) => process.env[k] ?? '';

    // The seeded numbers are made up (S-3) and named in the seed script.
    const seed = readFileSync(join(REPO, 'scripts', 'ci', 'seed-dev.py'), 'utf8');
    const seededId = /"idNumber"\s*:\s*\{\s*"S"\s*:\s*"(\d{13})"\s*\}/.exec(seed)?.[1];
    expect(seededId, 'scripts/ci/seed-dev.py gives Naledi\'s National ID a made-up idNumber ("idNumber": {"S": "<13 digits>"})').toBeTruthy();

    // HR opens Naledi's page, presses Show, sees the seeded number, presses Hide.
    await page.goto(`/hr/employees/${encodeURIComponent(NALEDI_DEV_ID)}`);
    // onb-14.3: a fresh browser always meets the sign-in page; wait for it (as ONB-13 AC-8 does) instead of a one-off look
    // taken before it has drawn, which skipped the sign-in and left the page on "Sign in" (dev E2E, 20 Nov).
    await expect(signIn.email).toBeVisible({ timeout: 20_000 });
    await signIn.signInAs(hr);
    await expect(heading1(page)).toHaveText('Naledi Dlamini', { timeout: 30_000 });
    const before = Date.now();
    await showButton(page).first().click();
    await expect(main(page).getByText(spaced(seededId!)), 'Show shows the made-up ID number (a real call, a real KMS decrypt)').toBeVisible({ timeout: 30_000 });
    await expect(main(page)).toContainText(SHOWN);
    await hideButton(page).first().click();
    await expectHidden(page, seededId!, 'after Hide');

    // The agent API holds one new event for it, with no number.
    expect(env('E2E_AGENT_API_URL'), 'the agent API address is not set (E2E_AGENT_API_URL): AC-12 needs it to read the audit log').toMatch(/^https:\/\//);
    expect(env('E2E_AGENT_KEY'), 'the agent key is not set (E2E_AGENT_KEY): AC-12 needs it to read the audit log').toBeTruthy();
    const agent = env('E2E_AGENT_API_URL').replace(/\/+$/, '');
    const events: Array<Record<string, any>> = [];
    const collect = (x: unknown) => {
      if (Array.isArray(x)) return x.forEach(collect);
      if (x && typeof x === 'object') {
        const o = x as Record<string, any>;
        if ('detail' in o || 'detailType' in o) events.push(o);
        Object.values(o).forEach(collect);
      }
    };
    let found: Record<string, any> | undefined;
    let last = '';
    for (let attempt = 0; attempt < 8 && !found; attempt++) {
      if (attempt) await page.waitForTimeout(4_000);
      const r = await page.request.get(`${agent}/agent/v1/audit-log?employeeId=${encodeURIComponent(NALEDI_DEV_ID)}`, { headers: { 'x-api-key': env('E2E_AGENT_KEY') }, failOnStatusCode: false });
      last = `${r.status()} ${(await r.text()).slice(0, 300)}`;
      if (r.status() !== 200) continue;
      events.length = 0;
      collect(await r.json());
      found = events
        .map((e) => ({ e, d: typeof e['detail'] === 'string' ? (() => { try { return JSON.parse(e['detail']); } catch { return {}; } })() : (e['detail'] ?? {}) }))
        .find(({ e, d }) => (d.field === 'id_number') && d.document_id === SEEDED_ID_DOC && d.shown_by === hr.email && Date.now() - Date.parse(d.shown_at) < 5 * 60_000 && Date.parse(d.shown_at) >= before - 60_000 && (e['detailType'] ?? 'document.field_shown') === 'document.field_shown')?.e;
    }
    expect(found, `the audit log holds one new document.field_shown for Naledi's ID document, by ${hr.email}, within 5 minutes (last answer: ${last})`).toBeTruthy();
    const detail = typeof found!['detail'] === 'string' ? JSON.parse(found!['detail']) : found!['detail'];
    expect(detail, 'the event: document, person, field, who, when, actor').toMatchObject({ document_id: SEEDED_ID_DOC, employee_id: NALEDI_DEV_ID, field: 'id_number', shown_by: hr.email, actor: 'HUMAN' });
    expect(JSON.stringify(found), 'the event holds no number').not.toContain(seededId!);
    expect(JSON.stringify(found), 'the event holds no last four').not.toContain(seededId!.slice(-4));

    // The employee login is refused.
    const { documents, clientId, region } = devSettings();
    const auth = await page.request.post(`https://cognito-idp.${region}.amazonaws.com/`, {
      headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
      data: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: clientId, AuthParameters: { USERNAME: employee.email, PASSWORD: employee.password } }),
    });
    expect(auth.status(), 'the employee login signs in at Cognito').toBe(200);
    const token = ((await auth.json()) as any).AuthenticationResult.IdToken as string;
    const refused = await page.request.post(`${documents}/v1/verifications/${SEEDED_ID_DOC}/reveal`, {
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      data: JSON.stringify({ field: 'id_number', employee_id: NALEDI_DEV_ID }),
      failOnStatusCode: false,
    });
    expect(refused.status(), 'the employee login gets 403 on the reveal route').toBe(403);
    expect(await refused.text(), 'and no number').not.toContain(seededId!);
  });
});

void base;
void NALEDI_EMAIL;
void VER;
void AUDIT;
void LEGACY_ID_NUMBER;
