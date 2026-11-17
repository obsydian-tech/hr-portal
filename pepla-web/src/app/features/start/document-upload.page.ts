import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import {
  PpButton, PpField, PpFile, PpFileList, PpFileUpload, PpInlineMessage, PpPageHeader, PpSectionMessage, PpSectionMessageActions,
  PpSkeleton, PpSkeletonGroup, formatDate, type Crumb,
} from '../../ds';
import { SIGN_IN_MESSAGES } from '../../core/auth/auth.messages';
import { MyDocumentsService, uploadTypeOf, type DocumentType, type Sending } from '../../core/start/my-documents.service';
import { DOCUMENT_INFO, STATE_WORDS, typeOfSlug } from './document-types';

const BAD_FILE = "This file can't be used. Use a PDF, JPG or PNG up to 10 MB.";
const HINT = 'PDF, JPG or PNG, up to 10 MB. A phone photo is fine if all four corners show.';
const NOTE = 'Files upload as soon as you pick them.';
const MB = 1024 * 1024;

/** A file the person picked on this page that has not reached HR: on its way, or failed. */
interface Attempt {
  id: number;
  file: File;
  state: 'uploading' | 'error';
  loaded: number;
  /** Why it failed, in words. */
  message: string;
  /** False for the server's own refusal: sending it again would not help. */
  again: boolean;
}

const megabytes = (bytes: number) => `${Number((bytes / MB).toFixed(1))}`;
const sizeText = (bytes: number) => (bytes >= MB ? `${megabytes(bytes)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/**
 * One document's upload page (ONB-06): pick a photo or a PDF and it goes straight to S3 on a link the server made for
 * this person. The page checks the type and size first and sends nothing for a file that cannot be used.
 */
@Component({
  selector: 'app-document-upload',
  imports: [RouterLink, PpButton, PpField, PpFile, PpFileList, PpFileUpload, PpInlineMessage, PpPageHeader, PpSectionMessage, PpSectionMessageActions, PpSkeleton, PpSkeletonGroup],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-stack pp-gap-300">
      <pp-page-header [heading]="info().name" [description]="info().description" [breadcrumbs]="crumbs" />

      @switch (service.state().kind) {
        @case ('loading') {
          <pp-skeleton-group label="Loading your documents" class="pp-stack pp-gap-200">
            <pp-skeleton shape="text" width="60%" />
            <pp-skeleton shape="card" />
          </pp-skeleton-group>
        }
        @case ('refused') {
          <pp-section-message tone="danger">{{ refusal() }}</pp-section-message>
        }
        @case ('offline') {
          <pp-section-message tone="danger">{{ offline }}
            <pp-section-message-actions><button ppButton type="button" size="large" (click)="reload()">Try again</button></pp-section-message-actions>
          </pp-section-message>
        }
        @case ('ready') {
          <pp-field label="Add a file" group="list" [error]="error()">
            <pp-file-upload dropText="Drag your file here, or " button="Take a photo or choose a file" [hint]="hint" accept=".pdf,.jpg,.jpeg,.png" [multiple]="many()" [large]="true" (files)="pick($event)" />
          </pp-field>

          <p class="pp-visually-hidden" role="status">{{ announcement() }}</p>
          <div>
            <pp-file-list [label]="info().name">
              @for (a of attempts(); track a.id) {
                @if (a.state === 'uploading') {
                  <pp-file [name]="a.file.name" [size]="size(a.file)" state="uploading" [progress]="percent(a)" [progressText]="'Uploading, ' + megabytes(a.loaded) + ' of ' + megabytes(a.file.size) + ' MB'" (cancel)="cancel(a)" />
                } @else {
                  <pp-file [name]="a.file.name" [size]="size(a.file)" state="error" [error]="a.message" [retryable]="a.again" buttonSize="large" (retry)="retry(a)" (remove)="dismiss(a)" />
                }
              }
              @for (f of stored(); track f.fileName + f.uploadedAt) {
                <pp-file [name]="f.fileName" [size]="'Uploaded ' + date(f.uploadedAt)" state="done" [removable]="false" [statusText]="words[f.state].text" [statusTone]="f.state === 'SENT_BACK' ? 'danger' : 'success'" [statusIcon]="words[f.state].icon" />
              }
            </pp-file-list>
          </div>

          <pp-inline-message>{{ note }}</pp-inline-message>
        }
      }

      <div><a ppButton size="large" routerLink="/start">Back to your documents</a></div>
    </div>
  `,
})
export class DocumentUploadPage {
  protected readonly service = inject(MyDocumentsService);
  private readonly route = inject(ActivatedRoute);

  protected readonly offline = SIGN_IN_MESSAGES.offline;
  protected readonly hint = HINT;
  protected readonly note = NOTE;
  protected readonly words = STATE_WORDS;
  protected readonly megabytes = megabytes;
  protected readonly crumbs: Crumb[] = [{ label: 'Your documents', link: '/start' }];

  private readonly slug = toSignal(this.route.paramMap.pipe(map((p) => p.get('type'))), { initialValue: this.route.snapshot.paramMap.get('type') });
  protected readonly type = computed<DocumentType>(() => typeOfSlug(this.slug()) ?? 'NATIONAL_ID');
  protected readonly info = computed(() => DOCUMENT_INFO[this.type()]);
  /** Only qualifications can be many. */
  protected readonly many = computed(() => this.type() === 'TERTIARY_QUALIFICATION');

  protected readonly error = signal<string | null>(null);
  /** Said to screen readers when a file has reached HR. */
  protected readonly announcement = signal('');
  protected readonly attempts = signal<Attempt[]>([]);
  private readonly sending = new Map<number, Sending>();
  private next = 0;

  protected readonly refusal = computed(() => {
    const s = this.service.state();
    return s.kind === 'refused' ? s.message : '';
  });
  /** The files the server holds for this document: all of them for qualifications, else the newest one. */
  protected readonly stored = computed(() => {
    const files = this.service.documents().find((d) => d.type === this.type())?.files ?? [];
    return this.many() ? files : files.slice(0, 1);
  });

  constructor() {
    void this.service.load();
  }

  protected reload(): void {
    void this.service.load(true);
  }

  protected size(file: File): string {
    return sizeText(file.size);
  }

  protected percent(a: Attempt): number {
    return a.file.size ? Math.min(100, Math.round((a.loaded / a.file.size) * 100)) : 0;
  }

  protected date(iso: string): string {
    return iso ? formatDate(iso, { year: true }) : '';
  }

  protected pick(files: File[]): void {
    this.error.set(null);
    const chosen = this.many() ? files : files.slice(0, 1);
    for (const file of chosen) {
      if (uploadTypeOf(file) === null) {
        this.error.set(BAD_FILE);
        continue;
      }
      const attempt: Attempt = { id: this.next++, file, state: 'uploading', loaded: 0, message: '', again: true };
      this.attempts.update((list) => [...list, attempt]);
      this.begin(attempt.id);
    }
  }

  protected retry(a: Attempt): void {
    if (a.state !== 'error' || this.sending.has(a.id)) return;
    this.begin(a.id);
  }

  protected cancel(a: Attempt): void {
    this.sending.get(a.id)?.cancel();
    this.sending.delete(a.id);
    this.attempts.update((list) => list.filter((x) => x.id !== a.id));
  }

  protected dismiss(a: Attempt): void {
    this.attempts.update((list) => list.filter((x) => x.id !== a.id));
  }

  private begin(id: number): void {
    const attempt = this.attempts().find((a) => a.id === id);
    if (!attempt) return;
    this.change(id, { state: 'uploading', loaded: 0, message: '' });
    const task = this.service.send(this.type(), attempt.file, (loaded) => this.change(id, { loaded }));
    this.sending.set(id, task);
    void task.done.then((result) => {
      if (this.sending.get(id) !== task) return;
      this.sending.delete(id);
      if (result.kind === 'done') {
        this.announcement.set(`${attempt.file.name}: ${STATE_WORDS.WITH_HR.text}`);
        this.attempts.update((list) => list.filter((x) => x.id !== id));
      }
      else if (result.kind === 'refused') this.change(id, { state: 'error', message: result.message, again: false });
      else if (result.kind === 'offline') this.change(id, { state: 'error', message: result.message, again: true });
    });
  }

  private change(id: number, patch: Partial<Attempt>): void {
    this.attempts.update((list) => list.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }
}
