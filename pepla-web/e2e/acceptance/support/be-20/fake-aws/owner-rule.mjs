// BE-20: copied from ../../be-18/fake-aws (BE-18 lock), unchanged.
// BE-18: copied from ../../be-17.1/fake-aws (BE-17.1 lock), unchanged.
// BE-17.1: calls the real isHrOrOwner once per case:
//   node --import ./register.mjs owner-rule.mjs <lambda/shared/hr-group.mjs> <cases.json>
// Prints one line: @@BE171@@ followed by a JSON list of what each call returned (or "threw: ...").
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [file, casesFile] = process.argv.slice(2);
const { isHrOrOwner } = await import(pathToFileURL(file).href);
const out = JSON.parse(readFileSync(casesFile, 'utf8')).map(({ claims, employee }) => {
  try {
    return isHrOrOwner(claims, employee);
  } catch (e) {
    return `threw: ${String(e?.message ?? e)}`;
  }
});
process.stdout.write('\n@@BE171@@' + JSON.stringify(out) + '\n');
