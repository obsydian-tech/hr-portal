// REC-07: GET and POST /v1/scoring-links/{token}.
import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import * as T from '../shared/tenant.mjs';
import { modulesOf } from '../shared/modules.mjs';
import { activeSettings, DEFAULTS } from '../shared/recruitment-settings.mjs';
import * as S from '../shared/scoring.mjs';
import { recomputeInterview } from '../shared/interview-scoring.mjs';

const db = new DynamoDBClient({});
const STATE = () => process.env.STATE_TABLE_NAME || 'talent-flow-state';
const get = async (PK, SK) => { const r = await db.send(new GetItemCommand({ TableName: STATE(), Key: marshall({ PK, SK }) })); return r.Item ? unmarshall(r.Item) : null; };

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
  const now = new Date().toISOString();
  try {
    await db.send(new UpdateItemCommand(o.legacy
      ? { TableName: STATE(), Key: marshall(o.key), UpdateExpression: 'SET #u = :t, usedAt = :at', ConditionExpression: '#u <> :t', ExpressionAttributeNames: { '#u': 'used' }, ExpressionAttributeValues: marshall({ ':t': true, ':at': now }) }
      : { TableName: STATE(), Key: marshall(o.key), UpdateExpression: 'SET used_at = :at', ConditionExpression: 'attribute_not_exists(used_at) OR used_at = :n', ExpressionAttributeValues: marshall({ ':at': now, ':n': null }) }));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return S.EXPIRED();
    console.error('scoring link use failed', { error: err.name });
    return S.EXPIRED();
  }
  const voter = `GUEST#${String(o.link.PK).slice(13, 29)}`;
  await db.send(new PutItemCommand({ TableName: STATE(), Item: marshall(T.stampTenant({
    PK: `CANDIDATE#${o.iv.candidateId}`, SK: `VOTE#${voter}#${now}#${o.iv.interviewId}`, voterId: voter, candidateId: o.iv.candidateId, interviewId: o.iv.interviewId,
    scores: body.scores, rating: body.rating, ...(body.comment !== undefined ? { comment: body.comment } : {}), scale: S.SCALE, guest: true, on_behalf: false, createdAt: now,
  }, o.tenantId), { removeUndefinedValues: true }) }));
  await recomputeInterview(o.tenantId, o.iv, settings);
  return S.json(200, { saved: true });
}
