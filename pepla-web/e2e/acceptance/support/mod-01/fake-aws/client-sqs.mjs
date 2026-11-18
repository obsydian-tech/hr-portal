// TEN-03: new. SQS that records every message sent (service 'sqs'). Nothing is delivered.
import { calls } from './world.mjs';
export class SendMessageCommand { constructor(input) { this.input = input; } }
export class SQSClient {
  constructor() { this.config = {}; }
  async send(cmd) {
    let body = cmd.input?.MessageBody;
    try { body = JSON.parse(body); } catch { /* keep text */ }
    calls.push({ service: 'sqs', op: 'SendMessage', queue: cmd.input?.QueueUrl, body });
    return { MessageId: 'ten03-message' };
  }
  destroy() {}
}
