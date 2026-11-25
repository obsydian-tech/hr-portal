// EventBridge that records every entry put on a bus. Nothing is delivered anywhere: the tests read what was put.
import { calls, failIfAsked } from './world.mjs';
export class PutEventsCommand { constructor(input) { this.input = input; } }
export class EventBridgeClient {
  constructor() { this.config = {}; }
  async send(cmd) {
    if (!(cmd instanceof PutEventsCommand)) throw new Error('fake EventBridge: only PutEvents is supported');
    for (const e of cmd.input.Entries ?? []) {
      calls.push({ service: 'events', op: 'PutEvents', bus: e.EventBusName, source: e.Source, detailType: e.DetailType, detail: JSON.parse(e.Detail ?? '{}') });
    }
    // Child lock rec-15b.1: world.fail = { service: 'events' } makes the send throw (after it is recorded), as the DynamoDB fake does.
    failIfAsked('events', 'PutEvents');
    return { FailedEntryCount: 0, Entries: (cmd.input.Entries ?? []).map((_e, i) => ({ EventId: `be17-event-${i}` })) };
  }
  destroy() {}
}
