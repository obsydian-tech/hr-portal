// EventBridge that records every entry put on a bus, in call order, and can misbehave the ways the real one does (world.bus):
//   ok               every entry accepted
//   throw            the call throws (service text in the message: it must never reach an answer or a log)
//   failedCount      FailedEntryCount 1 and the entry has an ErrorCode
//   failedCountOnly  FailedEntryCount 1 and nothing else
//   errorCodeOnly    FailedEntryCount 0 but the entry has an ErrorCode
//   hang             the call never answers, unless the caller gave the client a request timeout (or an abort signal)
// An accepted call answers after 25 ms, so a handler that does not wait for it answers before the entry is recorded.
// Nothing is delivered anywhere: the tests read what was put.
import { calls, world } from './world.mjs';
export class PutEventsCommand { constructor(input) { this.input = input; } }

const SERVICE_TEXT = 'ServiceUnavailable: arn:aws:events:af-south-1:000000000000:event-bus/naleko-onboarding could not take the entry (internal id 7f3c9a)';
const record = (e, accepted) => calls.push({ service: 'events', op: 'PutEvents', accepted, bus: e.EventBusName, source: e.Source, detailType: e.DetailType, detail: JSON.parse(e.Detail ?? '{}') });

/** The client-level request timeout in milliseconds, from the shapes the SDK takes it in; null when none was given. */
function timeoutOf(config = {}) {
  const h = config.requestHandler ?? {};
  const o = h.options ?? h.config ?? h;
  const ms = [o.requestTimeout, o.socketTimeout, o.connectionTimeout, config.requestTimeout].filter((n) => typeof n === 'number' && n > 0);
  return ms.length ? Math.min(...ms) : null;
}

export class EventBridgeClient {
  constructor(config = {}) { this.config = config; calls.push({ service: 'events', op: 'ClientCreated', requestTimeoutMs: timeoutOf(config), maxAttempts: config.maxAttempts ?? null }); }
  async send(cmd, options = {}) {
    if (!(cmd instanceof PutEventsCommand)) throw new Error('fake EventBridge: only PutEvents is supported');
    const entries = cmd.input.Entries ?? [];
    const mode = world.bus;
    if (mode === 'hang') {
      const limit = timeoutOf(this.config);
      const keep = setInterval(() => {}, 1000); // keeps the process alive: a hung call must look hung, not like a crash
      try {
        await new Promise((_resolve, reject) => {
          if (limit !== null) setTimeout(() => { const e = new Error('Request timed out'); e.name = 'TimeoutError'; reject(e); }, limit);
          options?.abortSignal?.addEventListener?.('abort', () => { const e = new Error('Request aborted'); e.name = 'AbortError'; reject(e); });
        });
      } finally { clearInterval(keep); }
    }
    if (mode === 'throw') { for (const e of entries) record(e, false); const e = new Error(SERVICE_TEXT); e.name = 'ServiceUnavailableException'; e.$metadata = { httpStatusCode: 503 }; throw e; }
    if (mode === 'failedCount') { for (const e of entries) record(e, false); return { FailedEntryCount: entries.length, Entries: entries.map(() => ({ ErrorCode: 'InternalFailure', ErrorMessage: SERVICE_TEXT })) }; }
    if (mode === 'failedCountOnly') { for (const e of entries) record(e, false); return { FailedEntryCount: entries.length, Entries: entries.map(() => ({})) }; }
    if (mode === 'errorCodeOnly') { for (const e of entries) record(e, false); return { FailedEntryCount: 0, Entries: entries.map(() => ({ ErrorCode: 'ThrottlingException', ErrorMessage: SERVICE_TEXT })) }; }
    await new Promise((r) => setTimeout(r, 25));
    for (const e of entries) record(e, true);
    return { FailedEntryCount: 0, Entries: entries.map((_e, i) => ({ EventId: `onb14-event-${i}` })) };
  }
  destroy() {}
}
