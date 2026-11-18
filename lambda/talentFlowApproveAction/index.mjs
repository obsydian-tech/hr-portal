/**
 * AI-004 (NH-130): talentFlowApproveAction Lambda
 *
 * Manages the HITL (Human-in-the-Loop) approval lifecycle for AI write-tool
 * calls intercepted by talentFlowAiChat/tool-resolver.
 *
 * Routes (agent API):
 *   GET  /agent/actions/{actionId}          — check action status
 *   POST /agent/actions/{actionId}/approve  — approve + execute via EventBridge
 *   POST /agent/actions/{actionId}/reject   — mark action rejected
 *
 * BE-19 (NH-211): approve and reject take the approver from an HR ID token only (hr_staff or
 * naleko-talentflow-hr, custom:staff_id). The body, the agent key and any authorizer context never name it.
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
  ScanCommand,
} from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { groupsOf } from '../shared/document-check.mjs';
import { isIdToken } from '../shared/hr-group.mjs';
import { requireTenant, ownsRow, andFilter, tenantFilter } from '../shared/tenant.mjs';
import { requireModule } from '../shared/modules.mjs';

// BE-19 W-1: the refusal for approve and reject, the old app's own 403 sentence (Iggie chose it, 17 Nov).
const NOT_ALLOWED = 'You do not have permission to perform this action.';

// BE-15: a setting that names one environment has no fallback value. A missing
// one stops the Lambda when it starts, with one clear line in the log.
function requireSetting(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing setting ${name}`);
    throw new Error(`Missing setting ${name}`);
  }
  return value;
}

const db  = new DynamoDBClient({});
const eb  = new EventBridgeClient({});

const TABLE    = process.env.PENDING_ACTIONS_TABLE_NAME ?? 'talent-flow-pending-actions';
const BUS_NAME = process.env.EVENTBRIDGE_BUS_NAME       ?? 'talent-flow-bus';
const ENV      = requireSetting('ENVIRONMENT');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// TEN-03: another company's action answers exactly as one that does not exist.
const NO_ACTION = () => response(404, { error: 'Action not found' });

async function getAction(actionId, tenantId) {
  const r = await db.send(new GetItemCommand({
    TableName: TABLE,
    Key: marshall({ actionId }),
  }));
  if (!r.Item) return null;
  const action = unmarshall(r.Item);
  return ownsRow(action, tenantId) ? action : null;
}

/**
 * Conditionally update status — only if current status is PENDING_APPROVAL.
 * Throws ConditionalCheckFailedException if the action has already been processed.
 */
async function setStatus(actionId, status, tenantId, extra = {}) {
  const now = new Date().toISOString();
  const names = { '#s': 'status', '#tenant_id': 'tenant_id' };
  const values = { ':pending': 'PENDING_APPROVAL', ':s': status, ':now': now, ':tenant_id': tenantId };
  let set = 'SET #s = :s, updatedAt = :now';
  Object.entries(extra).forEach(([k, v], i) => {
    names[`#x${i}`] = k;
    values[`:x${i}`] = v;
    set += `, #x${i} = :x${i}`;
  });
  await db.send(new UpdateItemCommand({
    TableName: TABLE,
    Key: marshall({ actionId }),
    ConditionExpression: '#s = :pending AND #tenant_id = :tenant_id',
    UpdateExpression: set,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: marshall(values),
  }));
}

// ─── Route handlers ───────────────────────────────────────────────────────────

async function handleListPending(tenantId) {
  const f = andFilter(
    { FilterExpression: '#s = :pending', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':pending': 'PENDING_APPROVAL' } },
    tenantFilter(tenantId),
  );
  const r = await db.send(new ScanCommand({
    TableName: TABLE,
    FilterExpression: f.FilterExpression,
    ExpressionAttributeNames: f.ExpressionAttributeNames,
    ExpressionAttributeValues: marshall(f.ExpressionAttributeValues),
  }));
  const actions = (r.Items ?? []).map(unmarshall).filter((a) => ownsRow(a, tenantId));
  return response(200, { actions, count: actions.length });
}

async function handleGet(actionId, tenantId) {
  const action = await getAction(actionId, tenantId);
  if (!action) return NO_ACTION();
  return response(200, action);
}

async function handleApprove(actionId, approverStaffId, tenantId) {
  const action = await getAction(actionId, tenantId);
  if (!action) return NO_ACTION();

  if (action.status !== 'PENDING_APPROVAL') {
    return response(409, { error: `Action is already ${action.status}` });
  }

  // Self-approval guard — approver must differ from original requester
  if (action.staffId && approverStaffId === action.staffId) {
    return response(403, { error: 'Self-approval is not permitted' });
  }

  // Mark APPROVED (conditional — guard against race)
  try {
    await setStatus(actionId, 'APPROVED', tenantId, { approvedBy: approverStaffId ?? 'unknown' });
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
          tenant_id: tenantId,
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
      event: 'approve_dispatch_error', actionId, toolName: action.toolName, errorName: err?.name ?? 'Error',
    }));
  }

  console.log(JSON.stringify({
    event: 'action_approved', actionId, toolName: action.toolName,
    approvedBy: approverStaffId ?? 'unknown', executedAt,
  }));

  return response(200, { status: 'APPROVED', actionId, executedAt });
}

async function handleReject(actionId, rejectorStaffId, reason, tenantId) {
  const action = await getAction(actionId, tenantId);
  if (!action) return NO_ACTION();

  if (action.status !== 'PENDING_APPROVAL') {
    return response(409, { error: `Action is already ${action.status}` });
  }

  try {
    await setStatus(actionId, 'REJECTED', tenantId, {
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

  // HR-staff list-pending route (JWT-authenticated, specific path)
  if (method === 'GET' && rawPath.endsWith('/actions/pending')) {
    const claims = event.requestContext?.authorizer?.jwt?.claims;
    const groups = groupsOf(claims);
    if (!isIdToken(claims) || (!groups.includes('hr_staff') && !groups.includes('naleko-talentflow-hr'))) {
      return response(403, { error: 'Only HR can see pending actions' });
    }
    const t = requireTenant(event);
    if (t.refusal) return t.refusal;
    const moduleOff = await requireModule(event, 'recruitment'); // MOD-01
    if (moduleOff) return moduleOff;
    return handleListPending(t.tenantId);
  }

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

  // BE-19: the approver is the HR person in the ID token, never the body or an authorizer context.
  let staffId = null;
  if (method === 'POST' && (route === 'approve' || route === 'reject')) {
    const claims = event.requestContext?.authorizer?.jwt?.claims;
    const groups = groupsOf(claims);
    const id = claims?.['custom:staff_id'];
    if (!claims || !isIdToken(claims) || (!groups.includes('hr_staff') && !groups.includes('naleko-talentflow-hr')) || typeof id !== 'string' || !id) {
      return response(403, { error: NOT_ALLOWED });
    }
    staffId = id;
  }

  // TEN-03: after the role check, the company check. The company is the sign-in's (or the agent authorizer's), never the request's.
  const t = requireTenant(event);
  if (t.refusal) return t.refusal;
  const tenantId = t.tenantId;
  // MOD-01: Recruitment must be on for the company (after the company check, before any other AWS call).
  const moduleOff = await requireModule(event, 'recruitment');
  if (moduleOff) return moduleOff;

  console.log(JSON.stringify({ event: 'hitl_request', method, actionId, route, staffId }));

  if (method === 'GET'  && !route)               return handleGet(actionId, tenantId);
  if (method === 'POST' && route === 'approve') return handleApprove(actionId, staffId, tenantId);
  if (method === 'POST' && route === 'reject')  return handleReject(actionId, staffId, body.reason ?? null, tenantId);

  return response(405, { error: 'Method not allowed' });
};
