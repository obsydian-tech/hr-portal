// Fake paid-AI clients (Textract, Bedrock). Nothing here reaches a network.
//
// Every ATTEMPT to send is recorded, even one that lambda/shared/ai-guard.mjs then refuses: guardAi()
// replaces client.send, so `send` is an accessor here and whatever function is stored behind it is
// wrapped in a recorder. `reached` says whether the request got past the guard to the (fake) service.
import { calls } from './world.mjs';

let depth = 0;
export class FakeAiClient {
  constructor(service, answer) {
    this.config = {};
    this._service = service;
    this._inner = async (cmd) => {
      const c = calls[this._last];
      if (c) c.reached = true;
      return answer(cmd);
    };
  }
  get send() {
    const inner = this._inner;
    return async (cmd, ...rest) => {
      const outer = depth === 0;
      if (outer) {
        calls.push({ service: this._service, op: cmd?.constructor?.name?.replace(/Command$/, '') ?? 'unknown', reached: false, input: safe(cmd?.input) });
        this._last = calls.length - 1;
      }
      depth++;
      try {
        return await inner(cmd, ...rest);
      } finally {
        depth--;
      }
    };
  }
  set send(fn) { this._inner = fn; }
  destroy() {}
}

/** The request as text (bytes decoded), so a test can read the prompt. */
function safe(input) {
  if (!input) return null;
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (v instanceof Uint8Array || Buffer.isBuffer(v)) out[k] = k === 'Bytes' ? `<${v.length} bytes>` : Buffer.from(v).toString('utf8');
    else if (k === 'Document' && v?.Bytes) out[k] = { Bytes: `<${v.Bytes.length} bytes>` };
    else out[k] = v;
  }
  return out;
}
