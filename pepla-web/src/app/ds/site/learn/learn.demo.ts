import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, booleanAttribute, computed, inject, input } from '@angular/core';
import { PpIcon } from '../../core/icon';
import { PpSiteReveal } from '../motion';
import { LearnClock } from './learn.clock';
import { ENGINES, LearnEngine } from './learn.engines';
import type { LearnDemoText } from './learn.types';

/**
 * A demo section of a Learn more page: the words on one side (eyebrow, headline, line, points) and a sample panel on the other, white or
 * cream, and flipped so the panel comes first from 1024. The panel is projected (`<div ppSiteLearnRows>`, `<div ppSiteLearnTimeline>`, a page's own).
 *
 * When the section is `live` it plays once, the first time 35% of it is in view; it keeps its place when it scrolls away and back,
 * and Play again restarts it and keeps focus on the button. `engine` names what moves (learn.engines.ts, the kit's preview script).
 * With `data-site-still` on the page nothing is scheduled and the section shows its last step. Browser only: nothing runs on the server.
 * The section's `id` is the page's own (`<section ppSiteLearnDemo id="types">`), which the sub-menu's tab points at.
 * Spec: SITE-08, kit: project/components/site/site-demo.md
 */
@Component({
  selector: 'section[ppSiteLearnDemo]',
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
    '[attr.data-live]': 'live() ? "" : null',
  },
})
export class PpSiteLearnDemo {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly clock = inject(LearnClock);
  private readonly destroyed = inject(DestroyRef);
  /** Makes the ids of this section unique on a page that holds more than one (the gallery holds a desktop and a phone of each). */
  readonly uid = input.required<string>();
  readonly text = input.required<LearnDemoText>();
  /** What moves in the panel. Without it the section is still. */
  readonly engine = input<LearnEngine>();
  /** The section plays by itself when it comes into view. The kit's phone "Demo section" example does not. */
  readonly live = input(false, { transform: booleanAttribute });
  readonly cream = input(false, { transform: booleanAttribute });
  readonly flip = input(false, { transform: booleanAttribute });
  protected readonly titleId = computed(() => `demo-t-${this.uid()}`);

  constructor() {
    afterNextRender(() => {
      const engine = this.engine();
      if (!engine) return;
      const clock = this.clock;
      const listeners: Array<() => void> = [];
      ENGINES[engine]({
        sec: this.el,
        clock,
        on: (el, type, fn) => { el.addEventListener(type, fn); listeners.push(() => el.removeEventListener(type, fn)); },
        start: (play, threshold = 0.35) => {
          if (clock.still || !this.live()) return;
          clock.onView(this.el, play, threshold);
        },
      });
      this.destroyed.onDestroy(() => listeners.forEach((off) => off()));
    });
  }
}
