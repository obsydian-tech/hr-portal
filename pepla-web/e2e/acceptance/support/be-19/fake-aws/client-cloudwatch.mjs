// BE-19: copied from ../../be-18/fake-aws (BE-18 lock), unchanged.
// BE-18: copied from ../../be-17.1/fake-aws (BE-17.1 lock), unchanged.
// BE-17.1: copied unchanged from ../../be-17/fake-aws (BE-17 lock).
// CloudWatch that records metrics.
import { calls } from './world.mjs';
export class PutMetricDataCommand { constructor(input) { this.input = input; } }
export class CloudWatchClient {
  async send(cmd) { calls.push({ service: 'cloudwatch', op: 'PutMetricData' }); return {}; }
}
