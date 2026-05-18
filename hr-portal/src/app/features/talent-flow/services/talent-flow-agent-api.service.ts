import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, catchError, throwError } from 'rxjs';
import { environment } from '../../../../environments/environment';
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
 * Typed HttpClient calls to the TalentFlow Agent API (x-api-key auth).
 *
 * SECURITY TODO: The API key is currently read from environment.talentFlow.agentApiKey.
 * For production, this key MUST NOT ship in the JS bundle. Replace with a
 * backend config endpoint or Cognito custom claims before go-live. (FE-007)
 *
 * NOTE: chat() is intentionally non-streaming for FE-001.
 * When the AI chat panel component is built, upgrade to streaming
 * (EventSource / chunked HTTP) so the UI can render word-by-word.
 */
@Injectable({ providedIn: 'root' })
export class TalentFlowAgentApiService {
  private readonly http = inject(HttpClient);

  private get baseUrl(): string {
    return environment.talentFlow.agentApiUrl;
  }

  private get agentHeaders(): HttpHeaders {
    return new HttpHeaders({
      'Content-Type': 'application/json',
      'x-api-key': environment.talentFlow.agentApiKey,
    });
  }

  // ─── AI Chat ───────────────────────────────────────────────────────────────

  chat(message: string, context: ChatContext): Observable<ChatResponse> {
    return this.http
      .post<ChatResponse>(
        `${this.baseUrl}/chat`,
        { message, context },
        { headers: this.agentHeaders },
      )
      .pipe(catchError(this.handleError));
  }

  // ─── Pending Actions (HITL Gate) ───────────────────────────────────────────

  getPendingActions(): Observable<PendingAction[]> {
    return this.http
      .get<PendingAction[]>(`${this.baseUrl}/actions/pending`, {
        headers: this.agentHeaders,
      })
      .pipe(catchError(this.handleError));
  }

  approveAction(actionId: string): Observable<ApproveActionResponse> {
    return this.http
      .post<ApproveActionResponse>(
        `${this.baseUrl}/actions/${actionId}/approve`,
        {},
        { headers: this.agentHeaders },
      )
      .pipe(catchError(this.handleError));
  }

  rejectAction(actionId: string, reason: string): Observable<RejectActionResponse> {
    return this.http
      .post<RejectActionResponse>(
        `${this.baseUrl}/actions/${actionId}/reject`,
        { reason },
        { headers: this.agentHeaders },
      )
      .pipe(catchError(this.handleError));
  }

  // ─── Error Handling ────────────────────────────────────────────────────────

  private handleError(error: unknown): Observable<never> {
    const err = error as { status?: number; message?: string };
    let userMessage = 'An unexpected error occurred. Please try again.';

    if (err.status === 401) userMessage = 'Agent API key is invalid or expired.';
    else if (err.status === 403) userMessage = 'You do not have permission to perform this action.';
    else if (err.status === 404) userMessage = 'The requested action was not found or has expired.';
    else if (err.status && err.status >= 500) userMessage = 'Agent service error. Please try again later.';

    return throwError(() => ({ ...err, userMessage }));
  }
}
