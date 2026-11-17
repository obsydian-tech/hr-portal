// ONB-04 (from ONB-03's): runs a real handler in a fresh process (a cold Lambda):
//   node --import ./register.mjs run.mjs <module file> <event file>
// The event file holds { events: [...], concurrent: bool, call?: "<export name>" }:
//   - each event is handed to the module's `handler` (or, with `call`, to that named export, e.g. issueInvite),
//     one after the other, or all at the same moment when `concurrent` is true (two requests racing);
//   - ONB04_NOW (ISO time) fixes the clock: Date.now() and new Date() answer that moment;
//   - every console line is recorded as a log line, as Lambda would ship it to CloudWatch.
// Prints one line of JSON: { responses, errors, calls, tables, cognito }.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { calls, world } from './world.mjs';
import { asLegacyCompany, legacySettings, legacyTables } from '../../ten-02/legacy-company.mjs';
import { world as __world, KEYS as __KEYS } from './world.mjs';
// TEN-02: run as the one company there was when this card was written (see ../../ten-02/legacy-company.mjs).
legacySettings();
legacyTables(__world, __KEYS);

if (process.env.ONB04_NOW) {
  const NOW = Date.parse(process.env.ONB04_NOW);
  if (Number.isNaN(NOW)) throw new Error('ONB04_NOW is not a time');
  const Real = Date;
  class FakeDate extends Real {
    constructor(...a) { if (a.length === 0) super(NOW); else super(...a); }
    static now() { return NOW; }
  }
  globalThis.Date = FakeDate;
}

const write = process.stdout.write.bind(process.stdout);
for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
  console[level] = (...args) => calls.push({ service: 'log', level: `console.${level}`, message: args.map((a) => (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a, (_k, v) => (v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v)); } catch { return String(a); } })())).join(' ') });
}

const [moduleFile, eventFile] = process.argv.slice(2);
const spec = JSON.parse(readFileSync(eventFile, 'utf8'));
spec.events = (spec.events ?? []).map((e) => asLegacyCompany(e, spec.call));
const out = { calls, responses: [], errors: [] };
const ctx = { awsRequestId: 'onb-04-test', functionName: 'onb-04' };
let fn;
try {
  const mod = await import(pathToFileURL(moduleFile).href);
  fn = mod[spec.call ?? 'handler'];
  if (typeof fn !== 'function') throw new Error(`${moduleFile} has no export ${spec.call ?? 'handler'}`);
} catch (e) {
  out.loadError = { name: e?.name, message: String(e?.message ?? e), stack: String(e?.stack ?? e) };
}
const one = async (ev, i) => {
  try {
    out.responses[i] = await fn(ev, ctx);
  } catch (e) {
    out.errors[i] = { name: e?.name, message: String(e?.message ?? e), stack: String(e?.stack ?? e) };
  }
};
if (fn) {
  if (spec.concurrent) await Promise.all(spec.events.map(one));
  else for (let i = 0; i < spec.events.length; i++) await one(spec.events[i], i);
}
out.tables = world.tables;
out.cognito = world.cognito;
write('\n@@ONB04@@' + JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? String(v) : v instanceof Uint8Array ? `<${v.length} bytes>` : v === undefined ? null : v)) + '\n');
