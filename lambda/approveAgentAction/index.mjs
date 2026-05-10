/**
 * NH-73: approveAgentAction Lambda
 *
 * Manages the HITL (Human-in-the-Loop) approval lifecycle for write tool calls
 * intercepted by nalekoAiChat/tool-resolver.mjs.
 *
 * Routes (all on agent_api with x-api-key auth):
 *   GET  /agent/v1/actions/{actionId}          — check action status
 *   POST /agent/v1/actions/{actionId}/approve  — execute the stored tool call
 *   POST /agent/v1/actions/{actionId}/reject   — mark action rejected
 *
 * DynamoDB table: naleko-pending-actions
 *   PK: actionId (UUID v4)
 *   Attributes: toolName, toolArgs, staffId, status, createdAt, expiresAt (TTL 24h)
 */

import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const db          = new DynamoDBClient({});
const sm          = new SecretsManagerClient({});
const TABLE       = process.env.PENDING_ACTIONS_TABLE ?? 'naleko-pending-actions';
const AGENT_BASE  = process.env.AGENT_API_BASE_URL;
const SECRET_NAME = process.env.AGENT_API_KEY_SECRET_NAME ?? 'naleko/agent/api-key';

let _cachedApiKey = null;
async function getApiKey() {
  if (_cachedApiKey) return _cachedApiKey;
  const r = await sm.send(new GetSecretValueCommand({ SecretId: SECRET_NAME }));
  _cachedApiKey = r.SecretString;
  return _cachedApiKey;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function getAction(actionId) {
  const r = await db.send(new GetItemCommand({
    TableName: TABLE,
    Key: marshall({ actionId }),
  }));
  if (!r.Item) return null;
  return unmarshall(r.Item);
}

async function updateStatus(actionId, status, extra = {}) {
  const now = new Date().toISOString();
  await db.send(new UpdateItemCommand({
    TableName: TABLE,
    Key: marshall({ actionId }),
    UpdateExpression: 'SET #s = :s, updatedAt = :now',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: marshall({ ':s': status, ':now': now, ...extra }),
  }));
}

// ─── Route handlers ───────────────────────────────────────────────────────────

async function handleGet(actionId) {
  const action = await getAction(actionId);
  if (!action) return response(404, { error: 'Action not found' });
  return response(200, action);
}

async function handleApprove(actionId) {
  const action = await getAction(actionId);
  if (!action) return response(404, { error: 'Action not found' });
  if (action.status !== 'PENDING_APPROVAL') {
    return response(409, { error: `Action is already ${action.status}` });
  }

  // Re-execute the original tool call against the agent API
  const apiKey = await getApiKey();
  let toolResult;
  try {
    const url = `${AGENT_BASE}/agent/v1/actions/${encodeURIComponent(actionId)}/execute`;
    // Execute stored toolName + toolArgs via agent API
    const res = await fetch(`${AGENT_BASE}/agent/v1/tool-execute`, {
      method:  'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ toolName: action.toolName, toolArgs: action.toolArgs, staffId: action.staffId }),
    });
    toolResult = await res.json();
  } catch (err) {
    console.error(JSON.stringify({ event: 'approve_execute_error', actionId, error: err.message }));
    return response(502, { error: 'Failed to execute approved action', detail: err.message });
  }

  await updateStatus(actionId, 'APPROVED');
  console.log(JSON.stringify({ event: 'action_approved', actionId, toolName: action.toolName }));

  return response(200, { status: 'APPROVED', actionId, result: toolResult });
}

async function handleReject(actionId) {
  const action = await getAction(actionId);
  if (!action) return response(404, { error: 'Action not found' });
  if (action.status !== 'PENDING_APPROVAL') {
    return response(409, { error: `Action is already ${action.status}` });
  }

  await updateStatus(actionId, 'REJECTED');
  console.log(JSON.stringify({ event: 'action_rejected', actionId, toolName: action.toolName }));

  return response(200, { status: 'REJECTED', actionId });
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  const method   = event.requestContext?.http?.method ?? event.httpMethod;
  const rawPath  = event.rawPath ?? event.path ?? '';
  // Extract actionId from path segment before any trailing /approve or /reject
  const pathMatch = rawPath.match(/\/actions\/([^/]+)(?:\/(approve|reject))?$/);
  if (!pathMatch) return response(400, { error: 'Invalid path' });

  const actionId = decodeURIComponent(pathMatch[1]);
  const action   = pathMatch[2]; // 'approve' | 'reject' | undefined

  console.log(JSON.stringify({ event: 'hitl_request', method, actionId, action }));

  if (method === 'GET' && !action)     return handleGet(actionId);
  if (method === 'POST' && action === 'approve') return handleApprove(actionId);
  if (method === 'POST' && action === 'reject')  return handleReject(actionId);

  return response(405, { error: 'Method not allowed' });
};
