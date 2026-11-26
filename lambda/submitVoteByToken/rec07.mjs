// REC-07: GET and POST /v1/scoring-links/{token}.
import { DynamoDBClient, GetItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import * as T from '../shared/tenant.mjs';
import { modulesOf } from '../shared/modules.mjs';
import { activeSettings, DEFAULTS } from '../shared/recruitment-settings.mjs';
import * as S from '../shared/scoring.mjs';
import { candidateRows, recomputeInterview, sequenceClause } from '../shared/interview-scoring.mjs';

const db = new DynamoDBClient({});
const STATE = () => process.env.STATE_TABLE_NAME || 'talent-flow-state';
// INT-01.F rule 2.3: every read open() makes is strong, so the retry's open() is strong too.
const get = async (PK, SK) => { const r = await db.send(new GetItemCommand({ TableName: STATE(), Key: marshall({ PK, SK }), ConsistentRead: true })); return r.Item ? unmarshall(r.Item) : null; };

/** The link and what it opens, or null (every reason gives the one expired answer). */
async function open(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,128}$/.test(token)) return null;
  let link = await get(`SCORING_LINK#${S.hashToken(token)}`, 'META');
  let legacy = false;
  if (!link) {
    const old = await get(`SCORING_LINK#${token}`, 'META');
    if (old && !old.token_hash && old.token === token) { link = old; legacy = true; }
  }
  if (!link) return null;
  const tenantId = link.tenant_id;
  if (!tenantId) return null;
  const now = Date.now();
  const expires = legacy ? (link.ttl ? link.ttl * 1000 : 0) : Date.parse(link.expires_at);
  if (!(expires > now)) return null;
  if (legacy ? link.used === true : link.used_at) return null;
  const cid = legacy ? link.candidateId : link.candidate_id;
  const ivId = legacy ? link.interviewId : link.interview_id;
  const saga = await get(`CANDIDATE#${cid}`, 'SAGA');
  const iv = await get(`CANDIDATE#${cid}`, `INTERVIEW#${ivId}`);
  if (!saga || !iv || !T.ownsRow(saga, tenantId) || !T.ownsRow(iv, tenantId)) return null;
  if (!(await modulesOf(tenantId)).includes('recruitment')) return null;
  // INT-01 rule 14: a closed interview gives the single expired answer.
  if (iv.status !== undefined && iv.status !== 'SCHEDULED') return null;
  return { link, legacy, tenantId, saga, iv, key: { PK: link.PK, SK: 'META' } };
}

export async function read(event) {
  try {
    const o = await open(event.pathParameters?.token);
    if (!o) return S.EXPIRED();
    const settings = await activeSettings(o.tenantId);
    return S.json(200, {
      candidate_first: o.saga.firstName, candidate_last: o.saga.lastName, role_title: o.saga.positionTitle ?? null, interview_type: o.iv.interviewType,
      interview_at: o.iv.scheduledAt, criteria: S.criteriaOf(o.iv, settings, DEFAULTS).map((c) => ({ key: c.key, label: c.label })),
      expires_at: o.legacy ? (o.link.expiresAt ?? new Date(o.link.ttl * 1000).toISOString()) : o.link.expires_at,
      open: Date.now() >= Date.parse(o.iv.scheduledAt),
    });
  } catch (err) {
    console.error('scoring link read failed', { error: err.name });
    return S.EXPIRED();
  }
}

export async function vote(event) {
  let o;
  try { o = await open(event.pathParameters?.token); } catch (err) { console.error('scoring link read failed', { error: err.name }); return S.EXPIRED(); }
  if (!o) return S.EXPIRED();
  let body;
  try { body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body ?? {}); } catch { return S.badScores(); }
  const settings = await activeSettings(o.tenantId);
  const refusal = S.checkBody(body, S.criteriaOf(o.iv, settings, DEFAULTS));
  if (refusal) return refusal;
  const nowMs = Date.now();
  if (nowMs < Date.parse(o.iv.scheduledAt)) return S.json(409, { error: 'Conflict', code: 'NOT_STARTED' });
  const voter = `GUEST#${String(o.link.PK).slice(13, 29)}`;
  // Rule 2.2 and 2.3: the interview part holds the sequence of the copy open() read; the link's use also needs expires_at > now.
  const send = async (c, atMs) => {
    const now = new Date(atMs).toISOString();
    const seq = sequenceClause(c.iv);
    // INT-04 (INT-01.F follow-up F-1): a guest link votes only on the interview whose current link it is, so a link a reschedule has replaced cannot.
    const hash = c.legacy ? null : String(c.key.PK).slice('SCORING_LINK#'.length);
    const guestOnly = hash === null ? '' : ' AND (attribute_not_exists(guest_link_hash) OR guest_link_hash = :h)';
    const use = c.legacy
      ? { TableName: STATE(), Key: marshall(c.key), UpdateExpression: 'SET #u = :t, usedAt = :at', ConditionExpression: '#u <> :t', ExpressionAttributeNames: { '#u': 'used' }, ExpressionAttributeValues: marshall({ ':t': true, ':at': now }) }
      : { TableName: STATE(), Key: marshall(c.key), UpdateExpression: 'SET used_at = :at', ConditionExpression: '(attribute_not_exists(used_at) OR attribute_type(used_at, :n)) AND expires_at > :at', ExpressionAttributeValues: marshall({ ':at': now, ':n': 'NULL' }) };
    // INT-01 (R-18): the link's use, the vote, its guard row and the counter in one transaction.
    await db.send(new TransactWriteItemsCommand({ TransactItems: [
      { Update: use },
      { Put: { TableName: STATE(), Item: marshall(T.stampTenant({
        PK: `CANDIDATE#${c.iv.candidateId}`, SK: `VOTE#${voter}#${now}#${c.iv.interviewId}`, voterId: voter, candidateId: c.iv.candidateId, interviewId: c.iv.interviewId,
        scores: body.scores, rating: body.rating, ...(body.comment !== undefined ? { comment: body.comment } : {}), scale: S.SCALE, guest: true, on_behalf: false, createdAt: now,
      }, c.tenantId), { removeUndefinedValues: true }) } },
      { Put: { TableName: STATE(), Item: marshall(T.stampTenant({ PK: `CANDIDATE#${c.iv.candidateId}`, SK: `VOTED#${c.iv.interviewId}#${voter}`, createdAt: now }, c.tenantId)), ConditionExpression: 'attribute_not_exists(PK)' } },
      { Update: { TableName: STATE(), Key: marshall({ PK: `CANDIDATE#${c.iv.candidateId}`, SK: `INTERVIEW#${c.iv.interviewId}` }), UpdateExpression: 'ADD votesSubmitted :one', ConditionExpression: `tenant_id = :t AND #s = :sch AND scheduledAt <= :now AND ${seq.expr}${guestOnly}`, ExpressionAttributeNames: { '#s': 'status', '#q': 'sequence' }, ExpressionAttributeValues: marshall({ ':one': 1, ':t': c.tenantId, ':sch': 'SCHEDULED', ':now': now, ...seq.values, ...(hash === null ? {} : { ':h': hash }) }) } },
    ] }));
  };
  try {
    await send(o, nowMs);
  } catch (err) {
    if (err.name !== 'TransactionCanceledException') { console.error('scoring link use failed', { error: err.name }); return S.EXPIRED(); }
    // Rule 2.4: one retry, judged as a fresh request would be (open() again, strongly). Nothing is written on any refusal.
    try {
      const o2 = await open(event.pathParameters?.token);
      if (!o2) return S.EXPIRED();
      const retryNowMs = Date.now();
      if (retryNowMs < Date.parse(o2.iv.scheduledAt)) return S.json(409, { error: 'Conflict', code: 'NOT_STARTED' });
      const rows2 = await candidateRows(o2.iv.candidateId);
      if (rows2.some((r) => r.SK === `VOTED#${o2.iv.interviewId}#${voter}` || (String(r.SK).startsWith(`VOTE#${voter}#`) && r.interviewId === o2.iv.interviewId))) return S.EXPIRED();
      await send(o2, retryNowMs);
      o = o2;
    } catch (err2) {
      if (err2.name !== 'TransactionCanceledException') console.error('scoring link use failed', { error: err2.name });
      return S.EXPIRED();
    }
  }
  await recomputeInterview(o.tenantId, o.iv, settings); // o.iv is the copy the successful transaction was judged on
  return S.json(200, { saved: true });
}
