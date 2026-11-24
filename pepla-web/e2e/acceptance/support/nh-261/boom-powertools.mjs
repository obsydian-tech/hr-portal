// NH-261 AC-5: a logger and tracer whose ordinary calls throw the planted error. error() and critical() still record a
// log line (the error the handler hands over is recorded as name and message, as the REC-14 fake does), so the test can
// see what the handler logs about the failure.
import { calls } from '../rec-14/fake-aws/world.mjs';
const boom = () => { throw new Error('nh261-planted-boom'); };
const record = (level) => (message, ...rest) => calls.push({ service: 'log', level, message: String(message), extra: rest.length ? JSON.parse(JSON.stringify(rest, (_k, v) => (v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v))) : undefined });
const stand = new Proxy({}, {
  get: (_t, k) => {
    if (k === 'error' || k === 'critical') return record(k);
    if (k === 'captureLambdaHandler' || k === 'captureMethod' || k === 'injectLambdaContext' || k === 'logMetrics') return () => (target) => target;
    if (k === 'captureAWSv3Client' || k === 'captureAWSClient') return (c) => c;
    if (k === 'then') return undefined;
    return boom;
  },
});
export class Logger { constructor() { return stand; } }
export class Tracer { constructor() { return stand; } }
export class Metrics { constructor() { return stand; } }
export const MetricUnit = new Proxy({}, { get: (_t, k) => String(k) });
