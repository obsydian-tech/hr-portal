// REC-06.1: copied from ../../rec-06/fake-aws (code added only: world.eventsPartial, below).
// EventBridge that records every entry put on a bus. Nothing is delivered anywhere: the tests read what was put.
import { calls, failIfAsked, world } from './world.mjs';
export class PutEventsCommand { constructor(input) { this.input = input; } }
export class EventBridgeClient {
  constructor() { this.config = {}; }
  async send(cmd) {
    if (!(cmd instanceof PutEventsCommand)) throw new Error('fake EventBridge: only PutEvents is supported');
    // REC-06.1 (code added only): world.eventsPartial = { failIndex, times? } makes PutEvents take every entry but the one at
    // `failIndex` (0 = the first), as EventBridge does when one entry fails: FailedEntryCount 1, that entry with an ErrorCode. The
    // failed entry is recorded as service 'events-failed' (never delivered), the others as usual. For the first `times` calls (default 1).
    const partial = world.eventsPartial;
    if (partial && (partial.done ?? 0) < (partial.times ?? 1)) {
      partial.done = (partial.done ?? 0) + 1;
      const entries = cmd.input.Entries ?? [];
      entries.forEach((e, i) => calls.push({ service: i === partial.failIndex ? 'events-failed' : 'events', op: 'PutEvents', bus: e.EventBusName, source: e.Source, detailType: e.DetailType, detail: JSON.parse(e.Detail ?? '{}') }));
      return { FailedEntryCount: entries.length > partial.failIndex ? 1 : 0, Entries: entries.map((_e, i) => (i === partial.failIndex ? { ErrorCode: 'InternalFailure', ErrorMessage: 'fake EventBridge: this entry failed' } : { EventId: `rec061-event-${i}` })) };
    }
    for (const e of cmd.input.Entries ?? []) {
      calls.push({ service: 'events', op: 'PutEvents', bus: e.EventBusName, source: e.Source, detailType: e.DetailType, detail: JSON.parse(e.Detail ?? '{}') });
    }
    // Child lock rec-15b.1: world.fail = { service: 'events' } makes the send throw (after it is recorded), as the DynamoDB fake does.
    failIfAsked('events', 'PutEvents');
    return { FailedEntryCount: 0, Entries: (cmd.input.Entries ?? []).map((_e, i) => ({ EventId: `be17-event-${i}` })) };
  }
  destroy() {}
}
