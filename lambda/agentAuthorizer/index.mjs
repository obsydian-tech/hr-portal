/**
 * NH-43: agentAuthorizer — HTTP API Lambda authorizer
 *
 * Validates the `x-api-key` request header against a secret stored in
 * AWS Secrets Manager (naleko/agent/api-key).
 *
 * NH-70 update: during Secrets Manager key rotation the authorizer accepts
 * BOTH the AWSCURRENT and AWSPENDING versions, ensuring zero-downtime
 * rotation even when warm nalekoAiChat containers still hold a cached
 * (old) key from tool-resolver.mjs.
 *
 * Returns:
 *   { isAuthorized: true,  context: { actor: 'AGENT' } }   — valid key
 *   { isAuthorized: false }                                 — missing/invalid
 *
 * The `actor` context value is forwarded to downstream Lambdas via:
 *   event.requestContext.authorizer.lambda.actor
 *
 * The authorizer result is cached by API GW for 5 minutes (TTL set in TF)
 * so Secrets Manager calls are rare under normal load.
 */

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { Logger } from '@aws-lambda-powertools/logger';

const sm = new SecretsManagerClient({ region: 'af-south-1' });
const logger = new Logger({ serviceName: 'agentAuthorizer' });

// In-process key cache to minimise SM calls between Lambda warm starts.
// API GW authorizer TTL caching (300s) provides the primary cache.
// NH-70: cache a Set of valid keys (AWSCURRENT + AWSPENDING if in rotation).
let cachedKeys = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 4 * 60 * 1000; // 4 min (< API GW 5 min TTL)

/**
 * Returns a Set containing the AWSCURRENT key and, when rotation is in
 * progress, the AWSPENDING key. This allows warm containers holding the
 * old key to keep working until their cache is refreshed.
 */
async function getValidKeys() {
  const now = Date.now();
  if (cachedKeys && now < cacheExpiry) return cachedKeys;

  const secretId = process.env.AGENT_API_KEY_SECRET_NAME ?? 'naleko/agent/api-key';
  const keys = new Set();

  // Always fetch AWSCURRENT
  const current = await sm.send(new GetSecretValueCommand({ SecretId: secretId }));
  keys.add(current.SecretString);

  // Also fetch AWSPENDING if rotation is in progress (non-fatal if absent)
  try {
    const pending = await sm.send(new GetSecretValueCommand({
      SecretId: secretId,
      VersionStage: 'AWSPENDING',
    }));
    if (pending.SecretString) keys.add(pending.SecretString);
  } catch (e) {
    // ResourceNotFoundException is expected when no rotation is in progress
    if (e.name !== 'ResourceNotFoundException') {
      logger.warn('Could not fetch AWSPENDING key', { error: e.message });
    }
  }

  cachedKeys = keys;
  cacheExpiry = now + CACHE_TTL_MS;
  return cachedKeys;
}

export const handler = async (event) => {
  // HTTP API Lambda authorizer receives the full request event.
  // `identity_sources = ["$request.header.x-api-key"]` causes API GW to
  // 401 before hitting the authorizer if the header is missing entirely,
  // but we guard here for defence-in-depth.
  const providedKey = event.headers?.['x-api-key'];

  if (!providedKey) {
    logger.warn('Missing x-api-key header — rejecting');
    return { isAuthorized: false };
  }

  try {
    const validKeys = await getValidKeys();

    // Constant-time comparison against each valid key (AWSCURRENT + AWSPENDING)
    // to prevent timing attacks. A match against any valid key is sufficient.
    const providedBuf = Buffer.from(providedKey);
    const keysMatch = [...validKeys].some((validKey) => {
      const validBuf = Buffer.from(validKey);
      return (
        providedBuf.length === validBuf.length &&
        providedBuf.every((byte, i) => byte === validBuf[i])
      );
    });

    if (!keysMatch) {
      logger.warn('Invalid API key — rejecting', {
        keyLength: providedBuf.length,
      });
      return { isAuthorized: false };
    }

    logger.info('Valid API key — authorizing as AGENT');
    return {
      isAuthorized: true,
      // context is merged into event.requestContext.authorizer.lambda in downstream Lambdas
      context: { actor: 'AGENT' },
    };
  } catch (err) {
    logger.error('Authorizer error — rejecting', { error: err.message });
    return { isAuthorized: false };
  }
};
