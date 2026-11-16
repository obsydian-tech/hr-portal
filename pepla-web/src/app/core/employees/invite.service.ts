import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';

export type InviteInfo = { status: 'ok' | 'expired' | 'used' | 'none'; sentAt?: string; expiresAt?: string; sentTo?: string };
export type ResendResult =
  | { kind: 'ok'; sentAt: string; expiresAt: string; sentTo: string; emailSent: boolean; skipped?: string }
  | { kind: 'not-invited' }
  | { kind: 'failed' };

/** ONB-18: an Invited person's link (GET) and Resend link (POST) on the employees API, signed in as HR. */
@Injectable({ providedIn: 'root' })
export class InviteService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  private async headers(): Promise<HttpHeaders> {
    const token = await this.auth.idToken();
    if (!token) throw new Error('not signed in');
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }

  async load(id: string): Promise<InviteInfo | null> {
    try {
      return await firstValueFrom(this.http.get<InviteInfo>(`${environment.employeesApiUrl}/v1/employees/${encodeURIComponent(id)}/invite`, { headers: await this.headers() }));
    } catch {
      return null;
    }
  }

  async resend(id: string): Promise<ResendResult> {
    try {
      const a = await firstValueFrom(this.http.post<{ sentAt: string; expiresAt: string; sentTo: string; email?: { sent?: boolean; skipped?: string } }>(
        `${environment.employeesApiUrl}/v1/employees/${encodeURIComponent(id)}/invite`, null, { headers: await this.headers() }));
      return { kind: 'ok', sentAt: a.sentAt, expiresAt: a.expiresAt, sentTo: a.sentTo, emailSent: !!a.email?.sent, skipped: a.email?.skipped };
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 409 && err.error?.status === 'not-invited') return { kind: 'not-invited' };
      return { kind: 'failed' };
    }
  }
}
