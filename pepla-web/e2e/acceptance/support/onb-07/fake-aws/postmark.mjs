// Postmark that records every message instead of sending it.
import { calls } from './world.mjs';
export class ServerClient {
  constructor(token) { if (!token) throw new Error('fake Postmark: no server token'); }
  async sendEmail(m) { calls.push({ service: 'postmark', op: 'sendEmail', message: m }); return { ErrorCode: 0, MessageID: 'onb07-fake', To: m.To }; }
  async sendEmailBatch(ms) { for (const m of ms) calls.push({ service: 'postmark', op: 'sendEmailBatch', message: m }); return ms.map(() => ({ ErrorCode: 0 })); }
  async sendEmailWithTemplate(m) { calls.push({ service: 'postmark', op: 'sendEmailWithTemplate', message: m }); return { ErrorCode: 0 }; }
  async sendEmailBatchWithTemplates(ms) { for (const m of ms.Messages ?? ms) calls.push({ service: 'postmark', op: 'sendEmailBatchWithTemplates', message: m }); return []; }
}
export const Models = {};
export default { ServerClient, Models };
