// INT-01 (R-22): scheduleInterview's own request-key store. The shared idempotency.mjs is not used or changed.
import { createHash } from 'node:crypto';
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

/**
 * Reserves the key. Answers { key } to run the request, or { answer } to give at once (a replay, KEY_REUSED, KEY_IN_USE, a store error).
 */
export async function reserve({ tenantId, routeKey, caller, candidateId, interviewId, header, body }) {
  const key = T.tenantKey(tenantId, `INT01#${routeKey}#${caller}#${candidateId}#${interviewId ?? '-'}#${header}`);
  const hash = bodyHash(body);
  const expiresAt = Math.floor(Date.now() / 1000) + 24 * 3600;
  try {
    await db.send(new PutItemCommand({
      TableName: TABLE(), Item: marshall({ idempotencyKey: key, status: 'RUNNING', body_hash: hash, tenant_id: tenantId, expiresAt }),
      ConditionExpression: 'attribute_not_exists(idempotencyKey) OR #s = :released', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: marshall({ ':released': 'RELEASED' }),
    }));
    return { key, hash };
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
  return { answer: json(409, { error: 'Conflict', code: 'KEY_IN_USE' }) };
}

/** Stores a 2xx answer; any other answer releases the key so the same key is judged again. */
export async function finish(r, answer) {
  const ok = answer.statusCode >= 200 && answer.statusCode < 300;
  try {
    await db.send(new PutItemCommand({
      TableName: TABLE(),
      Item: marshall({
        idempotencyKey: r.key, status: ok ? 'DONE' : 'RELEASED', body_hash: r.hash, expiresAt: Math.floor(Date.now() / 1000) + 24 * 3600,
        ...(ok ? { answer_status: answer.statusCode, answer_body: answer.body } : {}),
      }),
    }));
  } catch (err) {
    console.error('scheduleInterview: request key finish failed', { error: err.name });
  }
  return answer;
}
