// CloudWatch that records each metric name.
import { calls } from './world.mjs';
export class PutMetricDataCommand { constructor(input) { this.input = input; } }
export class CloudWatchClient {
  async send(cmd) {
    for (const d of cmd.input?.MetricData ?? []) calls.push({ service: 'metric', op: 'PutMetricData', name: String(d.MetricName) });
    return {};
  }
}
