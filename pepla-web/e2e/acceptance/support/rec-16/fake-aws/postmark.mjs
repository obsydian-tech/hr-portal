// REC-16: copied from ../../rec-06/fake-aws (code added only, below): world.postmark = { modes: [...] } answers the n-th sendEmail
// with modes[n-1] ('ok' after the list ends) the way the real postmark 4.0.7 client does (dist/client/HttpClient.js and errors/):
//   'ok'          sent: { ErrorCode: 0, Message: 'OK', MessageID: 'rec16-msg-<n>', To, SubmittedAt }
//   'answered'    Postmark answered 422 with ErrorCode 300: InvalidEmailRequestError, statusCode 422, code 300 (nothing was sent)
//   'answered401' Postmark answered 401 with ErrorCode 10: InvalidAPIKeyError, statusCode 401, code 10 (nothing was sent)
//   'timeout'     no answer: PostmarkError('timeout of 60000ms exceeded'), statusCode 0, code 0 (the email may have gone)
//   'dropped'     no answer: PostmarkError('socket hang up'), statusCode 0, code 0 (the email may have gone)
//   'noMessageId' an answer with no MessageID ({ ErrorCode: 0, To })
// Each attempt is recorded as { service: 'postmark', op: 'sendEmail', message, outcome: <mode> }.
// REC-16.2 (NH-286, lock rec-16.5): code added only. More answers, each thrown as the real 4.0.7 client builds it
// (dist/client/HttpClient.js transformError and errors/ErrorHandler.js), each with code 0 and a message that names an address
// (MARKER), so a test can see whether the message ever reaches a log line or the guard row:
//   'http400' 'http408' 'http499' UnknownError 400 / 408 / 499   'http404' PostmarkError 404   'http429' RateLimitExceededError 429
//   'http500' InternalServerError 500   'http502' 'http504' UnknownError 502 / 504   'http503' ServiceUnavailablerError 503
//   'http399' 'http600' UnknownError 399 / 600 (statuses the client never sees from Postmark, kept as edges)
//   'statusString' UnknownError with statusCode '422' (a string)   'statusFraction' 422.5   'statusNaN' NaN
//   'statusMissing' a TypeError with no statusCode (what 4.0.7 throws when an error answer has an empty body)
// And `new ServerClient(token, options)` records { service: 'postmark-client', op: 'ServerClient', argCount, options } (options as
// given, JSON-copied; null when none), a service of its own so the 'postmark' call counts stay as they were.
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
// REC-16.2: the two classes 4.0.7 uses for 429 and 503 (the client's own spelling).
export class RateLimitExceededError extends HttpError {}
export class ServiceUnavailablerError extends HttpError {}
export const Errors = { PostmarkError, HttpError, InvalidAPIKeyError, ApiInputError, InvalidEmailRequestError, InternalServerError, UnknownError, RateLimitExceededError, ServiceUnavailablerError };
export const MARKER = 'proxy page for hm.a@naleko.example';
const REC162 = {
  http400: () => new UnknownError(`Bad Request ${MARKER}`, 0, 400),
  http404: () => new PostmarkError(`Not Found ${MARKER}`, 0, 404),
  http408: () => new UnknownError(`Request Timeout ${MARKER}`, 0, 408),
  http429: () => new RateLimitExceededError(`Too Many Requests ${MARKER}`, 0, 429),
  http499: () => new UnknownError(`Client Closed Request ${MARKER}`, 0, 499),
  http500: () => new InternalServerError(`Internal Server Error ${MARKER}`, 0, 500),
  http502: () => new UnknownError(`Bad Gateway ${MARKER}`, 0, 502),
  http503: () => new ServiceUnavailablerError(`Service Unavailable ${MARKER}`, 0, 503),
  http504: () => new UnknownError(`Gateway Timeout ${MARKER}`, 0, 504),
  http399: () => new UnknownError(`Status 399 ${MARKER}`, 0, 399),
  http600: () => new UnknownError(`Status 600 ${MARKER}`, 0, 600),
  statusString: () => new UnknownError(`Unprocessable ${MARKER}`, 0, '422'),
  statusFraction: () => new UnknownError(`Unprocessable ${MARKER}`, 0, 422.5),
  statusNaN: () => new UnknownError(`No status ${MARKER}`, 0, NaN),
  statusMissing: () => new TypeError(`Cannot read properties of null (reading 'ErrorCode') ${MARKER}`),
};
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
  if (Object.hasOwn(REC162, mode)) throw REC162[mode]();
  return { ErrorCode: 0, Message: 'OK', MessageID: `rec16-msg-${n}`, To: m.To, SubmittedAt: '2026-11-25T08:00:00.0000000Z' };
}
export class ServerClient {
  constructor(token, options) {
    if (!token) throw new Error('fake Postmark: no server token');
    // REC-16.2: what the Lambda asked the client for (AC-4).
    calls.push({ service: 'postmark-client', op: 'ServerClient', argCount: arguments.length, options: options === undefined ? null : JSON.parse(JSON.stringify(options)) });
  }
  async sendEmail(m) { if (world.postmark) return rec16(m); failing('sendEmail', m); calls.push({ service: 'postmark', op: 'sendEmail', message: m }); return { ErrorCode: 0, MessageID: 'onb18-fake', To: m.To }; }
  async sendEmailBatch(ms) { failing('sendEmailBatch', ms); for (const m of ms) calls.push({ service: 'postmark', op: 'sendEmailBatch', message: m }); return ms.map(() => ({ ErrorCode: 0 })); }
  async sendEmailWithTemplate(m) { failing('sendEmailWithTemplate', m); calls.push({ service: 'postmark', op: 'sendEmailWithTemplate', message: m }); return { ErrorCode: 0 }; }
  async sendEmailBatchWithTemplates(ms) { failing('sendEmailBatchWithTemplates', ms); for (const m of ms.Messages ?? ms) calls.push({ service: 'postmark', op: 'sendEmailBatchWithTemplates', message: m }); return []; }
}
export const Models = {};
export default { ServerClient, Models, Errors };
