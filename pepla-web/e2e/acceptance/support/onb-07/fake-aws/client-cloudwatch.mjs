// CloudWatch that records metrics.
import { calls } from './world.mjs';
export class PutMetricDataCommand { constructor(input) { this.input = input; } }
export class CloudWatchClient {
  async send(cmd) { calls.push({ service: 'cloudwatch', op: 'PutMetricData' }); return {}; }
}
