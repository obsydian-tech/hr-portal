import { Injectable, inject } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { environment } from '../../../environments/environment';

/** The answer of a call. A dropped connection is `null`, so a page can tell "no answer" from "an error answer". */
export interface HireResponse<T = unknown> { status: number; body: T; }

export interface HireRole {
  role_id: string;
  job_title: string;
  department?: string;
  level?: string;
  hiring_manager_id?: string;
  hiring_manager_name?: string;
  candidate_count: number;
  overdue_count?: number;
  due_soon_count?: number;
  opened_at: string;
  status: string;
}

export interface HirePending { awaiting?: { name?: string }; }

export interface HireCandidate {
  id: string;
  name: string;
  stage: string;
  stage_entered_at?: string;
  due_at?: string;
  sla_status?: string;
  source?: string;
  interviews_done?: number;
  interviews_required?: number;
  offer_state?: string;
  pending?: HirePending;
}

export interface HireCounts { all: number; mine: number; overdue: number; due_soon: number; not_hired: number; }

export interface HireConfig {
  departments: string[];
  seniority_levels: { key: string; label: string }[];
  criteria: { key: string; label: string }[];
  screening?: boolean;
}

export interface OldSystemRow { candidate_id: string; name: string; role_title: string; rejected_at: string; }

export const newKey = (): string => crypto.randomUUID();

/** The recruitment calls (REC-UI-01). The company is never sent: the token carries it. */
@Injectable({ providedIn: 'root' })
export class HireApi {
  private readonly auth = inject(AuthService);

  async call<T = unknown>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, idempotencyKey?: string): Promise<HireResponse<T> | null> {
    try {
      const token = await this.auth.idToken();
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
      const res = await fetch(`${environment.talentFlowApiUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      let json: unknown = null;
      try { json = await res.json(); } catch { /* an answer with no body */ }
      return { status: res.status, body: json as T };
    } catch {
      return null;
    }
  }
}
