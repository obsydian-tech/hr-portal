import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { PpRevealLog, type Reveal } from '../../ds/records/records';

/** What a Show hands over so the API can find the number: the document, whose it is and which number. */
export interface RevealRef { documentId: string; employeeId: string; field: 'id_number' | 'account_number'; }

/**
 * ONB-14: Show asks the API for the number. The API records it first and answers only when the record is kept, so a
 * failure leaves the number hidden. The answer is handed to the field and kept nowhere else.
 */
@Injectable()
export class ApiRevealLog extends PpRevealLog {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  override async log(r: Reveal): Promise<string> {
    const ref = r.ref as RevealRef | undefined;
    if (!ref) throw new Error('nothing to show');
    const token = await this.auth.idToken();
    if (!token) throw new Error('not signed in');
    const answer = await firstValueFrom(
      this.http.post<{ value?: string }>(
        `${environment.documentUploadApiUrl}/v1/verifications/${encodeURIComponent(ref.documentId)}/reveal`,
        { field: ref.field, employee_id: ref.employeeId },
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );
    if (typeof answer?.value !== 'string' || !answer.value) throw new Error('no value');
    return answer.value;
  }
}
