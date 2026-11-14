// A DynamoDB client over the fake tables (AttributeValue form). Scan answers in pages, as DynamoDB
// does: a page holds at most Limit rows and at most world.pageSize rows, the filter runs on each page
// after it is read, and LastEvaluatedKey is set while rows remain. Reading never writes: a write fails.
import { world, calls, table } from './world.mjs';
import { compile } from './expression.mjs';
import { marshall, unmarshall } from './util-dynamodb.mjs';

class Command { constructor(input) { this.input = input; } }
export class QueryCommand extends Command { get op() { return 'Query'; } }
export class GetItemCommand extends Command { get op() { return 'GetItem'; } }
export class ScanCommand extends Command { get op() { return 'Scan'; } }
export class BatchGetItemCommand extends Command { get op() { return 'BatchGetItem'; } }
export class PutItemCommand extends Command { get op() { return 'PutItem'; } }
export class UpdateItemCommand extends Command { get op() { return 'UpdateItem'; } }
export class DeleteItemCommand extends Command { get op() { return 'DeleteItem'; } }
export class BatchWriteItemCommand extends Command { get op() { return 'BatchWriteItem'; } }
export class TransactWriteItemsCommand extends Command { get op() { return 'TransactWriteItems'; } }

const keyOf = (row, keys) => Object.fromEntries(keys.map((k) => [k, row[k]]));
const sameKey = (row, key) => Object.entries(key).every(([k, v]) => JSON.stringify(row[k]) === JSON.stringify(v));

function filtered(input, rows) {
  if (!input.FilterExpression) return rows;
  const f = compile(input.FilterExpression, input.ExpressionAttributeNames, input.ExpressionAttributeValues);
  return rows.filter(f);
}

export async function answer(op, input) {
  const tableName = input.TableName ?? Object.keys(input.RequestItems ?? {}).join(',');
  calls.push({ service: 'dynamodb', op, table: tableName, startKey: !!input.ExclusiveStartKey });
  if (op === 'Query') {
    if (input.IndexName) throw new Error(`fake DynamoDB: no index ${input.IndexName}; query the table by its key`);
    const { rows } = table(input.TableName);
    const k = compile(input.KeyConditionExpression, input.ExpressionAttributeNames, input.ExpressionAttributeValues);
    const matched = rows.filter(k);
    const items = filtered(input, matched);
    return { Items: items, Count: items.length, ScannedCount: matched.length };
  }
  if (op === 'GetItem') {
    const { rows } = table(input.TableName);
    const item = rows.find((r) => sameKey(r, input.Key));
    return item ? { Item: item } : {};
  }
  if (op === 'Scan') {
    if (input.IndexName) throw new Error(`fake DynamoDB: no index ${input.IndexName}`);
    const { rows: all, keys } = table(input.TableName);
    const rows = input.TotalSegments ? all.filter((_r, i) => i % input.TotalSegments === (input.Segment ?? 0)) : all;
    let from = 0;
    if (input.ExclusiveStartKey) {
      const at = rows.findIndex((r) => sameKey(r, input.ExclusiveStartKey));
      if (at < 0) throw new Error('fake DynamoDB: ExclusiveStartKey is not a key of this table');
      from = at + 1;
    }
    const size = Math.max(1, Math.min(input.Limit ?? Infinity, world.pageSize ?? Infinity));
    const page = rows.slice(from, from + size);
    const items = filtered(input, page);
    const out = { Items: items, Count: items.length, ScannedCount: page.length };
    if (from + size < rows.length && page.length) out.LastEvaluatedKey = keyOf(page[page.length - 1], keys);
    return out;
  }
  if (op === 'BatchGetItem') {
    const Responses = {};
    for (const [name, req] of Object.entries(input.RequestItems)) {
      if (req.Keys.length > 100) throw new Error('fake DynamoDB: BatchGetItem takes at most 100 keys');
      const { rows } = table(name);
      Responses[name] = req.Keys.map((key) => rows.find((r) => sameKey(r, key))).filter(Boolean);
    }
    return { Responses, UnprocessedKeys: {} };
  }
  throw new Error(`fake DynamoDB: ${op} is not expected: reading the list never writes`);
}

async function* pages(client, Cmd, input) {
  let key = input.ExclusiveStartKey;
  do {
    const out = await client.send(new Cmd({ ...input, ExclusiveStartKey: key }));
    yield out;
    key = out.LastEvaluatedKey;
  } while (key);
}
export function paginateScan(config, input) { return pages(config.client, ScanCommand, input); }
export function paginateQuery(config, input) { return pages(config.client, QueryCommand, input); }

export class DynamoDBClient {
  constructor() {}
  async send(cmd) { return answer(cmd.op, cmd.input); }
  destroy() {}
}
export { marshall, unmarshall, world };
