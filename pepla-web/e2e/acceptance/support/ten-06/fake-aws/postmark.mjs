// ONB-18: copied from ../../onb-04.2/fake-aws (ONB-04.2 lock) and only added to: when world.postmarkFail is true,
// every send fails the way the Postmark client fails on a refused or unreachable server (it throws), and the
// attempt is still recorded with `failed: true`.
//
// Postmark that records every message instead of sending it.
import { calls, world } from './world.mjs';
function failing(op, m) {
  if (!world.postmarkFail) return;
  calls.push({ service: 'postmark', op, message: m, failed: true });
  const e = new Error('fake Postmark: the server is unavailable');
  e.name = 'PostmarkError';
  e.statusCode = 500;
  e.code = 500;
  throw e;
}
export class ServerClient {
  constructor(token) { if (!token) throw new Error('fake Postmark: no server token'); }
  async sendEmail(m) { failing('sendEmail', m); calls.push({ service: 'postmark', op: 'sendEmail', message: m }); return { ErrorCode: 0, MessageID: 'onb18-fake', To: m.To }; }
  async sendEmailBatch(ms) { failing('sendEmailBatch', ms); for (const m of ms) calls.push({ service: 'postmark', op: 'sendEmailBatch', message: m }); return ms.map(() => ({ ErrorCode: 0 })); }
  async sendEmailWithTemplate(m) { failing('sendEmailWithTemplate', m); calls.push({ service: 'postmark', op: 'sendEmailWithTemplate', message: m }); return { ErrorCode: 0 }; }
  async sendEmailBatchWithTemplates(ms) { failing('sendEmailBatchWithTemplates', ms); for (const m of ms.Messages ?? ms) calls.push({ service: 'postmark', op: 'sendEmailBatchWithTemplates', message: m }); return []; }
}
export const Models = {};
export default { ServerClient, Models };
