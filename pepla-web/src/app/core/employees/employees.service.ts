import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { NewEmployee, toNewEmployee, type ApiEmployee } from './employee';

interface EmployeesPage {
  items?: ApiEmployee[];
  lastKey?: string;
}

/** Stops a broken API that keeps answering with a lastKey from looping for ever. */
const MAX_PAGES = 200;

/**
 * Reads the employees API (GET /v1/employees, signed in as HR). Follows lastKey until none comes back,
 * so every person is here. Phone and ID digits are dropped before anything reaches a screen.
 */
@Injectable({ providedIn: 'root' })
export class EmployeesService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  async loadAll(): Promise<NewEmployee[]> {
    const token = await this.auth.idToken();
    if (!token) throw new Error('Not signed in');
    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
    const people: NewEmployee[] = [];
    let lastKey: string | undefined;
    for (let n = 0; n < MAX_PAGES; n++) {
      let params = new HttpParams().set('limit', '200');
      if (lastKey) params = params.set('lastKey', lastKey);
      const page = await firstValueFrom(this.http.get<EmployeesPage>(`${environment.employeesApiUrl}/v1/employees`, { headers, params }));
      for (const item of page.items ?? []) people.push(toNewEmployee(item));
      lastKey = page.lastKey || undefined;
      if (!lastKey) return people;
    }
    throw new Error('The employees API did not stop sending pages');
  }
}
