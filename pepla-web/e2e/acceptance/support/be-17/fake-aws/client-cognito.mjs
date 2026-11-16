// BE-17: Cognito. None of the nine routes needs it; every call is recorded and fails.
import { calls } from './world.mjs';
const handler = { get: (_t, name) => (typeof name === 'string' && name.endsWith('Command') ? class { constructor(input) { this.input = input; this.op = name.replace(/Command$/, ''); } } : undefined) };
export class CognitoIdentityProviderClient {
  constructor(config = {}) { this.config = config; }
  async send(cmd) {
    calls.push({ service: 'cognito', op: cmd?.op ?? 'unknown' });
    throw new Error('BE-17 harness: no Cognito call is expected');
  }
  destroy() {}
}
const commands = new Proxy({}, handler);
export const AdminGetUserCommand = commands.AdminGetUserCommand;
export const AdminListGroupsForUserCommand = commands.AdminListGroupsForUserCommand;
export const ListUsersInGroupCommand = commands.ListUsersInGroupCommand;
export const ListUsersCommand = commands.ListUsersCommand;
