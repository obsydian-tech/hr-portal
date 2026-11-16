// DynamoDB: PutItem only (the sender's one write, to the pepla-dev sink). Rows are stored plain per table.
import { calls, world, awsError } from './world.mjs';
import { unmarshall } from './util-dynamodb.mjs';
class Command { constructor(input) { this.input = input; } }
export class PutItemCommand extends Command { get op() { return 'PutItem'; } }
export class UpdateItemCommand extends Command { get op() { return 'UpdateItem'; } }
export class GetItemCommand extends Command { get op() { return 'GetItem'; } }
export class QueryCommand extends Command { get op() { return 'Query'; } }
export class ScanCommand extends Command { get op() { return 'Scan'; } }
export function put(table, item, via) {
  calls.push({ service: 'dynamodb', op: 'PutItem', table, item, via });
  (world.tables[table] ??= []).push(item);
  return {};
}
export class DynamoDBClient {
  constructor(config) { this.config = config; }
  async send(cmd) {
    const op = cmd.op ?? cmd.constructor.name.replace('Command', '');
    if (op === 'PutItem') return put(cmd.input.TableName, unmarshall(cmd.input.Item), 'client');
    calls.push({ service: 'dynamodb', op, table: cmd.input?.TableName });
    throw awsError('AccessDeniedException', `fake DynamoDB: the sender may only PutItem, not ${op}`);
  }
  destroy() {}
}
