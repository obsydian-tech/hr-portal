// BE-18: copied from ../../be-17.1/fake-aws (BE-17.1 lock), unchanged.
// BE-17.1: copied unchanged from ../../be-17/fake-aws (BE-17 lock).
// BE-17: Secrets Manager. No route here may read a secret on a refused call; every call is recorded and fails.
import { calls } from './world.mjs';
class Command { constructor(input) { this.input = input; } }
export class GetSecretValueCommand extends Command { get op() { return 'GetSecretValue'; } }
export class SecretsManagerClient {
  constructor(config = {}) { this.config = config; }
  async send(cmd) {
    calls.push({ service: 'secretsmanager', op: cmd?.op ?? 'unknown' });
    throw new Error('BE-17 harness: no secret is read in these tests');
  }
  destroy() {}
}
