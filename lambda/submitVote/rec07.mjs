// REC-07: POST /v1/interviews/{id}/votes and GET /v1/candidates/{id}/scores.
import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import * as T from '../shared/tenant.mjs';
import * as RA from '../shared/recruitment-access.mjs';
import { requireModule } from '../shared/modules.mjs';
import { getRecruitmentSettings, activeSettings, DEFAULTS } from '../shared/recruitment-settings.mjs';
import * as S from '../shared/scoring.mjs';
import { candidateRows, recomputeInterview } from '../shared/interview-scoring.mjs';

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
  const rows = await candidateRows(interview.candidateId);
  if (rows.some((r) => String(r.SK).startsWith(`VOTE#${voter}#`) && r.interviewId === interview.interviewId)) return S.alreadyScored();
  const now = new Date().toISOString();
  const item = T.stampTenant({
    PK: `CANDIDATE#${interview.candidateId}`, SK: `VOTE#${voter}#${interview.interviewId}`, voterId: voter, candidateId: interview.candidateId, interviewId: interview.interviewId,
    scores: body.scores, rating: body.rating, ...(body.comment !== undefined ? { comment: body.comment } : {}), scale: S.SCALE, on_behalf: onBehalf,
    ...(onBehalf ? { entered_by: me } : {}), createdAt: now,
  }, tenantId);
  try {
    // The key holds no time, so two requests at the same moment write the same key and the second is refused.
    await db.send(new PutItemCommand({ TableName: STATE(), Item: marshall(item, { removeUndefinedValues: true }), ConditionExpression: 'attribute_not_exists(SK)' }));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return S.alreadyScored();
    console.error('submitVote: vote write failed', { error: err.name });
    return S.json(500, { error: 'Internal error' });
  }
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
  if (relation === 'panel') {
    const mine = ivs.filter((iv) => RA.panelMemberOf(iv, me)).map((iv) => ({
      interview_id: iv.interviewId, criteria: S.criteriaOf(iv, settings, DEFAULTS).map((c) => ({ key: c.key, label: c.label })),
      votes: votes.filter((v) => v.interviewId === iv.interviewId && v.voterId === me).map(voteOut),
    }));
    return S.json(200, { candidate_id: cid, interviews: mine });
  }
  const decider = (settings.REJECTION_RULES ?? DEFAULTS.REJECTION_RULES).decider?.[saga.positionLevel];
  const all = relation === 'recruiter' || RA.canDecide(event, saga, decider);
  const per = ivs.map((iv) => ({ iv, n: S.interviewNumbers(iv, S.criteriaOf(iv, settings, DEFAULTS), votes) }));
  const out = per.map(({ iv, n }) => ({
    interview_id: iv.interviewId, interview_type: iv.interviewType ?? null, scheduled_at: iv.scheduledAt ?? null,
    criteria: n.criteria.map((c) => ({ key: c.key, label: c.label, mean: S.oneDecimal(c.mean) })), overall: S.oneDecimal(n.overall), vote_count: n.votes.length,
    pending_count: n.pending, split: n.split, consensus: n.consensus,
    ...(all ? { votes: votes.filter((v) => v.interviewId === iv.interviewId).map(voteOut) } : {}),
  }));
  return S.json(200, { candidate_id: cid, final_score: S.oneDecimal(S.finalScore(per.map((x) => x.n))), interviews: out });
}
