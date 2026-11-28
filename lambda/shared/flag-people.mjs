// REC-09 rule 4: the person a flag title names. FEEDBACK-001 names the first panel member who owes feedback; STRONGNO-001 names the
// person who voted Strong no. Pure on rows already read; the names come from people-names.mjs.
import { feedbackDueAt } from './feedback-due.mjs';
import { namesOf } from './people-names.mjs';

/** Panel members whose feedback is due (the interview's time plus feedbackDueHours has passed) and who have not voted, in panel order. */
export function pendingFeedback(interviews, votes, slaThresholds, now = Date.now()) {
  const people = [];
  for (const iv of interviews ?? []) {
    if (!['SCHEDULED', 'COMPLETED'].includes(iv.status)) continue;
    const due = feedbackDueAt(iv.scheduledAt, slaThresholds);
    if (!due || Date.parse(due) > now) continue;
    const voted = new Set((votes ?? []).filter((v) => v.interviewId === iv.interviewId).map((v) => v.voterId));
    for (const m of iv.panelMemberIds ?? []) if (!voted.has(m)) people.push(m);
  }
  return people;
}

/** The rules whose title names a panel member instead of the candidate. */
export const namesAPerson = (ruleId) => ruleId === 'RULE-STRONGNO-001' || ruleId === 'RULE-FEEDBACK-001';

/** The name a rule's title uses in place of the candidate's, or '' when the rule names the candidate (or the person has no name). */
export async function flagPersonName(tenantId, ruleId, { interviews, votes, slaThresholds }) {
  let id;
  if (ruleId === 'RULE-STRONGNO-001') id = (votes ?? []).find((v) => v.rating === 'STRONG_NO')?.voterId;
  else if (ruleId === 'RULE-FEEDBACK-001') id = pendingFeedback(interviews, votes, slaThresholds)[0];
  if (!id) return null;
  return (await namesOf(tenantId, [id]))[id] ?? '';
}
