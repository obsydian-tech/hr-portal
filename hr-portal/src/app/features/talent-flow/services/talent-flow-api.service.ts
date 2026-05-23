import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, catchError, from, of, switchMap, throwError, timeout } from 'rxjs';
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
  ProvisioningBundle,
  ProvisioningBundleProgress,
  ProvisioningItemProgress,
  ActivityLogEntry,
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
    if (filters?.hiringManagerId) params = params.set('hiringManagerId', filters.hiringManagerId);
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

  // IT Provisioning

  /**
   * TODO: wire to GET /v1/provisioning/bundles once Lambda is deployed.
   * Returns bundles for the requesting HM (userId from JWT, scoped server-side).
   */
  getProvisioningBundles(): Observable<ProvisioningBundle[]> {
    // ── MOCK DATA — replace with real HTTP call after Lambda is deployed ──
    // TODO: wire to GET /v1/provisioning/bundles (scoped to HM userId from JWT)
    const now = new Date();
    const iso = (d: Date) => d.toISOString().split('T')[0];
    const inDays = (n: number) => { const d = new Date(now); d.setDate(d.getDate() + n); return iso(d); };
    const mock: ProvisioningBundle[] = [
      {
        id: 'bundle-001', candidateId: 'cand-sm', candidateName: 'Sarah Mitchell',
        candidateRole: 'Product Manager', seniority: 'Senior', department: 'Product Team',
        startDate: inDays(39), slaStatus: 'BREACHED', templateName: 'Senior PM template',
        bundleStatus: 'PENDING_REVIEW',
        items: [
          { id: 'i1', type: 'HARDWARE', label: 'Laptop',        queue: 'Hardware queue',    status: 'PENDING', fromTemplate: true,  specNote: 'Senior level — high performance spec required' },
          { id: 'i2', type: 'ACCESS',   label: 'Email account', queue: 'Access & Identity', status: 'PENDING', fromTemplate: true  },
          { id: 'i3', type: 'ACCESS',   label: 'Access card',   queue: 'Facilities queue',  status: 'PENDING', fromTemplate: true  },
          { id: 'i4', type: 'SOFTWARE', label: 'System access', queue: 'Software queue',    status: 'PENDING', fromTemplate: true,  specNote: 'Product management tools — Jira, Confluence, Figma, Analytics suite' },
        ],
      },
      {
        id: 'bundle-002', candidateId: 'cand-jk', candidateName: 'James Kowalski',
        candidateRole: 'Engineering Lead', seniority: 'Senior', department: 'Engineering',
        startDate: inDays(53), slaStatus: 'AT_RISK', templateName: 'Senior Engineer template',
        bundleStatus: 'PENDING_REVIEW',
        items: [
          { id: 'i5', type: 'HARDWARE', label: 'Laptop',          queue: 'Hardware queue',    status: 'PENDING', fromTemplate: true,  specNote: 'Senior level — high performance spec required' },
          { id: 'i6', type: 'HARDWARE', label: 'Mobile phone',    queue: 'Hardware queue',    status: 'PENDING', fromTemplate: true  },
          { id: 'i7', type: 'ACCESS',   label: 'Email account',   queue: 'Access & Identity', status: 'PENDING', fromTemplate: true  },
          { id: 'i8', type: 'SOFTWARE', label: 'Dev environment', queue: 'Software queue',    status: 'PENDING', fromTemplate: true,  specNote: 'Full dev stack — GitHub, AWS console, CI/CD access' },
        ],
      },
      {
        id: 'bundle-003', candidateId: 'cand-pn', candidateName: 'Priya Naidoo',
        candidateRole: 'Data Analyst', seniority: 'Mid', department: 'Analytics',
        startDate: inDays(10), slaStatus: 'AT_RISK', templateName: 'Mid Analyst template',
        bundleStatus: 'IN_FULFILMENT', approvedAt: new Date(now.getTime() - 86400000 * 3).toISOString(),
        items: [
          { id: 'i9',  type: 'HARDWARE', label: 'Laptop',        queue: 'Hardware queue',    status: 'COMPLETE',  fromTemplate: true },
          { id: 'i10', type: 'ACCESS',   label: 'Email account', queue: 'Access & Identity', status: 'COMPLETE',  fromTemplate: true },
          { id: 'i11', type: 'ACCESS',   label: 'Access card',   queue: 'Facilities queue',  status: 'COMPLETE',  fromTemplate: true },
          { id: 'i12', type: 'SOFTWARE', label: 'System access', queue: 'Software queue',    status: 'BREACHED',  fromTemplate: true },
        ],
      },
      {
        id: 'bundle-004', candidateId: 'cand-lb', candidateName: 'Liam Brooks',
        candidateRole: 'UX Designer', seniority: 'Mid', department: 'Design',
        startDate: inDays(21), slaStatus: 'ON_TRACK', templateName: 'Mid Designer template',
        bundleStatus: 'IN_FULFILMENT', approvedAt: new Date(now.getTime() - 86400000 * 2).toISOString(),
        items: [
          { id: 'i13', type: 'HARDWARE', label: 'Laptop',       queue: 'Hardware queue',    status: 'COMPLETE',    fromTemplate: true },
          { id: 'i14', type: 'SOFTWARE', label: 'Design tools', queue: 'Software queue',    status: 'IN_PROGRESS', fromTemplate: true, specNote: 'Figma, Adobe CC, Zeplin' },
          { id: 'i15', type: 'ACCESS',   label: 'Email account',queue: 'Access & Identity', status: 'IN_PROGRESS', fromTemplate: true },
        ],
      },
      {
        id: 'bundle-005', candidateId: 'cand-tm', candidateName: 'Thabo Molefe',
        candidateRole: 'Finance Analyst', seniority: 'Senior', department: 'Finance',
        startDate: inDays(30), slaStatus: 'ON_TRACK', templateName: 'Senior Finance template',
        bundleStatus: 'IN_FULFILMENT', approvedAt: new Date(now.getTime() - 86400000).toISOString(),
        items: [
          { id: 'i16', type: 'HARDWARE', label: 'Laptop',        queue: 'Hardware queue',    status: 'IN_PROGRESS', fromTemplate: true },
          { id: 'i17', type: 'ACCESS',   label: 'Email account', queue: 'Access & Identity', status: 'PENDING',     fromTemplate: true },
          { id: 'i18', type: 'SOFTWARE', label: 'Finance suite', queue: 'Software queue',    status: 'PENDING',     fromTemplate: true, specNote: 'SAP, PowerBI, Excel 365' },
        ],
      },
      {
        id: 'bundle-006', candidateId: 'cand-nv', candidateName: 'Naledi van Wyk',
        candidateRole: 'HR Business Partner', seniority: 'Senior', department: 'Human Resources',
        startDate: inDays(14), slaStatus: 'ON_TRACK', templateName: 'Senior HR template',
        bundleStatus: 'READY',
        items: [
          { id: 'i19', type: 'HARDWARE', label: 'Laptop',       queue: 'Hardware queue',    status: 'COMPLETE', fromTemplate: true },
          { id: 'i20', type: 'ACCESS',   label: 'Email account',queue: 'Access & Identity', status: 'COMPLETE', fromTemplate: true },
          { id: 'i21', type: 'ACCESS',   label: 'Access card',  queue: 'Facilities queue',  status: 'COMPLETE', fromTemplate: true },
          { id: 'i22', type: 'SOFTWARE', label: 'HRIS access',  queue: 'Software queue',    status: 'COMPLETE', fromTemplate: true },
        ],
      },
    ];
    return of(mock);
  }

  /**
   * TODO: wire to GET /v1/provisioning/bundles/:id once Lambda is deployed.
   * Returns single bundle by id from the mock dataset.
   */
  getProvisioningBundle(id: string): Observable<ProvisioningBundle | undefined> {
    return new Observable((observer) => {
      this.getProvisioningBundles().subscribe((bundles) => {
        observer.next(bundles.find((b) => b.id === id));
        observer.complete();
      });
    });
  }

  /**
   * TODO: wire to GET /v1/provisioning/bundles/:id/progress once Lambda is deployed.
   * Returns full bundle progress view — items with specialist data + activity log.
   */
  getProvisioningBundleProgress(id: string): Observable<ProvisioningBundleProgress | undefined> {
    const now = new Date();
    const iso = (d: Date) => d.toISOString().split('T')[0];
    const inDays = (n: number) => { const d = new Date(now); d.setDate(d.getDate() + n); return iso(d); };
    const daysAgo = (n: number) => new Date(now.getTime() - 86400000 * n).toISOString();

    // ── Rich mock for Priya Naidoo (bundle-003) — matches Screen 3 design ──
    const progressMocks: Record<string, ProvisioningBundleProgress> = {
      'bundle-003': {
        id: 'bundle-003', candidateId: 'cand-pn', candidateName: 'Priya Naidoo',
        candidateRole: 'Data Analyst', seniority: 'Mid', department: 'Analytics Team',
        startDate: inDays(10), slaStatus: 'BREACHED', templateName: 'Mid Analyst template',
        bundleStatus: 'IN_FULFILMENT', approvedAt: daysAgo(5),
        items: [
          {
            id: 'i9', type: 'HARDWARE', label: 'Laptop', queue: 'Hardware queue',
            status: 'COMPLETE', fromTemplate: true,
            specialistName: 'Tom M.', specialistInitials: 'TM',
            completedAt: daysAgo(3), taskSlaStatus: 'ON_TRACK',
          },
          {
            id: 'i10', type: 'ACCESS', label: 'Email account', queue: 'Access & Identity queue',
            status: 'COMPLETE', fromTemplate: true,
            specialistName: 'Kim L.', specialistInitials: 'KL',
            completedAt: daysAgo(2), taskSlaStatus: 'ON_TRACK',
          },
          {
            id: 'i11', type: 'FACILITIES', label: 'Access card', queue: 'Facilities queue',
            status: 'COMPLETE', fromTemplate: true,
            specialistName: 'Nomsa Z.', specialistInitials: 'NZ',
            completedAt: daysAgo(1), taskSlaStatus: 'ON_TRACK',
          },
          {
            id: 'i12', type: 'SOFTWARE', label: 'System access', queue: 'Software queue',
            status: 'BREACHED', fromTemplate: true,
            notes: 'Analytics suite access required — Tableau, BigQuery, dbt, Looker. Priya cannot start without this.',
            taskSlaStatus: 'BREACHED',
            // no specialistName/Initials — Unassigned
          },
        ] as ProvisioningItemProgress[],
        activityLog: [
          {
            id: 'log-1', type: 'BREACH',
            message: 'System access SLA breached — task unassigned in Software queue',
            detail: 'Today · TA and HM notified',
          },
          {
            id: 'log-2', type: 'COMPLETE',
            message: 'Access card complete — marked ready by Nomsa Z.',
            detail: 'Yesterday · Facilities queue',
          },
          {
            id: 'log-3', type: 'COMPLETE',
            message: 'Email account complete — marked ready by Kim L.',
            detail: '2 days ago · Access & Identity queue',
          },
          {
            id: 'log-4', type: 'COMPLETE',
            message: 'Laptop complete — marked ready by Tom M.',
            detail: '3 days ago · Hardware queue',
          },
          {
            id: 'log-5', type: 'APPROVAL',
            message: 'Bundle approved by Marcus Khumalo — tasks routed to queues',
            detail: '5 days ago',
          },
        ] as ActivityLogEntry[],
      },
    };

    // For any other in-fulfilment bundle id not in the detailed mock map,
    // synthesise a basic progress view from the base mock.
    return new Observable((observer) => {
      if (progressMocks[id]) {
        observer.next(progressMocks[id]);
        observer.complete();
        return;
      }
      this.getProvisioningBundles().subscribe((bundles) => {
        const base = bundles.find((b) => b.id === id);
        if (!base) { observer.next(undefined); observer.complete(); return; }
        const progress: ProvisioningBundleProgress = {
          ...base,
          items: base.items.map((item) => ({
            ...item,
            taskSlaStatus: item.status === 'BREACHED' ? 'BREACHED' : 'ON_TRACK',
          } as ProvisioningItemProgress)),
          activityLog: [
            { id: 'log-a', type: 'APPROVAL', message: `Bundle approved — tasks routed to queues`, detail: 'Recently' },
          ],
        };
        observer.next(progress);
        observer.complete();
      });
    });
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
