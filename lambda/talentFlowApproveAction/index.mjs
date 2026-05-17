/**
 * AI-004 (NH-130): talentFlowApproveAction Lambda
 *
 * Manages the HITL (Human-in-the-Loop) approval lifecycle for AI write-tool
 * calls intercepted by talentFlowAiChat/tool-resolver.
 *
 * Routes (all on agent API with x-api-key auth):
 *   GET  /agent/actions/{actionId}          — check action status
 *   POST /agent/actions/{actionId}/approve  — approve + execute via EventBridge
 *   POST /agent/actions/{actionId}/reject   — mark action rejected
 *
 * DynamoDB table : talent-flow-pending-actions  (env: PENDING_ACTIONS_TABLE_NAME)
 * EventBridge bus: talent-flow-bus             (env: EVENTBRIDGE_BUS_NAME)
 *
 * IAM grants (deployed):
 *   dynamodb:GetItem + UpdateItem  on talent-flow-pending-actions
 *   events:PutEvents               on talent-flow-bus
 *   kms:Decrypt/GenerateDataKey    on alias/talent-flow/state
 *
 * Tool execution on approve is dispatched via EventBridge (ActionApproved event).
 * Downstream consumers (AI chat, SLA monitor) receive the event and execute the
 * stored toolName + toolArgs.  This follows Epic 2 invariant: all inter-Lambda
 * communication through talent-flow-bus, never direct invocations.
 *
 * Audit writes are emitted to CloudWatch Logs only (no IAM grant for
 * talent-flow-agent-audit DynamoDB table — scope for future Terraform update).
 */

import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const db  = new DynamoDBClient({});
const eb  = new EventBridgeClient({});

const TABLE    = process.env.PENDING_ACTIONS_TABLE_NAME ?? 'talent-flow-pending-actions';
const BUS_NAME = process.env.EVENTBRIDGE_BUS_NAME       ?? 'talent-flow-bus';
const ENV      = process.env.ENVIRONMENT                 ?? 'prod';

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

/**
 * Conditionally update status — only if current status is PENDING_APPROVAL.
 * Throws ConditionalCheckFailedException if the action has already been processed.
 */
async function setStatus(actionId, status, extra = {}) {
  const now = new Date().toISOString();
  await db.send(new UpdateItemCommand({
    TableName: TABLE,
    Key: marshall({ actionId }),
    ConditionExpression: '#s = :pending',
    UpdateExpression: 'SET #s = :s, updatedAt = :now',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: marshall({
      ':pending': 'PENDING_APPROVAL',
      ':s': status,
      ':now': now,
      ...extra,
    }),
  }));
}

// ─── Route handlers ───────────────────────────────────────────────────────────

async function handleGet(actionId) {
  const action = await getAction(actionId);
  if (!action) return response(404, { error: 'Action not found' });
  return response(200, action);
}

async function handleApprove(actionId, approverStaffId) {
  const action = await getAction(actionId);
  if (!action) return response(404, { error: 'Action not found' });

  if (action.status !== 'PENDING_APPROVAL') {
    return response(409, { error: `Action is already ${action.status}` });
  }

  // Self-approval guard — approver must differ from original requester
  if (approverStaffId && action.staffId && approverStaffId === action.staffId) {
    return response(403, { error: 'Self-approval is not permitted' });
  }

  // Mark APPROVED (conditional — guard against race)
  try {
    await setStatus(actionId, 'APPROVED', { approvedBy: approverStaffId ?? 'unknown' });
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      return response(409, { error: 'Action has already been processed' });
    }
    throw err;
  }

  // Dispatch tool execution via EventBridge — downstream consumers handle it
  const executedAt = new Date().toISOString();
  try {
    await eb.send(new PutEventsCommand({
      Entries: [{
        EventBusName: BUS_NAME,
        Source: 'talent-flow.agent',
        DetailType: 'ActionApproved',
        Detail: JSON.stringify({
          actionId,
          toolName: action.toolName,
          toolArgs: action.toolArgs,
          staffId: action.staffId,
          approvedBy: approverStaffId ?? 'unknown',
          approvedAt: executedAt,
          environment: ENV,
        }),
      }],
    }));
  } catch (err) {
    // EventBridge dispatch failure is non-fatal — status already APPROVED in DDB
    console.error(JSON.stringify({
      event: 'approve_dispatch_error', actionId, toolName: action.toolName, error: err.message,
    }));
  }

  console.log(JSON.stringify({
    event: 'action_approved', actionId, toolName: action.toolName,
    approvedBy: approverStaffId ?? 'unknown', executedAt,
  }));

  return response(200, { status: 'APPROVED', actionId, executedAt });
}

async function handleReject(actionId, rejectorStaffId, reason) {
  const action = await getAction(actionId);
  if (!action) return response(404, { error: 'Action not found' });

  if (action.status !== 'PENDING_APPROVAL') {
    return response(409, { error: `Action is already ${action.status}` });
  }

  try {
    await setStatus(actionId, 'REJECTED', {
      rejectedBy: rejectorStaffId ?? 'unknown',
      ...(reason ? { rejectionReason: reason } : {}),
    });
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      return response(409, { error: 'Action has already been processed' });
    }
    throw err;
  }

  console.log(JSON.stringify({
    event: 'action_rejected', actionId, toolName: action.toolName,
    rejectedBy: rejectorStaffId ?? 'unknown', reason: reason ?? null,
  }));

  return response(200, { status: 'REJECTED', actionId });
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  const method  = event.requestContext?.http?.method ?? event.httpMethod;
  const rawPath = event.rawPath ?? event.path ?? '';

  // Extract actionId and optional route suffix (/approve | /reject)
  const pathMatch = rawPath.match(/\/actions\/([^/]+)(?:\/(approve|reject))?$/);
  if (!pathMatch) return response(400, { error: 'Invalid path' });

  const actionId = decodeURIComponent(pathMatch[1]);
  const route    = pathMatch[2]; // 'approve' | 'reject' | undefined

  // Parse body for staffId and rejection reason
  let body = {};
  try {
    if (event.body) body = JSON.parse(event.body);
  } catch {
    return response(400, { error: 'Invalid JSON body' });
  }

  // staffId: prefer Lambda authorizer context, fall back to body field
  const staffId = event.requestContext?.authorizer?.lambda?.staffId
    ?? event.requestContext?.authorizer?.staffId
    ?? body.staffId
    ?? null;

  console.log(JSON.stringify({ event: 'hitl_request', method, actionId, route, staffId }));

  if (method === 'GET'  && !route)               return handleGet(actionId);
  if (method === 'POST' && route === 'approve') return handleApprove(actionId, staffId);
  if (method === 'POST' && route === 'reject')  return handleReject(actionId, staffId, body.reason ?? null);

  return response(405, { error: 'Method not allowed' });
};
