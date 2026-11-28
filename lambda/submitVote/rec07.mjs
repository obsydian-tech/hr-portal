// REC-07: POST /v1/interviews/{id}/votes and GET /v1/candidates/{id}/scores.
import { DynamoDBClient, GetItemCommand, UpdateItemCommand, QueryCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { voteRefusalOf } from '../shared/interview-lifecycle.mjs';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import * as T from '../shared/tenant.mjs';
import * as RA from '../shared/recruitment-access.mjs';
import { requireModule } from '../shared/modules.mjs';
import { getRecruitmentSettings, activeSettings, DEFAULTS } from '../shared/recruitment-settings.mjs';
import * as S from '../shared/scoring.mjs';
import { candidateRows, recomputeInterview, sequenceClause } from '../shared/interview-scoring.mjs';
import * as FD from '../shared/feedback-due-rows.mjs';

const db = new DynamoDBClient({});
const eb = new EventBridgeClient({});
const STATE = () => process.env.STATE_TABLE_NAME;
const parse = (event) => { try { return typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body ?? {}); } catch { return null; } };

export async function vote(event) {
  const t = T.requireTenant(event);
  if (t.refusal) return t.refusal;
  const off = await requireModule(event, 'recruitment');
  if (off) return off;
  const tenantId = t.tenantId;
  const ivId = event.pathParameters?.id;
  if (!ivId) return T.notFound();
  let interview;
  try {
    const r = await db.send(new QueryCommand({ TableName: STATE(), IndexName: 'interview-id-index', KeyConditionExpression: 'interviewId = :i', ExpressionAttributeValues: marshall({ ':i': ivId }) }));
    interview = (r.Items ?? []).map((i) => unmarshall(i)).find((x) => String(x.SK).startsWith('INTERVIEW#') && T.ownsRow(x, tenantId));
  } catch (err) {
    console.error('submitVote: interview read failed', { error: err.name });
    return S.json(500, { error: 'Internal error' });
  }
  if (!interview) return T.notFound();
  // INT-01.F rule 2.1: the index copy only finds the row. Everything below is judged on a strong read of the row itself.
  const ivKey = { PK: `CANDIDATE#${interview.candidateId}`, SK: `INTERVIEW#${interview.interviewId}` };
  try {
    const strong = await db.send(new GetItemCommand({ TableName: STATE(), Key: marshall(ivKey), ConsistentRead: true }));
    interview = strong.Item ? unmarshall(strong.Item) : null;
  } catch (err) {
    console.error('submitVote: interview read failed', { error: err.name });
    return S.json(500, { error: 'Internal error' });
  }
  if (!interview || !T.ownsRow(interview, tenantId)) return T.notFound();
  const body = parse(event);
  const me = RA.callerId(event);
  let voter = me;
  let onBehalf = false;
  let settings;
  const sagaRes = await db.send(new GetItemCommand({ TableName: STATE(), Key: marshall({ PK: `CANDIDATE#${interview.candidateId}`, SK: 'SAGA' }) }));
  const saga = sagaRes.Item ? unmarshall(sagaRes.Item) : null;
  if (!saga || !T.ownsRow(saga, tenantId)) return T.notFound();
  if (body && body.on_behalf_of !== undefined) {
    if (!RA.isRecruiter(event)) return RA.forbidden();
    settings = await activeSettings(tenantId);
    if ((settings.PANEL_CONFIG ?? DEFAULTS.PANEL_CONFIG).hrMayEnterForMember === false) return RA.forbidden();
    if (!RA.panelMemberOf(interview, body.on_behalf_of)) return S.badField('on_behalf_of');
    voter = body.on_behalf_of;
    onBehalf = true;
  } else if (!RA.panelMemberOf(interview, me)) return RA.forbidden();
  settings ??= await activeSettings(tenantId);
  if (!body) return S.badScores();
  const refusal = S.checkBody(body, S.criteriaOf(interview, settings, DEFAULTS));
  if (refusal) return refusal;
  const nowMs = Date.now();
  const early = voteRefusalOf(interview, nowMs);
  if (early) return S.json(409, { error: 'Conflict', code: early });
  const rows = await candidateRows(interview.candidateId);
  if (rows.some((r) => String(r.SK).startsWith(`VOTE#${voter}#`) && r.interviewId === interview.interviewId)) return S.alreadyScored();
  // Rule 2.2: the interview part of the transaction holds the sequence of the copy the panel was judged on.
  const send = async (iv, atMs) => {
    const at = new Date(atMs).toISOString();
    const seq = sequenceClause(iv);
    const item = T.stampTenant({
      PK: `CANDIDATE#${iv.candidateId}`, SK: `VOTE#${voter}#${iv.interviewId}`, voterId: voter, candidateId: iv.candidateId, interviewId: iv.interviewId,
      scores: body.scores, rating: body.rating, ...(body.comment !== undefined ? { comment: body.comment } : {}), scale: S.SCALE, on_behalf: onBehalf,
      ...(onBehalf ? { entered_by: me } : {}), createdAt: at,
    }, tenantId);
    // INT-01 (R-18): the vote, its guard row and the counter in one transaction, on a SCHEDULED interview that has started.
    await db.send(new TransactWriteItemsCommand({ TransactItems: [
      { Put: { TableName: STATE(), Item: marshall(item, { removeUndefinedValues: true }), ConditionExpression: 'attribute_not_exists(SK)' } },
      { Put: { TableName: STATE(), Item: marshall(T.stampTenant({ PK: `CANDIDATE#${iv.candidateId}`, SK: `VOTED#${iv.interviewId}#${voter}`, createdAt: at }, tenantId)), ConditionExpression: 'attribute_not_exists(PK)' } },
      { Update: { TableName: STATE(), Key: marshall(ivKey), UpdateExpression: 'ADD votesSubmitted :one', ConditionExpression: `tenant_id = :t AND #s = :sch AND scheduledAt <= :now AND ${seq.expr}`, ExpressionAttributeNames: { '#s': 'status', '#q': 'sequence' }, ExpressionAttributeValues: marshall({ ':one': 1, ':t': tenantId, ':sch': 'SCHEDULED', ':now': at, ...seq.values }) } },
      FD.doneItem(STATE(), tenantId, voter, iv.candidateId, iv.interviewId, 'VOTED', at),
    ] }));
    return at;
  };
  let now;
  let judged = interview;
  try {
    now = await send(judged, nowMs);
  } catch (err) {
    if (err.name !== 'TransactionCanceledException') {
      console.error('submitVote: vote write failed', { error: err.name });
      return S.json(500, { error: 'Internal error' });
    }
    // Rule 2.4: one retry. Judge again, strongly, as a fresh request would be judged; nothing is written on any refusal.
    try {
      const again = await db.send(new GetItemCommand({ TableName: STATE(), Key: marshall(ivKey), ConsistentRead: true }));
      judged = again.Item ? unmarshall(again.Item) : null;
      if (!judged || !T.ownsRow(judged, tenantId)) return T.notFound();
      if (onBehalf ? !RA.panelMemberOf(judged, voter) : !RA.panelMemberOf(judged, me)) return onBehalf ? S.badField('on_behalf_of') : RA.forbidden();
      const retryNowMs = Date.now();
      const code = voteRefusalOf(judged, retryNowMs);
      if (code) return S.json(409, { error: 'Conflict', code });
      const rows2 = await candidateRows(judged.candidateId);
      if (rows2.some((r) => (String(r.SK).startsWith(`VOTE#${voter}#`) && r.interviewId === judged.interviewId) || r.SK === `VOTED#${judged.interviewId}#${voter}`)) return S.alreadyScored();
      now = await send(judged, retryNowMs);
    } catch (err2) {
      if (err2.name === 'TransactionCanceledException') return S.json(409, { error: 'Conflict', code: 'NOT_ALLOWED_NOW' });
      console.error('submitVote: vote write failed', { error: err2.name });
      return S.json(500, { error: 'Internal error' });
    }
  }
  interview = judged;
  const rules = (await getRecruitmentSettings(tenantId, saga)).REJECTION_RULES ?? DEFAULTS.REJECTION_RULES;
  if (body.rating === 'STRONG_NO' && rules.reviewVoteLevel === 'STRONG_NO') {
    await db.send(new UpdateItemCommand({ TableName: STATE(), Key: marshall({ PK: `CANDIDATE#${interview.candidateId}`, SK: 'SAGA' }), UpdateExpression: 'ADD strong_no_count :one', ExpressionAttributeValues: marshall({ ':one': 1 }) }));
  }
  const n = await recomputeInterview(tenantId, interview, settings);
  if (n.pending === 0) {
    // Rule 5: the event carries the final score over every interview of the candidate, worked out from the stored votes.
    const all = (await candidateRows(interview.candidateId)).filter((r) => T.ownsRow(r, tenantId));
    const allVotes = all.filter((r) => String(r.SK).startsWith('VOTE#'));
    const per = all.filter((r) => String(r.SK).startsWith('INTERVIEW#')).map((iv) => S.interviewNumbers(iv, S.criteriaOf(iv, settings, DEFAULTS), allVotes));
    const fs = S.finalScore(per);
    try {
      await eb.send(new PutEventsCommand({ Entries: [{ EventBusName: process.env.EVENTBRIDGE_BUS_NAME, Source: 'talent-flow.workflow', DetailType: 'VotingCompleted', Detail: JSON.stringify({ candidateId: interview.candidateId, tenant_id: tenantId, result: 'COMPLETED', averageScore: fs }) }] }));
    } catch (err) { console.error('submitVote: event failed', { error: err.name }); }
  }
  return S.json(201, { vote: { interview_id: interview.interviewId, voter_id: voter, scores: body.scores, rating: body.rating, comment: body.comment ?? null, on_behalf: onBehalf, submitted_at: now } });
}

const voteOut = (v) => (S.isNew(v)
  ? { voter_id: v.voterId, scores: v.scores, rating: v.rating, comment: v.comment ?? null, on_behalf: v.on_behalf === true, entered_by: v.entered_by ?? null, submitted_at: v.createdAt ?? null }
  : { voter_id: v.voterId, scores: v.scores, rating: v.rating ?? null, comment: v.comment ?? null, legacy: true, scale: S.LEGACY_SCALE, submitted_at: v.createdAt ?? null });

export async function sheet(event) {
  const t = T.requireTenant(event);
  if (t.refusal) return t.refusal;
  const off = await requireModule(event, 'recruitment');
  if (off) return off;
  const tenantId = t.tenantId;
  const cid = event.pathParameters?.id;
  const sagaRes = await db.send(new GetItemCommand({ TableName: STATE(), Key: marshall({ PK: `CANDIDATE#${cid}`, SK: 'SAGA' }) }));
  const saga = sagaRes.Item ? unmarshall(sagaRes.Item) : null;
  if (!saga || !T.ownsRow(saga, tenantId)) return T.notFound();
  const rows = (await candidateRows(cid)).filter((r) => T.ownsRow(r, tenantId));
  const ivs = rows.filter((r) => String(r.SK).startsWith('INTERVIEW#')).sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
  const votes = rows.filter((r) => String(r.SK).startsWith('VOTE#'));
  const relation = await RA.relationOf(event, saga, async () => ivs);
  if (!relation) return T.notFound();
  const me = RA.callerId(event);
  const settings = await getRecruitmentSettings(tenantId, saga);
  const ownOnly = () => S.json(200, { candidate_id: cid, interviews: ivs.filter((iv) => RA.panelMemberOf(iv, me)).map((iv) => ({
    interview_id: iv.interviewId, criteria: S.criteriaOf(iv, settings, DEFAULTS).map((c) => ({ key: c.key, label: c.label })),
    votes: votes.filter((v) => v.interviewId === iv.interviewId && v.voterId === me).map(voteOut),
  })) });
  if (relation === 'panel') return ownOnly();
  const decider = (settings.REJECTION_RULES ?? DEFAULTS.REJECTION_RULES).decider?.[saga.positionLevel];
  const all = relation === 'recruiter' || RA.canDecide(event, saga, decider);
  // INT-01 AC-19: a hiring manager who does not decide sees only their own votes when on a panel, else 403.
  if (!all) return ivs.some((iv) => RA.panelMemberOf(iv, me)) ? ownOnly() : S.json(403, { error: 'Forbidden' });
  const per = ivs.map((iv) => ({ iv, n: S.interviewNumbers(iv, S.criteriaOf(iv, settings, DEFAULTS), votes) }));
  const out = per.map(({ iv, n }) => ({
    interview_id: iv.interviewId, interview_type: iv.interviewType ?? null, scheduled_at: iv.scheduledAt ?? null,
    criteria: n.criteria.map((c) => ({ key: c.key, label: c.label, mean: S.oneDecimal(c.mean) })), overall: S.oneDecimal(n.overall), vote_count: n.votes.length,
    pending_count: n.pending, split: n.split, consensus: n.consensus,
    votes: votes.filter((v) => v.interviewId === iv.interviewId).map(voteOut),
  }));
  return S.json(200, { candidate_id: cid, final_score: S.oneDecimal(S.finalScore(per.map((x) => x.n))), interviews: out });
}
