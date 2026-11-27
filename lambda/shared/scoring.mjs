// REC-07: the scoring maths and the checks shared by the vote handlers.
import { createHash } from 'node:crypto';

export const SCALE = { min: 1, max: 5 };
export const LEGACY_SCALE = { min: 0, max: 10 };
export const RATINGS = ['STRONG_NO', 'NO', 'YES', 'STRONG_YES'];
const POSITIVE = new Set(['YES', 'STRONG_YES']);
const NEGATIVE = new Set(['NO', 'STRONG_NO']);

export const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const badScores = () => json(400, { error: 'Bad request', code: 'INVALID_SCORES' });
export const badField = (field) => json(400, { error: 'Bad request', code: 'INVALID_FIELD', field });
export const alreadyScored = () => json(409, { error: 'Conflict', code: 'ALREADY_SCORED' });
export const EXPIRED = () => ({ statusCode: 410, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Scoring link has expired' }) });

export const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');
export const isNew = (v) => v && v.scale && v.scale.max === SCALE.max && v.legacy !== true;

/** The criteria an interview is scored on: its snapshot, else the company's default criteria. */
export function criteriaOf(interview, settings, DEFAULTS) {
  if (Array.isArray(interview?.criteria_snapshot) && interview.criteria_snapshot.length) return interview.criteria_snapshot;
  return (settings?.SCORING_WEIGHTS?.defaultCriteria ?? DEFAULTS.SCORING_WEIGHTS.defaultCriteria).map((c) => ({ key: c.key, label: c.label }));
}

/** null when the body is fine, else the refusal. */
export function checkBody(body, criteria) {
  const s = body?.scores;
  if (!s || typeof s !== 'object' || Array.isArray(s)) return badScores();
  const keys = criteria.map((c) => c.key);
  const got = Object.keys(s);
  if (got.length !== keys.length || !keys.every((k) => got.includes(k))) return badScores();
  if (!keys.every((k) => Number.isInteger(s[k]) && s[k] >= SCALE.min && s[k] <= SCALE.max)) return badScores();
  if (!RATINGS.includes(body?.rating)) return badField('rating');
  if (body.comment !== undefined && (typeof body.comment !== 'string' || body.comment.length > 2000)) return badField('comment');
  return null;
}

export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export const oneDecimal = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);

/** The numbers of one interview from its votes (new ones only), unrounded. */
export function interviewNumbers(interview, criteria, allVotes) {
  const votes = allVotes.filter((v) => v.interviewId === interview.interviewId && isNew(v));
  const panel = Array.isArray(interview.panelMemberIds) ? interview.panelMemberIds : [];
  const voted = new Set(votes.map((v) => v.voterId));
  // INT-01 rule 13: this interview's guest counts too.
  const guest = typeof interview.guest_link_hash === 'string' && interview.guest_link_hash ? `GUEST#${interview.guest_link_hash.slice(0, 16)}` : null;
  const pending = panel.filter((p) => !voted.has(p)).length + (guest && !voted.has(guest) ? 1 : 0);
  const crit = criteria.map((c) => ({ key: c.key, label: c.label, mean: mean(votes.map((v) => v.scores?.[c.key]).filter((x) => Number.isFinite(x))) }));
  const means = crit.map((c) => c.mean).filter((x) => x !== null);
  const overall = votes.length ? mean(means) : null;
  const ratings = votes.map((v) => v.rating);
  const split = ratings.some((r) => POSITIVE.has(r)) && ratings.some((r) => NEGATIVE.has(r));
  let consensus = null;
  if (pending === 0 && votes.length) {
    const counts = {};
    for (const r of ratings) counts[r] = (counts[r] ?? 0) + 1;
    consensus = Math.max(...Object.values(counts)) / votes.length;
  }
  return { votes, pending, criteria: crit, overall, split, consensus };
}

export function finalScore(perInterview) {
  return mean(perInterview.map((x) => x.overall).filter((x) => x !== null));
}
