import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { ON_DEV, avatarButton, type SignInPage } from './support/fixtures';
import type { CognitoFake } from './support/cognito-fake';
import type { ModulesFake } from './support/mod-02/modules-fake';
import { WHO, companyIdIn, enter, iso, quiet, type HireFake, type Who } from './support/rec-ui/harness';
import { RW, addCand, main, openRecord, pageButton, personHeader, readHeader, readPath, type RecordFake } from './support/rec-ui-02/record';
import { added, chooseNotes, movedLine, notHired, readLines, timeline, type EventsFake, type Row } from './support/rec-ui-02/notes';
import {
  MAX_REASON, OW, SERVER_TEXT, SERVER_WORDS, anyReopen, cancelButton, closeButton, confirmButton, dialogOf, expect, leftOver, openDialog, readDialog, reasonField,
  reopenButton, test, type ReopenFake,
} from './support/rec-ui-02/reopen';

/**
 * REC-UI-02 step 9 · Reopen a Not hired candidate from the record: a Recruiter who may decide sees "Reopen" on a Not hired record
 * whose earlier stage was open, gives a reason, and the candidate goes back to that stage. Jira NH-280 (AC-8, epic NH-223, amber).
 * Lock acceptance-lock/rec-ui-02.9, one squashed commit on develop 64b5750. Spec: onboarding-cards/specs/REC-UI-02-later-steps.md
 * section 5b (rules 1 to 7, AC-RO1 to AC-RO11), its checks REC-UI-02-step9-spec-check-r1.md and -r2.md; words D-RUI-02.35 (Iggie's
 * "Approve all", 28 Nov 2026 09:38 SAST). Where the spec is silent, cards/rec-ui-02.9.md says what these tests take (T-R1 to T-R8).
 *
 * The locked AC-R3 and AC-R8 lines of rec-ui-02-record.spec.ts ("no Reopen" over cand-nomvula) do not move: the record fake sends no
 * `stage_before_not_hired` unless a test here sets it (support/rec-ui-02/reopen.ts `beforeRecords`), so rule 1 keeps them true
 * (spec "Locked lines that move", first option).
 *
 * Every test runs at 1280 and 390 wide unless it says why not. Page time is 19 Nov 2026 10:00 in Johannesburg (the harness clock).
 * AC-RO11 runs on pepla-dev only. No test calls Bedrock or any paid AI.
 */

const phone = () => test.info().project.name === 'phone-390';
const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs the fake API.');

type Fx = { page: Page; signIn: SignInPage; cognito: CognitoFake | null; modules: ModulesFake | null; hire: HireFake | null; record: RecordFake | null; events: EventsFake | null; reopen: ReopenFake | null };
const DAY = 86_400_000;
const NOMVULA = 'cand-nomvula';
const FARAI = 'cand-farai-m';
const REASON = 'Came back after the role reopened';

async function asRecruiter(fx: Fx, who: Who = WHO.recruiterA): Promise<void> {
  await enter(fx.page, fx.signIn, fx.cognito, fx.modules, fx.hire, who);
}
const cand = (hire: HireFake, id: string) => hire.world.cands.find((c) => c.id === id)!;

/** Nomvula Zulu (harness: Not hired, role-fleet, company A), whose row says she was at `before` when she was not hired. */
function closed(fx: Fx, before: string | null = 'INTERVIEW', id = NOMVULA): void {
  const c = cand(fx.hire!, id);
  c.stage = 'NOT_HIRED';
  c.stage_entered_at = iso(fx.hire!.world.now - 2 * DAY);
  fx.reopen!.setBefore(id, before);
}
/** A history for the candidate: added, moved on, then not hired. */
function historyOf(fx: Fx, id = NOMVULA): Row[] {
  const now = fx.hire!.world.now;
  const rows = [added(iso(now - 9 * DAY)), notHired(iso(now - 2 * DAY), 'INTERVIEW', 'NOT_RIGHT_SKILLS', 'Naledi Zungu')];
  fx.reopen!.setHistory(id, rows);
  return rows;
}

// ================================================================ AC-RO1 Button (rule 1, F-2)
test.describe('AC-RO1 Button', () => {
  test.beforeEach(noBackendOnly);

  test('AC-RO1 Not hired, can_decide true, and stage_before_not_hired each of Applied, Screening, Interview, Offer: "Reopen" shows in the header actions, and neither Move nor Not hired does', async ({ page, signIn, cognito, modules, hire, record, events, reopen }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, reopen };
    await asRecruiter(fx);
    for (const before of ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER']) {
      closed(fx, before);
      await openRecord(page, NOMVULA);
      await quiet(page);
      await expect(reopenButton(page), `${before}: one Reopen`).toHaveCount(1);
      await expect(reopenButton(page), before).toBeVisible();
      await expect(personHeader(page).getByRole('button', { name: OW.reopen, exact: true }), `${before}: in the header actions`).toHaveCount(1);
      await expect(anyReopen(page), `${before}: nothing else named Reopen`).toHaveCount(1);
      await expect(pageButton(page, RW.move), `${before}: no Move`).toHaveCount(0);
      await expect(pageButton(page, RW.notHired), `${before}: no Not hired`).toHaveCount(0);
      expect((await readHeader(page)).lozenge?.words, before).toBe(RW.notHired);
    }
  });

  test('AC-RO1 No "Reopen" with can_decide false, with no stage_before_not_hired, with a closed one (Hired, Not hired) or an unknown one, on an old-system row, on each open stage and on Hired (even when the row carries an open stage_before_not_hired)', async ({ page, signIn, cognito, modules, hire, record, events, reopen }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, reopen };
    addCand(hire!, { id: 'cand-hired-1', name: 'Sibusiso Khoza', stage: 'HIRED', stage_entered_at: iso(hire!.world.now - 3 * DAY) });
    await asRecruiter(fx);
    const cases: Array<[string, string, () => void]> = [
      ['can_decide false', NOMVULA, () => { closed(fx, 'INTERVIEW'); record!.set(NOMVULA, { can_decide: false }); }],
      ['no stage_before_not_hired', NOMVULA, () => { closed(fx, null); record!.set(NOMVULA, { can_decide: true }); }],
      ['stage_before_not_hired HIRED', NOMVULA, () => closed(fx, 'HIRED')],
      ['stage_before_not_hired NOT_HIRED', NOMVULA, () => closed(fx, 'NOT_HIRED')],
      ['stage_before_not_hired EVALUATION (old)', NOMVULA, () => closed(fx, 'EVALUATION')],
      ['old-system row, no stage_before_not_hired', 'cand-os-1', () => undefined],
      ['Applied', 'cand-amahle', () => reopen!.setBefore('cand-amahle', 'INTERVIEW')],
      ['Screening', 'cand-tariro', () => reopen!.setBefore('cand-tariro', 'APPLIED')],
      ['Interview', 'cand-bongani', () => reopen!.setBefore('cand-bongani', 'SCREENING')],
      ['Offer', 'cand-kagiso', () => reopen!.setBefore('cand-kagiso', 'INTERVIEW')],
      ['Hired', 'cand-hired-1', () => { reopen!.setBefore('cand-hired-1', 'OFFER'); record!.set('cand-hired-1', { can_decide: true }); }],
    ];
    for (const [where, id, arrange] of cases) {
      arrange();
      await openRecord(page, id);
      await quiet(page);
      await expect(personHeader(page), where).toBeVisible();
      await expect(anyReopen(page), `${where}: no Reopen`).toHaveCount(0);
      await expect(dialogOf(page), `${where}: no dialog`).toHaveCount(0);
    }
    expect(reopen!.posts(), 'nothing sent').toEqual([]);
  });
});

// ================================================================ AC-RO2 Dialog (rule 2)
test.describe('AC-RO2 Dialog', () => {
  test.beforeEach(noBackendOnly);

  test('AC-RO2 "Reopen" opens a dialog titled "Reopen this candidate" with one field, labelled "Reason", empty, and the buttons Cancel and "Reopen" (and the dialog\'s Close); nothing is sent by opening it', async ({ page, signIn, cognito, modules, hire, record, events, reopen }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, reopen };
    closed(fx);
    await asRecruiter(fx);
    await openRecord(page, NOMVULA);
    await openDialog(page);
    const d = await readDialog(page);
    expect(d.title).toBe(OW.title);
    expect(d.fields.map((f) => f.name), 'one field, named "Reason"').toEqual([OW.reason]);
    expect(d.labels, 'the one label reads exactly "Reason"').toEqual([OW.reason]);
    expect([...d.buttons].sort(), 'Cancel, Reopen and the dialog\'s Close').toEqual([OW.cancel, OW.close, OW.reopen].sort());
    await expect(reasonField(page)).toBeVisible();
    await expect(reasonField(page)).toHaveValue('');
    await expect(cancelButton(page)).toBeVisible();
    await expect(confirmButton(page)).toBeVisible();
    await expect(confirmButton(page), 'Reopen is the main button').toHaveClass(/pp-button--primary/);
    await expect(cancelButton(page)).not.toHaveClass(/pp-button--primary/);
    await expect(dialogOf(page), 'the design system dialog').toHaveClass(/pp-modal-dialog/);
    expect(leftOver(d.text, false), 'no other words in the dialog').toBe('');
    expect(reopen!.posts()).toEqual([]);
  });

  test('AC-RO2 The field stops at 1000 characters: it carries maxlength 1000, typing 1001 keeps 1000, and those 1000 are what is sent', async ({ page, signIn, cognito, modules, hire, record, events, reopen }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, reopen };
    closed(fx);
    await asRecruiter(fx);
    await openRecord(page, NOMVULA);
    await openDialog(page);
    expect((await readDialog(page)).fields[0]?.maxlength).toBe(String(MAX_REASON));
    const long = 'a'.repeat(MAX_REASON - 1) + 'bc';
    await reasonField(page).fill(long);
    await expect.poll(async () => (await reasonField(page).inputValue()).length).toBe(MAX_REASON);
    await confirmButton(page).click();
    await expect.poll(() => reopen!.posts().length).toBe(1);
    expect(reopen!.posts()[0]!.body).toEqual({ reason: long.slice(0, MAX_REASON) });
  });
});

// ================================================================ AC-RO3 Reason needed (rule 2, F-1)
test.describe('AC-RO3 Reason needed', () => {
  test.beforeEach(noBackendOnly);

  test('AC-RO3 With the field empty or only spaces "Reopen" is disabled and a click sends nothing; one character enables it, clearing it disables it again; no error words appear at any point', async ({ page, signIn, cognito, modules, hire, record, events, reopen }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, reopen };
    closed(fx);
    await asRecruiter(fx);
    await openRecord(page, NOMVULA);
    await openDialog(page);
    const noErrors = async (where: string) => {
      const d = await readDialog(page);
      expect(leftOver(d.text, false), `${where}: no other words`).toBe('');
      expect(d.labels, `${where}: the label still reads "Reason"`).toEqual([OW.reason]);
      await expect(dialogOf(page).locator('.pp-field__error, [role="alert"], .pp-section-message'), `${where}: no error line`).toHaveCount(0);
      await expect(reasonField(page), `${where}: the field is not marked invalid`).not.toHaveAttribute('aria-invalid', 'true');
    };
    await expect(confirmButton(page), 'empty').toBeDisabled();
    await confirmButton(page).click({ force: true });
    await noErrors('empty, clicked');
    await reasonField(page).fill('   \t  ');
    await expect(confirmButton(page), 'spaces').toBeDisabled();
    await confirmButton(page).click({ force: true });
    await reasonField(page).press('Enter');
    await noErrors('spaces, clicked');
    await reasonField(page).fill('x');
    await expect(confirmButton(page), 'one character').toBeEnabled();
    await noErrors('one character');
    await reasonField(page).fill('');
    await expect(confirmButton(page), 'cleared').toBeDisabled();
    await reasonField(page).blur();
    await noErrors('cleared and left');
    await page.waitForTimeout(300);
    expect(reopen!.posts(), 'nothing sent').toEqual([]);
    await expect(dialogOf(page)).toBeVisible();
  });
});

// ================================================================ AC-RO4 Body (rule 3, S-1)
test.describe('AC-RO4 Body', () => {
  test.beforeEach(noBackendOnly);

  test('AC-RO4 One POST /v1/candidates/{id}/reopen with body exactly { reason }, trimmed: no stage, no company, nothing in the query, no Idempotency-Key; no company id anywhere in the request', async ({ page, signIn, cognito, modules, hire, record, events, reopen }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, reopen };
    closed(fx);
    await asRecruiter(fx);
    await openRecord(page, NOMVULA);
    await openDialog(page);
    await reasonField(page).fill(`   ${REASON}  \n `);
    await confirmButton(page).click();
    await expect(dialogOf(page)).toBeHidden();
    const posts = reopen!.posts();
    expect(posts.length).toBe(1);
    const p = posts[0]!;
    expect(p.path).toMatch(new RegExp(`/v1/candidates/${NOMVULA}/reopen$`));
    expect(p.body, 'exactly { reason }, trimmed').toEqual({ reason: REASON });
    expect(p.query, 'nothing in the query').toEqual({});
    expect(p.idempotencyKey, 'no Idempotency-Key (S-1)').toBeNull();
    expect(p.email, 'sent as the signed-in Recruiter').toBe(WHO.recruiterA.email);
    expect(companyIdIn(p), 'no company id in path, query, body or headers').toEqual([]);
    expect(p.status).toBe(200);
    // No other write was made: no stage move and no Not hired.
    expect(hire!.calls.filter((c) => c.method !== 'GET' && c.method !== 'OPTIONS').map((c) => `${c.method} ${c.path}`), 'no other write').toEqual([]);
  });

  test('AC-RO4 A double click sends once: "Reopen" is disabled while the call runs, and the dialog closes when it answers', async ({ page, signIn, cognito, modules, hire, record, events, reopen }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, reopen };
    closed(fx);
    await asRecruiter(fx);
    await openRecord(page, NOMVULA);
    await openDialog(page);
    await reasonField(page).fill(REASON);
    reopen!.refuse({ hold: true });
    await confirmButton(page).dblclick();
    await expect.poll(() => reopen!.heldCount).toBe(1);
    await expect(confirmButton(page), 'disabled while the call runs').toBeDisabled();
    await confirmButton(page).click({ force: true });
    await reasonField(page).press('Enter');
    await page.waitForTimeout(500);
    expect(reopen!.posts().length, 'one request').toBe(1);
    reopen!.release();
    await expect(dialogOf(page)).toBeHidden();
    await quiet(page);
    expect(reopen!.posts().length, 'still one request').toBe(1);
  });
});

// ================================================================ AC-RO5 Success (rule 4)
test.describe('AC-RO5 Success', () => {
  test.beforeEach(noBackendOnly);

  test('AC-RO5 On 200 with stage Interview: the dialog closes, the record reads itself again and shows Interview as the current step, the stage-time lozenge, "Not hired" and "Move"; "Reopen" is gone; focus is back in the header', async ({ page, signIn, cognito, modules, hire, record, events, reopen }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, reopen };
    closed(fx, 'INTERVIEW');
    await asRecruiter(fx);
    await openRecord(page, NOMVULA);
    await quiet(page);
    expect((await readPath(page)).some((s) => s.state === 'current'), 'Not hired: no current step').toBe(false);
    const readsBefore = record!.reads(NOMVULA).length;
    await openDialog(page);
    await reasonField(page).fill(REASON);
    await confirmButton(page).click();
    await expect(dialogOf(page)).toBeHidden();
    await expect.poll(async () => (await readPath(page)).find((s) => s.state === 'current')?.label).toBe('Interview');
    expect(record!.reads(NOMVULA).length, 'the record was read again after the reopen').toBeGreaterThan(readsBefore);
    const lastRead = record!.reads(NOMVULA).at(-1)!;
    expect(lastRead.seq > 0 && reopen!.posts()[0]!.status).toBe(200);
    const h = await readHeader(page);
    expect(h.name).toBe('Nomvula Zulu');
    expect(h.lozenge?.words, 'the stage-time lozenge of an open stage').toBe('On track, 4 days left');
    await expect(pageButton(page, RW.notHired)).toBeVisible();
    await expect(pageButton(page, RW.move)).toBeVisible();
    await expect(anyReopen(page), 'Reopen is gone').toHaveCount(0);
    await expect(main(page).getByText(OW.saveFail, { exact: true })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('.pp-person-header')), { message: 'focus is back in the header' }).toBe(true);
  });

  test('AC-RO5 The stage shown is the one the server went back to: Applied for a candidate not hired from Applied', async ({ page, signIn, cognito, modules, hire, record, events, reopen }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, reopen };
    closed(fx, 'APPLIED', FARAI);
    await asRecruiter(fx);
    await openRecord(page, FARAI);
    await openDialog(page);
    await reasonField(page).fill(REASON);
    await confirmButton(page).click();
    await expect(dialogOf(page)).toBeHidden();
    await expect.poll(async () => (await readPath(page)).find((s) => s.state === 'current')?.label).toBe('Applied');
    await expect(anyReopen(page)).toHaveCount(0);
    await expect(pageButton(page, RW.move)).toBeVisible();
  });
});

// ================================================================ AC-RO6 Refusals (rule 4, S-2)
test.describe('AC-RO6 Refusals', () => {
  test.beforeEach(noBackendOnly);

  test('AC-RO6 409, 400, 403, 404, 500 and a dropped connection each keep the dialog open with the typed reason and show "Your change could not be saved. Try again." in it; no code, status or server text; after 409 the record is read again', async ({ page, signIn, cognito, modules, hire, record, events, reopen }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, reopen };
    closed(fx);
    await asRecruiter(fx);
    const cases: Array<[string, { status?: number; body?: unknown; abort?: boolean }]> = [
      ['409', { status: 409, body: { error: `Conflict ${SERVER_TEXT}`, code: 'NOT_OPEN' } }],
      ['400', { status: 400, body: { error: `Bad request ${SERVER_TEXT}`, code: 'REASON_REQUIRED' } }],
      ['403', { status: 403, body: { error: `Forbidden ${SERVER_TEXT}` } }],
      ['404', { status: 404, body: { error: `Not found ${SERVER_TEXT}` } }],
      ['500', { status: 500, body: { error: `Internal Server Error ${SERVER_TEXT}`, message: SERVER_TEXT } }],
      ['dropped', { abort: true }],
    ];
    for (const [where, refusal] of cases) {
      await openRecord(page, NOMVULA);
      await openDialog(page);
      const typed = `${REASON} (${where})`;
      await reasonField(page).fill(typed);
      const reads = record!.reads(NOMVULA).length;
      const sent = reopen!.posts().length;
      reopen!.refuse(refusal);
      await confirmButton(page).click();
      await expect.poll(() => reopen!.posts().length, where).toBe(sent + 1);
      await expect(dialogOf(page).getByText(OW.saveFail, { exact: true }), `${where}: the failure line in the dialog`).toBeVisible();
      await expect(dialogOf(page), `${where}: the dialog stays`).toBeVisible();
      await expect(reasonField(page), `${where}: the reason is kept`).toHaveValue(typed);
      await expect(confirmButton(page), `${where}: Reopen can be pressed again`).toBeEnabled();
      if (where === '409') await expect.poll(() => record!.reads(NOMVULA).length, '409: the record is read again').toBeGreaterThan(reads);
      await quiet(page);
      const d = await readDialog(page);
      expect(leftOver(d.text, true), `${where}: no other words in the dialog`).toBe('');
      expect(d.text, `${where}: no code, status or server text`).not.toMatch(SERVER_WORDS);
      const all = `${await main(page).innerText()} ${await page.title()}`;
      expect(all, `${where}: none on the page either`).not.toMatch(/MARK-reopen|NOT_OPEN|REASON_REQUIRED/);
      await cancelButton(page).click();
      await expect(dialogOf(page)).toBeHidden();
      // The next opening starts empty: no reason and no failure line left from this try (rule 6).
      await openDialog(page);
      await expect(reasonField(page), `${where}: opened again, empty`).toHaveValue('');
      await expect(dialogOf(page).getByText(OW.saveFail, { exact: true }), `${where}: opened again, no failure line`).toHaveCount(0);
      await cancelButton(page).click();
      await expect(dialogOf(page)).toBeHidden();
    }
    expect(reopen!.posts().length, 'one request per press, no retry by itself').toBe(cases.length);
  });

  test('AC-RO6 409 because someone reopened her first: the record read after it shows her open stage and "Reopen" leaves the header while the dialog still shows the failure line; Close, then Escape on a second try, still close it', async ({ page, signIn, cognito, modules, hire, record, events, reopen }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, reopen };
    closed(fx);
    await asRecruiter(fx);
    await openRecord(page, NOMVULA);
    await openDialog(page);
    await reasonField(page).fill(REASON);
    // Another Recruiter reopens her while this request is on its way; the server then answers NOT_OPEN.
    reopen!.refuse({ status: 409, body: { error: 'Conflict', code: 'NOT_OPEN' }, before: () => { const c = cand(hire!, NOMVULA); c.stage = 'SCREENING'; c.stage_entered_at = iso(hire!.world.now); } });
    await confirmButton(page).click();
    await expect(dialogOf(page).getByText(OW.saveFail, { exact: true })).toBeVisible();
    await expect.poll(async () => (await readPath(page)).find((s) => s.state === 'current')?.label, 'the record read again shows Screening').toBe('Screening');
    await expect(anyReopen(page), 'Reopen left the header').toHaveCount(0);
    await expect(dialogOf(page), 'the dialog is still open').toBeVisible();
    await expect(dialogOf(page).getByText(OW.saveFail, { exact: true }), 'with the failure line').toBeVisible();
    await closeButton(page).click();
    await expect(dialogOf(page)).toBeHidden();
    // Second try on another closed candidate: Escape closes the failed dialog too.
    closed(fx, 'OFFER', FARAI);
    await openRecord(page, FARAI);
    await openDialog(page);
    await reasonField(page).fill(REASON);
    reopen!.refuse({ status: 409, body: { error: 'Conflict', code: 'NOT_OPEN' }, before: () => { cand(hire!, FARAI).stage = 'OFFER'; } });
    await confirmButton(page).click();
    await expect(dialogOf(page).getByText(OW.saveFail, { exact: true })).toBeVisible();
    await expect(anyReopen(page)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialogOf(page)).toBeHidden();
    expect(reopen!.posts().length).toBe(2);
  });
});

// ================================================================ AC-RO7 Cancel (rule 6)
test.describe('AC-RO7 Cancel', () => {
  test.beforeEach(noBackendOnly);

  test('AC-RO7 Cancel, Close and Escape each close the dialog and send nothing; the next opening starts empty; Not hired stays as it was', async ({ page, signIn, cognito, modules, hire, record, events, reopen }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, reopen };
    closed(fx);
    await asRecruiter(fx);
    await openRecord(page, NOMVULA);
    const ways: Array<[string, () => Promise<void>]> = [
      ['Cancel', () => cancelButton(page).click()],
      ['Close', () => closeButton(page).click()],
      ['Escape', () => page.keyboard.press('Escape')],
    ];
    for (const [way, dismiss] of ways) {
      await openDialog(page);
      await expect(reasonField(page), `${way}: starts empty`).toHaveValue('');
      await reasonField(page).fill(`${REASON} ${way}`);
      await dismiss();
      await expect(dialogOf(page), `${way}: closed`).toBeHidden();
      await expect(reopenButton(page), `${way}: Reopen still there`).toBeVisible();
    }
    await openDialog(page);
    await expect(reasonField(page), 'starts empty after the last one too').toHaveValue('');
    await cancelButton(page).click();
    await quiet(page);
    expect(reopen!.posts(), 'nothing sent').toEqual([]);
    expect((await readHeader(page)).lozenge?.words).toBe(RW.notHired);
    expect(cand(hire!, NOMVULA).stage).toBe('NOT_HIRED');
  });
});

// ================================================================ AC-RO8 History (rule 5, S-3)
test.describe('AC-RO8 History', () => {
  test.beforeEach(noBackendOnly);

  test('AC-RO8 Reopening while Notes shows: the history is read again and its newest row is the reopen, in the words AC-N3 already locks (rec-ui-02-notes.spec.ts); the reason is shown nowhere', async ({ page, signIn, cognito, modules, hire, record, events, reopen }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, reopen };
    closed(fx);
    historyOf(fx);
    await asRecruiter(fx);
    await openRecord(page, NOMVULA);
    await chooseNotes(page);
    await expect(timeline(page)).toBeVisible();
    await expect.poll(async () => (await readLines(page)).length).toBe(2);
    const reads = events!.reads(NOMVULA).length;
    await openDialog(page);
    await reasonField(page).fill(REASON);
    await confirmButton(page).click();
    await expect(dialogOf(page)).toBeHidden();
    await expect.poll(() => events!.reads(NOMVULA).length, 'the history is read again').toBeGreaterThan(reads);
    await expect.poll(async () => (await readLines(page)).length, 'one more row').toBe(3);
    const newest = (await readLines(page))[0]!;
    // The words come from notes.ts (the AC-N3 helpers), not a second copy here.
    expect(newest.summary).toBe(movedLine('Nomvula', 'INTERVIEW', WHO.recruiterA.full));
    expect(newest.change ? [newest.change.from, newest.change.to] : null).toEqual(['Not hired', 'Interview']);
    const text = `${await main(page).innerText()} ${await page.content()}`;
    expect(text, 'the reopen reason is not shown').not.toContain(REASON);
  });

  test('AC-RO8 Reopening on Overview, then choosing Notes: the newest row is the reopen (the history kept from before the reopen is not reused)', async ({ page, signIn, cognito, modules, hire, record, events, reopen }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, reopen };
    closed(fx);
    historyOf(fx);
    await asRecruiter(fx);
    await openRecord(page, NOMVULA);
    await chooseNotes(page);
    await expect.poll(async () => (await readLines(page)).length).toBe(2);
    await main(page).getByRole('tab', { name: RW.overview, exact: true }).click();
    await openDialog(page);
    await reasonField(page).fill(REASON);
    await confirmButton(page).click();
    await expect(dialogOf(page)).toBeHidden();
    await expect.poll(async () => (await readPath(page)).find((s) => s.state === 'current')?.label).toBe('Interview');
    await chooseNotes(page);
    await expect.poll(async () => (await readLines(page)).length).toBe(3);
    expect((await readLines(page))[0]!.summary).toBe(movedLine('Nomvula', 'INTERVIEW', WHO.recruiterA.full));
  });
});

// ================================================================ AC-RO9 Company B (rule 7)
test.describe('AC-RO9 Company B', () => {
  test.beforeEach(noBackendOnly);

  test('AC-RO9 A Recruiter of company B (Recruitment on) typing A\'s Not hired candidate id sees only "This candidate could not be found.": no "Reopen", no dialog, nothing sent, nothing of A', async ({ page, signIn, cognito, modules, hire, record, events, reopen }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, reopen };
    closed(fx);
    modules!.answers.B = ['onboarding', 'recruitment'];
    await asRecruiter(fx, WHO.recruiterB);
    await openRecord(page, NOMVULA);
    await expect(main(page).getByText(RW.notFound, { exact: true })).toBeVisible();
    await quiet(page);
    await expect(anyReopen(page)).toHaveCount(0);
    await expect(dialogOf(page)).toHaveCount(0);
    expect(reopen!.posts()).toEqual([]);
    const html = await page.content();
    // B's own Recruiter is Sipho Zulu, so only the first name and the email are A's.
    for (const n of ['Nomvula', 'nomvula.zulu@example.org']) expect(html, n).not.toContain(n);
    const last = record!.reads(NOMVULA).at(-1)!;
    expect([last.email, last.status]).toEqual([WHO.recruiterB.email, 404]);
  });

  test('AC-RO9 A\'s Recruiter on A\'s Not hired record signs out with the app\'s Sign out and B\'s Recruiter signs in on the page the app left (no reload): A\'s id reached inside the app shows "This candidate could not be found." and never "Reopen", even while the answer is on its way', async ({ page, signIn, cognito, modules, hire, record, events, reopen }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, reopen };
    closed(fx);
    await asRecruiter(fx);
    await openRecord(page, NOMVULA);
    await expect(reopenButton(page)).toBeVisible();
    await avatarButton(page).click();
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    // From here on, a "Reopen" or a trace of A is written down the moment it appears.
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { __seen: string[] }).__seen = seen;
      const check = () => {
        const all = `${document.documentElement.outerHTML} ${document.title}`;
        if (/Nomvula/.test(all)) seen.push(`Nomvula at ${location.pathname}`);
        if ([...document.querySelectorAll('main button, main a')].some((b) => /^\s*Reopen/.test(b.textContent ?? ''))) seen.push(`Reopen at ${location.pathname}`);
      };
      new MutationObserver(check).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
      check();
    });
    const seen = () => page.evaluate(() => (window as unknown as { __seen?: string[] }).__seen ?? ['the watcher is gone: the page was loaded again']);
    modules!.answers.B = ['onboarding', 'recruitment'];
    const who = WHO.recruiterB;
    if (cognito!.subOf(who.email) === undefined) cognito!.addAccount(who);
    modules!.assign(who.email, who.company);
    hire!.assign(who);
    await signIn.signInAs(who);
    await expect(page).toHaveURL(who.lands!);
    record!.refuse({ hold: true, id: NOMVULA });
    await page.evaluate((id) => { history.pushState({}, '', `/hire/candidates/${id}`); dispatchEvent(new PopStateEvent('popstate', { state: {} })); }, NOMVULA);
    await expect.poll(() => record!.heldCount).toBe(1);
    await page.waitForTimeout(500);
    expect(await seen(), 'nothing of A while the answer is on its way').toEqual([]);
    record!.release();
    await expect(main(page).getByText(RW.notFound, { exact: true })).toBeVisible();
    await quiet(page);
    await expect(anyReopen(page)).toHaveCount(0);
    expect(await seen(), 'nothing of A and no Reopen at any moment').toEqual([]);
    expect(reopen!.posts()).toEqual([]);
    const last = record!.reads(NOMVULA).at(-1)!;
    expect([last.email, last.status]).toEqual([WHO.recruiterB.email, 404]);
  });
});

// ================================================================ AC-RO10 Phone and look
test.describe('AC-RO10 Phone and look', () => {
  test.beforeEach(noBackendOnly);

  test('AC-RO10 At 390 "Reopen", the dialog title, the field and both buttons are visible, inside the screen, not under the top bar and not covered; nothing scrolls sideways, with the dialog shut or open', async ({ page, signIn, cognito, modules, hire, record, events, reopen }) => {
    test.skip(!phone(), 'Phone only: the criterion is the 390 wide screen');
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, reopen };
    closed(fx);
    await asRecruiter(fx);
    await openRecord(page, NOMVULA);
    await quiet(page);
    const check = (parts: Array<[string, string]>) => page.evaluate(async (wanted) => {
      const out: string[] = [];
      const width = document.documentElement.clientWidth;
      const bar = document.querySelector('pp-top-navigation')?.getBoundingClientRect();
      const find = (how: string): HTMLElement | null => {
        const [kind, words] = how.split('|') as [string, string];
        if (kind === 'page-button') return [...document.querySelectorAll('main button, main a')].find((b) => (b.textContent ?? '').trim() === words) as HTMLElement ?? null;
        const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => (x.querySelector('h2')?.textContent ?? '').trim() === 'Reopen this candidate') as HTMLElement | undefined;
        if (!d) return null;
        if (kind === 'title') return d.querySelector('h2');
        if (kind === 'field') return d.querySelector('textarea, input');
        return [...d.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === words) as HTMLElement ?? null;
      };
      for (const [label, how] of wanted) {
        const el = find(how);
        if (!el) { out.push(`${label} missing`); continue; }
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) out.push(`${label} has no size`);
        if (r.left < -1 || r.right > width + 1) out.push(`${label} is cut off sideways (${Math.round(r.left)} to ${Math.round(r.right)})`);
        if (r.top < -1 || r.bottom > innerHeight + 1) out.push(`${label} is off the screen (${Math.round(r.top)} to ${Math.round(r.bottom)})`);
        if (bar && !el.closest('[role="dialog"]') && r.top < bar.bottom - 1 && r.bottom > 0) out.push(`${label} is under the top bar`);
        const x = Math.min(Math.max(r.left + r.width / 2, 1), width - 1), y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
        const hit = document.elementFromPoint(x, y);
        if (hit && !el.contains(hit) && !hit.contains(el)) out.push(`${label} is covered by ${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 40)}`);
      }
      if (document.documentElement.scrollWidth > width + 1) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} wide)`);
      return out;
    }, parts);
    expect(await check([['Reopen', 'page-button|Reopen']]), 'the record').toEqual([]);
    await page.evaluate(() => window.scrollTo(0, 0));
    await openDialog(page);
    await reasonField(page).fill(REASON);
    expect(await check([['title', 'title|'], ['field', 'field|'], ['Cancel', 'button|Cancel'], ['Reopen', 'button|Reopen']]), 'the dialog').toEqual([]);
  });
});

// ================================================================ AC-RO11 pepla-dev (judged after merge)
test.describe('AC-RO11 pepla-dev', () => {
  test.skip(!ON_DEV, 'AC-RO11 runs on pepla-dev only.');
  test.describe.configure({ retries: 0 });
  // seed_rec_ui_02_9 in scripts/ci/seed-dev.py puts one candidate per width back at an open stage every run (spec F-4); the dev
  // step runs every @pepla-dev test once per width and seeds once, so the file is keyed by Playwright project.
  type Seeded = { candidate: string; firstName: string; lastName: string; stage: 'Applied' | 'Screening' | 'Interview' | 'Offer' };
  const ALL = JSON.parse(readFileSync(join(__dirname, 'support', 'rec-ui-02', 'reopen-dev-ids.json'), 'utf8')) as Record<string, Seeded | string>;
  const mine = (): Seeded => { const d = ALL[test.info().project.name]; if (!d || typeof d === 'string') throw new Error(`reopen-dev-ids.json has no entry for ${test.info().project.name}`); return d; };
  const current = async (page: Page) => (await readPath(page)).find((s) => s.state === 'current')?.label ?? null;

  test('AC-RO11 @pepla-dev The HR login records Not hired on its own seeded candidate (no confirmation needed), reopens it with a reason, and sees it back at its earlier stage', async ({ page, signIn, hr }) => {
    const s = mine();
    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL('/hr');
    await page.goto(`/hire/candidates/${s.candidate}`);
    await expect.poll(async () => (await personHeader(page).count()) && (await readHeader(page)).name, { timeout: 20_000 }).toBe(`${s.firstName} ${s.lastName}`);
    expect(await current(page), 'the seed put the candidate back at an open stage').toBe(s.stage);
    await pageButton(page, RW.notHired).click();
    const nh = page.getByRole('dialog', { name: `${s.firstName} not hired`, exact: true });
    await expect(nh).toBeVisible();
    await nh.getByRole('radio', { name: 'Candidate withdrew', exact: true }).check();
    await nh.getByRole('button', { name: RW.recordNotHired, exact: true }).click();
    await expect(nh).toBeHidden({ timeout: 20_000 });
    await expect.poll(async () => (await readHeader(page)).lozenge?.words, { timeout: 20_000, message: 'Not hired with no confirmation (the seed picks a level with no second confirmation)' }).toBe(RW.notHired);
    await expect(reopenButton(page)).toBeVisible();
    await openDialog(page);
    await reasonField(page).fill('Dev check reopen');
    await confirmButton(page).click();
    await expect(dialogOf(page)).toBeHidden({ timeout: 20_000 });
    await expect.poll(() => current(page), { timeout: 20_000 }).toBe(s.stage);
    await expect(anyReopen(page)).toHaveCount(0);
    await expect(page.getByText(OW.saveFail, { exact: true })).toHaveCount(0);
    // A fresh read of the page agrees (the server, not the page, holds the stage).
    await page.reload();
    await expect.poll(() => current(page), { timeout: 20_000 }).toBe(s.stage);
  });

  test('AC-RO11 @pepla-dev Company B\'s HR login opening the seeded candidate\'s address gets "This candidate could not be found." (or is sent away when B has Recruitment off) and never "Reopen". It fails when E2E_B_HR_* is not set (a skip is not a pass)', async ({ page, signIn }) => {
    const s = mine();
    const email = process.env['E2E_B_HR_EMAIL'], password = process.env['E2E_B_HR_PASSWORD'];
    expect(email && password, 'E2E_B_HR_EMAIL and E2E_B_HR_PASSWORD must be set on the dev run').toBeTruthy();
    await signIn.open();
    await signIn.signInAs({ email: email!, password: password! });
    await expect(page).toHaveURL('/hr');
    await page.goto(`/hire/candidates/${s.candidate}`);
    await quiet(page);
    const notFound = await main(page).getByText(RW.notFound, { exact: true }).count();
    if (!notFound) await expect(page, 'sent away when Recruitment is off').toHaveURL('/hr');
    await expect(anyReopen(page)).toHaveCount(0);
    expect(await page.content()).not.toContain(s.lastName);
  });
});
