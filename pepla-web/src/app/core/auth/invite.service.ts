import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

export type InviteLookup =
  | { status: 'ok'; company: string; firstName: string; email: string; startDate?: string; hrPartnerName: string }
  | { status: 'expired' | 'used'; company?: string; hrPartnerName?: string }
  | { status: 'invalid' };

export type LookupResult = InviteLookup | { status: 'unreachable' };
export type RedeemResult =
  | { ok: true }
  | { ok: false; kind: 'rules'; rules: string[] }
  | { ok: false; kind: 'gone' }
  | { ok: false; kind: 'failed' }
  | { ok: false; kind: 'unreachable' };

/** ONB-17: the two public invite routes (ONB-04). No Authorization header: the person has no sign-in yet. */
@Injectable({ providedIn: 'root' })
export class InviteService {
  private readonly http = inject(HttpClient);

  async lookup(token: string): Promise<LookupResult> {
    try {
      return await firstValueFrom(this.http.post<InviteLookup>(`${environment.employeesApiUrl}/v1/invites/lookup`, { token }));
    } catch (e) {
      if (e instanceof HttpErrorResponse && e.status === 400) return { status: 'invalid' };
      return { status: 'unreachable' };
    }
  }

  async redeem(token: string, password: string): Promise<RedeemResult> {
    try {
      await firstValueFrom(this.http.post(`${environment.employeesApiUrl}/v1/invites/redeem`, { token, password }));
      return { ok: true };
    } catch (e) {
      if (!(e instanceof HttpErrorResponse) || e.status === 0) return { ok: false, kind: 'unreachable' };
      if (e.status === 400) return { ok: false, kind: 'rules', rules: Array.isArray(e.error?.fields?.password) ? e.error.fields.password : [] };
      if (e.status === 410) return { ok: false, kind: 'gone' };
      return { ok: false, kind: 'failed' };
    }
  }
}
