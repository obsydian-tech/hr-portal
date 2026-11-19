import { Injectable, inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';

/**
 * CHAT-03: turns the company's Ask Batsi switch on or off (PUT /v1/admin/company/ask-batsi).
 * The body is exactly { enabled } and the company is the sign-in's, never named here (C-2). The server
 * only lets an admin of the caller's own company do it. This answers true or false and never carries
 * the server's words or a status code.
 */
@Injectable({ providedIn: 'root' })
export class CompanySwitchService {
  private readonly auth = inject(AuthService);

  /** The state the server saved, or null when the save did not go through (any status, offline, a body that is not an answer). */
  async save(enabled: boolean): Promise<boolean | null> {
    try {
      const token = await this.auth.idToken();
      if (!token) return null;
      const res = await fetch(`${environment.employeesApiUrl}/v1/admin/company/ask-batsi`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) return null;
      const body: unknown = await res.json();
      const saved = (body as { enabled?: unknown } | null)?.enabled;
      return typeof saved === 'boolean' ? saved : null;
    } catch {
      return null;
    }
  }
}
