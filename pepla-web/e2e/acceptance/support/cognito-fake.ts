import type { BrowserContext, Request, Route } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';

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

  constructor(accounts: FakeAccount[]) {
    for (const a of accounts) this.accounts.set(a.email.toLowerCase(), { ...a, sub: randomUUID() });
  }

  /** The next sign-in attempt fails with this Cognito error (default: wrong password). */
  rejectNextSignIn(error: CognitoError = COGNITO_ERRORS.wrongPassword): void {
    this.scripted.push(error);
  }

  /** Calls the app made to Cognito that try to sign someone in. */
  signInCalls(): CognitoCall[] {
    return this.calls.filter((c) => c.target === 'InitiateAuth' || c.target === 'RespondToAuthChallenge');
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

  private tokens(account: FakeAccount & { sub: string }, clientId: string, withRefresh: boolean) {
    const now = Math.floor(Date.now() / 1000);
    const iss = 'https://cognito-idp.af-south-1.amazonaws.com/af-south-1_FakeOnb01';
    const common = { sub: account.sub, iss, 'cognito:groups': account.groups, auth_time: now, iat: now, exp: now + 3600 };
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
