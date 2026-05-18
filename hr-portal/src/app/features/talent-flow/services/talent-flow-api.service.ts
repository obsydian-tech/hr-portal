import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, catchError, from, switchMap, throwError } from 'rxjs';
import { environment } from '../../../../environments/environment';
// Pool consolidation (Epic 5): TF API Gateway authorizer now validates against
// the Naleko pool. Naleko AuthService token is used for all TF API calls.
import { AuthService } from '../../../core/services/auth.service';
import {
  Candidate,
  CreateCandidatePayload,
  ScheduleInterviewPayload,
  VotePayload,
  PipelineFilters,
  ConfigResponse,
  ConfigType,
} from '../models/talent-flow.models';

export interface PipelineResponse {
  candidates: Candidate[];
  nextToken?: string;
  total?: number;
}

@Injectable({ providedIn: 'root' })
export class TalentFlowApiService {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);

  private get baseUrl(): string {
    return environment.talentFlow.apiUrl;
  }

  /** Resolves the TF Cognito ID token then returns HttpHeaders with Bearer auth. */
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

  // Candidates

  getCandidates(filters?: PipelineFilters): Observable<PipelineResponse> {
    let params = new HttpParams();
    if (filters?.stage) params = params.set('stage', filters.stage);
    if (filters?.positionLevel) params = params.set('positionLevel', filters.positionLevel);
    if (filters?.slaStatus) params = params.set('slaStatus', filters.slaStatus);
    if (filters?.search) params = params.set('search', filters.search);
    if (filters?.limit) params = params.set('limit', String(filters.limit));
    if (filters?.nextToken) params = params.set('nextToken', filters.nextToken);

    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.get<PipelineResponse>(`${this.baseUrl}/candidates`, { headers, params }),
      ),
      catchError(this.handleError),
    );
  }

  getCandidate(id: string): Observable<Candidate> {
    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.get<Candidate>(`${this.baseUrl}/candidates/${id}`, { headers }),
      ),
      catchError(this.handleError),
    );
  }

  createCandidate(payload: CreateCandidatePayload): Observable<{ candidateId: string }> {
    // Lambda (createCandidate) requires: idempotencyKey, positionTitle (not role),
    // positionLevel, tenantId. Map frontend model to Lambda contract here.
    const body = {
      idempotencyKey:  crypto.randomUUID(),
      firstName:       payload.firstName,
      lastName:        payload.lastName,
      email:           payload.email,
      phone:           payload.phone,
      positionTitle:   payload.role,          // form field 'role' maps to Lambda 'positionTitle'
      positionLevel:   payload.positionLevel,
      experienceYears: payload.experienceYears,
      source:          payload.source,
      tenantId:        environment.talentFlow.tenantId,
    };
    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.post<{ candidateId: string }>(`${this.baseUrl}/candidates`, body, { headers }),
      ),
      catchError(this.handleError),
    );
  }

  // Interviews

  scheduleInterview(
    candidateId: string,
    payload: ScheduleInterviewPayload,
  ): Observable<{ interviewId: string }> {
    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.post<{ interviewId: string }>(
          `${this.baseUrl}/candidates/${candidateId}/interviews`,
          payload,
          { headers },
        ),
      ),
      catchError(this.handleError),
    );
  }

  // Votes

  submitVote(candidateId: string, payload: VotePayload): Observable<{ voteId: string }> {
    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.post<{ voteId: string }>(
          `${this.baseUrl}/candidates/${candidateId}/votes`,
          payload,
          { headers },
        ),
      ),
      catchError(this.handleError),
    );
  }

  // Config

  getConfig(configType: ConfigType, version?: string): Observable<ConfigResponse> {
    // Lambda expects: GET /v1/config?configType=X&active=true
    let params = new HttpParams().set('configType', configType).set('active', 'true');
    if (version) params = params.set('version', version);

    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.get<ConfigResponse>(`${this.baseUrl}/config`, { headers, params }),
      ),
      catchError(this.handleError),
    );
  }

  updateConfig(configType: ConfigType, data: unknown): Observable<ConfigResponse> {
    // Lambda expects: PUT /v1/config with { configType, data } in body
    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.put<ConfigResponse>(`${this.baseUrl}/config`, { configType, data }, { headers }),
      ),
      catchError(this.handleError),
    );
  }

  // Error Handling

  private handleError(error: unknown): Observable<never> {
    const err = error as { status?: number; message?: string };
    let userMessage = 'An unexpected error occurred. Please try again.';

    if (err.status === 401) userMessage = 'Your session has expired. Please sign in again.';
    else if (err.status === 403) userMessage = 'You do not have permission to perform this action.';
    else if (err.status === 404) userMessage = 'The requested resource was not found.';
    else if (err.status === 409) userMessage = 'A conflict occurred. This record may already exist.';
    else if (err.status && err.status >= 500)
      userMessage = 'A server error occurred. Please try again later.';

    return throwError(() => ({ ...err, userMessage }));
  }
}
