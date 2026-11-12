import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, model, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { A11yModule } from '@angular/cdk/a11y';
import { ConnectedPosition, OverlayModule } from '@angular/cdk/overlay';
import { PpLink } from '../actions/link';
import { PpField, PpTextarea } from '../forms/field';
import { PpCheckbox } from '../forms/controls';
import { RouterLink } from '@angular/router';
import { PpIcon } from '../core/icon';
import { IconName } from '../core/icon.registry';
import { PpButton } from '../actions/button';
import { PpLozenge, Status } from '../status/lozenge';
import { uid } from '../util';

/**
 * "Pepla did this" (rule 1: mint means the agent). `<pp-agent-mark />`, `<pp-agent-mark text="Suggested by Pepla" suggested />`,
 * or `iconOnly` with a `label` beside a value Pepla filled in. Spec: agent/agent-mark.md
 */
@Component({
  selector: 'pp-agent-mark',
  imports: [PpIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg ppIcon="sparkles" />@if (!iconOnly()) {<span>{{ text() }}</span>}`,
  host: {
    class: 'pp-agent-mark',
    '[class.pp-agent-mark--suggested]': 'suggested()',
    '[class.pp-agent-mark--icon]': 'iconOnly()',
    '[attr.role]': 'iconOnly() ? "img" : null',
    '[attr.aria-label]': 'iconOnly() ? label() : null',
    '[attr.tabindex]': 'focusable() ? 0 : null',
    '[attr.title]': 'iconOnly() && detail() ? detail() : null',
  },
})
export class PpAgentMark {
  /** Reachable by Tab, for a mark inside a `<pp-tooltip>` that says what Pepla read and when. */
  readonly focusable = input(false);
  /** In a dense row, the icon-only mark's detail as a native title. */
  readonly detail = input<string>();
  readonly text = input('Pepla');
  readonly suggested = input(false);
  readonly iconOnly = input(false);
  readonly label = input('Filled in by Pepla');
}

export type Confidence = 'high' | 'check' | 'unsure';
const CONF: Record<Confidence, { icon: IconName; words: string }> = {
  high: { icon: 'file-text', words: 'High confidence' },
  check: { icon: 'triangle-alert', words: 'Check this' },
  unsure: { icon: 'circle-help', words: 'Pepla could not tell' },
};

export interface ConfidenceSource {
  icon: IconName;
  /** The document: "SA ID ending 0876". */
  label: string;
  link: string;
  /** What Pepla found in it: "Name and date of birth match the offer". */
  found: string;
  /** The source disagrees: "Does not match: surname is Moyo-Ncube". */
  mismatch?: boolean;
}

/**
 * How sure Pepla is, and how many sources it read. Opens "What Pepla read": why, then each source and
 * what it found. `<pp-confidence level="check" why="The surnames differ. …" [items]="sources" />`
 * Spec: agent/confidence-chip.md
 */
@Component({
  selector: 'pp-confidence',
  imports: [PpIcon, OverlayModule, NgTemplateOutlet, A11yModule, PpLink, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button [class]="'pp-confidence pp-confidence--' + level()" type="button" aria-haspopup="dialog" [attr.aria-expanded]="open()"
            [attr.aria-controls]="open() ? id : null" (click)="toggle()">
      <svg [ppIcon]="c().icon" /><span>{{ c().words }} · {{ count() }} {{ count() === 1 ? 'source' : 'sources' }}</span><svg ppIcon="chevron-down" />
    </button>
    <ng-template #panel>
      <div class="pp-popup" [class.pp-popup--inline]="inline()" [class.pp-popup--floating]="!inline()" [id]="id" role="dialog" [attr.aria-labelledby]="id + '-t'"
           (keydown.escape)="dismiss()" cdkTrapFocus [cdkTrapFocusAutoCapture]="!inline()">
        <div class="pp-confidence-sources">
          <span class="pp-popup__title" [id]="id + '-t'">What Pepla read</span>
          @if (why()) { <span class="pp-confidence-sources__why">{{ why() }}</span> }
          <div class="pp-confidence-sources__list" role="list">
            @for (i of items(); track i.link) {
              <div class="pp-confidence-sources__item" role="listitem"><svg [ppIcon]="i.icon" /><a ppLink [routerLink]="i.link">{{ i.label }}</a>
                <span class="pp-confidence-sources__found" [class.pp-confidence-sources__found--mismatch]="i.mismatch">{{ i.found }}</span></div>
            }
          </div>
        </div>
      </div>
    </ng-template>
    @if (inline()) { @if (open()) { <ng-container [ngTemplateOutlet]="panel" /> } }
    @else {
      <ng-template cdkConnectedOverlay [cdkConnectedOverlayOrigin]="host" [cdkConnectedOverlayOpen]="open()" [cdkConnectedOverlayPositions]="positions"
                   cdkConnectedOverlayUsePopover="inline" (overlayOutsideClick)="outside($event)" (detach)="open.set(false)">
        <ng-container [ngTemplateOutlet]="panel" />
      </ng-template>
    }
  `,
  host: { '[class.pp-popup-anchor]': 'inline() && open()' },
})
export class PpConfidence {
  readonly level = input.required<Confidence>();
  /** How many sources, when the list isn't given. */
  readonly sources = input<number>();
  readonly items = input<ConfidenceSource[]>([]);
  /** One line on why this level: "The surnames differ. Check the bank letter before you approve." */
  readonly why = input<string>();
  readonly open = model(false);
  readonly inline = input(false);
  protected readonly id = uid('pp-conf');
  protected readonly c = computed(() => CONF[this.level()]);
  protected readonly count = computed(() => this.items().length || this.sources() || 0);
  protected readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly positions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
  ];
  protected toggle() { if (this.items().length) this.open.update((o) => !o); }
  protected dismiss() { this.open.set(false); this.host.querySelector<HTMLElement>('button')?.focus(); }
  protected outside(e: MouseEvent) { if (!this.host.contains(e.target as Node)) this.open.set(false); }
}

export interface ProposalSource { label: string; icon: IconName; link: string; }
export interface ProposalDestination {
  /** "Payroll system, South Africa" */
  where: string;
  /** What goes there: "name, ID ending 0876, account ending 4821" */
  what: string;
  /** True when the data leaves Pepla for another company. Then one-tap Approve is never offered. */
  external: boolean;
}
export interface Proposal {
  title: string;
  whyNow: string;
  sources: ProposalSource[];
  /** Systems that receive data. Empty: "Nothing leaves Pepla. Kept in Cape Town." */
  destinations: ProposalDestination[];
  confidence: Confidence;
  /** What Pepla found in each source, for the confidence popup. */
  read?: ConfidenceSource[];
  /** Why this confidence: "The name, date of birth and photo match on all three." */
  readWhy?: string;
  /** A deadline or expiry, as a lozenge: { status: 'warning', text: 'Expires in 2 days', icon: 'clock' } */
  status?: { status: Status; text: string; icon?: IconName };
  /** For the compact row, what happens in a few words when nothing leaves Pepla: "Emails to 3 people". */
  effect?: string;
}

/** Where a proposal is. Screens set it as the decision goes through. */
export type ProposalState = 'waiting' | 'working' | 'declining' | 'approved' | 'declined' | 'expired' | 'failed';

/** After a decision: what happened, when, and (declined) the reason in the person's words. */
export interface ProposalOutcome {
  /** "Approved by Thandeka Dlamini. Payroll has the details." */
  text: string;
  /** ISO time, and the same in words: "11 Nov 2026, 09:12". */
  at: string;
  when: string;
  quote?: string;
}

/** One record in a batch proposal: "Kagiso Molefe, SA ID ending 0876". */
export interface ProposalItem { label: string; checked: boolean; confidence: Confidence; sources: number; }

const OUTCOME_LOZENGE: Record<Exclude<ProposalState, 'waiting' | 'declining'>, { status: Status; text: string; icon: IconName }> = {
  working: { status: 'information', text: 'Working', icon: 'loader' },
  approved: { status: 'success', text: 'Approved', icon: 'circle-check' },
  declined: { status: 'neutral', text: 'Declined', icon: 'circle-x' },
  expired: { status: 'neutral', text: 'Expired', icon: 'clock-alert' },
  failed: { status: 'danger', text: 'Did not go through', icon: 'octagon-alert' },
};

/**
 * Pepla's signature: the agent proposes, a person approves (rule 2). Shows what it will do, why now,
 * what it read, where the data goes and how sure it is. Approve, edit or decline; the choice is audited.
 * Decline asks for an optional reason first. After the decision the card says who decided and when.
 * ```html
 * <pp-proposal-card [proposal]="p" [(state)]="state" [outcome]="outcome" workingText="Sending to payroll"
 *   (approve)="…" (edit)="…" (decline)="…reason…" (retry)="…" auditLink="/audit/123" />
 * ```
 * A batch (`[items]`) is one decision for several records; each can be unticked first.
 * Spec: agent/agent-proposal-card.md
 */
@Component({
  selector: 'pp-proposal-card',
  imports: [PpIcon, PpButton, PpLozenge, PpAgentMark, PpConfidence, RouterLink, PpLink, PpField, PpTextarea, PpCheckbox],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="pp-card__header">
      <div class="pp-proposal__titles">
        <pp-agent-mark [text]="decided() ? 'Pepla suggested' : 'Pepla suggests'" />
        <span class="pp-proposal__title" role="heading" aria-level="3" [id]="id">{{ proposal().title }}</span>
      </div>
      @if (lozenge(); as l) { <div class="pp-card__aside"><pp-lozenge [status]="l.status" [icon]="l.icon">{{ l.text }}</pp-lozenge></div> }
    </header>
    @switch (state()) {
      @case ('waiting') {
        @if (items().length) {
          <fieldset class="pp-field">
            <legend class="pp-field__label">Untick any you want to check yourself</legend>
            <div class="pp-proposal__items">
              @for (i of items(); track i.label) {
                <div class="pp-proposal__item"><pp-checkbox [label]="i.label" [value]="i.checked" (valueChange)="tick(i, $event)" /><pp-confidence [level]="i.confidence" [sources]="i.sources" /></div>
              }
            </div>
          </fieldset>
        }
        <dl class="pp-proposal__facts">
          <dt>Why now</dt><dd>{{ proposal().whyNow }}</dd>
          @if (proposal().sources.length) {
            <dt>What Pepla read</dt>
            <dd><div class="pp-proposal__sources">@for (s of proposal().sources; track s.link) {<a class="pp-tag" [routerLink]="s.link"><svg [ppIcon]="s.icon" /><span class="pp-tag__text">{{ s.label }}</span></a>}</div></dd>
          }
          <dt>Where it goes</dt>
          @if (proposal().destinations.length) {
            <dd><div class="pp-proposal__flow" role="list">
              @for (d of proposal().destinations; track d.where) {
                <div class="pp-proposal__flow-item" role="listitem"><svg [ppIcon]="d.external ? 'server' : 'database'" /><span><strong>{{ d.where }}</strong>: {{ d.what }}</span></div>
              }
            </div></dd>
          } @else {
            <dd>Nothing leaves Pepla. Kept in Cape Town.</dd>
          }
          @if (!items().length) {
            <dt>How sure</dt>
            <dd><pp-confidence [level]="proposal().confidence" [items]="proposal().read ?? []" [sources]="proposal().sources.length" [why]="proposal().readWhy" /></dd>
          }
        </dl>
        <footer class="pp-card__footer">
          <div class="pp-button-group pp-button-group--stack-phone">
            <button ppButton appearance="agent" icon="check" [attr.aria-describedby]="id" [disabled]="items().length > 0 && !chosen()" (click)="approve.emit()">{{ approveText() }}</button>
            @if (!items().length) { <button ppButton appearance="default" [attr.aria-describedby]="id" (click)="edit.emit()">Edit</button> }
            <button ppButton appearance="subtle" [attr.aria-describedby]="id" (click)="state.set('declining')">{{ items().length ? 'Decline all' : 'Decline' }}</button>
          </div>
          <span class="pp-proposal__note"><svg ppIcon="history" />&ngsp;{{ items().length ? 'Each ' + one() + ' gets its own audit entry with your name.' : 'Your choice is recorded with your name and the time.' }}</span>
        </footer>
      }
      @case ('working') {
        <footer class="pp-card__footer">
          <div class="pp-button-group">
            <button ppButton appearance="agent" icon="check" [busy]="true">{{ approveText() }}</button>
            @if (!items().length) { <button ppButton appearance="default" aria-disabled="true">Edit</button> }
            <button ppButton appearance="subtle" aria-disabled="true">{{ items().length ? 'Decline all' : 'Decline' }}</button>
          </div>
          <span class="pp-proposal__note" role="status">{{ workingText() }}</span>
        </footer>
      }
      @case ('declining') {
        <div class="pp-proposal__decline">
          <pp-field label="Why are you declining?" [optional]="true" help="Pepla uses this to suggest better next time. It is kept with the decision.">
            <textarea ppTextarea rows="2" [value]="reason()" (input)="reason.set($any($event.target).value)"></textarea>
          </pp-field>
          <div class="pp-button-group">
            <button ppButton appearance="default" (click)="decline.emit(reason())">Decline proposal</button>
            <button ppButton appearance="subtle" (click)="state.set('waiting')">Back</button>
          </div>
        </div>
      }
      @default {
        @if (outcome(); as o) {
          <div [class]="'pp-proposal__outcome' + (state() === 'approved' ? ' pp-proposal__outcome--approved' : state() === 'failed' ? ' pp-proposal__outcome--failed' : '')"
               [attr.tabindex]="state() === 'approved' ? -1 : null" [attr.role]="state() === 'failed' ? 'alert' : null">
            <svg [ppIcon]="lozenge()!.icon ?? 'info'" />
            <span class="pp-proposal__outcome-text">
              <span>{{ o.text }}</span>
              @if (o.quote) { <span class="pp-proposal__quote">{{ o.quote }}</span> }
              <time class="pp-proposal__outcome-meta" [attr.datetime]="o.at">{{ state() === 'expired' ? 'Expired ' + o.when : o.when }}</time>
            </span>
            @if (state() === 'approved' && auditLink()) { <span class="pp-proposal__outcome-actions"><a ppLink [routerLink]="auditLink()">View in audit trail</a></span> }
            @if (state() === 'failed') { <span class="pp-proposal__outcome-actions"><button ppButton size="small" (click)="retry.emit()">Fix and try again</button></span> }
          </div>
        }
      }
    }
  `,
  host: {
    class: 'pp-card pp-proposal', role: 'article', '[attr.aria-labelledby]': 'id',
    '[class.pp-card--compact]': 'state() === "declined" || state() === "expired" || state() === "failed"',
    '[attr.aria-busy]': 'state() === "working" ? "true" : null',
  },
})
export class PpProposalCard {
  readonly proposal = input.required<Proposal>();
  readonly state = model<ProposalState>('waiting');
  readonly outcome = input<ProposalOutcome>();
  /** What Pepla is doing while it works: "Sending to payroll". */
  readonly workingText = input('Working on it');
  readonly auditLink = input<string>();
  /** A batch: one decision for several records. */
  readonly items = input<ProposalItem[]>([]);
  /** What the batch holds, plural: "documents". */
  readonly noun = input('records');
  /** One of them: "records" gives "record". Set it when the plural is not just an added s. */
  readonly singular = input<string>();
  protected readonly one = computed(() => this.singular() ?? this.noun().replace(/s$/, ''));
  readonly approve = output<void>();
  readonly edit = output<void>();
  /** With the reason, which may be empty. */
  readonly decline = output<string>();
  readonly retry = output<void>();
  readonly itemsChange = output<ProposalItem[]>();
  protected readonly id = uid('pp-proposal');
  readonly reason = model('');
  protected readonly decided = computed(() => ['approved', 'declined', 'expired', 'failed'].includes(this.state()));
  protected readonly chosen = computed(() => this.items().filter((i) => i.checked).length);
  protected readonly approveText = computed(() => (this.items().length ? `Approve ${this.chosen()} ${this.noun()}` : 'Approve'));
  protected readonly lozenge = computed(() => {
    const st = this.state();
    if (st === 'waiting' || st === 'declining') return this.proposal().status ?? { status: 'information' as Status, text: 'Waiting for you', icon: 'info' as IconName };
    return OUTCOME_LOZENGE[st];
  });
  protected tick(i: ProposalItem, checked: boolean) { this.itemsChange.emit(this.items().map((x) => (x === i ? { ...x, checked } : x))); }
}

/**
 * One proposal as a row in a list ("Needs you"). One-tap Approve only when Pepla is sure and nothing
 * leaves Pepla; otherwise Review, which opens the full card (decided 11 Nov 2026).
 * After a decision, `outcome` says who decided and when.
 */
@Component({
  selector: 'pp-proposal-row',
  imports: [PpButton, PpAgentMark, PpConfidence, PpLozenge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-proposal__titles">
      <pp-agent-mark [text]="outcome() ? 'Pepla suggested' : 'Pepla suggests'" />
      <span class="pp-proposal__title" [id]="id">{{ proposal().title }}</span>
      <span class="pp-proposal__meta">{{ outcome() ?? meta() }}</span>
    </div>
    <div class="pp-proposal__row-actions">
      @if (outcome()) {
        <pp-lozenge status="success" icon="circle-check">Approved</pp-lozenge>
      } @else {
        @if (proposal().confidence !== 'high') { <pp-confidence [level]="proposal().confidence" [items]="proposal().read ?? []" [sources]="proposal().sources.length" [why]="proposal().readWhy" /> }
        @if (oneTap()) { <button ppButton appearance="agent" size="small" [busy]="busy()" [attr.aria-describedby]="id" (click)="approve.emit()">Approve</button> }
        <button ppButton appearance="default" size="small" [attr.aria-describedby]="id" (click)="review.emit()">Review</button>
      }
    </div>
  `,
  // A list item inside a proposal list; in the agent panel's log it stands alone.
  host: { class: 'pp-proposal--compact', '[attr.role]': 'list ? "listitem" : null', '[attr.aria-labelledby]': 'id' },
})
export class PpProposalRow {
  protected readonly list = inject(PpProposalList, { optional: true });
  readonly proposal = input.required<Proposal>();
  readonly busy = input(false);
  /** After approval: "Approved by Sipho Ndlovu, 20 min ago". */
  readonly outcome = input<string>();
  readonly approve = output<void>();
  readonly review = output<void>();
  protected readonly id = uid('pp-proposal');
  protected readonly external = computed(() => this.proposal().destinations.filter((d) => d.external));
  protected readonly oneTap = computed(() => this.proposal().confidence === 'high' && this.external().length === 0);
  protected readonly meta = computed(() => {
    const ext = this.external();
    const where = ext.length ? `Goes to another company: ${ext.map((d) => d.where.charAt(0).toLowerCase() + d.where.slice(1)).join(', ')}` : this.proposal().effect ?? 'Nothing leaves Pepla';
    return ext.length && !this.proposal().whyNow ? where : `${this.proposal().whyNow} · ${where}`;
  });
}

/** Pepla's proposals for this screen, in one list (Calm rule 5). */
@Component({
  selector: 'pp-proposal-list', template: '<ng-content />', changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'pp-proposal-list', role: 'list', '[attr.aria-label]': 'label()' },
})
export class PpProposalList { readonly label = input('Pepla suggests'); }
