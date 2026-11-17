// Runs a real handler once, in a fresh process (a cold Lambda):
//   node --import ./register.mjs run.mjs <handler file> <event file>
// Prints one line of JSON: { response, error, calls, tables }. The tables are the world's tables after
// the handler ran, writes included, so the next run can start from them.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { calls, world } from './world.mjs';
import { asLegacyCompany, legacySettings, legacyTables } from '../../ten-02/legacy-company.mjs';
import { world as __world, KEYS as __KEYS } from './world.mjs';
// TEN-02: run as the one company there was when this card was written (see ../../ten-02/legacy-company.mjs).
legacySettings();
legacyTables(__world, __KEYS);
const [handlerFile, eventFile] = process.argv.slice(2);
const out = { calls };
try {
  const { handler } = await import(pathToFileURL(handlerFile).href);
  out.response = await handler(asLegacyCompany(JSON.parse(readFileSync(eventFile, 'utf8'))), { awsRequestId: 'onb-03-test', functionName: "onb-03" });
} catch (e) {
  out.error = { name: e?.name, message: String(e?.message ?? e), stack: String(e?.stack ?? e) };
}
out.tables = world.tables;
out.cognito = world.cognito;
process.stdout.write('\n@@ONB03@@' + JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? String(v) : v instanceof Uint8Array ? `<${v.length} bytes>` : v)) + '\n');
