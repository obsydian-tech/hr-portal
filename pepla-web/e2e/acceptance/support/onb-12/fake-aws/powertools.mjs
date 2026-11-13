// Logger, Tracer and Metrics that do nothing.
const noop = () => {};
const passthrough = new Proxy({}, { get: (_t, k) => (k === 'captureAWSv3Client' || k === 'captureAWSClient' ? (c) => c : k === 'captureLambdaHandler' || k === 'captureMethod' || k === 'injectLambdaContext' || k === 'logMetrics' ? () => (target) => target : noop) });
export class Logger { constructor() { return passthrough; } }
export class Tracer { constructor() { return passthrough; } }
export class Metrics { constructor() { return passthrough; } }
export const MetricUnit = new Proxy({}, { get: (_t, k) => String(k) });
