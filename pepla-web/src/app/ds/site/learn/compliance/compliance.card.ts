import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject } from '@angular/core';
import { PpIcon } from '../../../core/icon';
import { LearnClock } from '../learn.clock';

/** The days left on each row of the card on the first day (the kit's `data-d`). */
const DAYS = [9, 38, 16, 195] as const;

/**
 * The Compliance page's hero card: the certificate register on 3 November. Six days on, a reminder goes out at 7 days; five more and the forklift licence has
 * expired and Jane Smith is told; then the renewal is accepted and the card starts again. It is the kit's card ("Learn more top: Compliance") and the kit's
 * script (`site-page-heroes.js`), step for step: it starts when 30% of it is in view (not at all under `data-site-still`, which shows its last step at once).
 * Projected into the page top as `[ppSiteLearnCard]`. Browser only. Spec: SITE-11 AC-4.
 */
@Component({
  selector: 'div[ppCompCard]',
  imports: [PpIcon],
  providers: [LearnClock],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="pp-site-hcard__head"><span class="pp-site-hcard__avatar" aria-hidden="true"><svg ppIcon="shield" /></span><div class="pp-site-hcard__who"><b class="pp-site-hcard__name">Certificates and licences</b><span class="pp-site-hcard__sub" data-day>Today · 3 Nov</span></div><span class="pp-site-status pp-site-status--success">4 of 4 cleared</span></div><div class="pp-site-ledger pp-site-ledger--tiles"><ul class="pp-site-ledger__list"><li class="pp-site-ledger__row" data-d="9"><div><b class="pp-site-ledger__name">John Doe · Forklift licence</b><span class="pp-site-ledger__sub">Warehouse · required for the role</span></div><span class="pp-site-status pp-site-status--warning">9 days</span></li><li class="pp-site-ledger__row" data-d="38"><div><b class="pp-site-ledger__name">Employee 2 · First aid level 1</b><span class="pp-site-ledger__sub">Head office</span></div><span class="pp-site-status pp-site-status--success">38 days</span></li><li class="pp-site-ledger__row" data-d="16"><div><b class="pp-site-ledger__name">Employee 3 · Medical certificate</b><span class="pp-site-ledger__sub">Warehouse</span></div><span class="pp-site-status pp-site-status--warning">16 days</span></li><li class="pp-site-ledger__row" data-d="195"><div><b class="pp-site-ledger__name">Employee 4 · Work permit</b><span class="pp-site-ledger__sub">Head office</span></div><span class="pp-site-status pp-site-status--success">195 days</span></li></ul></div><div class="pp-site-hcard__note" aria-live="polite"><span class="pp-site-status pp-site-status--brand">Sample data</span><span data-note>Batsi is watching 4 expiry dates</span></div>
  `,
  host: { class: 'pp-site-hcard', role: 'group', 'aria-label': 'Sample certificate register', 'data-demo': 'hcard-compliance' },
})
export class PpCompCard {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly clock = inject(LearnClock);

  constructor() {
    afterNextRender(() => {
      const card = this.el, clock = this.clock;
      const rows = Array.from(card.querySelectorAll<HTMLElement>('.pp-site-ledger__row'));
      const clr = card.querySelector<HTMLElement>('.pp-site-hcard__head > .pp-site-status')!, day = card.querySelector<HTMLElement>('[data-day]')!;
      const noteBox = card.querySelector<HTMLElement>('.pp-site-hcard__note')!, noteText = noteBox.querySelector<HTMLElement>('[data-note]')!;
      const st = (el: HTMLElement, kind: string, text: string) => { el.className = `pp-site-status pp-site-status--${kind}`; el.textContent = text; };
      const chip = (el: HTMLElement, d: number) => {
        if (d < 0) st(el, 'danger', `${-d}${d === -1 ? ' day overdue' : ' days overdue'}`);
        else if (d <= 30) st(el, 'warning', `${d}${d === 1 ? ' day' : ' days'}`);
        else st(el, 'success', `${d >= 1000 ? `${Math.floor(d / 1000)},${String(d % 1000).padStart(3, '0')}` : d} days`);
      };
      const show = (k: number, renewed: boolean) => {
        rows.forEach((r, i) => {
          let d = DAYS[i]! - k;
          if (i === 0 && renewed) d = 1095;
          chip(r.querySelector<HTMLElement>('.pp-site-status')!, d);
          r.classList.toggle('pp-site-ledger__row--late', d < 0); r.classList.toggle('pp-site-ledger__row--renewed', i === 0 && renewed);
        });
        day.textContent = `Today · ${3 + k} Nov`;
        const late = !renewed && DAYS[0] - k < 0;
        st(clr, late ? 'danger' : 'success', late ? '3 of 4 cleared' : '4 of 4 cleared');
      };
      const note = (text: string, late = false) => { noteText.textContent = text; noteBox.classList.remove('pp-site-hcard__note--good'); noteBox.classList.toggle('pp-site-hcard__note--late', late); };
      const last = () => { show(11, true); note('Renewal accepted. John Doe is cleared to work.'); };
      if (clock.still) { last(); return; }
      const play = () => {
        clock.stop(); show(0, false); note('Batsi is watching 4 expiry dates');
        clock.at(2400, () => { show(6, false); note('Reminder sent at 7 days'); });
        clock.at(4600, () => { show(11, false); note('John Doe’s forklift licence expired 2 days ago. Jane Smith told.', true); });
        clock.at(7600, last);
        clock.at(11800, play);
      };
      clock.onView(card, play, 0.3);
    });
  }
}
