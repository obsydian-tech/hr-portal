import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';

export interface NoticeTerm { icon: string; term: string; text: string }
export interface NoticeSection { heading: string; text: string }
/** The privacy notice exactly as the server sends it, the company name filled in. */
export interface Notice { version: string; title: string; intro: string; terms: NoticeTerm[]; full: NoticeSection[] }
export interface MyStart {
  firstName: string;
  company: string;
  department?: string;
  /** YYYY-MM-DD */
  startDate?: string;
  /** YYYY-MM-DD: when the required documents are due. Left out when there is no start date. */
  documentsDue?: string;
  notice: Notice;
  consent: { version: string; acceptedAt: string } | null;
}

export type StartState =
  | { kind: 'loading' }
  | { kind: 'ready'; me: MyStart }
  /** 403 or 404: the server's own words, no form. */
  | { kind: 'refused'; message: string }
  /** A 5xx, no answer, or anything else: "We can't reach Naleko People". */
  | { kind: 'offline' };

export type AcceptResult =
  | { kind: 'saved'; acceptedAt: string }
  /** 409: the notice changed while the page was open. The page has been reloaded with the new notice. */
  | { kind: 'changed' }
  | { kind: 'refused'; message: string }
  | { kind: 'offline' };

const WORDS_FALLBACK = 'Something went wrong';

/** What the server said, when it said it in words. */
function wordsOf(e: HttpErrorResponse): string {
  return typeof e.error?.error === 'string' && e.error.error ? e.error.error : WORDS_FALLBACK;
}

/**
 * The new employee's own start page (GET /v1/me) and their acceptance of the privacy notice
 * (POST /v1/me/consent). The notice text is the server's: the page shows it as sent. What is kept here
 * belongs to the person who is signed in and is dropped when they sign out or someone else signs in.
 */
@Injectable({ providedIn: 'root' })
export class StartService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  private readonly current = signal<StartState>({ kind: 'loading' });
  private owner: string | null = null;
  private loading: Promise<void> | null = null;

  readonly state = this.current.asReadonly();
  /** The company, once known, for the sidebar. */
  readonly company = computed(() => {
    const s = this.current();
    return s.kind === 'ready' ? s.me.company : '';
  });

  /** Asks for the start page, unless this person's answer is already here (`force` asks again). */
  load(force = false): Promise<void> {
    const sub = this.auth.user()?.sub ?? null;
    if (this.owner !== sub) this.forget();
    this.owner = sub;
    if (this.loading) return this.loading;
    if (!force && this.current().kind === 'ready') return Promise.resolve();
    if (this.current().kind !== 'ready') this.current.set({ kind: 'loading' });
    this.loading = this.fetch().finally(() => { this.loading = null; });
    return this.loading;
  }

  /** Records the acceptance of `version`. A 409 reloads the page with the new notice. */
  async accept(version: string): Promise<AcceptResult> {
    const headers = await this.headers();
    if (!headers) return { kind: 'offline' };
    try {
      const saved = await firstValueFrom(this.http.post<{ version: string; acceptedAt: string }>(`${environment.employeesApiUrl}/v1/me/consent`, { version }, { headers }));
      const s = this.current();
      if (s.kind === 'ready') this.current.set({ kind: 'ready', me: { ...s.me, consent: { version: saved.version, acceptedAt: saved.acceptedAt } } });
      return { kind: 'saved', acceptedAt: saved.acceptedAt };
    } catch (e) {
      if (!(e instanceof HttpErrorResponse)) return { kind: 'offline' };
      if (e.status === 409) {
        await this.load(true);
        return { kind: 'changed' };
      }
      if (e.status === 403 || e.status === 404) {
        const message = wordsOf(e);
        this.current.set({ kind: 'refused', message });
        return { kind: 'refused', message };
      }
      return { kind: 'offline' };
    }
  }

  /** Forgets everything kept for the last person, for sign out. */
  forget(): void {
    this.current.set({ kind: 'loading' });
    this.owner = null;
    this.loading = null;
  }

  private async fetch(): Promise<void> {
    const headers = await this.headers();
    if (!headers) {
      this.current.set({ kind: 'offline' });
      return;
    }
    try {
      const me = await firstValueFrom(this.http.get<MyStart>(`${environment.employeesApiUrl}/v1/me`, { headers }));
      this.current.set({ kind: 'ready', me });
    } catch (e) {
      if (e instanceof HttpErrorResponse && (e.status === 403 || e.status === 404)) this.current.set({ kind: 'refused', message: wordsOf(e) });
      else this.current.set({ kind: 'offline' });
    }
  }

  private async headers(): Promise<HttpHeaders | null> {
    const token = await this.auth.idToken();
    return token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : null;
  }
}
