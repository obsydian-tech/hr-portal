// ONB-21: Postmark that records every message instead of sending it (nothing here reaches the network).
// world.postmark.byAddress = { "<address>": kind } makes a send to that address fail; world.postmark.all = kind fails every send.
// A failure is recorded too (`failed: kind`). The thrown error has the shape the Postmark client gives
// (name, code = Postmark's ErrorCode, statusCode = the HTTP status), and a message that holds the address and Postmark's
// own words, so a test can see whether any of it reaches a log line.
import { calls, world } from './world.mjs';
const KINDS = {
  inactive: { name: 'InactiveRecipientsError', code: 406, statusCode: 422, say: (to) => `Found inactive addresses: ${to}. Inactive recipients are ones that have generated a hard bounce or a spam complaint.` },
  invalid: { name: 'InvalidEmailRequestError', code: 300, statusCode: 422, say: (to) => `Invalid email request: Error parsing 'To': Illegal email domain found: ${to}` },
  token: { name: 'InvalidAPIKeyError', code: 10, statusCode: 401, say: () => 'No Account or Server API tokens were supplied in the HTTP headers.' },
  server: { name: 'InternalServerError', code: 0, statusCode: 500, say: () => 'Postmark had a problem' },
  rate: { name: 'RateLimitExceededError', code: 0, statusCode: 429, say: () => 'Rate limit exceeded' },
  timeout: { name: 'FetchError', code: 0, statusCode: 0, say: (to) => `request to https://api.postmarkapp.com/email for ${to} failed, reason: ETIMEDOUT` },
  network: { name: 'FetchError', code: 0, statusCode: 0, say: (to) => `request to https://api.postmarkapp.com/email for ${to} failed, reason: getaddrinfo ENOTFOUND api.postmarkapp.com` },
};
function failing(m) {
  const pm = world.postmark ?? {};
  const to = String(m?.To ?? '').toLowerCase();
  const kind = pm.byAddress?.[to] ?? pm.all;
  if (!kind) return;
  const k = KINDS[kind];
  if (!k) throw new Error(`fake Postmark: no failure kind ${kind}`);
  calls.push({ service: 'postmark', op: 'sendEmail', message: m, failed: kind });
  const e = new Error(k.say(m.To));
  e.name = k.name;
  e.code = k.code;
  e.statusCode = k.statusCode;
  throw e;
}
const refuse = (op) => { throw new Error(`fake Postmark: a reminder is one sendEmail per person, ${op} is not used`); };
export class ServerClient {
  constructor(token) {
    if (!token) throw new Error('fake Postmark: no server token');
    calls.push({ service: 'postmark', op: 'client', tokenGiven: true });
  }
  async sendEmail(m) { failing(m); calls.push({ service: 'postmark', op: 'sendEmail', message: m }); return { ErrorCode: 0, MessageID: 'onb21-fake', To: m.To }; }
  async sendEmailBatch() { return refuse('sendEmailBatch'); }
  async sendEmailWithTemplate() { return refuse('sendEmailWithTemplate'); }
  async sendEmailBatchWithTemplates() { return refuse('sendEmailBatchWithTemplates'); }
}
export const Models = {};
export default { ServerClient, Models };
