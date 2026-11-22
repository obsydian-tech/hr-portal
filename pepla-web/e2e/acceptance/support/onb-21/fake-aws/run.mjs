// ONB-21: copied from ../../ten-02/fake-aws/run.mjs (TEN-02 lock) and changed: a fixed clock (world.now), a Lambda context with
// getRemainingTimeInMillis, and `concurrent` copies of the run started at the same moment. The result line is marked @@ONB21@@.
// Runs a real handler once, in a fresh process (a cold Lambda):
//   node --import ./register.mjs run.mjs <handler file> <event file>
// Prints one line of JSON: { responses, errors, calls, tables }. The tables are the world's tables after the run.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { format } from 'node:util';
import { calls, world } from './world.mjs';
// Every console line is a recorded log line (never printed).
for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
  console[level] = (...args) => calls.push({ service: 'log', level: `console.${level}`, message: format(...args) });
}
// No outbound HTTP at all (Postmark's client is the fake). Recorded, then refused.
globalThis.fetch = async (url, init = {}) => {
  calls.push({ service: 'http', op: `${init.method ?? 'GET'} ${String(url)}` });
  throw new Error('ONB-21 harness: no outbound HTTP call is allowed');
};
// The clock: every `new Date()` and Date.now() in the run is world.now, which never moves.
if (world.now) {
  const Real = Date;
  const fixed = Real.parse(world.now);
  class Fixed extends Real {
    constructor(...a) { if (a.length === 0) super(fixed); else super(...a); }
    static now() { return fixed; }
  }
  globalThis.Date = Fixed;
}
const [handlerFile, eventFile] = process.argv.slice(2);
const out = { calls, responses: [], errors: [] };
// The time left, by how many emails the run has tried: world.remaining[n] after n tries (the last value stays).
const remaining = () => {
  const list = world.remaining;
  if (!Array.isArray(list) || list.length === 0) return 300_000;
  const tries = calls.filter((c) => c.service === 'postmark' && c.op === 'sendEmail').length;
  return list[Math.min(tries, list.length - 1)];
};
const context = () => ({ awsRequestId: 'onb-21-test', functionName: 'sendDocumentReminders', getRemainingTimeInMillis: remaining });
try {
  const { handler } = await import(pathToFileURL(handlerFile).href);
  const event = () => JSON.parse(readFileSync(eventFile, 'utf8'));
  const n = Math.max(1, world.concurrent ?? 1);
  const settled = await Promise.allSettled(Array.from({ length: n }, () => Promise.resolve().then(() => handler(event(), context()))));
  for (const s of settled) {
    if (s.status === 'fulfilled') { out.responses.push(s.value); out.errors.push(null); }
    else { out.responses.push(undefined); out.errors.push({ name: s.reason?.name, message: String(s.reason?.message ?? s.reason), stack: String(s.reason?.stack ?? s.reason) }); }
  }
} catch (e) {
  out.errors.push({ name: e?.name, message: String(e?.message ?? e), stack: String(e?.stack ?? e) });
}
out.tables = world.tables;
process.stdout.write('\n@@ONB21@@' + JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? String(v) : v instanceof Uint8Array ? `<${v.length} bytes>` : v)) + '\n');
