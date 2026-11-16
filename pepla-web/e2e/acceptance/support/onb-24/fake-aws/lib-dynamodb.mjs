// The document client over the fake DynamoDB: PutCommand only.
import { calls, awsError } from './world.mjs';
import { put } from './client-dynamodb.mjs';
class Command { constructor(input) { this.input = input; } }
export class PutCommand extends Command { get op() { return 'PutItem'; } }
export class UpdateCommand extends Command { get op() { return 'UpdateItem'; } }
export class GetCommand extends Command { get op() { return 'GetItem'; } }
export class DynamoDBDocumentClient {
  static from() { return new DynamoDBDocumentClient(); }
  async send(cmd) {
    if (cmd instanceof PutCommand) return put(cmd.input.TableName, structuredClone(cmd.input.Item), 'document');
    calls.push({ service: 'dynamodb', op: cmd.op, table: cmd.input?.TableName });
    throw awsError('AccessDeniedException', `fake DynamoDB: the sender may only PutItem, not ${cmd.op}`);
  }
  destroy() {}
}
