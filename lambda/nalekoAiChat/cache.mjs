/**
 * NH-76: DynamoDB prompt response cache.
 *
 * Cache key = SHA-256(systemPrompt || firstUserMessage || modelId)
 * modelId is included so a Haiku response is never served for a Sonnet request.
 *
 * TTL = 1 hour (expiresAt). DynamoDB TTL handles expiry automatically.
 *
 * Both getCached() and setCached() are non-fatal — a DynamoDB error must never
 * break the user's AI interaction.
 *
 * Post-client upgrade: replace DynamoDB client with Momento SDK.
 * Same cache key logic, same TTL, same non-fatal pattern — Lambda code change only.
 */

import { createHash }                                              from 'crypto';
import { DynamoDBClient, GetItemCommand, PutItemCommand }          from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall }                                    from '@aws-sdk/util-dynamodb';

const ddb   = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'af-south-1' });
const TABLE = process.env.PROMPT_CACHE_TABLE ?? 'naleko-prompt-cache';

/**
 * Build a cache key from the three inputs that determine a unique response.
 * @param {string} systemPrompt     - full system prompt text
 * @param {string} firstUserMessage - the effective user message for this turn
 * @param {string} modelId          - Bedrock model ID chosen by intent router
 * @returns {string} 64-char hex SHA-256 digest
 */
export function buildCacheKey(systemPrompt, firstUserMessage, modelId) {
  return createHash('sha256')
    .update(systemPrompt + '||' + firstUserMessage + '||' + modelId)
    .digest('hex');
}

/**
 * Look up a cached response. Returns the cached string on hit, null on miss or error.
 * @param {string} cacheKey - output of buildCacheKey()
 * @returns {Promise<string|null>}
 */
export async function getCached(cacheKey) {
  try {
    const res = await ddb.send(new GetItemCommand({
      TableName: TABLE,
      Key:       marshall({ cacheKey }),
    }));
    if (!res.Item) return null;
    const item = unmarshall(res.Item);
    return item.cachedResponse ?? null;
  } catch {
    return null; // non-fatal: treat every error as a cache miss
  }
}

/**
 * Store a response in the cache with a 1-hour TTL.
 * Fire-and-forget: errors are silently swallowed.
 * @param {string} cacheKey       - output of buildCacheKey()
 * @param {string} cachedResponse - the final assistant text to cache
 */
export async function setCached(cacheKey, cachedResponse) {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600; // +1 hour
  try {
    await ddb.send(new PutItemCommand({
      TableName: TABLE,
      Item:      marshall({ cacheKey, cachedResponse, expiresAt }, { removeUndefinedValues: true }),
    }));
  } catch {
    // non-fatal — cache write failure must never block the user response
  }
}
