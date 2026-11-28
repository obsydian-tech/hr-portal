// REC-09 rule 4: the approved flag titles (Group G of the approved wording), one per rule. {stage}, {name} and {day} are filled when a
// flag is made. Nothing else in the code holds flag wording.
export const FLAG_TITLES = {
  'RULE-SLA-002': 'Waiting too long in {stage}',
  'RULE-SLA-001': 'Over time in {stage}',
  'RULE-FEEDBACK-001': 'Feedback overdue from {name}',
  'RULE-MISSED-001': 'Missed interview',
  'RULE-PANEL-001': 'Panel split on {name}',
  'RULE-STRONGNO-001': 'Strong no from {name}: read before deciding',
  'RULE-DECISION-001': 'Decision needed on {name}',
  'RULE-APPROVAL-001': 'Offer approval waiting',
  'RULE-OFFER-001': 'Offer expires {day}',
};
export const STAGE_LABELS = { APPLIED: 'Applied', SCREENING: 'Screening', INTERVIEW: 'Interview', OFFER: 'Offer', HIRED: 'Hired', NOT_HIRED: 'Not hired' };
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** The weekday name of a YYYY-MM-DD day. */
export const dayName = (ymd) => (/^\d{4}-\d{2}-\d{2}$/.test(String(ymd)) ? DAYS[new Date(`${ymd}T12:00:00Z`).getUTCDay()] : '');
/** The title of a rule's flag, with its placeholders filled; null for a rule that has no approved title. */
export function flagTitle(ruleId, values = {}) {
  const t = FLAG_TITLES[ruleId];
  if (!t) return null;
  return t.replace(/\{(stage|name|day)\}/g, (_m, k) => String(values[k] ?? ''));
}
