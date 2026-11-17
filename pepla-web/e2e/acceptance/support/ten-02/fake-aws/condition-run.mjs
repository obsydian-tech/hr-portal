// TEN-02: evaluates DynamoDB condition expressions against rows with the fake's expression reader.
//   node condition-run.mjs <cases file>; cases: [{ expr, names, values, row }]. Prints one line: @@TEN02@@[true|false, ...].
import { readFileSync } from 'node:fs';
import { compile } from './expression.mjs';
const cases = JSON.parse(readFileSync(process.argv[2], 'utf8'));
process.stdout.write('\n@@TEN02@@' + JSON.stringify(cases.map((c) => {
  try { return !!compile(c.expr, c.names ?? {}, c.values ?? {})(c.row ?? {}); } catch (e) { return String(e?.message ?? e); }
})) + '\n');
