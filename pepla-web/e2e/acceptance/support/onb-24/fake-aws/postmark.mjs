// Postmark that records every message. With world.fail.postmark it fails as Postmark does for a bad address
// (its message names the address, so a sender that logs the error as is would log the address).
import { calls, world } from './world.mjs';
function failure(m) {
  const e = new Error(`Invalid 'To' address: '${m?.To ?? ''}'.`);
  e.name = 'ApiInputError';
  e.code = 300;
  e.statusCode = 422;
  return e;
}
export class ServerClient {
  constructor(token) {
    if (!token) throw new Error('fake Postmark: no server token');
    this.token = token;
  }
  async sendEmail(m) {
    calls.push({ service: 'postmark', op: 'sendEmail', message: m, token: this.token });
    if (world.fail.postmark) throw failure(m);
    return { ErrorCode: 0, Message: 'OK', MessageID: 'onb24-fake-message-id', To: m.To };
  }
  async sendEmailWithTemplate(m) {
    calls.push({ service: 'postmark', op: 'sendEmailWithTemplate', message: m, token: this.token });
    if (world.fail.postmark) throw failure(m);
    return { ErrorCode: 0, Message: 'OK', MessageID: 'onb24-fake-message-id', To: m.To };
  }
  async sendEmailBatch(ms) {
    for (const m of ms) calls.push({ service: 'postmark', op: 'sendEmailBatch', message: m, token: this.token });
    if (world.fail.postmark) throw failure(ms[0]);
    return ms.map(() => ({ ErrorCode: 0, MessageID: 'onb24-fake-message-id' }));
  }
}
export const Models = {};
export default { ServerClient, Models };
