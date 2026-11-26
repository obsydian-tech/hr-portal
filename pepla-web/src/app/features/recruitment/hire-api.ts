import { Injectable, inject } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { environment } from '../../../environments/environment';
import type { components } from '../../core/api/openapi';

/** The answer of a call. A dropped connection is `null`, so a page can tell "no answer" from "an error answer". */
export interface HireResponse<T = unknown> { status: number; body: T; }

/** A role, as `api/openapi.yaml` describes it (REC-14). The Roles list may still send the manager's name (follow-up F-3). */
export type HireRole = components['schemas']['Role'] & { hiring_manager_name?: string };

/** What the Open a role page offers and the board reads, from one answer (REC-14). */
export type RoleOptions = components['schemas']['RoleOptions'];

/** Who a pending Not hired answer waits on: a named hiring manager, or any HR person (`hr`). */
export interface HirePending { awaiting?: { name?: string; hr?: boolean }; }

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

/** One row of a candidate's history, as `api/openapi.yaml` describes it (REC-15 step D). */
export type CandidateEventRow = NonNullable<components['schemas']['CandidateEvents']['events']>[number];

/** The most history reads for one candidate: the server pages oldest first (REC-UI-02 step 4, D-RUI-02.25). */
export const MAX_HISTORY_READS = 10;

export interface HireCounts { all: number; mine: number; overdue: number; due_soon: number; not_hired: number; }

export interface OldSystemRow { candidate_id: string; name: string; role_title: string; rejected_at: string; }

const isList = (v: unknown, keys: string[]): boolean =>
  Array.isArray(v) && v.every((x) => !!x && typeof x === 'object' && keys.every((k) => typeof (x as Record<string, unknown>)[k] === (k === 'order' ? 'number' : 'string')));

/** A runtime check that an options answer has the shape of `RoleOptions`; anything else is treated as a failed call (REC-14 rule 21). */
export function isRoleOptions(v: unknown): v is RoleOptions {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return isList(o['departments'], ['id', 'name']) && isList(o['levels'], ['key', 'label', 'order']) && isList(o['criteria'], ['key', 'label'])
    && isList(o['hiring_managers'], ['id', 'name']) && typeof o['screening'] === 'boolean'
    && !!o['panel_size_by_level'] && typeof o['panel_size_by_level'] === 'object' && !Array.isArray(o['panel_size_by_level']);
}

/** The options out of an answer to `GET /v1/roles/options`: `null` for no answer, a refusal, an error or an answer that is not `RoleOptions`. */
export const optionsOf = (r: HireResponse | null): RoleOptions | null => (r?.status === 200 && isRoleOptions(r.body) ? r.body : null);

export const newKey = (): string => crypto.randomUUID();

/** The recruitment calls (REC-UI-01). The company is never sent: the token carries it. */
@Injectable({ providedIn: 'root' })
export class HireApi {
  private readonly auth = inject(AuthService);

  async call<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'PATCH', path: string, body?: unknown, idempotencyKey?: string): Promise<HireResponse<T> | null> {
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

  /**
   * A candidate's whole history (`GET /v1/candidates/{id}/events?limit=200`), page after page with the `nextToken` the last page gave,
   * encoded because it is base64 (it holds `+`, `/` and `=`), up to `MAX_HISTORY_READS` reads. `null` when any page fails: nothing
   * is kept from the pages that did load. The rows come back in the order they were read.
   */
  async candidateEvents(id: string): Promise<CandidateEventRow[] | null> {
    const rows: CandidateEventRow[] = [];
    let token: string | undefined;
    for (let read = 0; read < MAX_HISTORY_READS; read++) {
      const query = `limit=200${token ? `&nextToken=${encodeURIComponent(token)}` : ''}`;
      const r = await this.call<components['schemas']['CandidateEvents']>('GET', `/v1/candidates/${encodeURIComponent(id)}/events?${query}`);
      if (r?.status !== 200 || !r.body || !Array.isArray(r.body.events)) return null;
      rows.push(...r.body.events);
      token = typeof r.body.nextToken === 'string' && r.body.nextToken !== '' ? r.body.nextToken : undefined;
      if (!token) break;
    }
    return rows;
  }
}
