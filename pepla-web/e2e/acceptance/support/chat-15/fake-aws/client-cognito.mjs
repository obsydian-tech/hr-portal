// CHAT-15: copied from ../../chat-02/fake-aws, code added only: world.fail also takes service 'cognito' (every matching call fails with the
// message and name given), and world.failUsers = { <operation>: [username, ...] } fails that operation for those users only.
// TEN-03: copied from ../../onb-18/fake-aws (ONB-18 lock) and only added to: every user has a `sub` (kept, or made
// as sub-<n> at AdminCreateUser and returned in its User.Attributes, as Cognito does); AdminGetUser answers it; and
// ListUsers answers a pool page (60 at most, PaginationToken) with an optional exact Filter `name = "value"` on
// email or sub, as the backfill and the invite path ask.
// ONB-18: copied from ../../onb-04.2/fake-aws (ONB-04.2 lock) unchanged. A user's `enabled: false` (Cognito's
// Enabled) is answered by AdminGetUser and ListUsersInGroup; a disabled user cannot sign in.
//
// ONB-04.2: copied from ../../onb-04/fake-aws (ONB-04 lock) and only added to: AdminListGroupsForUser answers the
// groups the fake already keeps for a user ({ Groups: [{ GroupName, UserPoolId }] }, UserNotFoundException for
// no user), as Cognito does. AdminSetUserPassword(Permanent: true) already makes the user CONFIRMED.
//
// ONB-04 (from ONB-03's): Cognito's user pool API over world.cognito.users
// ({ username, enabled?, attributes, groups, status?, password?, tempPassword? }).
// Supports AdminCreateUser, AdminGetUser, AdminSetUserPassword, AdminAddUserToGroup and ListUsersInGroup
// (60 users a page at most, NextToken to carry on; a Limit over 60 is refused). Every call is recorded.
// The pool is the one in COGNITO_POOL_ID; any other pool is ResourceNotFoundException.
//
// ONB-04 adds a user status, as Cognito keeps one:
//   - AdminCreateUser makes the user FORCE_CHANGE_PASSWORD. Cognito makes its own one-time value, which nobody
//     sees: the fake keeps none. A TemporaryPassword passed by the caller is kept as `tempPassword`, so a test
//     can see that one was given. A user in FORCE_CHANGE_PASSWORD cannot sign in with any password.
//   - AdminSetUserPassword checks the pool's password rules (12 or more characters, lower case, upper case, a
//     number, a symbol) and refuses a weaker one with InvalidPasswordException, as the pool does. Permanent: true
//     makes the user CONFIRMED with that password; Permanent: false keeps them FORCE_CHANGE_PASSWORD.
//   - world.cognitoFail: a list of operation names that fail with InternalErrorException (a 500 from Cognito).
//   - signIn(username, password) (exported for the harness): true only for a CONFIRMED user with that password.
import { world, calls, awsError, failIfAsked } from './world.mjs';
world.cognito ??= { users: [] };
world.cognito.users ??= [];
export const PAGE_MAX = 60;
class Command { constructor(input) { this.input = input; } }
export class AdminCreateUserCommand extends Command { get op() { return 'AdminCreateUser'; } }
export class AdminGetUserCommand extends Command { get op() { return 'AdminGetUser'; } }
export class AdminSetUserPasswordCommand extends Command { get op() { return 'AdminSetUserPassword'; } }
export class AdminAddUserToGroupCommand extends Command { get op() { return 'AdminAddUserToGroup'; } }
export class ListUsersInGroupCommand extends Command { get op() { return 'ListUsersInGroup'; } }
export class ListUsersCommand extends Command { get op() { return 'ListUsers'; } }
export class AdminListGroupsForUserCommand extends Command { get op() { return 'AdminListGroupsForUser'; } }
export class UsernameExistsException extends Error { constructor(o = {}) { super(o.message ?? 'User account already exists'); this.name = 'UsernameExistsException'; } }
export class UserNotFoundException extends Error { constructor(o = {}) { super(o.message ?? 'User does not exist.'); this.name = 'UserNotFoundException'; } }
export class InvalidPasswordException extends Error { constructor(o = {}) { super(o.message ?? 'Password does not conform to policy'); this.name = 'InvalidPasswordException'; } }

// Cognito usernames in this pool are not case-sensitive.
const byName = (name) => world.cognito.users.find((u) => String(u.username).toLowerCase() === String(name ?? '').toLowerCase());
const attrs = (u) => Object.entries({ ...(u.sub ? { sub: u.sub } : {}), ...(u.attributes ?? {}) }).map(([Name, Value]) => ({ Name, Value }));

/** The pool's password policy (infra/cognito.tf): 12+, lower, upper, number, symbol. */
export function meetsPolicy(p) {
  return typeof p === 'string' && p.length >= 12 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p);
}

export function signIn(username, password) {
  const u = byName(username);
  return !!u && u.enabled !== false && u.status === 'CONFIRMED' && typeof u.password === 'string' && u.password === password;
}

function failing(op) {
  if ((world.cognitoFail ?? []).includes(op)) {
    const e = awsError('InternalErrorException', `fake Cognito: ${op} is unavailable`);
    e.$fault = 'server';
    e.$metadata = { httpStatusCode: 500 };
    throw e;
  }
}

export class CognitoIdentityProviderClient {
  constructor() { this.config = {}; }
  async send(cmd) {
    await new Promise((r) => setImmediate(r));
    const i = cmd.input ?? {};
    calls.push({ service: 'cognito', op: cmd.op, input: i });
    if (i.UserPoolId !== process.env.COGNITO_POOL_ID) throw awsError('ResourceNotFoundException', `User pool ${i.UserPoolId} does not exist.`);
    failing(cmd.op);
    failIfAsked('cognito', cmd.op);
    if ((world.failUsers?.[cmd.op] ?? []).includes(i.Username)) {
      const e = awsError('InternalErrorException', world.failUsersMessage ?? `fake Cognito: ${cmd.op} failed for this user`);
      e.$fault = 'server';
      e.$metadata = { httpStatusCode: 500 };
      throw e;
    }
    if (cmd.op === 'AdminCreateUser') {
      if (byName(i.Username)) throw new UsernameExistsException();
      const u = { username: i.Username, sub: `sub-${world.cognito.users.length + 1}-new`, enabled: true, attributes: Object.fromEntries((i.UserAttributes ?? []).map((a) => [a.Name, a.Value])), groups: [], status: 'FORCE_CHANGE_PASSWORD' };
      if (i.TemporaryPassword !== undefined) u.tempPassword = i.TemporaryPassword;
      world.cognito.users.push(u);
      return { User: { Username: i.Username, UserStatus: 'FORCE_CHANGE_PASSWORD', Enabled: true, Attributes: attrs(u) } };
    }
    if (cmd.op === 'AdminGetUser') {
      const u = byName(i.Username);
      if (!u) throw new UserNotFoundException();
      return { Username: u.username, UserAttributes: attrs(u), Enabled: u.enabled !== false, UserStatus: u.status ?? 'CONFIRMED' };
    }
    if (cmd.op === 'AdminSetUserPassword') {
      const u = byName(i.Username);
      if (!u) throw new UserNotFoundException();
      if (!meetsPolicy(i.Password)) throw new InvalidPasswordException({ message: 'Password did not conform with policy' });
      if (i.Permanent) { u.password = i.Password; u.status = 'CONFIRMED'; delete u.tempPassword; }
      else { u.tempPassword = i.Password; u.status = 'FORCE_CHANGE_PASSWORD'; }
      return {};
    }
    if (cmd.op === 'AdminAddUserToGroup') {
      const u = byName(i.Username);
      if (!u) throw new UserNotFoundException();
      if (!u.groups.includes(i.GroupName)) u.groups.push(i.GroupName);
      return {};
    }
    if (cmd.op === 'AdminListGroupsForUser') {
      const u = byName(i.Username);
      if (!u) throw new UserNotFoundException();
      return { Groups: (u.groups ?? []).map((GroupName) => ({ GroupName, UserPoolId: i.UserPoolId })) };
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
        Users: page.map((u) => ({ Username: u.username, Attributes: attrs(u), Enabled: u.enabled !== false, UserStatus: u.status ?? 'CONFIRMED', UserCreateDate: '2026-10-01T08:00:00.000Z', UserLastModifiedDate: '2026-10-01T08:00:00.000Z' })),
      };
      if (from + size < members.length) out.NextToken = Buffer.from(`page:${from + size}`).toString('base64url');
      return out;
    }
    if (cmd.op === 'ListUsers') {
      if (i.Limit !== undefined && (i.Limit < 1 || i.Limit > PAGE_MAX)) throw awsError('InvalidParameterException', 'Limit must be 60 or less');
      let users = world.cognito.users;
      if (i.Filter) {
        const m = /^\s*(email|sub|username)\s*=\s*"([^"]*)"\s*$/.exec(i.Filter);
        if (!m) throw awsError('InvalidParameterException', `fake Cognito: filter not supported: ${i.Filter}`);
        users = users.filter((u) => (m[1] === 'sub' ? u.sub : m[1] === 'username' ? u.username : u.attributes?.email) === m[2]);
      }
      const size = Math.min(i.Limit ?? PAGE_MAX, PAGE_MAX);
      const from = i.PaginationToken ? Number(Buffer.from(String(i.PaginationToken), 'base64url').toString('utf8').replace(/^page:/, '')) : 0;
      const page = users.slice(from, from + size);
      const out = { Users: page.map((u) => ({ Username: u.username, Attributes: attrs(u), Enabled: u.enabled !== false, UserStatus: u.status ?? 'CONFIRMED' })) };
      if (from + size < users.length) out.PaginationToken = Buffer.from(`page:${from + size}`).toString('base64url');
      return out;
    }
    throw new Error(`fake Cognito: ${cmd.op} is not supported`);
  }
  destroy() {}
}
