import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { LAMBDA_DIR, REPO, handlerFile } from './support/rec-16/lambda-harness';
import {
  A, B, BAD_ADDRESS, HM_A2_EMAIL, HM_A_EMAIL, HM_B_EMAIL, OUTCOMES, POOL_ADDRESSES, SENDER, STATE, SUB, TEST_EMAIL, accepted, bodyFor, changedOutsideGuard, dbWrites,
  deliver, guardKey, guardOf, guardRows, hiredEvent, htmlEscape, load, logLines, logObjects, mayHaveSent, offerRow, otherWrites, outcomesOf, plain,
  postmarkOf, putState, guardRow, runText, sagaOf, settings, subjectFor, withCandidate, withOffer, type Mode, type Opts, type Run, type Tables,
} from './support/rec-16/world';
import {
  FROZEN_DIRS, FROZEN_FILES, FUNCTION_NAME, LABEL, NEW_FILE, OLD_PATH, RULE_NAME, attr, baseline, dirHashes, fileHash, filesOf, read, rec16, rec16Blocks,
  resourcesOf, settingsOf, snapshot, squash,
} from './support/rec-16/terraform';
import { policyLines } from './support/rec-02/iam';
import { blocks } from './support/infra-harness';

/**
 * REC-16 · Hiring manager IT-bundle email on an accepted offer (red: it emails a real person). Jira NH-283.
 * Spec: /mnt/project-files/onboarding-cards/specs/REC-16.md (rules 1 to 11, AC-1 to AC-13, fixed 26 Nov after spec check round 1,
 * F-1 to F-5). Notes and pinned choices: cards/rec-16.md. Review page: onboarding-cards/specs/REC-16-tests-for-review.md.
 *
 * The Lambda tests run the real new handler (lambda/notifyHiringManagerOnHire) in a fresh Node process per delivery against this card's
 * fake AWS (support/rec-16/fake-aws) and a fake Postmark that answers as the real client does. The events are the CandidateHired events
 * REC-06's real accept put on the bus for two offers taken to ACCEPTED through the real offer routes (support/rec-16/world.ts): company
 * A's (Thandeka Mahlaba, hiring manager hmA) and company B's (Bheki Zondo, hiring manager hmB). Terraform is read as text. Nothing calls
 * AWS, Postmark or any AI. Nothing here has a screen width: each test runs once, at 1280. AC-7 (d) runs on pepla-dev only. AC-13 is
 * chat-15 AC-12 under child lock chat-15.4.
 *
 * Pinned by the test writer where the spec leaves a choice (each is in cards/rec-16.md):
 *  - D-T-16.1 "Postmark answered" means the error the client throws carries a numeric statusCode above 0 (the real client's HttpError
 *    family: 401, 422, 429, 500 ...). "No answer" is the client's PostmarkError with statusCode 0 (a timeout or a dropped connection).
 *    The tests use 422/300 and 401/10 for answered, a timeout and a dropped connection for no answer.
 *  - D-T-16.2 The Postmark call is sendEmail with exactly From, To, Subject, TextBody, HtmlBody and MessageStream 'outbound' (rule 7).
 *    HtmlBody escapes & < > " and ' (as &amp; &lt; &gt; &quot; and &#39; or &#x27;).
 *  - D-T-16.3 A run that stops with an outcome other than SEND_FAILED returns normally (no throw). SEND_FAILED throws after the row
 *    is FAILED. Load-time setting failures throw at import.
 *  - D-T-16.4 Each run logs exactly one line, and that line is one JSON object (console.log/info/warn/error of JSON.stringify) with
 *    only the keys outcome, offer_id, candidate_id and, when there is one, error (an error name: letters, digits, _ . $). A load-time
 *    failure logs nothing that names a person or an address.
 *  - D-T-16.5 An event whose candidate_id or employee_id differs from the offer row ends OFFER_NOT_FOUND or OFFER_NOT_ACCEPTED (rule
 *    3.1 names both); another company's offer ends OFFER_NOT_FOUND (AC-4 a). A disabled or unconfirmed manager, and one with no Member
 *    row, end HIRING_MANAGER_NOT_IN_COMPANY (hiringManagerPeopleOf leaves them out).
 *  - D-T-16.6 The guard row keeps only PK, SK, status, claimed_at, offer_id, candidate_id, tenant_id, sent_at, message_id, recipient,
 *    hm_sub, failed_at and error; none of its values holds an @, the candidate's name, the subject or the body.
 *  - D-T-16.7 The dev check (AC-7 d) reads the hm-it login as E2E_HM_IT_EMAIL / E2E_HM_IT_PASSWORD (load-e2e-logins.py "hm-it") and
 *    its ids from support/rec-16/dev-ids.json; seed-dev.py's seed_rec16 reads the same file.
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS or reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};
const NAME = 'Thandeka Mahlaba';
const ALLOWED_LOG_KEYS = ['outcome', 'offer_id', 'candidate_id', 'error'];
const GUARD_KEYS = ['PK', 'SK', 'status', 'claimed_at', 'offer_id', 'candidate_id', 'tenant_id', 'sent_at', 'message_id', 'recipient', 'hm_sub', 'failed_at', 'error'];
const MESSAGE_KEYS = ['From', 'To', 'Subject', 'TextBody', 'HtmlBody', 'MessageStream'].sort();
const INJECTED = { hmEmail: 'attacker@evil.example', email: 'someone.else@evil.example', recipientEmail: 'third.party@evil.example', candidateName: 'Injected Person', subject: 'Injected subject line', to: 'fourth@evil.example', firstName: 'Injectedfirst', lastName: 'Injectedlast' };

/** Every run made here, so AC-9 can read every log line of the file at once. */
const RUNS: { what: string; run: Run }[] = [];
function run(what: string, event: unknown, t: Tables, o: Opts = {}): Run {
  const r = deliver(event, t, o);
  RUNS.push({ what, run: r });
  return r;
}
const sent = (r: Run) => postmarkOf(r).filter((c: any) => c.outcome === 'ok');
/** Everything a correct run that sends nothing leaves: no Postmark call, no write, no other call, rows as they were, one outcome. */
function nothingSent(what: string, before: Tables, r: Run, outcome: string | string[], claimTried?: string) {
  const want = Array.isArray(outcome) ? outcome : [outcome];
  if (claimTried) {
    // ALREADY_SENT: the claim was tried on this offer's guard row only, and refused; the row is exactly as it was.
    const keys = dbWrites(r).map((c: any) => `${c.op} ${JSON.stringify(plain(c.input?.Key ?? { PK: c.input?.Item?.PK, SK: c.input?.Item?.SK }))}`);
    expect.soft(keys, `${what}: at most the claim was tried, on this offer's guard row`).toEqual(keys.length ? [`PutItem ${JSON.stringify(guardKey(claimTried))}`] : []);
    expect.soft(guardOf(r.tables, claimTried), `${what}: the guard row is exactly as it was`).toEqual(guardOf(before, claimTried));
    expect.soft(r.error, `${what}: returns normally, no retry (${runText(r)})`).toBeUndefined();
    expect.soft(postmarkOf(r).length, `${what}: no Postmark call (${runText(r)})`).toBe(0);
    expect.soft(otherWrites(r).map((c: any) => `${c.service} ${c.op}`), `${what}: no event, queue or other call`).toEqual([]);
    expect.soft(changedOutsideGuard(before, r.tables), `${what}: offer, candidate and employee rows as they were`).toEqual([]);
    expect.soft(outcomesOf(r), `${what}: one log line, ${want.join(' or ')}`).toEqual(want.slice(0, 1));
    return;
  }
  expect.soft(r.error, `${what}: returns normally, no retry (${runText(r)})`).toBeUndefined();
  expect.soft(postmarkOf(r).length, `${what}: no Postmark call (${runText(r)})`).toBe(0);
  expect.soft(dbWrites(r).map((c: any) => `${c.op} ${JSON.stringify(c.input?.Key ?? c.input?.Item?.PK ?? '')}`), `${what}: nothing written`).toEqual([]);
  expect.soft(otherWrites(r).map((c: any) => `${c.service} ${c.op}`), `${what}: no event, queue or other call`).toEqual([]);
  expect.soft(changedOutsideGuard(before, r.tables), `${what}: offer, candidate and employee rows as they were`).toEqual([]);
  expect.soft(guardRows(r.tables).length, `${what}: no guard row`).toBe(guardRows(before).length);
  const got = outcomesOf(r);
  expect.soft(got.length === 1 && want.includes(String(got[0])), `${what}: one log line with outcome ${want.join(' or ')} (got ${JSON.stringify(got)})`).toBe(true);
}
/** A run that sent exactly one email: only the guard row of this offer was written; nothing else changed. */
function sentOnce(what: string, before: Tables, r: Run, offer: string) {
  expect.soft(r.error, `${what}: returns normally (${runText(r)})`).toBeUndefined();
  expect.soft(sent(r).length, `${what}: exactly one email (${runText(r)})`).toBe(1);
  expect.soft(postmarkOf(r).length, `${what}: exactly one Postmark call`).toBe(1);
  expect.soft(changedOutsideGuard(before, r.tables), `${what}: offer, candidate and employee rows as they were`).toEqual([]);
  expect.soft(otherWrites(r).map((c: any) => `${c.service} ${c.op}`), `${what}: no event, queue or other call`).toEqual([]);
  const keys = dbWrites(r).map((c: any) => JSON.stringify(plain(c.input?.Key ?? { PK: c.input?.Item?.PK, SK: c.input?.Item?.SK })));
  expect.soft(keys.every((k: string) => k === JSON.stringify(guardKey(offer))), `${what}: every write is the guard row of this offer (${keys.join(', ')})`).toBe(true);
  expect.soft(outcomesOf(r), `${what}: one log line, SENT`).toEqual(['SENT']);
}
/** The guard row holds only its own fields, and nothing that names a person, an address or the words (D-T-16.6). */
function guardIsClean(what: string, g: Record<string, unknown> | undefined, words: string[]) {
  expect.soft(g, `${what}: the guard row exists`).toBeTruthy();
  if (!g) return;
  expect.soft(Object.keys(g).filter((k) => !GUARD_KEYS.includes(k)), `${what}: the guard row has only its own fields`).toEqual([]);
  const text = JSON.stringify(g);
  expect.soft(text.includes('@'), `${what}: no address in the guard row`).toBe(false);
  for (const w of words) expect.soft(text.includes(w), `${what}: the guard row does not hold "${w}"`).toBe(false);
}
const the = () => accepted();

test.describe('REC-16 Hiring manager IT-bundle email on an accepted offer', () => {
  // ---------------------------------------------------------------- control

  test('Control: the world is real: both offers were accepted through the real routes, and each CandidateHired carries the ids and no name or address', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(180_000);
    const { t, a, b } = the();
    for (const h of [a, b]) {
      const o = offerRow(t, h.offer)!;
      expect.soft([o['state'], o['tenant_id'], o['candidate_id'], o['employee_id']], `${h.offer} is ACCEPTED, its company's, with its candidate and employee`).toEqual(['ACCEPTED', h.tenant, h.candidate, h.employee]);
      expect.soft(Object.keys(h.detail).sort(), 'CandidateHired carries only ids and a time (REC-06)').toEqual(['at', 'candidate_id', 'employee_id', 'offer_id', 'role_id', 'tenant_id']);
      expect.soft([h.detail['tenant_id'], h.detail['offer_id'], h.detail['candidate_id']], 'its ids are the offer\'s').toEqual([h.tenant, h.offer, h.candidate]);
    }
    expect.soft([a.tenant, b.tenant], 'one offer of A, one of B').toEqual([A, B]);
    expect.soft(sagaOf(t, a.candidate)?.['hiringManagerId'], 'A\'s candidate\'s hiring manager is hmA').toBe(SUB.hmA);
    expect.soft(sagaOf(t, b.candidate)?.['hiringManagerId'], 'B\'s candidate\'s hiring manager is hmB').toBe(SUB.hmB);
    expect.soft(`${sagaOf(t, a.candidate)?.['firstName']} ${sagaOf(t, a.candidate)?.['lastName']}`, 'A\'s candidate is Thandeka Mahlaba').toBe(NAME);
    expect.soft(guardRows(t), 'no guard row yet').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-1

  test('AC-1 One email in Iggie\'s words: exactly one Postmark call to hmA\'s pool address, exact Subject, TextBody and HtmlBody, no CC, BCC or attachment; the guard row ends SENT', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(180_000);
    const { t, a } = the();
    const r = run('AC-1', hiredEvent(a.detail), t);
    sentOnce('AC-1', t, r, a.offer);
    const m = sent(r)[0]?.message ?? {};
    expect.soft(Object.keys(m).sort(), 'the message has exactly From, To, Subject, TextBody, HtmlBody and MessageStream (no Cc, Bcc, Attachments, Headers, ReplyTo, Tag, Metadata, tracking)').toEqual(MESSAGE_KEYS);
    expect.soft(m.To, 'To is hmA\'s address from the sign-in pool').toBe(HM_A_EMAIL);
    expect.soft(m.From, 'From is POSTMARK_SENDER_EMAIL').toBe(SENDER);
    expect.soft(m.Subject, 'Subject exactly').toBe('Action required: Set up IT provisioning for Thandeka Mahlaba');
    expect.soft(m.TextBody, 'TextBody exactly').toBe('The offer for Thandeka Mahlaba has been accepted. Please create their IT provisioning bundle at your earliest convenience.');
    expect.soft(m.HtmlBody, 'HtmlBody exactly that line in one <p>').toBe('<p>The offer for Thandeka Mahlaba has been accepted. Please create their IT provisioning bundle at your earliest convenience.</p>');
    expect.soft(m.MessageStream, 'MessageStream outbound').toBe('outbound');
    const g = guardOf(r.tables, a.offer);
    expect.soft([g?.['status'], g?.['message_id'], g?.['recipient'], g?.['hm_sub'], g?.['tenant_id'], g?.['offer_id'], g?.['candidate_id']], 'guard row: SENT, Postmark\'s MessageID, HIRING_MANAGER, hmA, company A, the offer and candidate').toEqual(['SENT', 'rec16-msg-1', 'HIRING_MANAGER', SUB.hmA, A, a.offer, a.candidate]);
    expect.soft(typeof g?.['sent_at'] === 'string' && typeof g?.['claimed_at'] === 'string', 'claimed_at and sent_at are set').toBe(true);
    guardIsClean('AC-1', g, ['Thandeka', 'Mahlaba', 'IT provisioning', 'Action required']);
    // B's own offer, on B's own event, goes to B's own manager (the company is not hard-wired).
    const { t: t2, b } = the();
    const rb = run('AC-1 company B', hiredEvent(b.detail), t2);
    sentOnce('AC-1 company B', t2, rb, b.offer);
    expect.soft(sent(rb)[0]?.message?.To, 'B\'s offer: To is hmB\'s address').toBe(HM_B_EMAIL);
    expect.soft(sent(rb)[0]?.message?.Subject, 'B\'s offer: B\'s candidate\'s name').toBe('Action required: Set up IT provisioning for Bheki Zondo');
  });

  // ---------------------------------------------------------------- AC-2

  test('AC-2 Never twice: the same event again, a later CandidateHired for the same offer, a run that meets the row SENDING or SENT, and two deliveries at once give one email in all', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(240_000);
    const { t, a } = the();
    const ev = hiredEvent(a.detail);
    const first = run('AC-2 first', ev, t);
    sentOnce('AC-2 first', t, first, a.offer);
    const g1 = guardOf(first.tables, a.offer);
    const again = run('AC-2 same event again', ev, first.tables);
    nothingSent('AC-2 same event again', first.tables, again, 'ALREADY_SENT', a.offer);
    expect.soft(guardOf(again.tables, a.offer), 'the guard row is as the first run left it').toEqual(g1);
    const later = run('AC-2 later CandidateHired', hiredEvent({ ...a.detail, at: '2026-11-26T09:00:00.000Z' }, { id: 'rec16-event-0002', time: '2026-11-26T09:00:01Z' }), again.tables);
    nothingSent('AC-2 later CandidateHired', again.tables, later, 'ALREADY_SENT', a.offer);
    expect.soft(guardOf(later.tables, a.offer), 'still as the first run left it').toEqual(g1);

    // Another run's claim already there (SENDING), or the email already SENT: nothing.
    for (const status of ['SENDING', 'SENT']) {
      const before = putState(t, guardRow(a, status, status === 'SENT' ? { sent_at: '2026-11-25T08:00:12.000Z', message_id: 'other-run', recipient: 'HIRING_MANAGER', hm_sub: SUB.hmA } : {}));
      const r = run(`AC-2 row already ${status}`, ev, before);
      nothingSent(`AC-2 row already ${status}`, before, r, 'ALREADY_SENT', a.offer);
    }
    // Two deliveries at the same time: the other run's claim lands between this run's checks and its claim.
    const race = run('AC-2 two at once', ev, t, { extra: { landBeforeWrite: { table: STATE, rows: [avRow(guardRow(a, 'SENDING'))] } } });
    expect.soft(race.error, `AC-2 two at once: returns normally (${runText(race)})`).toBeUndefined();
    expect.soft(postmarkOf(race).length, `AC-2 two at once: the run that lost the claim sends nothing (${runText(race)})`).toBe(0);
    expect.soft(outcomesOf(race), 'AC-2 two at once: ALREADY_SENT').toEqual(['ALREADY_SENT']);
    expect.soft(guardOf(race.tables, a.offer)?.['status'], 'AC-2 two at once: the other run\'s claim stands').toBe('SENDING');
    // The SENT mark fails after the send: the claim stays, nothing is retried, a repeat sends nothing (rule 6, MARK_FAILED).
    const mark = run('AC-2 mark fails', ev, t, { extra: { fail: { service: 'dynamodb', ops: ['UpdateItem'], nth: 1, message: 'fake DynamoDB: the mark did not land', name: 'InternalServerError' } } });
    expect.soft(mark.error, `AC-2 mark fails: returns normally, no throw, so no Lambda retry (${runText(mark)})`).toBeUndefined();
    expect.soft(sent(mark).length, 'AC-2 mark fails: one email').toBe(1);
    expect.soft(outcomesOf(mark), 'AC-2 mark fails: one line, MARK_FAILED').toEqual(['MARK_FAILED']);
    expect.soft(guardOf(mark.tables, a.offer)?.['status'], 'AC-2 mark fails: the row stays SENDING').toBe('SENDING');
    const after = run('AC-2 after the failed mark', ev, mark.tables);
    nothingSent('AC-2 after the failed mark', mark.tables, after, 'ALREADY_SENT', a.offer);
  });

  // ---------------------------------------------------------------- AC-3

  test('AC-3 The address never comes from the event: injected hmEmail, email, recipientEmail, candidateName and subject are ignored; an event naming another hiring manager or company changes nothing; a hiringManagerId outside A\'s hiring manager list sends nothing', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(240_000);
    const { t, a, b } = the();
    for (const mode of ['HIRING_MANAGER', 'TEST_ADDRESS'] as Mode[]) {
      const r = run(`AC-3 injected (${mode})`, hiredEvent({ ...a.detail, ...INJECTED }, { hmEmail: INJECTED.hmEmail, recipientEmail: INJECTED.recipientEmail }), t, { mode });
      sentOnce(`AC-3 injected (${mode})`, t, r, a.offer);
      const m = sent(r)[0]?.message ?? {};
      expect.soft(m.To, `AC-3 (${mode}): To is the pool address or the test address`).toBe(mode === 'HIRING_MANAGER' ? HM_A_EMAIL : TEST_EMAIL);
      expect.soft(m.Subject, `AC-3 (${mode}): the stored name`).toBe(subjectFor(NAME));
      const all = JSON.stringify(postmarkOf(r).map((c: any) => c.message));
      for (const v of Object.values(INJECTED)) expect.soft(all.includes(v), `AC-3 (${mode}): "${v}" is in no Postmark field`).toBe(false);
    }
    // Lock check round 1, F-1 (rule 2: only the four ids are read): fields that name a hiring manager, a company or a role, in the detail
    // and at the event's top level, set to B's manager and company, then to another valid manager of A. The email still goes only to hmA.
    const naming = (hm: string, company: string) => ({ hiringManagerId: hm, hiring_manager_id: hm, hiringManager: hm, hm, manager_id: hm, hmSub: hm, also_tenant: [company], tenant: company, company_id: company, tenantId: company, role_id: b.detail['role_id'] ?? 'ROLE-OTHER-COMPANY' });
    for (const [who, hm, company, addr] of [['B\'s manager and company', SUB.hmB, B, HM_B_EMAIL], ['another manager of A', SUB.a2, B, HM_A2_EMAIL]] as const) {
      for (const mode of ['HIRING_MANAGER', 'TEST_ADDRESS'] as Mode[]) {
        const what = `AC-3 event names ${who} (${mode})`;
        const ev = hiredEvent({ ...a.detail, ...naming(hm, company) }, naming(hm, company));
        const r = run(what, ev, t, { mode });
        sentOnce(what, t, r, a.offer);
        const calls = postmarkOf(r);
        expect.soft(calls.map((c: any) => c.message?.To), `${what}: the one email goes to ${mode === 'HIRING_MANAGER' ? 'hmA' : 'the test address'}`).toEqual([mode === 'HIRING_MANAGER' ? HM_A_EMAIL : TEST_EMAIL]);
        expect.soft(JSON.stringify(calls.map((c: any) => c.message)).includes(addr), `${what}: ${who}'s address is in no Postmark field`).toBe(false);
        expect.soft(guardOf(r.tables, a.offer)?.['hm_sub'], `${what}: the guard row's hm_sub is hmA`).toBe(SUB.hmA);
        expect.soft(JSON.stringify(dbWrites(r)).includes(B), `${what}: no write names company B`).toBe(false);
      }
    }
    // The candidate's manager is B's, and the event offers B's list (as a string and as a list): B's manager must still not be found.
    for (const also of [B, [B]] as const) {
      for (const mode of ['HIRING_MANAGER', 'TEST_ADDRESS'] as Mode[]) {
        const what = `AC-3 B's manager on A's candidate, event adds B's list as ${JSON.stringify(also)} (${mode})`;
        const before = withCandidate(t, a.candidate, { hiringManagerId: SUB.hmB });
        const extra = { also_tenant: also, tenants: [A, B], tenant: B, company_id: B, hiringManagerId: SUB.hmB };
        const r = run(what, hiredEvent({ ...a.detail, ...extra, tenant_id: A }, extra), before, { mode });
        nothingSent(what, before, r, 'HIRING_MANAGER_NOT_IN_COMPANY');
      }
    }
    // The candidate has no hiring manager and the event offers one (A's other manager, then B's): nothing sent, never a fallback.
    for (const hm of [SUB.a2, SUB.hmB]) {
      for (const mode of ['HIRING_MANAGER', 'TEST_ADDRESS'] as Mode[]) {
        const what = `AC-3 no hiringManagerId on the candidate, the event names ${hm} (${mode})`;
        const before = withCandidate(t, a.candidate, { hiringManagerId: undefined });
        const r = run(what, hiredEvent({ ...a.detail, ...naming(hm, A) }, naming(hm, A)), before, { mode });
        nothingSent(what, before, r, 'NO_HIRING_MANAGER');
      }
    }
    // updateCandidate lets hiringManagerId be any string: someone of A who is not a hiring manager, a made-up id, a manager with no Member row.
    for (const [who, id] of [['an employee of A (not a hiring manager)', SUB.empA], ['a made-up id', 'sub-typed-into-update-candidate'], ['a manager with no Member row', SUB.noMember]] as const) {
      for (const mode of ['HIRING_MANAGER', 'TEST_ADDRESS'] as Mode[]) {
        const before = withCandidate(t, a.candidate, { hiringManagerId: id });
        const r = run(`AC-3 ${who} (${mode})`, hiredEvent(a.detail), before, { mode });
        nothingSent(`AC-3 ${who} (${mode})`, before, r, 'HIRING_MANAGER_NOT_IN_COMPANY');
      }
    }
  });

  // ---------------------------------------------------------------- AC-4

  test('AC-4 Company walk: A\'s event naming B\'s offer, B\'s manager on A\'s candidate, a manager of A and B, and B\'s candidate row under A\'s offer send nothing', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(240_000);
    const { t, a, b } = the();
    for (const mode of ['HIRING_MANAGER', 'TEST_ADDRESS'] as Mode[]) {
      // (a) tenant_id A naming B's accepted offer (its own candidate and employee ids, then A's).
      for (const [what, d] of [
        ['B\'s offer with B\'s ids', { ...b.detail, tenant_id: A }],
        ['B\'s offer with A\'s candidate and employee', { ...a.detail, offer_id: b.offer }],
      ] as const) {
        const r = run(`AC-4 (a) ${what} (${mode})`, hiredEvent(d as Record<string, unknown>), t, { mode });
        nothingSent(`AC-4 (a) ${what} (${mode})`, t, r, 'OFFER_NOT_FOUND');
        expect.soft(guardRows(r.tables), `AC-4 (a) ${what} (${mode}): no guard row anywhere`).toEqual([]);
      }
      // (b) A's accepted offer whose candidate's hiring manager is B's.
      const bm = withCandidate(t, a.candidate, { hiringManagerId: SUB.hmB });
      const rb = run(`AC-4 (b) (${mode})`, hiredEvent(a.detail), bm, { mode });
      nothingSent(`AC-4 (b) (${mode})`, bm, rb, 'HIRING_MANAGER_NOT_IN_COMPANY');
      expect.soft(JSON.stringify(postmarkOf(rb)).includes(HM_B_EMAIL), `AC-4 (b) (${mode}): B's manager's address in no Postmark call`).toBe(false);
      // (c) a hiring manager with Member rows in both A and B.
      const both = withCandidate(t, a.candidate, { hiringManagerId: SUB.both });
      const rc = run(`AC-4 (c) (${mode})`, hiredEvent(a.detail), both, { mode });
      nothingSent(`AC-4 (c) (${mode})`, both, rc, 'HIRING_MANAGER_NOT_IN_COMPANY');
      // (d) the candidate row stamped with B under A's offer.
      const stamped = withCandidate(t, a.candidate, { tenant_id: B });
      const rd = run(`AC-4 (d) (${mode})`, hiredEvent(a.detail), stamped, { mode });
      nothingSent(`AC-4 (d) (${mode})`, stamped, rd, 'CANDIDATE_NOT_FOUND');
    }
    // B's event naming A's offer is refused the same way (the walk runs both ways).
    const ba = run('AC-4 (a) B naming A\'s offer', hiredEvent({ ...a.detail, tenant_id: B }), t);
    nothingSent('AC-4 (a) B naming A\'s offer', t, ba, 'OFFER_NOT_FOUND');
  });

  // ---------------------------------------------------------------- AC-5

  test('AC-5 Missing manager or email: no hiringManagerId, no email, three malformed addresses, a disabled or unconfirmed manager, no candidate name: nothing sent, returns normally, one outcome line', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    const { t, a } = the();
    const cases: [string, Tables, string][] = [
      ['no hiringManagerId', withCandidate(t, a.candidate, { hiringManagerId: undefined }), 'NO_HIRING_MANAGER'],
      ['an empty hiringManagerId', withCandidate(t, a.candidate, { hiringManagerId: '' }), 'NO_HIRING_MANAGER'],
      ['a manager with no email', withCandidate(t, a.candidate, { hiringManagerId: SUB.noEmail }), 'HIRING_MANAGER_NO_EMAIL'],
      [`a manager whose address is "${BAD_ADDRESS.space}"`, withCandidate(t, a.candidate, { hiringManagerId: SUB.space }), 'HIRING_MANAGER_NO_EMAIL'],
      ['a manager whose address carries a line break and a Bcc', withCandidate(t, a.candidate, { hiringManagerId: SUB.bcc }), 'HIRING_MANAGER_NO_EMAIL'],
      [`a manager whose address is "${BAD_ADDRESS.atAt}"`, withCandidate(t, a.candidate, { hiringManagerId: SUB.atAt }), 'HIRING_MANAGER_NO_EMAIL'],
      ['a disabled manager', withCandidate(t, a.candidate, { hiringManagerId: SUB.disabled }), 'HIRING_MANAGER_NOT_IN_COMPANY'],
      ['an unconfirmed manager', withCandidate(t, a.candidate, { hiringManagerId: SUB.unconfirmed }), 'HIRING_MANAGER_NOT_IN_COMPANY'],
      ['a candidate with no name', withCandidate(t, a.candidate, { firstName: undefined, lastName: undefined }), 'NO_CANDIDATE_NAME'],
      ['a candidate whose name is blank', withCandidate(t, a.candidate, { firstName: '  ', lastName: '' }), 'NO_CANDIDATE_NAME'],
      ['a candidate whose name is only control characters', withCandidate(t, a.candidate, { firstName: '\u0007\r\n', lastName: '\t\u0000' }), 'NO_CANDIDATE_NAME'],
    ];
    for (const mode of ['HIRING_MANAGER', 'TEST_ADDRESS'] as Mode[]) {
      for (const [what, before, outcome] of cases) {
        const r = run(`AC-5 ${what} (${mode})`, hiredEvent(a.detail), before, { mode });
        nothingSent(`AC-5 ${what} (${mode})`, before, r, outcome);
        const all = JSON.stringify(postmarkOf(r));
        for (const bad of Object.values(BAD_ADDRESS)) expect.soft(all.includes(JSON.stringify(bad).slice(1, -1)), `AC-5 ${what} (${mode}): "${bad}" reaches no Postmark call`).toBe(false);
      }
    }
  });

  // ---------------------------------------------------------------- AC-6

  test('AC-6 A failed send never undoes the accept: an answered error marks FAILED and throws, and the retry sends one; a timeout, a dropped connection or no MessageID leave SENDING and never send again', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    const { t, a } = the();
    const ev = hiredEvent(a.detail);
    // (a) Postmark answered with an error: nothing was sent, so the claim is released and the Lambda retries.
    for (const [mode, errName] of [['answered', 'InvalidEmailRequestError'], ['answered401', 'InvalidAPIKeyError']] as const) {
      const r1 = run(`AC-6 (a) ${mode}`, ev, t, { extra: { postmark: [mode] } });
      expect.soft(r1.error, `AC-6 (a) ${mode}: the handler throws, so Lambda retries (${runText(r1)})`).toBeTruthy();
      expect.soft(postmarkOf(r1).map((c: any) => c.outcome), `AC-6 (a) ${mode}: one attempt, refused`).toEqual([mode]);
      const g = guardOf(r1.tables, a.offer);
      expect.soft([g?.['status'], g?.['error']], `AC-6 (a) ${mode}: the row is FAILED with the error name`).toEqual(['FAILED', errName]);
      expect.soft(typeof g?.['failed_at'], `AC-6 (a) ${mode}: failed_at is set`).toBe('string');
      guardIsClean(`AC-6 (a) ${mode}`, g, ['Thandeka', 'Mahlaba', 'IT provisioning']);
      expect.soft(outcomesOf(r1), `AC-6 (a) ${mode}: one line, SEND_FAILED`).toEqual(['SEND_FAILED']);
      expect.soft(changedOutsideGuard(t, r1.tables), `AC-6 (a) ${mode}: rows as they were`).toEqual([]);
      const r2 = run(`AC-6 (a) ${mode} retry`, ev, r1.tables);
      sentOnce(`AC-6 (a) ${mode} retry`, r1.tables, r2, a.offer);
      expect.soft(guardOf(r2.tables, a.offer)?.['status'], `AC-6 (a) ${mode}: the retry ends SENT`).toBe('SENT');
      const r3 = run(`AC-6 (a) ${mode} third`, ev, r2.tables);
      nothingSent(`AC-6 (a) ${mode} third`, r2.tables, r3, 'ALREADY_SENT', a.offer);
      expect.soft(mayHaveSent(r1).length + mayHaveSent(r2).length + mayHaveSent(r3).length, `AC-6 (a) ${mode}: one email in all`).toBe(1);
    }
    // (a2) no answer from Postmark: the email may have gone, so the claim stays and nothing is retried. (a3) an answer with no MessageID.
    for (const mode of ['timeout', 'dropped', 'noMessageId'] as const) {
      const r1 = run(`AC-6 (a2) ${mode}`, ev, t, { extra: { postmark: [mode] } });
      expect.soft(r1.error, `AC-6 (a2) ${mode}: the handler does not throw (no Lambda retry) (${runText(r1)})`).toBeUndefined();
      expect.soft(postmarkOf(r1).length, `AC-6 (a2) ${mode}: one attempt`).toBe(1);
      expect.soft(guardOf(r1.tables, a.offer)?.['status'], `AC-6 (a2) ${mode}: the row stays SENDING, never SENT`).toBe('SENDING');
      expect.soft(outcomesOf(r1), `AC-6 (a2) ${mode}: one line, SEND_UNKNOWN`).toEqual(['SEND_UNKNOWN']);
      expect.soft(changedOutsideGuard(t, r1.tables), `AC-6 (a2) ${mode}: rows as they were`).toEqual([]);
      const r2 = run(`AC-6 (a2) ${mode} repeat`, ev, r1.tables);
      nothingSent(`AC-6 (a2) ${mode} repeat`, r1.tables, r2, 'ALREADY_SENT', a.offer);
    }
  });

  test('AC-6 (c) In the code: manageOffers, offers.mjs and employee-row.mjs are as on develop 9252f33, and so are the shared modules the Lambda relies on', async ({}, testInfo) => {
    once(testInfo.project.name);
    const base = baseline();
    for (const f of FROZEN_FILES) expect.soft(fileHash(f), `${f} is byte for byte as on develop 9252f33`).toBe(base.files[f]);
  });

  // ---------------------------------------------------------------- AC-7

  test('AC-7 (a) TEST_ADDRESS: the AC-1 event sends one email to the blackhole test address and to no other address; the guard row says TEST_ADDRESS', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(120_000);
    const { t, a } = the();
    const r = run('AC-7 (a)', hiredEvent(a.detail), t, { mode: 'TEST_ADDRESS' });
    sentOnce('AC-7 (a)', t, r, a.offer);
    const m = sent(r)[0]?.message ?? {};
    expect.soft(m.To, 'To is the test address').toBe(TEST_EMAIL);
    expect.soft([m.Subject, m.TextBody], 'the same approved words').toEqual([subjectFor(NAME), bodyFor(NAME)]);
    const all = JSON.stringify(postmarkOf(r).map((c: any) => c.message));
    for (const addr of POOL_ADDRESSES()) expect.soft(all.includes(addr), `no pool address (${addr}) in any Postmark field`).toBe(false);
    const g = guardOf(r.tables, a.offer);
    expect.soft([g?.['status'], g?.['recipient'], g?.['hm_sub']], 'SENT, TEST_ADDRESS, and the manager the lookup found').toEqual(['SENT', 'TEST_ADDRESS', SUB.hmA]);
    guardIsClean('AC-7 (a)', g, ['Thandeka', 'Mahlaba']);
  });

  test('AC-7 (b) A missing, empty or unknown mode, a test address off the blackhole domain, or a missing Postmark token, sender, state table, tenants table or pool id stops the Lambda at load, and nothing is sent', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    const { t, a } = the();
    const cases: [string, Record<string, string | undefined>, RegExp][] = [
      ['no HM_IT_EMAIL_MODE', { HM_IT_EMAIL_MODE: undefined }, /Missing setting HM_IT_EMAIL_MODE/],
      ['an empty HM_IT_EMAIL_MODE', { HM_IT_EMAIL_MODE: '' }, /Missing setting HM_IT_EMAIL_MODE/],
      ['HM_IT_EMAIL_MODE "hiring_manager"', { HM_IT_EMAIL_MODE: 'hiring_manager' }, /HM_IT_EMAIL_MODE/],
      ['HM_IT_EMAIL_MODE "BOTH"', { HM_IT_EMAIL_MODE: 'BOTH' }, /HM_IT_EMAIL_MODE/],
      ['no HM_IT_TEST_EMAIL', { HM_IT_TEST_EMAIL: undefined }, /Missing setting HM_IT_TEST_EMAIL/],
      ['HM_IT_TEST_EMAIL a real domain', { HM_IT_TEST_EMAIL: 'it-team@mokoena.example' }, /HM_IT_TEST_EMAIL/],
      ['HM_IT_TEST_EMAIL that only contains the blackhole domain', { HM_IT_TEST_EMAIL: 'x@blackhole.postmarkapp.com.evil.example' }, /HM_IT_TEST_EMAIL/],
      ['no POSTMARK_API_TOKEN', { POSTMARK_API_TOKEN: undefined }, /Missing setting POSTMARK_API_TOKEN/],
      ['an empty POSTMARK_API_TOKEN', { POSTMARK_API_TOKEN: '' }, /Missing setting POSTMARK_API_TOKEN/],
      ['no POSTMARK_SENDER_EMAIL', { POSTMARK_SENDER_EMAIL: undefined }, /Missing setting POSTMARK_SENDER_EMAIL/],
      ['no STATE_TABLE', { STATE_TABLE: undefined }, /Missing setting STATE_TABLE/],
      ['no TENANTS_TABLE', { TENANTS_TABLE: undefined }, /Missing setting TENANTS_TABLE/],
      ['no HM_COGNITO_POOL_ID', { HM_COGNITO_POOL_ID: undefined }, /Missing setting HM_COGNITO_POOL_ID/],
    ];
    for (const mode of ['HIRING_MANAGER', 'TEST_ADDRESS'] as Mode[]) {
      for (const [what, env, message] of cases) {
        const envOf = { ...settings(mode), ...env };
        const l = load(t, envOf);
        expect.soft(l.error?.message ?? '(loaded)', `AC-7 (b) ${what} (${mode}): the Lambda stops at load, before any event`).toMatch(message);
        expect.soft(l.calls.filter((c: any) => c.service !== 'log').length, `AC-7 (b) ${what} (${mode}): no call at load`).toBe(0);
        const r = run(`AC-7 (b) ${what} (${mode})`, hiredEvent(a.detail), t, { mode, env });
        expect.soft(r.error?.message ?? '(no error)', `AC-7 (b) ${what} (${mode}): a delivery fails the same way`).toMatch(message);
        expect.soft(postmarkOf(r).length, `AC-7 (b) ${what} (${mode}): nothing sent`).toBe(0);
        expect.soft(dbWrites(r).length, `AC-7 (b) ${what} (${mode}): nothing written`).toBe(0);
      }
    }
    // The two good settings load.
    for (const mode of ['HIRING_MANAGER', 'TEST_ADDRESS'] as Mode[]) expect.soft(load(t, settings(mode)).loaded, `AC-7 (b) ${mode} with every setting loads`).toBe(true);
  });

  test('AC-7 (c) Terraform text: hm_it_email_mode defaults to TEST_ADDRESS and allows only the two values; env/dev.tfvars sets TEST_ADDRESS; the Lambda\'s mode is that variable and its test address is the blackhole one', async ({}, testInfo) => {
    once(testInfo.project.name);
    const v = blocks(filesOf('infra'), 'variable').filter((b) => b.labels[0] === 'hm_it_email_mode');
    expect(v.length, 'one variable hm_it_email_mode in infra/').toBe(1);
    const body = squash(v[0]!.body);
    expect.soft(body, 'type string').toContain('type=string');
    expect.soft(body, 'default "TEST_ADDRESS"').toContain('default="TEST_ADDRESS"');
    expect.soft(/validation\{condition=contains\(\["TEST_ADDRESS","HIRING_MANAGER"\],var\.hm_it_email_mode\)|validation\{condition=contains\(\["HIRING_MANAGER","TEST_ADDRESS"\],var\.hm_it_email_mode\)|validation\{condition=var\.hm_it_email_mode=="TEST_ADDRESS"\|\|var\.hm_it_email_mode=="HIRING_MANAGER"|validation\{condition=var\.hm_it_email_mode=="HIRING_MANAGER"\|\|var\.hm_it_email_mode=="TEST_ADDRESS"/.test(body), 'a validation that allows exactly TEST_ADDRESS and HIRING_MANAGER').toBe(true);
    const dev = read('infra/env/dev.tfvars').split('\n').map((l) => l.replace(/#.*$/, '').trim()).filter((l) => /^hm_it_email_mode\s*=/.test(l));
    expect.soft(dev, 'env/dev.tfvars sets hm_it_email_mode = "TEST_ADDRESS" once').toEqual(['hm_it_email_mode = "TEST_ADDRESS"']);
    expect.soft(/#.*AC-7/.test(read('infra/env/dev.tfvars').split('\n').filter((l, i, all) => /hm_it_email_mode/.test(l) || /hm_it_email_mode/.test(all[i + 1] ?? '')).join('\n')), 'with a comment that points at AC-7').toBe(true);
    for (const stack of ['infra', 'talent-flow-infra'] as const) {
      for (const f of filesOf(stack)) expect.soft(/hm_it_email_mode\s*=\s*"HIRING_MANAGER"/.test(readFileSync(f, 'utf8')), `${f} never sets HIRING_MANAGER`).toBe(false);
    }
    const fns = rec16('aws_lambda_function');
    expect(fns.length, 'the Lambda exists').toBe(1);
    const s = settingsOf(fns[0]!);
    expect.soft(s.get('HM_IT_EMAIL_MODE'), 'HM_IT_EMAIL_MODE is the variable').toBe('var.hm_it_email_mode');
    expect.soft(s.get('HM_IT_TEST_EMAIL'), 'HM_IT_TEST_EMAIL is the blackhole literal').toBe('"hm-it-bundle@blackhole.postmarkapp.com"');
  });

  test('AC-7 (d) pepla-dev seed and logins, as text: seed_rec16 puts the REC-16 offer back to SENT each run with the hm-it login as hiring manager, and removes the last run\'s employee and guard row', async ({}, testInfo) => {
    once(testInfo.project.name);
    const ids = JSON.parse(readFileSync(join(__dirname, 'support', 'rec-16', 'dev-ids.json'), 'utf8')) as Record<string, string>;
    expect.soft(/@blackhole\.postmarkapp\.com$/.test(ids['email'] ?? ''), 'the seeded candidate\'s email is a robot address').toBe(true);
    const src = read('scripts/ci/seed-dev.py');
    const persona = /"hm-it"\s*:\s*\{([\s\S]*?)\n\s{4}\},/.exec(src)?.[1] ?? '';
    expect.soft(persona, 'NALEKO_PERSONAS has "hm-it" (Hana Demo-HM-IT)').toMatch(/"given_name"\s*:\s*"Hana"[\s\S]*"family_name"\s*:\s*"Demo-HM-IT"/);
    expect.soft(/"groups"\s*:\s*\[\s*"manager"\s*\]/.test(persona), 'its only group is manager (plus the robot group every login gets)').toBe(true);
    const start = src.indexOf('def seed_rec16(');
    expect(start, 'seed-dev.py has seed_rec16').toBeGreaterThan(-1);
    const end = src.indexOf('\ndef ', start + 10);
    const fn = src.slice(start, end === -1 ? undefined : end);
    const main = src.slice(src.indexOf('def main('));
    expect.soft(main, 'main() writes hm-it\'s Member row of company A').toMatch(/ensure_founding_member\(\s*ddb\s*,[^)]*"hm-it"|hm_it_sub[\s\S]*ensure_founding_member\(\s*ddb\s*,\s*hm_it_sub/);
    expect.soft(main, 'main() calls seed_rec16 with the hm-it sub').toMatch(/seed_rec16\(\s*ddb\s*,/);
    expect.soft(fn, 'it reads support/rec-16/dev-ids.json').toMatch(/rec-16[\s\S]*dev-ids\.json/);
    expect.soft(fn, 'it removes the guard row NOTICE#HM_IT#<offer>').toMatch(/delete_item\([\s\S]*NOTICE#HM_IT#/);
    expect.soft(fn, 'it removes the employee the last run made (uuid5 of company and offer), on condition of the company').toMatch(/uuid5[\s\S]*delete_item\([\s\S]*employees[\s\S]*ConditionExpression[\s\S]*tenant_id/);
    expect.soft(fn, 'it puts the offer back to SENT').toMatch(/"SENT"/);
    expect.soft(fn, 'it puts the candidate back to OFFER').toMatch(/"OFFER"/);
    expect.soft(fn, 'the candidate\'s hiringManagerId is the hm-it sub').toMatch(/"hiringManagerId"\s*:\s*\{\s*"S"\s*:\s*hm/);
    expect.soft(fn.includes('Scan') || /scan\(/.test(fn), 'it scans nothing (the ids are known)').toBe(false);
    const logins = read('scripts/ci/load-e2e-logins.py');
    expect.soft(logins, 'load-e2e-logins.py hands hm-it to the run as E2E_HM_IT').toMatch(/"hm-it"\s*:\s*"E2E_HM_IT"/);
  });

  test('AC-7 (d) pepla-dev: accepting the seeded REC-16 offer ends within 60 seconds with one guard row, SENT, TEST_ADDRESS, the hm-it login as hm_sub; a repeat accept adds nothing @pepla-dev', async ({ page }, testInfo) => {
    test.skip(!ON_DEV, 'pepla-dev only: the no-backend run covers this in AC-1, AC-2 and AC-7 (a).');
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width.');
    test.setTimeout(6 * 60_000);
    const envOf = (k: string) => process.env[k] ?? '';
    const login = (p: string) => ({ email: envOf(`${p}_EMAIL`), password: envOf(`${p}_PASSWORD`) });
    const logins = { hr: login('E2E_HR'), hmIt: login('E2E_HM_IT') };
    for (const [who, l] of Object.entries(logins)) expect(l.email && l.password, `the ${who} test login is set`).toBeTruthy();
    const { devEnv } = await import('./support/ten-02/dev');
    const { region, clientId } = devEnv();
    const appEnv = readFileSync(join(REPO, 'pepla-web', 'src', 'environments', 'environment.ts'), 'utf8');
    const tfApi = (/talentFlowApiUrl\s*:\s*['"`]([^'"`]+)['"`]/.exec(appEnv)?.[1] ?? '').replace(/\/+$/, '').replace(/\/v1$/, '');
    expect(tfApi, 'pepla-web\'s talentFlowApiUrl points at pepla-dev\'s TalentFlow API').toMatch(/^https:\/\/[^/]+\.execute-api\./);
    const signIn = async (l: { email: string; password: string }) => {
      const r = await page.request.post(`https://cognito-idp.${region}.amazonaws.com/`, {
        headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
        data: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: clientId, AuthParameters: { USERNAME: l.email, PASSWORD: l.password } }),
      });
      expect(r.status(), 'signs in at Cognito').toBe(200);
      return ((await r.json()) as any).AuthenticationResult.IdToken as string;
    };
    const claimsOf = (token: string) => JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as Record<string, any>;
    const call = async (token: string, method: string, path: string, body?: unknown) =>
      page.request.fetch(`${tfApi}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { data: JSON.stringify(body) }) });
    const ids = JSON.parse(readFileSync(join(__dirname, 'support', 'rec-16', 'dev-ids.json'), 'utf8')) as Record<string, string>;
    const [hr, hmIt] = await Promise.all([signIn(logins.hr), signIn(logins.hmIt)]);
    const tenant = claimsOf(hr)['tenant_id'] as string;
    const hmSub = claimsOf(hmIt)['sub'] as string;
    expect(tenant, 'the HR login carries its company').toMatch(/^ten_[0-9a-z]{26}$/);
    expect(claimsOf(hmIt)['tenant_id'], 'the hm-it login is a member of the same company').toBe(tenant);
    /** The guard row, read by key only with the dev workflow's AWS sign-in (strong read). */
    const guard = () => {
      const out = execFileSync('aws', ['dynamodb', 'get-item', '--region', region, '--table-name', 'talent-flow-state', '--key', JSON.stringify({ PK: { S: `NOTICE#HM_IT#${ids['offer']}` }, SK: { S: 'NOTICE' } }), '--consistent-read', '--output', 'json'], { encoding: 'utf8' });
      const item = (JSON.parse(out || '{}') as any).Item as Record<string, Record<string, string>> | undefined;
      return item ? Object.fromEntries(Object.entries(item).map(([k, v]) => [k, v['S'] ?? v['N'] ?? JSON.stringify(v)])) : undefined;
    };
    expect(guard(), 'the seed removed the last run\'s guard row').toBeUndefined();
    const before = (await (await call(hr, 'GET', `/v1/offers/${ids['offer']}`)).json()) as any;
    expect(before.state, 'the seeded offer is SENT').toBe('SENT');
    const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n% REC-16 dev test signed copy\n'), Buffer.alloc(2048, 32), Buffer.from('\n%%EOF\n')]);
    const up = await call(hr, 'POST', `/v1/offers/${ids['offer']}/signed-upload`, { file_name: 'Signed offer.pdf', content_type: 'application/pdf', file_size: pdf.length });
    expect(up.status(), `an upload link (${await up.text()})`).toBe(200);
    const { upload_url: url, signed_key: key } = (await up.json()) as { upload_url: string; signed_key: string };
    const put = await page.request.fetch(url, { method: 'PUT', headers: { 'content-type': 'application/pdf' }, data: pdf });
    expect([200, 204], `the signed copy is stored (${put.status()})`).toContain(put.status());
    const acc = await call(hr, 'POST', `/v1/offers/${ids['offer']}/answer`, { answer: 'ACCEPTED', signed_key: key, confirmed_start_date: ids['startDate'] });
    expect(acc.status(), `the Recruiter records the accept (${await acc.text()})`).toBe(200);
    const accepted_at = Date.now();
    let g: Record<string, string> | undefined;
    while (Date.now() - accepted_at < 60_000) {
      g = guard();
      if (g?.['status'] === 'SENT') break;
      await page.waitForTimeout(5_000);
    }
    expect(g?.['status'], `within 60 seconds of the accept the guard row is SENT (last read: ${JSON.stringify(g && { status: g['status'], recipient: g['recipient'] })})`).toBe('SENT');
    expect.soft([g?.['recipient'], g?.['hm_sub'], g?.['tenant_id'], g?.['offer_id']], 'TEST_ADDRESS, the hm-it login, the company, the offer').toEqual(['TEST_ADDRESS', hmSub, tenant, ids['offer']]);
    expect.soft((g?.['message_id'] ?? '').length, 'Postmark\'s MessageID is kept').toBeGreaterThan(0);
    expect.soft(JSON.stringify(g).includes('@') || JSON.stringify(g).includes(ids['lastName']!), 'the guard row holds no address and no name').toBe(false);
    const again = await call(hr, 'POST', `/v1/offers/${ids['offer']}/answer`, { answer: 'ACCEPTED', signed_key: key, confirmed_start_date: ids['startDate'] });
    expect(again.status(), 'a repeat accept: 200').toBe(200);
    await page.waitForTimeout(30_000);
    expect.soft(guard(), 'a repeat accept adds nothing: the guard row is exactly as it was').toEqual(g);
  });

  // ---------------------------------------------------------------- AC-8

  test('AC-8 Old rules stay: both OfferAccepted rules, targets and permissions, sendNotificationEmail and advanceOfferState as on develop 9252f33; the new Lambda is the target of exactly one rule, the CandidateHired one', async ({}, testInfo) => {
    once(testInfo.project.name);
    const base = baseline();
    const now = snapshot();
    for (const [s, ty, l] of OLD_PATH) expect.soft(now.blocks[`${s}/${ty}.${l}`], `${s}/${ty}.${l} is as on develop 9252f33`).toBe(base.blocks[`${s}/${ty}.${l}`]);
    for (const d of FROZEN_DIRS) expect.soft(dirHashes(d), `every file of ${d} is byte for byte as on develop 9252f33`).toEqual(base.dirs[d]);
    const fnRef = `aws_lambda_function.${LABEL}.arn`;
    const targets = (['infra', 'talent-flow-infra'] as const).flatMap((s) => resourcesOf(s, 'aws_cloudwatch_event_target')).filter((b) => (attr(b, 'arn') ?? '').includes(LABEL) || (attr(b, 'arn') ?? '').includes(FUNCTION_NAME));
    expect(targets.length, 'the new Lambda is the target of exactly one rule').toBe(1);
    expect.soft(attr(targets[0]!, 'arn'), 'its target names the function by reference').toBe(fnRef);
    const ruleRef = /^aws_cloudwatch_event_rule\.([\w-]+)\.name$/.exec(attr(targets[0]!, 'rule') ?? '')?.[1];
    expect.soft(ruleRef, 'that target\'s rule is the REC-16 rule').toBe(LABEL);
    const rules = (['infra', 'talent-flow-infra'] as const).flatMap((s) => resourcesOf(s, 'aws_cloudwatch_event_rule'));
    const offerAcceptedRules = rules.filter((r) => squash(r.body).includes('"OfferAccepted"')).map((r) => r.labels[1]);
    for (const tg of (['infra', 'talent-flow-infra'] as const).flatMap((s) => resourcesOf(s, 'aws_cloudwatch_event_target'))) {
      const rl = /^aws_cloudwatch_event_rule\.([\w-]+)\.name$/.exec(attr(tg, 'rule') ?? '')?.[1];
      if (rl && offerAcceptedRules.includes(rl)) expect.soft((attr(tg, 'arn') ?? '').includes(LABEL), `the OfferAccepted rule ${rl} does not target the new Lambda`).toBe(false);
    }
  });

  // ---------------------------------------------------------------- AC-9

  test('AC-9 Logs: across every run, no line holds an address, the test address, the candidate\'s name, the subject or the body; every run logs one JSON line with an outcome from rule 8 and error names only', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    const { t, a } = the();
    const ev = hiredEvent(a.detail);
    // Its own runs, one per outcome (so this test stands alone), then every run the file made before it.
    const mine: [string, Run][] = [
      ['SENT, HIRING_MANAGER', deliver(ev, t)],
      ['SENT, TEST_ADDRESS', deliver(ev, t, { mode: 'TEST_ADDRESS' })],
      ['WRONG_EVENT', deliver(hiredEvent(a.detail, { 'detail-type': 'OfferAccepted' }), t)],
      ['BAD_EVENT', deliver(hiredEvent({ ...a.detail, offer_id: '' }), t)],
      ['OFFER_NOT_FOUND', deliver(hiredEvent({ ...a.detail, offer_id: 'offer-does-not-exist' }), t)],
      ['OFFER_NOT_ACCEPTED', deliver(ev, withOffer(t, a.offer, { state: 'SENT' }))],
      ['CANDIDATE_NOT_FOUND', deliver(ev, withCandidate(t, a.candidate, { tenant_id: B }))],
      ['NO_HIRING_MANAGER', deliver(ev, withCandidate(t, a.candidate, { hiringManagerId: undefined }))],
      ['HIRING_MANAGER_NOT_IN_COMPANY', deliver(ev, withCandidate(t, a.candidate, { hiringManagerId: SUB.hmB }))],
      ['HIRING_MANAGER_NO_EMAIL', deliver(ev, withCandidate(t, a.candidate, { hiringManagerId: SUB.bcc }))],
      ['NO_CANDIDATE_NAME', deliver(ev, withCandidate(t, a.candidate, { firstName: '', lastName: '' }))],
      ['SEND_FAILED', deliver(ev, t, { extra: { postmark: ['answered'] } })],
      ['SEND_UNKNOWN', deliver(ev, t, { extra: { postmark: ['timeout'] } })],
      ['MARK_FAILED', deliver(ev, t, { extra: { fail: { service: 'dynamodb', ops: ['UpdateItem'], nth: 1, message: 'fake DynamoDB: Thandeka Mahlaba hm-it-bundle@blackhole.postmarkapp.com', name: 'InternalServerError' } } })],
      ['ALREADY_SENT', deliver(ev, putState(t, guardRow(a, 'SENT')))],
      ['AC-12 name', deliver(ev, withCandidate(t, a.candidate, { firstName: 'Thandeka\r\nBcc: x@y.co', lastName: '<b>Th</b> & "Mahlaba"' }))],
    ];
    for (const [want, r] of mine) {
      const objs = logObjects(r);
      expect.soft(objs.length, `${want}: exactly one log line (${runText(r)})`).toBe(1);
      expect.soft(objs[0]?.['outcome'], `${want}: its outcome`).toBe(want.split(',')[0]!.startsWith('AC-12') ? 'SENT' : want.split(',')[0]);
    }
    const all = [...mine.map(([w, r]) => ({ what: `AC-9 ${w}`, run: r })), ...RUNS];
    expect(all.length, 'the runs of this file are all read').toBeGreaterThan(15);
    const forbidden = [...new Set([...POOL_ADDRESSES(), TEST_EMAIL, 'Thandeka', 'Mahlaba', 'Bheki', 'Zondo', 'Action required', 'IT provisioning', 'has been accepted', ...Object.values(INJECTED), 'x@y.co', '<b>Th</b>'])];
    for (const { what, run: r } of all) {
      const lines = logLines(r);
      for (const l of lines) {
        const hit = forbidden.filter((f) => l.includes(f) || l.includes(JSON.stringify(f).slice(1, -1)));
        expect.soft(hit, `${what}: a log line holds ${hit.join(', ')}: ${l.slice(0, 200)}`).toEqual([]);
        expect.soft(/\n\s+at |\bat .*\.m?js:\d+/.test(l), `${what}: no stack trace in a log line`).toBe(false);
      }
      if (r.error && /^Missing setting|HM_IT_/.test(r.error.message)) continue; // stopped at load: judged only for leaks
      const objs = logObjects(r);
      expect.soft(objs.length, `${what}: one log line (${lines.length})`).toBe(1);
      for (const o of objs) {
        expect.soft(OUTCOMES.includes(o['outcome'] as any), `${what}: the line is a JSON object with an outcome from rule 8 (${JSON.stringify(o).slice(0, 200)})`).toBe(true);
        expect.soft(Object.keys(o).filter((k) => !ALLOWED_LOG_KEYS.includes(k)), `${what}: only outcome, offer_id, candidate_id and error`).toEqual([]);
        if (o['error'] !== undefined) expect.soft(/^[A-Za-z_$][\w$.]{0,80}$/.test(String(o['error'])), `${what}: error is a name only (${String(o['error']).slice(0, 80)})`).toBe(true);
      }
    }
  });

  // ---------------------------------------------------------------- AC-10

  test('AC-10 Wiring: one rule on talent_flow_bus for CandidateHired from talent-flow.workflow, no input transformer, one target, one permission from that rule; every new resource is labelled notify_hiring_manager_on_hire in the new file', async ({}, testInfo) => {
    once(testInfo.project.name);
    const mine = rec16Blocks();
    const types = mine.map((r) => `${r.stack}/${r.block.labels[0]}`).sort();
    const need = ['aws_cloudwatch_event_rule', 'aws_cloudwatch_event_target', 'aws_iam_role', 'aws_iam_role_policy', 'aws_lambda_function', 'aws_lambda_permission'].map((x) => `infra/${x}`);
    expect.soft(types.filter((x) => x !== 'infra/aws_cloudwatch_log_group'), 'one of each: rule, target, role, policy, function, permission, all in infra/').toEqual(need);
    expect.soft(types.filter((x) => x === 'infra/aws_cloudwatch_log_group').length, 'at most one log group').toBeLessThanOrEqual(1);
    expect.soft([...new Set(mine.map((r) => r.block.file.replace(`${REPO}/`, '')))], `all in ${NEW_FILE}`).toEqual([NEW_FILE]);
    const rule = rec16('aws_cloudwatch_event_rule')[0];
    expect(rule, 'the rule exists').toBeTruthy();
    expect.soft(attr(rule!, 'name'), 'its name').toBe(`"${RULE_NAME}"`);
    expect.soft(attr(rule!, 'event_bus_name'), 'on talent-flow-bus').toBe('data.aws_cloudwatch_event_bus.talent_flow_bus.name');
    const pattern = squash(attr(rule!, 'event_pattern') ?? '');
    expect.soft(['jsonencode({source=["talent-flow.workflow"]"detail-type"=["CandidateHired"]})', 'jsonencode({"detail-type"=["CandidateHired"]source=["talent-flow.workflow"]})'].includes(pattern), `pattern exactly source talent-flow.workflow and detail-type CandidateHired (${pattern})`).toBe(true);
    expect.soft(attr(rule!, 'state') ?? '"ENABLED"', 'ENABLED').toBe('"ENABLED"');
    const target = rec16('aws_cloudwatch_event_target')[0];
    expect(target, 'the target exists').toBeTruthy();
    const tb = squash(target!.body);
    expect.soft(/input_transformer|(^|[^_])input=|input_path=/.test(tb), 'no input transformer, input or input path: the Lambda gets the whole event').toBe(false);
    expect.soft(/retry_policy|dead_letter_config/.test(tb), 'no retry or dead-letter settings beyond the defaults').toBe(false);
    expect.soft(attr(target!, 'event_bus_name'), 'the target is on talent-flow-bus').toBe('data.aws_cloudwatch_event_bus.talent_flow_bus.name');
    const perms = rec16('aws_lambda_permission');
    expect(perms.length, 'one permission').toBe(1);
    expect.soft([attr(perms[0]!, 'principal'), attr(perms[0]!, 'action'), attr(perms[0]!, 'source_arn'), attr(perms[0]!, 'function_name')], 'events.amazonaws.com may invoke it, from this rule only').toEqual(['"events.amazonaws.com"', '"lambda:InvokeFunction"', `aws_cloudwatch_event_rule.${LABEL}.arn`, `aws_lambda_function.${LABEL}.function_name`]);
    const other = (['infra', 'talent-flow-infra'] as const).flatMap((s) => resourcesOf(s, 'aws_lambda_permission')).filter((b) => b.labels[1] !== LABEL && (attr(b, 'function_name') ?? '').includes(LABEL));
    expect.soft(other.map((b) => b.labels[1]), 'no other permission names the function').toEqual([]);
  });

  test('AC-10 The function: notifyHiringManagerOnHire, Node 22, index.handler, timeout 30, memory 128, X-Ray, JSON logs, its own role, exactly the settings of rule 11; its folder ships postmark', async ({}, testInfo) => {
    once(testInfo.project.name);
    const fns = rec16('aws_lambda_function');
    expect(fns.length, 'one function').toBe(1);
    const f = fns[0]!;
    const a = (n: string) => attr(f, n);
    expect.soft([a('function_name'), a('runtime'), a('handler'), a('timeout'), a('memory_size'), a('role')], 'name, runtime, handler, timeout, memory, role').toEqual([`"${FUNCTION_NAME}"`, '"nodejs22.x"', '"index.handler"', '30', '128', `aws_iam_role.${LABEL}.arn`]);
    expect.soft(a('reserved_concurrent_executions'), 'no reserved concurrency').toBeUndefined();
    const body = squash(f.body);
    expect.soft(body, 'X-Ray active').toContain('tracing_config{mode="Active"}');
    expect.soft(body, 'JSON logs to its own log group').toContain(`logging_config{log_format="JSON"log_group="/aws/lambda/${FUNCTION_NAME}"}`);
    expect.soft(/lifecycle\{ignore_changes=\[filename,source_code_hash\]\}/.test(body), 'ignore_changes filename and source_code_hash, as its neighbours').toBe(true);
    const s = settingsOf(f);
    expect.soft([...s.keys()].sort(), 'exactly the settings of rule 11').toEqual(['HM_COGNITO_POOL_ID', 'HM_GROUP_NAME', 'HM_IT_EMAIL_MODE', 'HM_IT_TEST_EMAIL', 'LEGACY_TENANT_ID', 'POSTMARK_API_TOKEN', 'POSTMARK_SENDER_EMAIL', 'STATE_TABLE', 'TENANTS_TABLE']);
    const sne = resourcesOf('infra', 'aws_lambda_function').find((b) => b.labels[1] === 'send_notification_email')!;
    expect.soft([s.get('POSTMARK_API_TOKEN'), s.get('POSTMARK_SENDER_EMAIL')], 'the Postmark token and sender as sendNotificationEmail has them').toEqual([settingsOf(sne).get('POSTMARK_API_TOKEN'), settingsOf(sne).get('POSTMARK_SENDER_EMAIL')]);
    expect.soft([s.get('STATE_TABLE'), s.get('TENANTS_TABLE'), s.get('HM_COGNITO_POOL_ID'), s.get('HM_GROUP_NAME'), s.get('LEGACY_TENANT_ID')], 'the tables, pool, group and legacy company').toEqual(['"talent-flow-state"', 'aws_dynamodb_table.tenants.name', 'aws_cognito_user_pool.naleko_dev.id', '"naleko-talentflow-hiringmanager"', 'var.legacy_tenant_id']);
    const role = rec16('aws_iam_role')[0];
    expect(role, 'its role').toBeTruthy();
    expect.soft([attr(role!, 'name'), attr(role!, 'path')], 'role name and path').toEqual(['"naleko-notifyHiringManagerOnHire-role"', '"/naleko/"']);
    expect.soft(squash(attr(role!, 'assume_role_policy') ?? ''), 'assumed by lambda.amazonaws.com only').toMatch(/Principal=\{Service="lambda\.amazonaws\.com"\}/);
    // Lesson NH-180: a folder with no package-lock ships no node_modules.
    const pkg = JSON.parse(readFileSync(join(LAMBDA_DIR, 'package.json'), 'utf8'));
    expect.soft(Object.keys(pkg.dependencies ?? {}), 'package.json depends on postmark').toContain('postmark');
    const lock = JSON.parse(readFileSync(join(LAMBDA_DIR, 'package-lock.json'), 'utf8'));
    expect.soft(Object.keys(lock.packages ?? {}).includes('node_modules/postmark'), 'package-lock.json pins postmark').toBe(true);
    expect.soft(existsSync(handlerFile()), 'the handler file exists').toBe(true);
    // BE-15: the settings check knows it and passes.
    const lsrc = read('scripts/ci/check-lambda-settings.py');
    const entry = new RegExp(`"${FUNCTION_NAME}"\\s*:\\s*\\("lambda/${FUNCTION_NAME}/index\\.m?js",\\s*\\[([^\\]]*)\\]`).exec(lsrc)?.[1] ?? '';
    expect.soft([...entry.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]).sort(), 'check-lambda-settings.py lists it with the seven settings it reads through requireSetting').toEqual(['HM_COGNITO_POOL_ID', 'HM_IT_EMAIL_MODE', 'HM_IT_TEST_EMAIL', 'POSTMARK_API_TOKEN', 'POSTMARK_SENDER_EMAIL', 'STATE_TABLE', 'TENANTS_TABLE']);
    let out = '';
    let code = 0;
    try { out = execFileSync('python3', [join(REPO, 'scripts', 'ci', 'check-lambda-settings.py'), '--root', REPO], { encoding: 'utf8' }); } catch (e: any) { code = e.status ?? 1; out = String(e.stdout ?? '') + String(e.stderr ?? ''); }
    expect.soft([code, out.trim().split('\n').slice(-3).join(' | ')], 'check-lambda-settings.py is clean').toEqual([0, 'Lambda settings: clean']);
  });

  test('AC-10 IAM: the role\'s policy holds exactly the lines of the spec\'s IAM table, writes only to NOTICE#HM_IT# keys, the PII key only through DynamoDB; no wildcard action, no delete; kms.tf unchanged; no table data; the permission check finds nothing missing', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(240_000);
    const pols = Object.entries(policyLines()).filter(([, p]) => p.stack === 'infra' && p.role === LABEL);
    expect(pols.length, 'one inline policy on the role').toBe(1);
    expect.soft(pols[0]![0], 'labelled notify_hiring_manager_on_hire').toBe(`infra/${LABEL}`);
    const lines = pols[0]![1].pairs ?? [`unreadable ${pols[0]![1].squash}`];
    const attached = (['infra', 'talent-flow-infra'] as const).flatMap((s) => [...resourcesOf(s, 'aws_iam_role_policy_attachment'), ...resourcesOf(s, 'aws_iam_policy_attachment')]).filter((b) => squash(b.body).includes(LABEL));
    expect.soft(attached.map((b) => b.labels[1]), 'no managed policy attached to the role').toEqual([]);
    const LEADING = JSON.stringify({ 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['NOTICE#HM_IT#*'] } });
    const LEADING_STR = JSON.stringify({ 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': 'NOTICE#HM_IT#*' } });
    const VIA = JSON.stringify({ StringEquals: { 'kms:ViaService': 'dynamodb.af-south-1.amazonaws.com' } });
    const STATE_ARN = String.raw`arn:aws:dynamodb:af-south-1:000000000000:table/talent-flow-state`;
    const want: [string, RegExp][] = [
      ['logs:CreateLogGroup on its own log group', /^Allow logs:CreateLogGroup arn:aws:logs:af-south-1:000000000000:log-group:\/aws\/lambda\/notifyHiringManagerOnHire:\* null$/],
      ['logs:CreateLogStream on its own log group', /^Allow logs:CreateLogStream arn:aws:logs:af-south-1:000000000000:log-group:\/aws\/lambda\/notifyHiringManagerOnHire:\* null$/],
      ['logs:PutLogEvents on its own log group', /^Allow logs:PutLogEvents arn:aws:logs:af-south-1:000000000000:log-group:\/aws\/lambda\/notifyHiringManagerOnHire:\* null$/],
      ['xray:PutTraceSegments', /^Allow xray:PutTraceSegments \* null$/],
      ['xray:PutTelemetryRecords', /^Allow xray:PutTelemetryRecords \* null$/],
      ['dynamodb:GetItem on talent-flow-state', new RegExp(`^Allow dynamodb:GetItem ${STATE_ARN} null$`)],
      ['dynamodb:PutItem on talent-flow-state, NOTICE#HM_IT#* keys only', new RegExp(`^Allow dynamodb:PutItem ${STATE_ARN} (${esc(LEADING)}|${esc(LEADING_STR)})$`)],
      ['dynamodb:UpdateItem on talent-flow-state, NOTICE#HM_IT#* keys only', new RegExp(`^Allow dynamodb:UpdateItem ${STATE_ARN} (${esc(LEADING)}|${esc(LEADING_STR)})$`)],
      ['kms:Decrypt on the TalentFlow state key', /^Allow kms:Decrypt data\.aws_kms_key\.talent_flow\.arn null$/],
      ['kms:DescribeKey on the TalentFlow state key', /^Allow kms:DescribeKey data\.aws_kms_key\.talent_flow\.arn null$/],
      ['kms:GenerateDataKey on the TalentFlow state key', /^Allow kms:GenerateDataKey data\.aws_kms_key\.talent_flow\.arn null$/],
      ['dynamodb:Query on the tenants table', /^Allow dynamodb:Query aws_dynamodb_table\.tenants\.arn null$/],
      ['kms:Decrypt on the PII key through DynamoDB only', new RegExp(`^Allow kms:Decrypt module\\.kms_pii\\.key_arn ${esc(VIA)}$`)],
      ['kms:DescribeKey on the PII key through DynamoDB only', new RegExp(`^Allow kms:DescribeKey module\\.kms_pii\\.key_arn ${esc(VIA)}$`)],
      ['cognito-idp:ListUsersInGroup on the Naleko pool', /^Allow cognito-idp:ListUsersInGroup aws_cognito_user_pool\.naleko_dev\.arn null$/],
    ];
    for (const [what, re] of want) expect.soft(lines.filter((l) => re.test(l)).length, `the policy has ${what} (once)`).toBe(1);
    expect.soft(lines.filter((l) => !want.some(([, re]) => re.test(l))), 'and nothing else').toEqual([]);
    expect.soft(lines.filter((l) => /^\S+ \S*\*\S* /.test(l.split(' ').slice(0, 2).join(' ') + ' ')), 'no wildcard action').toEqual([]);
    expect.soft(lines.filter((l) => /dynamodb:(Scan|DeleteItem|BatchWriteItem|BatchGetItem|TransactWriteItems)|events:|ses:|sns:|states:|ssm:|secretsmanager:|s3:|iam:|lambda:/.test(l)), 'no Scan, delete, batch, events, SES, SNS, Step Functions, SSM, Secrets Manager, S3, IAM or Lambda action').toEqual([]);
    expect.soft(fileHash('infra/kms.tf'), 'infra/kms.tf is byte for byte as on develop 9252f33').toBe(baseline().files['infra/kms.tf']);
    for (const s of ['infra', 'talent-flow-infra'] as const) expect.soft(resourcesOf(s, 'aws_dynamodb_table_item').length, `${s}: no table data in Terraform`).toBe(0);
    // Pipeline step 7: the permission check reads the new function and finds nothing missing for it.
    const out = execFileSync('python3', [join(REPO, 'scripts', 'ci', 'check-permissions.py'), '--root', REPO, '--mode', 'report'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    const mine = out.split('\n').filter((l) => l.includes(FUNCTION_NAME));
    expect.soft(mine.length, 'the permission check reads notifyHiringManagerOnHire').toBeGreaterThan(0);
    expect.soft(mine.filter((l) => /^(missing|key missing)\b/.test(l.trim())), 'nothing missing and no key missing for it').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-11

  test('AC-11 Wrong or made-up events: OfferAnswered, OfferAccepted, another source, an offer SENT, DECLINED or WITHDRAWN, ids that differ from the offer row, ids that are not ids: nothing sent, the matching outcome, no guard row', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    const { t, a } = the();
    const d = a.detail;
    const cases: [string, unknown, Tables, string | string[]][] = [
      ['an OfferAnswered event', hiredEvent({ ...d, answer: 'ACCEPTED' }, { 'detail-type': 'OfferAnswered' }), t, 'WRONG_EVENT'],
      ['an OfferAccepted event', hiredEvent(d, { 'detail-type': 'OfferAccepted' }), t, 'WRONG_EVENT'],
      ['a CandidateHired from another source', hiredEvent(d, { source: 'talent-flow.agent' }), t, 'WRONG_EVENT'],
      ['a CandidateHired with no source', hiredEvent(d, { source: undefined }), t, 'WRONG_EVENT'],
      ['a CandidateHired as a direct call with no detail-type', { detail: d }, t, 'WRONG_EVENT'],
      ['an offer still SENT', hiredEvent(d), withOffer(t, a.offer, { state: 'SENT' }), 'OFFER_NOT_ACCEPTED'],
      ['an offer DECLINED', hiredEvent(d), withOffer(t, a.offer, { state: 'DECLINED' }), 'OFFER_NOT_ACCEPTED'],
      ['an offer WITHDRAWN', hiredEvent(d), withOffer(t, a.offer, { state: 'WITHDRAWN' }), 'OFFER_NOT_ACCEPTED'],
      ['an offer in lower case "accepted"', hiredEvent(d), withOffer(t, a.offer, { state: 'accepted' }), 'OFFER_NOT_ACCEPTED'],
      ['another employee_id than the offer\'s', hiredEvent({ ...d, employee_id: '0b9f2a10-0000-4000-8000-00000000ffff' }), t, ['OFFER_NOT_FOUND', 'OFFER_NOT_ACCEPTED']],
      ['another candidate_id than the offer\'s', hiredEvent({ ...d, candidate_id: KC_OTHER }), t, ['OFFER_NOT_FOUND', 'OFFER_NOT_ACCEPTED']],
      ['an offer that does not exist', hiredEvent({ ...d, offer_id: 'offer-00000000-0000-4000-8000-000000000000' }), t, 'OFFER_NOT_FOUND'],
      ['an offer row with no tenant_id', hiredEvent(d), withOffer(t, a.offer, { tenant_id: undefined }), 'OFFER_NOT_FOUND'],
      ['no offer_id', hiredEvent({ ...d, offer_id: undefined }), t, 'BAD_EVENT'],
      ['an empty tenant_id', hiredEvent({ ...d, tenant_id: '' }), t, 'BAD_EVENT'],
      ['a number as candidate_id', hiredEvent({ ...d, candidate_id: 42 }), t, 'BAD_EVENT'],
      ['an object as employee_id', hiredEvent({ ...d, employee_id: { S: d['employee_id'] } }), t, 'BAD_EVENT'],
      ['an offer_id of 200 characters', hiredEvent({ ...d, offer_id: 'o'.repeat(200) }), t, 'BAD_EVENT'],
      ['no detail', hiredEvent({}), t, 'BAD_EVENT'],
    ];
    for (const [what, ev, before, outcome] of cases) {
      const r = run(`AC-11 ${what}`, ev, before);
      nothingSent(`AC-11 ${what}`, before, r, outcome);
    }
  });

  // ---------------------------------------------------------------- AC-12

  test('AC-12 The candidate\'s name is text, not code: CR, LF and other control characters never reach the Subject; TextBody has the name as plain text; HtmlBody has it escaped inside the one <p>; no extra Postmark field', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(240_000);
    const { t, a } = the();
    const cases: [string, string, string, string][] = [
      ['a header injection in the first name', 'Thandeka\r\nBcc: x@y.co', 'Mahlaba', 'ThandekaBcc: x@y.co Mahlaba'],
      ['HTML and quotes in the names', '<b>Th</b>', '& "Mahlaba"', '<b>Th</b> & "Mahlaba"'],
      ['tabs, a bell, a NUL and a line separator', '\tThan\u0007deka\u0000', 'Mah\u2028laba\n', 'Thandeka Mahlaba'],
      ['an apostrophe and spaces around the names', "  O'Neil ", ' Mahlaba  ', "O'Neil Mahlaba"],
    ];
    for (const mode of ['HIRING_MANAGER', 'TEST_ADDRESS'] as Mode[]) {
      for (const [what, first, last, shown] of cases) {
        const before = withCandidate(t, a.candidate, { firstName: first, lastName: last });
        const r = run(`AC-12 ${what} (${mode})`, hiredEvent(a.detail), before, { mode });
        sentOnce(`AC-12 ${what} (${mode})`, before, r, a.offer);
        const m = sent(r)[0]?.message ?? {};
        expect.soft(Object.keys(m).sort(), `AC-12 ${what} (${mode}): no extra Postmark field (Cc, Bcc, Headers ...)`).toEqual(MESSAGE_KEYS);
        // eslint-disable-next-line no-control-regex
        const control = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
        expect.soft(control.test(String(m.Subject)), `AC-12 ${what} (${mode}): the Subject has no CR, LF or other control character (${JSON.stringify(m.Subject)})`).toBe(false);
        expect.soft(m.Subject, `AC-12 ${what} (${mode}): Subject`).toBe(subjectFor(shown));
        expect.soft(m.TextBody, `AC-12 ${what} (${mode}): TextBody has the name as plain text`).toBe(bodyFor(shown));
        const html = String(m.HtmlBody ?? '');
        const okHtml = [`<p>${htmlEscape(bodyFor(shown))}</p>`, `<p>${htmlEscape(bodyFor(shown)).replace(/&#39;/g, '&#x27;')}</p>`];
        expect.soft(okHtml.includes(html), `AC-12 ${what} (${mode}): HtmlBody is the body line escaped inside one <p> (${html.slice(0, 160)})`).toBe(true);
        expect.soft((html.match(/</g) ?? []).length, `AC-12 ${what} (${mode}): the only tags are the one <p> and its </p>`).toBe(2);
      }
    }
  });
});

const KC_OTHER = 'CAND-REC06APL000000000000000001';
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A plain-valued row in DynamoDB's AttributeValue form (for world.landBeforeWrite). */
function avRow(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'number' ? { N: String(v) } : { S: String(v) }]));
}
