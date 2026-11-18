import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject } from '@angular/core';
import { PpIcon } from '../../../core/icon';
import { LearnClock } from '../learn.clock';

/** The six steps of the hero card. */
const STEPS = 6;

/**
 * The Onboarding page's hero card: one new employee's record. The steps are picked up one after another (1.3s apart from 0.9s), the meter fills, the count and the
 * status follow, and after a rest it starts again. It is the kit's card ("Learn more top: Onboarding") and the kit's script (`site-page-heroes.js`), step for step:
 * it starts when 30% of it is in view (not at all under `data-site-still`, which shows its last step at once). Projected into the page top as `[ppSiteLearnCard]`.
 * Browser only. Spec: SITE-10 AC-4.
 */
@Component({
  selector: 'div[ppOnbCard]',
  imports: [PpIcon],
  providers: [LearnClock],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="pp-site-hcard__head"><span class="pp-site-hcard__avatar" aria-hidden="true">JD</span><div class="pp-site-hcard__who"><b class="pp-site-hcard__name">John Doe</b><span class="pp-site-hcard__sub">Sales Consultant · starts 1 December</span></div><span class="pp-site-status pp-site-status--brand">Onboarding</span></div><div><div class="pp-site-hcard__meter" aria-hidden="true"><span class="pp-site-hcard__fill" style="--_p: 0"></span></div><div class="pp-site-hcard__count"><span>Onboarding</span><span data-count>0 of 6</span></div></div><ol class="pp-site-hcard__steps"><li class="pp-site-hcard__step"><span class="pp-site-hcard__mark" aria-hidden="true"><svg ppIcon="check" /></span><span>Offer accepted</span><span class="pp-site-hcard__owner">Mon 17 Nov</span></li><li class="pp-site-hcard__step"><span class="pp-site-hcard__mark" aria-hidden="true"><svg ppIcon="check" /></span><span>Documents in</span><span class="pp-site-hcard__owner">John Doe</span></li><li class="pp-site-hcard__step"><span class="pp-site-hcard__mark" aria-hidden="true"><svg ppIcon="check" /></span><span>Documents read and matched</span><span class="pp-lozenge pp-lozenge--agent"><svg ppIcon="sparkles" />Batsi</span><span class="pp-site-hcard__owner">Jane Smith</span></li><li class="pp-site-hcard__step"><span class="pp-site-hcard__mark" aria-hidden="true"><svg ppIcon="check" /></span><span>Contract signed</span><span class="pp-site-hcard__owner">John Doe</span></li><li class="pp-site-hcard__step"><span class="pp-site-hcard__mark" aria-hidden="true"><svg ppIcon="check" /></span><span>Laptop and access</span><span class="pp-site-hcard__owner">IT · due 28 Nov</span></li><li class="pp-site-hcard__step"><span class="pp-site-hcard__mark" aria-hidden="true"><svg ppIcon="check" /></span><span>Day one</span><span class="pp-site-hcard__owner">Manager · 1 Dec</span></li></ol>
  `,
  host: { class: 'pp-site-hcard', role: 'group', 'aria-label': 'Sample onboarding record', 'data-demo': 'hcard-onboarding' },
})
export class PpOnbCard {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly clock = inject(LearnClock);

  constructor() {
    afterNextRender(() => {
      const card = this.el, clock = this.clock;
      const lis = Array.from(card.querySelectorAll<HTMLElement>('.pp-site-hcard__step'));
      const fill = card.querySelector<HTMLElement>('.pp-site-hcard__fill')!, count = card.querySelector<HTMLElement>('[data-count]')!;
      const head = card.querySelector<HTMLElement>('.pp-site-hcard__head > .pp-site-status')!;
      const set = (k: number) => {
        lis.forEach((li, i) => { li.classList.toggle('pp-site-hcard__step--done', i < k); li.classList.toggle('pp-site-hcard__step--now', i === k); });
        fill.style.setProperty('--_p', String(k / STEPS)); count.textContent = `${k} of ${STEPS}`;
        if (k >= STEPS) { head.className = 'pp-site-status pp-site-status--success'; head.textContent = 'Active'; }
        else { head.className = 'pp-site-status pp-site-status--brand'; head.textContent = 'Onboarding'; }
      };
      if (clock.still) { set(STEPS); return; }
      const play = () => {
        clock.stop(); set(0);
        for (let k = 1; k <= STEPS; k++) clock.at(900 + k * 1300, () => set(k));
        clock.at(900 + STEPS * 1300 + 3200, play);
      };
      clock.onView(card, play, 0.3);
    });
  }
}
