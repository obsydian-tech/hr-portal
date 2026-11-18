import { ChangeDetectionStrategy, Component, DestroyRef, Directive, ElementRef, afterNextRender, booleanAttribute, computed, inject, input } from '@angular/core';
import { PpIcon } from '../../../core/icon';
import { PpSiteReveal } from '../../motion';
import { PpSiteLearnLink } from '../learn.link';
import { LearnClock } from '../learn.clock';
import { ENGINES } from '../learn.engines';
import type { LearnDemoText } from '../learn.types';
import { RECRUIT_ENGINES, type RecruitEngine } from './recruitment.engines';

/** What moves in a Recruitment demo: the page's own engines (`recruitment.engines.ts`) or the shared timeline (SITE-08). */
export type RecruitDemoEngine = RecruitEngine | 'timeline';

/**
 * What every demo section of the Recruitment page does: it plays once, the first time it is in view (the engine says how much), keeps its place when it
 * scrolls away and back, and Play again restarts it and keeps focus on the button. With `data-site-still` on the page nothing is scheduled and the section
 * shows its last step. Browser only: nothing runs on the server. Same rule as the SITE-08 demo section (`PpSiteLearnDemo`).
 */
@Directive()
abstract class RecruitDemoBase {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly clock = inject(LearnClock);
  private readonly destroyed = inject(DestroyRef);
  /** Keeps the ids of this section unique where the page holds more than one. */
  readonly uid = input.required<string>();
  readonly text = input.required<LearnDemoText>();
  readonly engine = input.required<RecruitDemoEngine>();
  /** A link under the list (the last demo has one, to the page that picks up where it ends). */
  readonly more = input<{ text: string; href: string }>();
  readonly cream = input(false, { transform: booleanAttribute });
  readonly flip = input(false, { transform: booleanAttribute });
  protected readonly titleId = computed(() => `demo-t-${this.uid()}`);

  constructor() {
    afterNextRender(() => {
      const run = this.engine() === 'timeline' ? ENGINES.timeline : RECRUIT_ENGINES[this.engine() as RecruitEngine];
      const clock = this.clock;
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

const HOST = {
  class: 'pp-site-demo',
  '[class.pp-site-demo--cream]': 'cream()',
  '[class.pp-site-demo--flip]': 'flip()',
  '[attr.aria-labelledby]': 'titleId()',
  'data-live': '',
} as const;

/** A Recruitment demo section: the words and the list on one side, the sample panel on the other (projected), as the kit's Recruitment page draws it. */
@Component({
  selector: 'section[ppRecruitDemo]',
  imports: [PpIcon, PpSiteReveal, PpSiteLearnLink],
  providers: [LearnClock],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="pp-site-wrap pp-site-demo__split"><div class="pp-site-demo__text"><p class="pp-site-eyebrow" [ppSiteReveal]="0">{{ text().eyebrow }}</p>
<h2 class="pp-site-demo__title" [ppSiteReveal]="1" [id]="titleId()">{{ text().title }}</h2>
<p class="pp-site-demo__lead" [ppSiteReveal]="2">{{ text().lead }}</p>
<ul class="pp-site-demo__list" [ppSiteReveal]="3">@for (p of text().points; track p.text) {<li class="pp-site-demo__item"><span class="pp-site-demo__tick" aria-hidden="true"><svg ppIcon="check" /></span>{{ p.text }}@if (p.batsi) {<span class="pp-lozenge pp-lozenge--agent"><svg ppIcon="sparkles" />Batsi</span>}</li>}</ul>@if (more(); as m) {<a ppSiteLearnLink class="pp-link pp-link--standalone" [ppSiteReveal]="4" [attr.href]="m.href"><span>{{ m.text }}</span><svg ppIcon="arrow-right" /></a>}
</div>
<div class="pp-site-demo__vis" [ppSiteReveal]="2"><ng-content /></div>
</div>
  `,
  host: HOST,
})
export class PpRecruitDemo extends RecruitDemoBase {}

/** The hiring board's section: the words and the list side by side, the board below them at the full width (projected). */
@Component({
  selector: 'section[ppRecruitBoardDemo]',
  imports: [PpIcon, PpSiteReveal],
  providers: [LearnClock],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="pp-site-wrap"><div class="pp-site-demo__head"><div class="pp-site-demo__text"><p class="pp-site-eyebrow" [ppSiteReveal]="0">{{ text().eyebrow }}</p>
<h2 class="pp-site-demo__title" [ppSiteReveal]="1" [id]="titleId()">{{ text().title }}</h2>
<p class="pp-site-demo__lead" [ppSiteReveal]="2">{{ text().lead }}</p>
</div>
<ul class="pp-site-demo__list" [ppSiteReveal]="3">@for (p of text().points; track p.text) {<li class="pp-site-demo__item"><span class="pp-site-demo__tick" aria-hidden="true"><svg ppIcon="check" /></span>{{ p.text }}@if (p.batsi) {<span class="pp-lozenge pp-lozenge--agent"><svg ppIcon="sparkles" />Batsi</span>}</li>}</ul>
</div>
<div class="pp-site-demo__wide" [ppSiteReveal]="2"><ng-content /></div>
</div>
  `,
  host: HOST,
})
export class PpRecruitBoardDemo extends RecruitDemoBase {}
