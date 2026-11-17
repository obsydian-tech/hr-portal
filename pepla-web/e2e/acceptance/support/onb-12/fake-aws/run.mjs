// Runs the real handler once: node --import ./register.mjs run.mjs <handler file> <event file>.
// Prints one line of JSON: { response, calls } (or { error }).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { calls } from './world.mjs';
import { asLegacyCompany, legacySettings, legacyTables } from '../../ten-02/legacy-company.mjs';
import { world as __world } from './world.mjs';
// TEN-02: run as the one company there was when this card was written (see ../../ten-02/legacy-company.mjs).
legacySettings();
legacyTables(__world, undefined);
const [handlerFile, eventFile] = process.argv.slice(2);
try {
  const { handler } = await import(pathToFileURL(handlerFile).href);
  const response = await handler(asLegacyCompany(JSON.parse(readFileSync(eventFile, 'utf8'))), { awsRequestId: 'onb-12-test', functionName: 'getEmployeeDocumentVerifications' });
  process.stdout.write('\n@@ONB12@@' + JSON.stringify({ response, calls: calls.map(({ input, ...c }) => c) }) + '\n');
} catch (e) {
  process.stdout.write('\n@@ONB12@@' + JSON.stringify({ error: String(e?.stack ?? e) }) + '\n');
}
