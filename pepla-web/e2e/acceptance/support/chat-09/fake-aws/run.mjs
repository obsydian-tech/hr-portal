// CHAT-09: copied from ../../chat-05/fake-aws/run.mjs (CHAT-05 lock) with two things added: a fixed clock (world.now, as ONB-21's
// run.mjs has it) and this folder's fetch.mjs (a rule can make a call fail as a network failure). The world, the AWS fakes and the
// model script are CHAT-05's own files (../../chat-05/fake-aws), so this run shares their one world.
// Runs a real handler once, in a fresh process (a cold Lambda):
//   node --require ../../chat-05/fake-aws/cjs-hook.cjs --import ../../chat-05/fake-aws/register.mjs run.mjs <handler file> <event file>
// Prints one line: @@TEN03@@ + JSON { response, error, calls, tables }.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { format } from 'node:util';
import { calls, world } from '../../chat-05/fake-aws/world.mjs';
import { installFetch } from './fetch.mjs';
for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
  console[level] = (...args) => calls.push({ service: 'log', level: `console.${level}`, message: format(...args) });
}
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
installFetch();
const [handlerFile, eventFile] = process.argv.slice(2);
const out = { calls };
try {
  const { handler } = await import(pathToFileURL(handlerFile).href);
  out.response = await handler(JSON.parse(readFileSync(eventFile, 'utf8')), { awsRequestId: 'chat-09-test', functionName: 'chat-09' });
} catch (e) {
  out.error = { name: e?.name, message: String(e?.message ?? e), stack: String(e?.stack ?? e) };
}
// A write the handler started and did not wait for (the audit row is fire-and-forget) still lands in the world.
await new Promise((resolve) => setTimeout(resolve, 25));
out.tables = world.tables;
process.stdout.write('\n@@TEN03@@' + JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? String(v) : v instanceof Uint8Array ? `<${v.length} bytes>` : v)) + '\n');
