// INT-01 (R-22): scheduleInterview's own request-key store. The shared idempotency.mjs is not used or changed.
import { createHash, randomUUID } from 'node:crypto';
import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import * as T from '../shared/tenant.mjs';

const db = new DynamoDBClient({});
const TABLE = () => process.env.IDEMPOTENCY_TABLE;
const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
export const bodyHash = (body) => createHash('sha256').update(JSON.stringify(sortKeys(body ?? null))).digest('hex');

/** The header value, or null when it is missing, empty or longer than 200 characters. */
export function headerOf(event) {
  const h = event.headers ?? {};
  const k = Object.keys(h).find((x) => x.toLowerCase() === 'idempotency-key');
  const v = k ? h[k] : undefined;
  return typeof v === 'string' && v.length > 0 && v.length <= 200 ? v : null;
}

/** INT-01.F rule 3: a RUNNING row older than this is taken over. Four times scheduleInterview's 30 second timeout. */
export const STALE_RUNNING_MS = 120 * 1000;

/**
 * Reserves the key. Answers { key, hash, tenantId, startedAt, pendingInterviewId } to run the request, or { answer } to give at once
 * (a replay, KEY_REUSED, KEY_IN_USE, a store error). A booking (no interviewId) gets its new interview id here, kept on the RUNNING row
 * as pending_interview_id (server-only), so a take-over books the same id and cannot book twice.
 */
export async function reserve({ tenantId, routeKey, caller, candidateId, interviewId, header, body }) {
  const key = T.tenantKey(tenantId, `INT01#${routeKey}#${caller}#${candidateId}#${interviewId ?? '-'}#${header}`);
  const hash = bodyHash(body);
  const expiresAt = Math.floor(Date.now() / 1000) + 24 * 3600;
  const startedAt = Date.now();
  const pendingInterviewId = interviewId === undefined ? randomUUID() : undefined;
  const running = (at, pending) => marshall({
    idempotencyKey: key, status: 'RUNNING', body_hash: hash, tenant_id: tenantId, started_at: at, expiresAt, ...(pending ? { pending_interview_id: pending } : {}),
  });
  try {
    await db.send(new PutItemCommand({
      TableName: TABLE(), Item: running(startedAt, pendingInterviewId),
      ConditionExpression: 'attribute_not_exists(idempotencyKey) OR #s = :released', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: marshall({ ':released': 'RELEASED' }),
    }));
    return { key, hash, tenantId, startedAt, pendingInterviewId };
  } catch (err) {
    if (err.name !== 'ConditionalCheckFailedException') {
      console.error('scheduleInterview: request key store failed', { error: err.name });
      return { answer: json(500, { error: 'Internal error' }) };
    }
  }
  let row;
  try {
    const r = await db.send(new GetItemCommand({ TableName: TABLE(), Key: marshall({ idempotencyKey: key }), ConsistentRead: true }));
    row = r.Item ? unmarshall(r.Item) : null;
  } catch (err) {
    console.error('scheduleInterview: request key read failed', { error: err.name });
    return { answer: json(500, { error: 'Internal error' }) };
  }
  if (row?.status === 'DONE') {
    if (row.body_hash !== hash) return { answer: json(409, { error: 'Conflict', code: 'KEY_REUSED' }) };
    return { answer: { statusCode: row.answer_status, headers: { 'Content-Type': 'application/json' }, body: row.answer_body } };
  }
  // A RUNNING row with a start time, left for more than 120 seconds: the first request died. The old way (no started_at) keeps KEY_IN_USE.
  if (row?.status === 'RUNNING' && typeof row.started_at === 'number' && Date.now() - row.started_at > STALE_RUNNING_MS) {
    if (row.body_hash !== hash) return { answer: json(409, { error: 'Conflict', code: 'KEY_REUSED' }) };
    const pending = interviewId === undefined ? (row.pending_interview_id ?? pendingInterviewId) : undefined;
    try {
      await db.send(new PutItemCommand({
        TableName: TABLE(), Item: running(startedAt, pending),
        ConditionExpression: '#s = :running AND started_at = :seen', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: marshall({ ':running': 'RUNNING', ':seen': row.started_at }),
      }));
      return { key, hash, tenantId, startedAt, pendingInterviewId: pending };
    } catch (err) {
      if (err.name !== 'ConditionalCheckFailedException') {
        console.error('scheduleInterview: request key store failed', { error: err.name });
        return { answer: json(500, { error: 'Internal error' }) };
      }
    }
  }
  return { answer: json(409, { error: 'Conflict', code: 'KEY_IN_USE' }) };
}

/** Stores a 2xx answer; any other answer releases the key so the same key is judged again. Writes only while the row is still this request's own. */
export async function finish(r, answer) {
  const ok = answer.statusCode >= 200 && answer.statusCode < 300;
  try {
    await db.send(new PutItemCommand({
      TableName: TABLE(),
      Item: marshall({
        idempotencyKey: r.key, status: ok ? 'DONE' : 'RELEASED', body_hash: r.hash, tenant_id: r.tenantId, started_at: r.startedAt, expiresAt: Math.floor(Date.now() / 1000) + 24 * 3600,
        ...(ok ? { answer_status: answer.statusCode, answer_body: answer.body } : {}),
      }),
      ConditionExpression: 'started_at = :mine', ExpressionAttributeValues: marshall({ ':mine': r.startedAt }),
    }));
  } catch (err) {
    console.error('scheduleInterview: request key finish failed', { error: err.name });
  }
  return answer;
}
