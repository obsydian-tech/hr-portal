// BE-20: copied from ../../be-18/fake-aws (BE-18 lock), with code added only: AdminGetUser answers from world.cognito.adminGetUser when a test sets it.
// BE-18: copied from ../../be-17.1/fake-aws (BE-17.1 lock), unchanged.
// BE-17.1: copied unchanged from ../../be-17/fake-aws (BE-17 lock).
// BE-17: Cognito. None of the nine routes needs it; every call is recorded and fails.
import { calls, world } from './world.mjs';
const handler = { get: (_t, name) => (typeof name === 'string' && name.endsWith('Command') ? class { constructor(input) { this.input = input; this.op = name.replace(/Command$/, ''); } } : undefined) };
export class CognitoIdentityProviderClient {
  constructor(config = {}) { this.config = config; }
  async send(cmd) {
    calls.push({ service: 'cognito', op: cmd?.op ?? 'unknown' });
    // lock check 6: world.cognito.adminGetUser = { error: 'UserNotFoundException' } or { user: {...} } answers AdminGetUser.
    if (cmd?.op === 'AdminGetUser' && world.cognito?.adminGetUser) {
      const g = world.cognito.adminGetUser;
      if (g.error) { const e = new Error(g.error); e.name = g.error; throw e; }
      return g.user;
    }
    throw new Error('BE-17 harness: no Cognito call is expected');
  }
  destroy() {}
}
const commands = new Proxy({}, handler);
export const AdminGetUserCommand = commands.AdminGetUserCommand;
export const AdminListGroupsForUserCommand = commands.AdminListGroupsForUserCommand;
export const ListUsersInGroupCommand = commands.ListUsersInGroupCommand;
export const ListUsersCommand = commands.ListUsersCommand;
// BE-18: the invite routes (lambda/shared/invite.mjs, redeemInvite) import these too. Every send still fails.
export const AdminCreateUserCommand = commands.AdminCreateUserCommand;
export const AdminAddUserToGroupCommand = commands.AdminAddUserToGroupCommand;
export const AdminSetUserPasswordCommand = commands.AdminSetUserPasswordCommand;
