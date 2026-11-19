/**
 * CHAT-02: PUT /v1/admin/company/ask-batsi { "enabled": true | false }. A company admin turns Ask Batsi on or off for
 * their own company.
 *
 * Who: the admin group on an ID token. The company is the sign-in's: nothing in the body, query, path or headers names it,
 * and nothing in the body but `enabled` is read. The change and its audit row are written in one transaction, in the same
 * shape lambda/shared/modules.mjs and scripts/tenancy/lib/set-modules.mjs use (pk TENANT#<id>, sk MODULES#<time>#<id>, from, to, by).
 * Only the ask_batsi key moves; a founding company with no modules attribute gets its default written out first, so turning
 * Ask Batsi on does not turn Onboarding and Recruitment off. A change that changes nothing writes nothing. Turning it
 * off deletes no chat. An empty set is never written (DynamoDB refuses one): an empty list is.
 */
import { DynamoDBClient, GetItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { randomBytes } from 'node:crypto';
import { inGroup, json } from '../shared/hr-group.mjs';
import { requireTenant } from '../shared/tenant.mjs';
import { MODULE_KEYS, modulesOfRow } from '../shared/modules.mjs';

const KEY = 'ask_batsi';
const dynamo = new DynamoDBClient({});

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function ulid(now = Date.now()) {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) { time = CROCKFORD[t % 32] + time; t = Math.floor(t / 32); }
  const bytes = randomBytes(16);
  let rand = '';
  for (let i = 0; i < 16; i++) rand += CROCKFORD[bytes[i] % 32];
  return time + rand;
}

export const handler = async (event) => {
  try {
    const claims = event?.requestContext?.authorizer?.jwt?.claims ?? {};
    if (!inGroup(claims, 'admin')) return json(403, { error: 'Forbidden' });
    const { tenantId, refusal } = requireTenant(event);
    if (refusal) return refusal;

    let body;
    try {
      body = JSON.parse(event?.body ?? '');
    } catch {
      return json(400, { error: 'Bad request' });
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body) || typeof body.enabled !== 'boolean') {
      return json(400, { error: 'Bad request' });
    }
    const enabled = body.enabled;

    const table = process.env.TENANTS_TABLE;
    const key = { pk: { S: `TENANT#${tenantId}` }, sk: { S: 'PROFILE' } };
    const res = await dynamo.send(new GetItemCommand({ TableName: table, Key: key, ConsistentRead: true }));
    const from = modulesOfRow(res.Item);
    if (from === null) return json(403, { error: 'Forbidden' });

    const to = MODULE_KEYS.filter((k) => (k === KEY ? enabled : from.includes(k)));
    if (to.length === from.length && to.every((k) => from.includes(k))) return json(200, { enabled });

    const at = new Date();
    const list = (keys) => ({ L: keys.map((k) => ({ S: k })) });
    await dynamo.send(new TransactWriteItemsCommand({
      TransactItems: [
        {
          Update: {
            TableName: table,
            Key: key,
            UpdateExpression: 'SET #modules = :modules',
            ConditionExpression: 'attribute_exists(pk)',
            ExpressionAttributeNames: { '#modules': 'modules' },
            ExpressionAttributeValues: { ':modules': to.length ? { SS: to } : list([]) },
          },
        },
        {
          Put: {
            TableName: table,
            Item: {
              pk: { S: `TENANT#${tenantId}` },
              sk: { S: `MODULES#${at.toISOString()}#${ulid(at.getTime())}` },
              tenant_id: { S: tenantId },
              from: list(from),
              to: list(to),
              by: { S: String(claims.sub ?? '') },
            },
            ConditionExpression: 'attribute_not_exists(sk)',
          },
        },
      ],
    }));
    return json(200, { enabled });
  } catch (err) {
    console.error('Ask Batsi switch failed', { error: err?.name ?? 'Error' });
    return json(500, { error: 'Something went wrong' });
  }
};
