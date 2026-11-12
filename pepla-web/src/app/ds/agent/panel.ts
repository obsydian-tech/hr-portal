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
import { Proposal, PpProposalRow } from './agent';
import { uid } from '../util';

/** One entry in the conversation. `day` puts a day line ("Today") before it. */
export type PanelMessage =
  | { from: 'person' | 'pepla'; text: string; at?: string; day?: string }
  | { from: 'proposal'; proposal: Proposal; outcome?: string; day?: string };
export interface PanelSuggestion { icon: IconName; label: string; link: string; }

/**
 * The one panel to talk to Batsi: a side panel, a full-screen sheet on phone. It is a dialog that traps focus,
 * puts focus in the composer and returns it to the opener. Proposals in the log follow the proposal row rules.
 * `<pp-agent-panel [(open)]="pepla" context="Looking at Kagiso Molefe" [messages]="chat" (send)="ask($event)" />`
 * Spec: agent/agent-panel.md
 */
@Component({
  selector: 'pp-agent-panel',
  imports: [A11yModule, NgTemplateOutlet, RouterLink, PpIcon, PpButton, PpProposalRow],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template #layer>
      <aside [class]="classes()" [attr.role]="inline() ? null : 'dialog'" [attr.aria-modal]="inline() ? null : 'true'" [attr.aria-labelledby]="id + '-t'" [style.--_height]="inlineSize()" cdkTrapFocus [cdkTrapFocusAutoCapture]="false">
        <div class="pp-agent-panel__header">
          @if (phone()) { <ng-container [ngTemplateOutlet]="closeButton" /> } @else { <ng-container [ngTemplateOutlet]="avatar" /> }
          <div class="pp-agent-panel__heading">
            <span class="pp-agent-panel__title" role="heading" [attr.aria-level]="level()" [id]="id + '-t'">Batsi</span>
            @if (context()) { <span class="pp-agent-panel__context">{{ context() }}</span> }
          </div>
          @if (phone()) { <ng-container [ngTemplateOutlet]="avatar" /> } @else { <ng-container [ngTemplateOutlet]="closeButton" /> }
        </div>
        <div #log class="pp-agent-panel__log" role="log" aria-label="Conversation with Batsi" (scroll)="scrolled()">
          @for (m of messages(); track $index) {
            @if (m.day) { <span class="pp-agent-panel__day">{{ m.day }}</span> }
            @if (m.from === 'proposal') {
              <div class="pp-agent-panel__message pp-agent-panel__message--proposal">
                <pp-proposal-row [proposal]="m.proposal" [outcome]="m.outcome" (approve)="approve.emit(m.proposal)" (review)="review.emit(m.proposal)" />
              </div>
            } @else {
              <div class="pp-agent-panel__message" [class]="'pp-agent-panel__message--' + m.from">
                <span class="pp-visually-hidden">{{ m.from === 'person' ? 'You said:' : 'Batsi said:' }}</span>
                <div class="pp-agent-panel__bubble">{{ m.text }}</div>
                @if (m.at) { <span class="pp-agent-panel__meta">{{ m.at }}</span> }
              </div>
            }
          }
          @if (suggestions().length) {
            <ul class="pp-agent-panel__suggestions" aria-label="Tasks Batsi can do">
              @for (s of suggestions(); track s.label) { <li><a class="pp-agent-panel__suggestion" [routerLink]="s.link"><svg [ppIcon]="s.icon" /><span>{{ s.label }}</span></a></li> }
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
          <div class="pp-agent-panel__input-row">
            <label class="pp-visually-hidden" [for]="id + '-in'">Message Batsi</label>
            <textarea #box class="pp-textarea" [id]="id + '-in'" rows="1" [placeholder]="placeholder()" [value]="draft()" (input)="draft.set($any($event.target).value)" (keydown.enter)="enter($event)"></textarea>
            <button ppButton appearance="primary" icon="send" [iconOnly]="true" [size]="phone() ? 'large' : 'medium'" type="submit" aria-label="Send" [attr.aria-disabled]="working() ? 'true' : null"></button>
          </div>
          @if (hint()) { <span class="pp-agent-panel__hint">{{ hint() }}</span> }
        </form>
      </aside>
    </ng-template>
    <ng-template #avatar><span class="pp-avatar pp-avatar--agent" aria-hidden="true"><svg ppIcon="sparkles" /></span></ng-template>
    <ng-template #closeButton><button ppButton appearance="subtle" icon="x" [iconOnly]="true" type="button" aria-label="Close Batsi" (click)="close()"></button></ng-template>
    @if (open() && inline()) { <ng-container [ngTemplateOutlet]="layer" /> }
  `,
  // A block, so a page can give it a width; the panel itself is the aside inside.
  styles: ':host { display: block; }',
})
export class PpAgentPanel extends PpLayer {
  /** What Batsi is looking at, in words: "Looking at Kagiso Molefe", "Getting started". */
  readonly context = input<string>();
  readonly placeholder = input('Ask Batsi');
  readonly messages = input<PanelMessage[]>([]);
  /** Up to three things Batsi can do here, for an empty conversation. */
  readonly suggestions = input<PanelSuggestion[]>([]);
  /** What Batsi is doing, in words: "Batsi is reading 6 onboarding checklists". Send waits until it is done. */
  readonly working = input<string>();
  readonly hint = input('Batsi changes nothing until you approve.');
  readonly level = input<2 | 3>(2);
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
  protected readonly phone = () => this.sheet() || (!this.inline() && this.narrow());
  protected readonly classes = () => ['pp-agent-panel', this.inline() && 'pp-agent-panel--inline', this.sheet() && 'pp-agent-panel--sheet'].filter(Boolean).join(' ');
  private atEnd = true;
  private readonly injector = inject(Injector);

  constructor() {
    super();
    // Open: focus goes to the composer.
    effect(() => { if (this.open() && !this.inline()) untracked(() => afterNextRender(() => this.box()?.nativeElement.focus(), { injector: this.injector })); });
    // A new message: follow it down, unless the person has scrolled up to read.
    effect(() => { this.messages(); this.working(); untracked(() => afterNextRender(() => { const el = this.log()?.nativeElement; if (el && this.atEnd) el.scrollTop = el.scrollHeight; }, { injector: this.injector })); });
  }
  protected scrolled() { const el = this.log()!.nativeElement; this.atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }
  protected enter(e: Event) { if ((e as KeyboardEvent).shiftKey) return; e.preventDefault(); this.submit(e); }
  protected submit(e: Event) {
    e.preventDefault();
    const text = this.draft().trim();
    if (!text || this.working()) return;
    this.send.emit(text);
    this.draft.set('');
    this.atEnd = true;
  }
  @HostListener('document:keydown.escape') protected escape() { if (this.open() && !this.inline()) this.close(); }
}
