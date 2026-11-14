import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, viewChild, type ElementRef } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import {
  PpAgentMark, PpButton, PpButtonGroup, PpCard, PpCardFooter, PpConfidence, PpDescriptionList, PpDl, PpEmptyState, PpEmptyStateActions,
  PpField, PpInlineMessage, PpLink, PpLozenge, PpPageHeader, PpPageHeaderActions, PpSectionMessage, PpSectionMessageActions, PpSkeleton,
  PpSkeletonGroup, PpTextarea, PpVerification, PpVerificationBy, type ConfidenceSource, type Crumb, type DlItem, type IconName,
} from '../../ds';
import { dayAndTime, onAt, type Decided, type DocumentDetail } from '../../core/documents/document';
import { DocumentError, DocumentService } from '../../core/documents/document.service';
import { DocumentsService } from '../../core/documents/documents.service';
import { DECISION_WORD, type Check } from '../../core/employees/employee-detail';

const TITLE = 'Naleko People';
const MAX_REASON = 500;

const RESULT: Record<Check, 'reading' | 'matches' | 'check' | 'mismatch'> = {
  READING: 'reading',
  MATCHES: 'matches',
  NEEDS_A_LOOK: 'check',
  DOESNT_MATCH: 'mismatch',
};

const TYPE_ICON: Record<string, IconName> = {
  NATIONAL_ID: 'id-card',
  BANK_CONFIRMATION: 'landmark',
  MATRIC_CERTIFICATE: 'graduation-cap',
  TERTIARY_QUALIFICATION: 'graduation-cap',
};

/**
 * One document, for HR (ONB-15): the file, what Batsi read from it, how that compares with the employee's
 * record, and Batsi's check. HR accepts it or asks for a new one (a reason is required); the decision is final.
 * ID and account numbers are Hidden until HR presses Show. It calls the three document routes and nothing
 * else: the file link only when HR presses Open document, and no summary, Batsi or AI route.
 */
@Component({
  selector: 'app-document',
  imports: [
    RouterLink, PpAgentMark, PpButton, PpButtonGroup, PpCard, PpCardFooter, PpConfidence, PpDescriptionList, PpDl, PpEmptyState,
    PpEmptyStateActions, PpField, PpInlineMessage, PpLink, PpLozenge, PpPageHeader, PpPageHeaderActions, PpSectionMessage,
    PpSectionMessageActions, PpSkeleton, PpSkeletonGroup, PpTextarea, PpVerification, PpVerificationBy,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-stack pp-gap-300">
      @switch (status()) {
        @case ('loading') {
          <pp-page-header heading="Document" [breadcrumbs]="crumbs" />
          <pp-skeleton-group label="Loading this document" class="pp-stack pp-gap-200">
            @for (n of placeholders; track n) { <pp-skeleton shape="card" /> }
          </pp-skeleton-group>
        }
        @case ('not-found') {
          <pp-page-header heading="Document" [breadcrumbs]="crumbs" />
          <pp-empty-state heading="This document could not be found.">
            <pp-empty-state-actions>
              <a ppLink routerLink="/hr/documents">Back to Documents to check</a>
            </pp-empty-state-actions>
          </pp-empty-state>
        }
        @case ('forbidden') {
          <pp-page-header heading="Document" [breadcrumbs]="crumbs" />
          <pp-empty-state heading="Only HR can open documents." />
        }
        @case ('failed') {
          <pp-page-header heading="Document" [breadcrumbs]="crumbs" />
          <pp-section-message tone="danger" heading="This document could not be loaded.">
            Check your connection and try again.
            <pp-section-message-actions>
              <button ppButton type="button" (click)="load()">Try again</button>
            </pp-section-message-actions>
          </pp-section-message>
        }
        @default {
          @if (doc(); as d) {
            <pp-page-header [heading]="heading()" [breadcrumbs]="crumbs">
              @if (d.employeeId) {
                <pp-page-header-actions>
                  <a ppButton icon="user" [routerLink]="['/hr/employees', d.employeeId]">View employee</a>
                </pp-page-header-actions>
              }
            </pp-page-header>
            <p class="pp-inline pp-gap-100 pp-text pp-text--subtle">
              @if (d.employeeName) {
                <a ppLink [routerLink]="['/hr/employees', d.employeeId]">{{ d.employeeName }}</a>
                <span aria-hidden="true">·</span>
              }
              <span>Uploaded {{ uploaded() }}</span>
            </p>

            <div class="pp-columns pp-columns--wide-aside pp-gap-300">
              <div class="pp-stack pp-gap-200">
                <pp-verification heading="What Batsi found" subheading="Read from the uploaded document" [icon]="icon()" [result]="result()" [checks]="d.compared ?? []">
                  @if (d.check === 'READING') {
                    <p class="pp-text">Batsi is still reading this document.</p>
                  } @else {
                    @if (d.compared === null) {
                      <p class="pp-text">Nothing on the record to compare for this document type.</p>
                    }
                    <dl ppDl>
                      <dt>How sure</dt>
                      <dd><pp-confidence [level]="d.confidence" [sources]="1" [items]="sources()" /></dd>
                      <dt>By</dt>
                      <dd><pp-verification-by><pp-agent-mark text="Checked by Batsi" /></pp-verification-by></dd>
                    </dl>
                  }
                </pp-verification>

                @if (d.check !== 'READING') {
                  <pp-card heading="What Batsi read" [level]="2" icon="list">
                    @if (d.rows) {
                      <pp-description-list [items]="d.rows" />
                    } @else {
                      <p class="pp-text">Batsi does not read fields from this document type.</p>
                    }
                  </pp-card>
                }

                <pp-card [heading]="decisionHeading()" [subheading]="decisionSubheading()" [level]="2" icon="gavel">
                  @if (notice() === 'saved') {
                    <pp-section-message tone="success">Your choice is recorded with your name and the time.</pp-section-message>
                  } @else if (notice() === 'already') {
                    <pp-section-message tone="warning">This document was already decided.</pp-section-message>
                  }
                  @if (saveFailed()) {
                    <pp-section-message tone="danger">Your choice could not be saved. Try again.</pp-section-message>
                  }

                  @if (view(); as v) {
                    <div class="pp-stack pp-gap-100">
                      <div><pp-lozenge [status]="v.decision === 'ACCEPTED' ? 'success' : 'warning'">{{ decisionWord(v) }}</pp-lozenge></div>
                      <p class="pp-text">{{ decidedLine(v) }}</p>
                      @if (v.decision === 'NEW_ONE_ASKED') {
                        <p class="pp-text">{{ v.reason ? 'Reason: ' + v.reason : 'No reason was recorded.' }}</p>
                      }
                    </div>
                  } @else if (d.check === 'READING') {
                    <pp-inline-message>HR can decide once Batsi has read this document.</pp-inline-message>
                  }
                  @if (asking() && !view() && d.check !== 'READING') {
                    <pp-field label="Reason" help="Kept with the decision." [required]="true" [error]="reasonError()" [count]="reason().length + ' of ' + maxReason" [over]="reason().length > maxReason">
                      <textarea ppTextarea #reasonBox rows="3" [attr.maxlength]="maxReason" [value]="reason()" (input)="typed($event)"></textarea>
                    </pp-field>
                  }
                  @if (!view() && d.check !== 'READING') {
                    <pp-card-footer>
                      <pp-button-group [stackPhone]="true">
                        @if (asking()) {
                          <button ppButton appearance="primary" icon="x" type="button" [busy]="sending() === 'ask'" (click)="send('FAILED')">Ask for a new one</button>
                          <button ppButton type="button" [disabled]="!!sending()" (click)="cancel()">Cancel</button>
                        } @else {
                          <button ppButton appearance="primary" icon="check" type="button" [busy]="sending() === 'accept'" (click)="send('PASSED')">Accept document</button>
                          <button ppButton icon="x" type="button" [disabled]="!!sending()" (click)="ask()">Ask for a new one</button>
                        }
                      </pp-button-group>
                      <span class="pp-inline pp-gap-050 pp-text pp-text--small pp-text--subtlest">Your choice is recorded with your name and the time.</span>
                    </pp-card-footer>
                  }
                </pp-card>
              </div>

              <pp-card heading="Uploaded document" [subheading]="d.fileName" [level]="2" icon="file-text">
                <pp-description-list layout="stacked" [items]="fileFacts()" />
                <pp-card-footer>
                  <button ppButton icon="external-link" type="button" [busy]="opening()" (click)="open()">Open document</button>
                  @if (openFailed()) {
                    <pp-inline-message tone="error">The document could not be opened. Try again.</pp-inline-message>
                  }
                </pp-card-footer>
              </pp-card>
            </div>
          }
        }
      }
    </div>
  `,
})
export class DocumentPage {
  private readonly documents = inject(DocumentService);
  private readonly waiting = inject(DocumentsService);
  private readonly title = inject(Title);
  private readonly id = toSignal(inject(ActivatedRoute).paramMap.pipe(map((m) => m.get('id') ?? '')), { initialValue: '' });

  protected readonly crumbs: Crumb[] = [
    { label: 'Home', link: '/hr' },
    { label: 'Documents to check', link: '/hr/documents' },
  ];
  protected readonly placeholders = [1, 2, 3];
  protected readonly maxReason = MAX_REASON;

  protected readonly status = signal<'loading' | 'ready' | 'not-found' | 'forbidden' | 'failed'>('loading');
  protected readonly doc = signal<DocumentDetail | null>(null);
  /** HR's decision made on this page, from the answer to the PATCH; the document is not read again. */
  private readonly decidedNow = signal<Decided | null>(null);
  protected readonly view = computed(() => this.decidedNow() ?? this.doc()?.decided ?? null);
  protected readonly notice = signal<'saved' | 'already' | null>(null);

  protected readonly asking = signal(false);
  protected readonly reason = signal('');
  protected readonly reasonError = signal<string | null>(null);
  protected readonly sending = signal<'accept' | 'ask' | null>(null);
  protected readonly saveFailed = signal(false);
  protected readonly opening = signal(false);
  protected readonly openFailed = signal(false);

  private readonly reasonBox = viewChild<ElementRef<HTMLTextAreaElement>>('reasonBox');

  protected readonly heading = computed(() => {
    const d = this.doc();
    if (!d) return 'Document';
    return d.employeeName ? `${d.typeName}, ${d.employeeName}` : d.typeName;
  });
  protected readonly icon = computed<IconName>(() => TYPE_ICON[this.doc()?.type ?? ''] ?? 'file-text');
  protected readonly result = computed(() => RESULT[this.doc()?.check ?? 'READING']);
  protected readonly uploaded = computed(() => dayAndTime(this.doc()?.uploadedAt));
  protected readonly fileFacts = computed<DlItem[]>(() => {
    const d = this.doc();
    if (!d) return [];
    return [
      { term: 'Type', value: d.typeName },
      { term: 'Uploaded', value: dayAndTime(d.uploadedAt) },
      { term: 'Checked', value: d.checkedAt ? dayAndTime(d.checkedAt) : 'Not yet' },
    ];
  });
  /** The one document Batsi read, for the "What Batsi read" panel behind How sure. */
  protected readonly sources = computed<ConfidenceSource[]>(() => {
    const d = this.doc();
    if (!d) return [];
    return [{ icon: this.icon(), label: d.fileName || d.typeName, link: `/hr/documents/${encodeURIComponent(d.id)}`, found: d.checkWord, mismatch: d.check === 'DOESNT_MATCH' }];
  });
  protected readonly decisionHeading = computed(() => (this.view() ? 'Decision' : 'Your decision'));
  protected readonly decisionSubheading = computed(() => {
    const d = this.doc();
    if (!d || this.view() || d.check === 'READING') return undefined;
    return `Batsi's check only flags what does not match. HR decides: accept the document, or ask ${d.firstName || 'the employee'} for a new one.`;
  });

  constructor() {
    effect(() => {
      this.id();
      void this.load();
    });
    // Focus goes to the Reason field when it opens.
    effect(() => {
      const box = this.reasonBox();
      if (box) queueMicrotask(() => box.nativeElement.focus());
    });
  }

  /** The employee, when the list or the employee page passed it on: the API then reads the document directly. */
  private employeeHint(): string | undefined {
    const hint = (history.state as { employeeId?: unknown } | null)?.employeeId;
    return typeof hint === 'string' && hint ? hint : undefined;
  }

  protected async load(quiet = false): Promise<void> {
    const id = this.id();
    if (!quiet) {
      this.status.set('loading');
      this.doc.set(null);
      this.decidedNow.set(null);
      this.notice.set(null);
      this.asking.set(false);
      this.reason.set('');
      this.reasonError.set(null);
      this.saveFailed.set(false);
      this.openFailed.set(false);
    }
    try {
      const doc = await this.documents.load(id, this.employeeHint());
      if (id !== this.id()) return;
      this.doc.set(doc);
      this.decidedNow.set(null);
      this.title.setTitle(`${this.heading()} · ${TITLE}`);
      this.status.set('ready');
    } catch (err) {
      if (id !== this.id()) return;
      this.title.setTitle(`Document · ${TITLE}`);
      const reason = err instanceof DocumentError ? err.reason : 'failed';
      this.status.set(reason === 'not-found' ? 'not-found' : reason === 'forbidden' ? 'forbidden' : 'failed');
    }
  }

  protected ask(): void {
    this.saveFailed.set(false);
    this.asking.set(true);
  }

  protected cancel(): void {
    if (this.sending()) return;
    this.asking.set(false);
    this.reason.set('');
    this.reasonError.set(null);
    this.saveFailed.set(false);
  }

  protected typed(event: Event): void {
    this.reason.set((event.target as HTMLTextAreaElement).value);
    this.reasonError.set(null);
  }

  protected async send(decision: 'PASSED' | 'FAILED'): Promise<void> {
    const d = this.doc();
    if (!d || this.sending()) return;
    const reason = decision === 'FAILED' ? this.reason().trim() : '';
    if (decision === 'FAILED' && !reason) {
      this.reasonError.set('Enter a reason.');
      return;
    }
    if (reason.length > MAX_REASON) return;
    this.sending.set(decision === 'PASSED' ? 'accept' : 'ask');
    this.saveFailed.set(false);
    try {
      const decided = await this.documents.decide(d.id, d.employeeId, decision, reason);
      this.decidedNow.set(decided);
      this.notice.set('saved');
      this.asking.set(false);
      this.waiting.decided();
    } catch (err) {
      if (err instanceof DocumentError && err.reason === 'conflict') {
        // Someone decided first, or Batsi is still reading: show what is there now.
        this.asking.set(false);
        this.notice.set('already');
        await this.load(true);
      } else {
        this.saveFailed.set(true);
      }
    } finally {
      this.sending.set(null);
    }
  }

  protected async open(): Promise<void> {
    const d = this.doc();
    if (!d || this.opening()) return;
    this.opening.set(true);
    this.openFailed.set(false);
    try {
      const url = await this.documents.fileLink(d.id);
      window.open(url, '_blank', 'noopener');
    } catch {
      this.openFailed.set(true);
    } finally {
      this.opening.set(false);
    }
  }

  protected decisionWord(v: Decided): string {
    return DECISION_WORD[v.decision];
  }

  /** "Accepted by Thandi Demo-HR on 4 Nov 2026 at 10:00." An old decision with no name says so. */
  protected decidedLine(v: Decided): string {
    const word = DECISION_WORD[v.decision];
    const when = v.at ? onAt(v.at) : '';
    if (v.by) return `${word} by ${v.by}${when ? ' ' + when : ''}.`;
    return `${word}${when ? ' ' + when : ''}. Who decided was not recorded.`;
  }
}
