/**
 * INT-04 (NH-277) AC-3: Iggie's approved interview emails, copied character for character from
 * specs/interview-journey/EMAILS-DRAFT.md (approved 26 Nov 2026 14:08 SAST). Test support only: these are the expected texts, and
 * the allow-list of AC-3's text check. Nothing here is application code.
 *
 * Reading of the draft (pinned in cards/int-04.md, T-1): a body is blocks separated by one blank line; the shared [details] block is
 * its three lines (When, Length, Where), which sit inside "The new details:" block in E-4; a "[only when ...]" line is a block of its
 * own that is left out with its blank line when the value is missing; the greeting with no first name is "Hi."; lines end with "\n",
 * the last line has no line break after it; a line whose last value is empty ends at its full stop with no trailing space.
 */

export const DRAFT_DETAILS = ['When: {date} at {time} ({zone})', 'Length: {length}', 'Where: In person, {place}', 'Where: Online, {video_link}'];

type Block = string[] | { when: string; lines: string[] };
export const APPROVED: Record<string, { subject: string; blocks: Block[] }> = {
  E1: { subject: 'Interview: {candidate}, {role}, {date}', blocks: [['Hi {recipient_first_name}.'], ['You are on the panel for a {type} interview with {candidate} for {role}.'], ['[details]'], ["See {candidate}'s details: {link}"], ['You can give feedback from the start of the interview. The calendar invite is attached.'], ['Naleko People']] },
  E2: { subject: 'Interview: {candidate}, {role}, {date}', blocks: [['Hi {recipient_first_name}.'], ['You are invited to a {type} interview with {candidate} for {role} at {company}.'], ['[details]'], ['Give your feedback here: {link}', 'The link works once, from the start of the interview until {expires}. Please do not share it.'], ['The calendar invite is attached.'], ['Naleko People']] },
  E3: { subject: 'Your interview for {role} at {company}', blocks: [['Hi {first_name}.'], ['{company} would like to meet you for an interview for {role}.'], ['[details]'], ['You will meet {panel_first_names}.'], { when: 'note', lines: ['A note from {company}: {note}'] }, ['The calendar invite is attached. If the time does not suit you, reply to this email.'], ['{company}']] },
  E4P: { subject: 'Interview changed: {candidate}, {role}, {date}', blocks: [['Hi {recipient_first_name}.'], ['The {type} interview with {candidate} for {role} has changed. {what_changed}'], ['The new details:', '[details]'], { when: 'reason', lines: ['Reason: {reason}'] }, ['An updated calendar invite is attached.'], ['Naleko People']] },
  E4G: { subject: 'Interview changed: {candidate}, {role}, {date}', blocks: [['Hi {recipient_first_name}.'], ['The {type} interview with {candidate} for {role} at {company} has changed. {what_changed}'], ['The new details:', '[details]'], { when: 'reason', lines: ['Reason: {reason}'] }, ['Give your feedback here: {link}', 'The link works once, from the start of the interview until {expires}. Please do not share it.'], ['An updated calendar invite is attached.'], ['Naleko People']] },
  E4C: { subject: 'Your interview for {role} at {company} has changed', blocks: [['Hi {first_name}.'], ['Your interview for {role} at {company} has changed. {what_changed}'], ['The new details:', '[details]'], { when: 'panel_first_names', lines: ['You will meet {panel_first_names}.'] }, ['An updated calendar invite is attached. If the new time does not suit you, reply to this email.'], ['{company}']] },
  E5P: { subject: 'Interview cancelled: {candidate}, {role}, {date}', blocks: [['Hi {recipient_first_name}.'], ['The {type} interview with {candidate} for {role} on {date} at {time} is cancelled.'], { when: 'reason', lines: ['Reason: {reason}'] }, ['A calendar file for the cancelled interview is attached.'], ['Naleko People']] },
  E5G: { subject: 'Interview cancelled: {candidate}, {role}, {date}', blocks: [['Hi {recipient_first_name}.'], ['The {type} interview with {candidate} for {role} at {company} on {date} at {time} is cancelled. Your feedback link no longer works.'], { when: 'reason', lines: ['Reason: {reason}'] }, ['A calendar file for the cancelled interview is attached.'], ['Naleko People']] },
  E5C: { subject: 'Your interview for {role} at {company} is cancelled', blocks: [['Hi {first_name}.'], ['Your interview for {role} at {company} on {date} at {time} is cancelled.'], ['A calendar file for the cancelled interview is attached. If you have questions, reply to this email.'], ['{company}']] },
  E6P: { subject: 'You are no longer on the panel: {candidate}, {role}', blocks: [['Hi {recipient_first_name}.'], ['You are no longer on the panel for the {type} interview with {candidate} for {role} on {date}.'], ['A calendar file for this interview is attached.'], ['Naleko People']] },
  E6G: { subject: 'You are no longer on the panel: {candidate}, {role}', blocks: [['Hi {recipient_first_name}.'], ['You are no longer on the panel for the {type} interview with {candidate} for {role} on {date}.'], ['Your feedback link no longer works.'], ['A calendar file for this interview is attached.'], ['Naleko People']] },
};

/** The approved "what changed" lines (Q-7), in the approved order. */
export const WHAT_CHANGED = ['The date or time has changed.', 'The length has changed.', 'The place has changed.', 'The video link has changed.', 'It is now online.', 'It is now in person.', 'The panel has changed.'];
/** The approved cancel reason labels (S-4, WORDS-OWED.md). */
export const CANCEL_LABELS = ['Candidate asked', 'Panel not available', 'Candidate withdrew', 'Other'];

/** The expected subject and text of one email, with the values given (every value exactly as the email must show it). */
export function expected(template: string, v: Record<string, string | undefined>): { subject: string; text: string } {
  const t = APPROVED[template]!;
  const fill = (line: string) => line.replace(/\{([a-z_]+)\}/g, (_m, k) => v[k] ?? '');
  const lines: string[][] = [];
  for (const b of t.blocks) {
    const ls = Array.isArray(b) ? b : (v[b.when] ? b.lines : null);
    if (!ls) continue;
    lines.push(ls.flatMap((l) => (l === '[details]' ? [DRAFT_DETAILS[0]!, DRAFT_DETAILS[1]!, v['where'] === 'ONLINE' ? DRAFT_DETAILS[3]! : DRAFT_DETAILS[2]!] : [l])));
  }
  const greet = (l: string) => (l === 'Hi {recipient_first_name}.' && !v['recipient_first_name']) || (l === 'Hi {first_name}.' && !v['first_name']) ? 'Hi.' : l;
  const text = lines.map((ls) => ls.map((l) => fill(greet(l)).replace(/ +$/, '')).join('\n')).join('\n\n');
  return { subject: fill(t.subject), text };
}

/**
 * AC-3's allow-list: the subject and body lines of EMAILS-DRAFT.md (each [details] line, each "what changed" line, the four cancel
 * labels), plus the forms the approved points use for values (W-17 lengths, P-1 name joining) and rule 9's one piece of link markup.
 */
export const ALLOWED_LINES: string[] = [
  ...new Set([
    ...Object.values(APPROVED).flatMap((t) => [t.subject, ...t.blocks.flatMap((b) => (Array.isArray(b) ? b : b.lines)).filter((l) => l !== '[details]')]),
    ...DRAFT_DETAILS, ...WHAT_CHANGED, ...CANCEL_LABELS,
    // W-17 (approved 25 Nov): "15 minutes, 30 minutes, 45 minutes, 1 hour, 1 hour 15 minutes ... 4 hours".
    '45 minutes', '1 hour 15 minutes', '4 hours',
    // P-1 (spec, points for Iggie): panel first names joined "Thandi and Sipho", "Thandi, Sipho and Lerato".
    'Thandi and Sipho', 'Thandi, Sipho and Lerato',
    // Rule 9: {link} and {video_link} also wrapped as <a href="...">...</a>.
    '<a href="',
  ]),
];
/** Rule 11's log codes and rule 10's outcome codes (no space, so never judged; listed for the record). */
export const CODES = ['EMAILS_OFF', 'CANDIDATE_EMAILS_OFF', 'OLD_INTERVIEW', 'NO_BOOKER', 'PERSON_NOT_FOUND', 'NO_COMPANY_NAME', 'SETTING_MISSING', 'NOT_QUEUED',
  'NO_ROLE', 'NO_CANDIDATE_NAME', 'SETTINGS_BAD', 'BAD_MESSAGE', 'ALREADY_SENT', 'SENT', 'SEND_FAILED', 'SEND_UNKNOWN'];

/**
 * Is a piece of literal text allowed? Text with no space next to a letter is not judged. Otherwise, with every placeholder written as
 * `{name}` or `${...}` taken out, each remaining piece must be found inside one allowed line.
 */
export function allowedPiece(s: string): boolean {
  if (!/[A-Za-z] | [A-Za-z]/.test(s)) return true;
  const pieces = s.split(/\{[a-z_]+\}|\u0000/).filter((p) => /[A-Za-z] | [A-Za-z]/.test(p));
  return pieces.every((p) => ALLOWED_LINES.some((l) => l.includes(p)));
}
