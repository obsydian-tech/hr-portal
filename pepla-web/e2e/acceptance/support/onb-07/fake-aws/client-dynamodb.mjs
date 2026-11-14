// A DynamoDB client over the fake tables (AttributeValue form). Reads as ../../onb-13/fake-aws does
// (Scan in pages of at most world.pageSize rows, filter after the page is read). Writes change the
// tables: PutItem, UpdateItem, DeleteItem, BatchWriteItem and TransactWriteItems, each honouring its
// ConditionExpression (a failed condition throws ConditionalCheckFailedException, as DynamoDB does).
import { world, calls, table, awsError, KEYS } from './world.mjs';
import { compile } from './expression.mjs';
import { applyUpdate } from './update.mjs';
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
export class ConditionalCheckFailedException extends Error { constructor(o = {}) { super(o.message ?? 'The conditional request failed'); this.name = 'ConditionalCheckFailedException'; } }
export class TransactionCanceledException extends Error { constructor(o = {}) { super(o.message ?? 'Transaction cancelled'); this.name = 'TransactionCanceledException'; } }

const keyOf = (row, keys) => Object.fromEntries(keys.map((k) => [k, row[k]]));
const sameKey = (row, key) => Object.entries(key).every(([k, v]) => JSON.stringify(row[k]) === JSON.stringify(v));

function filtered(input, rows) {
  if (!input.FilterExpression) return rows;
  const f = compile(input.FilterExpression, input.ExpressionAttributeNames, input.ExpressionAttributeValues);
  return rows.filter(f);
}

function checkKey(name, key) {
  const want = KEYS[name];
  const got = Object.keys(key ?? {}).sort();
  if (JSON.stringify(got) !== JSON.stringify([...want].sort())) throw awsError('ValidationException', `The provided key element does not match the schema of ${name}`);
}

function condition(input, current) {
  if (!input.ConditionExpression) return true;
  return compile(input.ConditionExpression, input.ExpressionAttributeNames, input.ExpressionAttributeValues)(current ?? {});
}

/** One write, applied to the tables (or only checked, when `dry`). Returns the old item. */
function write(kind, input, dry = false) {
  const { rows, keys } = table(input.TableName);
  if (kind === 'Put') {
    const key = keyOf(input.Item, keys);
    checkKey(input.TableName, key);
    const at = rows.findIndex((r) => sameKey(r, key));
    const old = at >= 0 ? rows[at] : undefined;
    if (!condition(input, old)) throw new ConditionalCheckFailedException();
    if (!dry) { if (at >= 0) rows[at] = input.Item; else rows.push(input.Item); }
    return old;
  }
  checkKey(input.TableName, input.Key);
  const at = rows.findIndex((r) => sameKey(r, input.Key));
  const old = at >= 0 ? rows[at] : undefined;
  if (!condition(input, old)) throw new ConditionalCheckFailedException();
  if (dry || kind === 'ConditionCheck') return old;
  if (kind === 'Delete') { if (at >= 0) rows.splice(at, 1); return old; }
  const next = applyUpdate(old ?? { ...input.Key }, input.UpdateExpression, input.ExpressionAttributeNames, input.ExpressionAttributeValues);
  Object.assign(next, input.Key);
  if (at >= 0) rows[at] = next; else rows.push(next);
  return old;
}

export async function answer(op, input) {
  const tableName = input.TableName ?? Object.keys(input.RequestItems ?? {}).join(',');
  calls.push({ service: 'dynamodb', op, table: tableName || undefined, input });
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
  if (op === 'PutItem' || op === 'UpdateItem' || op === 'DeleteItem') {
    const kind = { PutItem: 'Put', UpdateItem: 'Update', DeleteItem: 'Delete' }[op];
    const old = write(kind, input);
    const out = {};
    if (input.ReturnValues === 'ALL_OLD' && old) out.Attributes = old;
    if (input.ReturnValues === 'ALL_NEW' && kind === 'Update') out.Attributes = table(input.TableName).rows.find((r) => sameKey(r, input.Key));
    return out;
  }
  if (op === 'BatchWriteItem') {
    for (const [TableName, reqs] of Object.entries(input.RequestItems)) {
      for (const r of reqs) {
        if (r.PutRequest) write('Put', { TableName, Item: r.PutRequest.Item });
        if (r.DeleteRequest) write('Delete', { TableName, Key: r.DeleteRequest.Key });
      }
    }
    return { UnprocessedItems: {} };
  }
  if (op === 'TransactWriteItems') {
    const steps = input.TransactItems.map((t) => {
      const kind = Object.keys(t)[0];
      return [kind, t[kind]];
    });
    try {
      for (const [kind, i] of steps) write(kind, i, true);
    } catch (e) {
      if (e.name === 'ConditionalCheckFailedException') throw new TransactionCanceledException({ message: 'Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed]' });
      throw e;
    }
    for (const [kind, i] of steps) write(kind, i);
    return {};
  }
  throw new Error(`fake DynamoDB: ${op} is not supported`);
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
  constructor() { this.config = {}; this.middlewareStack = { add() {}, use() {} }; }
  async send(cmd) { return answer(cmd.op, cmd.input); }
  destroy() {}
}
export { marshall, unmarshall, world };
