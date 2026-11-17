// BE-20: copied from ../../be-18/fake-aws (BE-18 lock), unchanged.
// BE-18: calls one exported function of a real file once per case (the case is the list of arguments):
//   node --import ./register.mjs fn-rule.mjs <file> <export name> <cases.json>
// Prints one line: @@BE18@@ followed by a JSON list of what each call returned (or "threw: ...").
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [file, name, casesFile] = process.argv.slice(2);
const mod = await import(pathToFileURL(file).href);
const fn = mod[name];
const out = JSON.parse(readFileSync(casesFile, 'utf8')).map((args) => {
  if (typeof fn !== 'function') return `missing: ${name} is not exported`;
  try {
    return fn(...args);
  } catch (e) {
    return `threw: ${String(e?.message ?? e)}`;
  }
});
process.stdout.write('\n@@BE18@@' + JSON.stringify(out) + '\n');
