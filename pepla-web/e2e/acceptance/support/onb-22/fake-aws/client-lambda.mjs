// ONB-22: a Lambda client over the real handlers. ONB22_FUNCTIONS = { "<function name>": "<handler file>" }; Invoke runs that
// handler in this process with the payload as the event (what Lambda does), answers the handler's response as the payload
// and every call is recorded with its payload. A name that is not in the map is ResourceNotFoundException.
// world.invokeFail: 'throw' (the SDK call throws, as a timeout or a throttle does), 'function-error' (the handler failed),
// 'status<nnn>' (the handler answers that status, for example status403). Only an invoke the world asks to fail fails.
import { calls, world, awsError } from './world.mjs';
import { pathToFileURL } from 'node:url';
class Command { constructor(input) { this.input = input; } }
export class InvokeCommand extends Command { get op() { return 'Invoke'; } }
const text = (p) => (typeof p === 'string' ? p : Buffer.from(p ?? new Uint8Array()).toString('utf8'));
export class LambdaClient {
  constructor(config = {}) { this.config = config; }
  async send(cmd) {
    if (!(cmd instanceof InvokeCommand)) throw new Error('fake Lambda: only Invoke is supported');
    const name = String(cmd.input.FunctionName ?? '').split(':').filter(Boolean).pop() ?? '';
    let payload;
    try { payload = JSON.parse(text(cmd.input.Payload) || 'null'); } catch { payload = text(cmd.input.Payload); }
    calls.push({ service: 'lambda', op: 'Invoke', functionName: String(cmd.input.FunctionName), invocationType: cmd.input.InvocationType ?? 'RequestResponse', payload });
    const files = JSON.parse(process.env.ONB22_FUNCTIONS ?? '{}');
    if (!files[name]) throw awsError('ResourceNotFoundException', `Function not found: ${cmd.input.FunctionName}`);
    if (world.invokeFail === 'throw') { const e = new Error('Task timed out'); e.name = 'TimeoutError'; throw e; }
    if (cmd.input.InvocationType === 'Event') return { StatusCode: 202, Payload: new Uint8Array() };
    if (world.invokeFail === 'function-error') {
      return { StatusCode: 200, FunctionError: 'Unhandled', Payload: new TextEncoder().encode(JSON.stringify({ errorType: 'Error', errorMessage: 'boom: secret detail 424556617428' })) };
    }
    const forced = /^status(\d{3})$/.exec(String(world.invokeFail ?? ''));
    if (forced) {
      return { StatusCode: 200, Payload: new TextEncoder().encode(JSON.stringify({ statusCode: Number(forced[1]), body: JSON.stringify({ error: 'forced answer' }) })) };
    }
    const { handler } = await import(pathToFileURL(files[name]).href);
    let out;
    try { out = await handler(payload, { awsRequestId: 'onb-22-invoke', functionName: name }); }
    catch (e) { return { StatusCode: 200, FunctionError: 'Unhandled', Payload: new TextEncoder().encode(JSON.stringify({ errorType: e?.name ?? 'Error', errorMessage: String(e?.message ?? e) })) }; }
    return { StatusCode: 200, Payload: new TextEncoder().encode(JSON.stringify(out ?? null)) };
  }
  destroy() {}
}
