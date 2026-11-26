// INT-01: the rules of an interview's life, shared by the booking, the four actions, the read's `can` and the vote paths.
import * as S from './scoring.mjs';

export const CANCEL_REASONS = ['CANDIDATE_ASKED', 'PANEL_NOT_AVAILABLE', 'CANDIDATE_WITHDREW', 'OTHER'];
export const DNH_REASONS = ['CANDIDATE_DID_NOT_COME', 'INTERVIEWER_DID_NOT_COME', 'OTHER'];
export const DONE_REASONS = ['FEEDBACK_GIVEN_ANOTHER_WAY', 'PANEL_MEMBER_CANNOT_GIVE_FEEDBACK', 'OTHER'];

/** An interview booked the new way (M-1). */
export const isNewWay = (iv) => iv?.sequence !== undefined && iv?.sequence !== null;
/** The guest's voter id (R-21), or null. */
export const guestVoterOf = (iv) => (typeof iv?.guest_link_hash === 'string' && iv.guest_link_hash ? `GUEST#${iv.guest_link_hash.slice(0, 16)}` : null);

/** "Feedback exists" exactly as M-1 says. */
export function hasFeedback(iv, votes) {
  const panel = Array.isArray(iv?.panelMemberIds) ? iv.panelMemberIds : [];
  const guest = guestVoterOf(iv);
  return (votes ?? []).some((v) => v.interviewId === iv.interviewId && S.isNew(v) && (panel.includes(v.voterId) || (guest && v.voterId === guest)));
}

/** Every panel person and the guest (if any) has a new-format vote. */
export function everyoneVoted(iv, votes) {
  const mine = (votes ?? []).filter((v) => v.interviewId === iv.interviewId && S.isNew(v));
  const panel = Array.isArray(iv?.panelMemberIds) ? iv.panelMemberIds : [];
  const guest = guestVoterOf(iv);
  return panel.every((p) => mine.some((v) => v.voterId === p)) && (!guest || mine.some((v) => v.voterId === guest));
}

/**
 * null when `action` is allowed on this interview now, else the 409 code its rule gives.
 * ctx: { now (ms), stage (the candidate's stage), votes (the candidate's vote rows) }.
 */
export function refusalOf(action, iv, ctx) {
  const scheduled = iv?.status === 'SCHEDULED';
  const at = Date.parse(iv?.scheduledAt);
  const started = ctx.now >= at;
  switch (action) {
    case 'reschedule':
      if (!scheduled || ctx.stage !== 'INTERVIEW') return 'NOT_ALLOWED_NOW';
      return hasFeedback(iv, ctx.votes) ? 'HAS_FEEDBACK' : null;
    case 'cancel':
      return scheduled && !started ? null : 'NOT_CANCELLABLE';
    case 'did_not_happen':
      return scheduled && started && !hasFeedback(iv, ctx.votes) ? null : 'NOT_ALLOWED_NOW';
    case 'complete':
      return scheduled && started ? null : 'NOT_ALLOWED_NOW';
    default:
      return 'NOT_ALLOWED_NOW';
  }
}

/** Rule 14 for a signed-in voter: null when a vote is accepted on this interview now, else the code. */
export function voteRefusalOf(iv, nowMs) {
  if (iv?.status === 'COMPLETED') return 'ALREADY_DONE';
  if (iv?.status !== 'SCHEDULED') return 'NOT_ALLOWED_NOW';
  if (nowMs < Date.parse(iv.scheduledAt)) return 'NOT_STARTED';
  return null;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
/** A time with a zone that exists, as ms; else null. */
export function timeOf(v) {
  if (typeof v !== 'string') return null;
  const m = ISO.exec(v);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? '0'].map(Number);
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (mo < 1 || mo > 12 || d < 1 || d > dim || h > 23 || mi > 59 || s > 59) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}
export const isLength = (v) => Number.isInteger(v) && v >= 15 && v <= 240 && v % 15 === 0;
export const isPlace = (v) => typeof v === 'string' && v.trim().length >= 1 && v.length <= 200;
export function isVideoLink(v) {
  if (typeof v !== 'string' || v.length > 500 || !v.startsWith('https://') || /\s/.test(v)) return false;
  try { return new URL(v).protocol === 'https:'; } catch { return false; }
}
export const isEmail = (v) => typeof v === 'string' && v.length <= 254 && /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/.test(v);
export const isNote = (v, max) => typeof v === 'string' && v.length >= 1 && v.length <= max;
