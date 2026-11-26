// INT-04 (NH-277): test support only, no application code. A preload (NODE_OPTIONS --import) for one Lambda run against REC-14's fake
// AWS (support/rec-14/fake-aws, unchanged), loaded after REC-15's clock and INT-01's race.mjs (both unchanged). It changes nothing
// unless one of these is set:
//
//   INT04_POSTMARK = 'ok' | '400' | '422' | '500' | '503' | 'timeout' | 'dropped' | 'nomessageid'
//       How the fake Postmark answers sendEmail. Errors are thrown in the shape the installed postmark client (4.x) throws them: an Error
//       whose name is the client's class name, with `statusCode` (the HTTP status; 0 when there was no answer) and `code` (Postmark's
//       ErrorCode). 'ok' answers with a MessageID; 'nomessageid' answers with no MessageID. Every call is recorded by the fake as today
//       (failed ones too, with failed: true). INT04_POSTMARK_SEQ (a comma list) gives one answer per call, then the last again.
//   INT04_SLOW_MS = <ms>
//       Every AdminGetUser answers after that many milliseconds of real time. The most calls in flight at once is recorded as
//       { service: 'int04', op: 'pool-in-flight', max }, written just before the result is printed.
//   (always) every SQS SendMessage is also recorded with its whole input: { service: 'int04', op: 'SendMessage', input }.
const here = new URL('../rec-14/fake-aws/', import.meta.url);
const { calls } = await import(new URL('world.mjs', here).href);
const pm = await import(new URL('postmark.mjs', here).href);
const sqs = await import(new URL('client-sqs.mjs', here).href);
const cognito = await import(new URL('client-cognito.mjs', here).href);

const seq = (process.env.INT04_POSTMARK_SEQ ?? process.env.INT04_POSTMARK ?? '').split(',').filter(Boolean);
let n = 0;
const fail = (name, message, statusCode, code) => { const e = new Error(message); e.name = name; e.statusCode = statusCode; e.code = code; return e; };
if (seq.length) {
  pm.ServerClient.prototype.sendEmail = async function sendEmail(m) {
    const mode = seq[Math.min(n++, seq.length - 1)];
    const failed = (e) => { calls.push({ service: 'postmark', op: 'sendEmail', message: m, failed: true, answer: mode }); throw e; };
    if (mode === '400') failed(fail('UnknownError', 'zz-int04 Bad request', 400, 0));
    if (mode === '422') failed(fail('InvalidEmailRequestError', 'zz-int04 Invalid email request', 422, 300));
    if (mode === '500') failed(fail('InternalServerError', 'zz-int04 Internal server error', 500, 0));
    if (mode === '503') failed(fail('ServiceUnavailablerError', 'zz-int04 Service unavailable', 503, 0));
    if (mode === 'timeout') failed(fail('PostmarkError', 'timeout of 60000ms exceeded', 0, 0));
    if (mode === 'dropped') failed(fail('PostmarkError', 'socket hang up', 0, 0));
    calls.push({ service: 'postmark', op: 'sendEmail', message: m, answer: mode });
    if (mode === 'nomessageid') return { ErrorCode: 0, Message: 'OK', To: m.To };
    return { ErrorCode: 0, Message: 'OK', MessageID: `int04-msg-${n}`, To: m.To, SubmittedAt: '2026-11-26T10:00:00Z' };
  };
}

const originalSqs = sqs.SQSClient.prototype.send;
sqs.SQSClient.prototype.send = async function send(cmd) {
  calls.push({ service: 'int04', op: 'SendMessage', input: structuredClone(cmd.input) });
  return originalSqs.call(this, cmd);
};

const slow = Number(process.env.INT04_SLOW_MS ?? 0);
if (slow > 0) {
  let inFlight = 0;
  let max = 0;
  const originalPool = cognito.CognitoIdentityProviderClient.prototype.send;
  cognito.CognitoIdentityProviderClient.prototype.send = async function send(cmd) {
    if (cmd?.constructor?.name !== 'AdminGetUserCommand') return originalPool.call(this, cmd);
    inFlight++;
    max = Math.max(max, inFlight);
    try {
      await new Promise((r) => setTimeout(r, slow));
      return await originalPool.call(this, cmd);
    } finally { inFlight--; }
  };
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...rest) => {
    if (typeof chunk === 'string' && chunk.includes('@@TEN03@@')) {
      const i = chunk.indexOf('@@TEN03@@') + 9;
      const out = JSON.parse(chunk.slice(i).trim());
      out.calls.push({ service: 'int04', op: 'pool-in-flight', max });
      return write(`${chunk.slice(0, i)}${JSON.stringify(out)}\n`, ...rest);
    }
    return write(chunk, ...rest);
  };
}
