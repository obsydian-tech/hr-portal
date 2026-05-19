import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, catchError, from, switchMap, throwError } from 'rxjs';
import { environment } from '../../../../environments/environment';
// Pool consolidation (Epic 5): Agent API uses Cognito JWT auth (naleko-agent-api HTTP API v2).
// Same token pattern as TalentFlowApiService — avoids shipping API keys in the JS bundle.
import { AuthService } from '../../../core/services/auth.service';
import {
  ChatContext,
  ChatResponse,
  PendingAction,
  ApproveActionResponse,
  RejectActionResponse,
} from '../models/talent-flow.models';

/**
 * TalentFlowAgentApiService
 *
 * Typed HttpClient calls to the naleko-agent-api (HTTP API v2, JWT auth).
 * Base URL: environment.talentFlow.agentApiUrl  (e.g. https://fou21cj8tj…)
 * All routes are under /agent/v1/
 *
 * NOTE: chat() is intentionally non-streaming for FE-001.
 * Upgrade to EventSource / chunked HTTP in a future iteration.
 */
@Injectable({ providedIn: 'root' })
export class TalentFlowAgentApiService {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);

  private get baseUrl(): string {
    return environment.talentFlow.agentApiUrl;
  }

  /** Resolves the Cognito ID token then returns HttpHeaders with Bearer auth. */
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

  // ─── AI Chat ───────────────────────────────────────────────────────────────

  chat(message: string, context: ChatContext): Observable<ChatResponse> {
    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.post<ChatResponse>(
          `${this.baseUrl}/agent/v1/ai-chat`,
          { message, context },
          { headers },
        ),
      ),
      catchError(this.handleError),
    );
  }

  // ─── Pending Actions (HITL Gate) ───────────────────────────────────────────

  getPendingActions(): Observable<PendingAction[]> {
    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.get<PendingAction[]>(`${this.baseUrl}/agent/v1/actions/pending`, { headers }),
      ),
      catchError(this.handleError),
    );
  }

  approveAction(actionId: string): Observable<ApproveActionResponse> {
    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.post<ApproveActionResponse>(
          `${this.baseUrl}/agent/v1/actions/${actionId}/approve`,
          {},
          { headers },
        ),
      ),
      catchError(this.handleError),
    );
  }

  rejectAction(actionId: string, reason: string): Observable<RejectActionResponse> {
    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.post<RejectActionResponse>(
          `${this.baseUrl}/agent/v1/actions/${actionId}/reject`,
          { reason },
          { headers },
        ),
      ),
      catchError(this.handleError),
    );
  }

  // ─── Error Handling ────────────────────────────────────────────────────────

  private handleError(error: unknown): Observable<never> {
    const err = error as { status?: number; message?: string };
    let userMessage = 'An unexpected error occurred. Please try again.';

    if (err.status === 401) userMessage = 'Session expired. Please log in again.';
    else if (err.status === 403) userMessage = 'You do not have permission to perform this action.';
    else if (err.status === 404) userMessage = 'The requested action was not found or has expired.';
    else if (err.status && err.status >= 500) userMessage = 'Agent service error. Please try again later.';

    return throwError(() => ({ ...err, userMessage }));
  }
}
