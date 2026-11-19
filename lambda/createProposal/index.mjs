/**
 * ONB-22: createProposal - POST /agent/v1/proposals
 *
 * An agent proposes Accept document for one document that is waiting for HR and whose check is Matches. Nothing is
 * decided here: the proposal is a row in naleko-pending-actions that a signed-in HR person answers (approveAgentAction).
 * This Lambda imports no AI client and writes only the proposal and its event.
 *
 * Body: exactly { type: "ACCEPT_DOCUMENT", document_id }. The company is the agent key's company (authorizer context),
 * never the body.
 */

import { DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { randomUUID } from 'node:crypto';
import { requireTenant, ownsItem, notFound, stampTenant } from '../shared/tenant.mjs';
import { findDocument } from '../shared/company-rows.mjs';
import { checkOf } from '../shared/document-check.mjs';
import { json } from '../shared/hr-group.mjs';

const REGION = process.env.AWS_REGION ?? 'af-south-1';
const db = new DynamoDBClient({ region: REGION });
const bus = new EventBridgeClient({ region: REGION });

const PENDING_TABLE = process.env.PENDING_ACTIONS_TABLE ?? 'naleko-pending-actions';
const WEEK = 7 * 24 * 60 * 60;
const KEYS = ['type', 'document_id'];

const log = (event, fields) => console.log(JSON.stringify({ event, ...fields }));

/** The open proposal for this document, if any: waiting for HR and not past its time. */
async function openProposalFor(documentId, tenantId) {
  const now = Math.floor(Date.now() / 1000);
  let start;
  do {
    const page = await db.send(new QueryCommand({
      TableName: PENDING_TABLE,
      IndexName: 'tenant-index',
      KeyConditionExpression: 'tenant_id = :t',
      ExpressionAttributeValues: { ':t': { S: tenantId } },
      ...(start ? { ExclusiveStartKey: start } : {}),
    }));
    for (const item of page.Items ?? []) {
      if (!ownsItem(item, tenantId)) continue;
      const row = unmarshall(item);
      if (row.document_id === documentId && row.status === 'PENDING_APPROVAL' && Number(row.expiresAt) > now) return row;
    }
    start = page.LastEvaluatedKey;
  } while (start);
  return null;
}

const handlerFn = async (event, tenantId) => {
  let body;
  try {
    body = JSON.parse(event.body ?? '');
  } catch {
    return json(400, { error: 'The proposal is not valid' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'The proposal is not valid' });
  if (body.type !== 'ACCEPT_DOCUMENT') return json(400, { error: 'Unknown proposal' });
  const extra = Object.keys(body).filter((k) => !KEYS.includes(k));
  const documentId = body.document_id;
  if (extra.length > 0 || typeof documentId !== 'string' || documentId.trim() === '') {
    return json(400, { error: 'The proposal is not valid' });
  }

  // The document must be this company's. Another company's is the same as one that does not exist.
  const doc = await findDocument(documentId, tenantId);
  if (!doc) return notFound();
  const document = unmarshall(doc);

  // Waiting for HR (not decided, not still being read) and the check is Matches.
  let verification = null;
  if (document.verification_id) {
    const v = await db.send(new GetItemCommand({ TableName: process.env.VERIFICATIONS_TABLE ?? 'document-verification', Key: { verificationId: { S: document.verification_id } } }));
    verification = ownsItem(v.Item, tenantId) ? unmarshall(v.Item) : null;
  }
  const waiting = !document.hr_reviewed_at && document.ocr_status !== 'PENDING' && document.ocr_status !== 'PROCESSING';
  const check = checkOf(document, verification);
  if (!waiting || check !== 'MATCHES') {
    return json(409, { error: 'This document was already decided, is still being read, or does not match' });
  }

  const open = await openProposalFor(documentId, tenantId);
  if (open) return json(409, { error: 'There is already a proposal for this document', action_id: open.actionId });

  const emp = await db.send(new GetItemCommand({ TableName: process.env.EMPLOYEES_TABLE ?? 'employees', Key: { employee_id: { S: document.employee_id } }, ProjectionExpression: '#f, #l, #t', ExpressionAttributeNames: { '#f': 'first_name', '#l': 'last_name', '#t': 'tenant_id' } }));
  const employee = ownsItem(emp.Item, tenantId) ? unmarshall(emp.Item) : null;
  if (!employee) return notFound();

  const now = new Date();
  const row = stampTenant({
    actionId: randomUUID(),
    type: 'ACCEPT_DOCUMENT',
    document_id: documentId,
    employee_id: document.employee_id,
    employee_name: `${employee.first_name ?? ''} ${employee.last_name ?? ''}`.trim(),
    document_type: document.document_type,
    check,
    proposed_by_kind: 'AGENT',
    proposed_by_id: 'default',
    status: 'PENDING_APPROVAL',
    createdAt: now.toISOString(),
    expiresAt: Math.floor(now.getTime() / 1000) + WEEK,
  }, tenantId);
  await db.send(new PutItemCommand({ TableName: PENDING_TABLE, Item: marshall(row), ConditionExpression: 'attribute_not_exists(actionId)' }));

  // The creation is published for the audit log. The event holds ids and the type, never a file name or a link.
  // A failed put is not a failed proposal: the row exists and HR sees it, so the answer stays 201 and the log holds the error name.
  if (process.env.EVENT_BUS_NAME) {
    try {
      await bus.send(new PutEventsCommand({
        Entries: [{
          EventBusName: process.env.EVENT_BUS_NAME,
          Source: 'naleko.onboarding',
          DetailType: 'proposal.created',
          Detail: JSON.stringify({
            action_id: row.actionId, type: row.type, document_id: documentId, employee_id: row.employee_id,
            proposed_by: { kind: 'AGENT', id: 'default' }, actor: 'AGENT', tenant_id: tenantId, at: row.createdAt,
          }),
        }],
      }));
    } catch (err) {
      log('publish_failed', { detailType: 'proposal.created', errorName: err?.name ?? 'Error' });
    }
  }
  log('proposal_created', { actionId: row.actionId });
  return json(201, {
    action_id: row.actionId, type: row.type, status: row.status, document_id: documentId, employee_id: row.employee_id,
    created_at: row.createdAt, expires_at: new Date(row.expiresAt * 1000).toISOString(),
  });
};

export const handler = async (event) => {
  // Only the agent key makes a proposal (the route's authorizer), and only for its company.
  if (event?.requestContext?.authorizer?.lambda?.actor !== 'AGENT') return json(403, { error: 'Forbidden' });
  const { tenantId, refusal } = requireTenant(event);
  if (refusal) return refusal;
  try {
    return await handlerFn(event, tenantId);
  } catch (err) {
    console.error(JSON.stringify({ event: 'create_proposal_error', errorName: err?.name ?? 'Error' }));
    return json(500, { error: 'Internal server error' });
  }
};
