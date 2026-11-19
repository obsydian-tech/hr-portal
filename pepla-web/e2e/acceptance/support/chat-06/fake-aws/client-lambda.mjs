// CHAT-06: copied from ../../onb-22/fake-aws/client-lambda.mjs (code added only). A Lambda client over the real handlers:
// CHAT06_FUNCTIONS = { "<function name>": "<handler file>" }. Invoke runs that handler in this process with the payload as the event (what
// Lambda does, against the same fake tables, Cognito and Postmark), answers the handler's response as the payload, and every call is
// recorded with its payload. A name that is not in the map is ResourceNotFoundException.
// world.invokeFail:
//   'throw'                   every invoke throws (a timeout or a throttle) and the handler never runs;
//   'throw-after-run'         the FIRST invoke runs the handler to the end and then throws (the reply was lost); later invokes run normally;
//   'throw-after-run-always'  the first invoke runs the handler and throws; every later invoke throws without running (nothing settles);
//   'function-error'          the handler is not run and Lambda answers FunctionError, with words that must never reach an answer;
//   'status<nnn>'             the handler is not run and the answer is that status (for example status403).
import { calls, world, awsError } from './world.mjs';
import { pathToFileURL } from 'node:url';
class Command { constructor(input) { this.input = input; } }
export class InvokeCommand extends Command { get op() { return 'Invoke'; } }
const text = (p) => (typeof p === 'string' ? p : Buffer.from(p ?? new Uint8Array()).toString('utf8'));
const timeout = () => { const e = new Error('Task timed out after 30.00 seconds: secret detail 999988887777'); e.name = 'TimeoutError'; return e; };
let n = 0;
export class LambdaClient {
  constructor(config = {}) { this.config = config; }
  async send(cmd) {
    if (!(cmd instanceof InvokeCommand)) throw new Error('fake Lambda: only Invoke is supported');
    n += 1;
    const name = String(cmd.input.FunctionName ?? '').split(':').filter(Boolean).pop() ?? '';
    let payload;
    try { payload = JSON.parse(text(cmd.input.Payload) || 'null'); } catch { payload = text(cmd.input.Payload); }
    calls.push({ service: 'lambda', op: 'Invoke', functionName: String(cmd.input.FunctionName), invocationType: cmd.input.InvocationType ?? 'RequestResponse', payload });
    const files = JSON.parse(process.env.CHAT06_FUNCTIONS ?? '{}');
    if (!files[name]) throw awsError('ResourceNotFoundException', `Function not found: ${cmd.input.FunctionName}`);
    const mode = String(world.invokeFail ?? '');
    if (mode === 'throw') throw timeout();
    if (mode === 'throw-after-run-always' && n > 1) throw timeout();
    if (cmd.input.InvocationType === 'Event') return { StatusCode: 202, Payload: new Uint8Array() };
    if (mode === 'function-error') {
      return { StatusCode: 200, FunctionError: 'Unhandled', Payload: new TextEncoder().encode(JSON.stringify({ errorType: 'Error', errorMessage: 'boom: secret detail 999988887777' })) };
    }
    const forced = /^status(\d{3})$/.exec(mode);
    if (forced) return { StatusCode: 200, Payload: new TextEncoder().encode(JSON.stringify({ statusCode: Number(forced[1]), body: JSON.stringify({ error: 'forced answer' }) })) };
    const { handler } = await import(pathToFileURL(files[name]).href);
    let out;
    try { out = await handler(payload, { awsRequestId: `chat-06-invoke-${n}`, functionName: name }); }
    catch (e) { return { StatusCode: 200, FunctionError: 'Unhandled', Payload: new TextEncoder().encode(JSON.stringify({ errorType: e?.name ?? 'Error', errorMessage: String(e?.message ?? e) })) }; }
    if ((mode === 'throw-after-run' || mode === 'throw-after-run-always') && n === 1) throw timeout();
    return { StatusCode: 200, Payload: new TextEncoder().encode(JSON.stringify(out ?? null)) };
  }
  destroy() {}
}
