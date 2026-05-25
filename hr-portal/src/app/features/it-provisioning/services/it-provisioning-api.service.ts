import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { AuthService } from '../../../core/services/auth.service';
import { ItTask, ItQueue, RequirementType, FulfilmentData } from '../models/it-provisioning.models';

// ─── API response shapes ──────────────────────────────────────────────────────

export interface ItTasksResponse {
  tasks: ItTask[];
  nextToken?: string;
}

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * ItProvisioningApiService
 *
 * Real HTTP client for the IT Provisioning API routes on the TalentFlow
 * API Gateway (57l0w7kk9h).  Auth uses the Naleko pool JWT via AuthService
 * (pool consolidation — Epic 5: TF API Gateway authorizer validates against
 * the Naleko pool, same as all other TF routes).
 *
 * Base path: /v1/it/tasks
 *
 * Routes consumed:
 *   GET    /v1/it/tasks                          → getMyTasks()
 *   GET    /v1/it/tasks?status=COMPLETED         → getCompletedTasks()
 *   GET    /v1/it/tasks/{taskId}                 → getTaskById()
 *   POST   /v1/it/tasks/{taskId}/claim           → claimTask()
 *   POST   /v1/it/tasks/{taskId}/release         → releaseTask()
 *   POST   /v1/it/tasks/{taskId}/complete        → completeTaskWithFulfilment()
 *
 * createItTask is NOT exposed here — it is an internal Lambda invoked
 * by orchestrateTalentFlowWorkflow when a provisioning bundle is approved.
 */
@Injectable({ providedIn: 'root' })
export class ItProvisioningApiService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  private get baseUrl(): string {
    return `${environment.talentFlow.apiUrl}/it/tasks`;
  }

  // ─── Auth helpers ─────────────────────────────────────────────────────────

  private async headers(): Promise<HttpHeaders> {
    const token = await this.auth.getIdToken();
    return new HttpHeaders({
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    });
  }

  private tenantParams(): HttpParams {
    return new HttpParams().set('tenantId', environment.talentFlow.tenantId);
  }

  // ─── Read operations ──────────────────────────────────────────────────────

  /** Fetch all UNASSIGNED + CLAIMED tasks visible to the current specialist. */
  async getMyTasks(): Promise<ItTask[]> {
    const headers = await this.headers();
    const params  = this.tenantParams().set('status', 'UNASSIGNED,CLAIMED');
    const res     = await firstValueFrom(
      this.http.get<ItTasksResponse | ItTask[]>(this.baseUrl, { headers, params }),
    );
    return Array.isArray(res) ? res : (res as ItTasksResponse).tasks ?? [];
  }

  /** @deprecated kept for it-completed-page compat  */
  async getMyTasksLegacy(specialistId: string): Promise<ItTask[]> {
    return this.getMyTasks();
  }

  /** Fetch COMPLETED tasks. */
  async getCompletedTasks(): Promise<ItTask[]> {
    const headers = await this.headers();
    const params  = this.tenantParams().set('status', 'COMPLETED');
    const res     = await firstValueFrom(
      this.http.get<ItTasksResponse | ItTask[]>(this.baseUrl, { headers, params }),
    );
    return Array.isArray(res) ? res : (res as ItTasksResponse).tasks ?? [];
  }

  /** Fetch a single task by ID. Returns null on 404. */
  async getTaskById(taskId: string): Promise<ItTask | null> {
    try {
      const headers = await this.headers();
      return await firstValueFrom(
        this.http.get<ItTask>(`${this.baseUrl}/${taskId}`, { headers }),
      );
    } catch {
      return null;
    }
  }

  // ─── Mutation operations ──────────────────────────────────────────────────

  /** Claim an unassigned task. The Lambda derives the specialist from the JWT sub. */
  async claimTask(taskId: string): Promise<void> {
    const headers = await this.headers();
    await firstValueFrom(
      this.http.post<void>(`${this.baseUrl}/${taskId}/claim`, {}, { headers }),
    );
  }

  /**
   * @deprecated old call site had (taskId, specialistId, name, role).
   * Lambda now derives identity from JWT. Extra params ignored.
   */
  async claimTaskLegacy(
    taskId: string,
    _specialistId: string,
    _name: string,
    _role: string,
  ): Promise<void> {
    return this.claimTask(taskId);
  }

  /** Release a claimed task back to the queue. */
  async releaseTask(taskId: string, reason: string): Promise<void> {
    const headers = await this.headers();
    await firstValueFrom(
      this.http.post<void>(`${this.baseUrl}/${taskId}/release`, { reason }, { headers }),
    );
  }

  /** Mark a task complete with fulfilment details. */
  async completeTaskWithFulfilment(taskId: string, data: FulfilmentData): Promise<void> {
    const headers = await this.headers();
    await firstValueFrom(
      this.http.post<void>(
        `${this.baseUrl}/${taskId}/complete`,
        {
          assetReference:   data.assetReference,
          fulfilmentMethod: data.fulfilmentMethod,
          notes:            data.additionalNotes,
        },
        { headers },
      ),
    );
  }

  // ─── Pure helpers ─────────────────────────────────────────────────────────

  /**
   * Derives ItQueue tab definitions from a loaded task list.
   * assignedQueues comes from IT_QUEUES admin config filtered by specialist email
   * (see it-queue-page for derivation).
   */
  buildQueues(tasks: ItTask[], assignedQueues: RequirementType[]): ItQueue[] {
    const map = new Map<RequirementType, number>();
    for (const t of tasks) {
      map.set(t.queue, (map.get(t.queue) ?? 0) + 1);
    }
    return assignedQueues.map((q) => ({ type: q, count: map.get(q) ?? 0 }));
  }

  /** @deprecated shim for legacy call sites that pass assignedQueues */
  getQueues(assignedQueues: string[]): ItQueue[] {
    return (assignedQueues as RequirementType[]).map((q) => ({ type: q, count: 0 }));
  }

  /* ── MOCK DATA REMOVED ──────────────────────────────────────────────────────
   * All data is now served by the it-tasks DynamoDB table via Lambda.
   * See: lambda/getItTasks  lambda/getItTask  lambda/claimItTask
   *      lambda/releaseItTask  lambda/completeItTask  lambda/createItTask
   * ───────────────────────────────────────────────────────────────────────── */
}
