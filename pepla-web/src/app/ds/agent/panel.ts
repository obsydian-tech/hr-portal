import { ChangeDetectionStrategy, Component, ElementRef, HostListener, TemplateRef, afterNextRender, effect, input, output, signal, untracked, viewChild, Injector, inject } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { A11yModule } from '@angular/cdk/a11y';
import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { PpIcon } from '../core/icon';
import { IconName } from '../core/icon.registry';
import { PpButton } from '../actions/button';
import { PpLayer } from '../overlays/overlays';
import { Proposal, ProposalOutcome, ProposalState, PpProposalCard, PpProposalRow } from './agent';
import { PpChecklistRow } from '../records/records';
import { PpLozenge, Status } from '../status/lozenge';
import { PpEmptyState, PpSectionMessage } from '../messages/messages';
import { uid } from '../util';
import { PpDescriptionList, PpTableDirective, PpTableWrap, PpCell, DlItem } from '../data/data';
import { PpBarChart } from '../data/bar-chart';
import { AnswerBlock, PERSON_ID, knownBlocks, parseAnswerText } from './answer-text';

/** One entry in the conversation. `day` puts a day line ("Today") before it. */
export type PanelMessage =
  | { from: 'person' | 'pepla'; text: string; at?: string; day?: string; checks?: PanelCheck[]; checksLabel?: string; blocks?: AnswerBlock[] }
  | { from: 'proposal'; proposal: Proposal; outcome?: string; day?: string }
  | { from: 'card'; card: PanelCard; day?: string }
  | { from: 'retry'; question: string; day?: string }
  | { from: 'empty'; heading: string; body?: string; icon?: IconName; day?: string }
  | { from: 'warning'; heading: string; day?: string };
/** One check Batsi found, drawn as a row: "ID document" and its result, "Matches". */
export interface PanelCheck { label: string; result: string; }
/** A drafted message Batsi proposes in the chat: Approve, Edit, Decline. `blockedBy` names who may approve when the asker may not. */
export interface PanelCard { id: string; title: string; quote: string; state: ProposalState; blockedBy?: string; outcome?: ProposalOutcome; auditLink?: string; }
export type PanelDecision = { id: string; action: 'approve' | 'edit' | 'decline' | 'retry'; reason?: string };
/** A question to pick (it asks Batsi) or, with a link, a place to go. */
export interface PanelSuggestion { icon: IconName; label: string; link?: string; }

const CHECK_TONE: Record<string, { status: Status; icon: IconName; row: 'done' | 'open' | 'overdue' }> = {
  matches: { status: 'success', icon: 'circle-check', row: 'done' },
  captured: { status: 'success', icon: 'circle-check', row: 'done' },
  signed: { status: 'success', icon: 'circle-check', row: 'done' },
  missing: { status: 'danger', icon: 'octagon-alert', row: 'overdue' },
};
const CHECK_OTHER = { status: 'warning' as Status, icon: 'triangle-alert' as IconName, row: 'open' as const };

/**
 * The one panel to talk to Batsi: a side panel, a full-screen sheet on phone. It is a dialog that traps focus,
 * puts focus in the composer and returns it to the opener. Proposals in the log follow the proposal row rules.
 * `<pp-agent-panel [(open)]="pepla" context="Looking at Kagiso Molefe" [messages]="chat" (send)="ask($event)" />`
 * Spec: agent/agent-panel.md
 */
@Component({
  selector: 'pp-agent-panel',
  imports: [A11yModule, NgTemplateOutlet, RouterLink, PpIcon, PpButton, PpProposalRow, PpProposalCard, PpChecklistRow, PpLozenge, PpEmptyState, PpSectionMessage, PpDescriptionList, PpTableDirective, PpTableWrap, PpCell, PpBarChart],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template #layer>
      <aside [class]="classes()" [attr.role]="inPlace() ? null : 'dialog'" [attr.aria-modal]="inPlace() ? null : 'true'" [attr.aria-labelledby]="id + '-t'" [style.--_height]="inlineSize()" [cdkTrapFocus]="!page()" [cdkTrapFocusAutoCapture]="false">
        <div class="pp-agent-panel__header">
          @if (page()) {
            <!-- The full page has no Close: it has the way back to where the person was. -->
            <a ppButton appearance="subtle" size="small" icon="arrow-left" [routerLink]="backLink()">{{ backLabel() }}</a>
            <ng-container [ngTemplateOutlet]="avatar" />
          } @else if (phone()) { <ng-container [ngTemplateOutlet]="closeButton" /> } @else { <ng-container [ngTemplateOutlet]="avatar" /> }
          <div class="pp-agent-panel__heading">
            <span class="pp-agent-panel__title" role="heading" [attr.aria-level]="level()" [id]="id + '-t'">Batsi</span>
            @if (context()) { <span class="pp-agent-panel__context">{{ context() }}</span> }
          </div>
          @if (expandable() && !page()) {
            <button ppButton appearance="subtle" icon="maximize-2" [iconOnly]="true" type="button" [attr.aria-label]="expandLabel()" (click)="expand.emit()"></button>
          }
          @if (!page()) { @if (phone()) { <ng-container [ngTemplateOutlet]="avatar" /> } @else { <ng-container [ngTemplateOutlet]="closeButton" /> } }
        </div>
        <div #log class="pp-agent-panel__log" role="log" aria-label="Conversation with Batsi" (scroll)="scrolled()">
          @for (m of messages(); track $index) {
            @if (m.day) { <span class="pp-agent-panel__day">{{ m.day }}</span> }
            @switch (m.from) {
              @case ('proposal') {
                <div class="pp-agent-panel__message pp-agent-panel__message--proposal">
                  <pp-proposal-row [proposal]="$any(m).proposal" [outcome]="$any(m).outcome" (approve)="approve.emit($any(m).proposal)" (review)="review.emit($any(m).proposal)" />
                </div>
              }
              @case ('card') {
                <div class="pp-agent-panel__message pp-agent-panel__message--proposal">
                  <pp-proposal-card [proposal]="cardProposal($any(m).card)" [quote]="$any(m).card.quote" [state]="$any(m).card.state" [blockedBy]="$any(m).card.blockedBy" [outcome]="$any(m).card.outcome" [auditLink]="$any(m).card.auditLink"
                    (approve)="decide.emit({ id: $any(m).card.id, action: 'approve' })" (edit)="decide.emit({ id: $any(m).card.id, action: 'edit' })" (decline)="decide.emit({ id: $any(m).card.id, action: 'decline', reason: $event })" (retry)="decide.emit({ id: $any(m).card.id, action: 'retry' })" />
                </div>
              }
              @case ('retry') {
                <div class="pp-agent-panel__message pp-agent-panel__message--pepla">
                  <button ppButton size="small" icon="refresh-cw" type="button" (click)="retry.emit($any(m).question)">Try again</button>
                </div>
              }
              @case ('empty') { <pp-empty-state [compact]="true" [icon]="$any(m).icon" [heading]="$any(m).heading" [body]="$any(m).body" /> }
              @case ('warning') { <pp-section-message tone="warning" [heading]="$any(m).heading" /> }
              @default {
                <div class="pp-agent-panel__message" [class]="'pp-agent-panel__message--' + m.from">
                  <span class="pp-visually-hidden">{{ m.from === 'person' ? 'You said:' : 'Batsi said:' }}</span>
                  <div class="pp-agent-panel__bubble">
                    @if (m.from === 'person') { <span>{{ $any(m).text }}</span> }
                    @else { <ng-container [ngTemplateOutlet]="answer" [ngTemplateOutletContext]="{ $implicit: blocksOf(m) }" /> }
                    @if ($any(m).checks?.length) {
                      <div class="pp-checklist">
                        <ul class="pp-checklist__list" [attr.aria-label]="$any(m).checksLabel ?? null">
                          @for (c of $any(m).checks; track c.label) {
                            <li ppChecklistRow [flat]="true" [label]="c.label" [state]="tone(c.result).row"><pp-lozenge [status]="tone(c.result).status" [icon]="tone(c.result).icon">{{ c.result }}</pp-lozenge></li>
                          }
                        </ul>
                      </div>
                    }
                  </div>
                  @if ($any(m).at) { <span class="pp-agent-panel__meta">{{ $any(m).at }}</span> }
                </div>
              }
            }
          }
          @if (suggestions().length) {
            <ul class="pp-agent-panel__suggestions" aria-label="Tasks Batsi can do">
              @for (s of suggestions(); track s.label) {
                <li>
                  @if (s.link) { <a class="pp-agent-panel__suggestion" [routerLink]="s.link"><svg [ppIcon]="s.icon" /><span>{{ s.label }}</span></a> }
                  @else { <button class="pp-agent-panel__suggestion" type="button" [disabled]="disabled()" (click)="send.emit(s.label)"><svg [ppIcon]="s.icon" /><span>{{ s.label }}</span></button> }
                </li>
              }
            </ul>
          }
          @if (working()) {
            <div class="pp-agent-panel__working" role="status">
              <span class="pp-spinner pp-spinner--small" aria-hidden="true"></span>
              <span>{{ working() }}</span>
              <button ppButton appearance="subtle" size="small" type="button" (click)="stop.emit()">Stop</button>
            </div>
          }
        </div>
        <form class="pp-agent-panel__composer" aria-label="Message Batsi" (submit)="submit($event)">
          @if (notice()) { <pp-section-message tone="warning" [heading]="notice()" /> }
          <div class="pp-agent-panel__input-row">
            <label class="pp-visually-hidden" [for]="id + '-in'">Message Batsi</label>
            <textarea #box class="pp-textarea" [id]="id + '-in'" rows="1" [placeholder]="placeholder()" [value]="draft()" [disabled]="disabled()" (input)="draft.set($any($event.target).value); fit()" (keydown.enter)="enter($event)"></textarea>
            <button ppButton appearance="primary" icon="send" [iconOnly]="true" [size]="phone() ? 'large' : 'medium'" type="submit" aria-label="Send" [disabled]="disabled()" [attr.aria-disabled]="working() ? 'true' : null"></button>
          </div>
          @if (hint()) { <span class="pp-agent-panel__hint">{{ hint() }}</span> }
        </form>
      </aside>
    </ng-template>
    <ng-template #answer let-blocks>
      @for (b of $any(blocks); track $index) {
        @switch (b.kind) {
          @case ('text') { <p class="pp-agent-panel__p">{{ b.text }}</p> }
          @case ('list') {
            @if (b.ordered) { <ol class="pp-agent-panel__list">@for (i of b.items; track $index) { <li>{{ i }}</li> }</ol> }
            @else { <ul class="pp-agent-panel__list">@for (i of b.items; track $index) { <li>{{ i }}</li> }</ul> }
          }
          @case ('facts') {
            @if (b.title) { <p class="pp-agent-panel__block-title">{{ b.title }}</p> }
            <pp-description-list layout="stacked" [items]="factItems(b)" />
          }
          @case ('checks') {
            <div class="pp-checklist">
              <ul class="pp-checklist__list">
                @for (c of b.items; track $index) {
                  <li ppChecklistRow [flat]="true" [label]="c.label" [state]="tone(c.result).row"><pp-lozenge [status]="tone(c.result).status" [icon]="tone(c.result).icon">{{ c.result }}</pp-lozenge></li>
                }
              </ul>
            </div>
          }
          @case ('table') {
            @if (b.title) { <p class="pp-agent-panel__block-title">{{ b.title }}</p> }
            <pp-table-wrap>
              <table ppTable [compact]="true" [stack]="true" class="pp-agent-panel__table">
                <thead><tr>@for (c of b.columns; track $index) { <th scope="col">{{ c.label }}</th> }</tr></thead>
                <tbody>
                  @for (r of b.rows; track $index) {
                    <tr>
                      @for (c of b.columns; track $index; let first = $first) {
                        <td ppCell [label]="c.label">@if (first && isPerson(r.personId)) { <a [routerLink]="['/hr/employees', r.personId]">{{ r.cells?.[c.key] ?? '' }}</a> } @else { {{ r.cells?.[c.key] ?? '' }} }</td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </pp-table-wrap>
            @if (b.more) { <p class="pp-agent-panel__more">{{ b.more }}</p> }
          }
          @case ('chart') { <pp-bar-chart [title]="b.title" [bars]="b.bars ?? []" /> }
        }
      }
    </ng-template>
    <ng-template #avatar><span class="pp-avatar pp-avatar--agent" aria-hidden="true"><svg ppIcon="sparkles" /></span></ng-template>
    <ng-template #closeButton><button ppButton appearance="subtle" icon="x" [iconOnly]="true" type="button" aria-label="Close Batsi" (click)="close()"></button></ng-template>
    @if (open() && inPlace()) { <ng-container [ngTemplateOutlet]="layer" /> }
  `,
  // A block, so a page can give it a width; the panel itself is the aside inside.
  styles: ':host { display: block; }',
})
export class PpAgentPanel extends PpLayer {
  /** CHAT-08: a Batsi answer's blocks; an answer without them is split from its text (no Markdown mark is shown). */
  protected blocksOf(m: PanelMessage): AnswerBlock[] {
    const x = m as { text?: string; blocks?: unknown };
    return Array.isArray(x.blocks) ? knownBlocks(x.blocks) : parseAnswerText(x.text ?? '');
  }
  protected factItems(b: { items?: { label: string; value: string }[] }): DlItem[] { return (b.items ?? []).map((i) => ({ term: i.label, value: i.value })); }
  protected isPerson(id: unknown): boolean { return typeof id === 'string' && PERSON_ID.test(id); }
  /** What Batsi is looking at, in words: "Looking at Kagiso Molefe", "Getting started". */
  readonly context = input<string>();
  readonly placeholder = input('Ask Batsi');
  readonly messages = input<PanelMessage[]>([]);
  /** Up to three things Batsi can do here, for an empty conversation. */
  readonly suggestions = input<PanelSuggestion[]>([]);
  /** What Batsi is doing, in words: "Batsi is reading 6 onboarding checklists". Send waits until it is done. */
  readonly working = input<string>();
  readonly hint = input('Batsi changes nothing until you approve.');
  readonly level = input<1 | 2 | 3>(2);
  /** The panel as the whole page (AI chat mode): a reading column with a rounded composer, no Close. Set `backLink`. */
  readonly page = input(false);
  /** The way back from the page: "Back to Today" (the route the person came from). */
  readonly backLink = input<string>('/');
  readonly backLabel = input('Back to Today');
  /** Shows the button that opens this same conversation as a page (`expand`). Not on the page itself. */
  readonly expandable = input(false);
  readonly expandLabel = input('Open as a full page');
  readonly expand = output<void>();
  /** Stops the composer: offline, or not switched on. */
  readonly disabled = input(false);
  /** A warning above the composer: "You are offline." */
  readonly notice = input<string>();
  readonly decide = output<PanelDecision>();
  readonly retry = output<string>();
  /** Docs only: the phone sheet at any width. In the app the screen width decides. */
  readonly sheet = input(false);
  readonly send = output<string>();
  readonly stop = output<void>();
  readonly approve = output<Proposal>();
  readonly review = output<Proposal>();
  protected readonly id = uid('pp-agent');
  protected readonly layer = viewChild.required<TemplateRef<unknown>>('layer');
  private readonly log = viewChild<ElementRef<HTMLElement>>('log');
  private readonly box = viewChild<ElementRef<HTMLTextAreaElement>>('box');
  protected readonly draft = signal('');
  private readonly narrow = toSignal(inject(BreakpointObserver).observe('(max-width: 767px)').pipe(map((r) => r.matches)), { initialValue: false });
  protected override inPlace(): boolean { return this.inline() || this.page(); }
  protected readonly phone = () => this.sheet() || (!this.inPlace() && this.narrow());
  protected readonly classes = () => ['pp-agent-panel', this.inline() && !this.page() && 'pp-agent-panel--inline', this.page() && 'pp-agent-panel--page', this.sheet() && 'pp-agent-panel--sheet'].filter(Boolean).join(' ');
  protected tone(result: string) { return CHECK_TONE[result.trim().toLowerCase()] ?? CHECK_OTHER; }
  /** A chat card has no sources or destinations to show: only the title and the drafted message. */
  protected cardProposal(c: PanelCard): Proposal {
    return { title: c.title, whyNow: '', sources: [], destinations: [], confidence: 'high', ...(c.blockedBy ? { status: { status: 'information' as Status, text: 'Waiting for approval', icon: 'clock' as IconName } } : {}) };
  }
  private atEnd = true;
  /** Browsers that size a box to its words by themselves (`field-sizing`) need nothing here; the others are sized by hand. */
  private readonly sizesItself = typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content');
  private readonly injector = inject(Injector);

  constructor() {
    super();
    // Open: focus goes to the composer.
    effect(() => { if (this.open() && !this.inPlace()) untracked(() => afterNextRender(() => this.box()?.nativeElement.focus(), { injector: this.injector })); });
    // The box fits its words: when it opens, when the words or the placeholder change, and after a message is sent.
    effect(() => { this.open(); this.draft(); this.placeholder(); untracked(() => afterNextRender(() => this.fit(), { injector: this.injector })); });
    // A new message: follow it down, unless the person has scrolled up to read.
    effect(() => { this.messages(); this.working(); untracked(() => afterNextRender(() => { const el = this.log()?.nativeElement; if (el && this.atEnd) el.scrollTop = el.scrollHeight; }, { injector: this.injector })); });
  }
  /** Grows the message box to show everything in it, a long placeholder that wraps too, up to four lines. */
  @HostListener('window:resize') protected fit() {
    const el = this.box()?.nativeElement;
    if (!el || this.sizesItself) return;
    el.style.height = 'auto';
    const cs = getComputedStyle(el);
    const edges = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    const lines = parseFloat(cs.lineHeight) * 4 + edges;
    el.style.height = `${Math.min(el.scrollHeight + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth), lines)}px`;
  }
  protected scrolled() { const el = this.log()!.nativeElement; this.atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }
  protected enter(e: Event) { if ((e as KeyboardEvent).shiftKey) return; e.preventDefault(); this.submit(e); }
  protected submit(e: Event) {
    e.preventDefault();
    const text = this.draft().trim();
    if (!text || this.working() || this.disabled()) return;
    this.send.emit(text);
    this.draft.set('');
    this.atEnd = true;
  }
  @HostListener('document:keydown.escape') protected escape() { if (this.open() && !this.inPlace()) this.close(); }
}
