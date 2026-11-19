// MOD-01: new. STS answers who the caller is from world.sts ({ Account, Arn, UserId }), as the module script
// reads it for the audit row's `by`. Every call is recorded.
import { calls, world } from './world.mjs';
class Command { constructor(input) { this.input = input; } }
export class GetCallerIdentityCommand extends Command { get op() { return 'GetCallerIdentity'; } }
export class STSClient {
  constructor(config = {}) { this.config = config; }
  async send(cmd) {
    calls.push({ service: 'sts', op: cmd?.op ?? 'unknown' });
    const who = world.sts ?? { Account: '424556617428', Arn: 'arn:aws:sts::424556617428:assumed-role/mod01-operator/mod01-test', UserId: 'AROAMOD01FAKE:mod01-test' };
    return { Account: who.Account, Arn: who.Arn, UserId: who.UserId ?? 'AROAMOD01FAKE:mod01-test' };
  }
  destroy() {}
}
export default { STSClient, GetCallerIdentityCommand };
