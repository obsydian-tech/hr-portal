// EventBridge that records every entry put on a bus (ONB-22: copied from ../../ten-02/fake-aws).
// ONB-22: each entry is also delivered, as EventBridge would, to the real auditLogConsumer (named by ONB22_AUDIT_CONSUMER),
// so the audit table holds what the audit log really would. Delivery never fails the publisher (as a rule on a bus).
import { calls, world } from './world.mjs';
import { pathToFileURL } from 'node:url';
export class PutEventsCommand { constructor(input) { this.input = input; } }
let seq = 0;
let attempts = 0;
export class EventBridgeClient {
  constructor() { this.config = {}; }
  async send(cmd) {
    if (!(cmd instanceof PutEventsCommand)) throw new Error('fake EventBridge: only PutEvents is supported');
    // ONB-22.1: eventBridgeDown: true fails every put; eventBridgeDown: 'proposal.' fails only entries whose type starts with that (so the review
    // Lambda, which runs in this same process, still publishes); eventBridgeFailFirst: N fails the first N 'proposal.' puts and then works.
    // A failed put is recorded as service 'events-failed' (not 'events'), so publishedOf still lists only what reached the bus.
    const entries = cmd.input.Entries ?? [];
    const isProposal = entries.some((e) => String(e.DetailType).startsWith('proposal.'));
    if (isProposal) attempts += 1;
    const down = world.eventBridgeDown === true || (typeof world.eventBridgeDown === 'string' && entries.some((e) => String(e.DetailType).startsWith(world.eventBridgeDown)));
    if (down || (isProposal && attempts <= Number(world.eventBridgeFailFirst ?? 0))) {
      for (const e of entries) calls.push({ service: 'events-failed', op: 'PutEvents', detailType: e.DetailType });
      const e = new Error('fake EventBridge is down'); e.name = 'InternalException'; throw e;
    }
    for (const e of cmd.input.Entries ?? []) {
      const detail = JSON.parse(e.Detail ?? '{}');
      calls.push({ service: 'events', op: 'PutEvents', bus: e.EventBusName, source: e.Source, detailType: e.DetailType, detail });
      const file = process.env.ONB22_AUDIT_CONSUMER;
      if (file) {
        seq += 1;
        const { handler } = await import(pathToFileURL(file).href);
        await handler({ id: `onb22-event-${seq}`, time: new Date(Date.now() + seq).toISOString(), source: e.Source, 'detail-type': e.DetailType, detail, 'event-bus-name': e.EventBusName, region: 'af-south-1' });
      }
    }
    return { FailedEntryCount: 0, Entries: (cmd.input.Entries ?? []).map((_e, i) => ({ EventId: `onb22-event-${i}` })) };
  }
  destroy() {}
}
