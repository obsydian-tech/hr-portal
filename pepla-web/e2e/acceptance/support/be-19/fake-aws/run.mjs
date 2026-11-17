// BE-19: copied from ../../be-18/fake-aws (BE-18 lock), unchanged.
// BE-18: copied from ../../be-17.1/fake-aws (BE-17.1 lock), with code added only: console output is recorded
// as log lines too, so a console.error(error) leak is seen like a logger one.
// BE-17.1: copied unchanged from ../../be-17/fake-aws (BE-17 lock).
// Runs a real handler once, in a fresh process (a cold Lambda):
//   node --import ./register.mjs run.mjs <handler file> <event file>
// Prints one line of JSON: { response, error, calls, tables }. The tables are the world's tables after
// the handler ran, writes included, so the next run can start from them.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { calls, world } from './world.mjs';
// BE-17: no outbound HTTP (Batsi chat calls the Agent API with fetch). Recorded, then refused.
globalThis.fetch = async (url, init = {}) => {
  calls.push({ service: 'http', op: `${init.method ?? 'GET'} ${String(url)}` });
  throw new Error('BE-17 harness: no outbound HTTP call is allowed');
};
for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
  console[level] = (message, ...rest) => calls.push({
    service: 'log', level: `console.${level}`, message: message instanceof Error ? `${message.name}: ${message.message} ${message.stack ?? ''}` : String(message),
    extra: rest.length ? JSON.parse(JSON.stringify(rest, (_k, v) => (v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v))) : undefined,
  });
}
const [handlerFile, eventFile] = process.argv.slice(2);
const out = { calls };
try {
  const { handler } = await import(pathToFileURL(handlerFile).href);
  out.response = await handler(JSON.parse(readFileSync(eventFile, 'utf8')), { awsRequestId: 'be-17-test', functionName: 'be-17' });
} catch (e) {
  out.error = { name: e?.name, message: String(e?.message ?? e), stack: String(e?.stack ?? e) };
}
out.tables = world.tables;
process.stdout.write('\n@@BE17@@' + JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? String(v) : v instanceof Uint8Array ? `<${v.length} bytes>` : v)) + '\n');
