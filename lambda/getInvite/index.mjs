import { DynamoDBClient, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { hrOnly, json } from '../shared/hr-group.mjs';
import { INVITES_TABLE, MAX_FAILED } from '../shared/invite.mjs';

const logger = new Logger({ serviceName: 'getInvite' });
const ddb = new DynamoDBClient();

/** GET /v1/employees/{id}/invite  HR only. */
export const handler = async (event) => {
  const refused = hrOnly(event, 'Only HR can see the invite link');
  if (refused) return refused;
  const id = event.pathParameters?.id;
  try {
    const emp = (await ddb.send(new GetItemCommand({ TableName: 'employees', Key: { employee_id: { S: String(id ?? '') } }, ProjectionExpression: 'employee_id, email' }))).Item;
    if (!emp) return json(404, { error: 'Not found' });
    const rows = [];
    let start;
    do {
      const page = await ddb.send(new QueryCommand({ TableName: INVITES_TABLE, IndexName: 'employee-index', KeyConditionExpression: 'employee_id = :e', ExpressionAttributeValues: { ':e': { S: id } }, ExclusiveStartKey: start }));
      rows.push(...(page.Items ?? []));
      start = page.LastEvaluatedKey;
    } while (start);
    if (!rows.length) return json(200, { status: 'none' });
    const row = rows.reduce((a, b) => (b.created_at.S > a.created_at.S ? b : a));
    let status = 'ok';
    if (row.used_at?.S) status = 'used';
    else if (row.replaced_at?.S || Number(row.failed_attempts?.N ?? 0) >= MAX_FAILED || Date.parse(row.expires_at.S) <= Date.now()) status = 'expired';
    return json(200, { status, sentAt: row.created_at.S, expiresAt: row.expires_at.S, sentTo: emp.email?.S ?? '' });
  } catch (e) {
    logger.error('Get invite failed', { error: e?.name });
    return json(500, { error: 'Something went wrong' });
  }
};
