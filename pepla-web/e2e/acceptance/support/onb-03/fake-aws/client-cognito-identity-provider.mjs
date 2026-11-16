// ONB-03: Cognito's user pool API over world.cognito.users ({ username, enabled?, attributes, groups }).
// Supports exactly what createEmployee, getHrPartners and checkEmployeeEmail may use: AdminCreateUser,
// AdminSetUserPassword, AdminAddUserToGroup and ListUsersInGroup (60 users a page at most, NextToken to
// carry on, as Cognito does; a Limit over 60 is refused as Cognito refuses it). Every call is recorded.
// The pool is the one in COGNITO_POOL_ID; any other pool is ResourceNotFoundException.
// ONB-04.2 (re-lock onb-03.5) adds two reads createEmployee's invite helper makes when the address already has a
// sign-in: AdminGetUser (UserStatus is the user's `status`, CONFIRMED when none is given) and
// AdminListGroupsForUser (the user's groups). UserNotFoundException when there is no such user.
import { world, calls, awsError } from './world.mjs';
world.cognito ??= { users: [] };
world.cognito.users ??= [];
export const PAGE_MAX = 60;
class Command { constructor(input) { this.input = input; } }
export class AdminCreateUserCommand extends Command { get op() { return 'AdminCreateUser'; } }
export class AdminSetUserPasswordCommand extends Command { get op() { return 'AdminSetUserPassword'; } }
export class AdminAddUserToGroupCommand extends Command { get op() { return 'AdminAddUserToGroup'; } }
export class ListUsersInGroupCommand extends Command { get op() { return 'ListUsersInGroup'; } }
export class AdminGetUserCommand extends Command { get op() { return 'AdminGetUser'; } }
export class AdminListGroupsForUserCommand extends Command { get op() { return 'AdminListGroupsForUser'; } }

const byName = (name) => world.cognito.users.find((u) => u.username === name);
const attrs = (u) => Object.entries(u.attributes ?? {}).map(([Name, Value]) => ({ Name, Value }));

export class CognitoIdentityProviderClient {
  constructor() { this.config = {}; }
  async send(cmd) {
    const i = cmd.input ?? {};
    calls.push({ service: 'cognito', op: cmd.op, input: i });
    if (i.UserPoolId !== process.env.COGNITO_POOL_ID) throw awsError('ResourceNotFoundException', `User pool ${i.UserPoolId} does not exist.`);
    if (cmd.op === 'AdminCreateUser') {
      if (byName(i.Username)) throw awsError('UsernameExistsException', 'User account already exists');
      world.cognito.users.push({ username: i.Username, enabled: true, attributes: Object.fromEntries((i.UserAttributes ?? []).map((a) => [a.Name, a.Value])), groups: [] });
      return { User: { Username: i.Username } };
    }
    if (cmd.op === 'AdminGetUser' || cmd.op === 'AdminListGroupsForUser') {
      const u = world.cognito.users.find((x) => String(x.username).toLowerCase() === String(i.Username ?? '').toLowerCase());
      if (!u) throw awsError('UserNotFoundException', 'User does not exist.');
      if (cmd.op === 'AdminGetUser') return { Username: u.username, UserAttributes: attrs(u), Enabled: u.enabled !== false, UserStatus: u.status ?? 'CONFIRMED' };
      return { Groups: (u.groups ?? []).map((GroupName) => ({ GroupName, UserPoolId: i.UserPoolId })) };
    }
    if (cmd.op === 'AdminSetUserPassword') {
      if (!byName(i.Username)) throw awsError('UserNotFoundException', 'User does not exist.');
      return {};
    }
    if (cmd.op === 'AdminAddUserToGroup') {
      const u = byName(i.Username);
      if (!u) throw awsError('UserNotFoundException', 'User does not exist.');
      if (!u.groups.includes(i.GroupName)) u.groups.push(i.GroupName);
      return {};
    }
    if (cmd.op === 'ListUsersInGroup') {
      if (!i.GroupName) throw awsError('InvalidParameterException', 'GroupName is required');
      if (i.Limit !== undefined && (i.Limit < 1 || i.Limit > PAGE_MAX)) throw awsError('InvalidParameterException', `1 validation error detected: Value '${i.Limit}' at 'limit' failed to satisfy constraint: Member must have value less than or equal to ${PAGE_MAX}`);
      const members = world.cognito.users.filter((u) => u.groups.includes(i.GroupName));
      const size = Math.min(i.Limit ?? PAGE_MAX, PAGE_MAX);
      let from = 0;
      if (i.NextToken) {
        from = Number(Buffer.from(String(i.NextToken), 'base64url').toString('utf8').replace(/^page:/, ''));
        if (!Number.isInteger(from) || from < 0) throw awsError('InvalidParameterException', 'Invalid NextToken');
      }
      const page = members.slice(from, from + size);
      const out = {
        Users: page.map((u) => ({ Username: u.username, Attributes: attrs(u), Enabled: u.enabled !== false, UserStatus: 'CONFIRMED', UserCreateDate: '2026-10-01T08:00:00.000Z', UserLastModifiedDate: '2026-10-01T08:00:00.000Z' })),
      };
      if (from + size < members.length) out.NextToken = Buffer.from(`page:${from + size}`).toString('base64url');
      return out;
    }
    throw new Error(`fake Cognito: ${cmd.op} is not supported`);
  }
  destroy() {}
}
