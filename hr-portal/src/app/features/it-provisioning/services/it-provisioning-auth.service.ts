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
 * Authenticated IT Specialist user record.
 * Completely independent of Naleko + TalentFlow pools.
 *
 * Groups in IT pool: ITSpecialist, ITAdmin, ITManager
 * assignedQueues drives which queue tabs appear in the Queue View.
 */
export interface ItUser {
  sub: string;
  email: string;
  givenName: string;
  familyName: string;
  fullName: string;
  groups: string[];
  /** Queues assigned by System Admin — specialist cannot pick up tasks outside these. */
  assignedQueues: string[];
}

export type ItAuthResult =
  | { status: 'SUCCESS'; user: ItUser }
  | { status: 'NEW_PASSWORD_REQUIRED' }
  | { status: 'ERROR'; message: string };

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * ItProvisioningAuthService
 *
 * Self-contained auth service for the IT Provisioning Angular feature module.
 * Owns a dedicated CognitoUserPool instance pointing to the IT Provisioning
 * Cognito pool — completely separate from the Naleko pool (AuthService) and
 * the TalentFlow pool (TalentFlowAuthService).
 *
 * Pattern: mirrors TalentFlowAuthService exactly (Lesson 18 / §5.6).
 *
 * NOTE: configure environment.itProvisioning.cognitoConfig.userPoolId + clientId
 * once Terraform provisions `it-provisioning-user-pool`. Currently PLACEHOLDER values.
 */
@Injectable({ providedIn: 'root' })
export class ItProvisioningAuthService {
  private readonly userPool: CognitoUserPool;
  private cognitoUser: CognitoUser | null = null;

  readonly isAuthenticated = signal<boolean>(false);
  readonly currentUser     = signal<ItUser | null>(null);
  readonly isLoading       = signal<boolean>(true);

  readonly isAdmin   = computed(() => this.hasGroup('ITAdmin'));
  readonly isManager = computed(() => this.hasGroup('ITManager'));

  hasGroup(group: string): boolean {
    return this.currentUser()?.groups.includes(group) ?? false;
  }

  constructor() {
    this.userPool = new CognitoUserPool({
      UserPoolId: environment.itProvisioning.cognitoConfig.userPoolId,
      ClientId:   environment.itProvisioning.cognitoConfig.clientId,
    });
  }

  // ─── Auth methods (exact mirror of TalentFlowAuthService) ─────────────────

  login(email: string, password: string): Promise<ItAuthResult> {
    return new Promise((resolve) => {
      const authDetails = new AuthenticationDetails({
        Username: email,
        Password: password,
      });
      this.cognitoUser = new CognitoUser({
        Username: email,
        Pool:     this.userPool,
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

  completeNewPassword(newPassword: string): Promise<ItAuthResult> {
    return new Promise((resolve) => {
      if (!this.cognitoUser) {
        resolve({ status: 'ERROR', message: 'No pending authentication session.' });
        return;
      }
      this.cognitoUser.completeNewPasswordChallenge(newPassword, {}, {
        onSuccess: (session: CognitoUserSession) => {
          const user = this.extractUserFromSession(session);
          this.isAuthenticated.set(true);
          this.currentUser.set(user);
          resolve({ status: 'SUCCESS', user });
        },
        onFailure: (err: any) => {
          resolve({ status: 'ERROR', message: this.mapCognitoError(err) });
        },
      });
    });
  }

  logout(): void {
    const current = this.userPool.getCurrentUser();
    if (current) current.signOut();
    this.isAuthenticated.set(false);
    this.currentUser.set(null);
    this.cognitoUser = null;
  }

  getIdToken(): Promise<string | null> {
    return new Promise((resolve) => {
      const current = this.userPool.getCurrentUser();
      if (!current) { resolve(null); return; }
      current.getSession((err: any, session: CognitoUserSession | null) => {
        if (err || !session?.isValid()) { resolve(null); return; }
        resolve(session.getIdToken().getJwtToken());
      });
    });
  }

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

  private extractUserFromSession(session: CognitoUserSession): ItUser {
    const payload = session.getIdToken().decodePayload();
    const givenName  = payload['given_name']  ?? '';
    const familyName = payload['family_name'] ?? '';
    const groups: string[] = payload['cognito:groups'] ?? [];
    // custom:assignedQueues is a comma-separated string injected by a pre-token Lambda
    const rawQueues: string = payload['custom:assignedQueues'] ?? '';
    const assignedQueues = rawQueues
      ? rawQueues.split(',').map((q: string) => q.trim()).filter(Boolean)
      : ['Hardware', 'Access & Identity', 'Software', 'Facilities'];

    return {
      sub: payload['sub'] ?? '',
      email: payload['email'] ?? '',
      givenName,
      familyName,
      fullName: `${givenName} ${familyName}`.trim(),
      groups,
      assignedQueues,
    };
  }

  private mapCognitoError(err: any): string {
    switch (err.code || err.name) {
      case 'NotAuthorizedException':      return 'Incorrect email or password.';
      case 'UserNotFoundException':       return 'No account found with this email.';
      case 'UserNotConfirmedException':   return 'Your account has not been verified yet.';
      case 'PasswordResetRequiredException': return 'You need to reset your password.';
      case 'InvalidPasswordException':    return 'Password does not meet requirements.';
      case 'LimitExceededException':      return 'Too many attempts. Please try again later.';
      default: return err.message || 'An unexpected error occurred. Please try again.';
    }
  }
}
