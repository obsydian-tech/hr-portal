// TEN-02: runs a Node script (the backfill) once, in this process, under the same fake AWS hooks as run.mjs:
//   node --import ./register.mjs script-run.mjs <script file> [script args...]
// The script sees only its own arguments in process.argv. Console output still reaches stdout and stderr (the
// script's report is part of what is tested), and is recorded as log lines too. When the process ends, however it
// ends (return, process.exit or an uncaught error), the world after the run is written to the file named by
// TEN02_WORLD_OUT: { tables, cognito, calls }.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { format } from 'node:util';
import { calls, world } from './world.mjs';
for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    calls.push({ service: 'log', level: `console.${level}`, message: format(...args) });
    original(...args);
  };
}
globalThis.fetch = async (url, init = {}) => {
  calls.push({ service: 'http', op: `${init.method ?? 'GET'} ${String(url)}` });
  throw new Error('TEN-02 harness: no outbound HTTP call is allowed');
};
const [scriptFile, ...args] = process.argv.slice(2);
process.argv = [process.argv[0], scriptFile, ...args];
let saved = false;
const save = () => {
  if (saved) return;
  saved = true;
  writeFileSync(process.env.TEN02_WORLD_OUT, JSON.stringify({ tables: world.tables, cognito: world.cognito, calls }, (_k, v) => (typeof v === 'bigint' ? String(v) : v instanceof Uint8Array ? `<${v.length} bytes>` : v)));
};
process.on('exit', save);
try {
  await import(pathToFileURL(scriptFile).href);
} catch (e) {
  console.error(String(e?.stack ?? e));
  process.exitCode = 1;
}
