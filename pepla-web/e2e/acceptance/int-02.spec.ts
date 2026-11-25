import { existsSync, readFileSync } from 'node:fs';
import { ON_DEV, expect, test } from './support/fixtures';
import {
  A, AUDIENCES, B, CANDIDATE, FILE, GUEST, ID, METHODS, NOW, ORGANISER, PANEL, PANEL_EMAILS, PLACE, SCORING_URL, SENDER, TEXT, VIDEO,
  attendeesOf, build, calValueOf, flat, input, inputFor, linesNamed, nameOf, organisersOf, outcome, parse, physical, readBack, set,
  uidFor, unfold, validUtf8, valueOf, type Audience, type Input, type Method,
} from './support/int-02/world';
import { CODES, CONTENT_TYPE, MUST_PASS, MUST_REFUSE, PRODID, findings } from './support/int-02/literals';

/**
 * INT-02 · Calendar invite file builder, nothing sent (Jira NH-268, amber). Spec: /mnt/project-files/specs/interview-journey/cards/INT-02.md
 * (25 Nov 2026, spec check rounds 1 and 2 applied: NO_LINK, BAD_TIME, the AC-8 list, a guest with no name). Notes and pinned choices:
 * cards/int-02.md. Review page: /mnt/project-files/specs/interview-journey/cards/INT-02-tests-for-review.md (the bar).
 *
 * The tests import lambda/shared/interview-invite.mjs and call buildInvite directly, in this process. Its output is read three ways:
 * as raw bytes (CRLF, 75 octets, UTF-8), as unfolded lines (string searches) and through ical.js 2.2.1 (pinned, dev dependency only).
 * Nothing is sent, nothing calls AWS or any AI. Nothing here has a screen width: each test runs once, at 1280.
 *
 * Expected red before merge: all (the file does not exist on develop). Judged on pepla-dev: none.
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it calls the function in this process.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};
const REQUIRED = ['VERSION', 'PRODID', 'UID', 'DTSTAMP', 'DTSTART', 'DTEND', 'SEQUENCE', 'ORGANIZER'];
const sortP = <T extends { email: string }>(xs: T[]) => [...xs].sort((x, y) => x.email.localeCompare(y.email));
const lc = (s: string) => s.toLowerCase();
/** The listed attendees each audience must have (rule 3), as { email, cn } with the panel's CN "{first} {last}". */
const EXPECTED: Record<Audience, { email: string; cn?: string }[]> = {
  PANEL: PANEL.map((p) => ({ email: lc(p.email), cn: `${p.first_name} ${p.last_name}` })),
  GUEST: [{ email: lc(GUEST.email), cn: GUEST.name }],
  CANDIDATE: [{ email: lc(CANDIDATE.email) }],
};

test.describe('INT-02 · calendar invite file builder', () => {
  test.beforeEach(({}, testInfo) => once(testInfo.project.name));

  test('AC-1 every audience and method parses, passes the line check, and is labelled interview.ics with its content type', async () => {
    for (const audience of AUDIENCES) {
      for (const method of METHODS) {
        const at = `${audience} ${method}`;
        const out = await build(input(audience, method));
        // Rule 13.
        expect.soft(out.filename, `${at}: filename`).toBe('interview.ics');
        expect.soft(out.contentType, `${at}: content type`).toBe(`${CONTENT_TYPE}${method}`);
        // RFC 5545 line check: CRLF endings only, every physical line at most 75 octets.
        const { lines, endsInCrlf, bareCrOrLf } = physical(out.body);
        expect.soft(endsInCrlf, `${at}: the file ends in CRLF`).toBe(true);
        expect.soft(bareCrOrLf, `${at}: no CR or LF outside a CRLF line end`).toBe(false);
        for (const [k, l] of lines.entries()) expect.soft(l.length, `${at}: physical line ${k + 1} is at most 75 octets`).toBeLessThanOrEqual(75);
        const u = unfold(out.body);
        expect.soft(u[0], `${at}: first line`).toBe('BEGIN:VCALENDAR');
        expect.soft(u[u.length - 1], `${at}: last line`).toBe('END:VCALENDAR');
        expect.soft(u.filter((l) => l === 'BEGIN:VEVENT'), `${at}: one event`).toHaveLength(1);
        expect.soft(u.filter((l) => l === 'VERSION:2.0'), `${at}: VERSION:2.0 once`).toHaveLength(1);
        expect.soft(linesNamed(out.body, 'PRODID'), `${at}: PRODID (rule 9)`).toEqual([`PRODID:${PRODID}`]);
        for (const name of REQUIRED) expect.soft(linesNamed(out.body, name).length, `${at}: ${name} present once`).toBe(1);
        // ical.js reads it.
        let parsed = true;
        try { parse(out.body); } catch (e) { parsed = false; expect.soft(String(e), `${at}: ical.js parses the file`).toBe(''); }
        expect.soft(parsed, `${at}: ical.js parses the file`).toBe(true);
      }
    }
  });

  test('AC-2 each audience lists exactly its own people, the organiser only as ORGANIZER, and no other address or guest secret', async () => {
    for (const method of METHODS) {
      const files = {} as Record<Audience, string>;
      for (const audience of AUDIENCES) files[audience] = (await build(input(audience, method))).body;
      for (const audience of AUDIENCES) {
        const at = `${audience} ${method}`;
        const body = files[audience];
        const got = sortP(attendeesOf(body));
        // Rule 3: exactly these attendees; the panel's names are "{first} {last}".
        expect.soft(got.map((p) => p.email), `${at}: attendee addresses`).toEqual(sortP(EXPECTED[audience]).map((p) => p.email));
        for (const want of EXPECTED[audience]) {
          if (want.cn === undefined) continue;
          expect.soft(got.find((p) => p.email === want.email)?.cn, `${at}: CN of ${want.email}`).toBe(want.cn);
        }
        // Rules 3 and 4: one ORGANIZER, the company's sending address, never also an attendee.
        const orgs = organisersOf(body);
        expect.soft(orgs.map((o) => o.email), `${at}: ORGANIZER is the company's sending address`).toEqual([SENDER]);
        expect.soft(got.map((p) => p.email), `${at}: the organiser is not an attendee`).not.toContain(SENDER);
        expect.soft(orgs[0]?.cn, `${at}: organiser CN (first name only for the candidate)`)
          .toBe(audience === 'CANDIDATE' ? ORGANISER.first_name : `${ORGANISER.first_name} ${ORGANISER.last_name}`);
      }
      // String searches on the unfolded text.
      const cand = flat(files.CANDIDATE);
      for (const e of PANEL_EMAILS) expect.soft(cand, `CANDIDATE ${method}: no panel address (${e})`).not.toContain(lc(e));
      for (const p of PANEL.slice(1)) {
        for (const n of [p.first_name, p.last_name]) expect.soft(cand, `CANDIDATE ${method}: no other panel name (${n})`).not.toContain(lc(n));
      }
      expect.soft(cand, `CANDIDATE ${method}: no organiser last name`).not.toContain(lc(ORGANISER.last_name));
      expect.soft(cand, `CANDIDATE ${method}: no guest address`).not.toContain(lc(GUEST.email));
      const panel = flat(files.PANEL);
      expect.soft(panel, `PANEL ${method}: no candidate address`).not.toContain(lc(CANDIDATE.email));
      expect.soft(panel, `PANEL ${method}: no guest address`).not.toContain(lc(GUEST.email));
      const guest = flat(files.GUEST);
      for (const e of [...PANEL_EMAILS, CANDIDATE.email]) expect.soft(guest, `GUEST ${method}: no panel or candidate address (${e})`).not.toContain(lc(e));
      // Rule 12: a guest's other fields never reach a file (the UID's hex is left out of the search for the short 'abc').
      for (const audience of AUDIENCES) {
        const text = flat(files[audience]).replace(lc(uidFor(A, ID)), '');
        for (const secret of [SCORING_URL, 'score#token', 'token=abc', 'abc', 'x.test']) {
          expect.soft(text, `${audience} ${method}: guest's other field "${secret}" not in the file`).not.toContain(secret);
        }
      }
    }
    // A booking with no guest (guest left out) builds the PANEL and CANDIDATE files with rule 3's attendees (lock check F-6).
    for (const audience of ['PANEL', 'CANDIDATE'] as Audience[]) {
      for (const method of METHODS) {
        const i = input(audience, method);
        delete i['guest'];
        const r = await outcome(i);
        expect.soft(r.threw, `${audience} ${method} with no guest: builds (${JSON.stringify(r).slice(0, 120)})`).toBe(false);
        if (r.threw) continue;
        const body = (r.returned as { body: string }).body;
        expect.soft(sortP(attendeesOf(body)).map((p) => p.email), `${audience} ${method} with no guest: attendees`).toEqual(sortP(EXPECTED[audience]).map((p) => p.email));
      }
    }
    // Unless the caller puts the link in text.description of the GUEST call: then it is there.
    const withLink = await build(input('GUEST', 'REQUEST', { text: { summary: TEXT.summary, description: `${TEXT.description} ${SCORING_URL}` } }));
    expect.soft(valueOf(withLink.body, 'DESCRIPTION'), 'the GUEST description carries the link the caller put there').toBe(`${TEXT.description} ${SCORING_URL}`);
  });

  test('AC-3 one UID for all three files, sequence carried, a cancel keeps UID and attendees, two companies differ', async () => {
    const uids: string[] = [];
    for (const audience of AUDIENCES) {
      for (const method of METHODS) {
        const seq = method === 'REQUEST' ? 2 : 3;
        const out = await build(set(input(audience, method), 'interview.sequence', seq));
        const at = `${audience} ${method}`;
        uids.push(...linesNamed(out.body, 'UID').map((l) => l.slice(4)));
        expect.soft(linesNamed(out.body, 'SEQUENCE'), `${at}: SEQUENCE`).toEqual([`SEQUENCE:${seq}`]);
        // Rule 6.
        expect.soft(linesNamed(out.body, 'METHOD'), `${at}: METHOD`).toEqual([`METHOD:${method}`]);
        expect.soft(calValueOf(out.body, 'METHOD'), `${at}: METHOD on the calendar`).toBe(method);
        expect.soft(linesNamed(out.body, 'STATUS'), `${at}: STATUS`).toEqual([`STATUS:${method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`]);
      }
      // Same attendee lines (addresses and names) on the request and the cancel.
      const req = sortP(attendeesOf((await build(set(input(audience, 'REQUEST'), 'interview.sequence', 2))).body));
      const can = sortP(attendeesOf((await build(set(input(audience, 'CANCEL'), 'interview.sequence', 3))).body));
      expect.soft(can, `${audience}: the cancel lists the same attendees as the request`).toEqual(req);
      expect.soft(can.length, `${audience}: the cancel lists someone`).toBeGreaterThan(0);
    }
    // Rule 5: one UID, made from the company and the interview.
    expect.soft(new Set(uids).size, 'one UID across every audience and method').toBe(1);
    expect.soft(uids[0], 'UID is SHA-256 of "{tenant_id}:{interview_id}", first 32 hex, @naleko-people').toBe(uidFor(A, ID));
    const otherCompany = await build(inputFor(B, 'PANEL', 'REQUEST'));
    const uidB = linesNamed(otherCompany.body, 'UID').map((l) => l.slice(4));
    expect.soft(uidB, 'company B, same interview_id: its own UID').toEqual([uidFor(B, ID)]);
    expect.soft(uidB[0], 'company B, same interview_id: a different UID').not.toBe(uids[0]);
    // A different interview of the same company is a different event.
    const other = await build(set(input('PANEL', 'REQUEST'), 'interview.interview_id', `${ID}2`));
    expect.soft(linesNamed(other.body, 'UID'), 'another interview_id: another UID').toEqual([`UID:${uidFor(A, `${ID}2`)}`]);
  });

  test('AC-4 start and end in UTC from the zoned time and length, DTSTAMP from the clock given', async () => {
    const cases: { at: string; minutes: number; start: string; end: string }[] = [
      { at: '2026-12-03T09:00:00+02:00', minutes: 45, start: '20261203T070000Z', end: '20261203T074500Z' }, // the card's case
      { at: '2026-12-31T23:30:00Z', minutes: 90, start: '20261231T233000Z', end: '20270101T010000Z' },
      { at: '2026-12-03T09:00:00-05:00', minutes: 60, start: '20261203T140000Z', end: '20261203T150000Z' },
      { at: '2026-12-03T01:15:00+02:00', minutes: 30, start: '20261202T231500Z', end: '20261202T234500Z' },
    ];
    for (const c of cases) {
      for (const audience of AUDIENCES) {
        const i = set(set(input(audience, 'REQUEST'), 'interview.at', c.at), 'interview.length_minutes', c.minutes);
        const out = await build(i);
        expect.soft(linesNamed(out.body, 'DTSTART'), `${audience} ${c.at}: DTSTART`).toEqual([`DTSTART:${c.start}`]);
        expect.soft(linesNamed(out.body, 'DTEND'), `${audience} ${c.at} + ${c.minutes} min: DTEND`).toEqual([`DTEND:${c.end}`]);
        expect.soft(linesNamed(out.body, 'DTSTAMP'), `${audience}: DTSTAMP from now`).toEqual(['DTSTAMP:20261125T100000Z']);
      }
    }
    // The clock comes from `now`, not the machine (milliseconds dropped).
    const later = await build(input('PANEL', 'CANCEL', { now: new Date('2027-02-01T06:07:08.999Z') }));
    expect.soft(linesNamed(later.body, 'DTSTAMP'), 'DTSTAMP from another now').toEqual(['DTSTAMP:20270201T060708Z']);
    expect.soft(NOW.toISOString(), 'test clock').toBe('2026-11-25T10:00:00.000Z');
  });

  test('AC-5 text, names and links cannot add a line, text is escaped and read back, long text folds on whole characters', async () => {
    const evil = 'Room 2, Block B; Floor 1\r\nATTENDEE:mailto:x@evil.test';
    const firstName = 'Tha"ndi;we:\r\nATTENDEE:mailto:y@evil.test';
    const cleanCn = `Thandi;we:ATTENDEE:mailto:y@evil.test ${PANEL[1]!.last_name}`;
    const counts: Record<Audience, number> = { PANEL: 3, GUEST: 1, CANDIDATE: 1 };
    for (const audience of AUDIENCES) {
      for (const method of METHODS) {
        const at = `${audience} ${method}`;
        const i = input(audience, method, { text: { summary: `S ${evil}`, description: `D ${evil} back\\slash C:\\new, bare\rCR` } });
        set(i, 'interview.place', `P ${evil}`);
        set(i, 'panel.1.first_name', firstName);
        set(i, 'organiser.first_name', `Pie"ter\r\n`);
        set(i, 'organiser.last_name', 'van "Wyk";:');
        const out = await build(i);
        const u = unfold(out.body);
        expect.soft(physical(out.body).bareCrOrLf, `${at}: no CR or LF outside a CRLF line end`).toBe(false);
        // No extra property line: no line of the file starts with the injected text, and the attendee count is unchanged.
        expect.soft(u.filter((l) => l.startsWith('ATTENDEE:mailto:x@evil') || l.startsWith('ATTENDEE:mailto:y@evil')), `${at}: no injected ATTENDEE line`).toEqual([]);
        expect.soft(attendeesOf(out.body).length, `${at}: attendee count unchanged`).toBe(counts[audience]);
        expect.soft(attendeesOf(out.body).map((p) => p.email).filter((e) => e.includes('evil')), `${at}: no evil attendee`).toEqual([]);
        expect.soft(u.filter((l) => nameOf(l) === 'SUMMARY').length + u.filter((l) => nameOf(l) === 'DESCRIPTION').length + u.filter((l) => nameOf(l) === 'LOCATION').length,
          `${at}: one SUMMARY, one DESCRIPTION, one LOCATION`).toBe(3);
        // Rule 10: TEXT escaped, so ical.js reads back exactly the caller's text (CRLF as a newline, a bare CR removed).
        expect.soft(valueOf(out.body, 'SUMMARY'), `${at}: SUMMARY reads back`).toBe(readBack(`S ${evil}`));
        expect.soft(valueOf(out.body, 'DESCRIPTION'), `${at}: DESCRIPTION reads back`).toBe(readBack(`D ${evil} back\\slash C:\\new, bare\rCR`));
        expect.soft(linesNamed(out.body, 'DESCRIPTION')[0], `${at}: backslash escaped in the raw line`).toContain('back\\\\slash C:\\\\new\\, bareCR');
        expect.soft(valueOf(out.body, 'LOCATION'), `${at}: LOCATION reads back (rule 8: in person, the place)`).toBe(readBack(`P ${evil}`));
        expect.soft(linesNamed(out.body, 'URL'), `${at}: no URL in person`).toEqual([]);
        const summaryLine = linesNamed(out.body, 'SUMMARY')[0] ?? '';
        expect.soft(summaryLine, `${at}: comma, semicolon and newline escaped in the raw line`).toBe('SUMMARY:S Room 2\\, Block B\\; Floor 1\\nATTENDEE:mailto:x@evil.test');
        // CN always one quoted value, with " and control characters removed.
        for (const l of u.filter((x) => /^(ATTENDEE|ORGANIZER)[;:]/.test(x))) {
          const cns = l.match(/;CN=/g) ?? [];
          expect.soft(cns.length, `${at}: one CN at most in ${l}`).toBeLessThanOrEqual(1);
          if (cns.length) expect.soft(l, `${at}: CN quoted in ${l}`).toMatch(/;CN="[^"\x00-\x1f\x7f]*"[;:]/);
        }
        const orgCn = organisersOf(out.body)[0]?.cn;
        expect.soft(orgCn, `${at}: organiser CN cleaned`).toBe(audience === 'CANDIDATE' ? 'Pieter' : 'Pieter van Wyk;:');
        if (audience === 'PANEL') {
          const t = attendeesOf(out.body).find((p) => p.email === lc(PANEL[1]!.email));
          expect.soft(t?.cn, `${at}: the injected first name stays one quoted CN`).toBe(cleanCn);
        }
      }
    }
    // Lone line breaks (LF alone, CR alone) and other control characters in text and names (lock check F-1).
    const lone = { summary: 'S1\nATTENDEE:mailto:x@evil.test', description: 'D1\rATTENDEE:mailto:x@evil.test\nend', place: 'P1\nATTENDEE:mailto:x@evil.test\r' };
    const loneName = 'Tha\nndi\rwe\tX\u0001\u007f';
    for (const audience of AUDIENCES) {
      for (const method of METHODS) {
        const at = `${audience} ${method} (lone breaks)`;
        const i = input(audience, method, { text: { summary: lone.summary, description: lone.description } });
        set(i, 'interview.place', lone.place);
        set(i, 'panel.1.first_name', loneName);
        set(i, 'organiser.first_name', 'Pie\nter\r');
        set(i, 'organiser.last_name', 'van\tWyk\u0001');
        const out = await build(i);
        const u = unfold(out.body);
        expect.soft(physical(out.body).bareCrOrLf, `${at}: no CR or LF outside a CRLF line end`).toBe(false);
        expect.soft(u.filter((l) => l.startsWith('ATTENDEE:mailto:x@evil')), `${at}: no injected ATTENDEE line`).toEqual([]);
        expect.soft(attendeesOf(out.body).length, `${at}: attendee count unchanged`).toBe(counts[audience]);
        expect.soft(valueOf(out.body, 'SUMMARY'), `${at}: SUMMARY reads back, lone LF as a newline`).toBe(readBack(lone.summary));
        expect.soft(valueOf(out.body, 'DESCRIPTION'), `${at}: DESCRIPTION reads back, lone CR removed`).toBe(readBack(lone.description));
        expect.soft(valueOf(out.body, 'LOCATION'), `${at}: LOCATION reads back`).toBe(readBack(lone.place));
        for (const l of u.filter((x) => /^(ATTENDEE|ORGANIZER)[;:]/.test(x))) {
          if (/;CN=/.test(l)) expect.soft(l, `${at}: CN quoted, no control character in ${JSON.stringify(l)}`).toMatch(/;CN="[^"\x00-\x1f\x7f]*"[;:]/);
        }
        expect.soft(organisersOf(out.body)[0]?.cn, `${at}: organiser CN cleaned`).toBe(audience === 'CANDIDATE' ? 'Pieter' : 'Pieter vanWyk');
        if (audience === 'PANEL') {
          expect.soft(attendeesOf(out.body).find((p) => p.email === lc(PANEL[1]!.email))?.cn, `${at}: cleaned CN`).toBe(`ThandiweX ${PANEL[1]!.last_name}`);
        }
      }
    }
    // Spaces and a tab at either end of the caller's text are kept exactly (lock check F-5).
    for (const audience of AUDIENCES) {
      const padded = { summary: '  S-pad  ', description: ' D-pad\t' };
      const out = await build(input(audience, 'REQUEST', { text: padded }));
      expect.soft(valueOf(out.body, 'SUMMARY'), `${audience}: SUMMARY with spaces at both ends reads back exactly`).toBe(padded.summary);
      expect.soft(valueOf(out.body, 'DESCRIPTION'), `${audience}: DESCRIPTION with a space and a tab reads back exactly`).toBe(padded.description);
      expect.soft(linesNamed(out.body, 'SUMMARY'), `${audience}: SUMMARY raw line`).toEqual([`SUMMARY:${padded.summary}`]);
    }
    // An email holding CRLF is refused, wherever it is.
    const crlf = (e: string) => `${e}\r\nATTENDEE:mailto:x@evil.test`;
    for (const [path, value] of [['candidate.email', crlf(CANDIDATE.email)], ['panel.2.email', crlf(PANEL[2]!.email)], ['guest.email', crlf(GUEST.email)], ['organiser.email', crlf(SENDER)]] as const) {
      for (const audience of AUDIENCES) {
        const r = await outcome(set(input(audience, 'REQUEST'), path, value));
        expect.soft(r, `${audience}: ${path} with CRLF throws BAD_EMAIL`).toEqual({ threw: true, cls: 'InviteError', code: 'BAD_EMAIL' });
      }
    }
    // Rule 8: online, LOCATION and URL are the video link.
    for (const audience of AUDIENCES) {
      const i = set(set(input(audience, 'REQUEST'), 'interview.where', 'ONLINE'), 'interview.video_link', VIDEO);
      const out = await build(i);
      expect.soft(valueOf(out.body, 'LOCATION'), `${audience} online: LOCATION is the link`).toBe(VIDEO);
      expect.soft(linesNamed(out.body, 'URL'), `${audience} online: URL is exactly the link`).toEqual([`URL:${VIDEO}`]);
      expect.soft(physical(out.body).bareCrOrLf, `${audience} online: no CR or LF outside a CRLF line end`).toBe(false);
      const text = flat(out.body).replace(lc(uidFor(A, ID)), '');
      for (const secret of [SCORING_URL, 'score#token', 'token=abc', 'abc', 'x.test']) {
        expect.soft(text, `${audience} online: guest's other field "${secret}" not in the file`).not.toContain(secret);
      }
      expect.soft(flat(out.body), `${audience} online: the link is in the file`).toContain(lc(VIDEO));
      expect.soft(flat(out.body), `${audience} online: the place given is not used`).not.toContain(lc('12 Long Street'));
    }
    // Folding: 300 characters of two-byte and four-byte characters.
    const long = Array.from({ length: 300 }, (_, k) => ['ë', 'é', '😀', 'a'][k % 4]).join('');
    const ascii = Array.from({ length: 300 }, (_, k) => String.fromCharCode(97 + (k % 26))).join('');
    expect.soft([...long].length, 'the long value is 300 characters').toBe(300);
    for (const audience of AUDIENCES) {
      const i = input(audience, 'REQUEST', { text: { summary: long, description: `${long}${long}` } });
      set(i, 'interview.place', ascii);
      const out = await build(i);
      const { lines, endsInCrlf } = physical(out.body);
      expect.soft(endsInCrlf, `${audience} long: ends in CRLF`).toBe(true);
      lines.forEach((l, k) => {
        expect.soft(l.length, `${audience} long: line ${k + 1} at most 75 octets`).toBeLessThanOrEqual(75);
        expect.soft(validUtf8(l), `${audience} long: line ${k + 1} is valid UTF-8 on its own`).toBe(true);
        // Folded at 75: a line that is followed by a continuation is cut only when the next character would not fit.
        if (lines[k + 1]?.[0] === 0x20) expect.soft(l.length, `${audience} long: folded line ${k + 1} is at least 72 octets (folded at 75)`).toBeGreaterThanOrEqual(72);
      });
      expect.soft(lines.some((l) => l[0] === 0x20), `${audience} long: the long line was folded`).toBe(true);
      expect.soft(valueOf(out.body, 'SUMMARY'), `${audience} long: SUMMARY reads back whole`).toBe(long);
      expect.soft(valueOf(out.body, 'DESCRIPTION'), `${audience} long: DESCRIPTION reads back whole`).toBe(`${long}${long}`);
      expect.soft(valueOf(out.body, 'LOCATION'), `${audience} long: a 300-character plain place reads back whole`).toBe(ascii);
    }
  });

  test('AC-6 every bad input throws its InviteError code and returns nothing; a guest with no name is not a refusal', async () => {
    const online = (link: unknown) => {
      const i = set(input('PANEL', 'REQUEST'), 'interview.where', 'ONLINE');
      return link === undefined ? set(i, 'interview.video_link', undefined) : set(i, 'interview.video_link', link);
    };
    const cases: [string, Input, string][] = [
      ['audience HR', input('HR' as Audience), 'BAD_AUDIENCE'],
      ['audience panel (lower case)', input('panel' as Audience), 'BAD_AUDIENCE'],
      ['method PUBLISH', input('PANEL', 'PUBLISH' as Method), 'BAD_METHOD'],
      ['method request (lower case)', input('GUEST', 'request' as Method), 'BAD_METHOD'],
      ['no length_minutes', set(input(), 'interview.length_minutes', undefined), 'MISSING_FIELD'],
      ['no sequence', set(input(), 'interview.sequence', undefined), 'MISSING_FIELD'],
      ['no sequence (candidate cancel)', set(input('CANDIDATE', 'CANCEL'), 'interview.sequence', undefined), 'MISSING_FIELD'],
      ['no interview.at', set(input(), 'interview.at', undefined), 'MISSING_FIELD'],
      ['no interview_id', set(input(), 'interview.interview_id', undefined), 'MISSING_FIELD'],
      ['no now', set(input(), 'now', undefined), 'MISSING_FIELD'],
      ['no organiser email', set(input(), 'organiser.email', undefined), 'MISSING_FIELD'],
      ['no candidate email', set(input('CANDIDATE'), 'candidate.email', undefined), 'MISSING_FIELD'],
      ['no text summary', set(input(), 'text.summary', undefined), 'MISSING_FIELD'],
      ['interview_id with CRLF', set(input(), 'interview.interview_id', 'INT-1\r\nATTENDEE:mailto:x@evil.test'), 'BAD_ID'],
      ['interview_id with a slash', set(input(), 'interview.interview_id', 'INT/1'), 'BAD_ID'],
      ['interview_id of 65 characters', set(input(), 'interview.interview_id', 'a'.repeat(65)), 'BAD_ID'],
      ['candidate email with a space', set(input('CANDIDATE'), 'candidate.email', 'lerato mokoena@example.test'), 'BAD_EMAIL'],
      ['panel email with no dot after @', set(input(), 'panel.0.email', 'pieter@sunbird'), 'BAD_EMAIL'],
      ['guest email with a quote', set(input('GUEST'), 'guest.email', '"sam"@partner.test'), 'BAD_EMAIL'],
      ['organiser email with mailto:', set(input(), 'organiser.email', 'mailto:hiring@sunbird.test'), 'BAD_EMAIL'],
      ['video link http://', online('http://meet.example.test/x'), 'BAD_LINK'],
      ['video link javascript:', online('javascript:alert(1)'), 'BAD_LINK'],
      ['video link with a space', online('https://meet.example.test/a b'), 'BAD_LINK'],
      ['video link with a quote', online('https://meet.example.test/a"b'), 'BAD_LINK'],
      ['video link with CRLF', online('https://meet.example.test/a\r\nATTENDEE:mailto:x@evil.test'), 'BAD_LINK'],
      ['video link with a tab', online('https://meet.example.test/a\tb'), 'BAD_LINK'],
      ['online with no video_link', online(undefined), 'NO_LINK'],
      ["online with video_link ''", online(''), 'NO_LINK'],
      ["in person with place ''", set(input(), 'interview.place', ''), 'NO_PLACE'],
      ['in person with no place', set(input(), 'interview.place', undefined), 'NO_PLACE'],
      ['at with no zone', set(input(), 'interview.at', '2026-12-03T09:00:00'), 'BAD_TIME'],
      ['at not a date', set(input(), 'interview.at', 'not a date'), 'BAD_TIME'],
      ['at month 13 with a zone', set(input(), 'interview.at', '2026-13-45T09:00:00Z'), 'BAD_TIME'],
      ['at offset with no colon', set(input(), 'interview.at', '2026-12-03T09:00:00+0200'), 'BAD_TIME'],
    ];
    const seen = new Set<string>();
    for (const [what, i, code] of cases) {
      for (const audience of i['audience'] === 'PANEL' ? AUDIENCES : [i['audience'] as Audience]) {
        const j = AUDIENCES.includes(i['audience']) ? { ...i, audience } : i;
        const r = await outcome(j);
        expect.soft(r, `${what} (${audience}): throws InviteError ${code}, returns nothing`).toEqual({ threw: true, cls: 'InviteError', code });
        seen.add(code);
      }
    }
    for (const c of CODES.filter((c) => c !== 'COMPANY_MISMATCH')) expect.soft(seen.has(c), `a case for ${c}`).toBe(true);
    // Edges that are not refusals: a 64-character id, an unusual but valid address.
    expect.soft(await outcome(set(input(), 'interview.interview_id', 'a'.repeat(64))), '64-character id is fine').toMatchObject({ threw: false });
    expect.soft(await outcome(set(input(), 'panel.2.email', 'zoe_b%x+1@mail.sunbird.co.za')), 'unusual valid address is fine').toMatchObject({ threw: false });
    // A guest with no name: a file, and the guest's line is exactly ATTENDEE:mailto:{email}.
    for (const method of METHODS) {
      const i = set(input('GUEST', method), 'guest.name', undefined);
      const r = await outcome(i);
      expect.soft(r.threw, `GUEST ${method} with no name: not a refusal`).toBe(false);
      if (r.threw) continue;
      const body = (r.returned as { body: string }).body;
      expect.soft(linesNamed(body, 'ATTENDEE'), `GUEST ${method} with no name: the guest line`).toEqual([`ATTENDEE:mailto:${GUEST.email}`]);
    }
  });

  test('AC-7 a company-B panel member, candidate, guest or interview throws COMPANY_MISMATCH, for every audience', async () => {
    const rows: [string, string][] = [['panel.0.tenant_id', B], ['panel.2.tenant_id', B], ['candidate.tenant_id', B], ['guest.tenant_id', B], ['interview.tenant_id', B],
      ['panel.1.tenant_id', A.toUpperCase()], ['candidate.tenant_id', `${A} `]];
    for (const [path, value] of rows) {
      for (const audience of AUDIENCES) {
        for (const method of METHODS) {
          const r = await outcome(set(input(audience, method), path, value));
          expect.soft(r, `${audience} ${method}: ${path} = ${JSON.stringify(value)} throws COMPANY_MISMATCH`).toEqual({ threw: true, cls: 'InviteError', code: 'COMPANY_MISMATCH' });
        }
      }
    }
    // The company itself is B while every row is A's.
    for (const audience of AUDIENCES) {
      const r = await outcome(set(input(audience, 'REQUEST'), 'company.tenant_id', B));
      expect.soft(r, `${audience}: company B with company A's rows throws COMPANY_MISMATCH`).toEqual({ threw: true, cls: 'InviteError', code: 'COMPANY_MISMATCH' });
      // A row with no company, a null company or an empty one is refused too (either code), never built (lock check F-2).
      for (const [path, value] of [['panel.1.tenant_id', undefined], ['panel.1.tenant_id', null], ['candidate.tenant_id', ''], ['guest.tenant_id', ''],
        ['interview.tenant_id', null], ['company.tenant_id', '']] as [string, unknown][]) {
        for (const method of METHODS) {
          const i = set(input(audience, method), path, value);
          const none = await outcome(i);
          expect.soft(none.threw && none.cls === 'InviteError' && ['COMPANY_MISMATCH', 'MISSING_FIELD'].includes(String(none.code)),
            `${audience} ${method}: ${path} = ${JSON.stringify(value) ?? 'left out'} is refused (${JSON.stringify(none).slice(0, 120)})`).toBe(true);
        }
      }
    }
    // Company B's own booking, all B, is fine.
    expect.soft(await outcome(inputFor(B, 'CANDIDATE', 'REQUEST')), "company B's own booking builds").toMatchObject({ threw: false });
  });

  test('AC-8 the function holds no words of its own: every literal is on the card list', async () => {
    // The checker first: it refuses what it must and lets a correct build through.
    for (const src of MUST_REFUSE) expect.soft(findings(src).length, `checker refuses: ${src}`).toBeGreaterThan(0);
    for (const src of MUST_PASS) expect.soft(findings(src), `checker passes: ${src}`).toEqual([]);
    expect(existsSync(FILE), 'lambda/shared/interview-invite.mjs exists').toBe(true);
    const found = findings(readFileSync(FILE, 'utf8'));
    expect.soft(found.map((f) => `line ${f.line}: ${f.what}`), 'literals not on the AC-8 list').toEqual([]);
    // At run time: only the card's properties and parameters, and SUMMARY and DESCRIPTION are the caller's text exactly (rule 9).
    const props = new Set(['BEGIN', 'END', 'VERSION', 'PRODID', 'METHOD', 'CALSCALE', 'UID', 'DTSTAMP', 'DTSTART', 'DTEND', 'SEQUENCE', 'STATUS',
      'SUMMARY', 'DESCRIPTION', 'LOCATION', 'URL', 'ORGANIZER', 'ATTENDEE']);
    const params = new Set(['CN', 'ROLE', 'PARTSTAT', 'RSVP', 'CUTYPE']);
    for (const audience of AUDIENCES) {
      for (const method of METHODS) {
        const out = await build(input(audience, method));
        for (const l of unfold(out.body)) {
          expect.soft(props.has(nameOf(l)), `${audience} ${method}: property ${nameOf(l)} is on the card list`).toBe(true);
          const head = l.replace(/"[^"]*"/g, '""').split(':', 1)[0]!;
          for (const p of head.split(';').slice(1)) expect.soft(params.has(p.split('=')[0]!), `${audience} ${method}: parameter ${p} is on the card list`).toBe(true);
        }
        expect.soft(linesNamed(out.body, 'SUMMARY'), `${audience} ${method}: SUMMARY is the caller's`).toEqual([`SUMMARY:${TEXT.summary}`]);
        expect.soft(linesNamed(out.body, 'DESCRIPTION'), `${audience} ${method}: DESCRIPTION is the caller's`).toEqual([`DESCRIPTION:${TEXT.description}`]);
        const begins = unfold(out.body).filter((l) => nameOf(l) === 'BEGIN' || nameOf(l) === 'END');
        expect.soft(begins, `${audience} ${method}: only VCALENDAR and one VEVENT`).toEqual(['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'END:VEVENT', 'END:VCALENDAR']);
        if (audience === 'CANDIDATE') {
          const forms = ['', `;CN="${CANDIDATE.first_name}"`, `;CN="${CANDIDATE.first_name} ${CANDIDATE.last_name}"`].map((cn) => `ATTENDEE${cn}:mailto:${CANDIDATE.email}`);
          const got = linesNamed(out.body, 'ATTENDEE');
          expect.soft(got.length === 1 && forms.includes(got[0]!), `CANDIDATE ${method}: the candidate's line is one of ${forms.join(' | ')}, got ${JSON.stringify(got)}`).toBe(true);
        }
        expect.soft(linesNamed(out.body, 'LOCATION'), `${audience} ${method}: LOCATION is the place given`).toEqual([`LOCATION:${PLACE.replace(/,/g, '\\,').replace(/;/g, '\\;')}`]);
      }
    }
  });
});
