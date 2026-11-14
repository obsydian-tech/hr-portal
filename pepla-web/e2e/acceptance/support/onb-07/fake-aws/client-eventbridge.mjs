// EventBridge that records every entry put on a bus. Nothing is delivered: the test delivers events
// to sendNotificationEmail itself, as the rules in infra/eventbridge.tf would.
import { calls } from './world.mjs';
export class PutEventsCommand { constructor(input) { this.input = input; } }
export class EventBridgeClient {
  constructor() { this.config = {}; }
  async send(cmd) {
    if (!(cmd instanceof PutEventsCommand)) throw new Error('fake EventBridge: only PutEvents is supported');
    for (const e of cmd.input.Entries ?? []) {
      calls.push({ service: 'events', op: 'PutEvents', bus: e.EventBusName, source: e.Source, detailType: e.DetailType, detail: JSON.parse(e.Detail ?? '{}') });
    }
    return { FailedEntryCount: 0, Entries: (cmd.input.Entries ?? []).map((_e, i) => ({ EventId: `onb07-event-${i}` })) };
  }
  destroy() {}
}
