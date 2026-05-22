import { Injectable, computed, signal } from '@angular/core';
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession,
} from 'amazon-cognito-identity-js';
import { environment } from '../../../../environments/environment';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Authenticated user record for the TalentFlow Cognito pool.
 * Parallel to Naleko's AuthUser — completely independent.
 *
 * Groups map to TF pool groups:
 *   TalentFlowAdmin, HiringManager, PanelMember,
 *   ComplianceOfficer, ITAdmin, FinanceLead, HRDirector
 */
export interface TalentFlowUser {
  email: string;
  givenName: string;
  familyName: string;
  fullName: string;
  /** True when the user belongs to TalentFlowAdmin group (custom:isAdmin = "true" claim). */
  isAdmin: boolean;
  /** All Cognito groups the user belongs to in the TF pool. */
  groups: string[];
}

export type TalentFlowAuthResult =
  | { status: 'SUCCESS'; user: TalentFlowUser }
  | { status: 'NEW_PASSWORD_REQUIRED' }
  | { status: 'ERROR'; message: string };

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * TalentFlowAuthService
 *
 * Self-contained auth service for the TalentFlow Angular feature module.
 * Owns a dedicated CognitoUserPool instance pointing to the TalentFlow
 * Cognito pool (talent-flow-user-pool) — completely separate from the
 * Naleko HR Portal pool used by AuthService.
 *
 * WHY THIS EXISTS (Lesson 18 / §5.6):
 * The TalentFlow API Gateway HTTP authorizer validates JWTs against the
 * TF pool issuer exclusively. Naleko pool tokens are rejected with 401.
 * The custom:isAdmin claim is only injected by the TF Pre-Token Lambda.
 * This service must be the ONLY auth provider for all TalentFlow API calls.
 *
 * TODO (FE-006): Change providedIn to null and provide in talent-flow.routes.ts
 * for full module isolation. Using 'root' for now to unblock FE-002 through FE-005.
 */
@Injectable({ providedIn: 'root' })
export class TalentFlowAuthService {
  private readonly userPool: CognitoUserPool;
  private cognitoUser: CognitoUser | null = null;

  // ── Reactive state ─────────────────────────────────────────────────────────
  readonly isAuthenticated = signal(false);
  readonly currentUser = signal<TalentFlowUser | null>(null);
  readonly isLoading = signal(true);

  // ── Computed helpers ───────────────────────────────────────────────────────

  /** True when the user belongs to TalentFlowAdmin group (admin config access). */
  readonly isAdmin = computed(() => this.currentUser()?.isAdmin ?? false);

  /** True when the user can create/manage candidates (HiringManager or admin). */
  readonly isHiringManager = computed(
    () => this.hasGroup('HiringManager') || this.isAdmin(),
  );

  /** True when the user can submit evaluation votes. */
  readonly isPanelMember = computed(() => this.hasGroup('PanelMember'));

  /** True when the user has read-only compliance+audit access. */
  readonly isComplianceOfficer = computed(() => this.hasGroup('ComplianceOfficer'));

  /**
   * Returns true if the authenticated user belongs to the given TF Cognito group.
   * Groups: TalentFlowAdmin | HiringManager | PanelMember | ComplianceOfficer |
   *         ITAdmin | FinanceLead | HRDirector
   */
  readonly hasGroup = (group: string): boolean =>
    (this.currentUser()?.groups ?? []).includes(group);

  constructor() {
    this.userPool = new CognitoUserPool({
      UserPoolId: environment.talentFlow.cognitoConfig.userPoolId,
      ClientId: environment.talentFlow.cognitoConfig.clientId,
    });
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Authenticate a TalentFlow HR staff member with email + password.
   * Uses SRP (ALLOW_USER_SRP_AUTH) — same SDK pattern as Naleko AuthService.
   */
  async login(email: string, password: string): Promise<TalentFlowAuthResult> {
    return new Promise((resolve) => {
      const authDetails = new AuthenticationDetails({
        Username: email.trim(),
        Password: password,
      });

      this.cognitoUser = new CognitoUser({
        Username: email.trim(),
        Pool: this.userPool,
      });

      this.cognitoUser.authenticateUser(authDetails, {
        onSuccess: (session: CognitoUserSession) => {
          const user = this.extractUserFromSession(session);
          this.isAuthenticated.set(true);
          this.currentUser.set(user);
          resolve({ status: 'SUCCESS', user });
        },
        onFailure: (err: any) => {
          resolve({ status: 'ERROR', message: this.mapCognitoError(err) });
        },
        newPasswordRequired: () => {
          resolve({ status: 'NEW_PASSWORD_REQUIRED' });
        },
      });
    });
  }

  /**
   * Complete a NEW_PASSWORD_REQUIRED challenge (first-time TF user login).
   */
  completeNewPassword(newPassword: string): Promise<TalentFlowAuthResult> {
    return new Promise((resolve) => {
      if (!this.cognitoUser) {
        resolve({ status: 'ERROR', message: 'No pending authentication session.' });
        return;
      }

      this.cognitoUser.completeNewPasswordChallenge(
        newPassword,
        {},
        {
          onSuccess: (session: CognitoUserSession) => {
            const user = this.extractUserFromSession(session);
            this.isAuthenticated.set(true);
            this.currentUser.set(user);
            resolve({ status: 'SUCCESS', user });
          },
          onFailure: (err: any) => {
            resolve({ status: 'ERROR', message: this.mapCognitoError(err) });
          },
        },
      );
    });
  }

  /**
   * Sign out from the TalentFlow Cognito session.
   */
  logout(): void {
    const current = this.userPool.getCurrentUser();
    if (current) current.signOut();
    this.isAuthenticated.set(false);
    this.currentUser.set(null);
    this.cognitoUser = null;
  }

  /**
   * Get the current valid TF ID token string (auto-refreshes via refresh token).
   * Returns null if not authenticated or session is invalid.
   * Used by TalentFlowApiService.authHeaders() — must NOT be replaced with
   * AuthService.getIdToken() (which uses the Naleko pool).
   */
  getIdToken(): Promise<string | null> {
    return new Promise((resolve) => {
      const current = this.userPool.getCurrentUser();
      if (!current) {
        resolve(null);
        return;
      }
      current.getSession((err: any, session: CognitoUserSession | null) => {
        if (err || !session?.isValid()) {
          resolve(null);
          return;
        }
        resolve(session.getIdToken().getJwtToken());
      });
    });
  }

  /**
   * Check for a persisted TalentFlow session (e.g. app init, route guard).
   * Call from APP_INITIALIZER or route resolver to restore session on page reload.
   */
  checkSession(): Promise<void> {
    return new Promise((resolve) => {
      const current = this.userPool.getCurrentUser();
      if (!current) {
        this.isLoading.set(false);
        resolve();
        return;
      }

      current.getSession((err: any, session: CognitoUserSession | null) => {
        if (!err && session?.isValid()) {
          const user = this.extractUserFromSession(session);
          this.isAuthenticated.set(true);
          this.currentUser.set(user);
        }
        this.isLoading.set(false);
        resolve();
      });
    });
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private extractUserFromSession(session: CognitoUserSession): TalentFlowUser {
    const payload = session.getIdToken().decodePayload();
    const givenName = payload['given_name'] ?? '';
    const familyName = payload['family_name'] ?? '';
    const groups: string[] = payload['cognito:groups'] ?? [];

    return {
      email: payload['email'] ?? '',
      givenName,
      familyName,
      fullName: `${givenName} ${familyName}`.trim(),
      // custom:isAdmin is injected by talentFlowPreTokenTrigger Lambda for
      // TalentFlowAdmin group members. Only present in TF pool JWTs.
      isAdmin: payload['custom:isAdmin'] === 'true',
      groups,
    };
  }

  private mapCognitoError(err: any): string {
    switch (err.code || err.name) {
      case 'NotAuthorizedException':
        return 'Incorrect email or password.';
      case 'UserNotFoundException':
        return 'No account found with this email.';
      case 'UserNotConfirmedException':
        return 'Your account has not been verified yet.';
      case 'PasswordResetRequiredException':
        return 'You need to reset your password. Please contact your administrator.';
      case 'InvalidPasswordException':
        return 'Password does not meet requirements: minimum 12 characters, uppercase, lowercase, number, and special character.';
      case 'LimitExceededException':
        return 'Too many attempts. Please try again later.';
      default:
        return err.message || 'An unexpected error occurred. Please try again.';
    }
  }
}
