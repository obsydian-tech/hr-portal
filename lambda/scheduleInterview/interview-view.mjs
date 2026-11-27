// INT-01: what the interviews read adds to each interview for this caller (rule 6, R-2, S-5).
// Kept apart from int01.mjs so the read does not load the write path.
import * as RA from '../shared/recruitment-access.mjs';
import { DEFAULTS } from '../shared/recruitment-settings.mjs';
import { normaliseStage } from '../shared/recruitment-stages.mjs';
import * as L from '../shared/interview-lifecycle.mjs';
import { mean, oneDecimal } from '../shared/scoring.mjs';

/** What INT-01 adds to one interview of the read, for this caller. */
export function decorate(r, o) {
  const { relation, seesVotes, event, saga, settings, votes, links, names, nowMs } = o;
  const recruiter = relation === 'recruiter';
  const me = RA.callerId(event);
  const mine = votes.filter((v) => v.interviewId === r.interviewId);
  const marked = r.status === 'COMPLETED' && typeof r.closed_reason === 'string';
  const voteOf = (pid) => mine.find((v) => v.voterId === pid);
  const stage = normaliseStage(saga);
  const ctx = { now: nowMs, stage, votes };
  const can = { reschedule: false, cancel: false, did_not_happen: false, mark_done: false, capture_feedback: false };
  if (recruiter) {
    can.reschedule = !L.refusalOf('reschedule', r, ctx);
    can.cancel = !L.refusalOf('cancel', r, ctx);
    can.did_not_happen = !L.refusalOf('did_not_happen', r, ctx);
    can.mark_done = !L.refusalOf('complete', r, ctx);
    const hrMay = (settings.PANEL_CONFIG ?? DEFAULTS.PANEL_CONFIG).hrMayEnterForMember !== false;
    can.capture_feedback = hrMay && !L.voteRefusalOf(r, nowMs) && (r.panelMemberIds ?? []).some((p) => !mine.some((v) => v.voterId === p));
  } else if (RA.panelMemberOf(r, me)) {
    can.capture_feedback = !L.voteRefusalOf(r, nowMs) && !mine.some((v) => v.voterId === me);
  }
  const out = {
    status: r.status ?? null, length_minutes: r.length_minutes ?? null, where: r.where ?? null, place: r.place ?? null, video_link: r.video_link ?? null,
    sequence: L.isNewWay(r) ? r.sequence : null, closed_reason: r.closed_reason ?? null, closed_by_name: r.closed_by ? (names[r.closed_by] ?? null) : null, closed_at: r.closed_at ?? null, can,
  };
  if (recruiter) { if (r.candidate_note !== undefined) out.candidate_note = r.candidate_note; if (r.closed_note !== undefined) out.closed_note = r.closed_note; }
  // One place works out a stored vote's numbers, for a panel person and for the guest (INT-01.F rule 4).
  const voteShape = (v) => {
    const crit = (r.criteria_snapshot ?? []).map((c) => c.key);
    const sc = crit.length ? crit.map((k) => v.scores?.[k]).filter((n) => Number.isFinite(n)) : Object.values(v.scores ?? {}).filter((n) => Number.isFinite(n));
    return { rating: v.rating ?? null, overall: oneDecimal(mean(sc)), on_behalf_by_name: v.on_behalf && v.entered_by ? (names[v.entered_by] ?? null) : null };
  };
  const personExtra = (pid) => {
    const v = voteOf(pid);
    const x = {};
    if (v && seesVotes && (relation !== 'panel' || pid === me)) x.vote = voteShape(v);
    if (marked && !v) x.no_feedback = true;
    return x;
  };
  const guest = L.guestVoterOf(r);
  let guestEntry = null;
  if (guest && relation !== 'panel') {
    const gv = mine.find((v) => v.voterId === guest);
    guestEntry = { kind: 'GUEST', name: null, feedback: gv ? 'GIVEN' : 'WAITING', due_at: null, ...(recruiter ? { email: links[r.guest_link_hash]?.guest_email ?? null } : {}), ...(gv && seesVotes ? { vote: voteShape(gv) } : {}), ...(marked && !gv ? { no_feedback: true } : {}) };
  }
  return { out, personExtra, guestEntry };
}
