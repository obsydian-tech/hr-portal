// BE-18: copied from ../../be-17.1/fake-aws (BE-17.1 lock), with code added only: world.fail can make PutEvents throw.
// BE-17.1: copied unchanged from ../../be-17/fake-aws (BE-17 lock).
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
    failIfAsked('events', 'PutEvents');
    return { FailedEntryCount: 0, Entries: (cmd.input.Entries ?? []).map((_e, i) => ({ EventId: `be17-event-${i}` })) };
  }
  destroy() {}
}
