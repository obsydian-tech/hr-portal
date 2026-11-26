'use strict';

/**
 * scheduleInterview — NH-122 / BE-006, rebuilt by INT-01 (NH-269)
 *
 *   GET   /candidates/{id}/interviews                 the interviews of one candidate (this file)
 *   POST  /candidates/{id}/interviews                 book an interview            (int01.mjs, `book`)
 *   PATCH /candidates/{id}/interviews/{interviewId}   reschedule, cancel, did_not_happen, complete (int01.mjs, `act`)
 *
 * A call with no sign-in (a bus event or a direct invoke) is skipped before any AWS call (INT-01 R-15).
 * DO NOT update SAGA currentStage from this Lambda — the stage stays Interview for all interview types. The move from
 * Interview to Offer (moveCandidate) is gated on all required interview types being COMPLETED.
 *
 * Env vars:
 *   STATE_TABLE_NAME       — talent-flow-state
 *   CONFIG_TABLE_NAME      — talent-flow-config
 *   IDEMPOTENCY_TABLE      — talent-flow-idempotency-keys (INT-01 request keys)
 *   NOTIFICATION_QUEUE_URL — talent-flow-notification-queue.fifo URL
 *   EVENTBRIDGE_BUS_NAME   — talent-flow-bus
 */

const { DynamoDBClient, GetItemCommand, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { tenantHelper } = require('../shared/tf-tenant.js');

const dynamo = new DynamoDBClient({});

function badRequest(message) { return { statusCode: 400, body: JSON.stringify({ error: message }) }; }
function serverError(message){ return { statusCode: 500, body: JSON.stringify({ error: message }) }; }
function ok(body)            { return { statusCode: 200, body: JSON.stringify(body) }; }


// ── Main handler ──────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  // INT-01 (R-15): no sign-in, no run. A bus event or a direct invoke is skipped before any AWS call.
  if (!event.requestContext) {
    console.warn('scheduleInterview: skipped', { error: 'NO_SIGN_IN' });
    return { statusCode: 200, body: JSON.stringify({ skipped: true }) };
  }
  const method = event.requestContext?.http?.method;
  const RA = await import('../shared/recruitment-access.mjs');
  if (method === 'POST' || method === 'PATCH') {
    // REC-01, R-8: booking and changing an interview is the Recruiter's. The role answer comes first, before any AWS call.
    const notRecruiter = RA.requireRecruiter(event);
    if (notRecruiter) return notRecruiter;
    const I1 = await import('./int01.mjs');
    return method === 'POST' ? I1.book(event) : I1.act(event);
  }
  const T = await tenantHelper();

  // Anyone with a sign-in may read; the company comes from the sign-in (TEN-03), never from the body, path or headers.
  // REC-01: reading the interviews of one candidate is open to a Recruiter, the candidate's hiring manager and the panel
  // members of its interviews, and is judged on the rows (404 when not theirs). The role answer comes before any AWS call.
  const t = T.requireTenant(event);
  if (t.refusal) return t.refusal;
  // MOD-01: Recruitment must be on for the company (after the company check, before any other AWS call).
  const { requireModule } = await import('../shared/modules.mjs');
  const moduleOff = await requireModule(event, 'recruitment');
  if (moduleOff) return moduleOff;
  const tenantId = t.tenantId;

  // ── GET: list all interviews + votes for a candidate ─────────────────────
  if (method === 'GET') {
    const candidateId = event.pathParameters?.id;
    if (!candidateId) return badRequest('Missing candidateId');
    try {
      // The candidate is this company's, or it is not found.
      const own = await dynamo.send(new GetItemCommand({
        TableName: process.env.STATE_TABLE_NAME,
        Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'SAGA' }),
      }));
      if (!own.Item || !T.ownsRow(unmarshall(own.Item), tenantId)) return T.notFound();
      const candidate = unmarshall(own.Item);

      // Fetch INTERVIEW# records
      const interviewResult = await dynamo.send(new QueryCommand({
        TableName: process.env.STATE_TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: marshall({ ':pk': `CANDIDATE#${candidateId}`, ':prefix': 'INTERVIEW#' }),
      }));
      const rows = (interviewResult.Items || []).map((i) => unmarshall(i)).filter((r) => T.ownsRow(r, tenantId));

      // REC-01: a Recruiter and the hiring manager see every interview of the candidate; a panel member only their own.
      // Anyone else answers like a candidate that does not exist.
      const relation = await RA.relationOf(event, candidate, async () => rows);
      if (!relation) return T.notFound();
      const me = RA.callerId(event);
      // REC-15 step D (D-5): the read never writes; the candidate's own settings, read without locking an older row.
      const RS = await import('../shared/recruitment-settings.mjs');
      const { settings } = await RS.settingsForRead(tenantId, candidate);
      // REC-07: a hiring manager who is not the decider sees no vote; a panel member nothing worked out from others' votes.
      let seesVotes = true;
      if (relation === 'hiringManager') {
        seesVotes = RA.canDecide(event, candidate, (settings.REJECTION_RULES ?? RS.DEFAULTS.REJECTION_RULES).decider?.[candidate.positionLevel]);
      }
      const mineRows = rows
        .filter((r) => relation !== 'panel' || RA.panelMemberOf(r, me))
        .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

      // Fetch all VOTE# records for this candidate and attach per interview
      const voteResult = await dynamo.send(new QueryCommand({
        TableName: process.env.STATE_TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: marshall({ ':pk': `CANDIDATE#${candidateId}`, ':prefix': 'VOTE#' }),
        ProjectionExpression: 'voterId, rating, weightedScore, interviewId, createdAt, submittedByTA, scores, #c, scale, on_behalf, entered_by',
        ExpressionAttributeNames: { '#c': 'comment' },
      }));
      const stored = (voteResult.Items || []).map((i) => unmarshall(i));
      const allVotes = stored.map((v) => ({
        voterId:       v.voterId      ?? null,
        rating:        v.rating       ?? null,
        weightedScore: v.weightedScore ?? null,
        interviewId:   v.interviewId  ?? null,
        submittedAt:   v.createdAt    ?? null,
        submittedByTA: v.submittedByTA ?? null,
        scores:        v.scores       ?? null,
        comment:       v.comment      ?? null,
      })).filter((v) => (relation !== 'panel' || v.voterId === me) && seesVotes);

      const PN = await import('../shared/people-names.mjs');
      const FD = await import('../shared/feedback-due.mjs');
      const I1 = await import('./int01.mjs');
      const people = relation === 'panel' ? [me] : mineRows.flatMap((r) => (Array.isArray(r.panelMemberIds) ? r.panelMemberIds : []));
      const extraPeople = mineRows.flatMap((r) => [r.closed_by]).concat(stored.filter((v) => v.on_behalf && v.entered_by).map((v) => v.entered_by)).filter((x) => typeof x === 'string');
      const names = await PN.namesOf(tenantId, [...people, ...extraPeople]);
      const linkRows = {};
      if (relation === 'recruiter') {
        for (const r of mineRows.filter((x) => x.guest_link_hash)) {
          const l = await dynamo.send(new GetItemCommand({ TableName: process.env.STATE_TABLE_NAME, Key: marshall({ PK: `SCORING_LINK#${r.guest_link_hash}`, SK: 'META' }) }));
          if (l.Item) linkRows[r.guest_link_hash] = unmarshall(l.Item);
        }
      }
      const dctx = { relation, seesVotes, event, saga: candidate, settings, votes: stored, links: linkRows, names, nowMs: Date.now() };
      const KEPT = ['interviewId', 'candidateId', 'interviewType', 'scheduledAt', 'panelMemberIds', 'adhocPanelMembers', 'votesRequired', 'votesSubmitted',
        'status', 'completedAt', 'createdAt', 'criteria_snapshot', 'PANEL_SPLIT_FLAG', 'PANEL_CONSENSUS'];
      const interviewsWithVotes = mineRows.map((r) => {
        const out = {};
        for (const k of KEPT) if (r[k] !== undefined) out[k] = r[k];
        const votesHere = stored.filter((v) => v.interviewId === r.interviewId);
        const due = FD.feedbackDueAt(r.scheduledAt, settings.SLA_THRESHOLDS);
        const entry = (base, given) => ({ ...base, feedback: given ? 'GIVEN' : 'WAITING', due_at: given ? null : due });
        const persons = relation === 'panel' ? [me] : (Array.isArray(r.panelMemberIds) ? r.panelMemberIds : []);
        const dec = I1.decorate(r, dctx);
        const panel = persons.map((pid) => ({ ...entry({ kind: 'PERSON', person_id: pid, name: names[pid] ?? null }, votesHere.some((v) => v.voterId === pid)), ...dec.personExtra(pid) }));
        if (dec.guestEntry) panel.push(dec.guestEntry);
        if (relation !== 'panel') {
          for (const g of Array.isArray(r.adhocPanelMembers) ? r.adhocPanelMembers : []) {
            const email = typeof g?.email === 'string' ? g.email.toLowerCase() : null;
            const nm = typeof g?.name === 'string' && g.name.trim() ? g.name.trim() : null;
            panel.push(entry({ kind: 'GUEST', name: nm }, !!email && votesHere.some((v) => typeof v.voterId === 'string' && v.voterId.toLowerCase() === email)));
          }
        }
        if (relation === 'panel') {
          out.panelMemberIds = [me];
          delete out.adhocPanelMembers; delete out.votesSubmitted; delete out.PANEL_SPLIT_FLAG; delete out.PANEL_CONSENSUS;
        }
        return {
          ...out, id: r.interviewId ?? null, type: r.interviewType ?? null, at: r.scheduledAt ?? null, ...dec.out, panel,
          votes: allVotes.filter((v) => v.interviewId === r.interviewId),
        };
      });

      let required = null;
      if (relation !== 'panel') {
        const S = await import('../shared/recruitment-stages.mjs');
        const PROG = await import('../shared/recruitment-actions/candidate-progress.mjs');
        const stage = S.normaliseStage(candidate) ?? 'APPLIED';
        if (['INTERVIEW', 'OFFER', 'HIRED', 'NOT_HIRED'].includes(stage)) {
          const req = PROG.requiredInterviews(settings, candidate, new Set(rows.filter((i) => i.status === 'COMPLETED').map((i) => i.interviewType)));
          required = { done: req.done, total: req.total };
        }
      }
      return ok({ interviews: interviewsWithVotes, required });
    } catch (err) {
      console.error('GET interviews: query failed', { candidateId, error: err.name });
      return serverError('Failed to fetch interviews');
    }
  }

  return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
};
