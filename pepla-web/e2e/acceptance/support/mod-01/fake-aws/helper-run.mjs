// MOD-01: copied from ../../ten-03/fake-aws; a clock step and sets added (below).
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
// Prints one line: @@TEN03@@{ results, exports, calls, importError }.
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
// MOD-01: a clock the steps can move ({ clock: ms } adds ms to every reading of the time from then on), so a cache
// that lasts for some seconds can be judged in one process. Date, performance.now and process.hrtime all move.
let offset = 0;
const RealDate = Date;
class ClockDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(RealDate.now() + offset); else super(...a); }
  static now() { return RealDate.now() + offset; }
}
globalThis.Date = ClockDate;
const realPerfNow = performance.now.bind(performance);
performance.now = () => realPerfNow() + offset;
const realHr = process.hrtime;
const realHrBig = process.hrtime.bigint;
const hrNow = () => realHrBig() + BigInt(Math.round(offset)) * 1000000n;
process.hrtime = (prev) => {
  const t = hrNow();
  const sec = Number(t / 1000000000n), ns = Number(t % 1000000000n);
  if (!prev) return [sec, ns];
  let s = sec - prev[0], n = ns - prev[1];
  if (n < 0) { s -= 1; n += 1e9; }
  return [s, n];
};
process.hrtime.bigint = hrNow;
void realHr;
const [moduleFile, stepsFile] = process.argv.slice(2);
const steps = JSON.parse(readFileSync(stepsFile, 'utf8'));
const out = { results: [], exports: [], calls };
const live = [];
// MOD-01: a Set comes back as { set: [...] } (sorted), so a test can tell it from a list and read what it holds.
const plainOf = (v) => JSON.parse(JSON.stringify(v ?? null, (_k, x) => (x instanceof RegExp ? { regex: x.source, flags: x.flags } : x instanceof Set ? { set: [...x].map(String).sort() } : typeof x === 'bigint' ? String(x) : x)));
try {
  const mod = await import(pathToFileURL(moduleFile).href);
  out.exports = Object.keys(mod).sort();
  for (const s of steps) {
    // MOD-01: every step's calls follow a marker, so a test can tell which step made which call.
    calls.push({ service: 'step', n: out.results.length });
    try {
      if (s.clock !== undefined) {
        offset += Number(s.clock);
        live[out.results.length] = undefined;
        out.results.push({ ok: true, value: offset, undefined: false });
        continue;
      }
      if (s.get) {
        const v = mod[s.get];
        live[out.results.length] = v;
        // MOD-01: a function export has no JSON form; its type is the answer.
        out.results.push({ ok: v !== undefined, value: typeof v === 'function' ? null : plainOf(v), type: v instanceof RegExp ? 'regexp' : typeof v });
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
process.stdout.write('\n@@TEN03@@' + JSON.stringify(out) + '\n');
