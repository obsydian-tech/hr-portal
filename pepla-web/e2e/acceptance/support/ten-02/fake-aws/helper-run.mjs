// TEN-01: calls the exports of a shared module (lambda/shared/tenant.mjs) in a fresh process, under the same fake
// AWS hooks as run.mjs, so any AWS import or call is recorded:
//   node --import ./register.mjs helper-run.mjs <module file> <steps file>
// Steps: [{ fn: 'ownsRow', args: [...] }, { get: 'TENANT_ID_PATTERN' }]. Each answer is { ok, value, args } or
// { ok: false, error: { name, ctor, message } }. A RegExp comes back as { regex: source, flags }. `args` is the
// arguments as they are after the call (to see whether a function changed what it was given).
// An argument { $step: n } is the live value step n returned. A step with `rows` (AttributeValue rows) also
// applies the returned { FilterExpression, ExpressionAttributeNames, ExpressionAttributeValues } to them with the
// fake's expression reader, and answers `matched`: the indexes of the rows it keeps. Plain values (the document
// client's form) are read as DynamoDB would after marshalling.
// Prints one line: @@TEN02@@{ results, exports, calls, importError }.
import { readFileSync } from 'node:fs';
import { format } from 'node:util';
import { pathToFileURL } from 'node:url';
import { calls } from './world.mjs';
import { compile } from './expression.mjs';
import { convertToAttr } from './util-dynamodb.mjs';
for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
  console[level] = (...args) => calls.push({ service: 'log', level: `console.${level}`, message: format(...args) });
}
globalThis.fetch = async (url, init = {}) => {
  calls.push({ service: 'http', op: `${init.method ?? 'GET'} ${String(url)}` });
  throw new Error('TEN-01 harness: no outbound HTTP call is allowed');
};
const [moduleFile, stepsFile] = process.argv.slice(2);
const steps = JSON.parse(readFileSync(stepsFile, 'utf8'));
const out = { results: [], exports: [], calls };
const live = [];
const plainOf = (v) => JSON.parse(JSON.stringify(v ?? null, (_k, x) => (x instanceof RegExp ? { regex: x.source, flags: x.flags } : typeof x === 'bigint' ? String(x) : x)));
try {
  const mod = await import(pathToFileURL(moduleFile).href);
  out.exports = Object.keys(mod).sort();
  for (const s of steps) {
    try {
      if (s.get) {
        const v = mod[s.get];
        live[out.results.length] = v;
        out.results.push({ ok: v !== undefined, value: plainOf(v), type: v instanceof RegExp ? 'regexp' : typeof v });
        continue;
      }
      if (typeof mod[s.fn] !== 'function') throw Object.assign(new Error(`${s.fn} is not exported as a function`), { name: 'NotExported' });
      const args = (s.args ?? []).map((a) => (a && typeof a === 'object' && '$step' in a ? live[a.$step] : a));
      const v = await mod[s.fn](...args);
      live[out.results.length] = v;
      const res = { ok: true, value: plainOf(v), undefined: v === undefined, args: plainOf(args) };
      if (s.rows) {
        const values = Object.fromEntries(Object.entries(v?.ExpressionAttributeValues ?? {}).map(([k, x]) => [k, x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length === 1 && /^(S|N|BOOL|NULL|M|L|SS|NS)$/.test(Object.keys(x)[0]) ? x : convertToAttr(x)]));
        const f = compile(v?.FilterExpression, v?.ExpressionAttributeNames ?? {}, values);
        res.matched = s.rows.map((r, i) => (f(r) ? i : -1)).filter((i) => i >= 0);
      }
      out.results.push(res);
    } catch (e) {
      live[out.results.length] = undefined;
      out.results.push({ ok: false, error: { name: String(e?.name ?? ''), ctor: String(e?.constructor?.name ?? ''), message: String(e?.message ?? e) } });
    }
  }
} catch (e) {
  out.importError = { name: String(e?.name ?? ''), message: String(e?.message ?? e) };
}
process.stdout.write('\n@@TEN02@@' + JSON.stringify(out) + '\n');
