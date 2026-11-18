import { ChangeDetectionStrategy, Component, computed, effect, inject, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PpButton, PpCard, PpLozenge, PpPageHeader, PpProgressBar, PpProgressTracker, PpSectionMessage, PpSectionMessageActions, PpSkeleton, PpSkeletonGroup, type Step } from '../../ds';
import { SIGN_IN_MESSAGES } from '../../core/auth/auth.messages';
import { StartService, type OnboardingStep } from '../../core/start/start.service';
import { MyDocumentsService, type DocumentType } from '../../core/start/my-documents.service';
import { DOCUMENT_INFO } from './document-types';

/** The four steps in order, with the words each is called, and how many are done when it is the current one. */
const STEPS: ReadonlyArray<{ code: OnboardingStep; word: string }> = [
  { code: 'INVITED', word: 'Invited' },
  { code: 'DOCUMENTS', word: 'Documents' },
  { code: 'IN_REVIEW', word: 'In review' },
  { code: 'VERIFIED', word: 'Verified' },
];
/** How many steps are done at each step (Verified is the end: all four). */
const DONE: Record<OnboardingStep, number> = { INVITED: 0, DOCUMENTS: 1, IN_REVIEW: 2, VERIFIED: 4 };

const WORDS = {
  documentsDone: 'Your ID and bank letter are in.',
  inReviewCurrent: 'Now. Batsi has read your documents. HR decides each one.',
  verifiedNext: 'When HR has accepted your ID and bank letter.',
  both: 'Upload your ID and your bank letter.',
  id: 'Upload your ID.',
  bank: 'Upload your bank letter.',
  consent: 'Accept the privacy notice first.',
  checkingTitle: 'Your documents are being checked',
  checkingBody: 'Batsi has read your ID and bank letter. HR decides each document. Nothing to do now: we tell you when all are verified.',
  verified: 'HR has everything it needs.',
  notFound: "We can't find your record. Ask your HR team.",
};

/** The two required documents this page asks for, in this order. */
const ASKED: readonly DocumentType[] = ['NATIONAL_ID', 'BANK_CONFIRMATION'];

/**
 * "My onboarding" (ONB-19): the four steps, the one the person is on and what is left for them. The step is the one
 * the API gives on GET /v1/me (the same step HR sees); this page never works it out from the documents. What is left
 * comes from the person's own documents list, asked for only once the privacy notice is accepted.
 */
@Component({
  selector: 'app-onboarding',
  imports: [RouterLink, PpButton, PpCard, PpLozenge, PpPageHeader, PpProgressBar, PpProgressTracker, PpSectionMessage, PpSectionMessageActions, PpSkeleton, PpSkeletonGroup],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-stack pp-gap-300">
      <pp-page-header heading="Getting started" [description]="describe()" />

      @switch (start.state().kind) {
        @case ('loading') {
          <pp-skeleton-group label="Loading your steps" class="pp-stack pp-gap-200">
            <pp-skeleton shape="text" width="60%" />
            <pp-skeleton shape="card" />
          </pp-skeleton-group>
        }
        @case ('refused') {
          <pp-section-message tone="danger">{{ refusal() }}</pp-section-message>
        }
        @case ('offline') {
          <pp-section-message tone="danger">{{ offline }}
            <pp-section-message-actions><button ppButton type="button" size="large" (click)="reloadStart()">Try again</button></pp-section-message-actions>
          </pp-section-message>
        }
        @case ('ready') {
          @if (!step()) {
            <pp-section-message tone="danger">{{ words.notFound }}</pp-section-message>
          } @else {
            <pp-progress-bar label="Onboarding progress" [value]="done()" [max]="4" [valueText]="done() + ' of 4 steps done'" [tone]="step() === 'VERIFIED' ? 'success' : 'neutral'" />

            @switch (left().kind) {
              @case ('consent') {
                <pp-section-message tone="information">{{ words.consent }}
                  <pp-section-message-actions><a ppButton size="large" routerLink="/start">Go to Today</a></pp-section-message-actions>
                </pp-section-message>
              }
              @case ('loading') {
                <pp-skeleton-group label="Loading what is left" class="pp-stack pp-gap-200">
                  <pp-skeleton shape="text" width="40%" />
                </pp-skeleton-group>
              }
              @case ('refused') {
                <pp-section-message tone="danger">{{ docsRefusal() }}</pp-section-message>
              }
              @case ('offline') {
                <pp-section-message tone="danger">{{ offline }}
                  <pp-section-message-actions><button ppButton type="button" size="large" (click)="reloadDocuments()">Try again</button></pp-section-message-actions>
                </pp-section-message>
              }
              @case ('upload') {
                <pp-section-message [tone]="sentBack() ? 'warning' : 'information'">{{ line() }}
                  <pp-section-message-actions>
                    @for (t of missing(); track t.type) {
                      <a ppButton size="large" [routerLink]="t.link">{{ t.button }}</a>
                      @if (t.sentBack) { <pp-lozenge status="danger">Needs a new copy</pp-lozenge> }
                    }
                  </pp-section-message-actions>
                </pp-section-message>
              }
              @case ('checking') {
                <pp-section-message tone="information" [heading]="words.checkingTitle">{{ words.checkingBody }}</pp-section-message>
              }
              @case ('verified') {
                <pp-section-message tone="success" [heading]="words.verified" />
              }
            }

            <pp-card heading="Your steps to Day 1" icon="map" [level]="2">
              <pp-progress-tracker label="Your steps to Day 1" [steps]="steps()" [vertical]="true" />
            </pp-card>
          }
        }
      }
    </div>
  `,
})
export class OnboardingPage {
  protected readonly start = inject(StartService);
  private readonly documents = inject(MyDocumentsService);
  protected readonly offline = SIGN_IN_MESSAGES.offline;
  protected readonly words = WORDS;

  private readonly me = computed(() => {
    const s = this.start.state();
    return s.kind === 'ready' ? s.me : null;
  });
  protected readonly refusal = computed(() => {
    const s = this.start.state();
    return s.kind === 'refused' ? s.message : '';
  });
  protected readonly docsRefusal = computed(() => {
    const s = this.documents.state();
    return s.kind === 'refused' ? s.message : '';
  });
  /** The step the API gave, or null (an archived or unknown record, or an answer with no step). */
  protected readonly step = computed<OnboardingStep | null>(() => {
    const s = this.me()?.step;
    return STEPS.some((x) => x.code === s) ? (s as OnboardingStep) : null;
  });
  protected readonly done = computed(() => DONE[this.step() ?? 'INVITED']);
  protected readonly describe = computed(() => {
    const s = this.step();
    if (!s) return undefined;
    const n = STEPS.findIndex((x) => x.code === s) + 1;
    return `Step ${n} of 4: ${STEPS[n - 1]!.word}. ${DONE[s]} of 4 steps done.`;
  });

  /** The required documents still to give: not uploaded, or sent back. */
  protected readonly missing = computed(() => {
    const byType = new Map(this.documents.documents().map((d) => [d.type, d]));
    return ASKED.flatMap((type) => {
      const d = byType.get(type);
      const state = d?.state ?? 'NOT_UPLOADED';
      if (!d || !d.required || (state !== 'NOT_UPLOADED' && state !== 'SENT_BACK')) return [];
      const info = DOCUMENT_INFO[type];
      return [{ type, button: info.button, link: `/start/documents/${info.slug}`, sentBack: state === 'SENT_BACK' }];
    });
  });
  protected readonly sentBack = computed(() => this.missing().some((m) => m.sentBack));
  protected readonly line = computed(() => {
    const m = this.missing().map((x) => x.type);
    if (m.length > 1) return WORDS.both;
    return m[0] === 'NATIONAL_ID' ? WORDS.id : WORDS.bank;
  });

  /** What the section between the bar and the card shows. */
  protected readonly left = computed<{ kind: 'consent' | 'loading' | 'refused' | 'offline' | 'upload' | 'checking' | 'verified' | 'none' }>(() => {
    const step = this.step();
    if (step === 'VERIFIED') return { kind: 'verified' };
    if (step === 'IN_REVIEW') return { kind: 'checking' };
    if (!step) return { kind: 'none' };
    if (!this.me()?.consent) return { kind: 'consent' };
    const d = this.documents.state();
    if (d.kind !== 'ready') return { kind: d.kind };
    return this.missing().length ? { kind: 'upload' } : { kind: 'checking' };
  });

  protected readonly steps = computed<Step[]>(() => {
    const step = this.step();
    if (!step) return [];
    const at = STEPS.findIndex((x) => x.code === step);
    return STEPS.map((x, i): Step => {
      const state = step === 'VERIFIED' || i < at ? 'done' : i === at ? 'current' : 'upcoming';
      let meta: string | undefined;
      if (x.code === 'DOCUMENTS') {
        if (state === 'done') meta = WORDS.documentsDone;
        else if (state === 'current' && this.left().kind === 'upload') meta = this.line();
      } else if (x.code === 'IN_REVIEW' && state === 'current') meta = WORDS.inReviewCurrent;
      else if (x.code === 'VERIFIED' && state === 'upcoming') meta = WORDS.verifiedNext;
      return { label: x.word, state, ...(meta ? { meta } : {}) };
    });
  });

  constructor() {
    void this.start.load();
    // Only once the privacy notice is accepted: nothing about documents is asked before that.
    effect(() => {
      if (this.me()?.consent) untracked(() => void this.documents.load());
    });
  }

  protected reloadStart(): void {
    void this.start.load(true);
  }

  protected reloadDocuments(): void {
    void this.documents.load(true);
  }
}
