import { Injectable, signal, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession,
} from 'amazon-cognito-identity-js';
import { environment } from '../../../environments/environment';
import { getHrStaffById } from '../../shared/constants/hr-staff';
import { firstValueFrom } from 'rxjs';

// ─── Types ───────────────────────────────────────────────

export interface AuthUser {
  email: string;
  givenName: string;
  familyName: string;
  fullName: string;
  staffId: string;
  employeeId: string;
  role: 'hr_staff' | 'employee';
  groups: string[];
}

export type AuthResult =
  | { status: 'SUCCESS'; user: AuthUser }
  | { status: 'NEW_PASSWORD_REQUIRED' }
  | { status: 'ERROR'; message: string };

// ─── Service ─────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly userPool: CognitoUserPool;
  private cognitoUser: CognitoUser | null = null;

  // ── Reactive state ──
  readonly isAuthenticated = signal(false);
  readonly currentUser = signal<AuthUser | null>(null);
  readonly isLoading = signal(true);

  // ── Computed helpers ──
  readonly isHrStaff = computed(() => this.currentUser()?.role === 'hr_staff');
  readonly isEmployee = computed(() => this.currentUser()?.role === 'employee');
  readonly staffId = computed(() => this.currentUser()?.staffId ?? '');
  readonly employeeId = computed(() => this.currentUser()?.employeeId ?? '');
  readonly displayName = computed(() => this.currentUser()?.fullName ?? '');

  constructor() {
    this.userPool = new CognitoUserPool({
      UserPoolId: environment.cognito.userPoolId,
      ClientId: environment.cognito.clientId,
    });
    // Session check is triggered by APP_INITIALIZER, not here
  }

  // ─── Public API ────────────────────────────────────────

  /**
   * Resolve login input to an email address.
   * - AS##### → local HR staff registry lookup
   * - EMP-####### → backend API lookup
   * - Otherwise treated as email
   */
  private async resolveUsername(input: string): Promise<string> {
    const trimmed = input.trim();

    // HR Staff ID (local lookup)
    if (/^AS\d{5}$/i.test(trimmed)) {
      const staff = getHrStaffById(trimmed.toUpperCase());
      if (staff) return staff.email;
      throw new Error('Staff ID not found. Please check your AS number.');
    }

    // Employee ID (API lookup)
    if (/^EMP-\d{7}$/i.test(trimmed)) {
      try {
        const resp = await firstValueFrom(
          this.http.get<{ email: string }>(
            `${environment.employeesApiUrl}/v1/employees/lookup`,
            { params: { employeeId: trimmed.toUpperCase() } }
          )
        );
        if (resp?.email) return resp.email;
        throw new Error('Employee not found.');
      } catch (err: any) {
        if (err?.status === 404) {
          throw new Error('Employee ID not found. Please check your EMP number.');
        }
        throw new Error(err?.message || 'Failed to look up employee. Please try again.');
      }
    }

    return trimmed; // Treat as email
  }

  /**
   * Authenticate user with Cognito.
   * Accepts email, HR staff ID (AS#####), or employee ID (EMP-#######).
   */
  async login(usernameInput: string, password: string): Promise<AuthResult> {
    let email: string;
    try {
      email = await this.resolveUsername(usernameInput);
    } catch (err: any) {
      return { status: 'ERROR', message: err.message };
    }

    return new Promise((resolve) => {
      const authDetails = new AuthenticationDetails({
        Username: email,
        Password: password,
      });

      this.cognitoUser = new CognitoUser({
        Username: email,
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
   * Complete the NEW_PASSWORD_REQUIRED challenge (first-time login).
   */
  completeNewPassword(newPassword: string): Promise<AuthResult> {
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
        }
      );
    });
  }

  /**
   * Sign out and redirect to login page.
   */
  logout(): void {
    const currentUser = this.userPool.getCurrentUser();
    if (currentUser) {
      currentUser.signOut();
    }
    this.isAuthenticated.set(false);
    this.currentUser.set(null);
    this.cognitoUser = null;
    this.router.navigate(['/login']);
  }

  /**
   * Get the current valid ID token string.
   * Auto-refreshes using the refresh token if expired.
   * Returns null if not authenticated.
   */
  getIdToken(): Promise<string | null> {
    return new Promise((resolve) => {
      const currentUser = this.userPool.getCurrentUser();
      if (!currentUser) {
        resolve(null);
        return;
      }
      currentUser.getSession((err: any, session: CognitoUserSession | null) => {
        if (err || !session?.isValid()) {
          resolve(null);
          return;
        }
        resolve(session.getIdToken().getJwtToken());
      });
    });
  }

  /**
   * Check for a persisted session on app startup.
   * Called by APP_INITIALIZER before routing begins.
   */
  checkSession(): Promise<void> {
    return new Promise((resolve) => {
      const currentUser = this.userPool.getCurrentUser();
      if (!currentUser) {
        this.isLoading.set(false);
        resolve();
        return;
      }

      currentUser.getSession((err: any, session: CognitoUserSession | null) => {
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

  // ─── Internals ─────────────────────────────────────────

  private extractUserFromSession(session: CognitoUserSession): AuthUser {
    const payload = session.getIdToken().decodePayload();
    const givenName = payload['given_name'] ?? '';
    const familyName = payload['family_name'] ?? '';

    return {
      email: payload['email'] ?? '',
      givenName,
      familyName,
      fullName: `${givenName} ${familyName}`.trim(),
      staffId: payload['custom:staff_id'] ?? '',
      employeeId: payload['custom:employee_id'] ?? '',
      role: payload['custom:role'] ?? 'employee',
      groups: payload['cognito:groups'] ?? [],
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
        return 'You need to reset your password. Please contact HR.';
      case 'InvalidPasswordException':
        return 'Password does not meet requirements: minimum 12 characters, uppercase, lowercase, number, and special character.';
      case 'LimitExceededException':
        return 'Too many attempts. Please try again later.';
      default:
        return err.message || 'An unexpected error occurred. Please try again.';
    }
  }
}
