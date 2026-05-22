import {
  Component,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  OnInit,
  inject,
  input,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TalentFlowApiService } from '../../services/talent-flow-api.service';
import {
  Candidate,
  InteractionOutcome,
  InteractionType,
  Offer,
  OfferState,
} from '../../models/talent-flow.models';

interface State1Form {
  baseSalary:  number | null;
  currency:    string;
  startDate:   string;
  expiryDate:  string;
  benefits:    string;
}

interface LogForm {
  interactionType: InteractionType;
  outcome:         InteractionOutcome;
  notes:           string;
}

interface AcceptForm {
  acceptanceDate:     string;
  confirmedStartDate: string;
  notes:              string;
}

const STATE_STEPS: { state: OfferState; label: string; icon: string }[] = [
  { state: 'OFFER_CREATED', label: 'Offer Created',  icon: 'pi-file-edit' },
  { state: 'IN_APPROVAL',   label: 'In Approval',    icon: 'pi-users'     },
  { state: 'OFFER_SENT',    label: 'Offer Sent',     icon: 'pi-send'      },
  { state: 'ACCEPTED',      label: 'Accepted',       icon: 'pi-check-circle' },
];

const STATE_ORDER: OfferState[] = ['OFFER_CREATED', 'IN_APPROVAL', 'OFFER_SENT', 'ACCEPTED'];

const today = (): string => new Date().toISOString().slice(0, 10);

@Component({
  selector: 'tf-offer-tab',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './offer-tab.component.html',
  styleUrl: './offer-tab.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OfferTabComponent implements OnInit {
  readonly candidateId = input.required<string>();
  readonly candidate   = input.required<Candidate>();

  private readonly api = inject(TalentFlowApiService);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly stateSteps = STATE_STEPS;

  // ── Offer load ────────────────────────────────────────────────────────────
  readonly offer        = signal<Offer | null>(null);
  readonly offerLoading = signal(true);
  readonly offerError   = signal<string | null>(null);
  readonly noOffer      = signal(false);

  // ── State 1 form ──────────────────────────────────────────────────────────
  readonly state1Form = signal<State1Form>({
    baseSalary: null,
    currency:   'ZAR',
    startDate:  '',
    expiryDate: '',
    benefits:   '',
  });
  readonly state1Submitting = signal(false);
  readonly state1Error      = signal<string | null>(null);

  // ── State 3 interaction log ───────────────────────────────────────────────
  readonly showLogForm    = signal(false);
  readonly logSubmitting  = signal(false);
  readonly logError       = signal<string | null>(null);
  readonly logForm = signal<LogForm>({
    interactionType: 'CALL',
    outcome:         'ACKNOWLEDGED',
    notes:           '',
  });

  // ── Manual offer creation fallback ───────────────────────────────────────
  readonly creating    = signal(false);
  readonly createError = signal<string | null>(null);

  // ── State 4 acceptance ────────────────────────────────────────────────────
  readonly acceptSentiment  = signal<'EXCITED' | 'POSITIVE' | 'HESITANT' | null>(null);
  readonly acceptSubmitting = signal(false);
  readonly acceptError      = signal<string | null>(null);
  readonly acceptForm = signal<AcceptForm>({
    acceptanceDate:     today(),
    confirmedStartDate: '',
    notes:              '',
  });

  // ── Derived ───────────────────────────────────────────────────────────────
  readonly currentStep = computed<number>(() => {
    const s = this.offer()?.state;
    return s ? STATE_ORDER.indexOf(s) : -1;
  });

  readonly signalIntel = computed<string | null>(() => {
    const o = this.offer();
    if (!o) return null;
    if (o.state === 'IN_APPROVAL') {
      const pending = o.approvalChain?.find((s) => s.status === 'PENDING');
      if (pending) return `Awaiting approval from ${pending.approverRole}. Remind them if no response within 24 hours.`;
    }
    if (o.state === 'OFFER_SENT') {
      const last = o.interactionLog?.[o.interactionLog.length - 1];
      if (last?.outcome === 'COUNTER_RECEIVED') {
        return 'Counter offer received. Hiring Manager review required before responding.';
      }
      if (last?.outcome === 'GOING_QUIET') {
        return 'No recent response logged — SLA approaching. Consider escalating.';
      }
    }
    return null;
  });

  readonly INTERACTION_TYPES: InteractionType[] = ['CALL', 'EMAIL', 'WHATSAPP', 'MEETING'];
  readonly INTERACTION_OUTCOMES: { value: InteractionOutcome; label: string }[] = [
    { value: 'ACKNOWLEDGED',    label: 'Acknowledged'    },
    { value: 'ASKING_QUESTIONS',label: 'Asking Questions'},
    { value: 'COUNTER_RECEIVED',label: 'Counter Received'},
    { value: 'GOING_QUIET',     label: 'Going Quiet'     },
    { value: 'VERBAL_ACCEPT',   label: 'Verbal Accept'   },
    { value: 'DECLINED',        label: 'Declined'        },
  ];

  readonly ACCEPTANCE_SENTIMENTS: { value: 'EXCITED' | 'POSITIVE' | 'HESITANT'; label: string; desc: string; icon: string }[] = [
    { value: 'EXCITED',  label: 'Excited',  desc: 'Very enthusiastic',   icon: 'pi-star'       },
    { value: 'POSITIVE', label: 'Positive', desc: 'Happy to accept',     icon: 'pi-thumbs-up'  },
    { value: 'HESITANT', label: 'Hesitant', desc: 'Some reservations',   icon: 'pi-exclamation-triangle' },
  ];

  ngOnInit(): void {
    this._loadOffer();
  }

  private _loadOffer(): void {
    this.offerLoading.set(true);
    this.offerError.set(null);
    this.noOffer.set(false);

    this.api.getOffer(this.candidateId()).subscribe({
      next: (o) => {
        this.offer.set(o);
        this._prefillState1(o);
        this.offerLoading.set(false);
        this.cdr.markForCheck();
      },
      error: (err: { status?: number; userMessage?: string }) => {
        if (err.status === 404) {
          this.noOffer.set(true);
        } else {
          this.offerError.set(err.userMessage ?? 'Failed to load offer.');
        }
        this.offerLoading.set(false);
        this.cdr.markForCheck();
      },
    });
  }

  private _prefillState1(o: Offer): void {
    this.state1Form.update((f) => ({
      ...f,
      baseSalary: o.baseSalary ?? null,
      currency:   o.currency   ?? 'ZAR',
      startDate:  o.startDate  ?? '',
      expiryDate: o.expiryDate ?? '',
      benefits:   o.benefits   ?? '',
    }));
  }

  // ── Template helpers ──────────────────────────────────────────────────────
  isStepCompleted(idx: number): boolean { return this.currentStep() > idx; }
  isStepActive(idx: number): boolean    { return this.currentStep() === idx; }
  isStepPending(idx: number): boolean   { return this.currentStep() < idx; }

  stepClass(idx: number): string {
    if (this.isStepCompleted(idx)) return 'tf-offer-step--completed';
    if (this.isStepActive(idx))   return 'tf-offer-step--active';
    return 'tf-offer-step--pending';
  }

  outcomeLabel(val: InteractionOutcome): string {
    return this.INTERACTION_OUTCOMES.find((o) => o.value === val)?.label ?? val;
  }

  // ── State 1: set form fields ──────────────────────────────────────────────
  setSalary(e: Event): void {
    const val = +(e.target as HTMLInputElement).value;
    this.state1Form.update((f) => ({ ...f, baseSalary: isNaN(val) ? null : val }));
  }
  setCurrency(e: Event): void {
    this.state1Form.update((f) => ({ ...f, currency: (e.target as HTMLSelectElement).value }));
  }
  setStartDate(e: Event): void {
    this.state1Form.update((f) => ({ ...f, startDate: (e.target as HTMLInputElement).value }));
  }
  setExpiryDate(e: Event): void {
    this.state1Form.update((f) => ({ ...f, expiryDate: (e.target as HTMLInputElement).value }));
  }
  setBenefits(e: Event): void {
    this.state1Form.update((f) => ({ ...f, benefits: (e.target as HTMLTextAreaElement).value }));
  }

  submitForApproval(): void {
    if (this.state1Submitting()) return;
    const f = this.state1Form();
    if (!f.baseSalary || !f.currency || !f.startDate || !f.expiryDate) {
      this.state1Error.set('Please complete all required fields before submitting.');
      return;
    }
    this.state1Submitting.set(true);
    this.state1Error.set(null);
    this.api.advanceOfferState(this.candidateId(), 'SUBMIT_FOR_APPROVAL', {
      baseSalary: f.baseSalary,
      currency:   f.currency,
      startDate:  f.startDate,
      expiryDate: f.expiryDate,
      benefits:   f.benefits || undefined,
    }).subscribe({
      next: () => {
        this.state1Submitting.set(false);
        this._loadOffer();
      },
      error: (err: { userMessage?: string }) => {
        this.state1Error.set(err.userMessage ?? 'Failed to submit for approval.');
        this.state1Submitting.set(false);
        this.cdr.markForCheck();
      },
    });
  }

  // ── State 3: interaction log ──────────────────────────────────────────────
  setLogType(e: Event): void {
    this.logForm.update((f) => ({ ...f, interactionType: (e.target as HTMLSelectElement).value as InteractionType }));
  }
  setLogOutcome(e: Event): void {
    this.logForm.update((f) => ({ ...f, outcome: (e.target as HTMLSelectElement).value as InteractionOutcome }));
  }
  setLogNotes(e: Event): void {
    this.logForm.update((f) => ({ ...f, notes: (e.target as HTMLTextAreaElement).value }));
  }

  submitLogInteraction(): void {
    if (this.logSubmitting()) return;
    const f = this.logForm();
    this.logSubmitting.set(true);
    this.logError.set(null);
    this.api.advanceOfferState(this.candidateId(), 'LOG_INTERACTION', {
      interactionType: f.interactionType,
      outcome:         f.outcome,
      notes:           f.notes || undefined,
    }).subscribe({
      next: () => {
        this.logSubmitting.set(false);
        this.showLogForm.set(false);
        this.logForm.set({ interactionType: 'CALL', outcome: 'ACKNOWLEDGED', notes: '' });
        this._loadOffer();
      },
      error: (err: { userMessage?: string }) => {
        this.logError.set(err.userMessage ?? 'Failed to log interaction.');
        this.logSubmitting.set(false);
        this.cdr.markForCheck();
      },
    });
  }

  createOfferManually(): void {
    if (this.creating()) return;
    this.creating.set(true);
    this.createError.set(null);
    this.api.createOffer(this.candidateId()).subscribe({
      next: () => {
        this.creating.set(false);
        this.noOffer.set(false);
        this._loadOffer();
      },
      error: (err: { userMessage?: string }) => {
        this.createError.set(err.userMessage ?? 'Failed to create offer. Please try again.');
        this.creating.set(false);
        this.cdr.markForCheck();
      },
    });
  }

  markSent(): void {
    this.api.advanceOfferState(this.candidateId(), 'MARK_SENT', {}).subscribe({
      next: () => this._loadOffer(),
      error: (err: { userMessage?: string }) => {
        this.offerError.set(err.userMessage ?? 'Failed to mark as sent.');
        this.cdr.markForCheck();
      },
    });
  }

  // ── State 4: acceptance ───────────────────────────────────────────────────
  selectAcceptSentiment(v: 'EXCITED' | 'POSITIVE' | 'HESITANT'): void {
    this.acceptSentiment.set(v);
  }
  setAcceptDate(e: Event): void {
    this.acceptForm.update((f) => ({ ...f, acceptanceDate: (e.target as HTMLInputElement).value }));
  }
  setConfirmedStart(e: Event): void {
    this.acceptForm.update((f) => ({ ...f, confirmedStartDate: (e.target as HTMLInputElement).value }));
  }
  setAcceptNotes(e: Event): void {
    this.acceptForm.update((f) => ({ ...f, notes: (e.target as HTMLTextAreaElement).value }));
  }

  confirmAcceptance(): void {
    if (this.acceptSubmitting()) return;
    const f = this.acceptForm();
    const sentiment = this.acceptSentiment();
    if (!f.acceptanceDate || !f.confirmedStartDate || !sentiment) {
      this.acceptError.set('Please fill in all required fields and select an acceptance sentiment.');
      return;
    }
    this.acceptSubmitting.set(true);
    this.acceptError.set(null);
    this.api.advanceOfferState(this.candidateId(), 'CONFIRM_ACCEPTANCE', {
      acceptanceDate:     f.acceptanceDate,
      confirmedStartDate: f.confirmedStartDate,
      acceptanceSentiment: sentiment,
      notes:              f.notes || undefined,
    }).subscribe({
      next: () => {
        this.acceptSubmitting.set(false);
        this._loadOffer();
      },
      error: (err: { userMessage?: string }) => {
        this.acceptError.set(err.userMessage ?? 'Failed to confirm acceptance.');
        this.acceptSubmitting.set(false);
        this.cdr.markForCheck();
      },
    });
  }
}
