import type { BrowserContext, Request, Route } from '@playwright/test';
import { createHash, createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A stand-in for Amazon Cognito, for the no-backend acceptance run.
 *
 * It answers the browser's calls to https://cognito-idp.<region>.amazonaws.com/
 * the way Cognito answers them, so the app can use its real Cognito library
 * (amazon-cognito-identity-js, SRP sign-in) without a network or an AWS account.
 *
 * What it does not do: check the password. In SRP the password never leaves the
 * browser, and checking the proof would need the app's pool id. A test that
 * needs a wrong password says so with `rejectNextSignIn()`. Real password checks
 * run in the pepla-dev journey against the real pool.
 *
 * Every call is recorded in `calls`, so a test can prove nothing was sent.
 * Nothing here calls a paid service.
 */

export type FakeAccount = {
  email: string;
  givenName: string;
  familyName: string;
  groups: string[];
  /** Account made by an admin whose first password is not set yet. */
  newPasswordRequired?: boolean;
};

export type CognitoCall = { target: string; body: Record<string, unknown> };

type CognitoError = { type: string; message: string };

export const COGNITO_ERRORS = {
  wrongPassword: { type: 'NotAuthorizedException', message: 'Incorrect username or password.' },
  userNotFound: { type: 'UserNotFoundException', message: 'User does not exist.' },
  lockedOut: { type: 'NotAuthorizedException', message: 'Password attempts exceeded' },
  throttled: { type: 'TooManyRequestsException', message: 'Too many requests' },
  // ONB-24: the answers ForgotPassword and ConfirmForgotPassword can give, with Cognito's own words.
  codeMismatch: { type: 'CodeMismatchException', message: 'Invalid verification code provided, please try again.' },
  expiredCode: { type: 'ExpiredCodeException', message: 'Invalid code provided, please request a code again.' },
  limitExceeded: { type: 'LimitExceededException', message: 'Attempt limit exceeded, please try after some time.' },
  invalidPassword: { type: 'InvalidPasswordException', message: 'Password did not conform with policy: Password must have symbol characters' },
  invalidParameter: { type: 'InvalidParameterException', message: 'Cannot reset password for the user as there is no registered/verified email or phone_number' },
  cannotReset: { type: 'NotAuthorizedException', message: 'User password cannot be reset in the current state.' },
} satisfies Record<string, CognitoError>;

const COGNITO_HOST = /^https:\/\/cognito-idp\.[a-z0-9-]+\.amazonaws\.com\/?(\?.*)?$/;
const TARGET_PREFIX = 'AWSCognitoIdentityProviderService.';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': '*',
  'access-control-expose-headers': 'x-amzn-RequestId, x-amzn-ErrorType, x-amzn-ErrorMessage',
};

export class CognitoFake {
  readonly calls: CognitoCall[] = [];
  /** When true, every Cognito call fails as if the network were down. */
  offline = false;

  private readonly accounts = new Map<string, FakeAccount & { sub: string }>();
  private readonly scripted: CognitoError[] = [];
  private readonly refreshTokens = new Map<string, string>();
  private readonly pending = new Map<string, string>();

  // ONB-24: forgot password. Codes sent, passwords set by a reset (checked for real at sign-in, by SRP),
  // errors given to the next call of one target, and calls held until a test lets them go.
  private readonly codes = new Map<string, { code: string; expired: boolean }>();
  private readonly resetPasswords = new Map<string, string>();
  private readonly nextErrors = new Map<string, CognitoError[]>();
  private readonly holds: Array<{ target: string; gate: Promise<void> }> = [];
  private readonly srp = new Map<string, { b: bigint; B: bigint; v: bigint; email: string }>();
  private poolName: string | null = null;

  constructor(accounts: FakeAccount[]) {
    for (const a of accounts) this.accounts.set(a.email.toLowerCase(), { ...a, sub: randomUUID() });
  }

  /** The next sign-in attempt fails with this Cognito error (default: wrong password). */
  rejectNextSignIn(error: CognitoError = COGNITO_ERRORS.wrongPassword): void {
    this.scripted.push(error);
  }

  /**
   * ONB-17: a person who joins after the run started (a new employee with an invite link).
   * Give `newPasswordRequired: true` for someone whose first password is not set yet.
   */
  addAccount(account: FakeAccount): void {
    this.accounts.set(account.email.toLowerCase(), { ...account, sub: randomUUID() });
  }

  /**
   * ONB-17: the person's password was set for them (what AdminSetUserPassword with Permanent does,
   * called by the invite fake on a good redeem). From now on they sign in without the first-password step.
   */
  setPassword(email: string): void {
    const account = this.accounts.get(email.toLowerCase());
    if (account) account.newPasswordRequired = false;
  }

  /** ONB-17: the Cognito id (sub) of an account, to tell whose session the browser keeps. */
  subOf(email: string): string | undefined {
    return this.accounts.get(email.toLowerCase())?.sub;
  }

  /** Calls the app made to Cognito that try to sign someone in. */
  signInCalls(): CognitoCall[] {
    return this.calls.filter((c) => c.target === 'InitiateAuth' || c.target === 'RespondToAuthChallenge');
  }

  /**
   * ONB-24: the next call to `target` (for example 'ForgotPassword') fails with this Cognito error.
   * Several calls queue in order.
   */
  failNext(target: string, error: CognitoError): void {
    const list = this.nextErrors.get(target) ?? [];
    list.push(error);
    this.nextErrors.set(target, list);
  }

  /** ONB-24: holds the next call to `target` until the returned function is called. */
  hold(target: string): () => void {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    this.holds.push({ target, gate });
    return release;
  }

  /** ONB-24: the code the last ForgotPassword sent to this account, or undefined when none was sent. */
  codeFor(email: string): string | undefined {
    return this.codes.get(email.toLowerCase())?.code;
  }

  /** ONB-24: the code sent to this account has passed its hour. */
  expireCode(email: string): void {
    const c = this.codes.get(email.toLowerCase());
    if (c) c.expired = true;
  }

  /** ONB-24: the calls with this target, in order. */
  callsTo(target: string): CognitoCall[] {
    return this.calls.filter((c) => c.target === target);
  }

  async install(context: BrowserContext): Promise<void> {
    await context.route(COGNITO_HOST, (route) => this.handle(route));
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 200, headers: CORS, body: '' });
      return;
    }
    if (this.offline) {
      await route.abort('internetdisconnected');
      return;
    }
    const target = (request.headers()['x-amz-target'] ?? '').replace(TARGET_PREFIX, '');
    const body = parse(request);
    this.calls.push({ target, body });
    const held = this.holds.findIndex((h) => h.target === target);
    if (held >= 0) {
      const [h] = this.holds.splice(held, 1);
      await h!.gate;
    }
    const scriptedError = this.nextErrors.get(target)?.shift();
    if (scriptedError) {
      await fail(route, scriptedError);
      return;
    }
    try {
      await ok(route, this.answer(target, body));
    } catch (e) {
      if (isCognitoError(e)) await fail(route, e);
      else throw e;
    }
  }

  private answer(target: string, body: Record<string, any>): unknown {
    switch (target) {
      case 'InitiateAuth':
        return this.initiateAuth(body);
      case 'RespondToAuthChallenge':
        return this.respondToAuthChallenge(body);
      case 'GetUser':
        return this.getUser(body);
      case 'GlobalSignOut':
      case 'RevokeToken':
        return {};
      case 'ForgotPassword':
        return this.forgotPassword(body);
      case 'ConfirmForgotPassword':
        return this.confirmForgotPassword(body);
      default:
        throw { type: 'InvalidParameterException', message: `The fake does not handle ${target || 'this call'}.` };
    }
  }

  private initiateAuth(body: Record<string, any>): unknown {
    const params = (body['AuthParameters'] ?? {}) as Record<string, string>;
    const flow = body['AuthFlow'];

    if (flow === 'REFRESH_TOKEN_AUTH' || flow === 'REFRESH_TOKEN') {
      const email = this.refreshTokens.get(params['REFRESH_TOKEN'] ?? '');
      const account = email ? this.accounts.get(email) : undefined;
      if (!account) throw { type: 'NotAuthorizedException', message: 'Invalid Refresh Token' };
      return { AuthenticationResult: this.tokens(account, String(body['ClientId']), false) };
    }

    // The Naleko pool's pepla-web client allows SRP and nothing more (ONB-01, Backend).
    if (flow !== 'USER_SRP_AUTH') {
      throw { type: 'InvalidParameterException', message: `${flow} flow not enabled for this client` };
    }
    const scripted = this.scripted.shift();
    if (scripted) {
      // Cognito reports a bad password on the second call; keep that shape.
      this.pending.set('scripted', JSON.stringify(scripted));
    }
    const account = this.accounts.get(String(params['USERNAME'] ?? '').toLowerCase());
    if (!account && !scripted) throw COGNITO_ERRORS.userNotFound;
    const username = account?.sub ?? randomUUID();
    // ONB-24: an account whose password was set by a reset is checked for real, by SRP.
    const known = account ? this.resetPasswords.get(account.email.toLowerCase()) : undefined;
    if (account && known !== undefined && !scripted) {
      const salt = randomBytes(16).toString('hex');
      const secretBlock = randomBytes(64).toString('base64');
      const v = modPow(G, srpX(this.pool(), account.sub, known, salt), N);
      const b = BigInt('0x' + randomBytes(32).toString('hex'));
      const B = (K * v + modPow(G, b, N)) % N;
      this.srp.set(account.sub, { b, B, v, email: account.email.toLowerCase() });
      this.pending.set(`srp:${account.sub}`, JSON.stringify({ A: String(params['SRP_A'] ?? ''), salt, secretBlock }));
      return {
        ChallengeName: 'PASSWORD_VERIFIER',
        ChallengeParameters: { SALT: salt, SECRET_BLOCK: secretBlock, SRP_B: B.toString(16), USERNAME: username, USER_ID_FOR_SRP: username },
      };
    }
    return {
      ChallengeName: 'PASSWORD_VERIFIER',
      ChallengeParameters: {
        SALT: randomBytes(16).toString('hex'),
        SECRET_BLOCK: randomBytes(64).toString('base64'),
        SRP_B: randomBytes(384).toString('hex').replace(/^0+/, '1'),
        USERNAME: username,
        USER_ID_FOR_SRP: username,
      },
    };
  }

  private respondToAuthChallenge(body: Record<string, any>): unknown {
    const responses = (body['ChallengeResponses'] ?? {}) as Record<string, string>;
    const scripted = this.pending.get('scripted');
    if (scripted) {
      this.pending.delete('scripted');
      throw JSON.parse(scripted) as CognitoError;
    }
    if (body['ChallengeName'] !== 'PASSWORD_VERIFIER') {
      throw { type: 'InvalidParameterException', message: 'The fake only answers PASSWORD_VERIFIER.' };
    }
    const account = [...this.accounts.values()].find((a) => a.sub === responses['USERNAME']);
    if (!account) throw COGNITO_ERRORS.wrongPassword;
    // ONB-24: the proof must match the password the reset set.
    const srpState = this.srp.get(account.sub);
    const srpPending = this.pending.get(`srp:${account.sub}`);
    if (srpState && srpPending) {
      this.srp.delete(account.sub);
      this.pending.delete(`srp:${account.sub}`);
      const { A, salt, secretBlock } = JSON.parse(srpPending) as { A: string; salt: string; secretBlock: string };
      const expected = srpSignature(this.pool(), account.sub, srpState, A, secretBlock, String(responses['TIMESTAMP'] ?? ''));
      void salt;
      if (!expected || responses['PASSWORD_CLAIM_SIGNATURE'] !== expected) throw COGNITO_ERRORS.wrongPassword;
    }
    if (account.newPasswordRequired) {
      return {
        ChallengeName: 'NEW_PASSWORD_REQUIRED',
        Session: randomBytes(32).toString('base64'),
        ChallengeParameters: {
          USER_ID_FOR_SRP: account.sub,
          requiredAttributes: '[]',
          userAttributes: JSON.stringify({ email: account.email, given_name: account.givenName }),
        },
      };
    }
    return { ChallengeParameters: {}, AuthenticationResult: this.tokens(account, String(body['ClientId']), true) };
  }

  private getUser(body: Record<string, any>): unknown {
    const claims = decode(String(body['AccessToken'] ?? ''));
    const account = [...this.accounts.values()].find((a) => a.sub === claims?.['sub']);
    if (!account) throw { type: 'NotAuthorizedException', message: 'Invalid Access Token' };
    return {
      Username: account.sub,
      UserAttributes: [
        { Name: 'sub', Value: account.sub },
        { Name: 'email', Value: account.email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'given_name', Value: account.givenName },
        { Name: 'family_name', Value: account.familyName },
      ],
    };
  }

  /**
   * ONB-24: as Cognito answers with the app client's PreventUserExistenceErrors on: an unknown email gets the
   * same answer as a real one, and no code. An account whose first password is not set yet cannot reset.
   */
  private forgotPassword(body: Record<string, any>): unknown {
    const email = String(body['Username'] ?? '').toLowerCase();
    const account = this.accounts.get(email);
    if (account?.newPasswordRequired) throw COGNITO_ERRORS.cannotReset;
    if (account) this.codes.set(email, { code: String(randomInt(100000, 1000000)), expired: false });
    return { CodeDeliveryDetails: { Destination: maskEmail(email), DeliveryMedium: 'EMAIL', AttributeName: 'email' } };
  }

  /** ONB-24: an unknown email reads as a wrong code. A good change ends every refresh token the person had. */
  private confirmForgotPassword(body: Record<string, any>): unknown {
    const email = String(body['Username'] ?? '').toLowerCase();
    const account = this.accounts.get(email);
    const sent = this.codes.get(email);
    if (!account || !sent || String(body['ConfirmationCode'] ?? '') !== sent.code) throw COGNITO_ERRORS.codeMismatch;
    if (sent.expired) throw COGNITO_ERRORS.expiredCode;
    const password = String(body['Password'] ?? '');
    if (!meetsPolicy(password)) throw COGNITO_ERRORS.invalidPassword;
    this.codes.delete(email);
    this.resetPasswords.set(email, password);
    for (const [token, owner] of [...this.refreshTokens]) if (owner === email) this.refreshTokens.delete(token);
    return {};
  }

  /** The pool name the app signs in with (the part of its pool id after "_"), which SRP mixes in. */
  private pool(): string {
    if (this.poolName === null) {
      const file = join(__dirname, '..', '..', '..', 'src', 'environments', 'environment.ts');
      const m = /userPoolId\s*:\s*['"`]([^'"`]+)['"`]/.exec(existsSync(file) ? readFileSync(file, 'utf8') : '');
      this.poolName = (m?.[1] ?? '').split('_')[1] ?? '';
    }
    return this.poolName;
  }

  private tokens(account: FakeAccount & { sub: string }, clientId: string, withRefresh: boolean) {
    const now = Math.floor(Date.now() / 1000);
    const iss = 'https://cognito-idp.af-south-1.amazonaws.com/af-south-1_FakeOnb01';
    // ONB-23: like Cognito, a person in no group gets no cognito:groups claim at all.
    const groups = account.groups.length ? { 'cognito:groups': account.groups } : {};
    const common = { sub: account.sub, iss, ...groups, auth_time: now, iat: now, exp: now + 3600 };
    const idToken = jwt({
      ...common,
      aud: clientId,
      token_use: 'id',
      'cognito:username': account.sub,
      email: account.email,
      email_verified: true,
      given_name: account.givenName,
      family_name: account.familyName,
    });
    const accessToken = jwt({ ...common, client_id: clientId, token_use: 'access', scope: 'aws.cognito.signin.user.admin', username: account.sub });
    const result: Record<string, unknown> = { IdToken: idToken, AccessToken: accessToken, ExpiresIn: 3600, TokenType: 'Bearer' };
    if (withRefresh) {
      const refresh = randomBytes(48).toString('base64url');
      this.refreshTokens.set(refresh, account.email.toLowerCase());
      result['RefreshToken'] = refresh;
    }
    return result;
  }
}

function parse(request: Request): Record<string, any> {
  try {
    return JSON.parse(request.postData() ?? '{}');
  } catch {
    return {};
  }
}

function isCognitoError(e: unknown): e is CognitoError {
  return typeof e === 'object' && e !== null && 'type' in e && 'message' in e;
}

async function ok(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    headers: { ...CORS, 'content-type': 'application/x-amz-json-1.1', 'x-amzn-requestid': randomUUID() },
    body: JSON.stringify(body),
  });
}

async function fail(route: Route, error: CognitoError): Promise<void> {
  await route.fulfill({
    status: 400,
    headers: {
      ...CORS,
      'content-type': 'application/x-amz-json-1.1',
      'x-amzn-requestid': randomUUID(),
      'x-amzn-errortype': `${error.type}:`,
      'x-amzn-errormessage': error.message,
    },
    body: JSON.stringify({ __type: error.type, message: error.message }),
  });
}

function jwt(payload: Record<string, unknown>): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ kid: 'fake-onb-01', alg: 'RS256' })}.${part(payload)}.${randomBytes(32).toString('base64url')}`;
}

function decode(token: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- ONB-24: forgot password helpers

/** Like Cognito's masked destination, the same shape for any address. */
function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain.slice(0, 1)}***`;
}

/** The pool's rules: 12 to 256 characters, upper, lower, number and symbol. */
function meetsPolicy(p: string): boolean {
  return p.length >= 12 && p.length <= 256 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p);
}

// SRP-6a as Cognito runs it (the same numbers amazon-cognito-identity-js uses), for the server's half.
const N = BigInt(
  '0x' +
    'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DD' +
    'EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' +
    'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F' +
    '83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B' +
    'E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA0510' +
    '15728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7' +
    'ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6BF12FFA06D98A0864D87602733EC86A64521F2B18177B200C' +
    'BBE117577A615D6C770988C0BAD946E208E24FA074E5AB3143DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF',
);
const G = 2n;

function padHex(n: bigint): string {
  let h = n.toString(16);
  if (h.length % 2) h = '0' + h;
  return /^[89a-f]/i.test(h) ? '00' + h : h;
}
const sha256Hex = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hexHash = (hex: string) => sha256Hex(Buffer.from(hex, 'hex'));
const K = BigInt('0x' + hexHash(padHex(N) + padHex(G)));

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function srpX(poolName: string, userId: string, password: string, salt: string): bigint {
  return BigInt('0x' + hexHash(padHex(BigInt('0x' + salt)) + sha256Hex(`${poolName}${userId}:${password}`)));
}

/** The PASSWORD_CLAIM_SIGNATURE a client with the right password sends, or null when A is unusable. */
function srpSignature(poolName: string, userId: string, s: { b: bigint; B: bigint; v: bigint }, aHex: string, secretBlock: string, timestamp: string): string | null {
  if (!/^[0-9a-f]+$/i.test(aHex)) return null;
  const A = BigInt('0x' + aHex);
  if (A % N === 0n) return null;
  const u = BigInt('0x' + hexHash(padHex(A) + padHex(s.B)));
  const S = modPow((A * modPow(s.v, u, N)) % N, s.b, N);
  const prk = createHmac('sha256', Buffer.from(padHex(u), 'hex')).update(Buffer.from(padHex(S), 'hex')).digest();
  const key = createHmac('sha256', prk).update(Buffer.concat([Buffer.from('Caldera Derived Key', 'utf8'), Buffer.from([1])])).digest().subarray(0, 16);
  const message = Buffer.concat([Buffer.from(poolName, 'utf8'), Buffer.from(userId, 'utf8'), Buffer.from(secretBlock, 'base64'), Buffer.from(timestamp, 'utf8')]);
  return createHmac('sha256', key).update(message).digest('base64');
}
