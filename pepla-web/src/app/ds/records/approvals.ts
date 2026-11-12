import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { PpIcon } from '../core/icon';
import { IconName } from '../core/icon.registry';
import { AvatarColour, PpAvatar } from '../core/avatar';
import { PpLozenge, Status } from '../status/lozenge';

export type ApprovalState = 'approved' | 'waiting' | 'upcoming' | 'declined' | 'skipped';

export interface ApprovalStep {
  name: string;
  /** Their part: "hiring manager". */
  role: string;
  state: ApprovalState;
  /** "Approved 3 Nov 2026, 10:12", "After Thandeka". Left out in a compact chain. */
  detail?: string;
  /** The lozenge words when they say more than the state: "Waiting 8 days", "Approved 3 Nov". */
  status?: string;
  /** Batsi reminded them: an agent lozenge in the detail line. */
  agent?: string;
  /** Declined: why, in the approver's words. */
  reason?: string;
}

const LOOK: Record<ApprovalState, { status: Status; icon: IconName; text: string; mark?: IconName }> = {
  approved: { status: 'success', icon: 'circle-check', text: 'Approved', mark: 'check' },
  waiting: { status: 'information', icon: 'clock', text: 'Waiting' },
  upcoming: { status: 'neutral', icon: 'circle-dashed', text: 'Not yet' },
  declined: { status: 'danger', icon: 'circle-x', text: 'Declined', mark: 'x' },
  skipped: { status: 'neutral', icon: 'skip-forward', text: 'Skipped', mark: 'skip-forward' },
};

/**
 * Who approves, in order, and where it stands. The waiting or declining step is current.
 * `<ol ppApprovalChain aria-label="Approvals for Lerato Mokoena's offer" [steps]="steps"></ol>`
 * Spec: records/approval-chain.md
 */
@Component({
  selector: 'ol[ppApprovalChain]',
  imports: [PpIcon, PpLozenge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (s of steps(); track s.name; let i = $index) {
      <li [class]="'pp-approval-chain__step' + (s.state === 'approved' || s.state === 'declined' || s.state === 'skipped' ? ' pp-approval-chain__step--' + s.state : '') + (i === current() ? ' pp-approval-chain__step--current' : '')"
          [attr.aria-current]="i === current() ? 'step' : null">
        <span class="pp-approval-chain__marker" aria-hidden="true">@if (look(s).mark; as m) {<svg [ppIcon]="m" />} @else {{{ i + 1 }}}</span>
        <div class="pp-approval-chain__body">
          <span class="pp-approval-chain__who"><strong>{{ s.name }}</strong>, {{ s.role }}</span>
          @if (s.detail) { <span class="pp-approval-chain__detail">{{ s.detail + (s.agent ? ' · ' : '') }}@if (s.agent) {<pp-lozenge status="agent" icon="sparkles">{{ s.agent }}</pp-lozenge>}</span> }
          @if (s.reason) { <span class="pp-approval-chain__reason">{{ s.reason }}</span> }
        </div>
        <pp-lozenge [status]="look(s).status" [icon]="look(s).icon">{{ s.status ?? look(s).text }}</pp-lozenge>
      </li>
    }
  `,
  host: { '[class]': '"pp-approval-chain" + (compact() ? " pp-approval-chain--compact" : "")' },
})
export class PpApprovalChain {
  readonly steps = input.required<ApprovalStep[]>();
  /** Inside a card (an offer): smaller markers, no detail lines. */
  readonly compact = input(false);
  protected readonly current = computed(() => this.steps().findIndex((s) => s.state === 'waiting' || s.state === 'declined'));
  protected look(s: ApprovalStep) { return LOOK[s.state]; }
}

/**
 * An offer: who, the facts (salary masked), the approvals and the next actions. The facts go inside as
 * `<dl ppDl>`, then `<pp-offer-approvals>` and `<pp-card-footer>`.
 * `<pp-offer name="Lerato Mokoena" colour="amber" subheading="Sales rep, Durban · Created 3 Nov 2026">
 *    <pp-lozenge status="information" icon="clock">Waiting for approval</pp-lozenge> …</pp-offer>`
 * Spec: records/offer-summary.md
 */
@Component({
  selector: 'pp-offer',
  imports: [PpAvatar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-card__header">
      <pp-avatar [name]="name()" size="large" [colour]="colour()" [decorative]="true" />
      <div class="pp-card__titles"><span class="pp-card__title" role="heading" aria-level="3">Offer for {{ name() }}</span><span class="pp-card__subtitle">{{ subheading() }}</span></div>
      <div class="pp-card__aside"><ng-content select="pp-lozenge" /></div>
    </div>
    <ng-content />
  `,
  host: { class: 'pp-card pp-offer', role: 'article' },
})
export class PpOffer {
  readonly name = input.required<string>();
  readonly colour = input<AvatarColour>();
  readonly subheading = input.required<string>();
}

/** The offer's approvals, under a small heading. Holds `<ol ppApprovalChain [compact]="true">`. */
@Component({
  selector: 'pp-offer-approvals',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="pp-offer__section-title" role="heading" aria-level="4">{{ heading() }}</span><ng-content />`,
  host: { class: 'pp-offer__section' },
})
export class PpOfferApprovals { readonly heading = input('Approvals'); }
