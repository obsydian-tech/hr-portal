import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PpButton, PpDeadline, PpDocumentChecklist, PpDocumentRow, PpLozenge, PpSectionMessage, PpSectionMessageActions, PpSkeleton, PpSkeletonGroup, formatDate } from '../../ds';
import { SIGN_IN_MESSAGES } from '../../core/auth/auth.messages';
import { deadlineOf } from '../../core/deadline';
import { todayInSouthAfrica } from '../../core/employees/employee';
import { StartService } from '../../core/start/start.service';
import { DOCUMENT_TYPES, MyDocumentsService, type DocumentType } from '../../core/start/my-documents.service';
import { DOCUMENT_INFO, SENT_BACK_BUTTON, STATE_WORDS, returnedLine } from './document-types';

const TERTIARY_META = 'Degree, diploma or certificate. You can add more than one.';

/**
 * The four documents on a new employee's Today page, once the privacy notice is accepted (ONB-06).
 * It asks for the list only when it is shown, so nothing is asked before consent.
 */
@Component({
  selector: 'app-documents-checklist',
  imports: [RouterLink, PpButton, PpDeadline, PpDocumentChecklist, PpDocumentRow, PpLozenge, PpSectionMessage, PpSectionMessageActions, PpSkeleton, PpSkeletonGroup],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (service.state().kind) {
      @case ('loading') {
        <pp-skeleton-group label="Loading your documents" class="pp-stack pp-gap-200">
          <pp-skeleton shape="text" width="40%" />
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
        <pp-document-checklist heading="Upload your documents" subheading="Batsi reads your ID and bank letter. HR decides every document." [done]="done()" [total]="4" progressLabel="Complete" [progressText]="done() + ' of 4 complete'">
          @for (r of rows(); track r.type) {
            <li ppDocumentRow [name]="r.name" [icon]="r.icon" [meta]="r.meta" [status]="r.tone" [statusText]="r.stateText" [statusIcon]="r.stateIcon" [reason]="r.reason" [next]="r.next">
              @if (r.required) { <pp-lozenge>Required</pp-lozenge> }
              @if (r.due; as due) { <time ppDeadline [inline]="true" [due]="due.at" [now]="due.now" [warnDays]="3" [text]="due.words"></time> }
              @if (r.due; as due) { <span class="pp-text pp-text--small pp-text--subtle">Due {{ due.dateText }}</span> }
              @if (r.canUpload) { <a ppButton size="large" [routerLink]="r.link">{{ r.button }}</a> }
            </li>
          }
        </pp-document-checklist>
      }
    }
  `,
})
export class DocumentsChecklist {
  protected readonly service = inject(MyDocumentsService);
  private readonly start = inject(StartService);
  protected readonly offline = SIGN_IN_MESSAGES.offline;

  protected readonly refusal = computed(() => {
    const s = this.service.state();
    return s.kind === 'refused' ? s.message : '';
  });
  protected readonly done = computed(() => this.service.documents().filter((d) => d.state === 'ACCEPTED').length);

  /** When the required documents are due, from the cached start page (no extra call). Empty when it is not known. */
  private readonly documentsDue = computed(() => {
    const s = this.start.state();
    return s.kind === 'ready' ? (s.me.documentsDue ?? '') : '';
  });

  protected readonly rows = computed(() => {
    const today = todayInSouthAfrica();
    const deadline = deadlineOf(this.documentsDue(), today);
    const byType = new Map(this.service.documents().map((d) => [d.type, d]));
    // The next document to ask for: the first required or other one still missing or sent back.
    const next = DOCUMENT_TYPES.find((t) => ['NOT_UPLOADED', 'SENT_BACK'].includes(byType.get(t)?.state ?? 'NOT_UPLOADED'));
    return DOCUMENT_TYPES.map((type: DocumentType) => {
      const d = byType.get(type);
      const state = d?.state ?? 'NOT_UPLOADED';
      const info = DOCUMENT_INFO[type];
      const words = STATE_WORDS[state];
      const newest = d?.files[0];
      // Qualifications show a reason on the file it belongs to (the upload page), not on this row.
      const sentBack = state === 'SENT_BACK' && type !== 'TERTIARY_QUALIFICATION' ? newest : undefined;
      return {
        type,
        name: info.name,
        icon: info.icon,
        meta: type === 'TERTIARY_QUALIFICATION' ? TERTIARY_META : newest ? `Uploaded ${formatDate(newest.uploadedAt, { year: true })}${sentBack ? returnedLine(sentBack) : ''}` : '',
        // HR's reason, as text, only on a sent-back row; none recorded means no reason line (W-3).
        reason: sentBack?.reason ?? undefined,
        required: d?.required ?? false,
        tone: words.tone,
        stateText: words.text,
        stateIcon: words.icon,
        next: type === next,
        canUpload: type === 'TERTIARY_QUALIFICATION' || state === 'NOT_UPLOADED' || state === 'SENT_BACK',
        button: state === 'SENT_BACK' ? SENT_BACK_BUTTON[type] : info.button,
        link: `/start/documents/${info.slug}`,
        // A due chip only on a required document still to give: not one waiting for HR, accepted, or optional.
        due:
          deadline && (d?.required ?? false) && (state === 'NOT_UPLOADED' || state === 'SENT_BACK')
            // Midday, so the design system's chip counts the same whole days in any browser time zone.
            ? { words: deadline.words, dateText: deadline.dateText, at: `${this.documentsDue()}T12:00:00`, now: new Date(`${today}T12:00:00`) }
            : null,
      };
    });
  });

  constructor() {
    void this.service.load();
  }

  protected reload(): void {
    void this.service.load(true);
  }
}
