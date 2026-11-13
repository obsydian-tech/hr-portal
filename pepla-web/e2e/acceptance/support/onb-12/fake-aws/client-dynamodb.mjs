// A DynamoDB client that answers Query, GetItem, Scan and BatchGetItem from the fake tables (AttributeValue form).
import { world, calls, table } from './world.mjs';
import { marshall, unmarshall } from './util-dynamodb.mjs';

class Command { constructor(input) { this.input = input; } }
export class QueryCommand extends Command { get op() { return 'Query'; } }
export class GetItemCommand extends Command { get op() { return 'GetItem'; } }
export class ScanCommand extends Command { get op() { return 'Scan'; } }
export class BatchGetItemCommand extends Command { get op() { return 'BatchGetItem'; } }
// Reading a person never writes: these exist so an import works, and answer() refuses them.
export class PutItemCommand extends Command { get op() { return 'PutItem'; } }
export class UpdateItemCommand extends Command { get op() { return 'UpdateItem'; } }
export class DeleteItemCommand extends Command { get op() { return 'DeleteItem'; } }

/** Rows matching `name = :v [AND name2 = :w]` (names may be #aliases). */
function matchKeyCondition(input, rows) {
  const cond = input.KeyConditionExpression ?? '';
  const names = input.ExpressionAttributeNames ?? {};
  const values = input.ExpressionAttributeValues ?? {};
  const parts = cond.split(/\s+AND\s+/i).map((p) => p.trim()).filter(Boolean);
  return rows.filter((r) => parts.every((p) => {
    const m = /^\(?\s*(#?[\w-]+)\s*=\s*(:[\w-]+)\s*\)?$/.exec(p);
    if (!m) throw new Error(`fake DynamoDB: key condition "${p}" is not "name = :value"`);
    const attr = names[m[1]] ?? m[1];
    return JSON.stringify(r[attr]) === JSON.stringify(values[m[2]]);
  }));
}

export async function answer(op, input) {
  calls.push({ service: 'dynamodb', op, table: input.TableName ?? Object.keys(input.RequestItems ?? {}).join(','), input });
  if (op === 'Query') {
    if (input.IndexName) throw new Error(`fake DynamoDB: no index ${input.IndexName}; query the table by its key`);
    const { rows } = table(input.TableName);
    const items = matchKeyCondition(input, rows);
    return { Items: items, Count: items.length };
  }
  if (op === 'GetItem') {
    const { rows } = table(input.TableName);
    const item = rows.find((r) => Object.entries(input.Key).every(([k, v]) => JSON.stringify(r[k]) === JSON.stringify(v)));
    return item ? { Item: item } : {};
  }
  if (op === 'Scan') {
    const { rows } = table(input.TableName);
    return { Items: rows, Count: rows.length };
  }
  if (op === 'BatchGetItem') {
    const Responses = {};
    for (const [name, req] of Object.entries(input.RequestItems)) {
      const { rows } = table(name);
      Responses[name] = req.Keys.map((key) => rows.find((r) => Object.entries(key).every(([k, v]) => JSON.stringify(r[k]) === JSON.stringify(v)))).filter(Boolean);
    }
    return { Responses };
  }
  throw new Error(`fake DynamoDB: ${op} is not expected when reading a person`);
}

export class DynamoDBClient {
  constructor() {}
  async send(cmd) { return answer(cmd.op, cmd.input); }
  destroy() {}
}
export { marshall, unmarshall, world };
