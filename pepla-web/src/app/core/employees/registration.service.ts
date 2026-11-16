import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService, REGISTRATION_DRAFT_KEY } from '../auth/auth.service';

export interface HrPartner { id: string; name: string; staffId: string; email: string }

/** What HR has typed so far. The ID number is not here: it lives in memory only. */
export interface Draft {
  step: number;
  firstName: string;
  middleName: string;
  lastName: string;
  email: string;
  phone: string;
  department: string;
  jobTitle: string;
  /** YYYY-MM-DD or empty. */
  startDate: string;
  offerDate: string;
  partnerId: string;
}

export interface Registered { name: string; firstName: string; email: string; employeeId: string; emailSent: boolean }
export type RegisterResult =
  | { ok: true; registered: Registered }
  | { ok: false; reason: 'duplicate' | 'invalid' | 'failed'; fields?: Record<string, string> };

const KEY = REGISTRATION_DRAFT_KEY;
const EMPTY: Draft = { step: 1, firstName: '', middleName: '', lastName: '', email: '', phone: '', department: '', jobTitle: '', startDate: '', offerDate: '', partnerId: '' };

export function savedTime(now = new Date()): string {
  return new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
}

/** Registering a new employee: the draft, the HR partners, the email check and the POST. */
@Injectable({ providedIn: 'root' })
export class RegistrationService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  readonly draft = signal<Draft>(read());
  /** The ID number, in memory only: never in the draft, never stored. */
  readonly idNumber = signal('');
  readonly savedAt = signal<string | null>(null);
  /** One key per registration, made when Register is first pressed and kept for a retry. */
  private key: string | null = null;
  private inFlight: Promise<RegisterResult> | null = null;

  patch(change: Partial<Draft>): void {
    this.draft.update((d) => ({ ...d, ...change }));
    this.persist();
  }

  private persist(): void {
    try { sessionStorage.setItem(KEY, JSON.stringify(this.draft())); } catch { /* storage may be off */ }
    this.savedAt.set(savedTime());
  }

  /** Empties the draft, the ID number and the key. */
  clear(): void {
    this.draft.set({ ...EMPTY });
    this.idNumber.set('');
    this.savedAt.set(null);
    this.key = null;
    try { sessionStorage.removeItem(KEY); } catch { /* storage may be off */ }
  }

  private async headers(): Promise<HttpHeaders> {
    const token = await this.auth.idToken();
    if (!token) throw new Error('Not signed in');
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }

  async partners(): Promise<HrPartner[]> {
    const headers = await this.headers();
    const answer = await firstValueFrom(this.http.get<{ items?: HrPartner[] }>(`${environment.employeesApiUrl}/v1/hr-partners`, { headers }));
    return answer.items ?? [];
  }

  /** True when the address is already in use. Capitals and spaces do not matter. */
  async emailInUse(email: string): Promise<boolean> {
    const headers = await this.headers();
    const params = new HttpParams().set('email', email.trim().toLowerCase());
    const answer = await firstValueFrom(this.http.get<{ inUse: boolean }>(`${environment.employeesApiUrl}/v1/employees/email-check`, { headers, params }));
    return answer.inUse === true;
  }

  /** Registers the person. Pressing twice shares one call. */
  register(): Promise<RegisterResult> {
    this.inFlight ??= this.send().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async send(): Promise<RegisterResult> {
    const d = this.draft();
    this.key ??= crypto.randomUUID();
    const id = this.idNumber().trim();
    const body: Record<string, string> = {
      first_name: d.firstName,
      last_name: d.lastName,
      email: d.email.trim(),
      phone: d.phone,
      department: d.department,
      job_title: d.jobTitle,
      hr_staff_id: d.partnerId,
    };
    if (d.middleName.trim()) body['middle_name'] = d.middleName;
    if (d.startDate) body['planned_start_date'] = d.startDate;
    if (d.offerDate) body['offer_accept_date'] = d.offerDate;
    if (id) body['id_number'] = id;
    try {
      const headers = (await this.headers()).set('Idempotency-Key', this.key);
      const answer = await firstValueFrom(this.http.post<{ employee?: { employee_id?: string }; email?: { sent?: boolean } }>(`${environment.employeesApiUrl}/v1/employees`, body, { headers }));
      const registered: Registered = {
        name: `${d.firstName} ${d.lastName}`.trim(),
        firstName: d.firstName,
        email: d.email.trim(),
        employeeId: answer.employee?.employee_id ?? '',
        emailSent: answer.email?.sent === true,
      };
      this.clear();
      return { ok: true, registered };
    } catch (error) {
      if (error instanceof HttpErrorResponse) {
        if (error.status === 409 && error.error?.code === 'DUPLICATE_EMAIL') { this.key = null; return { ok: false, reason: 'duplicate' }; }
        if (error.status === 400) { this.key = null; return { ok: false, reason: 'invalid', fields: error.error?.fields }; }
      }
      return { ok: false, reason: 'failed' };
    }
  }
}

function read(): Draft {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) return { ...EMPTY, ...(JSON.parse(raw) as Partial<Draft>) };
  } catch { /* storage may be off or hold junk */ }
  return { ...EMPTY };
}
