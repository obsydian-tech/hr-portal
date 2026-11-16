// BE-18: runs a script's exported main(args) once against the fake AWS, in a fresh process:
//   node --import ./register.mjs script-run.mjs <script file> <args...>
// The script exports `async function main(args)`; it must not run by itself when imported. Prints one
// line: @@BE18@@ { result, error, calls, tables, out }, where `out` is what the script printed.
import { pathToFileURL } from 'node:url';
import { calls, world } from './world.mjs';
const [file, ...args] = process.argv.slice(2);
const printed = [];
const keep = (...a) => printed.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
const real = { log: console.log, error: console.error, warn: console.warn, info: console.info };
console.log = keep; console.error = keep; console.warn = keep; console.info = keep;
const out = { calls };
try {
  const mod = await import(pathToFileURL(file).href);
  if (typeof mod.main !== 'function') throw new Error(`${file} does not export main(args)`);
  out.result = (await mod.main(args)) ?? null;
} catch (e) {
  out.error = { name: e?.name, message: String(e?.message ?? e), stack: String(e?.stack ?? e) };
}
Object.assign(console, real);
out.tables = world.tables;
out.out = printed.join('\n');
process.stdout.write('\n@@BE18@@' + JSON.stringify(out) + '\n');
