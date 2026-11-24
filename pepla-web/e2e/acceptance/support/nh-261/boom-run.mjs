// NH-261 AC-5: runs the real handler once, in a fresh process, with the planted error thrown from inside.
//   NH261_BOOM=event       the event's every property read throws (the handler gets a Proxy, not the JSON event)
//   NH261_BOOM=powertools  every Powertools logger or tracer call except error() throws; console.log/info/warn throw too
// Otherwise the same as ../rec-14/fake-aws/run.mjs: console lines and logger lines are recorded, outbound HTTP is
// refused, and one @@TEN03@@ line holds { response, error, calls, tables }.
import { pathToFileURL } from 'node:url';
import { format } from 'node:util';
import { calls, world } from '../rec-14/fake-aws/world.mjs';
const MODE = process.env.NH261_BOOM;
const boom = () => { throw new Error('nh261-planted-boom'); };
for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
  const throws = MODE === 'powertools' && ['log', 'info', 'warn', 'debug'].includes(level);
  console[level] = throws ? boom : (...args) => calls.push({ service: 'log', level: `console.${level}`, message: format(...args) });
}
globalThis.fetch = async (url, init = {}) => {
  calls.push({ service: 'http', op: `${init.method ?? 'GET'} ${String(url)}` });
  throw new Error('NH-261 harness: no outbound HTTP call is allowed');
};
const [handlerFile] = process.argv.slice(2);
const event = MODE === 'event'
  ? new Proxy({}, { get: (_t, k) => (k === 'then' ? undefined : boom()), has: boom, ownKeys: boom, getOwnPropertyDescriptor: boom })
  : { version: '2.0', routeKey: 'GET /v1/employees/lookup', rawPath: '/v1/employees/lookup', rawQueryString: 'employeeId=EMP-0000001', headers: {}, queryStringParameters: { employeeId: 'EMP-0000001' }, requestContext: { http: { method: 'GET', path: '/v1/employees/lookup', sourceIp: '198.51.100.61' }, routeKey: 'GET /v1/employees/lookup' }, isBase64Encoded: false };
const out = { calls };
try {
  const { handler } = await import(pathToFileURL(handlerFile).href);
  out.response = await handler(event, { awsRequestId: 'nh-261-test', functionName: 'nh-261' });
} catch (e) {
  out.error = { name: e?.name, message: String(e?.message ?? e), stack: String(e?.stack ?? e) };
}
out.tables = world.tables;
process.stdout.write('\n@@TEN03@@' + JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? String(v) : v)) + '\n');
