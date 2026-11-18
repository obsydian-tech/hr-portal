import { ChangeDetectionStrategy, Component, DestroyRef, Directive, ElementRef, afterNextRender, booleanAttribute, computed, inject, input } from '@angular/core';
import { PpIcon } from '../../../core/icon';
import { PpSiteReveal } from '../../motion';
import { LearnClock } from '../learn.clock';
import { ENGINES } from '../learn.engines';
import type { LearnDemoText } from '../learn.types';
import { ONB_ENGINES, type OnbEngine } from './onboarding.engines';

/** What moves in an Onboarding demo: the page's own engines (`onboarding.engines.ts`) or the shared document read and live status (SITE-08). */
export type OnbDemoEngine = OnbEngine | 'doc-read' | 'live-status';

/**
 * A demo section of the Onboarding page: the words and the list on one side, the sample panel on the other (projected), as the kit's Onboarding page draws it.
 * It plays once, the first time it is in view (the engine says how much), keeps its place when it scrolls away and back, and Play again restarts it and keeps
 * focus on the button. With `data-site-still` on the page nothing is scheduled and the section shows its last step. Browser only: nothing runs on the server.
 * Same rule as the SITE-08 demo section (`PpSiteLearnDemo`).
 */
@Component({
  selector: 'section[ppOnbDemo]',
  imports: [PpIcon, PpSiteReveal],
  providers: [LearnClock],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="pp-site-wrap pp-site-demo__split"><div class="pp-site-demo__text"><p class="pp-site-eyebrow" [ppSiteReveal]="0">{{ text().eyebrow }}</p>
<h2 class="pp-site-demo__title" [ppSiteReveal]="1" [id]="titleId()">{{ text().title }}</h2>
<p class="pp-site-demo__lead" [ppSiteReveal]="2">{{ text().lead }}</p>
<ul class="pp-site-demo__list" [ppSiteReveal]="3">@for (p of text().points; track p.text) {<li class="pp-site-demo__item"><span class="pp-site-demo__tick" aria-hidden="true"><svg ppIcon="check" /></span>{{ p.text }}@if (p.batsi) {<span class="pp-lozenge pp-lozenge--agent"><svg ppIcon="sparkles" />Batsi</span>}</li>}</ul>
</div>
<div class="pp-site-demo__vis" [ppSiteReveal]="2"><ng-content /></div>
</div>
  `,
  host: {
    class: 'pp-site-demo',
    '[class.pp-site-demo--cream]': 'cream()',
    '[class.pp-site-demo--flip]': 'flip()',
    '[attr.aria-labelledby]': 'titleId()',
    'data-live': '',
  },
})
export class PpOnbDemo {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly clock = inject(LearnClock);
  private readonly destroyed = inject(DestroyRef);
  /** Keeps the ids of this section unique where the page holds more than one. */
  readonly uid = input.required<string>();
  readonly text = input.required<LearnDemoText>();
  readonly engine = input.required<OnbDemoEngine>();
  readonly cream = input(false, { transform: booleanAttribute });
  readonly flip = input(false, { transform: booleanAttribute });
  protected readonly titleId = computed(() => `demo-t-${this.uid()}`);

  constructor() {
    afterNextRender(() => {
      const e = this.engine();
      const run = e === 'doc-read' || e === 'live-status' ? ENGINES[e] : ONB_ENGINES[e];
      const clock = this.clock;
      if (clock.still && e === 'doc-read') stillDocRead(this.el);
      if (clock.still && e === 'live-status') stillFollow(this.el);
      const listeners: Array<() => void> = [];
      run({
        sec: this.el,
        clock,
        on: (el, type, fn) => { el.addEventListener(type, fn); listeners.push(() => el.removeEventListener(type, fn)); },
        start: (play, threshold = 0.35) => { if (!clock.still) clock.onView(this.el, play, threshold); },
      });
      this.destroyed.onDestroy(() => listeners.forEach((off) => off()));
    });
  }
}

/**
 * Under `data-site-still` a demo shows the end of its run. The kit's markup already shows it, except for what the run itself sets: here the document read's scan
 * (`--go`), the pressed Accept button and the status that says it was accepted. Same end state the shared `doc-read` engine reaches after its last step.
 */
function stillDocRead(sec: HTMLElement): void {
  sec.querySelector('.pp-site-read__doc')?.classList.add('pp-site-read__doc--go');
  sec.querySelector('.pp-site-read__decide .pp-button--primary')?.classList.add('pp-button--pressed');
  sec.querySelectorAll('.pp-site-demo__top .pp-site-state__item').forEach((i) => {
    const on = i.getAttribute('data-state') === 'accepted';
    i.classList.toggle('pp-site-state__item--on', on);
    if (on) i.removeAttribute('aria-hidden'); else i.setAttribute('aria-hidden', 'true');
  });
}

/** The follow-ups' line ends where the last step of the run puts it (the kit's markup says 1): the same sum the engine makes, again once the fonts are in. */
function stillFollow(sec: HTMLElement): void {
  const set = () => {
    const li = Array.from(sec.querySelectorAll<HTMLElement>('.pp-site-timeline__item')), fill = sec.querySelector<HTMLElement>('.pp-site-timeline__fill');
    if (li.length && fill) fill.style.setProperty('--_fill', String(Math.min(1, (li[li.length - 1]!.offsetTop + 10) / fill.offsetHeight)));
  };
  set();
  sec.ownerDocument.fonts?.ready.then(set);
}
