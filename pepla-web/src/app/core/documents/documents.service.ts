import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { toWaitingList, type ApiWaitingDocuments, type WaitingList } from './documents-to-check';

/**
 * Reads the documents waiting for an HR decision (GET /v1/verifications?waiting=true, signed in as HR).
 * It is the only call the Documents to check page makes and it reaches no AI route.
 *
 * It also keeps the last count in memory for the sidebar: HR home and the employee page must not call
 * the list, so the number shows once the list has loaded and stays until sign out.
 */
@Injectable({ providedIn: 'root' })
export class DocumentsService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  private readonly waiting = signal<number | null>(null);
  /** The number waiting as of the last time the list loaded; null before that. */
  readonly waitingCount = this.waiting.asReadonly();

  async loadWaiting(): Promise<WaitingList> {
    const token = await this.auth.idToken();
    if (!token) throw new Error('not signed in');
    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
    const answer = await firstValueFrom(
      this.http.get<ApiWaitingDocuments>(`${environment.documentUploadApiUrl}/v1/verifications?waiting=true`, { headers }),
    );
    const list = toWaitingList(answer);
    this.waiting.set(list.total);
    return list;
  }

  /** Forget the count, for when someone signs out. */
  forget(): void {
    this.waiting.set(null);
  }
}
