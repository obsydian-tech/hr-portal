// REC-09: drafts for HR. A rule writes a draft; a Recruiter edits it and sends it, one at a time. Nothing here sends by itself,
// and nothing calls a model. Role, company and module are checked before any AWS call; the company comes from the sign-in only.
// A draft of another company answers 404, the same as one that does not exist.
import { DynamoDBClient, QueryCommand, UpdateItemCommand, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { requireRecruiter, callerId, forbidden } from '../shared/recruitment-access.mjs';
import { requireTenant, tenantKey } from '../shared/tenant.mjs';
import { requireModule } from '../shared/modules.mjs';
import { json } from '../shared/hr-group.mjs';

const db = new DynamoDBClient({});
const sqs = new SQSClient({});
const STATE = () => process.env.STATE_TABLE_NAME ?? 'talent-flow-state';
const IDEMPOTENCY = () => process.env.IDEMPOTENCY_TABLE_NAME ?? 'talent-flow-idempotency-keys';
const MAX_BODY = 5000;
const notFound = () => json(404, { error: 'Not found' });

const bodyOf = (event) => {
  if (!event.body) return {};
  try {
    const p = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
  } catch { return {}; }
};

const view = (d) => ({ id: d.draft_id, candidateId: d.candidate_id, candidateName: d.candidate_name, toEmail: d.to_email, kind: d.kind, body: d.body, status: d.status, createdAt: d.created_at });

async function drafts(tenantId) {
  const rows = [];
  let key;
  do {
    const r = await db.send(new QueryCommand({
      TableName: STATE(), IndexName: 'GSI1', KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :p)', ExclusiveStartKey: key,
      ExpressionAttributeValues: marshall({ ':pk': `TENANT#${tenantId}`, ':p': 'DRAFT#' }),
    }));
    rows.push(...(r.Items ?? []).map((i) => unmarshall(i)));
    key = r.LastEvaluatedKey;
  } while (key);
  return rows.filter((d) => d.tenant_id === tenantId);
}
const find = async (tenantId, id) => (await drafts(tenantId)).find((d) => d.draft_id === id) ?? null;

export const handler = async (event) => {
  const route = event.routeKey ?? event.requestContext?.routeKey ?? '';
  const roleRefusal = requireRecruiter(event);
  if (roleRefusal) return roleRefusal;
  const { tenantId, refusal } = requireTenant(event);
  if (refusal) return refusal;
  const moduleRefusal = await requireModule(event, 'recruitment');
  if (moduleRefusal) return moduleRefusal;
  const personId = callerId(event);
  if (!personId) return forbidden();

  if (route === 'GET /v1/drafts') {
    const open = (await drafts(tenantId)).filter((d) => d.status === 'DRAFT').sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    return json(200, { drafts: open.map(view) });
  }

  const id = event.pathParameters?.id;
  const draft = typeof id === 'string' && id !== '' ? await find(tenantId, id) : null;
  if (!draft) return notFound();
  const keyOfDraft = { PK: draft.PK, SK: draft.SK };
  const now = new Date().toISOString();

  if (route === 'PATCH /v1/drafts/{id}') {
    const text = bodyOf(event).body;
    if (typeof text !== 'string' || text.trim() === '' || text.length > MAX_BODY) return json(400, { error: 'Bad request', code: 'INVALID_BODY' });
    if (draft.status !== 'DRAFT') return json(409, { error: 'Conflict', code: 'NOT_OPEN' });
    await db.send(new UpdateItemCommand({
      TableName: STATE(), Key: marshall(keyOfDraft), UpdateExpression: 'SET #b = :b, edited_by = :p, edited_at = :n', ConditionExpression: '#s = :d AND tenant_id = :t',
      ExpressionAttributeNames: { '#b': 'body', '#s': 'status' }, ExpressionAttributeValues: marshall({ ':b': text, ':p': personId, ':n': now, ':d': 'DRAFT', ':t': tenantId }),
    }));
    return json(200, view({ ...draft, body: text }));
  }

  if (route === 'POST /v1/drafts/{id}/dismiss') {
    if (draft.status !== 'DRAFT') return json(409, { error: 'Conflict', code: 'NOT_OPEN' });
    await db.send(new UpdateItemCommand({
      TableName: STATE(), Key: marshall(keyOfDraft), UpdateExpression: 'SET #s = :x, dismissed_by = :p, dismissed_at = :n', ConditionExpression: '#s = :d AND tenant_id = :t',
      ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: marshall({ ':x': 'DISMISSED', ':p': personId, ':n': now, ':d': 'DRAFT', ':t': tenantId }),
    }));
    return json(200, view({ ...draft, status: 'DISMISSED' }));
  }

  if (route === 'POST /v1/drafts/{id}/send') {
    const clientKey = Object.entries(event.headers ?? {}).find(([n]) => n.toLowerCase() === 'idempotency-key')?.[1];
    const key = typeof clientKey === 'string' && clientKey !== '' ? tenantKey(tenantId, 'DRAFT_SEND', personId, clientKey) : null;
    if (key) {
      const got = await db.send(new GetItemCommand({ TableName: IDEMPOTENCY(), Key: marshall({ idempotencyKey: key }) }));
      const stored = got.Item ? unmarshall(got.Item) : null;
      if (stored?.response) return JSON.parse(stored.response);
    }
    if (draft.status !== 'DRAFT') return json(409, { error: 'Conflict', code: 'NOT_OPEN' });
    // The claim comes first: of two sends at the same moment only one wins, and only the winner queues the email.
    try {
      await db.send(new UpdateItemCommand({
        TableName: STATE(), Key: marshall(keyOfDraft), UpdateExpression: 'SET #s = :x, sent_by = :p, sent_at = :n', ConditionExpression: '#s = :d AND tenant_id = :t',
        ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: marshall({ ':x': 'SENT', ':p': personId, ':n': now, ':d': 'DRAFT', ':t': tenantId }),
      }));
    } catch (err) {
      if (err?.name === 'ConditionalCheckFailedException') return json(409, { error: 'Conflict', code: 'NOT_OPEN' });
      throw err;
    }
    await sqs.send(new SendMessageCommand({
      QueueUrl: process.env.NOTIFICATION_QUEUE_URL,
      MessageBody: JSON.stringify({ type: 'DRAFT_EMAIL', tenant_id: tenantId, recipientId: personId, recipientEmail: draft.to_email, candidateId: draft.candidate_id, subject: draft.kind === 'offer_follow_up' ? 'Your offer' : 'Checking in', body: draft.body, draftId: draft.draft_id }),
      MessageGroupId: tenantId, MessageDeduplicationId: `draft#${draft.draft_id}`,
    }));
    const response = json(200, view({ ...draft, status: 'SENT' }));
    if (key) await db.send(new PutItemCommand({ TableName: IDEMPOTENCY(), Item: marshall({ idempotencyKey: key, response: JSON.stringify(response), expiresAt: Math.floor(Date.now() / 1000) + 48 * 3600 }) }));
    return response;
  }
  return notFound();
};
