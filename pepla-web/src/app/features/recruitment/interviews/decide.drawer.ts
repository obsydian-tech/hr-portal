import { ChangeDetectionStrategy, Component, ElementRef, afterRenderEffect, computed, inject, input, output, signal } from '@angular/core';
import { PpButton, PpDrawer, PpDrawerFooter, PpLozenge, PpPageHeader, PpRadioGroup, PpScorecard, type Option } from '../../../ds';
import { SCHEDULE_READY } from '../hire-flags';
import { INTERVIEW_WORDS } from './interview-words';
import { PanelSummary } from './panel-summary';
import type { SummaryState } from './interviews-tab';

export type DecideChoice = 'move' | 'book' | 'notHired';
const W = INTERVIEW_WORDS.decide as Record<string, string>;
const SW = INTERVIEW_WORDS.summary as Record<string, string>;

/**
 * INT-UI-06: the Decide drawer (desktop) and the Decide page (phone).
 * It sends nothing; the page goes on to Move, Schedule or Not hired with the choice.
 */
@Component({
  selector: 'app-decide',
  imports: [PanelSummary, PpButton, PpDrawer, PpDrawerFooter, PpLozenge, PpPageHeader, PpRadioGroup, PpScorecard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (phone()) {
      <div class="pp-stack pp-gap-200">
        <pp-page-header [heading]="title()" [description]="line()" />
        @if (ready(); as s) {
          <!-- Spec O-4 fallback: verify:design refuses the kit's overall-only markup, so the phone draws the full scorecard. -->
          <pp-scorecard [value]="s.overall" [outOf]="sw['outOf']" [word]="s.decisions ?? undefined" [criteria]="s.rows" [max]="5" [criteriaLabel]="sw['criteria']" />
        }
        @if ((ready()?.split) || required()) {
          <div class="pp-inline pp-gap-100">
            @if (ready()?.split) { <pp-lozenge status="warning" icon="triangle-alert">{{ sw['split'] }}</pp-lozenge> }
            @if (required(); as r) { <span class="pp-text pp-text--small pp-text--subtle">{{ r.done }} of {{ r.total }} required interviews done</span> }
          </div>
        }
        <pp-radio-group [options]="options()" [value]="picked()" (valueChange)="pick($event)" />
        <div class="pp-inline pp-gap-100">
          <button ppButton appearance="primary" type="button" [disabled]="!picked()" (click)="confirm()">{{ confirmWords() }}</button>
          <button ppButton type="button" (click)="dismissed.emit()">{{ w['cancel'] }}</button>
        </div>
      </div>
    } @else {
      <pp-drawer [open]="true" [heading]="title()" [description]="line()" (closed)="dismissed.emit()">
        @if (ready(); as s) { <app-panel-summary [summary]="s" /> }
        <pp-radio-group [options]="options()" [value]="picked()" (valueChange)="pick($event)" />
        <pp-drawer-footer>
          <button ppButton type="button" (click)="dismissed.emit()">{{ w['cancel'] }}</button>
          <button ppButton appearance="primary" type="button" [disabled]="!picked()" (click)="confirm()">{{ confirmWords() }}</button>
        </pp-drawer-footer>
      </pp-drawer>
    }`,
})
export class DecideDrawer {
  readonly name = input.required<string>();
  readonly roleTitle = input<string | null>(null);
  readonly phone = input(false);
  readonly summary = input<SummaryState>({ kind: 'none' });
  readonly required = input<{ done: number; total: number } | null>(null);
  /** Move to Offer: shown when the record can move to Offer; disabled while required interviews are missing. */
  readonly canOffer = input(false);
  readonly blocked = input(false);
  /** Book another interview: 'wait' while the interviews read is out, 'ready' when it answered, 'none' when it failed. */
  readonly book = input<'wait' | 'ready' | 'none'>('wait');
  readonly canNotHire = input(false);
  readonly confirmed = output<DecideChoice>();
  readonly dismissed = output<void>();

  protected readonly w = W;
  protected readonly sw = SW;
  protected readonly picked = signal<DecideChoice | null>(null);
  protected readonly title = computed(() => W['title']!.replace('{candidate}', this.name()));
  protected readonly line = computed(() => [this.name(), this.roleTitle()].filter(Boolean).join(' · '));
  protected readonly ready = computed(() => { const s = this.summary(); return s.kind === 'ready' ? s.summary : null; });
  protected readonly options = computed<Option[]>(() => {
    const out: Option[] = [];
    if (this.canOffer()) out.push({ value: 'move', label: W['move']!, disabled: this.blocked(), ...(this.blocked() ? { description: W['blocked']! } : {}) });
    if (SCHEDULE_READY && this.book() !== 'none') out.push({ value: 'book', label: W['book']!, disabled: this.book() === 'wait' });
    if (this.canNotHire()) out.push({ value: 'notHired', label: W['notHired']! });
    return out;
  });
  protected readonly confirmWords = computed(() => { const p = this.picked(); return p ? W[p]! : W['button']!; });
  protected pick(v: string | null) { this.picked.set(v as DecideChoice | null); }
  protected confirm() { const p = this.picked(); if (p) this.confirmed.emit(p); }

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  /** O-7: the radio group is named by the title. pp-radio-group has no input for it, so it is set after drawing. */
  private readonly nameGroup = afterRenderEffect(() => {
    this.title(); this.options(); this.phone();
    const scope: ParentNode = this.phone() ? this.host : document;
    const head = (this.phone() ? scope.querySelector('h1.pp-page-header__title') : document.querySelector('.pp-drawer .pp-drawer__title')) as HTMLElement | null;
    const group = (this.phone() ? this.host.querySelector('[role="radiogroup"]') : document.querySelector('.pp-drawer [role="radiogroup"]')) as HTMLElement | null;
    if (!head || !group) return;
    if (!head.id) head.id = `decide-title-${Math.random().toString(36).slice(2, 8)}`;
    group.setAttribute('aria-labelledby', head.id);
  });
}
