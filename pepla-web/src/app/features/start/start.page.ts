import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import {
  PpButton, PpCheckbox, PpConsent, PpConsentRecord, PpField, PpPageHeader, PpProgressTracker, PpSectionMessage, PpSectionMessageActions,
  PpSkeleton, PpSkeletonGroup, formatDate, type ConsentTerm, type Step,
} from '../../ds';
import { AuthService } from '../../core/auth/auth.service';
import { StartService } from '../../core/start/start.service';

const UNTICKED = 'Tick the box to agree before you continue.';
const OFFLINE = "We can't reach Naleko People. Check your connection and try again.";
const NOTICE_CHANGED = 'The privacy notice has changed. Read it and agree again.';

/**
 * A new employee's Today page (ONB-05): the declaration and consent form until they have accepted the
 * current privacy notice, then the record of it. Nothing about documents opens before they tick and accept.
 * The notice text is the server's, shown as sent. The server saves the acceptance with the time and the version.
 */
@Component({
  selector: 'app-start',
  imports: [PpButton, PpCheckbox, PpConsent, PpConsentRecord, PpField, PpPageHeader, PpProgressTracker, PpSectionMessage, PpSectionMessageActions, PpSkeleton, PpSkeletonGroup],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-stack pp-gap-300">
      <pp-page-header [heading]="heading()" [description]="subline()" />

      @switch (service.state().kind) {
        @case ('loading') {
          <pp-skeleton-group label="Loading your start page" class="pp-stack pp-gap-200">
            <pp-skeleton shape="text" width="60%" />
            <pp-skeleton shape="card" />
          </pp-skeleton-group>
        }
        @case ('refused') {
          <pp-section-message tone="danger">{{ refusal() }}</pp-section-message>
        }
        @case ('offline') {
          <pp-section-message tone="danger">{{ offline }}
            <pp-section-message-actions><button ppButton type="button" (click)="reload()">Try again</button></pp-section-message-actions>
          </pp-section-message>
        }
        @case ('ready') {
          @if (me(); as m) {
            <pp-progress-tracker label="Getting started, 2 steps" [steps]="steps()" />

            @if (m.consent) {
              <pp-consent-record
                #record
                tabindex="-1"
                [text]="'You agreed to the privacy notice (version ' + m.consent.version + ').'"
                [meta]="agreedAt()"
                [action]="{ text: 'Read the privacy notice', link: '/start/privacy-notice' }"
                [live]="justSaved()" />
            } @else {
              @if (changed()) {
                <pp-section-message tone="information">{{ noticeChanged }}</pp-section-message>
              }
              @if (failed()) {
                <pp-section-message tone="danger">{{ offline }}
                  <pp-section-message-actions><button ppButton type="button" (click)="accept()">Try again</button></pp-section-message-actions>
                </pp-section-message>
              }
              <form ppConsent [heading]="m.notice.title" [intro]="m.notice.intro" [terms]="terms()" choicesLabel="Your choice" noticeLink="/start/privacy-notice" submitText="Accept and continue" (agree)="accept()">
                <div aria-live="polite">
                  <pp-field [error]="error()">
                    <pp-checkbox #tick label="I have read and agree to the declaration above" description="Needed before you can upload documents" [mustTick]="true" [(value)]="ticked" (valueChange)="error.set(null)" />
                  </pp-field>
                </div>
              </form>
            }
          }
        }
      }
    </div>
  `,
})
export class StartPage {
  protected readonly service = inject(StartService);
  private readonly auth = inject(AuthService);
  private readonly injector = inject(Injector);

  protected readonly offline = OFFLINE;
  protected readonly noticeChanged = NOTICE_CHANGED;
  protected readonly ticked = signal(false);
  protected readonly error = signal<string | null>(null);
  /** The notice changed while the page was open (409). */
  protected readonly changed = signal(false);
  /** The last accept got no answer: the tick stays and Try again sends it once more. */
  protected readonly failed = signal(false);
  /** The acceptance was just saved on this page, so it is announced. */
  protected readonly justSaved = signal(false);
  private sending = false;

  private readonly tick = viewChild('tick', { read: ElementRef });
  private readonly record = viewChild('record', { read: ElementRef });

  protected readonly heading = computed(() => `Welcome, ${this.auth.user()?.givenName ?? ''}`);
  protected readonly me = computed(() => {
    const s = this.service.state();
    return s.kind === 'ready' ? s.me : null;
  });
  protected readonly refusal = computed(() => {
    const s = this.service.state();
    return s.kind === 'refused' ? s.message : '';
  });
  protected readonly subline = computed(() => {
    const m = this.me();
    if (!m) return undefined;
    const parts = [m.department, m.startDate ? `Starts ${formatDate(`${m.startDate}T12:00:00`, { year: true })}` : ''].filter(Boolean);
    return parts.length ? parts.join(' · ') : undefined;
  });
  protected readonly terms = computed<ConsentTerm[]>(() => (this.me()?.notice.terms ?? []).map((t) => ({ icon: t.icon as ConsentTerm['icon'], term: t.term, text: t.text })));
  protected readonly agreedAt = computed(() => {
    const c = this.me()?.consent;
    return c ? formatDate(c.acceptedAt, { year: true, time: true }) : '';
  });
  protected readonly steps = computed<Step[]>(() =>
    this.me()?.consent
      ? [{ label: 'Consent', state: 'done' }, { label: 'Documents', state: 'current', meta: 'Upload your ID and your bank letter.' }]
      : [{ label: 'Consent', state: 'current' }, { label: 'Documents', state: 'upcoming' }],
  );

  constructor() {
    void this.service.load();
  }

  protected reload(): void {
    void this.service.load(true);
  }

  protected async accept(): Promise<void> {
    const m = this.me();
    if (!m || m.consent || this.sending) return;
    if (!this.ticked()) {
      this.error.set(UNTICKED);
      (this.tick()?.nativeElement as HTMLElement | undefined)?.querySelector('input')?.focus();
      return;
    }
    this.sending = true;
    this.failed.set(false);
    try {
      const result = await this.service.accept(m.notice.version);
      if (result.kind === 'saved') {
        this.changed.set(false);
        this.justSaved.set(true);
        afterNextRender(() => (this.record()?.nativeElement as HTMLElement | undefined)?.focus(), { injector: this.injector });
      } else if (result.kind === 'changed') {
        this.ticked.set(false);
        this.changed.set(true);
      } else if (result.kind === 'offline') {
        this.failed.set(true);
      }
    } finally {
      this.sending = false;
    }
  }
}
