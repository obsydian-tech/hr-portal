import { Injectable, computed, signal } from '@angular/core';
import type { CognitoUser, CognitoUserSession } from 'amazon-cognito-identity-js';
import { environment } from '../../../environments/environment';
import { problemFor } from './auth.errors';
import { SignInProblem } from './auth.messages';

export interface SignedInUser {
  sub: string;
  email: string;
  givenName: string;
  familyName: string;
  fullName: string;
  groups: string[];
}

export type SignInResult = { ok: true; user: SignedInUser } | { ok: false; problem: SignInProblem };

/** The group that may use HR pages. */
export const HR_GROUP = 'hr_staff';

/**
 * Signing in and out, and who is signed in. The only place that talks to Cognito.
 * Uses amazon-cognito-identity-js (SRP sign-in) against the Naleko pool and the pepla-web app client.
 * Signing in is by work email and password only. A person outside hr_staff is signed out again
 * before this returns, so no token is kept for them.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  /** The library is loaded on first use, so it stays out of the first download. */
  private readonly library = import('amazon-cognito-identity-js').then((lib) => ({
    lib,
    pool: new lib.CognitoUserPool({ UserPoolId: environment.cognito.userPoolId, ClientId: environment.cognito.clientId }),
  }));
  private readonly current = signal<SignedInUser | null>(null);
  private restoring: Promise<void> | null = null;

  readonly user = this.current.asReadonly();
  readonly isHr = computed(() => this.current()?.groups.includes(HR_GROUP) ?? false);

  /** Resolves once a session left in this browser has been checked. Safe to call again and again. */
  restore(): Promise<void> {
    this.restoring ??= this.readSession().then(async (session) => {
      const user = session ? toUser(session) : null;
      if (user?.groups.includes(HR_GROUP)) this.current.set(user);
      else if (session) (await this.library).pool.getCurrentUser()?.signOut();
    });
    return this.restoring;
  }

  async signIn(email: string, password: string): Promise<SignInResult> {
    const { lib, pool } = await this.library;
    const cognitoUser = new lib.CognitoUser({ Username: email.trim(), Pool: pool });
    const outcome = await new Promise<{ session: CognitoUserSession } | { problem: SignInProblem }>((resolve) => {
      cognitoUser.authenticateUser(new lib.AuthenticationDetails({ Username: email.trim(), Password: password }), {
        onSuccess: (session) => resolve({ session }),
        onFailure: (error) => resolve({ problem: problemFor(error) }),
        newPasswordRequired: () => resolve({ problem: 'setPassword' }),
        mfaRequired: () => resolve({ problem: 'secondStep' }),
        totpRequired: () => resolve({ problem: 'secondStep' }),
        mfaSetup: () => resolve({ problem: 'secondStep' }),
        selectMFAType: () => resolve({ problem: 'secondStep' }),
        customChallenge: () => resolve({ problem: 'secondStep' }),
      });
    });
    if ('problem' in outcome) {
      this.forget(cognitoUser);
      return { ok: false, problem: outcome.problem };
    }
    const user = toUser(outcome.session);
    if (!user.groups.includes(HR_GROUP)) {
      this.forget(cognitoUser);
      return { ok: false, problem: 'notHr' };
    }
    this.restoring = Promise.resolve();
    this.current.set(user);
    return { ok: true, user };
  }

  /** Ends the session here and, as far as the network allows, in Cognito. */
  async signOut(): Promise<void> {
    const cognitoUser = (await this.library).pool.getCurrentUser();
    this.current.set(null);
    this.restoring = Promise.resolve();
    if (!cognitoUser) return;
    await new Promise<void>((resolve) => {
      cognitoUser.getSession((error: Error | null, session: CognitoUserSession | null) => {
        if (error || !session) return resolve();
        cognitoUser.globalSignOut({ onSuccess: () => resolve(), onFailure: () => resolve() });
      });
    });
    this.forget(cognitoUser);
  }

  private forget(cognitoUser: CognitoUser): void {
    cognitoUser.signOut();
  }

  private async readSession(): Promise<CognitoUserSession | null> {
    const cognitoUser = (await this.library).pool.getCurrentUser();
    if (!cognitoUser) return null;
    return new Promise((resolve) => {
      cognitoUser.getSession((error: Error | null, session: CognitoUserSession | null) => resolve(error || !session?.isValid() ? null : session));
    });
  }
}

function toUser(session: CognitoUserSession): SignedInUser {
  const claims = session.getIdToken().payload as Record<string, unknown>;
  const text = (key: string) => (typeof claims[key] === 'string' ? (claims[key] as string) : '');
  const groups = Array.isArray(claims['cognito:groups']) ? (claims['cognito:groups'] as unknown[]).filter((g): g is string => typeof g === 'string') : [];
  const givenName = text('given_name');
  const familyName = text('family_name');
  return {
    sub: text('sub'),
    email: text('email'),
    givenName,
    familyName,
    fullName: [givenName, familyName].filter(Boolean).join(' ') || text('email'),
    groups,
  };
}
