// Cognito admin calls: AdminUserGlobalSignOut (fails with world.fail.signOut). Anything else is recorded and refused.
import { calls, world, awsError } from './world.mjs';
class Command { constructor(input) { this.input = input; } }
export class AdminUserGlobalSignOutCommand extends Command { get op() { return 'AdminUserGlobalSignOut'; } }
export class GlobalSignOutCommand extends Command { get op() { return 'GlobalSignOut'; } }
export class AdminGetUserCommand extends Command { get op() { return 'AdminGetUser'; } }
export class CognitoIdentityProviderClient {
  async send(cmd) {
    const op = cmd.op ?? cmd.constructor.name.replace('Command', '');
    calls.push({ service: 'cognito', op, input: cmd.input });
    if (op !== 'AdminUserGlobalSignOut') throw awsError('AccessDeniedException', `fake Cognito: the role allows AdminUserGlobalSignOut only, not ${op}`);
    if (world.fail.signOut) throw awsError('InternalErrorException', 'An internal error occurred.');
    return {};
  }
}
