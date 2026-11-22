// TEN-01: Secrets Manager answers from world.secrets (secret id -> { AWSCURRENT, AWSPENDING? }), as the agent
// key authorizer reads it. A stage it does not hold is ResourceNotFoundException, as AWS answers. Every call is recorded.
// (BE-17's copy refused every call; agentAuthorizer must read the key, so this one answers.)
import { calls, world, awsError } from './world.mjs';
class Command { constructor(input) { this.input = input; } }
export class GetSecretValueCommand extends Command { get op() { return 'GetSecretValue'; } }
export class SecretsManagerClient {
  constructor(config = {}) { this.config = config; }
  async send(cmd) {
    const stage = cmd?.input?.VersionStage ?? 'AWSCURRENT';
    calls.push({ service: 'secretsmanager', op: `${cmd?.op ?? 'unknown'} ${stage}` });
    const secret = (world.secrets ?? {})[cmd?.input?.SecretId];
    if (!secret || secret[stage] === undefined) throw awsError('ResourceNotFoundException', `Secrets Manager can't find the specified secret value for staging label: ${stage}`);
    return { SecretString: secret[stage], VersionStages: [stage] };
  }
  destroy() {}
}
