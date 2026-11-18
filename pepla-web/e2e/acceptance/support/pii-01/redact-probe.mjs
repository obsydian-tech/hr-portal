// PII-01 · Loads lambda/shared/pii-redact.mjs in a fresh Node process and answers one JSON line, so a missing or broken
// file is one clear failure of one test and not a crash of the whole run.
//   node redact-probe.mjs <module file url> <job file>
// The job: { samples: string[], odd: any[], repeat: string[] }. Nothing here prints a sample's text to a console.
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const [moduleUrl, jobFile] = process.argv.slice(2);
const job = JSON.parse(readFileSync(jobFile, 'utf8'));
const out = { exports: [] };
try {
  const m = await import(moduleUrl);
  out.exports = Object.keys(m).sort();
  out.numberRunIsRegExp = m.NUMBER_RUN instanceof RegExp;
  out.samples = job.samples.map((t) => {
    const red = m.redactNumbers(t);
    return { red, has: m.hasNumberRun(t), redTwice: m.redactNumbers(red), hasAfter: m.hasNumberRun(red) };
  });
  out.odd = job.odd.map((v) => {
    try { return { red: m.redactNumbers(v), has: m.hasNumberRun(v) }; } catch (e) { return { threw: e?.name ?? 'Error' }; }
  });
  // A regex with the g flag keeps lastIndex between calls: the same text asked three times must give the same answer, and a
  // match must not leak into the next, different text.
  out.repeat = job.repeat.map((t) => [m.hasNumberRun(t), m.hasNumberRun(t), m.hasNumberRun(t), m.hasNumberRun('no numbers here'), m.hasNumberRun(t)]);
  const long = [' 1234567890'.repeat(18_000).slice(0, 200_000), '-'.repeat(100_000), ('12 '.repeat(70_000)).slice(0, 200_000), ('1' + ' '.repeat(100_000)), '9'.repeat(200_000), '1-1-1-1-1x'.repeat(20_000), ('1 '.repeat(5) + 'x ').repeat(15_000)];
  out.timings = long.map((t) => {
    const a = performance.now();
    const r = m.redactNumbers(t);
    const h = m.hasNumberRun(t);
    return { ms: performance.now() - a, length: t.length, redLength: r.length, has: h };
  });
} catch (e) {
  out.failed = { name: e?.name, message: String(e?.message ?? e).slice(0, 300) };
}
process.stdout.write('\n@@PII01PROBE@@' + JSON.stringify(out) + '\n');
