// CHAT-06: copied from ../../chat-05/fake-aws (code added only): the event file may hold { "parallel": [event, event] } to start several
// calls in one warm container at once (as ONB-22's run.mjs), and the result line is marked @@CHAT06@@.
// CHAT-05: copied from ../../chat-02/fake-aws (code added only): the fake Agent API (fetch.mjs) instead of a refusal.
// TEN-01: copied from ../../be-17/fake-aws; console output is recorded as log lines too (the BE-15 settings
// check and a trigger may log with console.*), and the result line is marked @@TEN03@@.
// Runs a real handler once, in a fresh process (a cold Lambda):
//   node --import ./register.mjs run.mjs <handler file> <event file>
// Prints one line of JSON: { response, error, calls, tables }. The tables are the world's tables after
// the handler ran, writes included, so the next run can start from them.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { format } from 'node:util';
import { calls, world } from './world.mjs';
import { installFetch } from './fetch.mjs';
// TEN-01: every console line is a recorded log line (never printed, so nothing is lost or mixed into the result).
for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
  console[level] = (...args) => calls.push({ service: 'log', level: `console.${level}`, message: format(...args) });
}
// CHAT-05: the Agent API is a fake (fetch.mjs): the answers are the ones the test wrote in world.fetch, every call is recorded,
// a world with no `fetch` refuses every call, and no call leaves the process.
installFetch();
const [handlerFile, eventFile] = process.argv.slice(2);
const out = { calls };
try {
  const { handler } = await import(pathToFileURL(handlerFile).href);
  const input = JSON.parse(readFileSync(eventFile, 'utf8'));
  const ctx = { awsRequestId: 'chat-06-test', functionName: 'chat-06' };
  if (input && Array.isArray(input.parallel)) {
    const settled = await Promise.allSettled(input.parallel.map((e) => handler(e, ctx)));
    out.responses = settled.map((s) => (s.status === 'fulfilled' ? s.value : { thrown: String(s.reason?.message ?? s.reason) }));
  } else {
    out.response = await handler(input, ctx);
  }
} catch (e) {
  out.error = { name: e?.name, message: String(e?.message ?? e), stack: String(e?.stack ?? e) };
}
// CHAT-02: a write the handler started and did not wait for (the audit row is fire-and-forget) still lands in the world, as it would in a warm container.
await new Promise((resolve) => setTimeout(resolve, 25));
out.tables = world.tables;
// TEN-03: the pool after the run too (invites create users and set passwords).
out.cognito = world.cognito;
process.stdout.write('\n@@CHAT06@@' + JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? String(v) : v instanceof Uint8Array ? `<${v.length} bytes>` : v)) + '\n');
