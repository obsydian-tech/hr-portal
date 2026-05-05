/**
 * NH-43: agentAuthorizer — HTTP API Lambda authorizer
 *
 * Validates the `x-api-key` request header against a secret stored in
 * AWS Secrets Manager (naleko/agent/api-key).
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
let cachedKey = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 4 * 60 * 1000; // 4 min (< API GW 5 min TTL)

async function getAgentApiKey() {
  const now = Date.now();
  if (cachedKey && now < cacheExpiry) return cachedKey;

  const result = await sm.send(new GetSecretValueCommand({
    SecretId: process.env.AGENT_API_KEY_SECRET_NAME ?? 'naleko/agent/api-key',
  }));

  cachedKey = result.SecretString;
  cacheExpiry = now + CACHE_TTL_MS;
  return cachedKey;
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
    const validKey = await getAgentApiKey();

    // Constant-time comparison to prevent timing attacks
    const providedBuf = Buffer.from(providedKey);
    const validBuf = Buffer.from(validKey);
    const keysMatch =
      providedBuf.length === validBuf.length &&
      providedBuf.every((byte, i) => byte === validBuf[i]);

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
