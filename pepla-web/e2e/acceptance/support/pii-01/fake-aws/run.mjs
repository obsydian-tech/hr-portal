// Runs a real handler once, in a fresh process (a cold Lambda):
//   node --import ./register.mjs run.mjs <handler file> <event file>
// Prints one line of JSON: { response, error, calls, tables, spentTokens }. The tables are the world's tables after
// the handler ran, writes included, so the next run can start from them.
// PII-01 (changed from ONB-09's copy): there is no "legacy company" wrapper. The test gives each event its own company
// claim and sets LEGACY_TENANT_ID itself, because the flow entry has no caller and reads the company from the row.
// Every console line is a recorded log line, and every outside HTTP call is recorded and refused.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { format } from 'node:util';
import { calls, world } from './world.mjs';
for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
  console[level] = (...args) => calls.push({ service: 'log', level: `console.${level}`, message: format(...args) });
}
globalThis.fetch = async (url, init = {}) => {
  calls.push({ service: 'http', op: `${init.method ?? 'GET'} ${String(url)}` });
  throw new Error('PII-01 harness: no outbound HTTP call is allowed');
};
const [handlerFile, eventFile] = process.argv.slice(2);
const out = { calls };
try {
  const { handler } = await import(pathToFileURL(handlerFile).href);
  out.response = await handler(JSON.parse(readFileSync(eventFile, 'utf8')), { awsRequestId: 'pii-01-test', functionName: 'pii-01' });
} catch (e) {
  out.error = { name: e?.name, message: String(e?.message ?? e), stack: String(e?.stack ?? e) };
}
out.tables = world.tables;
out.spentTokens = world.spentTokens ?? [];
process.stdout.write('\n@@PII01@@' + JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? String(v) : v instanceof Uint8Array ? `<${v.length} bytes>` : v)) + '\n');
