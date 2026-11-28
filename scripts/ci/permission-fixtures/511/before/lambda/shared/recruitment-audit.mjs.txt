/**
 * REC-05 rule 9: one audit row each time a person looks at something hidden (a salary today; REC-08 reuses it for candidate views).
 * Row: { tenant_id, person_id, kind, offer_id?, at } in the state table under the company's AUDIT key. It never holds the value seen.
 */
import { randomUUID } from 'node:crypto';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { tenantKey } from './tenant.mjs';

const db = new DynamoDBClient({});
const STATE = () => process.env.STATE_TABLE_NAME ?? 'talent-flow-state';

/** Writes one audit row. `subject` holds the ids of what was seen (offer_id). */
export async function recordView({ tenantId, personId, kind, subject = {}, at = new Date().toISOString() }) {
  await db.send(new PutItemCommand({
    TableName: STATE(),
    Item: marshall({ PK: tenantKey(tenantId, 'AUDIT'), SK: `${at}#${randomUUID()}`, tenant_id: tenantId, person_id: personId, kind, ...subject, at }),
    ConditionExpression: 'attribute_not_exists(PK)',
  }));
}
