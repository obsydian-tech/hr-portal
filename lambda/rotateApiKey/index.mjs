/**
 * NH-70: rotateApiKey — Secrets Manager rotation Lambda
 *
 * Implements the 4-step AWS Secrets Manager rotation protocol for
 * the `naleko/agent/api-key` secret.
 *
 * Architecture note: both the consumer (nalekoAiChat/tool-resolver.mjs)
 * and the validator (agentAuthorizer) read the key directly from Secrets
 * Manager. The validator has been updated (NH-70) to accept BOTH
 * AWSCURRENT and AWSPENDING during the rotation window, so rotation is
 * zero-downtime even when warm Lambda containers still hold a cached key.
 *
 * Step overview:
 *   createSecret  — generate new random key, store as AWSPENDING
 *   setSecret     — no external system to update (SM is the source of truth)
 *   testSecret    — call agent API with the AWSPENDING key to verify it works
 *   finishSecret  — promote AWSPENDING → AWSCURRENT
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
  UpdateSecretVersionStageCommand,
  DescribeSecretCommand,
} from '@aws-sdk/client-secrets-manager';
import { randomBytes } from 'crypto';

const sm = new SecretsManagerClient({});
const AGENT_API_BASE = process.env.AGENT_API_BASE_URL;

// ─── Entry point ─────────────────────────────────────────────────────────────

export const handler = async (event) => {
  const { Step, SecretId, ClientRequestToken } = event;

  console.log(JSON.stringify({ event: 'rotation_step', step: Step, secretId: SecretId }));

  switch (Step) {
    case 'createSecret':
      await createSecret(SecretId, ClientRequestToken);
      break;
    case 'setSecret':
      // No external system to update — agentAuthorizer reads from SM directly.
      // The authorizer accepts both AWSCURRENT and AWSPENDING (see NH-70 update),
      // so the new key is already "active" once stored as AWSPENDING.
      console.log(JSON.stringify({ event: 'rotation_step_noop', step: 'setSecret' }));
      break;
    case 'testSecret':
      await testSecret(SecretId, ClientRequestToken);
      break;
    case 'finishSecret':
      await finishSecret(SecretId, ClientRequestToken);
      break;
    default:
      throw new Error(`Unknown rotation step: ${Step}`);
  }

  console.log(JSON.stringify({ event: 'rotation_step_complete', step: Step }));
};

// ─── Step implementations ─────────────────────────────────────────────────────

/**
 * createSecret — generate a new high-entropy key and store as AWSPENDING.
 * Idempotent: if AWSPENDING already exists for this ClientRequestToken, skip.
 */
async function createSecret(secretId, token) {
  // Check if AWSPENDING already exists for this token (idempotency)
  try {
    await sm.send(new GetSecretValueCommand({
      SecretId: secretId,
      VersionId: token,
      VersionStage: 'AWSPENDING',
    }));
    console.log(JSON.stringify({ event: 'create_secret_skip', reason: 'AWSPENDING already exists' }));
    return;
  } catch (e) {
    if (e.name !== 'ResourceNotFoundException') throw e;
  }

  // Generate a 40-char hex key (160 bits entropy)
  const newKey = randomBytes(20).toString('hex');

  await sm.send(new PutSecretValueCommand({
    SecretId: secretId,
    ClientRequestToken: token,
    SecretString: newKey,
    VersionStages: ['AWSPENDING'],
  }));

  console.log(JSON.stringify({ event: 'create_secret_done', keyLength: newKey.length }));
}

/**
 * testSecret — verify the AWSPENDING key is accepted by the agent API.
 * Uses the /employees endpoint (requires valid auth, returns 200 or 403).
 */
async function testSecret(secretId, token) {
  if (!AGENT_API_BASE) throw new Error('AGENT_API_BASE_URL env var not set');

  const { SecretString: pendingKey } = await sm.send(new GetSecretValueCommand({
    SecretId: secretId,
    VersionId: token,
    VersionStage: 'AWSPENDING',
  }));

  const testUrl = `${AGENT_API_BASE}/employees?limit=1`;
  const res = await fetch(testUrl, {
    method: 'GET',
    headers: { 'x-api-key': pendingKey, 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    throw new Error(
      `testSecret: AWSPENDING key rejected by agent API — ${res.status} ${res.statusText}`
    );
  }

  console.log(JSON.stringify({ event: 'test_secret_pass', status: res.status }));
}

/**
 * finishSecret — promote AWSPENDING to AWSCURRENT, demoting the old version.
 * Idempotent: if AWSCURRENT is already this token, skip.
 */
async function finishSecret(secretId, token) {
  const meta = await sm.send(new DescribeSecretCommand({ SecretId: secretId }));

  const currentVersionId = Object.entries(meta.VersionIdsToStages ?? {})
    .find(([, stages]) => stages.includes('AWSCURRENT'))?.[0];

  if (currentVersionId === token) {
    console.log(JSON.stringify({ event: 'finish_secret_skip', reason: 'already AWSCURRENT' }));
    return;
  }

  await sm.send(new UpdateSecretVersionStageCommand({
    SecretId: secretId,
    VersionStage: 'AWSCURRENT',
    MoveToVersionId: token,
    RemoveFromVersionId: currentVersionId,
  }));

  console.log(JSON.stringify({ event: 'finish_secret_done', newVersionId: token }));
}
