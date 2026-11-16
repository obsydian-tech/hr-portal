// Runs a real handler once, in a fresh process (a cold Lambda):
//   node --import ./register.mjs run.mjs <handler file> <event file>
// Everything the handler writes to stdout, stderr or the console is kept as a log line. fetch reaches only a
// fake Postmark API. Prints one line: @@ONB24@@{ response, error, calls }.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { calls, world } from './world.mjs';

const realWrite = process.stdout.write.bind(process.stdout);
const capture = (level) => (chunk, ...rest) => {
  calls.push({ service: 'log', level, message: String(chunk) });
  const cb = rest.find((r) => typeof r === 'function');
  if (cb) cb();
  return true;
};
process.stdout.write = capture('stdout');
process.stderr.write = capture('stderr');

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url ?? String(input);
  const host = new URL(url).hostname;
  if (host !== 'api.postmarkapp.com') {
    calls.push({ service: 'network', op: 'fetch', url });
    throw new Error(`ONB-24 harness: no network (${host})`);
  }
  let message = {};
  try { message = JSON.parse(String(init.body ?? '{}')); } catch { message = { raw: String(init.body) }; }
  const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  calls.push({ service: 'postmark', op: 'fetch ' + new URL(url).pathname, message, token: headers['x-postmark-server-token'] ?? null });
  if (world.fail.postmark) {
    const body = { ErrorCode: 300, Message: `Invalid 'To' address: '${message.To ?? ''}'.` };
    return new Response(JSON.stringify(body), { status: 422, headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify({ ErrorCode: 0, Message: 'OK', MessageID: 'onb24-fake-message-id', To: message.To }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const [handlerFile, eventFile] = process.argv.slice(2);
const out = { calls };
try {
  const { handler } = await import(pathToFileURL(handlerFile).href);
  out.response = await handler(JSON.parse(readFileSync(eventFile, 'utf8')), { awsRequestId: 'onb-24-test', functionName: 'onb-24' });
} catch (e) {
  out.error = { name: e?.name, message: String(e?.message ?? e) };
}
out.tables = world.tables;
realWrite('\n@@ONB24@@' + JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? String(v) : v instanceof Uint8Array ? Buffer.from(v).toString('utf8') : v)) + '\n');
