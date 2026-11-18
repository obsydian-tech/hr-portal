// Logger, Tracer and Metrics that do nothing, except that the logger's lines are recorded.
import { calls } from './world.mjs';
const noop = () => {};
const log = (level) => (message, ...rest) => calls.push({ service: 'log', level, message: String(message), extra: rest.length ? JSON.parse(JSON.stringify(rest, (_k, v) => (v instanceof Error ? { name: v.name, message: v.message } : v))) : undefined });
const passthrough = new Proxy({}, {
  get: (_t, k) => {
    if (['info', 'warn', 'error', 'debug', 'critical'].includes(k)) return log(k);
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
