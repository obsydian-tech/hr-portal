// CHAT-06: copied from ../../onb-22/fake-aws/client-eventbridge.mjs (the audit consumer is named by CHAT06_AUDIT_CONSUMER).
// EventBridge that records every entry put on a bus; each entry is also delivered, as EventBridge would, to the real auditLogConsumer, so
// the audit table holds what the audit log really would. Delivery never fails the publisher (as a rule on a bus).
// world.eventBridgeDown: true fails every put. A failed put is recorded as service 'events-failed' (not 'events').
import { calls, world } from './world.mjs';
import { pathToFileURL } from 'node:url';
export class PutEventsCommand { constructor(input) { this.input = input; } }
let seq = 0;
export class EventBridgeClient {
  constructor() { this.config = {}; }
  async send(cmd) {
    if (!(cmd instanceof PutEventsCommand)) throw new Error('fake EventBridge: only PutEvents is supported');
    const entries = cmd.input.Entries ?? [];
    if (world.eventBridgeDown === true) {
      for (const e of entries) calls.push({ service: 'events-failed', op: 'PutEvents', detailType: e.DetailType });
      const e = new Error('fake EventBridge is down'); e.name = 'InternalException'; throw e;
    }
    for (const e of entries) {
      const detail = JSON.parse(e.Detail ?? '{}');
      calls.push({ service: 'events', op: 'PutEvents', bus: e.EventBusName, source: e.Source, detailType: e.DetailType, detail });
      const file = process.env.CHAT06_AUDIT_CONSUMER;
      if (file) {
        seq += 1;
        const { handler } = await import(pathToFileURL(file).href);
        await handler({ id: `chat06-event-${seq}`, time: new Date(Date.now() + seq).toISOString(), source: e.Source, 'detail-type': e.DetailType, detail, 'event-bus-name': e.EventBusName, region: 'af-south-1' });
      }
    }
    return { FailedEntryCount: 0, Entries: entries.map((_e, i) => ({ EventId: `chat06-event-${i}` })) };
  }
  destroy() {}
}
