import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { toDecided, toDocumentDetail, type ApiDecisionAnswer, type ApiDocumentDetail, type Decided, type DocumentDetail } from './document';

/**
 * Why a call on one document failed: the id is unknown (404), the caller is not HR (403), the document
 * was already decided or is still being read (409), or anything else (error answer, no connection, not signed in).
 */
export type DocumentFailure = 'not-found' | 'forbidden' | 'conflict' | 'failed';

export class DocumentError extends Error {
  constructor(readonly reason: DocumentFailure) {
    super(reason);
  }
}

function failureOf(err: unknown): DocumentError {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 404) return new DocumentError('not-found');
    if (err.status === 403) return new DocumentError('forbidden');
    if (err.status === 409) return new DocumentError('conflict');
  }
  return new DocumentError('failed');
}

/**
 * The three document upload API routes behind HR's document page (ONB-15), signed in as HR:
 *   GET   /v1/verifications/{id}          the document, what Batsi found and HR's decision
 *   PATCH /v1/verifications/{id}/review   HR's decision
 *   GET   /v1/documents/{id}/url          a 15-minute link to the file, only when HR asks for it
 * It reaches no summary, Batsi, agent or AI route.
 */
@Injectable({ providedIn: 'root' })
export class DocumentService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly base = environment.documentUploadApiUrl;

  private async headers(extra: Record<string, string> = {}): Promise<HttpHeaders> {
    const token = await this.auth.idToken();
    if (!token) throw new DocumentError('failed');
    return new HttpHeaders({ Authorization: `Bearer ${token}`, ...extra });
  }

  /** `employeeId`, when the list or the employee page gave it, lets the API read the document directly. */
  async load(id: string, employeeId?: string): Promise<DocumentDetail> {
    const headers = await this.headers();
    const query = employeeId ? `?employee_id=${encodeURIComponent(employeeId)}` : '';
    try {
      const answer = await firstValueFrom(this.http.get<ApiDocumentDetail>(`${this.base}/v1/verifications/${encodeURIComponent(id)}${query}`, { headers }));
      return toDocumentDetail(answer);
    } catch (err) {
      throw failureOf(err);
    }
  }

  /** HR's decision. FAILED is "ask for a new one" and takes a reason. One call, with an Idempotency-Key. */
  async decide(id: string, employeeId: string, decision: 'PASSED' | 'FAILED', reason = ''): Promise<Decided> {
    const headers = await this.headers({ 'Idempotency-Key': crypto.randomUUID() });
    try {
      const answer = await firstValueFrom(
        this.http.patch<ApiDecisionAnswer>(
          `${this.base}/v1/verifications/${encodeURIComponent(id)}/review`,
          { decision, notes: reason, employee_id: employeeId },
          { headers },
        ),
      );
      const decided = toDecided(answer);
      if (!decided) throw new DocumentError('failed');
      return decided;
    } catch (err) {
      throw err instanceof DocumentError ? err : failureOf(err);
    }
  }

  /** A 15-minute link to the file. Called only when HR presses Open document. */
  async fileLink(id: string): Promise<string> {
    const headers = await this.headers();
    try {
      const answer = await firstValueFrom(this.http.get<{ url?: string }>(`${this.base}/v1/documents/${encodeURIComponent(id)}/url`, { headers }));
      if (!answer.url) throw new DocumentError('failed');
      return answer.url;
    } catch (err) {
      throw err instanceof DocumentError ? err : failureOf(err);
    }
  }
}
