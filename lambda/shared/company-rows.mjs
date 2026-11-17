/**
 * TEN-02: a company's rows from the employees, documents and document-verification tables. Each has a
 * tenant-index (hash tenant_id), so a list reads only the company's rows (every page). Rows written before TEN-02
 * carry no company and are in no tenant-index, so only the legacy company, while the legacy rule is on, reads the
 * table with the company filter instead (step 2 removes that branch). Rows come back in AttributeValue form and
 * every one is checked with ownsRow.
 */
import { DynamoDBClient, QueryCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { tenantFilter, readsLegacyRows, ownsItem, bracket } from './tenant.mjs';

const db = new DynamoDBClient({ region: 'af-south-1' });

/**
 * Every row of `table` in this company that passes `filter` ({ FilterExpression, ExpressionAttributeNames,
 * ExpressionAttributeValues } in AttributeValue form, optional). `stop(item)` ends the read at the first match.
 */
export async function companyRows(table, tenantId, filter = {}, stop) {
  const t = tenantFilter(tenantId);
  const legacy = readsLegacyRows(tenantId);
  const names = { ...(filter.ExpressionAttributeNames ?? {}), '#tenant_id': 'tenant_id' };
  // filter.project: only these attributes are read (tenant_id is always added, for the row check).
  let projection;
  if (filter.project) {
    const wanted = [...new Set([...filter.project, 'tenant_id'])];
    projection = wanted.map((n, i) => { names[`#p${i}`] = n; return `#p${i}`; }).join(', ');
  }
  const values = { ...(filter.ExpressionAttributeValues ?? {}), ':tenant_id': { S: tenantId } };
  const out = [];
  let start;
  do {
    const input = legacy
      ? {
          TableName: table,
          FilterExpression: filter.FilterExpression ? `(${filter.FilterExpression}) AND ${bracket(t.FilterExpression)}` : t.FilterExpression,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ...(projection ? { ProjectionExpression: projection } : {}),
          ...(filter.limit ? { Limit: filter.limit } : {}),
          ...(start ? { ExclusiveStartKey: start } : {}),
        }
      : {
          TableName: table,
          IndexName: 'tenant-index',
          KeyConditionExpression: '#tenant_id = :tenant_id',
          ...(filter.FilterExpression ? { FilterExpression: filter.FilterExpression } : {}),
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ...(projection ? { ProjectionExpression: projection } : {}),
          ...(filter.limit ? { Limit: filter.limit } : {}),
          ...(start ? { ExclusiveStartKey: start } : {}),
        };
    const page = await db.send(legacy ? new ScanCommand(input) : new QueryCommand(input));
    for (const item of page.Items ?? []) {
      if (!ownsItem(item, tenantId)) continue;
      out.push(item);
      if (stop && stop(item)) return out;
    }
    start = filter.onePage ? undefined : page.LastEvaluatedKey;
  } while (start);
  return out;
}

/** One document by its id within the company, or undefined. Another company's is never returned. */
export async function findDocument(documentId, tenantId) {
  const rows = await companyRows('documents', tenantId, {
    FilterExpression: 'document_id = :docId',
    ExpressionAttributeValues: { ':docId': { S: documentId } },
  }, () => true);
  return rows[0];
}

/**
 * One page of the legacy company's rows, read the old way (a Scan with the company filter), for a list that pages
 * itself. Only while the legacy rule is on and only for the legacy company; anyone else gets an error. Step 2 removes it.
 */
export async function legacyPage(table, tenantId, params = {}) {
  if (!readsLegacyRows(tenantId)) throw new Error('Not the legacy company');
  const t = tenantFilter(tenantId);
  const page = await db.send(new ScanCommand({
    ...params,
    TableName: table,
    FilterExpression: params.FilterExpression ? `(${params.FilterExpression}) AND ${bracket(t.FilterExpression)}` : t.FilterExpression,
    ExpressionAttributeNames: { ...(params.ExpressionAttributeNames ?? {}), ...t.ExpressionAttributeNames },
    ExpressionAttributeValues: { ...(params.ExpressionAttributeValues ?? {}), ':tenant_id': { S: tenantId } },
  }));
  return { Items: (page.Items ?? []).filter((item) => ownsItem(item, tenantId)), LastEvaluatedKey: page.LastEvaluatedKey };
}
