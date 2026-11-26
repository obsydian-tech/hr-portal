// REC-16: copied from ../../rec-06/fake-aws unchanged.
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
// TEN-01: every console line is a recorded log line (never printed, so nothing is lost or mixed into the result).
for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
  console[level] = (...args) => calls.push({ service: 'log', level: `console.${level}`, message: format(...args) });
}
// BE-17: no outbound HTTP (Batsi chat calls the Agent API with fetch). Recorded, then refused.
globalThis.fetch = async (url, init = {}) => {
  calls.push({ service: 'http', op: `${init.method ?? 'GET'} ${String(url)}` });
  throw new Error('TEN-01 harness: no outbound HTTP call is allowed');
};
const [handlerFile, eventFile] = process.argv.slice(2);
const out = { calls };
try {
  const { handler } = await import(pathToFileURL(handlerFile).href);
  out.response = await handler(JSON.parse(readFileSync(eventFile, 'utf8')), { awsRequestId: 'ten-01-test', functionName: 'ten-01' });
} catch (e) {
  out.error = { name: e?.name, message: String(e?.message ?? e), stack: String(e?.stack ?? e) };
}
out.tables = world.tables;
// TEN-03: the pool after the run too (invites create users and set passwords).
out.cognito = world.cognito;
process.stdout.write('\n@@TEN03@@' + JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? String(v) : v instanceof Uint8Array ? `<${v.length} bytes>` : v)) + '\n');
