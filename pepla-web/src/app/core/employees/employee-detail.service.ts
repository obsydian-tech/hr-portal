import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { toEmployeeDetail, type ApiEmployeeDetail, type EmployeeDetail } from './employee-detail';

/** Why a person could not be read: the id is unknown (404), or anything else (error answer, no connection, not signed in). */
export type DetailFailure = 'not-found' | 'failed';

export class EmployeeDetailError extends Error {
  constructor(readonly reason: DetailFailure) {
    super(reason);
  }
}

/**
 * Reads one person from the document upload API (GET /v1/employees/{id}/verifications, signed in as HR).
 * The only call the employee page makes: it reaches no AI route.
 */
@Injectable({ providedIn: 'root' })
export class EmployeeDetailService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  async load(id: string): Promise<EmployeeDetail> {
    const token = await this.auth.idToken();
    if (!token) throw new EmployeeDetailError('failed');
    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
    try {
      const answer = await firstValueFrom(
        this.http.get<ApiEmployeeDetail>(`${environment.documentUploadApiUrl}/v1/employees/${encodeURIComponent(id)}/verifications`, { headers }),
      );
      return toEmployeeDetail(answer);
    } catch (err) {
      throw new EmployeeDetailError(err instanceof HttpErrorResponse && err.status === 404 ? 'not-found' : 'failed');
    }
  }
}
