// Runs the real handler once, in a fresh process (a cold Lambda):
//   node --import ./register.mjs run.mjs <handler file> <event file>
// Prints one line of JSON: { response, error, calls }.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { calls } from './world.mjs';
// No outbound HTTP. Recorded, then refused.
globalThis.fetch = async (url, init = {}) => {
  calls.push({ service: 'http', op: `${init.method ?? 'GET'} ${String(url)}` });
  throw new Error('TEN-07 harness: no outbound HTTP call is allowed');
};
const [handlerFile, eventFile] = process.argv.slice(2);
const out = { calls };
try {
  const { handler } = await import(pathToFileURL(handlerFile).href);
  out.response = await handler(JSON.parse(readFileSync(eventFile, 'utf8')), { awsRequestId: 'ten-07-test', functionName: 'configRegionCheck' });
} catch (e) {
  out.error = { name: e?.name, message: String(e?.message ?? e), stack: String(e?.stack ?? e) };
}
process.stdout.write('\n@@TEN07@@' + JSON.stringify(out) + '\n');
