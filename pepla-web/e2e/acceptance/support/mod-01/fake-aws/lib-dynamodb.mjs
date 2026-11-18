// The document client over the same fake tables (plain JS values in and out), writes included.
import { answer } from './client-dynamodb.mjs';
import { marshall, unmarshall } from './util-dynamodb.mjs';
class Command { constructor(input) { this.input = input; } }
export class QueryCommand extends Command { get op() { return 'Query'; } }
export class GetCommand extends Command { get op() { return 'GetItem'; } }
export class ScanCommand extends Command { get op() { return 'Scan'; } }
export class BatchGetCommand extends Command { get op() { return 'BatchGetItem'; } }
export class PutCommand extends Command { get op() { return 'PutItem'; } }
export class UpdateCommand extends Command { get op() { return 'UpdateItem'; } }
export class DeleteCommand extends Command { get op() { return 'DeleteItem'; } }
export class BatchWriteCommand extends Command { get op() { return 'BatchWriteItem'; } }
export class TransactWriteCommand extends Command { get op() { return 'TransactWriteItems'; } }
const m = (o) => (o ? marshall(o, { removeUndefinedValues: true }) : o);
function toLow(i) {
  const o = { ...i };
  if (o.ExpressionAttributeValues) o.ExpressionAttributeValues = m(o.ExpressionAttributeValues);
  if (o.Key) o.Key = m(o.Key);
  if (o.Item) o.Item = m(o.Item);
  if (o.ExclusiveStartKey) o.ExclusiveStartKey = m(o.ExclusiveStartKey);
  return o;
}
export class DynamoDBDocumentClient {
  static from() { return new DynamoDBDocumentClient(); }
  async send(cmd) {
    let i = toLow(cmd.input);
    if (cmd.op === 'BatchGetItem') i.RequestItems = Object.fromEntries(Object.entries(i.RequestItems).map(([t, r]) => [t, { ...r, Keys: (r.Keys ?? []).map(m) }]));
    if (cmd.op === 'BatchWriteItem') i.RequestItems = Object.fromEntries(Object.entries(i.RequestItems).map(([t, reqs]) => [t, reqs.map((r) => ({
      ...(r.PutRequest ? { PutRequest: { Item: m(r.PutRequest.Item) } } : {}),
      ...(r.DeleteRequest ? { DeleteRequest: { Key: m(r.DeleteRequest.Key) } } : {}),
    }))]));
    if (cmd.op === 'TransactWriteItems') i.TransactItems = i.TransactItems.map((t) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, toLow(v)])));
    const out = await answer(cmd.op, i);
    if (out.Items) out.Items = out.Items.map(unmarshall);
    if (out.Item) out.Item = unmarshall(out.Item);
    if (out.Attributes) out.Attributes = unmarshall(out.Attributes);
    if (out.LastEvaluatedKey) out.LastEvaluatedKey = unmarshall(out.LastEvaluatedKey);
    if (out.Responses) out.Responses = Object.fromEntries(Object.entries(out.Responses).map(([t, rows]) => [t, rows.map(unmarshall)]));
    return out;
  }
  destroy() {}
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
