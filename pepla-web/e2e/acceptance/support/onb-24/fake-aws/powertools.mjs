// Logger, Tracer and Metrics. The logger's lines and every metric are recorded.
import { calls } from './world.mjs';
const noop = () => {};
const text = (rest) => (rest.length ? JSON.stringify(rest, (_k, v) => (v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v)) : '');
const log = (level) => (message, ...rest) => calls.push({ service: 'log', level, logger: true, msg: typeof message === 'string' ? message : JSON.stringify(message), message: `${typeof message === 'string' ? message : JSON.stringify(message)} ${text(rest)}` });
const metric = (name) => calls.push({ service: 'metric', op: 'addMetric', name: String(name) });
const passthrough = new Proxy({}, {
  get: (_t, k) => {
    if (['info', 'warn', 'error', 'debug', 'critical', 'trace'].includes(k)) return log(k);
    if (k === 'addMetric') return (name) => metric(name);
    if (k === 'singleMetric') return () => passthrough;
    if (k === 'captureAWSv3Client' || k === 'captureAWSClient') return (c) => c;
    if (k === 'captureAsyncFunction') return undefined;
    if (k === 'captureLambdaHandler' || k === 'captureMethod' || k === 'injectLambdaContext' || k === 'logMetrics') return () => (target) => target;
    if (k === 'createChild') return () => passthrough;
    return noop;
  },
});
export class Logger { constructor() { return passthrough; } }
export class Tracer { constructor() { return passthrough; } }
export class Metrics { constructor() { return passthrough; } }
export const MetricUnit = new Proxy({}, { get: (_t, k) => String(k) });
export const MetricUnits = MetricUnit;
export const logMetrics = () => ({ before: noop, after: noop, onError: noop });
export const injectLambdaContext = logMetrics;
export const captureLambdaHandler = logMetrics;
