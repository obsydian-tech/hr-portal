// INT-02 (NH-268): builds the calendar invite file (.ics) for one audience of one interview.
// It sends nothing and reads nothing. It writes no words of its own: the summary and description
// come from the caller (INT-04). Any bad input throws InviteError with a code; no partial file.
import { createHash } from 'node:crypto';

class InviteError extends Error {
  constructor(code, field) {
    super(code);
    this.name = 'InviteError';
    this.code = code;
    if (field !== undefined) this.field = field;
  }
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}$/;
const TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const LINK_START = /^https:\/\//;
const LINK_BAD_CHAR = /[\s"'\u0000-\u001f\u007f]/;

const isText = (v) => typeof v === 'string';
const has = (v) => v !== undefined && v !== null;

function need(value, field) {
  if (!has(value)) throw new InviteError('MISSING_FIELD', field);
  return value;
}
function needText(value, field) {
  if (!isText(need(value, field))) throw new InviteError('MISSING_FIELD', field);
  return value;
}
function needWhole(value, field) {
  if (typeof need(value, field) !== 'number' || !Number.isFinite(value)) throw new InviteError('MISSING_FIELD', field);
  return value;
}
function needEmail(value, field) {
  const v = needText(value, field);
  if (!EMAIL_PATTERN.test(v)) throw new InviteError('BAD_EMAIL', field);
  return v;
}
/** A row's company must be there and equal the booking's company, compared exactly (D-T-02.11, D-T-02.15). */
function sameCompany(row, tenant, field) {
  const t = row === undefined || row === null ? undefined : row.tenant_id;
  if (!isText(t) || t === '') throw new InviteError('MISSING_FIELD', field);
  if (t !== tenant) throw new InviteError('COMPANY_MISMATCH', field);
}

// ---------------------------------------------------------------- writing values

/** RFC 5545 §3.3.11: backslash, comma, semicolon, newline as \n; a bare CR is removed. */
function escapeText(value) {
  return String(value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/** RFC 5545 §3.2: a parameter value is always quoted; it cannot hold a quote or a control character. */
function quoted(value) {
  return `"${String(value).replace(/["\u0000-\u001f\u007f]/g, '')}"`;
}

/** UTC time as YYYYMMDDTHHMMSSZ. */
function utc(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
}

/** Folds one line at 75 octets, never inside a UTF-8 character (RFC 5545 §3.1). */
function fold(line) {
  const out = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const width = Buffer.byteLength(ch, 'utf8');
    if (size + width > 75) {
      out.push(current);
      current = ' ';
      size = 1;
    }
    current += ch;
    size += width;
  }
  out.push(current);
  return out.join('\r\n');
}

function uidFor(tenant, interviewId) {
  return `${createHash('sha256').update(`${tenant}:${interviewId}`, 'utf8').digest('hex').slice(0, 32)}@naleko-people`;
}

function person(p) {
  return `${quoted(`${p.first_name} ${p.last_name}`)}:mailto:${p.email}`;
}

// ---------------------------------------------------------------- the builder

export function buildInvite(input) {
  const i = has(input) ? input : {};
  const audience = i.audience;
  if (audience !== 'PANEL' && audience !== 'GUEST' && audience !== 'CANDIDATE') throw new InviteError('BAD_AUDIENCE', 'audience');
  const method = i.method;
  if (method !== 'REQUEST' && method !== 'CANCEL') throw new InviteError('BAD_METHOD', 'method');

  // Everything must be there, and every row must belong to the booking's company, before anything is built.
  if (!(i.now instanceof Date) || Number.isNaN(i.now.getTime())) throw new InviteError('MISSING_FIELD', 'now');
  need(i.company, 'company');
  const tenant = needText(i.company.tenant_id, 'company.tenant_id');
  if (tenant === '') throw new InviteError('MISSING_FIELD', 'company.tenant_id');
  const iv = need(i.interview, 'interview');
  const organiser = need(i.organiser, 'organiser');
  const candidate = need(i.candidate, 'candidate');
  const panel = need(i.panel, 'panel');
  if (!Array.isArray(panel)) throw new InviteError('MISSING_FIELD', 'panel');
  const text = need(i.text, 'text');
  const guest = has(i.guest) ? i.guest : undefined;
  if (audience === 'GUEST' && guest === undefined) throw new InviteError('MISSING_FIELD', 'guest');
  if (audience === 'PANEL' && panel.length === 0) throw new InviteError('MISSING_FIELD', 'panel');

  sameCompany(iv, tenant, 'interview.tenant_id');
  sameCompany(candidate, tenant, 'candidate.tenant_id');
  panel.forEach((p, k) => sameCompany(p, tenant, `panel.${k}.tenant_id`));
  if (guest !== undefined) sameCompany(guest, tenant, 'guest.tenant_id');

  // Required fields, then their shapes.
  const interviewId = needText(iv.interview_id, 'interview.interview_id');
  const at = needText(iv.at, 'interview.at');
  const length = needWhole(iv.length_minutes, 'interview.length_minutes');
  const sequence = needWhole(iv.sequence, 'interview.sequence');
  const where = iv.where;
  if (where !== 'IN_PERSON' && where !== 'ONLINE') throw new InviteError('MISSING_FIELD', 'interview.where');
  needText(organiser.first_name, 'organiser.first_name');
  needText(organiser.last_name, 'organiser.last_name');
  needText(candidate.first_name, 'candidate.first_name');
  needText(candidate.last_name, 'candidate.last_name');
  panel.forEach((p, k) => {
    needText(p.first_name, `panel.${k}.first_name`);
    needText(p.last_name, `panel.${k}.last_name`);
  });
  const summary = needText(text.summary, 'text.summary');
  const description = needText(text.description, 'text.description');

  if (!ID_PATTERN.test(interviewId)) throw new InviteError('BAD_ID', 'interview.interview_id');
  const organiserEmail = needEmail(organiser.email, 'organiser.email');
  needEmail(candidate.email, 'candidate.email');
  panel.forEach((p, k) => needEmail(p.email, `panel.${k}.email`));
  if (guest !== undefined) needEmail(guest.email, 'guest.email');

  if (!TIME_PATTERN.test(at)) throw new InviteError('BAD_TIME', 'interview.at');
  const start = new Date(at);
  if (Number.isNaN(start.getTime())) throw new InviteError('BAD_TIME', 'interview.at');
  const end = new Date(start.getTime() + length * 60000);

  let place;
  let link;
  if (where === 'IN_PERSON') {
    if (!isText(iv.place) || iv.place === '') throw new InviteError('NO_PLACE', 'interview.place');
    place = iv.place;
  } else {
    if (!has(iv.video_link) || iv.video_link === '') throw new InviteError('NO_LINK', 'interview.video_link');
    if (!isText(iv.video_link) || !LINK_START.test(iv.video_link) || LINK_BAD_CHAR.test(iv.video_link)) {
      throw new InviteError('BAD_LINK', 'interview.video_link');
    }
    link = iv.video_link;
  }

  // Who is listed (rule 3). The organiser is never listed twice.
  const organiserLine = audience === 'CANDIDATE'
    ? `ORGANIZER;CN=${quoted(organiser.first_name)}:mailto:${organiserEmail}`
    : `ORGANIZER;CN=${quoted(`${organiser.first_name} ${organiser.last_name}`)}:mailto:${organiserEmail}`;
  const isOrganiser = (email) => email.toLowerCase() === organiserEmail.toLowerCase();
  let attendees;
  if (audience === 'PANEL') {
    attendees = panel.filter((p) => !isOrganiser(p.email)).map((p) => `ATTENDEE;CN=${person(p)}`);
  } else if (audience === 'CANDIDATE') {
    attendees = isOrganiser(candidate.email) ? [] : [`ATTENDEE;CN=${person(candidate)}`];
  } else if (isOrganiser(guest.email)) {
    attendees = [];
  } else if (isText(guest.name) && guest.name !== '') {
    attendees = [`ATTENDEE;CN=${quoted(guest.name)}:mailto:${guest.email}`];
  } else {
    attendees = [`ATTENDEE:mailto:${guest.email}`];
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Naleko People//Interviews//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${uidFor(tenant, interviewId)}`,
    `DTSTAMP:${utc(i.now)}`,
    `DTSTART:${utc(start)}`,
    `DTEND:${utc(end)}`,
    `SEQUENCE:${sequence}`,
    method === 'REQUEST' ? 'STATUS:CONFIRMED' : 'STATUS:CANCELLED',
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText(description)}`,
  ];
  if (where === 'IN_PERSON') {
    lines.push(`LOCATION:${escapeText(place)}`);
  } else {
    lines.push(`LOCATION:${escapeText(link)}`, `URL:${escapeText(link)}`);
  }
  lines.push(organiserLine, ...attendees, 'END:VEVENT', 'END:VCALENDAR');

  return {
    filename: 'interview.ics',
    contentType: `text/calendar; charset=utf-8; method=${method}`,
    body: `${lines.map(fold).join('\r\n')}\r\n`,
  };
}
