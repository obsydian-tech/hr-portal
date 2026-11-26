// REC-16: new. Loads a handler file once, in a fresh process, and calls nothing (a cold start that never gets an event):
//   node --import ./register.mjs load.mjs <handler file>
// Prints one line, as run.mjs does: { loaded, error, calls }. A setting the Lambda reads at load fails here (AC-7 b).
import { pathToFileURL } from 'node:url';
import { format } from 'node:util';
import { calls } from './world.mjs';
for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
  console[level] = (...args) => calls.push({ service: 'log', level: `console.${level}`, message: format(...args) });
}
globalThis.fetch = async (url, init = {}) => {
  calls.push({ service: 'http', op: `${init.method ?? 'GET'} ${String(url)}` });
  throw new Error('REC-16 harness: no outbound HTTP call is allowed');
};
const [handlerFile] = process.argv.slice(2);
const out = { calls };
try {
  const mod = await import(pathToFileURL(handlerFile).href);
  out.loaded = typeof mod.handler === 'function';
} catch (e) {
  out.error = { name: e?.name, message: String(e?.message ?? e) };
}
process.stdout.write('\n@@TEN03@@' + JSON.stringify(out) + '\n');
