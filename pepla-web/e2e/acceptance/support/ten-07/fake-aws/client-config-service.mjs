// TEN-07: AWS Config. Records every command sent (its name and input) and answers PutEvaluations with no
// failed evaluations. Any other command is recorded, then refused, so the test sees it.
import { calls } from './world.mjs';
class Command { constructor(input) { this.input = input; } }
export class PutEvaluationsCommand extends Command { get op() { return 'PutEvaluations'; } }
export class ConfigServiceClient {
  constructor(config = {}) { this.config = config; calls.push({ service: 'config', op: 'new client', region: config.region ?? null }); }
  async send(cmd) {
    const op = cmd?.op ?? cmd?.constructor?.name ?? 'unknown';
    calls.push({ service: 'config', op, input: cmd?.input ?? null });
    if (op !== 'PutEvaluations') throw new Error(`fake Config: ${op} is not supported`);
    return { FailedEvaluations: [] };
  }
  destroy() {}
}
