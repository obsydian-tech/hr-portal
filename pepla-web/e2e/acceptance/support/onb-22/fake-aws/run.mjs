// ONB-22: copied from ../../ten-02/fake-aws/run.mjs. Runs a real handler in a fresh process (a cold Lambda):
//   node --import ./register.mjs run.mjs <handler file> <event file>
// The event file holds one event, or { "parallel": [event, event] } to start several calls in the same warm container
// at once. Prints one line of JSON: { response (or responses), error, calls, tables }. Marker @@ONB22@@.
// Console output is recorded as log lines (never printed). fetch is the fake (./fetch.mjs): every call is recorded.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { format } from 'node:util';
import { calls, world } from './world.mjs';
import { installFetch } from './fetch.mjs';
for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
  console[level] = (...args) => calls.push({ service: 'log', level: `console.${level}`, message: format(...args) });
}
installFetch();
const [handlerFile, eventFile] = process.argv.slice(2);
const out = { calls };
try {
  const { handler } = await import(pathToFileURL(handlerFile).href);
  const input = JSON.parse(readFileSync(eventFile, 'utf8'));
  const ctx = { awsRequestId: 'onb-22-test', functionName: 'onb-22' };
  if (input && Array.isArray(input.parallel)) {
    const settled = await Promise.allSettled(input.parallel.map((e) => handler(e, ctx)));
    out.responses = settled.map((s) => (s.status === 'fulfilled' ? s.value : { thrown: String(s.reason?.message ?? s.reason) }));
  } else {
    out.response = await handler(input, ctx);
  }
} catch (e) {
  out.error = { name: e?.name, message: String(e?.message ?? e), stack: String(e?.stack ?? e) };
}
out.tables = world.tables;
process.stdout.write('\n@@ONB22@@' + JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? String(v) : v instanceof Uint8Array ? `<${v.length} bytes>` : v)) + '\n');
