import { ChangeDetectionStrategy, Component, ElementRef, OnInit, afterNextRender, booleanAttribute, computed, inject, input, signal } from '@angular/core';
import { PpIcon } from '../../core/icon';
import { PpSiteReveal } from '../motion';
import { LearnClock } from './learn.clock';
import type { LearnAsk, LearnQuestion } from './learn.types';

/** What the conversation shows when the page opens: the first question answered, an action waiting for a person, or that action approved and logged. */
export type LearnAskPhase = 'answered' | 'waiting' | 'approved';

type Msg =
  | { id: number; kind: 'me'; text: string }
  | { id: number; kind: 'typing' }
  | { id: number; kind: 'ai'; text: string; rows: LearnQuestion['rows']; ask?: string; actions?: { button: string; pressed: boolean } | null }
  | { id: number; kind: 'logged'; text: string };

let ids = 0;

/**
 * Ask Batsi on a Learn more page: three sample questions as chips and a conversation that answers them. A question plays like the kit's
 * preview script (the question 0.3s in, typing at 0.9s, the answer at 2s, the action pressed 2.6s after the answer, the person's line 0.35s later, Batsi's line 0.7s and the log line 1.3s after that;
 * the next question follows 5.2s after the last line) until a visitor presses a chip or an action, which stops the cycle for good.
 * Without a play it shows the first answer, as the kit does, so a prerendered page and a screenshot hold the same words.
 * The section plays once, the first time 25% of it is in view, when `live`. Spec: SITE-08, kit: project/components/site/site-batsi.md (Ask Batsi band)
 */
@Component({
  selector: 'section[ppSiteLearnAsk]',
  imports: [PpIcon, PpSiteReveal],
  providers: [LearnClock],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="pp-site-batsi__glow" aria-hidden="true"></div>
<div class="pp-site-wrap pp-site-batsi__split"><div class="pp-site-batsi__text"><p class="pp-site-eyebrow" [ppSiteReveal]="0">Ask Batsi</p>
<h2 class="pp-site-batsi__title" [ppSiteReveal]="1" [id]="titleId()">{{ ask().title }}</h2>
<p class="pp-site-batsi__lead" [ppSiteReveal]="2">{{ ask().lead }}</p>
<div class="pp-site-ask" role="group" aria-label="Sample questions" [ppSiteReveal]="3">@for (x of ask().questions; track x.q; let i = $index) {<button class="pp-site-ask__chip" type="button" [attr.aria-pressed]="cur() === i" [attr.data-q]="i" (click)="choose(i)"><span class="pp-site-ask__label">{{ x.q }}</span><span class="pp-site-ask__label pp-site-ask__label--on" aria-hidden="true">{{ x.q }}</span></button>}</div>
</div>
<div class="pp-site-batsi__vis" [ppSiteReveal]="2"><div class="pp-site-chat" role="group" aria-label="Ask Batsi, sample conversation"><div class="pp-site-chat__top"><span class="pp-site-chat__name"><svg ppIcon="sparkles" />Ask Batsi</span><span class="pp-site-chat__note">Sample data</span></div>
<div class="pp-site-chat__body" aria-live="polite">@for (m of messages(); track m.id) {@switch (m.kind) {
@case ('me') {<div class="pp-site-chat__msg pp-site-chat__msg--me">{{ m.text }}</div>}
@case ('typing') {<div class="pp-site-chat__typing"><i></i><i></i><i></i></div>}
@case ('logged') {<div class="pp-site-chat__logged">{{ m.text }}</div>}
@case ('ai') {<div class="pp-site-chat__msg pp-site-chat__msg--ai"><span class="pp-site-chat__who"><svg ppIcon="sparkles" />Batsi</span>{{ m.text }}@if (m.rows.length) {<span class="pp-site-chat__rows">@for (r of m.rows; track r[0]) {<span class="pp-site-chat__row">{{ r[0] }}<span class="pp-site-status" [class]="r[1] ? 'pp-site-status--' + r[1] : ''">{{ r[2] }}</span></span>}</span>}@if (m.ask) {<p class="pp-site-chat__ask">{{ m.ask }}</p>}@if (m.actions) {<div class="pp-site-chat__actions"><button class="pp-button pp-button--primary pp-button--small" [class.pp-button--pressed]="m.actions.pressed" type="button" (click)="press(m)">{{ m.actions.button }}</button><button class="pp-button pp-button--default pp-button--small" type="button">Not now</button></div>}</div>}
}}</div>
</div></div>
</div>
  `,
  host: { class: 'pp-site-batsi', '[attr.aria-labelledby]': 'titleId()', '[attr.data-live]': 'live() ? "" : null', '[attr.data-batsi]': 'ask().key' },
})
export class PpSiteLearnAsk implements OnInit {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly clock = inject(LearnClock);
  readonly uid = input.required<string>();
  readonly ask = input.required<LearnAsk>();
  /** The question shown first, and how far its conversation has got. */
  readonly question = input(0);
  readonly phase = input<LearnAskPhase>('answered');
  /** Plays by itself when it comes into view. */
  readonly live = input(false, { transform: booleanAttribute });
  protected readonly titleId = computed(() => `bt-t-${this.uid()}`);
  protected readonly cur = signal(0);
  protected readonly messages = signal<Msg[]>([]);
  private auto = true;
  private started = false;
  /** The action the band opens with (the kit answers it at once, with no timers). */
  private opening: number | null = null;

  constructor() {
    afterNextRender(() => { if (!this.clock.still && this.live()) this.clock.onView(this.el, () => { if (!this.started) { this.started = true; this.play(0); } }, 0.25); });
  }

  /** The frame the band opens on (before any play), from the inputs. */
  ngOnInit(): void {
    const i = this.question();
    this.cur.set(i);
    const x = this.ask().questions[i]!;
    const first: Extract<Msg, { kind: 'ai' }> = { id: ++ids, kind: 'ai', text: x.a, rows: x.rows, ...(x.ask ? { ask: x.ask } : {}), ...(x.ask && this.phase() !== 'approved' ? { actions: { button: x.button!, pressed: false } } : {}) };
    if (first.actions) this.opening = first.id;
    const list: Msg[] = [{ id: ++ids, kind: 'me', text: x.q }, first];
    if (this.phase() === 'approved' && x.ask) list.push(...this.endOf(x));
    this.messages.set(list);
  }

  private endOf(x: LearnQuestion): Msg[] {
    return [{ id: ++ids, kind: 'me', text: 'Yes, send it.' }, { id: ++ids, kind: 'ai', text: x.done!, rows: [] }, { id: ++ids, kind: 'logged', text: x.log! }];
  }

  private push(m: Msg): void { this.messages.update((l) => [...l, m]); }

  protected choose(i: number): void { this.auto = false; this.play(i); }

  /** Press the action by hand (a person's click stops the cycle for good). */
  protected press(m: Msg): void {
    if (m.kind !== 'ai' || !m.actions) return;
    if (m.id === this.opening) {
      const x = this.ask().questions[this.cur()]!;
      this.opening = null;
      this.messages.update((l) => [...l.map((e) => (e.id === m.id && e.kind === 'ai' ? { ...e, actions: null } : e)), ...this.endOf(x)]);
      return;
    }
    this.auto = false;
    this.finish(m);
  }

  private next(): void { if (this.auto) this.clock.at(5200, () => this.play((this.cur() + 1) % this.ask().questions.length)); }

  /** The action is answered: its buttons go, the person's "Yes, send it.", Batsi's line 0.7s later and the log line 0.6s after that. */
  private finish(m: Extract<Msg, { kind: 'ai' }>): void {
    if (!m.actions) return;
    const x = this.ask().questions[this.cur()]!;
    this.clock.stop();
    this.messages.update((l) => l.map((e) => (e.id === m.id && e.kind === 'ai' ? { ...e, actions: null } : e)));
    this.push({ id: ++ids, kind: 'me', text: 'Yes, send it.' });
    this.clock.at(700, () => this.push({ id: ++ids, kind: 'ai', text: x.done!, rows: [] }));
    this.clock.at(1300, () => { this.push({ id: ++ids, kind: 'logged', text: x.log! }); this.next(); });
  }

  private play(i: number): void {
    const c = this.clock;
    c.stop();
    this.messages.set([]);
    this.cur.set(i);
    const x = this.ask().questions[i]!;
    c.at(300, () => this.push({ id: ++ids, kind: 'me', text: x.q }));
    c.at(900, () => this.push({ id: ++ids, kind: 'typing' }));
    c.at(2000, () => {
      this.messages.update((l) => l.filter((e) => e.kind !== 'typing'));
      const m: Extract<Msg, { kind: 'ai' }> = { id: ++ids, kind: 'ai', text: x.a, rows: x.rows, ...(x.ask ? { ask: x.ask, actions: { button: x.button!, pressed: false } } : {}) };
      this.push(m);
      if (x.ask) {
        // As in the kit, the action is pressed for the visitor 2.6s after the answer, whether the question came from the cycle or from a chip.
        c.at(2600, () => {
          this.messages.update((l) => l.map((e) => (e.id === m.id && e.kind === 'ai' && e.actions ? { ...e, actions: { ...e.actions, pressed: true } } : e)));
          c.at(350, () => this.finish(m));
        });
      } else this.next();
    });
  }
}
