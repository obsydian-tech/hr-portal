import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, catchError, from, switchMap, throwError, timeout } from 'rxjs';
import { environment } from '../../../../environments/environment';
// Pool consolidation (Epic 5): TF API Gateway authorizer now validates against
// the Naleko pool. Naleko AuthService token is used for all TF API calls.
import { AuthService } from '../../../core/services/auth.service';
import {
  AddPanelMembersPayload,
  Candidate,
  CandidateEventsResponse,
  CreateCandidatePayload,
  UpdateCandidatePayload,
  EngagementSentiment,
  HiringStage,
  InteractionOutcome,
  InteractionType,
  Offer,
  PanelMember,
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

const API_TIMEOUT_MS = 15_000;

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
    // Always pass tenantId — Lambda derives tenant scope from this query param
    // (custom:tenantId JWT claim was TF-pool-only; no longer reliable post pool consolidation)
    let params = new HttpParams().set('tenantId', environment.talentFlow.tenantId);
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
      timeout(API_TIMEOUT_MS),
      catchError(this.handleError),
    );
  }

  getCandidate(id: string): Observable<Candidate> {
    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.get<Candidate>(`${this.baseUrl}/candidates/${id}`, { headers }),
      ),
      timeout(API_TIMEOUT_MS),
      catchError(this.handleError),
    );
  }

  /** FE-006: Full event timeline for a candidate from the audit stream table */
  getCandidateEvents(
    id: string,
    opts?: { limit?: number; nextToken?: string; since?: string },
  ): Observable<CandidateEventsResponse> {
    let params = new HttpParams();
    if (opts?.limit)     params = params.set('limit',     String(opts.limit));
    if (opts?.nextToken) params = params.set('nextToken', opts.nextToken);
    if (opts?.since)     params = params.set('since',     opts.since);
    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.get<CandidateEventsResponse>(
          `${this.baseUrl}/candidates/${id}/events`,
          { headers, params },
        ),
      ),
      timeout(API_TIMEOUT_MS),
      catchError(this.handleError),
    );
  }

  updateCandidate(
    id: string,
    payload: UpdateCandidatePayload,
  ): Observable<{ candidateId: string; updatedFields: string[]; updatedAt: string }> {
    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.patch<{ candidateId: string; updatedFields: string[]; updatedAt: string }>(
          `${this.baseUrl}/candidates/${id}`,
          payload,
          { headers },
        ),
      ),
      timeout(API_TIMEOUT_MS),
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
      timeout(API_TIMEOUT_MS),
      catchError(this.handleError),
    );
  }

  // Panel Members (D005/D041)

  getPanelMembers(): Observable<PanelMember[]> {
    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.get<{ members: PanelMember[]; total: number }>(
          `${this.baseUrl}/panel-members`,
          { headers },
        ),
      ),
      switchMap((res) => [res.members ?? []]),
      timeout(API_TIMEOUT_MS),
      catchError(this.handleError),
    );
  }

  // Interviews

  scheduleInterview(
    candidateId: string,
    payload: ScheduleInterviewPayload,
  ): Observable<{ interviewId: string }> {
    // Lambda requires interviewId (idempotency key), tenantId, and candidateId in body
    const body = {
      ...payload,
      interviewId: crypto.randomUUID(),
      tenantId: environment.talentFlow.tenantId,
      candidateId,
    };
    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.post<{ interviewId: string }>(
          `${this.baseUrl}/candidates/${candidateId}/interviews`,
          body,
          { headers },
        ),
      ),
      timeout(API_TIMEOUT_MS),
      catchError(this.handleError),
    );
  }

  addPanelMembers(
    candidateId: string,
    interviewId: string,
    payload: AddPanelMembersPayload,
  ): Observable<{ interviewId: string; panelMemberIds: string[]; adhocPanelMembers?: unknown[] }> {
    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.patch<{ interviewId: string; panelMemberIds: string[]; adhocPanelMembers?: unknown[] }>(
          `${this.baseUrl}/candidates/${candidateId}/interviews/${interviewId}`,
          payload,
          { headers },
        ),
      ),
      timeout(API_TIMEOUT_MS),
      catchError(this.handleError),
    );
  }

  // Votes

  submitVote(candidateId: string, payload: VotePayload): Observable<{ voteId: string }> {
    // VotePayload.decision now matches Lambda VALID_RATINGS directly (D050: STRONG_NO | NO | YES | STRONG_YES)
    const body = {
      candidateId,
      tenantId: environment.talentFlow.tenantId,
      voterId: this.authService.currentUser()?.email ?? 'unknown',
      scores: payload.scores,
      rating: payload.decision,
      notes: payload.notes,
    };
    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.post<{ voteId: string }>(
          `${this.baseUrl}/candidates/${candidateId}/votes`,
          body,
          { headers },
        ),
      ),
      timeout(API_TIMEOUT_MS),
      catchError(this.handleError),
    );
  }

  // Sentiment

  captureSentiment(
    candidateId: string,
    sentiment: EngagementSentiment,
  ): Observable<{ candidateId: string; interviewSentiment: string; capturedAt: string }> {
    const body = { interviewSentiment: sentiment, tenantId: environment.talentFlow.tenantId };
    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.post<{ candidateId: string; interviewSentiment: string; capturedAt: string }>(
          `${this.baseUrl}/candidates/${candidateId}/sentiment`,
          body,
          { headers },
        ),
      ),
      timeout(API_TIMEOUT_MS),
      catchError(this.handleError),
    );
  }

  // Stage Advancement

  /** Ordered stages used for forward-only validation (mirrors Lambda STAGE_ORDER) */
  static readonly STAGE_ORDER: HiringStage[] = [
    'APPLICATION_REVIEW', 'PHONE_SCREENING', 'TECHNICAL_INTERVIEW',
    'PANEL_INTERVIEW', 'EVALUATION', 'BACKGROUND_CHECK',
    'OFFER_PREPARATION', 'OFFER_APPROVAL', 'OFFER_DELIVERY',
    'CONTRACT_SIGNING', 'PRE_BOARDING', 'ONBOARDING',
  ];

  static nextStage(current: HiringStage): HiringStage | null {
    const idx = TalentFlowApiService.STAGE_ORDER.indexOf(current);
    return idx >= 0 && idx < TalentFlowApiService.STAGE_ORDER.length - 1
      ? TalentFlowApiService.STAGE_ORDER[idx + 1]
      : null;
  }

  advanceStage(
    candidateId: string,
    newStage: HiringStage,
  ): Observable<{ candidateId: string; previousStage: HiringStage; newStage: HiringStage; stageEnteredAt: string }> {
    const body = { newStage, tenantId: environment.talentFlow.tenantId };
    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.put<{ candidateId: string; previousStage: HiringStage; newStage: HiringStage; stageEnteredAt: string }>(
          `${this.baseUrl}/candidates/${candidateId}/stage`,
          body,
          { headers },
        ),
      ),
      timeout(API_TIMEOUT_MS),
      catchError(this.handleError),
    );
  }

  // Config

  getConfig(configType: ConfigType, version?: string): Observable<ConfigResponse> {
    // Lambda expects: GET /v1/config?configType=X&active=true&tenantId=NALEKO
    let params = new HttpParams()
      .set('configType', configType)
      .set('active', 'true')
      .set('tenantId', environment.talentFlow.tenantId);
    if (version) params = params.set('version', version);

    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.get<ConfigResponse>(`${this.baseUrl}/config`, { headers, params }),
      ),
      timeout(API_TIMEOUT_MS),
      catchError(this.handleError),
    );
  }

  updateConfig(configType: ConfigType, data: unknown): Observable<ConfigResponse> {
    // Lambda expects: PUT /v1/config with { tenantId, configType, data } in body
    const tenantId = environment.talentFlow.tenantId;
    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.put<ConfigResponse>(`${this.baseUrl}/config`, { tenantId, configType, data }, { headers }),
      ),
      timeout(API_TIMEOUT_MS),
      catchError(this.handleError),
    );
  }

  // Offer (Phase D)

  getOffer(candidateId: string): Observable<Offer> {
    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.get<Offer>(`${this.baseUrl}/candidates/${candidateId}/offer`, { headers }),
      ),
      timeout(API_TIMEOUT_MS),
      catchError(this.handleError),
    );
  }

  createOffer(candidateId: string): Observable<{ candidateId: string; offerId: string; state: string; approvalChain: unknown[] }> {
    const body = { tenantId: environment.talentFlow.tenantId };
    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.post<{ candidateId: string; offerId: string; state: string; approvalChain: unknown[] }>(
          `${this.baseUrl}/candidates/${candidateId}/offer`,
          body,
          { headers },
        ),
      ),
      timeout(API_TIMEOUT_MS),
      catchError(this.handleError),
    );
  }

  advanceOfferState(
    candidateId: string,
    action: 'SUBMIT_FOR_APPROVAL' | 'MARK_SENT' | 'LOG_INTERACTION' | 'CONFIRM_ACCEPTANCE',
    payload: Record<string, unknown>,
  ): Observable<Record<string, unknown>> {
    const body = { action, payload, tenantId: environment.talentFlow.tenantId };
    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.put<Record<string, unknown>>(
          `${this.baseUrl}/candidates/${candidateId}/offer`,
          body,
          { headers },
        ),
      ),
      timeout(API_TIMEOUT_MS),
      catchError(this.handleError),
    );
  }

  // Error Handling

  private handleError(error: unknown): Observable<never> {
    const err = error as { status?: number; message?: string; name?: string };
    let userMessage = 'An unexpected error occurred. Please try again.';

    if (err.name === 'TimeoutError') userMessage = 'Request timed out. Please check your connection and try again.';
    else if (err.status === 401) userMessage = 'Your session has expired. Please sign in again.';
    else if (err.status === 403) userMessage = 'You do not have permission to perform this action.';
    else if (err.status === 404) userMessage = 'The requested resource was not found.';
    else if (err.status === 409) userMessage = 'A conflict occurred. This record may already exist.';
    else if (err.status && err.status >= 500)
      userMessage = 'A server error occurred. Please try again later.';

    return throwError(() => ({ ...err, userMessage }));
  }
}
