// Runs a real handler once, in a fresh process (a cold Lambda):
//   node --import ./register.mjs run.mjs <handler file> <event file>
// Prints one line of JSON: { response, error, calls, tables }. The tables are the world's tables after
// the handler ran, writes included, so the next run can start from them. Every console line the handler writes is
// recorded as a log call; a `response` call marks the moment the handler returned, so the tests can read what
// happened before the answer left.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { calls, world } from './world.mjs';
const text = (a) => a.map((x) => (x instanceof Error ? `${x.name}: ${x.message}` : typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
for (const level of ['log', 'info', 'warn', 'error', 'debug']) console[level] = (...a) => { calls.push({ service: 'log', level, message: text(a) }); };
const [handlerFile, eventFile] = process.argv.slice(2);
const out = { calls };
try {
  const { handler } = await import(pathToFileURL(handlerFile).href);
  out.response = await handler(JSON.parse(readFileSync(eventFile, 'utf8')), { awsRequestId: 'onb-14-test', functionName: 'onb-14' });
  calls.push({ service: 'response' });
} catch (e) {
  out.error = { name: e?.name, message: String(e?.message ?? e), stack: String(e?.stack ?? e) };
}
// Anything still pending after the handler returned (a publish nobody waited for) gets its time to land before the world is read.
await new Promise((r) => setTimeout(r, 120));
out.tables = world.tables;
process.stdout.write('\n@@ONB14@@' + JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? String(v) : v instanceof Uint8Array ? `<${v.length} bytes>` : v)) + '\n');
