import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, catchError, from, switchMap, throwError, timeout } from 'rxjs';
import { environment } from '../../../../environments/environment';
// Pool consolidation (Epic 5): TF API Gateway authorizer validates against
// the Naleko pool. Same AuthService token used for all admin API calls.
import { AuthService } from '../../../core/services/auth.service';
import {
  AdminDashboardResponse,
  AdminUser,
  AdminUsersFilters,
  AdminUsersResponse,
  CreateUserPayload,
  DeactivateUserResponse,
  UpdateUserRolesPayload,
  TenantProfile,
  UpdateTenantProfileRequest,
} from '../models/admin.models';

const API_TIMEOUT_MS = 15_000;

@Injectable({ providedIn: 'root' })
export class AdminApiService {
  private readonly http        = inject(HttpClient);
  private readonly authService = inject(AuthService);

  private get baseUrl(): string {
    return environment.talentFlow.apiUrl;
  }

  private authHeaders(): Observable<HttpHeaders> {
    return from(this.authService.getIdToken()).pipe(
      switchMap((token) => {
        const headers = new HttpHeaders({
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        });
        return [headers];
      }),
    );
  }

  // ── Dashboard ───────────────────────────────────────────────────────────────

  getDashboard(): Observable<AdminDashboardResponse> {
    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.get<AdminDashboardResponse>(
          `${this.baseUrl}/admin/dashboard`,
          { headers },
        ),
      ),
      timeout(API_TIMEOUT_MS),
      catchError(this.handleError),
    );
  }

  // ── Users & Roles ───────────────────────────────────────────────────────────

  getUsers(filters?: AdminUsersFilters): Observable<AdminUsersResponse> {
    let params = new HttpParams();
    if (filters?.status)    params = params.set('status',    filters.status);
    if (filters?.search)    params = params.set('search',    filters.search);
    if (filters?.limit)     params = params.set('limit',     String(filters.limit));
    if (filters?.nextToken) params = params.set('nextToken', filters.nextToken);

    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.get<AdminUsersResponse>(
          `${this.baseUrl}/admin/users`,
          { headers, params },
        ),
      ),
      timeout(API_TIMEOUT_MS),
      catchError(this.handleError),
    );
  }

  createUser(
    payload: CreateUserPayload,
  ): Observable<{ user: AdminUser; warnings?: string }> {
    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.post<{ user: AdminUser; warnings?: string }>(
          `${this.baseUrl}/admin/users`,
          payload,
          { headers },
        ),
      ),
      timeout(API_TIMEOUT_MS),
      catchError(this.handleError),
    );
  }

  updateUserRoles(
    userId: string,
    payload: UpdateUserRolesPayload,
  ): Observable<{ user: AdminUser }> {
    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.put<{ user: AdminUser }>(
          `${this.baseUrl}/admin/users/${userId}`,
          payload,
          { headers },
        ),
      ),
      timeout(API_TIMEOUT_MS),
      catchError(this.handleError),
    );
  }

  // ── Tenant Profile ─────────────────────────────────────────────────────────

  getTenantProfile(): Observable<TenantProfile> {
    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.get<TenantProfile>(`${this.baseUrl}/admin/tenant/profile`, { headers }),
      ),
      timeout(API_TIMEOUT_MS),
      catchError(this.handleError),
    );
  }

  updateTenantProfile(request: UpdateTenantProfileRequest): Observable<TenantProfile> {
    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.put<TenantProfile>(`${this.baseUrl}/admin/tenant/profile`, request, { headers }),
      ),
      timeout(API_TIMEOUT_MS),
      catchError(this.handleError),
    );
  }

  uploadTenantLogo(file: File): Observable<{ logoUrl: string }> {
    const formData = new FormData();
    formData.append('logo', file);
    return this.authHeaders().pipe(
      switchMap((headers) => {
        const uploadHeaders = new HttpHeaders({ Authorization: headers.get('Authorization') ?? '' });
        return this.http.post<{ logoUrl: string }>(`${this.baseUrl}/admin/tenant/logo`, formData, { headers: uploadHeaders });
      }),
      timeout(API_TIMEOUT_MS),
      catchError(this.handleError),
    );
  }

  // ── Users ─────────────────────────────────────────────────────────────────

  deactivateUser(userId: string): Observable<DeactivateUserResponse> {
    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.delete<DeactivateUserResponse>(
          `${this.baseUrl}/admin/users/${userId}`,
          { headers },
        ),
      ),
      timeout(API_TIMEOUT_MS),
      catchError(this.handleError),
    );
  }

  // ── Error Handling ──────────────────────────────────────────────────────────

  private handleError(error: unknown): Observable<never> {
    const err = error as { status?: number; message?: string; name?: string };
    let userMessage = 'An unexpected error occurred. Please try again.';

    if (err.name === 'TimeoutError')   userMessage = 'Request timed out. Please check your connection and try again.';
    else if (err.status === 401) userMessage = 'Your session has expired. Please sign in again.';
    else if (err.status === 403) userMessage = 'You do not have permission to perform this action.';
    else if (err.status === 404) userMessage = 'The requested resource was not found.';
    else if (err.status === 409) userMessage = 'A conflict occurred. This record may already exist.';
    else if (err.status && err.status >= 500)
      userMessage = 'A server error occurred. Please try again later.';

    return throwError(() => ({ ...err, userMessage }));
  }
}
