import { HttpClient, HttpErrorResponse, HttpEventType, HttpHeaders } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Subscription, firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { SIGN_IN_MESSAGES } from '../auth/auth.messages';

export const DOCUMENT_TYPES = ['NATIONAL_ID', 'BANK_CONFIRMATION', 'MATRIC_CERTIFICATE', 'TERTIARY_QUALIFICATION'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export type DocumentState = 'NOT_UPLOADED' | 'WITH_HR' | 'SENT_BACK' | 'ACCEPTED';
export type FileState = Exclude<DocumentState, 'NOT_UPLOADED'>;

/** One file as the server lists it: its name, when it was uploaded and its state. */
export interface MyFile { fileName: string; uploadedAt: string; state: FileState }
/** One of the four documents as the server lists it. */
export interface MyDocument { type: DocumentType; required: boolean; state: DocumentState; files: MyFile[] }

export type DocumentsState =
  | { kind: 'loading' }
  | { kind: 'ready'; documents: MyDocument[] }
  /** 403 or 404: the server's own words. */
  | { kind: 'refused'; message: string }
  /** A 5xx, no answer, or anything else: "We can't reach Naleko People". */
  | { kind: 'offline' };

export type SendResult =
  | { kind: 'done' }
  | { kind: 'cancelled' }
  /** 400, 403 or 404 from the link request: the server's words. Trying again would not help. */
  | { kind: 'refused'; message: string }
  /** No answer, a 5xx, or S3 refusing the file: the connection words. Trying again can help. */
  | { kind: 'offline'; message: string };

export interface Sending {
  cancel(): void;
  done: Promise<SendResult>;
}

/** 10 MB (W-1), counted as 10 x 1,048,576 bytes. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const TYPES_BY_EXTENSION: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
/** A list that is this old is asked for again when the page opens. */
const FRESH_MS = 60_000;
const WORDS_FALLBACK = 'Something went wrong';

/** The content type to send for this file, or null when it is not a PDF, JPG or PNG within the limit. */
export function uploadTypeOf(file: File): string | null {
  if (file.size < 1 || file.size > MAX_FILE_BYTES) return null;
  const ext = /\.([A-Za-z0-9]+)$/.exec(file.name)?.[1]?.toLowerCase() ?? '';
  const mime = file.type === 'image/jpg' ? 'image/jpeg' : file.type;
  if (ALLOWED_TYPES.includes(mime)) return mime;
  if ((mime === '' || mime === 'application/octet-stream') && TYPES_BY_EXTENSION[ext]) return TYPES_BY_EXTENSION[ext];
  return null;
}

function wordsOf(e: HttpErrorResponse): string {
  return typeof e.error?.error === 'string' && e.error.error ? e.error.error : WORDS_FALLBACK;
}

/**
 * The new employee's own documents (GET /v1/me/documents) and the upload of one file (POST /v1/me/documents/upload-url,
 * then a PUT straight to S3). The sign-in token goes to the API only, never to S3. What is kept here belongs to the
 * person who is signed in and is dropped when they sign out or someone else signs in.
 */
@Injectable({ providedIn: 'root' })
export class MyDocumentsService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  private readonly current = signal<DocumentsState>({ kind: 'loading' });
  private owner: string | null = null;
  private loadedAt = 0;
  private loading: Promise<void> | null = null;

  readonly state = this.current.asReadonly();
  readonly documents = computed(() => {
    const s = this.current();
    return s.kind === 'ready' ? s.documents : [];
  });

  /** Asks for the list, unless this person's answer is already here and recent (`force` asks again). */
  load(force = false): Promise<void> {
    const sub = this.auth.user()?.sub ?? null;
    if (this.owner !== sub) this.forget();
    this.owner = sub;
    if (this.loading) return this.loading;
    if (!force && this.current().kind === 'ready' && Date.now() - this.loadedAt < FRESH_MS) return Promise.resolve();
    if (this.current().kind !== 'ready') this.current.set({ kind: 'loading' });
    this.loading = this.fetch().finally(() => { this.loading = null; });
    return this.loading;
  }

  /** Forgets everything kept for the last person, for sign out. */
  forget(): void {
    this.current.set({ kind: 'loading' });
    this.owner = null;
    this.loadedAt = 0;
    this.loading = null;
  }

  /**
   * Asks for a link, then puts the file to it. `onProgress` gets the bytes sent so far.
   * The file's type and size were checked by the page; the server and S3 check them again.
   */
  send(type: DocumentType, file: File, onProgress: (loaded: number) => void): Sending {
    let cancelled = false;
    let putting: Subscription | undefined;
    let finish!: (r: SendResult) => void;
    const done = new Promise<SendResult>((resolve) => { finish = resolve; });
    const offline: SendResult = { kind: 'offline', message: SIGN_IN_MESSAGES.offline };

    const run = async (): Promise<void> => {
      const contentType = uploadTypeOf(file);
      const headers = await this.headers();
      if (cancelled) return;
      if (!contentType || !headers) return finish(offline);
      let link: { url: string; headers?: Record<string, string> };
      try {
        link = await firstValueFrom(this.http.post<{ url: string; headers?: Record<string, string> }>(
          `${environment.employeesApiUrl}/v1/me/documents/upload-url`,
          { documentType: type, fileName: file.name, contentType, fileSize: file.size },
          { headers },
        ));
      } catch (e) {
        if (cancelled) return;
        if (e instanceof HttpErrorResponse && [400, 403, 404].includes(e.status)) return finish({ kind: 'refused', message: wordsOf(e) });
        return finish(offline);
      }
      if (cancelled) return;
      if (typeof link?.url !== 'string' || !link.url.startsWith('https://')) return finish(offline);
      // Only the headers the link names (Content-Type): the sign-in token never goes to S3.
      putting = this.http.put(link.url, file, { headers: new HttpHeaders(link.headers ?? { 'Content-Type': contentType }), observe: 'events', reportProgress: true, responseType: 'text' }).subscribe({
        next: (event) => {
          if (event.type === HttpEventType.UploadProgress) onProgress(event.loaded);
          if (event.type === HttpEventType.Response) {
            this.recordUpload(type, file.name);
            finish({ kind: 'done' });
          }
        },
        error: () => finish(offline),
      });
    };
    void run();

    return {
      cancel: () => {
        cancelled = true;
        putting?.unsubscribe();
        finish({ kind: 'cancelled' });
      },
      done,
    };
  }

  /** The file is with HR from the moment S3 answers 2xx: the list shows it without asking again. */
  private recordUpload(type: DocumentType, fileName: string): void {
    const s = this.current();
    if (s.kind !== 'ready') return;
    const file: MyFile = { fileName, uploadedAt: new Date().toISOString(), state: 'WITH_HR' };
    this.current.set({
      kind: 'ready',
      documents: s.documents.map((d) => (d.type === type ? { ...d, state: 'WITH_HR', files: [file, ...d.files] } : d)),
    });
  }

  private async fetch(): Promise<void> {
    const headers = await this.headers();
    if (!headers) {
      this.current.set({ kind: 'offline' });
      return;
    }
    try {
      const answer = await firstValueFrom(this.http.get<{ documents: MyDocument[] }>(`${environment.employeesApiUrl}/v1/me/documents`, { headers }));
      this.current.set({ kind: 'ready', documents: answer.documents });
      this.loadedAt = Date.now();
    } catch (e) {
      if (e instanceof HttpErrorResponse && (e.status === 403 || e.status === 404)) this.current.set({ kind: 'refused', message: wordsOf(e) });
      else if (this.current().kind !== 'ready') this.current.set({ kind: 'offline' });
    }
  }

  private async headers(): Promise<HttpHeaders | null> {
    const token = await this.auth.idToken();
    return token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : null;
  }
}
