import { Injectable, computed, signal } from '@angular/core';
import type { CognitoUser, CognitoUserSession } from 'amazon-cognito-identity-js';
import { environment } from '../../../environments/environment';
import { problemFor } from './auth.errors';
import { ResetProblem, SignInProblem } from './auth.messages';

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
/** New employees (ONB-17). */
export const EMPLOYEE_GROUP = 'employee';
/** A company admin (CHAT-03). An account whose only group is admin may sign in, to reach the Admin screen. */
export const ADMIN_GROUP = 'admin';
/** The groups that may use the new app. The old TalentFlow admin groups are not among them. */
const APP_GROUPS: readonly string[] = [HR_GROUP, EMPLOYEE_GROUP, ADMIN_GROUP];
const mayUseApp = (user: SignedInUser | null): boolean => !!user && user.groups.some((g) => APP_GROUPS.includes(g));
/** Where the HR registration form keeps what HR has typed, for the tab. Any session end clears it (ONB-05). */
export const REGISTRATION_DRAFT_KEY = 'naleko.registration.draft';

/**
 * Signing in and out, and who is signed in. The only place that talks to Cognito.
 * Uses amazon-cognito-identity-js (SRP sign-in) against the Naleko pool and the pepla-web app client.
 * Signing in is by email and password only. A person in none of hr_staff, employee or admin is signed out
 * again before this returns, so no token is kept for them (ONB-23, CHAT-03).
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
  readonly isEmployee = computed(() => this.current()?.groups.includes(EMPLOYEE_GROUP) ?? false);

  /** Resolves once a session left in this browser has been checked. Safe to call again and again. */
  restore(): Promise<void> {
    this.restoring ??= this.readSession().then(async (session) => {
      const user = session ? toUser(session) : null;
      if (user && mayUseApp(user)) this.current.set(user);
      else if (session) {
        this.endSession();
        (await this.library).pool.getCurrentUser()?.signOut();
      }
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
    if (!mayUseApp(user)) {
      this.forget(cognitoUser);
      return { ok: false, problem: 'noAccess' };
    }
    this.restoring = Promise.resolve();
    this.current.set(user);
    return { ok: true, user };
  }

  /** ONB-17: signs a new employee in right after their password is set. Ends any session already here first. */
  async signInNewEmployee(email: string, password: string): Promise<boolean> {
    const { lib, pool } = await this.library;
    const existing = pool.getCurrentUser();
    if (existing) {
      this.endSession();
      existing.signOut();
    }
    const cognitoUser = new lib.CognitoUser({ Username: email.trim(), Pool: pool });
    const session = await new Promise<CognitoUserSession | null>((resolve) => {
      cognitoUser.authenticateUser(new lib.AuthenticationDetails({ Username: email.trim(), Password: password }), {
        onSuccess: (s) => resolve(s),
        onFailure: () => resolve(null),
        newPasswordRequired: () => resolve(null),
        mfaRequired: () => resolve(null),
        totpRequired: () => resolve(null),
        mfaSetup: () => resolve(null),
        selectMFAType: () => resolve(null),
        customChallenge: () => resolve(null),
      });
    });
    if (!session) {
      this.forget(cognitoUser);
      return false;
    }
    const user = toUser(session);
    if (!user.groups.includes(EMPLOYEE_GROUP)) {
      this.forget(cognitoUser);
      return false;
    }
    this.restoring = Promise.resolve();
    this.current.set(user);
    return true;
  }

  /**
   * ONB-24: asks Cognito to email a reset code. Any answer but no network or a limit counts as sent, so
   * the page reads the same whether or not the email has an account.
   */
  async requestPasswordReset(email: string): Promise<{ ok: true } | { ok: false; problem: ResetProblem }> {
    const { lib, pool } = await this.library;
    const cognitoUser = new lib.CognitoUser({ Username: email.trim(), Pool: pool });
    return new Promise((resolve) => {
      cognitoUser.forgotPassword({
        onSuccess: () => resolve({ ok: true }),
        inputVerificationCode: () => resolve({ ok: true }),
        onFailure: (error) => {
          const p = problemFor(error);
          if (p === 'offline' || p === 'tooMany') return resolve({ ok: false, problem: p });
          resolve({ ok: true });
        },
      });
    });
  }

  /** ONB-24: sets the new password with the emailed code. Returns a problem name, never Cognito's words. */
  async confirmPasswordReset(email: string, code: string, newPassword: string): Promise<{ ok: true } | { ok: false; problem: ResetProblem }> {
    const { lib, pool } = await this.library;
    const cognitoUser = new lib.CognitoUser({ Username: email.trim(), Pool: pool });
    return new Promise((resolve) => {
      cognitoUser.confirmPassword(code, newPassword, {
        onSuccess: () => resolve({ ok: true }),
        onFailure: (error: { code?: string; name?: string; message?: string }) => {
          const name = error?.code ?? error?.name ?? '';
          const p = problemFor(error);
          if (p === 'offline' || p === 'tooMany') return resolve({ ok: false, problem: p });
          if (name === 'CodeMismatchException') return resolve({ ok: false, problem: 'wrongCode' });
          if (name === 'ExpiredCodeException') return resolve({ ok: false, problem: 'expired' });
          if (name === 'InvalidPasswordException') return resolve({ ok: false, problem: 'badPassword' });
          resolve({ ok: false, problem: 'other' });
        },
      });
    });
  }

  /** The signed-in person's ID token, for calls to our own APIs. Null when nobody is signed in. */
  async idToken(): Promise<string | null> {
    const session = await this.readSession();
    return session ? session.getIdToken().getJwtToken() : null;
  }

  /** Ends the session here and, as far as the network allows, in Cognito. */
  async signOut(): Promise<void> {
    const cognitoUser = (await this.library).pool.getCurrentUser();
    this.endSession();
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

  /**
   * The one place a session ends here: nobody is signed in, and what HR had typed into the registration form
   * goes with it, so the next person on this tab never sees it (ONB-17 security note, ONB-05 AC-8).
   */
  private endSession(): void {
    this.current.set(null);
    try { sessionStorage.removeItem(REGISTRATION_DRAFT_KEY); } catch { /* storage may be off */ }
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
