// The document client over the same fake tables (plain JS values in and out).
import { answer } from './client-dynamodb.mjs';
import { marshall, unmarshall } from './util-dynamodb.mjs';
class Command { constructor(input) { this.input = input; } }
export class QueryCommand extends Command { get op() { return 'Query'; } }
export class GetCommand extends Command { get op() { return 'GetItem'; } }
export class ScanCommand extends Command { get op() { return 'Scan'; } }
export class BatchGetCommand extends Command { get op() { return 'BatchGetItem'; } }
export class PutCommand extends Command { get op() { return 'PutItem'; } }
export class UpdateCommand extends Command { get op() { return 'UpdateItem'; } }
export class DynamoDBDocumentClient {
  static from() { return new DynamoDBDocumentClient(); }
  async send(cmd) {
    const i = { ...cmd.input };
    if (i.ExpressionAttributeValues) i.ExpressionAttributeValues = marshall(i.ExpressionAttributeValues);
    if (i.Key) i.Key = marshall(i.Key);
    if (i.RequestItems) i.RequestItems = Object.fromEntries(Object.entries(i.RequestItems).map(([t, r]) => [t, { ...r, Keys: r.Keys.map((k) => marshall(k)) }]));
    const out = await answer(cmd.op, i);
    if (out.Items) out.Items = out.Items.map(unmarshall);
    if (out.Item) out.Item = unmarshall(out.Item);
    if (out.Responses) out.Responses = Object.fromEntries(Object.entries(out.Responses).map(([t, rows]) => [t, rows.map(unmarshall)]));
    return out;
  }
  destroy() {}
}
