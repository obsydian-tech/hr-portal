/**
 * NH-132: talentFlowRotateApiKey — 90-day Agent API key rotation cron
 *
 * Triggered by EventBridge scheduled rule: cron(0 0 1 every3rd ? *)
 * (~midnight on the 1st of every 3rd month, ~90-day cycle)
 *
 * Scope (constrained by deployed IAM):
 *   - secretsmanager:GetSecretValue  + PutSecretValue  on talent-flow/agent/api-key
 *   - kms:Decrypt / GenerateDataKey  on alias/talent-flow/agent-audit (for SM encryption)
 *   - logs:PutLogEvents              (CloudWatch — serves as POPIA audit trail)
 *
 * Deliberately omitted (no IAM granted):
 *   - SES / Postmark notification  — no ses:SendEmail, no ssm:GetParameter for Postmark token
 *   - DynamoDB audit write         — no dynamodb:PutItem on talent-flow-agent-audit
 *   Structured CloudWatch log IS the rotation audit record for POPIA compliance.
 */

import {
  SecretsManagerClient,
  PutSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { randomBytes } from 'crypto';

const sm = new SecretsManagerClient({});

// ─── Entry point ─────────────────────────────────────────────────────────────

export const handler = async (_event) => {
  const secretName = process.env.AGENT_API_KEY_SECRET_NAME;
  if (!secretName) {
    throw new Error('AGENT_API_KEY_SECRET_NAME environment variable is not set');
  }

  const newKey = 'tf-' + randomBytes(32).toString('hex');

  await sm.send(
    new PutSecretValueCommand({
      SecretId: secretName,
      SecretString: newKey,
    }),
  );

  const rotatedAt = new Date().toISOString();
  const nextRotation = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  // Structured log — acts as POPIA-compliant audit trail (CloudWatch)
  console.log(
    JSON.stringify({
      event: 'api_key_rotated',
      secretName,
      keyPrefix: 'tf-',
      rotatedAt,
      nextRotationAt: nextRotation,
    }),
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ rotatedAt, nextRotationAt: nextRotation }),
  };
};
