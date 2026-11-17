// Runs a real handler once: node --import ./register.mjs run.mjs <handler file> <event file>.
// Prints one line of JSON: { response, calls } (or { error }).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { calls } from './world.mjs';
import { asLegacyCompany, legacySettings, legacyTables } from '../../ten-02/legacy-company.mjs';
import { world as __world, KEYS as __KEYS } from './world.mjs';
// TEN-02: run as the one company there was when this card was written (see ../../ten-02/legacy-company.mjs).
legacySettings();
legacyTables(__world, __KEYS);
const [handlerFile, eventFile] = process.argv.slice(2);
try {
  const { handler } = await import(pathToFileURL(handlerFile).href);
  const response = await handler(asLegacyCompany(JSON.parse(readFileSync(eventFile, 'utf8'))), { awsRequestId: 'onb-13-test', functionName: 'onb-13' });
  process.stdout.write('\n@@ONB13@@' + JSON.stringify({ response, calls }) + '\n');
} catch (e) {
  process.stdout.write('\n@@ONB13@@' + JSON.stringify({ error: String(e?.stack ?? e) }) + '\n');
}
