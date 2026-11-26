// REC-16: copied from ../../rec-06/fake-aws (code added only, below): world.postmark = { modes: [...] } answers the n-th sendEmail
// with modes[n-1] ('ok' after the list ends) the way the real postmark 4.0.5 client does (dist/client/HttpClient.js and errors/):
//   'ok'          sent: { ErrorCode: 0, Message: 'OK', MessageID: 'rec16-msg-<n>', To, SubmittedAt }
//   'answered'    Postmark answered 422 with ErrorCode 300: InvalidEmailRequestError, statusCode 422, code 300 (nothing was sent)
//   'answered401' Postmark answered 401 with ErrorCode 10: InvalidAPIKeyError, statusCode 401, code 10 (nothing was sent)
//   'timeout'     no answer: PostmarkError('timeout of 60000ms exceeded'), statusCode 0, code 0 (the email may have gone)
//   'dropped'     no answer: PostmarkError('socket hang up'), statusCode 0, code 0 (the email may have gone)
//   'noMessageId' an answer with no MessageID ({ ErrorCode: 0, To })
// Each attempt is recorded as { service: 'postmark', op: 'sendEmail', message, outcome: <mode> }.
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
export class PostmarkError extends Error {
  constructor(message, code = 0, statusCode = 0) { super(message); this.statusCode = statusCode; this.code = code; this.name = this.constructor.name; }
}
export class HttpError extends PostmarkError {}
export class InvalidAPIKeyError extends HttpError {}
export class ApiInputError extends HttpError {}
export class InvalidEmailRequestError extends ApiInputError {}
export class InternalServerError extends HttpError {}
export class UnknownError extends HttpError {}
export const Errors = { PostmarkError, HttpError, InvalidAPIKeyError, ApiInputError, InvalidEmailRequestError, InternalServerError, UnknownError };
let sent = 0;
function rec16(m) {
  const n = ++sent;
  const mode = world.postmark.modes?.[n - 1] ?? 'ok';
  calls.push({ service: 'postmark', op: 'sendEmail', message: m, outcome: mode });
  if (mode === 'answered') throw new InvalidEmailRequestError("Error parsing 'To': Illegal email address", 300, 422);
  if (mode === 'answered401') throw new InvalidAPIKeyError('The Server Token you provided in the X-Postmark-Server-Token request header was invalid.', 10, 401);
  if (mode === 'timeout') throw new PostmarkError('timeout of 60000ms exceeded');
  if (mode === 'dropped') throw new PostmarkError('socket hang up');
  if (mode === 'noMessageId') return { ErrorCode: 0, To: m.To };
  return { ErrorCode: 0, Message: 'OK', MessageID: `rec16-msg-${n}`, To: m.To, SubmittedAt: '2026-11-25T08:00:00.0000000Z' };
}
export class ServerClient {
  constructor(token) { if (!token) throw new Error('fake Postmark: no server token'); }
  async sendEmail(m) { if (world.postmark) return rec16(m); failing('sendEmail', m); calls.push({ service: 'postmark', op: 'sendEmail', message: m }); return { ErrorCode: 0, MessageID: 'onb18-fake', To: m.To }; }
  async sendEmailBatch(ms) { failing('sendEmailBatch', ms); for (const m of ms) calls.push({ service: 'postmark', op: 'sendEmailBatch', message: m }); return ms.map(() => ({ ErrorCode: 0 })); }
  async sendEmailWithTemplate(m) { failing('sendEmailWithTemplate', m); calls.push({ service: 'postmark', op: 'sendEmailWithTemplate', message: m }); return { ErrorCode: 0 }; }
  async sendEmailBatchWithTemplates(ms) { failing('sendEmailBatchWithTemplates', ms); for (const m of ms.Messages ?? ms) calls.push({ service: 'postmark', op: 'sendEmailBatchWithTemplates', message: m }); return []; }
}
export const Models = {};
export default { ServerClient, Models, Errors };
