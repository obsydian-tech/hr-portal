// INT-04 (NH-277): the interview emails. Pure: no AWS, no clock of its own. The words are Iggie's approved texts
// (specs/interview-journey/EMAILS-DRAFT.md, 26 Nov 2026), copied exactly; nothing a person reads is added here.

export const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}$/;
export const TEMPLATE_KEYS = ['E1', 'E2', 'E3', 'E4P', 'E4G', 'E4C', 'E5P', 'E5G', 'E5C', 'E6P', 'E6G'];
export const CANDIDATE_TEMPLATES = ['E3', 'E4C', 'E5C'];
export const ZONE = 'SAST';
const OFFSET_MS = 2 * 3600000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const DETAILS = ['When: {date} at {time} ({zone})', 'Length: {length}', '{where_line}'];
export const WHERE_IN_PERSON = 'Where: In person, {place}';
export const WHERE_ONLINE = 'Where: Online, {video_link}';

// Each body is a list of blocks (one blank line between blocks). `when` names a value that must be present for the block to show.
export const INTERVIEW_EMAIL_TEXTS = Object.freeze({
  E1: { subject: 'Interview: {candidate}, {role}, {date}', blocks: [['Hi {recipient_first_name}.'], ['You are on the panel for a {type} interview with {candidate} for {role}.'], DETAILS, ["See {candidate}'s details: {link}"], ['You can give feedback from the start of the interview. The calendar invite is attached.'], ['Naleko People']] },
  E2: { subject: 'Interview: {candidate}, {role}, {date}', blocks: [['Hi {recipient_first_name}.'], ['You are invited to a {type} interview with {candidate} for {role} at {company}.'], DETAILS, ['Give your feedback here: {link}', 'The link works once, from the start of the interview until {expires}. Please do not share it.'], ['The calendar invite is attached.'], ['Naleko People']] },
  E3: { subject: 'Your interview for {role} at {company}', blocks: [['Hi {first_name}.'], ['{company} would like to meet you for an interview for {role}.'], DETAILS, ['You will meet {panel_first_names}.'], { when: 'note', lines: ['A note from {company}: {note}'] }, ['The calendar invite is attached. If the time does not suit you, reply to this email.'], ['{company}']] },
  E4P: { subject: 'Interview changed: {candidate}, {role}, {date}', blocks: [['Hi {recipient_first_name}.'], ['The {type} interview with {candidate} for {role} has changed. {what_changed}'], ['The new details:', ...DETAILS], { when: 'reason', lines: ['Reason: {reason}'] }, ['An updated calendar invite is attached.'], ['Naleko People']] },
  E4G: { subject: 'Interview changed: {candidate}, {role}, {date}', blocks: [['Hi {recipient_first_name}.'], ['The {type} interview with {candidate} for {role} at {company} has changed. {what_changed}'], ['The new details:', ...DETAILS], { when: 'reason', lines: ['Reason: {reason}'] }, ['Give your feedback here: {link}', 'The link works once, from the start of the interview until {expires}. Please do not share it.'], ['An updated calendar invite is attached.'], ['Naleko People']] },
  E4C: { subject: 'Your interview for {role} at {company} has changed', blocks: [['Hi {first_name}.'], ['Your interview for {role} at {company} has changed. {what_changed}'], ['The new details:', ...DETAILS], { when: 'panel_first_names', lines: ['You will meet {panel_first_names}.'] }, ['An updated calendar invite is attached. If the new time does not suit you, reply to this email.'], ['{company}']] },
  E5P: { subject: 'Interview cancelled: {candidate}, {role}, {date}', blocks: [['Hi {recipient_first_name}.'], ['The {type} interview with {candidate} for {role} on {date} at {time} is cancelled.'], { when: 'reason', lines: ['Reason: {reason}'] }, ['A calendar file for the cancelled interview is attached.'], ['Naleko People']] },
  E5G: { subject: 'Interview cancelled: {candidate}, {role}, {date}', blocks: [['Hi {recipient_first_name}.'], ['The {type} interview with {candidate} for {role} at {company} on {date} at {time} is cancelled. Your feedback link no longer works.'], { when: 'reason', lines: ['Reason: {reason}'] }, ['A calendar file for the cancelled interview is attached.'], ['Naleko People']] },
  E5C: { subject: 'Your interview for {role} at {company} is cancelled', blocks: [['Hi {first_name}.'], ['Your interview for {role} at {company} on {date} at {time} is cancelled.'], ['A calendar file for the cancelled interview is attached. If you have questions, reply to this email.'], ['{company}']] },
  E6P: { subject: 'You are no longer on the panel: {candidate}, {role}', blocks: [['Hi {recipient_first_name}.'], ['You are no longer on the panel for the {type} interview with {candidate} for {role} on {date}.'], ['A calendar file for this interview is attached.'], ['Naleko People']] },
  E6G: { subject: 'You are no longer on the panel: {candidate}, {role}', blocks: [['Hi {recipient_first_name}.'], ['You are no longer on the panel for the {type} interview with {candidate} for {role} on {date}.'], ['Your feedback link no longer works.'], ['A calendar file for this interview is attached.'], ['Naleko People']] },
});

// The approved "what changed" lines (Q-7), and the approved cancel reason labels (S-4).
export const CHANGED = {
  at: 'The date or time has changed.', length: 'The length has changed.', online: 'It is now online.', inPerson: 'It is now in person.',
  place: 'The place has changed.', link: 'The video link has changed.', panel: 'The panel has changed.',
};
export const CANCEL_LABELS = { CANDIDATE_ASKED: 'Candidate asked', PANEL_NOT_AVAILABLE: 'Panel not available', CANDIDATE_WITHDREW: 'Candidate withdrew' };

/** One line: control characters out, CR and LF as one space, trimmed. */
export function oneLine(v) {
  if (v === undefined || v === null) return '';
  return String(v).replace(/\r\n|\r|\n/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '').trim();
}

const two = (n) => String(n).padStart(2, '0');
function local(iso) { return new Date(Date.parse(iso) + OFFSET_MS); }
export const dateOf = (iso) => { const d = local(iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
export const timeOf = (iso) => { const d = local(iso); return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`; };
export const whenOf = (iso) => `${dateOf(iso)} at ${timeOf(iso)} (${ZONE})`;
export function lengthOf(min) {
  if (min < 60) return `${min} minutes`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h} ${h === 1 ? 'hour' : 'hours'}${m ? ` ${m} minutes` : ''}`;
}
export function joinNames(names) {
  const n = names.filter((x) => x);
  if (n.length <= 1) return n.join('');
  return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}
export function typeLabelOf(key, typeLists) {
  for (const list of typeLists) {
    const t = (list?.types ?? []).find((x) => x?.key === key);
    if (t && typeof t.label === 'string' && t.label.trim()) return t.label;
  }
  const s = String(key ?? '').replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The "what changed" text for E-4 from INT-01's changes list (rule 6). */
export function whatChanged(changes, newWhere, forCandidate) {
  const out = [];
  if (changes.includes('at')) out.push(CHANGED.at);
  if (changes.includes('length')) out.push(CHANGED.length);
  const whereChanged = changes.includes('where');
  if (whereChanged) out.push(newWhere === 'ONLINE' ? CHANGED.online : CHANGED.inPerson);
  if (!whereChanged && changes.includes('place')) out.push(CHANGED.place);
  if (!whereChanged && changes.includes('link')) out.push(CHANGED.link);
  if (!forCandidate && (changes.includes('panel') || changes.includes('guest'))) out.push(CHANGED.panel);
  return out.join(' ');
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const LINKS = ['link', 'video_link'];

function fill(line, values, html) {
  return line.replace(/\{([a-z_]+)\}/g, (_m, k) => {
    if (k === 'where_line') return fill(values.where === 'ONLINE' ? WHERE_ONLINE : WHERE_IN_PERSON, values, html);
    const v = oneLine(values[k]);
    if (!html) return v;
    return LINKS.includes(k) ? `<a href="${esc(v)}">${esc(v)}</a>` : esc(v);
  });
}

/** Renders one template: { subject, text, html }. Values are made one line first. */
export function render(key, values) {
  const t = INTERVIEW_EMAIL_TEXTS[key];
  const blocks = [];
  for (const b of t.blocks) {
    const lines = Array.isArray(b) ? b : (oneLine(values[b.when]) ? b.lines : null);
    if (!lines) continue;
    blocks.push(lines);
  }
  const greet = (line) => (/^Hi \{(recipient_first_name|first_name)\}\.$/.test(line) && !oneLine(values[line.slice(4, -2)]) ? 'Hi.' : line);
  const textBlocks = blocks.map((ls) => ls.map((l) => fill(greet(l), values, false).replace(/ +$/, '')));
  const htmlBlocks = blocks.map((ls) => ls.map((l) => fill(greet(l), values, true).replace(/ +$/, '')));
  return {
    subject: fill(t.subject, values, false),
    text: textBlocks.map((ls) => ls.join('\n')).join('\n\n'),
    html: htmlBlocks.map((ls) => `<p>${ls.join('<br>')}</p>`).join(''),
  };
}

/** The queued message (rule 8). `invite` is INT-02's { filename, contentType, body }. */
export function messageOf({ tenantId, interviewId, candidateId, sequence, template, who, recipientEmail, replyTo, rendered, invite }) {
  return {
    type: 'INTERVIEW_EMAIL', tenant_id: tenantId, email_id: `${interviewId}#${sequence}#${template}#${who}`, template, interview_id: interviewId, candidate_id: candidateId,
    recipientEmail, ...(replyTo ? { reply_to: replyTo } : {}), subject: rendered.subject, text: rendered.text, html: rendered.html,
    attachment: { name: invite.filename, content_type: invite.contentType, content_base64: Buffer.from(invite.body, 'utf8').toString('base64') },
  };
}

/** The [details] lines (When, Length, Where) of these values, for the calendar file's notes (rule 5). */
export function detailsText(values) {
  return DETAILS.map((l) => fill(l, values, false)).join('\n');
}
