// TEN-06: copied from ../../ten-05/fake-aws and only added to: a second pool. The TalentFlow pool (the pool named by
// TALENT_FLOW_POOL_ID; its users are world.talentflow.users, same shape as the Naleko pool's) answers AdminGetUser,
// AdminListGroupsForUser, ListUsers and AdminInitiateAuth. AdminInitiateAuth (ADMIN_USER_PASSWORD_AUTH, only on the
// client named by TALENT_FLOW_CLIENT_ID) answers a CONFIRMED, enabled user with the right password with an
// AuthenticationResult whose IdToken holds the user's groups (cognito:groups) and sub; any other flow or client is an
// InvalidParameterException; a wrong password is NotAuthorizedException; an unknown user is UserNotFoundException.
// A recorded AdminInitiateAuth call never keeps the password: it keeps `passwordGiven` (the length) and `passwordRight`
// (whether it was the user's), so the logs and the call list can be scanned for secrets.
// TEN-05: copied from ../../ten-03/fake-aws and only added to: AdminRemoveUserFromGroup and AdminDisableUser, as
// Cognito answers them (UserNotFoundException for no user). When the world lists the pool's groups
// (world.cognito.groups), AdminAddUserToGroup, AdminRemoveUserFromGroup and ListUsersInGroup on a group that is not
// there fail with ResourceNotFoundException, as Cognito does; without that list every group name is taken.
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
world.talentflow ??= { users: [] };
world.talentflow.users ??= [];
export const PAGE_MAX = 60;
class Command { constructor(input) { this.input = input; } }
export class AdminCreateUserCommand extends Command { get op() { return 'AdminCreateUser'; } }
export class AdminGetUserCommand extends Command { get op() { return 'AdminGetUser'; } }
export class AdminSetUserPasswordCommand extends Command { get op() { return 'AdminSetUserPassword'; } }
export class AdminAddUserToGroupCommand extends Command { get op() { return 'AdminAddUserToGroup'; } }
export class ListUsersInGroupCommand extends Command { get op() { return 'ListUsersInGroup'; } }
export class ListUsersCommand extends Command { get op() { return 'ListUsers'; } }
export class AdminListGroupsForUserCommand extends Command { get op() { return 'AdminListGroupsForUser'; } }
// TEN-05
export class AdminRemoveUserFromGroupCommand extends Command { get op() { return 'AdminRemoveUserFromGroup'; } }
export class AdminDisableUserCommand extends Command { get op() { return 'AdminDisableUser'; } }
// TEN-06
export class AdminInitiateAuthCommand extends Command { get op() { return 'AdminInitiateAuth'; } }
export class NotAuthorizedException extends Error { constructor(o = {}) { super(o.message ?? 'Incorrect username or password.'); this.name = 'NotAuthorizedException'; } }
export class UsernameExistsException extends Error { constructor(o = {}) { super(o.message ?? 'User account already exists'); this.name = 'UsernameExistsException'; } }
export class UserNotFoundException extends Error { constructor(o = {}) { super(o.message ?? 'User does not exist.'); this.name = 'UserNotFoundException'; } }
export class InvalidPasswordException extends Error { constructor(o = {}) { super(o.message ?? 'Password does not conform to policy'); this.name = 'InvalidPasswordException'; } }

// Cognito usernames in this pool are not case-sensitive.
const byName = (name, pool = world.cognito) => pool.users.find((u) => String(u.username).toLowerCase() === String(name ?? '').toLowerCase());
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
  failIfAsked('cognito', op); // TEN-05.1: world.fail with service 'cognito' (a chosen name and message) fails these too.
  if ((world.cognitoFail ?? []).includes(op)) {
    const e = awsError('InternalErrorException', `fake Cognito: ${op} is unavailable`);
    e.$fault = 'server';
    e.$metadata = { httpStatusCode: 500 };
    throw e;
  }
}

/** TEN-06: the TalentFlow pool. Only the calls the migration trigger and the link script make. */
function talentFlowPool(cmd, i) {
  const pool = world.talentflow;
  const idToken = (u) => 'x.' + Buffer.from(JSON.stringify({ sub: u.sub, email: u.attributes?.email, 'cognito:groups': u.groups ?? [], token_use: 'id' })).toString('base64url') + '.y';
  if (cmd.op === 'AdminInitiateAuth') {
    if (i.AuthFlow !== 'ADMIN_USER_PASSWORD_AUTH') throw awsError('InvalidParameterException', `Auth flow not supported by the server client: ${i.AuthFlow}`);
    if (i.ClientId !== process.env.TALENT_FLOW_CLIENT_ID) throw awsError('ResourceNotFoundException', 'User pool client does not exist.');
    const u = byName(i.AuthParameters?.USERNAME, pool);
    if (!u) throw new UserNotFoundException();
    if (u.enabled === false) throw new NotAuthorizedException({ message: 'User is disabled.' });
    if (typeof u.password !== 'string' || u.password !== i.AuthParameters?.PASSWORD) throw new NotAuthorizedException();
    if (u.status && u.status !== 'CONFIRMED') return { ChallengeName: 'NEW_PASSWORD_REQUIRED', Session: 'fake-session', ChallengeParameters: {} };
    return { AuthenticationResult: { IdToken: idToken(u), AccessToken: 'x.' + Buffer.from(JSON.stringify({ sub: u.sub })).toString('base64url') + '.y', RefreshToken: 'fake-refresh', ExpiresIn: 3600, TokenType: 'Bearer' } };
  }
  if (cmd.op === 'AdminGetUser') {
    const u = byName(i.Username, pool);
    if (!u) throw new UserNotFoundException();
    return { Username: u.username, UserAttributes: attrs(u), Enabled: u.enabled !== false, UserStatus: u.status ?? 'CONFIRMED' };
  }
  if (cmd.op === 'AdminListGroupsForUser') {
    const u = byName(i.Username, pool);
    if (!u) throw new UserNotFoundException();
    return { Groups: (u.groups ?? []).map((GroupName) => ({ GroupName, UserPoolId: i.UserPoolId })) };
  }
  if (cmd.op === 'ListUsers') {
    let users = pool.users;
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
  throw new Error(`fake Cognito: ${cmd.op} is not supported on the TalentFlow pool (the migration code only reads it)`);
}

export class CognitoIdentityProviderClient {
  constructor() { this.config = {}; }
  async send(cmd) {
    await new Promise((r) => setImmediate(r));
    const i = cmd.input ?? {};
    const secret = cmd.op === 'AdminInitiateAuth' ? { AuthParameters: { USERNAME: i.AuthParameters?.USERNAME, passwordGiven: String(i.AuthParameters?.PASSWORD ?? '').length } } : null;
    const pool0 = i.UserPoolId === process.env.COGNITO_POOL_ID ? world.cognito : i.UserPoolId === process.env.TALENT_FLOW_POOL_ID ? world.talentflow : null;
    const user0 = secret && pool0 ? byName(i.AuthParameters?.USERNAME, pool0) : null;
    calls.push({ service: 'cognito', op: cmd.op, input: secret ? { ...i, ...secret, ...(user0 ? { passwordRight: user0.password === i.AuthParameters?.PASSWORD } : {}) } : i, pool: pool0 === world.talentflow ? 'talentflow' : pool0 === world.cognito ? 'naleko' : 'none' });
    if (secret) delete calls[calls.length - 1].input.AuthParameters.PASSWORD;
    if (!pool0) throw awsError('ResourceNotFoundException', `User pool ${i.UserPoolId} does not exist.`);
    failing(cmd.op);
    if (pool0 === world.talentflow) return talentFlowPool(cmd, i);
    // TEN-05: a group the pool does not have.
    if (Array.isArray(world.cognito.groups) && ['AdminAddUserToGroup', 'AdminRemoveUserFromGroup', 'ListUsersInGroup'].includes(cmd.op) && i.GroupName && !world.cognito.groups.includes(i.GroupName)) {
      throw awsError('ResourceNotFoundException', 'Group not found.');
    }
    if (cmd.op === 'AdminRemoveUserFromGroup') {
      const u = byName(i.Username);
      if (!u) throw new UserNotFoundException();
      u.groups = (u.groups ?? []).filter((g) => g !== i.GroupName);
      return {};
    }
    if (cmd.op === 'AdminDisableUser') {
      const u = byName(i.Username);
      if (!u) throw new UserNotFoundException();
      u.enabled = false;
      return {};
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
