/**
 * REC-12: the Recruitment seed (the Standard pack). Writes version 1 of every setting type a company
 * lacks, in transactions of at most 25 items, each Put conditional (never overwrites), then a completion marker.
 */
import { QueryCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { DEFAULTS, TYPES } from '../../../lambda/shared/recruitment-settings.mjs';

export const available = true;
const TABLE = () => process.env.CONFIG_TABLE_NAME ?? 'talent-flow-config';

export default async function seed({ ddb, tenantId, log }) {
  const have = new Set();
  let marker = false;
  let key;
  do {
    const r = await ddb.send(new QueryCommand({ TableName: TABLE(), KeyConditionExpression: 'PK = :pk', ExclusiveStartKey: key, ExpressionAttributeValues: marshall({ ':pk': `TENANT#${tenantId}` }) }));
    for (const i of (r.Items ?? []).map((x) => unmarshall(x))) {
      const m = /^CONFIG#([A-Z_]+)#v\d+$/.exec(i.SK);
      if (m) have.add(m[1]);
      if (i.SK === 'PACK#RECRUITMENT') marker = true;
    }
    key = r.LastEvaluatedKey;
  } while (key);
  const now = new Date().toISOString();
  const items = TYPES.filter((t) => !have.has(t)).map((type) => ({ Put: {
    TableName: TABLE(), ConditionExpression: 'attribute_not_exists(PK)',
    Item: marshall({ PK: `TENANT#${tenantId}`, SK: `CONFIG#${type}#v1`, GSI1PK: `TENANT#${tenantId}#ACTIVE`, GSI1SK: `CONFIG#${type}`, tenant_id: tenantId, configType: type, version: 1, isActive: true, data: DEFAULTS[type], createdAt: now }),
  } }));
  if (!marker) items.push({ Put: { TableName: TABLE(), ConditionExpression: 'attribute_not_exists(PK)', Item: marshall({ PK: `TENANT#${tenantId}`, SK: 'PACK#RECRUITMENT', tenant_id: tenantId, completedAt: now }) } });
  for (let i = 0; i < items.length; i += 25) await ddb.send(new TransactWriteItemsCommand({ TransactItems: items.slice(i, i + 25) }));
  log(`Recruitment Standard pack: ${items.length - (marker ? 0 : 1)} setting(s) written`);
  return { written: items.length };
}
