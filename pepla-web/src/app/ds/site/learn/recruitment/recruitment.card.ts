import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject } from '@angular/core';
import { PpIcon } from '../../../core/icon';
import { LearnClock } from '../learn.clock';

/** The hero card's four steps, as the kit's preview script plays them (`site-page-heroes.js`, Recruitment): the count in each of the six stages, and the line under the card. */
const STEPS: readonly (readonly [number, number, number, number, number, number, string])[] = [
  [2, 2, 2, 1, 0, 1, '8 candidates across six stages'],
  [2, 1, 3, 1, 0, 1, 'Candidate 4 moved to Interview'],
  [2, 1, 3, 0, 1, 1, 'Offer signed. Candidate 1 is Hired'],
  [1, 2, 3, 0, 1, 1, 'Candidate 7 moved to Screening'],
];

/**
 * The Recruitment page's hero card: the hiring pipeline for one role. The counts move as candidates change stage, the bars grow and shrink with them, and the line
 * under the card says what happened; it loops. It is the kit's card ("Learn more top: Recruitment") and the kit's script, step for step: it starts when 30% of it
 * is in view (not at all under `data-site-still`, which shows its last step at once). Projected into the page top as `[ppSiteLearnCard]`. Browser only.
 * Spec: SITE-09 AC-4.
 */
@Component({
  selector: 'div[ppRecruitCard]',
  imports: [PpIcon],
  providers: [LearnClock],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="pp-site-hcard__head"><span class="pp-site-hcard__avatar" aria-hidden="true"><svg ppIcon="user-plus" /></span><div class="pp-site-hcard__who"><b class="pp-site-hcard__name">Sales Consultant</b><span class="pp-site-hcard__sub">8 candidates · 1 role</span></div><span class="pp-site-status pp-site-status--brand">Hiring</span></div><ul class="pp-site-hcard__pipe"><li class="pp-site-hcard__stage"><span class="pp-site-hcard__label">Applied</span><span class="pp-site-hcard__bar" aria-hidden="true"><span class="pp-site-hcard__grow" style="--_p: 0.5"></span></span><b class="pp-site-hcard__num">2</b></li><li class="pp-site-hcard__stage"><span class="pp-site-hcard__label">Screening</span><span class="pp-site-hcard__bar" aria-hidden="true"><span class="pp-site-hcard__grow" style="--_p: 0.5"></span></span><b class="pp-site-hcard__num">2</b></li><li class="pp-site-hcard__stage"><span class="pp-site-hcard__label">Interview</span><span class="pp-site-hcard__bar" aria-hidden="true"><span class="pp-site-hcard__grow" style="--_p: 0.5"></span></span><b class="pp-site-hcard__num">2</b></li><li class="pp-site-hcard__stage"><span class="pp-site-hcard__label">Offer</span><span class="pp-site-hcard__bar" aria-hidden="true"><span class="pp-site-hcard__grow" style="--_p: 0.25"></span></span><b class="pp-site-hcard__num">1</b></li><li class="pp-site-hcard__stage pp-site-hcard__stage--hired"><span class="pp-site-hcard__label">Hired</span><span class="pp-site-hcard__bar" aria-hidden="true"><span class="pp-site-hcard__grow" style="--_p: 0"></span></span><b class="pp-site-hcard__num">0</b></li><li class="pp-site-hcard__stage pp-site-hcard__stage--out"><span class="pp-site-hcard__label">Not hired</span><span class="pp-site-hcard__bar" aria-hidden="true"><span class="pp-site-hcard__grow" style="--_p: 0.25"></span></span><b class="pp-site-hcard__num">1</b></li></ul><div class="pp-site-hcard__note" aria-live="polite"><span class="pp-site-status pp-site-status--brand">Sample data</span><span data-note>8 candidates across six stages</span></div>
  `,
  host: { class: 'pp-site-hcard', role: 'group', 'aria-label': 'Sample hiring pipeline', 'data-demo': 'hcard-recruitment' },
})
export class PpRecruitCard {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly clock = inject(LearnClock);

  constructor() {
    afterNextRender(() => {
      const card = this.el, clock = this.clock;
      const rows = Array.from(card.querySelectorAll<HTMLElement>('.pp-site-hcard__stage'));
      const noteBox = card.querySelector<HTMLElement>('.pp-site-hcard__note')!, noteText = noteBox.querySelector<HTMLElement>('[data-note]')!;
      let prev: (typeof STEPS)[number] | null = null;
      const set = (i: number) => {
        const s = STEPS[i]!;
        rows.forEach((r, k) => {
          if (prev && prev[k] !== s[k]) { r.classList.add('pp-site-hcard__stage--bump'); clock.at(800, () => r.classList.remove('pp-site-hcard__stage--bump')); }
          const n = Number(s[k]);
          r.querySelector<HTMLElement>('.pp-site-hcard__num')!.textContent = String(n);
          r.querySelector<HTMLElement>('.pp-site-hcard__grow')!.style.setProperty('--_p', String(n / 4));
        });
        noteText.textContent = s[6];
        noteBox.classList.toggle('pp-site-hcard__note--good', i === 2);
        noteBox.classList.toggle('pp-site-hcard__note--late', false);
        prev = s;
      };
      if (clock.still) { set(STEPS.length - 1); return; }
      const play = () => {
        clock.stop();
        for (let i = 0; i < STEPS.length; i++) clock.at(i === 0 ? 200 : 900 + i * 2600, () => set(i));
        clock.at(900 + STEPS.length * 2600 + 2400, () => { prev = null; play(); });
      };
      clock.onView(card, play, 0.3);
    });
  }
}
