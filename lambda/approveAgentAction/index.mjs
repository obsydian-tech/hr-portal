/**
 * NH-73 / ONB-22: approveAgentAction
 *
 * A proposal an agent made (createProposal) is answered here, by a signed-in HR person and by nobody else.
 *
 * Routes:
 *   GET  /agent/v1/actions                     - HR's list: the open proposals, then the last 20 answered   (Cognito JWT, hr_staff)
 *   GET  /agent/v1/actions/{actionId}          - one proposal's status, for the agent that made it         (agent key)
 *   POST /agent/v1/actions/{actionId}/approve  - HR approves: the real review runs as that person            (Cognito JWT, hr_staff)
 *   POST /agent/v1/actions/{actionId}/reject   - HR declines: nothing runs                                   (Cognito JWT, hr_staff)
 *
 * The approver is the signed-in person's own verified claims, never the body. Approving claims the proposal with one
 * conditional write, then invokes reviewDocumentVerification with a copy of those claims, so the decision, its audit
 * event and the Verified rule are exactly the screen's. The run ends RAN, REFUSED or FAILED, with a code and never an
 * exception's words. This Lambda imports no AI client.
 *
 * DynamoDB table: naleko-pending-actions (PK actionId, tenant-index on tenant_id and createdAt)
 */

import { DynamoDBClient, GetItemCommand, QueryCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { requireTenant, ownsItem, notFound, tenantFilter } from '../shared/tenant.mjs';
import { checkOf } from '../shared/document-check.mjs';
import { rolesOf } from '../shared/roles.mjs';
import { json } from '../shared/hr-group.mjs';

const REGION = process.env.AWS_REGION ?? 'af-south-1';
const db = new DynamoDBClient({ region: REGION });
const bus = new EventBridgeClient({ region: REGION });
const TABLE = process.env.PENDING_ACTIONS_TABLE ?? 'naleko-pending-actions';
const DECIDED_SHOWN = 20;
const KEEP_DECIDED = 90 * 24 * 60 * 60; // a decided row is kept 90 days (the TTL); the audit event is the other record
const keepUntil = () => Math.floor(Date.now() / 1000) + KEEP_DECIDED;

const log = (event, fields = {}) => console.log(JSON.stringify({ event, ...fields }));

// ─── Who is asking ────────────────────────────────────────────────────────────

const isAgent = (event) => event?.requestContext?.authorizer?.lambda?.actor === 'AGENT';
const isHr = (event) => rolesOf(event).roles.includes('hr_staff');
const claimsOf = (event) => event?.requestContext?.authorizer?.jwt?.claims ?? {};

/** The person as the screen records them: the email, and the name (else the email). Only ever from the token. */
function personOf(event) {
  const c = claimsOf(event);
  const email = String(c.email ?? '');
  return { email, name: `${c.given_name ?? ''} ${c.family_name ?? ''}`.trim() || email };
}

// ─── Rows ─────────────────────────────────────────────────────────────────────

async function getAction(actionId, tenantId) {
  const r = await db.send(new GetItemCommand({ TableName: TABLE, Key: marshall({ actionId }), ConsistentRead: true }));
  return ownsItem(r.Item, tenantId) ? unmarshall(r.Item) : null;
}

const expired = (a) => a.status === 'PENDING_APPROVAL' && Number(a.expiresAt) <= Math.floor(Date.now() / 1000);
const statusOf = (a) => (expired(a) ? 'EXPIRED' : a.status);
const iso = (epoch) => (Number.isFinite(Number(epoch)) ? new Date(Number(epoch) * 1000).toISOString() : undefined);

/** One row as HR's list shows it: what HR needs to decide, no file link and no number. */
function listItem(a) {
  return {
    action_id: a.actionId,
    type: a.type,
    status: statusOf(a),
    document_id: a.document_id,
    employee_id: a.employee_id,
    employee_name: a.employee_name,
    document_type: a.document_type,
    check: a.check,
    proposed_by: { kind: a.proposed_by_kind, id: a.proposed_by_id },
    created_at: a.createdAt,
    expires_at: iso(a.expiresAt),
    run_status: a.run_status,
    error_code: a.error_code,
    approved_by_name: a.approved_by_name,
    approved_at: a.approved_at,
    rejected_by_name: a.rejected_by_name,
    rejected_at: a.rejected_at,
  };
}

/** The agent's own view of one proposal: nothing about the person. */
function statusItem(a) {
  return {
    action_id: a.actionId,
    type: a.type,
    document_id: a.document_id,
    status: statusOf(a),
    run_status: a.run_status,
    created_at: a.createdAt,
    decided_at: a.approved_at ?? a.rejected_at,
  };
}

async function publish(detailType, detail) {
  if (!process.env.EVENT_BUS_NAME) return;
  // One retry: the event is the durable link between the agent and the person, so a single failed put is not the end.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await bus.send(new PutEventsCommand({
        Entries: [{ EventBusName: process.env.EVENT_BUS_NAME, Source: 'naleko.onboarding', DetailType: detailType, Detail: JSON.stringify(detail) }],
      }));
      return;
    } catch (err) {
      log('publish_failed', { detailType, attempt, errorName: err?.name ?? 'Error' });
    }
  }
}

/** One write on the proposal, only while it is still waiting and only for the caller's company. */
async function claimWith(actionId, tenantId, status, fields) {
  const t = tenantFilter(tenantId);
  const names = { '#s': 'status', ...t.ExpressionAttributeNames };
  const values = { ':pending': 'PENDING_APPROVAL', ':now': Math.floor(Date.now() / 1000), ':tenant_id': tenantId, ':next': status };
  const parts = ['#s = :next'];
  for (const [k, v] of Object.entries(fields)) { names[`#f_${k}`] = k; values[`:f_${k}`] = v; parts.push(`#f_${k} = :f_${k}`); }
  try {
    await db.send(new UpdateItemCommand({
      TableName: TABLE,
      Key: marshall({ actionId }),
      UpdateExpression: `SET ${parts.join(', ')}`,
      ConditionExpression: `(#s = :pending AND expiresAt > :now) AND ${t.FilterExpression}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: marshall(values),
    }));
    return true;
  } catch (err) {
    if (err?.name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

async function setRun(actionId, tenantId, fields) {
  const t = tenantFilter(tenantId);
  const names = { ...t.ExpressionAttributeNames };
  const values = { ':tenant_id': tenantId };
  const parts = [];
  for (const [k, v] of Object.entries(fields)) { names[`#f_${k}`] = k; values[`:f_${k}`] = v; parts.push(`#f_${k} = :f_${k}`); }
  await db.send(new UpdateItemCommand({
    TableName: TABLE,
    Key: marshall({ actionId }),
    UpdateExpression: `SET ${parts.join(', ')}`,
    ConditionExpression: t.FilterExpression,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: marshall(values),
  }));
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/** HR's list: the open proposals newest first, then the last 20 answered newest first. */
async function handleList(tenantId) {
  const rows = [];
  let start;
  do {
    const page = await db.send(new QueryCommand({
      TableName: TABLE,
      IndexName: 'tenant-index',
      KeyConditionExpression: 'tenant_id = :t',
      ExpressionAttributeValues: { ':t': { S: tenantId } },
      ScanIndexForward: false,
      ...(start ? { ExclusiveStartKey: start } : {}),
    }));
    for (const item of page.Items ?? []) if (ownsItem(item, tenantId)) rows.push(unmarshall(item));
    start = page.LastEvaluatedKey;
  } while (start);
  const newest = (a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);
  const open = rows.filter((a) => statusOf(a) === 'PENDING_APPROVAL').sort(newest);
  const decided = rows.filter((a) => statusOf(a) !== 'PENDING_APPROVAL').sort(newest).slice(0, DECIDED_SHOWN);
  const items = [...open, ...decided].map(listItem);
  return json(200, { items, count: items.length });
}

async function handleGet(actionId, tenantId) {
  const action = await getAction(actionId, tenantId);
  if (!action) return notFound();
  return json(200, statusItem(action));
}

const stand = (a) => ({ status: statusOf(a), ...(a.run_status ? { run_status: a.run_status } : {}) });

/** What the review answered, as a code. 200 is the run; anything else is a code and never the answer's words. */
function endOf(statusCode) {
  if (statusCode === 200) return { run_status: 'RAN' };
  if (statusCode === 409) return { run_status: 'REFUSED', error_code: 'ALREADY_DECIDED' };
  if (statusCode === 404) return { run_status: 'REFUSED', error_code: 'NOT_FOUND' };
  if (statusCode === 403) return { run_status: 'REFUSED', error_code: 'NOT_ALLOWED' };
  return { run_status: 'FAILED', error_code: 'RUN_FAILED' };
}

/** Before the review is asked: is the document still the one HR was told about? A code when it is not. */
async function stillWaiting(action, tenantId) {
  const d = await db.send(new GetItemCommand({
    TableName: 'documents',
    Key: { employee_id: { S: action.employee_id }, document_id: { S: action.document_id } },
    ConsistentRead: true,
  }));
  if (!ownsItem(d.Item, tenantId)) return { run_status: 'REFUSED', error_code: 'NOT_FOUND' };
  const doc = unmarshall(d.Item);
  if (doc.hr_reviewed_at) return { run_status: 'REFUSED', error_code: 'ALREADY_DECIDED' };
  let verification = null;
  if (doc.verification_id) {
    const v = await db.send(new GetItemCommand({ TableName: 'document-verification', Key: { verificationId: { S: doc.verification_id } } }));
    verification = ownsItem(v.Item, tenantId) ? unmarshall(v.Item) : null;
  }
  if (checkOf(doc, verification) !== 'MATCHES') return { run_status: 'REFUSED', error_code: 'CHECK_CHANGED' };
  return null;
}

/** Runs the real review as the approver. Never throws: any failure is a code. */
async function runReview(event, action) {
  try {
    const name = process.env.REVIEW_FUNCTION_NAME;
    if (!name) return { run_status: 'FAILED', error_code: 'RUN_FAILED' };
    // Loaded when a run starts, so a decline or a read never needs the client.
    const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
    const lambda = new LambdaClient({ region: REGION });
    const payload = {
      version: '2.0',
      rawPath: `/v1/verifications/${action.document_id}/review`,
      headers: { 'content-type': 'application/json', 'idempotency-key': action.actionId },
      pathParameters: { id: action.document_id },
      requestContext: {
        http: { method: 'PATCH', path: `/v1/verifications/${action.document_id}/review` },
        // The approver's own verified claims, as the sign-in gave them. Nothing from the body.
        authorizer: { jwt: { claims: { ...claimsOf(event) } } },
      },
      body: JSON.stringify({ decision: 'PASSED', employee_id: action.employee_id }),
    };
    const out = await lambda.send(new InvokeCommand({ FunctionName: name, InvocationType: 'RequestResponse', Payload: new TextEncoder().encode(JSON.stringify(payload)) }));
    if (out.FunctionError) return { run_status: 'FAILED', error_code: 'RUN_FAILED' };
    const answer = JSON.parse(new TextDecoder().decode(out.Payload ?? new Uint8Array()) || 'null');
    return endOf(Number(answer?.statusCode));
  } catch (err) {
    log('review_invoke_failed', { errorName: err?.name ?? 'Error' });
    return { run_status: 'FAILED', error_code: 'RUN_FAILED' };
  }
}

async function handleApprove(event, actionId, tenantId) {
  const action = await getAction(actionId, tenantId);
  if (!action) return notFound();
  if (action.type !== 'ACCEPT_DOCUMENT') return json(409, { error: 'This proposal cannot be approved here', ...stand(action) });
  if (action.status !== 'PENDING_APPROVAL' || expired(action)) return json(409, { error: `This proposal is already ${statusOf(action)}`, ...stand(action) });

  const who = personOf(event);
  const now = new Date().toISOString();
  // One winner: a second approve, or a decline, that arrives later finds it no longer waiting.
  const won = await claimWith(actionId, tenantId, 'APPROVED', { approved_by: who.email, approved_by_name: who.name, approved_at: now, run_status: 'RUNNING', expiresAt: keepUntil(), updatedAt: now });
  if (!won) {
    const now2 = await getAction(actionId, tenantId);
    if (!now2) return notFound();
    return json(409, { error: `This proposal is already ${statusOf(now2)}`, ...stand(now2) });
  }

  const end = (await stillWaiting(action, tenantId)) ?? (await runReview(event, action));
  await setRun(actionId, tenantId, { run_status: end.run_status, ...(end.error_code ? { error_code: end.error_code } : {}), updatedAt: new Date().toISOString() });
  await publish('proposal.approved', {
    action_id: actionId, type: action.type, proposed_by: { kind: action.proposed_by_kind, id: action.proposed_by_id },
    approved_by: who.email, approved_by_name: who.name, document_id: action.document_id, employee_id: action.employee_id,
    run_status: end.run_status, ...(end.error_code ? { error_code: end.error_code } : {}),
    actor: 'HUMAN', tenant_id: tenantId, at: now,
  });
  log('action_approved', { actionId, runStatus: end.run_status });
  return json(200, { status: 'APPROVED', action_id: actionId, run_status: end.run_status, ...(end.error_code ? { error_code: end.error_code } : {}) });
}

async function handleReject(event, actionId, tenantId) {
  const action = await getAction(actionId, tenantId);
  if (!action) return notFound();
  // Only Accept document is answered here; a row of any other type is refused before the claim.
  if (action.type !== 'ACCEPT_DOCUMENT') return json(409, { error: 'This proposal cannot be declined here', ...stand(action) });
  if (action.status !== 'PENDING_APPROVAL' || expired(action)) return json(409, { error: `This proposal is already ${statusOf(action)}`, ...stand(action) });

  const who = personOf(event);
  const now = new Date().toISOString();
  const won = await claimWith(actionId, tenantId, 'REJECTED', { rejected_by: who.email, rejected_by_name: who.name, rejected_at: now, expiresAt: keepUntil(), updatedAt: now });
  if (!won) {
    const now2 = await getAction(actionId, tenantId);
    if (!now2) return notFound();
    return json(409, { error: `This proposal is already ${statusOf(now2)}`, ...stand(now2) });
  }
  await publish('proposal.rejected', {
    action_id: actionId, type: action.type, proposed_by: { kind: action.proposed_by_kind, id: action.proposed_by_id },
    rejected_by: who.email, rejected_by_name: who.name, document_id: action.document_id, employee_id: action.employee_id,
    actor: 'HUMAN', tenant_id: tenantId, at: now,
  });
  log('action_rejected', { actionId });
  return json(200, { status: 'REJECTED', action_id: actionId });
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  const method = event.requestContext?.http?.method ?? event.httpMethod;
  const rawPath = event.rawPath ?? event.path ?? '';
  const m = rawPath.match(/\/actions(?:\/([^/]+)(?:\/(approve|reject))?)?\/?$/);
  if (!m) return json(400, { error: 'Invalid path' });
  const actionId = m[1] ? decodeURIComponent(m[1]) : undefined;
  const verb = m[2];

  const readOnlyStatus = method === 'GET' && actionId && !verb;
  // HR's own routes: the group is checked before anything else, before any table is read.
  if (!readOnlyStatus && (!isHr(event) || !personOf(event).email)) return json(403, { error: 'Only HR can answer a proposal' });
  if (readOnlyStatus && !isAgent(event) && !isHr(event)) return json(403, { error: 'Forbidden' });
  const { tenantId, refusal } = requireTenant(event);
  if (refusal) return refusal;

  try {
    if (method === 'GET' && !actionId) return await handleList(tenantId);
    if (readOnlyStatus) return await handleGet(actionId, tenantId);
    if (method === 'POST' && actionId && verb === 'approve') return await handleApprove(event, actionId, tenantId);
    if (method === 'POST' && actionId && verb === 'reject') return await handleReject(event, actionId, tenantId);
    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error(JSON.stringify({ event: 'approve_agent_action_error', errorName: err?.name ?? 'Error' }));
    return json(500, { error: 'Internal server error' });
  }
};
