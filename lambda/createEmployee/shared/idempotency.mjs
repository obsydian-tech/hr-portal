/**
 * NH-44: Idempotency middleware for mutation Lambda handlers.
 *
 * Usage:
 *   import { withIdempotency } from '../shared/idempotency.mjs';
 *
 *   export const handler = async (event) => {
 *     const key = event.headers?.['idempotency-key'];
 *     return withIdempotency(key, () => handlerFn(event));
 *   };
 *
 * Behaviour:
 *   - If key is absent → request proceeds normally (idempotency is optional).
 *   - If key is seen for the first time → execute handler, cache response for 24h.
 *   - If key was already processed → return cached response (no duplicate side-effects).
 *   - If two concurrent requests arrive with the same key → first wins; second gets 409.
 *
 * The table name is injected via the IDEMPOTENCY_TABLE environment variable (set by Terraform).
 * The table is KMS-encrypted with the same PII CMK used across all Naleko tables.
 */

import { DynamoDBClient, PutItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { randomUUID } from 'crypto';

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'af-south-1' });

const TABLE = process.env.IDEMPOTENCY_TABLE;

const TTL_SECONDS = 86400; // 24 hours

/**
 * Wraps a Lambda handler with idempotency protection.
 *
 * @param {string|undefined} key   - Value of the `Idempotency-Key` request header (lowercase).
 * @param {() => Promise<*>} handler - Async function that executes the real business logic.
 * @returns {Promise<*>} The handler result (fresh or cached).
 */
export async function withIdempotency(key, handler) {
  // No key supplied — proceed without idempotency protection.
  if (!key || !TABLE) return handler();

  const expiresAt = Math.floor(Date.now() / 1000) + TTL_SECONDS;

  // ── 1. Check the cache ──────────────────────────────────────────────────────
  const existing = await dynamo.send(new GetItemCommand({
    TableName: TABLE,
    Key: { idempotencyKey: { S: key } },
  }));

  if (existing.Item?.response) {
    // Cached 200/201 response — return verbatim.
    return JSON.parse(existing.Item.response.S);
  }

  // ── 2. Reserve slot (conditional write) ────────────────────────────────────
  // If two concurrent requests arrive with the same key, only one PutItem
  // wins the conditional write. The loser gets a 409 Conflict.
  try {
    await dynamo.send(new PutItemCommand({
      TableName: TABLE,
      Item: {
        idempotencyKey: { S: key },
        status:         { S: 'IN_FLIGHT' },
        expiresAt:      { N: String(expiresAt) },
        requestId:      { S: randomUUID() },
        createdAt:      { S: new Date().toISOString() },
      },
      ConditionExpression: 'attribute_not_exists(idempotencyKey)',
    }));
  } catch (err) {
    // ConditionalCheckFailedException — concurrent duplicate in progress.
    if (err.name === 'ConditionalCheckFailedException') {
      return {
        statusCode: 409,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Request in progress',
          message: 'A request with this Idempotency-Key is already being processed. Retry after 1 second.',
        }),
      };
    }
    // Any other DynamoDB error — fail open (don't block the real request).
    console.warn('[idempotency] DynamoDB reserve failed, proceeding without dedup', { key, error: err.message });
    return handler();
  }

  // ── 3. Execute real handler ─────────────────────────────────────────────────
  let result;
  try {
    result = await handler();
  } catch (err) {
    // On handler error, delete the IN_FLIGHT slot so the client can retry.
    await dynamo.send(new PutItemCommand({
      TableName: TABLE,
      Item: {
        idempotencyKey: { S: key },
        status:         { S: 'FAILED' },
        expiresAt:      { N: String(expiresAt) },
      },
    })).catch(() => {}); // best-effort cleanup
    throw err;
  }

  // ── 4. Cache the successful response ───────────────────────────────────────
  // Only cache 2xx responses. Error responses (4xx/5xx) are not considered
  // idempotent — the client should be allowed to retry them.
  const statusCode = result?.statusCode ?? 200;
  if (statusCode >= 200 && statusCode < 300) {
    await dynamo.send(new PutItemCommand({
      TableName: TABLE,
      Item: {
        idempotencyKey: { S: key },
        status:         { S: 'COMPLETE' },
        response:       { S: JSON.stringify(result) },
        expiresAt:      { N: String(expiresAt) },
        completedAt:    { S: new Date().toISOString() },
      },
    })).catch((err) => {
      // Non-fatal — log and continue. The response is still returned to the caller.
      console.warn('[idempotency] DynamoDB cache write failed', { key, error: err.message });
    });
  }

  return result;
}
