// TEN-03: new. Lambda client that records every Invoke (service 'lambda'). Nothing runs.
import { calls } from './world.mjs';
export class InvokeCommand { constructor(input) { this.input = input; } }
export class LambdaClient {
  constructor() { this.config = {}; }
  async send(cmd) {
    let payload = cmd.input?.Payload;
    try { payload = JSON.parse(typeof payload === 'string' ? payload : Buffer.from(payload ?? '').toString('utf8')); } catch { /* keep */ }
    calls.push({ service: 'lambda', op: 'Invoke', fn: cmd.input?.FunctionName, payload });
    return { StatusCode: 202, Payload: new Uint8Array() };
  }
  destroy() {}
}
