import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import { ON_DEV, expect, test } from './support/fixtures';
import { REPO, runModule, SETTINGS_HELPER } from './support/rec-14/lambda-harness';
import { leakedTokens } from './support/int-01/world';
import { APPROVED, allowedPiece, expected } from './support/int-04/approved';
import {
  A, B, BOOKER, CAND, COMPANY_A, FRONT, H, K4, MANY, NOW, ODD_NAME, ORGANISER, OVERRIDE, P, PEOPLE, SECRET, SENDER, SUB, TABLE, TEST_TO, W, X,
  act, av, book, bodies, byTemplate, emailsOf, fileOf, guardRows, guestRead, htmlAsText, icsLines, inAppRows, ivRow, linkRows, logsOf, mailLogs, plain,
  postmarkOf, queued, rowsOf, send, skips, withCompanyName, withPanel, withRows, world, type Run, type Tables,
} from './support/int-04/world';

/**
 * INT-04 (NH-277) Interview emails with the calendar invite. Spec: specs/interview-journey/cards/INT-04.md (26 Nov 2026, spec check
 * passed in round 2). Red tier.
 *
 * Lambda tests: the real scheduleInterview and sendTalentFlowNotification run in a fresh Node process each, against REC-14's fake AWS
 * (DynamoDB, Cognito, SQS, EventBridge, Postmark), at INT-01's fixed clock NOW (2026-11-23 12:00 UTC). "Queued" means a message the
 * producer sent to the fake queue; "sent" means a Postmark call when the test hands that message to the sender. Company A has
 * interview_emails ON (INT-01's world); company B's switch is off.
 *
 * Pinned choices (cards/int-04.md has the long form):
 *  - T-1  How the approved texts are read (support/int-04/approved.ts header): blocks with one blank line between, [details] inside
 *         "The new details:" block in E-4, an optional line is its own block, "Hi." when the first name is empty, "\n" line breaks.
 *  - T-2  A guest address INT-01 accepts but INT-02 refuses gives PERSON_NOT_FOUND or INVITE_BAD_EMAIL (either is "the matching code").
 *  - T-3  AC-3's text check also lets through DynamoDB expressions (a literal that is the value of a property whose name ends in
 *         "Expression"), because rule 10.3 itself names one ("attribute_not_exists(PK) OR #status = :failed"). Every other literal with
 *         a space next to a letter must be a piece of an allowed line (approved.ts ALLOWED_LINES: the draft's lines, W-17 and P-1 forms,
 *         and rule 9's `<a href="`). int01.mjs is judged on the literals it adds against develop ff432ee (support/int-04/int01-ff432ee.json).
 *  - T-4  The slow-pool case (AC-11) uses 5 s per AdminGetUser and 20 panel members, so that a build with at most 5 lookups at a time
 *         and a 12 s budget must leave people NOT_QUEUED (3 s and 10 people finish inside 12 s, so the spec's numbers alone cannot see a
 *         missing budget). The tests fix Date (REC-15's clock), so the budget must be measured with a clock that moves (performance.now).
 *  - T-5  "Two copies at once" (AC-6) is one SQS batch with the same message twice; the fake runs records one after another.
 *  - T-6  The sender "throws" when its record is in batchItemFailures (the handler catches per record, as today).
 *  - T-7  INT-01.F follow-up F-1 (D-INT-04.10) is not tested here; see cards/int-04.md.
 *  - T-8  Rule 11's producer line is { event: 'interview_emails', queued, skipped }, without interview_id: the locked INT-01.F tests
 *         (int-01f.spec.ts:448 and :649) forbid the booking's id in any scheduleInterview log line, and they win over the spec's line.
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS or reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};

// ---------------------------------------------------------------- shared helpers

const AT1 = '2026-12-03T07:30:00.000Z'; // 3 Dec 2026, 09:30 SAST
const AT2 = '2026-12-10T12:15:00.000Z'; // 10 Dec 2026, 14:15 SAST
const AT_LATE = '2026-12-04T22:30:00.000Z'; // 5 Dec 2026, 00:30 SAST (the day changes in Johannesburg)
const plus7 = (iso: string) => new Date(Date.parse(iso) + 7 * 86_400_000).toISOString();
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const statusOf = (r: Run) => r.response?.statusCode as number | undefined;
const bodyOf = (r: Run) => { try { return JSON.parse(r.response?.body ?? 'null'); } catch { return r.response?.body; } };
const say = (r: Run) => `${statusOf(r)} ${JSON.stringify(bodyOf(r)).slice(0, 200)}${r.error ? ` threw ${r.error.name}: ${r.error.message.slice(0, 200)}` : ''}`;
const ok = (r: Run, code: number, label: string) => { expect(statusOf(r), `${label}: ${say(r)}`).toBe(code); return bodyOf(r); };
const bookBody = (o: Record<string, unknown> = {}) => {
  const b: Record<string, unknown> = { type: 'TECHNICAL', at: AT1, length_minutes: 75, where: 'IN_PERSON', place: SECRET.place, panel: [P.p1, P.p2], ...o };
  for (const k of Object.keys(b)) if (b[k] === undefined) delete b[k];
  return b;
};
const tokenOf = (m: any) => /\/score#token=([A-Za-z0-9_-]+)/.exec(String(m?.text ?? ''))?.[1];
const ROW_KEYS = ['type', 'tenant_id', 'email_id', 'template', 'interview_id', 'candidate_id', 'recipientEmail', 'subject', 'text', 'html', 'attachment'];
const TEMPLATES = ['E1', 'E2', 'E3', 'E4P', 'E4G', 'E4C', 'E5P', 'E5G', 'E5C', 'E6P', 'E6G'];
const uidOf = (m: any) => icsLines(fileOf(m)).find((l) => l.startsWith('UID:'));
const lineOf = (m: any, name: string) => icsLines(fileOf(m)).find((l) => l.startsWith(`${name}:`));
/** The mailto addresses a file lists as attendees. */
const attendees = (m: any) => icsLines(fileOf(m)).filter((l) => l.startsWith('ATTENDEE')).map((l) => l.slice(l.lastIndexOf('mailto:') + 7).toLowerCase()).sort();
/** Company A's label for an interview type, from A's active INTERVIEW_TYPES row. */
function labelOf(t: Tables, key: string): string {
  const row = rowsOf(t, TABLE.config).find((x) => x['tenant_id'] === A && x['configType'] === 'INTERVIEW_TYPES' && x['isActive'] === true);
  return ((row?.['data']?.types ?? []) as any[]).find((x) => x.key === key)?.label;
}

/** Checks a queued interview message's shape (rule 8) and its SQS input. */
function wellFormed(q: { body: any; input: any }, cand: string, label: string) {
  const m = q.body;
  const keys = Object.keys(m).sort();
  const want = [...ROW_KEYS, ...(['E3', 'E4C', 'E5C'].includes(m.template) ? ['reply_to'] : [])].sort();
  expect.soft(keys, `${label}: the message has exactly rule 8's keys (no recipientId)`).toEqual(want);
  expect.soft(m.type, `${label}: type`).toBe('INTERVIEW_EMAIL');
  expect.soft(TEMPLATES, `${label}: template is one of the eleven`).toContain(m.template);
  expect.soft(m.email_id, `${label}: email_id = {interviewId}#{sequence}#{template}#{who}`).toMatch(new RegExp(`^${m.interview_id}#\\d+#${m.template}#[A-Za-z0-9_-]+$`));
  expect.soft([q.input?.MessageDeduplicationId, q.input?.MessageGroupId], `${label}: dedup id = email_id, group = candidate`).toEqual([m.email_id, cand]);
  expect.soft([m.candidate_id, m.tenant_id], `${label}: candidate and company`).toEqual([cand, A]);
  expect.soft([m.attachment?.name, String(m.attachment?.content_type).startsWith('text/calendar')], `${label}: the attachment is INT-02's file`).toEqual(['interview.ics', true]);
  expect.soft(Object.keys(m.attachment ?? {}).sort(), `${label}: the attachment's keys`).toEqual(['content_base64', 'content_type', 'name']);
}

/** Checks a message's subject and text against the approved words, and its HTML against its text (AC-3). */
function words(m: any, template: string, v: Record<string, string | undefined>, label: string) {
  expect.soft(m?.template, `${label}: template`).toBe(template);
  const want = expected(template, v);
  expect.soft(m?.subject, `${label}: subject, exactly`).toBe(want.subject);
  expect.soft(String(m?.text ?? '').split('\n'), `${label}: text, line for line`).toEqual(want.text.split('\n'));
  expect.soft(htmlAsText(String(m?.html ?? '')), `${label}: the HTML holds the same words and no others`).toBe(String(m?.text ?? ''));
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  for (const k of ['link', 'video_link']) {
    const u = v[k];
    if (u && (k === 'link' || v['where'] === 'ONLINE') && want.text.includes(u)) expect.soft(String(m?.html ?? ''), `${label}: ${k} is a link in the HTML`).toContain(`<a href="${esc(u)}">${esc(u)}</a>`);
  }
}

// The values of company A's candidate `book` (and `two`).
const C = (t: Tables, o: Record<string, string | undefined> = {}) => ({
  candidate: `${CAND.first} ${CAND.last}`, first_name: CAND.first, role: CAND.role, company: COMPANY_A, type: labelOf(t, 'TECHNICAL'), zone: 'SAST', ...o,
});
const inPerson = (date: string, time: string, length: string, place = SECRET.place) => ({ date, time, length, where: 'IN_PERSON', place });
const online = (date: string, time: string, length: string, link = SECRET.link) => ({ date, time, length, where: 'ONLINE', video_link: link });

/** A raw interview row (new way) of company A, written straight into the table, and its link row when a raw guest token is given. */
function seedIv(t: Tables, o: { cand?: string; id: string; at?: string; panel?: string[]; guest?: string; guestEmail?: string; extra?: Record<string, any>; type?: string; sequence?: number | null; company?: string }): Tables {
  const cand = o.cand ?? K4.two;
  const company = o.company ?? A;
  const at = o.at ?? AT1;
  const panel = o.panel ?? [P.p1, P.p2];
  const row: Record<string, any> = {
    PK: `CANDIDATE#${cand}`, SK: `INTERVIEW#${o.id}`, interviewId: o.id, candidateId: cand, tenant_id: company, tenantId: company, interviewType: o.type ?? 'TECHNICAL',
    scheduledAt: at, panelMemberIds: panel, votesRequired: panel.length, votesSubmitted: 0, status: 'SCHEDULED', createdAt: H(-48),
    criteria_snapshot: [{ key: 'technical', label: 'Technical' }], PANEL_FEEDBACK_PENDING_COUNT: panel.length,
  };
  if (o.sequence !== null) Object.assign(row, { sequence: o.sequence ?? 1, length_minutes: 60, where: 'IN_PERSON', place: SECRET.place, booked_by: SUB.recA, booked_at: H(-48) });
  if (o.guest) row['guest_link_hash'] = sha(o.guest);
  const rows = [av({ ...row, ...(o.extra ?? {}) })];
  if (o.guest) {
    const h = sha(o.guest);
    rows.push(av({ PK: `SCORING_LINK#${h}`, SK: 'META', token_hash: h, interview_id: o.id, candidate_id: cand, guest_email: o.guestEmail ?? SECRET.guest, expires_at: plus7(at), used_at: null, tenant_id: company, created_by: SUB.recA, created_at: H(-48), ttl: Math.floor(Date.parse(plus7(at)) / 1000) }));
  }
  return withRows(t, rows);
}
const G = (n: number) => `int04guest${String(n).padStart(4, '0')}`.padEnd(43, 'Qz7w');
const RES = (o: Record<string, unknown>) => ({ action: 'reschedule', ...o });

/** Every place a raw token may never be: message fields other than an E2/E4G text and html, files, logs, events, stored rows. */
function tokenPlaces(r: Run) {
  const msgs = emailsOf(r);
  const outside = msgs.map((m) => ({ ...m, ...(['E2', 'E4G'].includes(m.template) ? { text: '', html: '' } : {}) }));
  return { outside: JSON.stringify(outside), files: msgs.map(fileOf).join('\n'), logs: logsOf(r).join('\n'), bus: JSON.stringify(r.calls.filter((c: any) => c.service === 'events')), rows: JSON.stringify(r.tables[TABLE.state]) };
}

test.describe('INT-04 Interview emails with the calendar invite (NH-277)', () => {
  // ---------------------------------------------------------------- AC-1

  test('AC-1 Booking queues one email per person: E1 to each panel member, E2 to the guest, E3 to the candidate when candidate emails are on; nothing when the switch is off; never the old INTERVIEW_SCHEDULED message', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = withPanel(world(), { candidate_interview_emails: 'ON' });
    const r = book(W.recruiter, K4.book, bookBody({ guest_email: SECRET.guest, candidate_note: SECRET.note }), t);
    const b = ok(r, 201, 'the booking');
    const all = bodies(r);
    expect.soft(all.filter((m) => m?.type === 'INTERVIEW_SCHEDULED').length, 'the old INTERVIEW_SCHEDULED panel message is no longer queued').toBe(0);
    const ms = emailsOf(r);
    expect.soft(ms.map((m) => `${m.template} ${m.recipientEmail}`).sort(), 'exactly four messages: E1 to p1 and p2, E2 to the guest, E3 to the candidate').toEqual(
      [`E1 ${PEOPLE.p1.email}`, `E1 ${PEOPLE.p2.email}`, `E2 ${SECRET.guest}`, `E3 ${CAND.email}`].sort());
    expect.soft(all.length, 'and nothing else is queued').toBe(4);
    for (const q of queued(r)) wellFormed(q, K4.book, q.body?.template);
    const seqs = ms.map((m) => [lineOf(m, 'METHOD'), lineOf(m, 'SEQUENCE')].join(' '));
    expect.soft([...new Set(seqs)], 'every file is METHOD:REQUEST at SEQUENCE:1').toEqual(['METHOD:REQUEST SEQUENCE:1']);
    expect.soft(new Set(ms.map(uidOf)).size, 'one shared UID').toBe(1);
    expect.soft(ms.map((m) => m.email_id).sort(), 'email ids').toEqual([`${b?.interview_id}#1#E1#${P.p1}`, `${b?.interview_id}#1#E1#${P.p2}`, `${b?.interview_id}#1#E2#GUEST`, `${b?.interview_id}#1#E3#CANDIDATE`].sort());
    const e1 = byTemplate(r, 'E1')[0];
    expect.soft(attendees(e1), 'the panel file (PANEL audience) lists the two panel members').toEqual([PEOPLE.p1.email, PEOPLE.p2.email].sort());
    expect.soft(attendees(byTemplate(r, 'E2')[0]), 'the guest file (GUEST audience) lists only the guest').toEqual([SECRET.guest]);
    expect.soft(attendees(byTemplate(r, 'E3')[0]), 'the candidate file (CANDIDATE audience) lists only the candidate').toEqual([CAND.email]);
    expect.soft(mailLogs(r).length, 'one interview_emails log line').toBe(1);
    expect.soft(mailLogs(r)[0]?.queued, 'it counts four queued').toBe(4);
    // T-8: the line holds no interview id (locked INT-01.F AC-5 and AC-8 forbid the booking's id in any scheduleInterview log line).
    expect.soft(logsOf(r).filter((l) => l.includes(String(b?.interview_id))), 'no log line of the booking holds its interview id (T-8)').toEqual([]);

    // Candidate emails off (missing, or OFF): the panel and guest messages only, and the log says so.
    for (const v of [undefined, 'OFF']) {
      const off = book(W.recruiter, K4.book, bookBody({ guest_email: SECRET.guest, candidate_note: SECRET.note }), withPanel(world(), { candidate_interview_emails: v }));
      ok(off, 201, `candidate emails ${v ?? 'missing'}`);
      expect.soft(emailsOf(off).map((m) => m.template).sort(), `candidate emails ${v ?? 'missing'}: E1, E1, E2 only`).toEqual(['E1', 'E1', 'E2']);
      expect.soft(skips(off)['CANDIDATE_EMAILS_OFF'], `candidate emails ${v ?? 'missing'}: logged CANDIDATE_EMAILS_OFF`).toBe(1);
      expect.soft(bodies(off).length, `candidate emails ${v ?? 'missing'}: nothing else queued`).toBe(3);
    }
    // The switch off: nothing at all (the booking itself has no guest, which the switch would refuse).
    for (const v of ['OFF', undefined]) {
      const off = book(W.recruiter, K4.book, bookBody(), withPanel(world(), { interview_emails: v, candidate_interview_emails: 'ON' }));
      ok(off, 201, `interview_emails ${v ?? 'missing'}`);
      expect.soft(bodies(off), `interview_emails ${v ?? 'missing'}: nothing queued`).toEqual([]);
      expect.soft(skips(off), `interview_emails ${v ?? 'missing'}: logged EMAILS_OFF`).toEqual({ EMAILS_OFF: 1 });
    }
  });

  // ---------------------------------------------------------------- AC-2

  test('AC-2 Who sees what: the candidate never sees panel addresses, surnames, the type, a reason or the link; the panel never sees the guest or candidate address or the link; the guest\'s file holds no link', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = withPanel(world(), { candidate_interview_emails: 'ON' });
    const r = book(W.recruiter, K4.book, bookBody({ panel: [P.p1, P.p3], guest_email: SECRET.guest, candidate_note: SECRET.note }), t);
    ok(r, 201, 'the booking');
    const raw = tokenOf(byTemplate(r, 'E2')[0]);
    expect(raw, 'the guest\'s E2 holds the link').toBeTruthy();
    const typeLabel = labelOf(t, 'TECHNICAL');
    const all = (m: any) => [m.subject, m.text, m.html, fileOf(m)].join('\n');
    const cand = byTemplate(r, 'E3')[0];
    expect.soft(!!cand, 'E3 is there').toBe(true);
    // Company A is "Mokoena Bakeries", which E3 names; the surname check reads the email with the company name taken out.
    const candAll = all(cand).split(COMPANY_A).join('');
    for (const x of [PEOPLE.p1.email, PEOPLE.p3.email, PEOPLE.p1.last, PEOPLE.p3.last, typeLabel, raw!, '/score', SECRET.guest]) expect.soft(candAll.includes(x), `the candidate's subject, text, HTML and file do not hold "${x.slice(0, 12)}"`).toBe(false);
    for (const m of byTemplate(r, 'E1')) {
      for (const x of [SECRET.guest, CAND.email, raw!, '/score']) expect.soft(all(m).includes(x), `${m.recipientEmail}'s E1 does not hold "${x.slice(0, 12)}"`).toBe(false);
      expect.soft(attendees(m), 'the panel file lists every panel member, never the candidate or the guest').toEqual([PEOPLE.p1.email, PEOPLE.p3.email].sort());
    }
    const g = byTemplate(r, 'E2')[0];
    expect.soft(fileOf(g).includes(raw!) || fileOf(g).includes('/score'), 'the guest\'s file holds no scoring link').toBe(false);
    expect.soft([String(g?.text).includes(raw!), String(g?.html).includes(raw!)], 'only the guest\'s text and HTML hold it').toEqual([true, true]);
    expect.soft(String(g?.subject).includes(raw!), 'not the guest\'s subject').toBe(false);

    // Reschedule and cancel: the candidate never sees a reason; nobody but the guest sees the link.
    const rs = act(W.recruiter, K4.book, String(bodyOf(r)?.interview_id), RES({ at: AT2, reason_note: SECRET.reason }), r.tables);
    ok(rs, 200, 'the reschedule');
    const e4c = byTemplate(rs, 'E4C')[0];
    expect.soft(!!e4c, 'E4C is there').toBe(true);
    for (const x of [SECRET.reason, typeLabel, PEOPLE.p1.email, PEOPLE.p3.last, '/score', SECRET.guest]) expect.soft(all(e4c ?? {}).includes(x), `the candidate's E4 does not hold "${x.slice(0, 12)}"`).toBe(false);
    const newRaw = tokenOf(byTemplate(rs, 'E4G')[0]);
    for (const m of emailsOf(rs).filter((x) => x.template !== 'E4G')) expect.soft(!!newRaw && JSON.stringify(m).includes(newRaw), `${m.template}: no scoring link`).toBe(false);
    const cn = act(W.recruiter, K4.book, String(bodyOf(r)?.interview_id), { action: 'cancel', reason: 'OTHER', reason_note: SECRET.other }, rs.tables);
    ok(cn, 200, 'the cancel');
    const e5c = byTemplate(cn, 'E5C')[0];
    expect.soft(!!e5c, 'E5C is there').toBe(true);
    for (const x of [SECRET.other, 'Other', typeLabel, PEOPLE.p1.email, '/score']) expect.soft(all(e5c ?? {}).includes(x), `the candidate's E5 does not hold "${x}"`).toBe(false);
  });

  // ---------------------------------------------------------------- AC-3

  test('AC-3 Iggie\'s words, exactly: every template, line for line, in person and online, with and without a note, reason and panel change, "Hi." with no first name, the what-changed lines in order; the HTML holds the same words', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(180_000);
    const t = withPanel(world(), { candidate_interview_emails: 'ON' });
    const typeLabel = labelOf(t, 'TECHNICAL');
    expect(typeLabel, 'company A has a label for TECHNICAL').toBeTruthy();

    // Booking, in person, with a note: p1 (Thandi), p2 (Sizwe), a guest (no name: "Hi."), the candidate.
    const r = book(W.recruiter, K4.book, bookBody({ guest_email: SECRET.guest, candidate_note: SECRET.note }), t);
    const iv = String(ok(r, 201, 'the booking')?.interview_id);
    const v1 = { ...C(t), ...inPerson('3 Dec 2026', '09:30', '1 hour 15 minutes') };
    words(byTemplate(r, 'E1').find((m) => m.recipientEmail === PEOPLE.p1.email), 'E1', { ...v1, recipient_first_name: 'Thandi', link: `${FRONT}/hire/feedback/${iv}` }, 'E1 to p1');
    words(byTemplate(r, 'E1').find((m) => m.recipientEmail === PEOPLE.p2.email), 'E1', { ...v1, recipient_first_name: 'Sizwe', link: `${FRONT}/hire/feedback/${iv}` }, 'E1 to p2');
    const raw1 = tokenOf(byTemplate(r, 'E2')[0]) ?? 'missing';
    words(byTemplate(r, 'E2')[0], 'E2', { ...v1, recipient_first_name: '', link: `${FRONT}/score#token=${raw1}`, expires: '10 Dec 2026 at 09:30 (SAST)' }, 'E2 to the guest (Hi.)');
    words(byTemplate(r, 'E3')[0], 'E3', { ...v1, panel_first_names: 'Thandi and Sizwe', note: SECRET.note }, 'E3 with a note');

    // Booking, online, no note, late at night (the day changes in Johannesburg), three named people and p3 with no given name.
    const r2 = book(W.recruiter, K4.two, bookBody({ where: 'ONLINE', place: undefined, video_link: SECRET.link, at: AT_LATE, length_minutes: 30, panel: [P.p3, P.p1, P.p2, MANY[0]!] }), withPanel(t, { panelSize: { JUNIOR: 4, MID: 4, SENIOR: 4 } }));
    const iv2 = String(ok(r2, 201, 'the online booking')?.interview_id);
    const v2 = { ...C(t), ...online('5 Dec 2026', '00:30', '30 minutes') };
    words(byTemplate(r2, 'E1').find((m) => m.recipientEmail === PEOPLE.p3.email), 'E1', { ...v2, recipient_first_name: '', link: `${FRONT}/hire/feedback/${iv2}` }, 'E1 to p3 (no given name: "Hi.")');
    words(byTemplate(r2, 'E3')[0], 'E3', { ...v2, panel_first_names: 'Thandi, Sizwe and Many' }, 'E3 online, no note, three first names');

    // Reschedule 1: time and place change, panel p2 out and p3 in, guest kept, no reason.
    const rs = act(W.recruiter, K4.book, iv, RES({ at: AT2, place: SECRET.place2, panel: [P.p1, P.p3] }), r.tables);
    ok(rs, 200, 'reschedule 1');
    const v3 = { ...C(t), ...inPerson('10 Dec 2026', '14:15', '1 hour 15 minutes', SECRET.place2) };
    const what = 'The date or time has changed. The place has changed. The panel has changed.';
    words(byTemplate(rs, 'E4P')[0], 'E4P', { ...v3, recipient_first_name: 'Thandi', what_changed: what }, 'E4P to p1, no reason');
    words(byTemplate(rs, 'E1')[0], 'E1', { ...v3, recipient_first_name: '', link: `${FRONT}/hire/feedback/${iv}` }, 'E1 to p3, added');
    words(byTemplate(rs, 'E6P')[0], 'E6P', { ...C(t), recipient_first_name: 'Sizwe', date: '3 Dec 2026' }, 'E6P to p2, removed');
    const raw2 = tokenOf(byTemplate(rs, 'E4G')[0]) ?? 'missing';
    words(byTemplate(rs, 'E4G')[0], 'E4G', { ...v3, recipient_first_name: '', what_changed: what, link: `${FRONT}/score#token=${raw2}`, expires: '17 Dec 2026 at 14:15 (SAST)' }, 'E4G, the kept guest');
    words(byTemplate(rs, 'E4C')[0], 'E4C', { ...v3, what_changed: 'The date or time has changed. The place has changed.', panel_first_names: 'Thandi' }, 'E4C with "You will meet"');

    // Reschedule 2: length and where (to online) change, with a reason, and the guest replaced: E4P with a reason, E6G, E2, E4C without a panel line.
    const rs2 = act(W.recruiter, K4.book, iv, RES({ length_minutes: 45, where: 'ONLINE', video_link: SECRET.link2, guest_email: SECRET.guest2, reason_note: SECRET.reason }), rs.tables);
    ok(rs2, 200, 'reschedule 2');
    const v4 = { ...C(t), ...online('10 Dec 2026', '14:15', '45 minutes', SECRET.link2) };
    words(byTemplate(rs2, 'E4P')[0], 'E4P', { ...v4, recipient_first_name: 'Thandi', what_changed: 'The length has changed. It is now online. The panel has changed.', reason: SECRET.reason }, 'E4P with a reason, now online');
    words(byTemplate(rs2, 'E6G')[0], 'E6G', { ...C(t), recipient_first_name: '', date: '10 Dec 2026' }, 'E6G to the replaced guest');
    const raw3 = tokenOf(byTemplate(rs2, 'E2')[0]) ?? 'missing';
    words(byTemplate(rs2, 'E2')[0], 'E2', { ...v4, recipient_first_name: '', link: `${FRONT}/score#token=${raw3}`, expires: '17 Dec 2026 at 14:15 (SAST)' }, 'E2 to the new guest');
    words(byTemplate(rs2, 'E4C')[0], 'E4C', { ...v4, what_changed: 'The length has changed. It is now online.' }, 'E4C, no panel change, no reason');

    // Reschedule 3: back in person, only the panel changes: the candidate's first line ends at "has changed." with no space.
    const rs3 = act(W.recruiter, K4.book, iv, RES({ panel: [P.p3, P.p1] }), rs2.tables);
    ok(rs3, 200, 'reschedule 3');
    words(byTemplate(rs3, 'E4C')[0], 'E4C', { ...v4, what_changed: '', panel_first_names: 'Thandi' }, 'E4C when only the panel changed');
    expect.soft(String(byTemplate(rs3, 'E4C')[0]?.text).split('\n')[2], 'its first line, exactly').toBe(`Your interview for ${CAND.role} at ${COMPANY_A} has changed.`);
    words(byTemplate(rs3, 'E4P').find((m) => m.recipientEmail === PEOPLE.p1.email), 'E4P', { ...v4, recipient_first_name: 'Thandi', what_changed: 'The panel has changed.' }, 'E4P, only the panel');
    const rs4 = act(W.recruiter, K4.book, iv, RES({ where: 'IN_PERSON', place: SECRET.place }), rs3.tables);
    ok(rs4, 200, 'reschedule 4');
    words(byTemplate(rs4, 'E4P').find((m) => m.recipientEmail === PEOPLE.p1.email), 'E4P', { ...C(t), ...inPerson('10 Dec 2026', '14:15', '45 minutes'), recipient_first_name: 'Thandi', what_changed: 'It is now in person.' }, 'E4P, now in person (no place line)');

    // Cancel with a listed reason, then (another interview) with OTHER: the label or the note to the panel and guest, nothing to the candidate.
    const cn = act(W.recruiter, K4.book, iv, { action: 'cancel', reason: 'PANEL_NOT_AVAILABLE', reason_note: 'zz-int04-extra-note' }, rs4.tables);
    ok(cn, 200, 'the cancel');
    const v5 = { ...C(t), date: '10 Dec 2026', time: '14:15' };
    words(byTemplate(cn, 'E5P').find((m) => m.recipientEmail === PEOPLE.p1.email), 'E5P', { ...v5, recipient_first_name: 'Thandi', reason: 'Panel not available' }, 'E5P with the label');
    words(byTemplate(cn, 'E5G')[0], 'E5G', { ...v5, recipient_first_name: '', reason: 'Panel not available' }, 'E5G with the label');
    words(byTemplate(cn, 'E5C')[0], 'E5C', v5, 'E5C, no reason');
    const other = act(W.recruiter, K4.two, iv2, { action: 'cancel', reason: 'OTHER', reason_note: SECRET.other }, r2.tables);
    ok(other, 200, 'the cancel with OTHER');
    words(byTemplate(other, 'E5P').find((m) => m.recipientEmail === PEOPLE.p1.email), 'E5P', { ...C(t), date: '5 Dec 2026', time: '00:30', recipient_first_name: 'Thandi', reason: SECRET.other }, 'E5P with the OTHER note');
    const asked = act(W.recruiter, K4.two, 'iv-int04-asked', { action: 'cancel', reason: 'CANDIDATE_ASKED' }, seedIv(t, { id: 'iv-int04-asked', guest: G(9) }));
    ok(asked, 200, 'the cancel, candidate asked');
    words(byTemplate(asked, 'E5G')[0], 'E5G', { ...C(t), date: '3 Dec 2026', time: '09:30', recipient_first_name: '', reason: 'Candidate asked' }, 'E5G, "Candidate asked"');
    const withdrew = act(W.recruiter, K4.two, 'iv-int04-asked', { action: 'cancel', reason: 'CANDIDATE_WITHDREW' }, seedIv(t, { id: 'iv-int04-asked' }));
    words(byTemplate(withdrew, 'E5P').find((m) => m.recipientEmail === PEOPLE.p2.email), 'E5P', { ...C(t), date: '3 Dec 2026', time: '09:30', recipient_first_name: 'Sizwe', reason: 'Candidate withdrew' }, 'E5P, "Candidate withdrew"');
    // A type no list knows: its key with spaces, first letter capital.
    const odd = act(W.recruiter, K4.two, 'iv-int04-type', { action: 'cancel', reason: 'CANDIDATE_ASKED' }, seedIv(t, { id: 'iv-int04-type', type: 'GROUP_PANEL_TALK' }));
    ok(odd, 200, 'the cancel of an unknown type');
    words(byTemplate(odd, 'E5P').find((m) => m.recipientEmail === PEOPLE.p1.email), 'E5P', { ...C(t), type: 'Group panel talk', date: '3 Dec 2026', time: '09:30', recipient_first_name: 'Thandi', reason: 'Candidate asked' }, 'E5P, a type no list has');
    // Every template was seen.
    const seen = new Set([r, r2, rs, rs2, rs3, rs4, cn, other].flatMap((x) => emailsOf(x).map((m) => m.template)));
    expect.soft([...seen].sort(), 'all eleven templates were checked').toEqual([...TEMPLATES].sort());
  });

  test('AC-3 Text check: every string literal with a space next to a letter in the email files (and each one int01.mjs adds) is a piece of an approved line', async ({}, testInfo) => {
    once(testInfo.project.name);
    const files = ['lambda/shared/interview-emails.mjs', 'lambda/sendTalentFlowNotification/interview-email.js', 'lambda/scheduleInterview/int01.mjs'];
    const before = JSON.parse(readFileSync(join(__dirname, 'support', 'int-04', 'int01-ff432ee.json'), 'utf8')) as string[];
    for (const f of files) {
      const p = join(REPO, f);
      expect.soft(existsSync(p), `${f} exists`).toBe(true);
      if (!existsSync(p)) continue;
      let found = literalsOf(readFileSync(p, 'utf8'), f);
      if (f.endsWith('int01.mjs')) {
        const left = [...before];
        found = found.filter((x) => { const i = left.indexOf(x.text); if (i >= 0) { left.splice(i, 1); return false; } return true; });
      }
      const bad = found.filter((x) => !allowedPiece(x.text)).map((x) => `${f}:${x.line} ${JSON.stringify(x.text).slice(0, 120)}`);
      expect.soft(bad, `${f}: literals that are not on the allow-list`).toEqual([]);
    }
    // The allow-list check itself: an added word is refused, an approved line and its pieces pass.
    expect.soft([allowedPiece('Hi {recipient_first_name}.'), allowedPiece('You are on the panel for a '), allowedPiece('Hello there.'), allowedPiece('Kind regards'), allowedPiece('Naleko People team')],
      'the check passes approved pieces and refuses new words').toEqual([true, true, false, false, false]);
  });

  // ---------------------------------------------------------------- AC-4

  test('AC-4 Reschedule: E4P to the kept member, E1 to the added one, E6P with a CANCEL file to the removed one, E4G with a fresh #token link to the kept guest, E4C with "You will meet"; same UID, SEQUENCE:2; the old link stops', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = withPanel(world(), { candidate_interview_emails: 'ON' });
    const r = book(W.recruiter, K4.book, bookBody({ guest_email: SECRET.guest, panel: [P.p1, P.p2] }), t);
    const iv = String(ok(r, 201, 'the booking')?.interview_id);
    const old = tokenOf(byTemplate(r, 'E2')[0]);
    expect(old, 'the booking\'s E2 holds a link').toBeTruthy();
    expect(old!.length >= 43 && sha(old!) === ivRow(r.tables, K4.book, iv)?.['guest_link_hash'], 'the E2 token is the stored link\'s (sha256 of it is guest_link_hash)').toBe(true);
    expect(statusOf(guestRead(old!, r.tables)), 'it opens').toBe(200);

    const rs = act(W.recruiter, K4.book, iv, RES({ at: AT2, place: SECRET.place2, panel: [P.p1, P.p3] }), r.tables);
    ok(rs, 200, 'the reschedule');
    const ms = emailsOf(rs);
    expect.soft(ms.map((m) => `${m.template} ${m.recipientEmail}`).sort(), 'E4P to p1, E1 to p3, E6P to p2, E4G to the guest, E4C to the candidate').toEqual(
      [`E4P ${PEOPLE.p1.email}`, `E1 ${PEOPLE.p3.email}`, `E6P ${PEOPLE.p2.email}`, `E4G ${SECRET.guest}`, `E4C ${CAND.email}`].sort());
    for (const q of queued(rs)) wellFormed(q, K4.book, `reschedule ${q.body?.template}`);
    expect.soft(String(byTemplate(rs, 'E4P')[0]?.text).split('\n')[2], 'E4P: what changed, in order').toContain('has changed. The date or time has changed. The place has changed. The panel has changed.');
    expect.soft(new Set([...ms, ...emailsOf(r)].map(uidOf)).size, 'every file has the booking\'s UID').toBe(1);
    expect.soft([...new Set(ms.map((m) => lineOf(m, 'SEQUENCE')))], 'every file is SEQUENCE:2').toEqual(['SEQUENCE:2']);
    const e6 = byTemplate(rs, 'E6P')[0];
    expect.soft(lineOf(e6, 'METHOD'), 'E6P: a CANCEL file').toBe('METHOD:CANCEL');
    expect.soft(attendees(e6), 'holding only the removed member').toEqual([PEOPLE.p2.email]);
    expect.soft(lineOf(e6, 'DTSTART'), 'at the time p2 was told (the old time)').toBe('DTSTART:20261203T073000Z');
    for (const m of ms.filter((x) => x.template !== 'E6P')) expect.soft(lineOf(m, 'METHOD'), `${m.template}: REQUEST`).toBe('METHOD:REQUEST');
    expect.soft(attendees(byTemplate(rs, 'E4P')[0]), 'the panel file lists the new panel').toEqual([PEOPLE.p1.email, PEOPLE.p3.email].sort());
    expect.soft(String(byTemplate(rs, 'E4C')[0]?.text), 'E4C names the new panel').toContain('You will meet Thandi.');
    expect.soft(String(byTemplate(rs, 'E4C')[0]?.text).includes('Reason'), 'E4C has no reason line').toBe(false);
    // AC-2 on the reschedule files (lock check round 1): the guest's file lists only the guest, the candidate's only the candidate.
    expect.soft(attendees(byTemplate(rs, 'E4G')[0]), 'the E4G file lists only the guest').toEqual([SECRET.guest]);
    expect.soft(attendees(byTemplate(rs, 'E4C')[0]), 'the E4C file lists only the candidate').toEqual([CAND.email]);
    // The kept guest: a fresh link in E4G, the old one stopped.
    const g = byTemplate(rs, 'E4G')[0];
    const fresh = tokenOf(g);
    expect.soft(String(g?.text), 'the new link has the form FRONTEND_URL/score#token=<raw>').toMatch(new RegExp(`(^|\\n)Give your feedback here: ${FRONT.replace(/\./g, '\\.')}/score#token=[A-Za-z0-9_-]{43,}\\n`));
    expect.soft(String(g?.text).includes('?token='), 'never the ?token= form').toBe(false);
    expect.soft(!!fresh && fresh !== old, 'a new token, not the old one').toBe(true);
    const row = ivRow(rs.tables, K4.book, iv);
    expect.soft(row?.['guest_link_hash'], 'the interview names the new link').toBe(fresh ? sha(fresh) : 'no token');
    expect.soft(row?.['removed_guest_link_hash'], 'a kept guest is not a removal (no removed_guest_link_hash)').toBeUndefined();
    const newLink = linkRows(rs.tables, K4.book).find((l) => fresh && l['token_hash'] === sha(fresh));
    expect.soft([newLink?.['expires_at'], newLink?.['guest_email']], 'the new link ends at the new start + 7 days, for the same address').toEqual([plus7(AT2), SECRET.guest]);
    expect.soft(String(g?.text), 'and {expires} says so').toContain('until 17 Dec 2026 at 14:15 (SAST).');
    expect.soft(linkRows(rs.tables, K4.book).find((l) => l['token_hash'] === sha(old!))?.['expires_at'], 'the old link stops now').toBe(NOW);
    expect.soft(statusOf(guestRead(old!, rs.tables)), 'the old link no longer opens').toBe(410);
    expect.soft(statusOf(guestRead(fresh ?? 'none', rs.tables)), 'the new one opens').toBe(200);

    // The guest replaced by another address: E6G (with "Your feedback link no longer works.") to the old, E2 to the new; no E4G.
    const rp = act(W.recruiter, K4.book, iv, RES({ guest_email: SECRET.guest2 }), rs.tables);
    ok(rp, 200, 'the guest replaced');
    expect.soft(emailsOf(rp).map((m) => `${m.template} ${m.recipientEmail}`).sort(), 'E6G to the old guest, E2 to the new, E4P to the panel, no candidate email').toEqual(
      [`E6G ${SECRET.guest}`, `E2 ${SECRET.guest2}`, `E4P ${PEOPLE.p1.email}`, `E4P ${PEOPLE.p3.email}`].sort());
    expect.soft(String(byTemplate(rp, 'E6G')[0]?.text), 'E6G says the link no longer works').toContain('\n\nYour feedback link no longer works.\n\n');
    expect.soft([lineOf(byTemplate(rp, 'E6G')[0], 'METHOD'), attendees(byTemplate(rp, 'E6G')[0])], 'E6G: a CANCEL file for the old guest only').toEqual(['METHOD:CANCEL', [SECRET.guest]]);
    const r2 = tokenOf(byTemplate(rp, 'E2')[0]);
    expect.soft(!!r2 && statusOf(guestRead(r2, rp.tables)) === 200, 'the new guest\'s E2 link opens').toBe(true);
    expect.soft(statusOf(guestRead(fresh ?? 'none', rp.tables)), 'the replaced guest\'s link stops').toBe(410);
    // A reschedule that only removes the guest: no candidate email.
    const rm = act(W.recruiter, K4.book, iv, RES({ guest_email: null }), rp.tables);
    ok(rm, 200, 'the guest removed');
    expect.soft(emailsOf(rm).filter((m) => m.template === 'E4C'), 'a change of guest only sends the candidate nothing').toEqual([]);

    // The switch off: the kept guest keeps the same link, moved (today's INT-01 rule), and nothing is queued.
    const offT = withPanel(seedIv(world(), { id: 'iv-int04-off', guest: G(1) }), { interview_emails: 'OFF' });
    const off = act(W.recruiter, K4.two, 'iv-int04-off', RES({ at: AT2 }), offT);
    ok(off, 200, 'the reschedule with the switch off');
    expect.soft(bodies(off), 'nothing queued').toEqual([]);
    expect.soft([linkRows(off.tables, K4.two).length, ivRow(off.tables, K4.two, 'iv-int04-off')?.['guest_link_hash'], linkRows(off.tables, K4.two)[0]?.['expires_at']], 'the same link, moved to the new start + 7 days').toEqual([1, sha(G(1)), plus7(AT2)]);
    expect.soft(statusOf(guestRead(G(1), off.tables)), 'and it still opens').toBe(200);
  });

  // ---------------------------------------------------------------- AC-5

  test('AC-5 Cancel sends E5P, E5G and E5C with CANCEL files at the raised sequence; the label or the OTHER note goes to the panel and guest only; did not happen, mark as done and done by itself queue nothing', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = withPanel(seedIv(world(), { id: 'iv-int04-cn', guest: G(2), sequence: 3 }), { candidate_interview_emails: 'ON' });
    const cn = act(W.recruiter, K4.two, 'iv-int04-cn', { action: 'cancel', reason: 'CANDIDATE_ASKED' }, t);
    ok(cn, 200, 'the cancel');
    const ms = emailsOf(cn);
    expect.soft(ms.map((m) => `${m.template} ${m.recipientEmail}`).sort(), 'E5P to p1 and p2, E5G to the guest, E5C to the candidate').toEqual(
      [`E5P ${PEOPLE.p1.email}`, `E5P ${PEOPLE.p2.email}`, `E5G ${SECRET.guest}`, `E5C ${CAND.email}`].sort());
    for (const q of queued(cn)) wellFormed(q, K4.two, `cancel ${q.body?.template}`);
    for (const m of ms) expect.soft([lineOf(m, 'METHOD'), lineOf(m, 'SEQUENCE'), lineOf(m, 'DTSTART')], `${m.template}: CANCEL at SEQUENCE:4, at the time they were told`).toEqual(['METHOD:CANCEL', 'SEQUENCE:4', 'DTSTART:20261203T073000Z']);
    // AC-2 on the cancel files (lock check round 1): each panel file lists the whole panel, the guest's and candidate's only them.
    for (const m of byTemplate(cn, 'E5P')) expect.soft(attendees(m), `${m.recipientEmail}'s E5P file lists both panel members`).toEqual([PEOPLE.p1.email, PEOPLE.p2.email].sort());
    expect.soft(attendees(byTemplate(cn, 'E5G')[0]), 'the E5G file lists only the guest').toEqual([SECRET.guest]);
    expect.soft(attendees(byTemplate(cn, 'E5C')[0]), 'the E5C file lists only the candidate').toEqual([CAND.email]);
    for (const m of ms.filter((x) => x.template !== 'E5C')) expect.soft(String(m.text), `${m.template}: the reason label`).toContain('\n\nReason: Candidate asked\n\n');
    expect.soft(String(byTemplate(cn, 'E5C')[0]?.text).includes('Reason') || String(byTemplate(cn, 'E5C')[0]?.text).includes('Candidate asked'), 'the candidate sees no reason').toBe(false);
    const other = act(W.recruiter, K4.two, 'iv-int04-cn', { action: 'cancel', reason: 'OTHER', reason_note: SECRET.other }, t);
    ok(other, 200, 'the cancel with OTHER');
    for (const m of emailsOf(other).filter((x) => x.template !== 'E5C')) expect.soft(String(m.text), `${m.template}: the OTHER note as the reason`).toContain(`\n\nReason: ${SECRET.other}\n\n`);
    for (const m of emailsOf(other).filter((x) => x.template === 'E5C')) expect.soft(String(m.text).includes(SECRET.other), 'not to the candidate').toBe(false);

    // Did not happen and mark as done (both after the start) and done by itself: nothing queued.
    const past = withPanel(seedIv(world(), { id: 'iv-int04-past', at: H(-3), guest: G(3) }), { candidate_interview_emails: 'ON' });
    const dnh = act(W.recruiter, K4.two, 'iv-int04-past', { action: 'did_not_happen', reason: 'CANDIDATE_DID_NOT_COME' }, past);
    ok(dnh, 200, 'did not happen');
    expect.soft(bodies(dnh), 'did not happen: nothing queued').toEqual([]);
    const done = act(W.recruiter, K4.two, 'iv-int04-past', { action: 'complete', reason: 'FEEDBACK_GIVEN_ANOTHER_WAY' }, past);
    ok(done, 200, 'mark as done');
    expect.soft(bodies(done), 'mark as done: nothing queued').toEqual([]);
    // Done by itself: the last panel vote completes the interview (shared/interview-scoring.mjs).
    const v1 = call4vote(W.p1, 'iv-int04-past', past);
    const v2 = call4vote(W.p2, 'iv-int04-past', v1.tables);
    const g = guestVote4(G(3), v2.tables);
    expect.soft([statusOf(v1), statusOf(v2), statusOf(g)], 'the three votes land').toEqual([201, 201, 200]);
    expect.soft(ivRow(g.tables, K4.two, 'iv-int04-past')?.['status'], 'the interview is done by itself').toBe('COMPLETED');
    expect.soft([...bodies(v1), ...bodies(v2), ...bodies(g)].filter((b) => b?.type === 'INTERVIEW_EMAIL'), 'done by itself: nothing queued').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-6

  test('AC-6 Once: a replay queues nothing more; the sender sends a message once (twice delivered, two copies in one batch, a copy after SENDING or SENT); 400/422 is FAILED and retried once; 500, 503, a timeout, a dropped connection or no MessageID leave SENDING and never send again', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    const key = `int04-replay-${process.pid}`;
    const r = book(W.recruiter, K4.book, bookBody({ guest_email: SECRET.guest }), t, { key });
    const b = ok(r, 201, 'the booking');
    const again = book(W.recruiter, K4.book, bookBody({ guest_email: SECRET.guest }), r.tables, { key });
    expect.soft([statusOf(again), bodyOf(again)], 'the replay gives the first answer').toEqual([201, b]);
    expect.soft(bodies(again), 'the replay queues nothing').toEqual([]);
    const rkey = `int04-replay-act-${process.pid}`;
    const rs = act(W.recruiter, K4.book, String(b?.interview_id), RES({ at: AT2 }), r.tables, { key: rkey });
    ok(rs, 200, 'a reschedule');
    const rs2 = act(W.recruiter, K4.book, String(b?.interview_id), RES({ at: AT2 }), rs.tables, { key: rkey });
    expect.soft([statusOf(rs2), bodies(rs2)], 'its replay: the same answer, nothing queued').toEqual([200, []]);

    const msg = byTemplate(r, 'E1')[0];
    const pk = `INTERVIEW_EMAIL#${msg?.email_id}`;
    const row = (x: Tables) => rowsOf(x, TABLE.notifications).find((y) => y['PK'] === pk);
    const failures = (x: Run) => ((x.response?.batchItemFailures ?? []) as any[]).map((f) => f.itemIdentifier);
    const outcomes = (x: Run) => logsOf(x).map((l) => /"outcome":"([A-Z_]+)"/.exec(l)?.[1]).filter(Boolean);
    // Delivered twice, one after the other.
    const s1 = send([msg], t);
    expect.soft([postmarkOf(s1).length, row(s1.tables)?.['status'], failures(s1)], 'first delivery: one Postmark call, row SENT, no failure').toEqual([1, 'SENT', []]);
    const s2 = send([msg], s1.tables);
    expect.soft([postmarkOf(s2).length, outcomes(s2)], 'second delivery: no call, ALREADY_SENT').toEqual([0, ['ALREADY_SENT']]);
    // Two copies in one batch.
    const both = send([msg, msg], t);
    expect.soft([postmarkOf(both).length, outcomes(both).sort()], 'two copies at once: one call, the other ALREADY_SENT').toEqual([1, ['ALREADY_SENT', 'SENT']]);
    // A copy while the row is SENDING (a send still running or lost).
    const sending = structuredClone(t);
    sending[TABLE.notifications] = [...(sending[TABLE.notifications] ?? []), av({ PK: pk, SK: 'EMAIL', status: 'SENDING', tenant_id: A, template: 'E1', claimed_at: NOW, expiresAt: 1 })];
    const s3 = send([msg], sending);
    expect.soft([postmarkOf(s3).length, outcomes(s3)], 'a copy after SENDING: no call').toEqual([0, ['ALREADY_SENT']]);

    // Postmark refused (400, 422): the row is FAILED and the record fails (retry); the next delivery sends once.
    for (const code of ['400', '422']) {
      const f = send([msg], t, { postmark: code });
      expect.soft([postmarkOf(f).length, row(f.tables)?.['status'], failures(f)], `${code}: one try, row FAILED, the record is retried`).toEqual([1, 'FAILED', ['int04-m-1']]);
      const next = send([msg], f.tables);
      expect.soft([postmarkOf(next).filter((c: any) => !c.failed).length, row(next.tables)?.['status']], `${code}, then the retry: sent once, SENT`).toEqual([1, 'SENT']);
      const third = send([msg], next.tables);
      expect.soft(postmarkOf(third).length, `${code}: a later copy sends nothing`).toBe(0);
    }
    // Unknown (500, 503, timeout, dropped, no MessageID): the row stays SENDING, no retry, and a later delivery sends nothing.
    for (const code of ['500', '503', 'timeout', 'dropped', 'nomessageid']) {
      const u = send([msg], t, { postmark: code });
      expect.soft([postmarkOf(u).length, row(u.tables)?.['status'], failures(u)], `${code}: one try, row stays SENDING, no retry`).toEqual([1, 'SENDING', []]);
      expect.soft(outcomes(u), `${code}: logged SEND_UNKNOWN`).toEqual(['SEND_UNKNOWN']);
      const later = send([msg], u.tables);
      expect.soft(postmarkOf(later).length, `${code}: a later delivery sends nothing`).toBe(0);
    }
    // The guard row holds only rule 10.3's fields.
    const g = row(s1.tables) ?? {};
    expect.soft(Object.keys(g).sort(), 'the guard row\'s fields').toEqual(['PK', 'SK', 'claimed_at', 'expiresAt', 'message_id', 'recipient', 'status', 'template', 'tenant_id'].sort());
    expect.soft([g['SK'], g['tenant_id'], g['template'], g['recipient']], 'its values').toEqual(['EMAIL', A, 'E1', 'TEST_ADDRESS']);
    expect.soft(Number(g['expiresAt']) - Math.floor(Date.parse(NOW) / 1000), 'it expires after 30 days').toBe(30 * 86400);
  });

  // ---------------------------------------------------------------- AC-7

  test('AC-7 Company B: B\'s Recruiter on A\'s interview gets 404 and nothing is queued; a panel id of B in A\'s row gets nothing and is in no file; B\'s own booking queues nothing; a person in A and B gets nothing from A', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = withPanel(seedIv(world(), { id: 'iv-int04-ab', guest: G(4) }), { candidate_interview_emails: 'ON' });
    // (a) B's Recruiter on A's candidate and interview.
    const a1 = book(W.recruiterB, K4.two, bookBody({ panel: [P.pB] }), t);
    expect.soft([statusOf(a1), bodies(a1)], 'B books on A\'s candidate: 404, nothing queued').toEqual([404, []]);
    for (const body of [RES({ at: AT2 }), { action: 'cancel', reason: 'CANDIDATE_ASKED' }]) {
      const a2 = act(W.recruiterB, K4.two, 'iv-int04-ab', body, t);
      expect.soft([statusOf(a2), bodies(a2)], `B's ${body.action} on A's interview: 404, nothing queued`).toEqual([404, []]);
    }
    // (b) A's interview whose panel holds B's person (written into the row directly): B's person gets nothing and is in no file.
    const tb = withPanel(seedIv(world(), { id: 'iv-int04-pb', panel: [P.p1, P.pB] }), { candidate_interview_emails: 'ON' });
    const cb = act(W.recruiter, K4.two, 'iv-int04-pb', { action: 'cancel', reason: 'CANDIDATE_ASKED' }, tb);
    ok(cb, 200, 'cancelling A\'s interview with B\'s person on it');
    expect.soft(emailsOf(cb).map((m) => `${m.template} ${m.recipientEmail}`).sort(), 'p1 and the candidate only').toEqual([`E5P ${PEOPLE.p1.email}`, `E5C ${CAND.email}`].sort());
    expect.soft(JSON.stringify(emailsOf(cb).map((m) => ({ ...m, file: fileOf(m) }))).includes('bheki'), 'B\'s person (bheki.b@bontle.test, Bheki) is in no message or file').toBe(false);
    expect.soft(skips(cb)['PERSON_NOT_FOUND'], 'logged PERSON_NOT_FOUND').toBe(1);
    // (c) B's own booking (B's switch off) queues nothing, though A's switch is ON.
    const bb = book(W.recruiterB, K4.bee, bookBody({ panel: [P.pB] }), t);
    ok(bb, 201, 'B books on its own candidate');
    expect.soft([bodies(bb), skips(bb)], 'B: nothing queued, EMAILS_OFF').toEqual([[], { EMAILS_OFF: 1 }]);
    // (d) A person with Member rows in A and B: companyOfSignIn gives no single company, so A's action never emails them.
    const td = seedIv(world(), { id: 'iv-int04-two', panel: [P.p1, P.two] });
    const cd = act(W.recruiter, K4.two, 'iv-int04-two', { action: 'cancel', reason: 'CANDIDATE_ASKED' }, td);
    ok(cd, 200, 'cancelling with the two-company person on the panel');
    expect.soft(emailsOf(cd).map((m) => m.recipientEmail), 'only p1').toEqual([PEOPLE.p1.email]);
    expect.soft(JSON.stringify(emailsOf(cd).map((m) => ({ ...m, file: fileOf(m) }))).includes('two@mokoena.test'), 'the two-company person is in no message or file').toBe(false);
  });

  // ---------------------------------------------------------------- AC-8

  test('AC-8 Nothing leaks: no log line holds an address, a name, a place, a link, a note, a reason, a subject, a body or the token; events keep their keys; no stored row holds the token; it is only in E2 and E4G text and HTML; guard rows hold no address or text; no in-app row', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(120_000);
    const t = withPanel(world(), { candidate_interview_emails: 'ON' });
    const runs: Run[] = [];
    const r = book(W.recruiter, K4.book, bookBody({ guest_email: SECRET.guest, candidate_note: SECRET.note, panel: [P.p1, P.p2] }), t);
    const iv = String(ok(r, 201, 'the booking')?.interview_id);
    runs.push(r);
    const rs = act(W.recruiter, K4.book, iv, RES({ at: AT2, where: 'ONLINE', video_link: SECRET.link, panel: [P.p1, P.p3], reason_note: SECRET.reason }), r.tables);
    ok(rs, 200, 'the reschedule');
    runs.push(rs);
    const rp = act(W.recruiter, K4.book, iv, RES({ guest_email: SECRET.guest2 }), rs.tables);
    ok(rp, 200, 'the guest replaced');
    runs.push(rp);
    const cn = act(W.recruiter, K4.book, iv, { action: 'cancel', reason: 'OTHER', reason_note: SECRET.other }, rp.tables);
    ok(cn, 200, 'the cancel');
    runs.push(cn);
    const msgs = runs.flatMap(emailsOf);
    const tokens = [...new Set(msgs.map(tokenOf).filter(Boolean))] as string[];
    expect(tokens.length, 'three guest links were made (E2, E4G, E2)').toBe(3);
    const sends = msgs.map((m) => send([m], cn.tables));
    const realSends = msgs.map((m) => send([m], cn.tables, { env: { INTERVIEW_EMAIL_MODE: 'REAL' } }));
    const allRuns = [...runs, ...sends, ...realSends];
    const logs = allRuns.flatMap(logsOf).join('\n');
    const never = [PEOPLE.p1.email, PEOPLE.p2.email, PEOPLE.p3.email, SECRET.guest, SECRET.guest2, CAND.email, BOOKER.email, ORGANISER, TEST_TO, OVERRIDE,
      'Thandi', 'Mokoena', 'Sizwe', 'Ndlovu', CAND.first, CAND.last, SECRET.place, SECRET.link, SECRET.note, SECRET.reason, SECRET.other, 'Naleko People',
      'interview with', 'Interview: ', 'Interview changed', 'Interview cancelled', 'no longer on the panel', '/score', '/hire/feedback', 'BEGIN:VCALENDAR', 'Candidate asked'];
    for (const x of never) expect.soft(logs.includes(x), `no log line holds "${x}"`).toBe(false);
    for (const tok of tokens) for (let i = 0; i + 12 <= tok.length; i += 4) expect.soft(logs.includes(tok.slice(i, i + 12)), 'no log line holds any 12-character piece of a raw token').toBe(false);
    // Events keep INT-01's exact keys.
    for (const x of runs) for (const e of x.calls.filter((c: any) => c.service === 'events')) {
      const entries = (e as any).input?.Entries ?? [];
      for (const en of entries) {
        const d = JSON.parse(en.Detail ?? '{}');
        expect.soft(Object.keys(d).filter((k) => !['actor', 'candidateId', 'interviewId', 'interviewType', 'sequence', 'tenant_id', 'reason_code'].includes(k)), `${en.DetailType}: no new key`).toEqual([]);
      }
    }
    // The raw token: never in a stored row, an event, a file, a log, or a message field but E2/E4G text and html.
    for (const x of runs) {
      const p = tokenPlaces(x);
      for (const [where, text] of Object.entries(p)) expect.soft(leakedTokens(text, cn.tables), `no raw token in ${where}`).toEqual([]);
    }
    for (const x of allRuns) expect.soft(leakedTokens(JSON.stringify(x.tables), cn.tables), 'no stored row of any table holds a raw token').toEqual([]);
    for (const m of msgs) {
      const has = tokens.some((tok) => JSON.stringify(m).includes(tok));
      expect.soft(has, `${m.template}: holds a raw token only when it is E2 or E4G`).toBe(['E2', 'E4G'].includes(m.template));
    }
    // Guard rows: no address, name or text; no in-app row for an interview email.
    const guards = [...sends, ...realSends].flatMap((x) => guardRows(x.tables));
    expect.soft(guards.length, 'every send wrote its guard row').toBeGreaterThan(0);
    const gtext = JSON.stringify(guards);
    for (const x of [...never.slice(0, 16), 'Hi ', 'Hi.', 'Fleet', COMPANY_A]) expect.soft(gtext.includes(x), `no guard row holds "${x}"`).toBe(false);
    for (const x of [...sends, ...realSends]) expect.soft(inAppRows(x.tables).length, 'no in-app notification row').toBe(inAppRows(cn.tables).length);
  });

  // ---------------------------------------------------------------- AC-9

  test('AC-9 Test address only, by default: TEST_ADDRESS sends to INTERVIEW_TEST_EMAIL only, even with MVP1_RECIPIENT_OVERRIDE; REAL sends to the person; a missing or wrong setting throws and sends nothing; Terraform defaults; no tracking, Cc, Bcc or headers; ReplyTo only on candidate emails', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = withPanel(world(), { candidate_interview_emails: 'ON' });
    const r = book(W.recruiter, K4.book, bookBody({ guest_email: SECRET.guest, candidate_note: SECRET.note }), t);
    ok(r, 201, 'the booking');
    const msgs = emailsOf(r);
    expect(msgs.length, 'four messages').toBe(4);
    // (a) TEST_ADDRESS.
    for (const m of msgs) {
      const s = send([m], t);
      const calls = postmarkOf(s);
      expect.soft(calls.map((c: any) => c.op), `${m.template}: one sendEmail (never the template send)`).toEqual(['sendEmail']);
      const pm = (calls[0] as any)?.message ?? {};
      expect.soft(pm.To, `${m.template}: To is the test address only`).toBe(TEST_TO);
      expect.soft(JSON.stringify(pm).includes(OVERRIDE), `${m.template}: MVP1_RECIPIENT_OVERRIDE is not used`).toBe(false);
      expect.soft(guardRows(s.tables)[0]?.['recipient'], `${m.template}: the guard row says TEST_ADDRESS`).toBe('TEST_ADDRESS');
      // (e) The send's fields.
      expect.soft([pm.From, pm.TrackLinks, pm.TrackOpens, pm.MessageStream], `${m.template}: From the sender, no link or open tracking`).toEqual([SENDER, 'None', false, 'outbound']);
      expect.soft(['Cc', 'Bcc', 'Headers'].filter((k) => k in pm), `${m.template}: no Cc, Bcc or Headers`).toEqual([]);
      expect.soft(pm.ReplyTo, `${m.template}: ReplyTo only on the candidate's email, the booker's address`).toBe(m.template === 'E3' ? BOOKER.email : undefined);
      expect.soft([pm.Subject, pm.TextBody, pm.HtmlBody], `${m.template}: the message's own subject, text and HTML`).toEqual([m.subject, m.text, m.html]);
      expect.soft(pm.Attachments, `${m.template}: the file`).toEqual([{ Name: 'interview.ics', Content: m.attachment.content_base64, ContentType: m.attachment.content_type }]);
    }
    // (b) REAL.
    for (const m of msgs) {
      const s = send([m], t, { env: { INTERVIEW_EMAIL_MODE: 'REAL' } });
      expect.soft([(postmarkOf(s)[0] as any)?.message?.To, guardRows(s.tables)[0]?.['recipient']], `${m.template} REAL: To is the person`).toEqual([m.recipientEmail, 'REAL']);
    }
    // (c) A missing or unknown mode, or a test address that is not a blackhole address: the record fails, nothing is sent or claimed.
    const bad: Record<string, string | undefined>[] = [
      { INTERVIEW_EMAIL_MODE: undefined }, { INTERVIEW_EMAIL_MODE: 'test_address' }, { INTERVIEW_EMAIL_MODE: '' }, { INTERVIEW_EMAIL_MODE: 'LIVE' },
      { INTERVIEW_TEST_EMAIL: undefined }, { INTERVIEW_TEST_EMAIL: 'someone@example.test' }, { INTERVIEW_TEST_EMAIL: 'interviews@blackhole.postmarkapp.com.evil.test' },
      { INTERVIEW_EMAIL_MODE: 'REAL', INTERVIEW_TEST_EMAIL: 'someone@example.test' },
    ];
    for (const env of bad) {
      const s = send([msgs[0]], t, { env });
      expect.soft([postmarkOf(s).length, guardRows(s.tables).length, ((s.response?.batchItemFailures ?? []) as any[]).length], `${JSON.stringify(env)}: nothing sent or claimed, the record fails`).toEqual([0, 0, 1]);
    }
    // (d) Terraform text.
    const tf = (f: string) => readFileSync(join(REPO, 'talent-flow-infra', f), 'utf8');
    const vars = tf('variables.tf');
    const block = /variable\s+"interview_email_mode"\s*\{[\s\S]*?\n\}/.exec(vars)?.[0] ?? '';
    expect.soft(/default\s*=\s*"TEST_ADDRESS"/.test(block), 'interview_email_mode defaults to "TEST_ADDRESS"').toBe(true);
    expect.soft(/validation\s*\{[\s\S]*TEST_ADDRESS[\s\S]*REAL/.test(block), 'and is validated to TEST_ADDRESS or REAL').toBe(true);
    expect.soft(/^\s*interview_email_mode\s*=\s*"TEST_ADDRESS"/m.test(tf(join('env', 'dev.tfvars'))), 'env/dev.tfvars sets "TEST_ADDRESS"').toBe(true);
    const tfvars = execFileSync('git', ['ls-files', '*.tfvars'], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean);
    for (const f of tfvars) expect.soft(/interview_email_mode\s*=\s*"REAL"/.test(readFileSync(join(REPO, f), 'utf8')), `${f} does not set "REAL"`).toBe(false);
    const lambdas = tf('talent-flow-lambdas.tf');
    const sender = /resource\s+"aws_lambda_function"\s+"send_notification"\s*\{[\s\S]*?\n\}/.exec(lambdas)?.[0] ?? '';
    expect.soft(/INTERVIEW_EMAIL_MODE\s*=\s*var\.interview_email_mode/.test(sender), 'the sender gets INTERVIEW_EMAIL_MODE = var.interview_email_mode').toBe(true);
    expect.soft(/INTERVIEW_TEST_EMAIL\s*=\s*"[^"@\s]+@blackhole\.postmarkapp\.com"/.test(sender), 'and a blackhole INTERVIEW_TEST_EMAIL').toBe(true);
    const producer = /resource\s+"aws_lambda_function"\s+"schedule_interview"\s*\{[\s\S]*?\n\}/.exec(lambdas)?.[0] ?? '';
    expect.soft(/FRONTEND_URL\s*=\s*var\.frontend_url/.test(producer), 'scheduleInterview gets FRONTEND_URL = var.frontend_url').toBe(true);
    expect.soft(/INTERVIEW_ORGANISER_EMAIL\s*=\s*\S+/.test(producer), 'and INTERVIEW_ORGANISER_EMAIL').toBe(true);
  });

  // ---------------------------------------------------------------- AC-10

  test('AC-10 The switch: validate takes interview_emails ON/OFF and candidate_interview_emails OFF only; the old INTERVIEW_SCHEDULED message still writes its in-app row and calls the template send as today', async ({}, testInfo) => {
    once(testInfo.project.name);
    const base = { panelSize: { JUNIOR: 2, MID: 3, SENIOR: 4 }, guestAllowed: true, hrMayEnterForMember: true };
    const cases: [Record<string, unknown>, boolean][] = [
      [{ ...base, interview_emails: 'ON' }, true], [{ ...base, interview_emails: 'OFF' }, true], [{ ...base, candidate_interview_emails: 'OFF' }, true],
      [{ ...base, interview_emails: 'ON', candidate_interview_emails: 'OFF' }, true], [base, true],
      [{ ...base, candidate_interview_emails: 'ON' }, false], [{ ...base, interview_emails: true }, false], [{ ...base, interview_emails: 'on' }, false],
      [{ ...base, interview_emails: 'YES' }, false], [{ ...base, interview_emails: null }, false], [{ ...base, candidate_interview_emails: false }, false],
      [{ ...base, interview_email_mode: 'REAL' }, false], [{ ...base, emails: 'ON' }, false],
    ];
    const run = runModule(cases.map(([d]) => ({ fn: 'validate', args: ['PANEL_CONFIG', d] })), { module: SETTINGS_HELPER });
    cases.forEach(([d, want], i) => expect.soft(run.results[i]?.value, `validate(PANEL_CONFIG, ${JSON.stringify(d).slice(60)})`).toBe(want));

    // The old path: an INTERVIEW_SCHEDULED message with recipientEmail writes the in-app row and calls the template send.
    const t = world();
    const old = { type: 'INTERVIEW_SCHEDULED', tenant_id: A, recipientId: SUB.hmA, recipientEmail: 'hm.a@example.test', candidateId: K4.book, scheduledAt: AT1, interviewId: 'iv-old', interviewType: 'TECHNICAL' };
    const s = send([old], t, { postmark: undefined });
    expect.soft(s.response?.batchItemFailures, `the old message goes through (${s.error?.message ?? ''})`).toEqual([]);
    expect.soft(inAppRows(s.tables).length - inAppRows(t).length, 'one in-app row').toBe(1);
    const pm = postmarkOf(s);
    expect.soft(pm.map((c: any) => c.op), 'one template send, no plain send').toEqual(['sendEmailWithTemplate']);
    expect.soft([(pm[0] as any)?.message?.To, (pm[0] as any)?.message?.TemplateAlias], 'to MVP1_RECIPIENT_OVERRIDE, the talent-flow-interview-scheduled template, as today').toEqual([OVERRIDE, 'talent-flow-interview-scheduled']);
    expect.soft(guardRows(s.tables), 'no interview guard row').toEqual([]);
    const missing = send([{ ...old, recipientEmail: undefined }], t);
    expect.soft([((missing.response?.batchItemFailures ?? []) as any[]).length, postmarkOf(missing).length], 'an old message with no recipientEmail still fails, as today').toEqual([1, 0]);
  });

  // ---------------------------------------------------------------- AC-11

  test('AC-11 Bad input never sends a broken email: each skip code, the answer and the rows unchanged; a kept guest keeps a working link when any pre-check fails; values with line breaks or markup stay on one line and are escaped', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(180_000);
    const t = withPanel(world(), { candidate_interview_emails: 'ON' });
    const answerOk = (r: Run, label: string) => { expect.soft([statusOf(r), Object.keys(bodyOf(r) ?? {}).sort()], `${label}: 201 with the booking's answer`).toEqual([201, ['interview_id', 'sequence', 'status']]); };
    // A guest address INT-01 accepts but INT-02 refuses.
    const odd = book(W.recruiter, K4.book, bookBody({ guest_email: 'zz.int04!guest@outside.test' }), t);
    answerOk(odd, 'a guest address INT-02 refuses');
    expect.soft(emailsOf(odd).map((m) => m.template).sort(), 'the panel and candidate still get theirs, the guest nothing').toEqual(['E1', 'E1', 'E3']);
    expect.soft((skips(odd)['PERSON_NOT_FOUND'] ?? 0) + (skips(odd)['INVITE_BAD_EMAIL'] ?? 0), 'logged PERSON_NOT_FOUND or INVITE_BAD_EMAIL (T-2)').toBe(1);
    expect.soft(linkRows(odd.tables, K4.book).length, 'the link row is still written (the booking as without INT-04)').toBe(1);
    // A panel member with no email in the pool.
    const nm = book(W.recruiter, K4.book, bookBody({ panel: [P.p1, X.noMail] }), t);
    answerOk(nm, 'a panel member with no email');
    expect.soft(emailsOf(nm).map((m) => `${m.template} ${m.recipientEmail}`).sort(), 'p1 and the candidate only').toEqual([`E1 ${PEOPLE.p1.email}`, `E3 ${CAND.email}`].sort());
    expect.soft(skips(nm)['PERSON_NOT_FOUND'], 'PERSON_NOT_FOUND').toBe(1);
    expect.soft(attendees(byTemplate(nm, 'E1')[0]), 'and left out of the panel file').toEqual([PEOPLE.p1.email]);
    // An old-way interview.
    const ow = act(W.recruiter, K4.two, 'iv-int04-old', { action: 'cancel', reason: 'CANDIDATE_ASKED' }, seedIv(t, { id: 'iv-int04-old', sequence: null }));
    expect.soft([statusOf(ow), bodies(ow), skips(ow)], 'an old-way interview: 200, nothing queued, OLD_INTERVIEW').toEqual([200, [], { OLD_INTERVIEW: 1 }]);
    // A missing setting.
    for (const k of ['FRONTEND_URL', 'INTERVIEW_ORGANISER_EMAIL']) {
      const ms = book(W.recruiter, K4.book, bookBody({ guest_email: SECRET.guest }), t, { env: { [k]: undefined } });
      answerOk(ms, `no ${k}`);
      expect.soft([bodies(ms), skips(ms)], `no ${k}: nothing queued, SETTING_MISSING`).toEqual([[], { SETTING_MISSING: 1 }]);
      expect.soft(linkRows(ms.tables, K4.book).length, `no ${k}: the booking and its link are stored as without INT-04`).toBe(1);
    }
    // A booker no longer in the company (no Member row, no legacy company).
    const nb = act(W.recruiter, K4.two, 'iv-int04-nb', { action: 'cancel', reason: 'CANDIDATE_ASKED' }, seedIv(t, { id: 'iv-int04-nb', extra: { booked_by: P.noRow } }));
    expect.soft([statusOf(nb), bodies(nb), skips(nb)], 'a booker who left: 200, nothing queued, NO_BOOKER').toEqual([200, [], { NO_BOOKER: 1 }]);
    // A candidate with no role, no last name, a blank first name.
    for (const [cand, code] of [[K4.noRole, 'NO_ROLE'], [K4.noName, 'NO_CANDIDATE_NAME'], [K4.noFirst, 'NO_CANDIDATE_NAME']] as const) {
      const r = book(W.recruiter, cand, bookBody({ guest_email: SECRET.guest }), t);
      answerOk(r, code);
      expect.soft([bodies(r), skips(r)], `${cand}: nothing queued, ${code}`).toEqual([[], { [code]: 1 }]);
    }
    // No company name: the panel emails still go; the guest and candidate emails do not.
    const nc = book(W.recruiter, K4.book, bookBody({ guest_email: SECRET.guest }), withCompanyName(t, undefined));
    answerOk(nc, 'no company name');
    expect.soft(emailsOf(nc).map((m) => m.template).sort(), 'no company name: E1 to the panel only').toEqual(['E1', 'E1']);
    expect.soft(skips(nc)['NO_COMPANY_NAME'], 'NO_COMPANY_NAME, for the guest and the candidate').toBe(2);

    // The kept guest (spec check F-4): any pre-check fails, the old link keeps working and moves, nothing new, the rows as with the switch off.
    const kept: [string, Tables, Record<string, string | undefined>, string][] = [
      ['no FRONTEND_URL', seedIv(t, { id: 'iv-int04-k', guest: G(5) }), { FRONTEND_URL: undefined }, 'SETTING_MISSING'],
      ['the booker gone', seedIv(t, { id: 'iv-int04-k', guest: G(5), extra: { booked_by: P.noRow } }), {}, 'NO_BOOKER'],
      ['a guest address INT-02 refuses', seedIv(t, { id: 'iv-int04-k', guest: G(5), guestEmail: 'zz.int04!kept@outside.test' }), {}, 'PERSON_NOT_FOUND|INVITE_BAD_EMAIL'],
      ['no company name', withCompanyName(seedIv(t, { id: 'iv-int04-k', guest: G(5) }), undefined), {}, 'NO_COMPANY_NAME'],
    ];
    for (const [label, tk, env, code] of kept) {
      const k = act(W.recruiter, K4.two, 'iv-int04-k', RES({ at: AT2 }), tk, { env });
      ok(k, 200, `kept guest, ${label}`);
      expect.soft(byTemplate(k, 'E4G'), `${label}: no E4G`).toEqual([]);
      expect.soft(linkRows(k.tables, K4.two).map((l) => [l['token_hash'], l['expires_at']]), `${label}: no new link; the old one moved to the new start + 7 days`).toEqual([[sha(G(5)), plus7(AT2)]]);
      expect.soft(statusOf(guestRead(G(5), k.tables)), `${label}: the old link still opens`).toBe(200);
      expect.soft(Object.keys(skips(k)).some((c) => new RegExp(`^(${code})$`).test(c)), `${label}: logged ${code} (got ${JSON.stringify(skips(k))})`).toBe(true);
      const offRun = act(W.recruiter, K4.two, 'iv-int04-k', RES({ at: AT2 }), withPanel(tk, { interview_emails: 'OFF' }), { env });
      const state = (x: Tables) => rowsOf(x, TABLE.state).filter((y) => String(y['PK']).includes(K4.two) || String(y['PK']).startsWith('SCORING_LINK#')).map((y) => JSON.stringify(y)).sort();
      expect.soft(state(k.tables), `${label}: the rows equal the same reschedule with the switch off`).toEqual(state(offRun.tables));
    }

    // Slow lookups (T-4): every AdminGetUser answers after 5 s; 20 panel members. The answer is 201 in time; at most 5 lookups at once;
    // everyone is queued or NOT_QUEUED.
    const panel20 = MANY.slice(0, 20);
    const slowT = withPanel(t, { panelSize: { JUNIOR: 20, MID: 20, SENIOR: 20 }, candidate_interview_emails: 'OFF' });
    const started = Date.now();
    const slow = book(W.recruiter, K4.book, bookBody({ panel: panel20 }), slowT, { slowMs: 5000 });
    const took = Date.now() - started;
    answerOk(slow, 'slow lookups');
    expect.soft(took, `slow lookups: the run took ${took} ms, inside the Lambda's 30 s with room (12 s budget + one lookup)`).toBeLessThan(24_000);
    const maxIn = (slow.calls.find((c: any) => c.service === 'int04' && c.op === 'pool-in-flight') as any)?.max;
    expect.soft(maxIn, 'at most 5 lookups at a time').toBeLessThanOrEqual(5);
    const sk = skips(slow);
    expect.soft(emailsOf(slow).length + (sk['NOT_QUEUED'] ?? 0), 'each of the 20 is queued or logged NOT_QUEUED').toBe(20);
    expect.soft(sk['NOT_QUEUED'] ?? 0, 'and with 5 s lookups some are NOT_QUEUED').toBeGreaterThan(0);
    expect.soft(ivRow(slow.tables, K4.book, String(bodyOf(slow)?.interview_id))?.['status'], 'the booking is stored').toBe('SCHEDULED');

    // Line breaks, control characters and markup in values: never a second subject line or a header; escaped in the HTML.
    const evil = 'zz-int04 Room 1\r\nBcc: zz.evil@int04.example\u0007 <b>&"\'';
    const inj = book(W.recruiter, K4.book, bookBody({ place: evil, candidate_note: 'zz-int04 note\nX-Header: 1 <i>', panel: [P.p1, X.odd], guest_email: SECRET.guest }), t);
    answerOk(inj, 'values with line breaks and markup');
    const im = emailsOf(inj);
    expect.soft(im.length, 'four messages').toBe(4);
    for (const m of im) {
      expect.soft(/[\r\n\u0000-\u001f\u007f]/.test(m.subject), `${m.template}: the subject is one line with no control character`).toBe(false);
      expect.soft(String(m.text).includes('\r') || /[\u0000-\u0009\u000b-\u001f\u007f]/.test(String(m.text)), `${m.template}: no CR or control character in the text`).toBe(false);
      expect.soft(String(m.text).split('\n').some((l) => /^(Bcc|X-Header):/.test(l)), `${m.template}: no value starts a line of its own`).toBe(false);
      expect.soft(String(m.html).includes('<b>') || String(m.html).includes('<i>'), `${m.template}: markup in values is escaped`).toBe(false);
      expect.soft(htmlAsText(m.html), `${m.template}: and the HTML still reads as the text`).toBe(m.text);
      const s = send([m], inj.tables);
      const pm = (postmarkOf(s)[0] as any)?.message ?? {};
      expect.soft(['Cc', 'Bcc', 'Headers'].filter((k) => k in pm), `${m.template}: the send has no Cc, Bcc or Headers`).toEqual([]);
    }
    const e1odd = byTemplate(inj, 'E1').find((m) => m.recipientEmail === 'odd.person@mokoena.test');
    expect.soft(String(e1odd?.text).split('\n')[0], 'a name with a line break stays on the greeting line').toBe('Hi Lin Bcc: zz.evil@int04.example <b>&".');
    expect.soft(String(e1odd?.html), 'escaped in the HTML').toContain('Hi Lin Bcc: zz.evil@int04.example &lt;b&gt;&amp;&quot;.');
    expect.soft(String(byTemplate(inj, 'E1')[0]?.text), 'the place is one line in the details').toContain('\nWhere: In person, zz-int04 Room 1 Bcc: zz.evil@int04.example <b>&"\'\n');
    expect.soft(String(byTemplate(inj, 'E1')[0]?.html), 'and escaped in the HTML').toContain('Where: In person, zz-int04 Room 1 Bcc: zz.evil@int04.example &lt;b&gt;&amp;&quot;&#39;</p>');
    expect.soft(ODD_NAME.includes('\r\n'), 'the odd name really holds a line break').toBe(true);
  });

  // ---------------------------------------------------------------- AC-12

  test('AC-12 seed: seed-dev.py turns company A\'s interview_emails ON in place and writes the INT-04 dev candidate under the ids in support/int-04/dev-ids.json, removing its interview rows and guard rows first', async ({}, testInfo) => {
    once(testInfo.project.name);
    const ids = JSON.parse(readFileSync(join(__dirname, 'support', 'int-04', 'dev-ids.json'), 'utf8')) as Record<string, string>;
    const seed = readFileSync(join(REPO, 'scripts', 'ci', 'seed-dev.py'), 'utf8');
    expect.soft(/def seed_int04\(/.test(seed) && /seed_int04\(\s*ddb\s*,/.test(seed), 'seed_int04 is defined and called from main()').toBe(true);
    const fn = /def seed_int04\([\s\S]*?(?=\ndef |\n# ----|$)/.exec(seed)?.[0] ?? '';
    const readsIds = /int-04["'\s/,]*dev-ids\.json/.test(fn);
    expect.soft(readsIds || fn.includes(ids['candidate']!), 'it writes the INT-04 dev candidate').toBe(true);
    expect.soft(/interview_emails/.test(fn) && /['"]ON['"]/.test(fn), 'it sets interview_emails ON').toBe(true);
    expect.soft(/candidate_interview_emails/.test(fn), 'and never sets candidate_interview_emails').toBe(false);
    expect.soft(/INTERVIEW_EMAIL#/.test(fn), 'it removes the candidate\'s guard rows first').toBe(true);
    expect.soft(/REAL/.test(fn), 'it never names REAL').toBe(false);
  });

  test('AC-12 on pepla-dev: HR books with two panel logins and a guest, reschedules, cancels; within 90 s the notifications table holds a SENT TEST_ADDRESS guard row for E1 x2 and E2, E4P x2 and E4G, E5P x2 and E5G, and none for the candidate @pepla-dev', async ({ page }, testInfo) => {
    test.skip(!ON_DEV, 'pepla-dev only: the no-backend run covers this in AC-1 to AC-11.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width.');
    test.setTimeout(8 * 60_000);
    const ids = JSON.parse(readFileSync(join(__dirname, 'support', 'int-04', 'dev-ids.json'), 'utf8')) as Record<string, string>;
    const env = (k: string) => process.env[k] ?? '';
    expect(env('E2E_HR_EMAIL') && env('E2E_HR_PASSWORD'), 'the E2E_HR test login is set').toBeTruthy();
    const { devEnv } = await import('./support/ten-02/dev');
    const { region, clientId } = devEnv();
    const appEnv = readFileSync(join(REPO, 'pepla-web', 'src', 'environments', 'environment.ts'), 'utf8');
    const tfApi = (/talentFlowApiUrl\s*:\s*['"`]([^'"`]+)['"`]/.exec(appEnv)?.[1] ?? '').replace(/\/+$/, '').replace(/\/v1$/, '');
    expect(tfApi, 'pepla-web\'s talentFlowApiUrl points at pepla-dev\'s TalentFlow API').toMatch(/^https:\/\/[^/]+\.execute-api\./);
    const auth = await page.request.post(`https://cognito-idp.${region}.amazonaws.com/`, {
      headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
      data: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: clientId, AuthParameters: { USERNAME: env('E2E_HR_EMAIL'), PASSWORD: env('E2E_HR_PASSWORD') } }),
    });
    expect(auth.status(), 'HR signs in at Cognito').toBe(200);
    const token = ((await auth.json()) as any).AuthenticationResult.IdToken as string;
    const api = async (method: string, path: string, body?: unknown) => {
      const r = await page.request.fetch(`${tfApi}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', 'Idempotency-Key': `int04-dev-${Date.now()}-${Math.random().toString(36).slice(2)}` }, ...(body === undefined ? {} : { data: JSON.stringify(body) }) });
      const text = await r.text();
      let json: any;
      try { json = JSON.parse(text); } catch { json = undefined; }
      return { status: r.status(), text, json };
    };
    const cand = encodeURIComponent(ids['candidate']!);
    // The two panel logins: the ones seed-dev.py puts on INT-01's seeded past interview (their subs differ per pool, so they are read, not fixed).
    const int01 = JSON.parse(readFileSync(join(__dirname, 'support', 'int-01', 'dev-ids.json'), 'utf8')) as Record<string, string>;
    const seeded = await api('GET', `/v1/candidates/${encodeURIComponent(int01['candidate']!)}/interviews`);
    expect(seeded.status, `HR reads INT-01's seeded candidate (${seeded.text.slice(0, 200)})`).toBe(200);
    const past = ((seeded.json?.interviews ?? []) as any[]).find((x) => x.id === int01['pastInterview']);
    const panel = ((past?.panel ?? []) as any[]).filter((e) => e.kind === 'PERSON').map((e) => e.person_id as string);
    expect(panel.length, 'two panel logins of company A').toBe(2);
    const at = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const b = await api('POST', `/v1/candidates/${cand}/interviews`, { type: 'TECHNICAL', at: at(3), length_minutes: 60, where: 'ONLINE', video_link: 'https://meet.example.test/int-04-dev', panel, guest_email: ids['guestEmail'] });
    expect(b.status, `HR books with a guest (${b.text.slice(0, 200)})`).toBe(201);
    const iv = String(b.json?.interview_id);
    const rs = await api('PATCH', `/v1/candidates/${cand}/interviews/${encodeURIComponent(iv)}`, { action: 'reschedule', at: at(4) });
    expect(rs.status, `HR reschedules (${rs.text.slice(0, 200)})`).toBe(200);
    const cn = await api('PATCH', `/v1/candidates/${cand}/interviews/${encodeURIComponent(iv)}`, { action: 'cancel', reason: 'PANEL_NOT_AVAILABLE' });
    expect(cn.status, `HR cancels (${cn.text.slice(0, 200)})`).toBe(200);
    const want = [...panel.map((p) => `${iv}#1#E1#${p}`), `${iv}#1#E2#GUEST`, ...panel.map((p) => `${iv}#2#E4P#${p}`), `${iv}#2#E4G#GUEST`, ...panel.map((p) => `${iv}#3#E5P#${p}`), `${iv}#3#E5G#GUEST`];
    const none = [`${iv}#1#E3#CANDIDATE`, `${iv}#2#E4C#CANDIDATE`, `${iv}#3#E5C#CANDIDATE`];
    const getRow = (id: string) => {
      const raw = execFileSync('aws', ['dynamodb', 'get-item', '--region', region, '--table-name', 'talent-flow-notifications', '--consistent-read', '--key', JSON.stringify({ PK: { S: `INTERVIEW_EMAIL#${id}` }, SK: { S: 'EMAIL' } }), '--output', 'json'], { encoding: 'utf8' });
      return (JSON.parse(raw || '{}') as any).Item as Record<string, any> | undefined;
    };
    const until = Date.now() + 90_000;
    let rows: Record<string, any>[] = [];
    while (Date.now() < until) {
      rows = want.map(getRow).filter(Boolean) as Record<string, any>[];
      if (rows.length === want.length && rows.every((x) => x['status']?.S === 'SENT')) break;
      await new Promise((r) => setTimeout(r, 10_000));
    }
    for (const id of want) {
      const x = getRow(id);
      expect.soft([x?.['status']?.S, x?.['recipient']?.S, !!x?.['message_id']?.S], `${id.split('#').slice(1).join('#')}: SENT to the test address, with a message id`).toEqual(['SENT', 'TEST_ADDRESS', true]);
    }
    for (const id of none) expect.soft(getRow(id), `${id.split('#').slice(1).join('#')}: no candidate email`).toBeUndefined();
  });
});

// ---------------------------------------------------------------- helpers that run other routes

import { vote as vote01, guestVote as guestVote01 } from './support/int-01/world';
function call4vote(who: any, iv: string, t: Tables): Run {
  return vote01(who, iv, { scores: { technical: 4 }, rating: 'YES' }, t, { env: { FRONTEND_URL: FRONT, INTERVIEW_ORGANISER_EMAIL: ORGANISER } });
}
function guestVote4(raw: string, t: Tables): Run {
  return guestVote01(raw, { scores: { technical: 4 }, rating: 'YES' }, t, { env: { FRONTEND_URL: FRONT, INTERVIEW_ORGANISER_EMAIL: ORGANISER } });
}

/** AC-3: every string literal and template text piece (pieces joined by \u0000 at each `${}`), with its line; DynamoDB expressions left out (T-3). */
function literalsOf(source: string, name: string): { text: string; line: number }[] {
  const sf = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const out: { text: string; line: number }[] = [];
  const isExpressionValue = (n: ts.Node) => {
    const p = n.parent;
    if (p && ts.isPropertyAssignment(p) && p.initializer === n) {
      const k = p.name.getText(sf).replace(/['"]/g, '');
      return /Expression$/.test(k);
    }
    return false;
  };
  const visit = (n: ts.Node) => {
    // A bare string statement ('use strict') does nothing, so it can never reach an email.
    const directive = !!n.parent && ts.isExpressionStatement(n.parent) && ts.isStringLiteral(n);
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && !ts.isImportDeclaration(n.parent) && !isExpressionValue(n) && !directive) {
      out.push({ text: n.text, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1 });
    } else if (ts.isTemplateExpression(n) && !isExpressionValue(n)) {
      out.push({ text: [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join('\u0000'), line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1 });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
void APPROVED; void B; void P;
