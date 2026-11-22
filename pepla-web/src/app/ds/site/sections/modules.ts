import { ChangeDetectionStrategy, Component, signal, afterNextRender, ElementRef, inject } from '@angular/core';
import { PpIcon } from '../../core/icon';
import { PpSiteReveal } from '../motion';
import { DemoClock } from '../demo-clock';

const QUESTIONS = ['Who hasn’t sent their documents?', 'Which certificates expire this month?', 'Who is on leave next week?', 'Which candidates are waiting on feedback?'];

/** The landing page Modules section: seven module cards and the Ask Batsi card, which types its sample questions. Spec: SITE-03, kit site-modules. */
@Component({
  selector: 'section[ppSiteLandModules]',
  imports: [PpIcon, PpSiteReveal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DemoClock],
  template: `
<div class="pp-site-wrap"><div class="pp-site-section__head"><div><p class="pp-site-eyebrow" [ppSiteReveal]="0">Modules</p>
<h2 class="pp-site-section__title" id="lmd-h" [ppSiteReveal]="1">One employee record.<br>Every module.</h2>
</div>
<div><span class="pp-site-record" [ppSiteReveal]="2"><span class="pp-avatar pp-avatar--violet pp-avatar--small" aria-hidden="true">JD</span>
<span><span class="pp-site-record__name">John Doe</span> · Employee record</span>
<span class="pp-site-record__live" aria-hidden="true"></span>
</span>
<p class="pp-site-section__lead" [ppSiteReveal]="3">Each module reads and writes the same employee record. Naleko switches modules on for each organisation, and Ask Batsi works across all of them.</p>
</div>
</div>
<div class="pp-site-tiles"><a class="pp-site-tile" href="#" [ppSiteReveal]="0"><span class="pp-site-tile__icon" aria-hidden="true"><span class="pp-site-tile__glyph"><svg ppIcon="users" /></span>
<span class="pp-site-tile__glyph pp-site-tile__glyph--on"><svg ppIcon="users" /></span>
</span>
<h3 class="pp-site-tile__title">Employee Records</h3>
<p class="pp-site-tile__text">One record per employee. ID, bank and salary details hidden, every view logged.</p>
<span class="pp-site-tile__more">Learn more<svg ppIcon="arrow-right" /></span>
</a>
<a class="pp-site-tile" href="#" [ppSiteReveal]="1"><span class="pp-site-tile__icon" aria-hidden="true"><span class="pp-site-tile__glyph"><svg ppIcon="user-plus" /></span>
<span class="pp-site-tile__glyph pp-site-tile__glyph--on"><svg ppIcon="user-plus" /></span>
</span>
<h3 class="pp-site-tile__title">Recruitment</h3>
<p class="pp-site-tile__text">Candidates tracked from application to offer, with interview panels and stage reminders.</p>
<span class="pp-site-tile__more">Learn more<svg ppIcon="arrow-right" /></span>
</a>
<a class="pp-site-tile" href="#" [ppSiteReveal]="2"><span class="pp-site-tile__icon" aria-hidden="true"><span class="pp-site-tile__glyph"><svg ppIcon="rocket" /></span>
<span class="pp-site-tile__glyph pp-site-tile__glyph--on"><svg ppIcon="rocket" /></span>
</span>
<h3 class="pp-site-tile__title">Onboarding and Offboarding</h3>
<p class="pp-site-tile__text">Offer accepted to day one. Documents read and matched, IT set up, every exit recorded.</p>
<span class="pp-site-tile__more">Learn more<svg ppIcon="arrow-right" /></span>
</a>
<a class="pp-site-tile" href="#" [ppSiteReveal]="3"><span class="pp-site-tile__icon" aria-hidden="true"><span class="pp-site-tile__glyph"><svg ppIcon="calendar-days" /></span>
<span class="pp-site-tile__glyph pp-site-tile__glyph--on"><svg ppIcon="calendar-days" /></span>
</span>
<h3 class="pp-site-tile__title">Leave Management</h3>
<p class="pp-site-tile__text">Requests, approvals and balances under BCEA leave rules.</p>
<span class="pp-site-tile__more">Learn more<svg ppIcon="arrow-right" /></span>
</a>
<a class="pp-site-tile" href="#" [ppSiteReveal]="4"><span class="pp-site-tile__icon" aria-hidden="true"><span class="pp-site-tile__glyph"><svg ppIcon="scale" /></span>
<span class="pp-site-tile__glyph pp-site-tile__glyph--on"><svg ppIcon="scale" /></span>
</span>
<h3 class="pp-site-tile__title">Compliance Management</h3>
<p class="pp-site-tile__text">Certificates and licences tracked to their expiry date, with renewals followed up.</p>
<span class="pp-site-tile__more">Learn more<svg ppIcon="arrow-right" /></span>
</a>
<a class="pp-site-tile pp-site-tile--later" href="#" [ppSiteReveal]="5"><span class="pp-site-tile__icon" aria-hidden="true"><span class="pp-site-tile__glyph"><svg ppIcon="life-buoy" /></span>
<span class="pp-site-tile__glyph pp-site-tile__glyph--on"><svg ppIcon="life-buoy" /></span>
</span>
<h3 class="pp-site-tile__title">HR Help Desk</h3>
<p class="pp-site-tile__text">Employee questions in one queue, answered from company policy.</p>
<span class="pp-site-tile__more">Coming soon</span>
</a>
<a class="pp-site-tile pp-site-tile--later" href="#" [ppSiteReveal]="6"><span class="pp-site-tile__icon" aria-hidden="true"><span class="pp-site-tile__glyph"><svg ppIcon="target" /></span>
<span class="pp-site-tile__glyph pp-site-tile__glyph--on"><svg ppIcon="target" /></span>
</span>
<h3 class="pp-site-tile__title">Performance Management</h3>
<p class="pp-site-tile__text">Goals, reviews and probation outcomes on the employee record.</p>
<span class="pp-site-tile__more">Coming soon</span>
</a>
<a class="pp-site-tile pp-site-tile--batsi" href="#batsi" [ppSiteReveal]="7"><span class="pp-site-tile__icon" aria-hidden="true"><span class="pp-site-tile__glyph"><svg ppIcon="sparkles" /></span>
<span class="pp-site-tile__glyph pp-site-tile__glyph--on"><svg ppIcon="sparkles" /></span>
</span>
<h3 class="pp-site-tile__title">Ask Batsi</h3>
<div class="pp-site-tile__ask" aria-live="off">{{ ask() }}</div>
<span class="pp-site-tile__more">See Batsi at work<svg ppIcon="arrow-right" /></span>
</a>
</div>
<ul class="pp-site-notes" [ppSiteReveal]="2"><li class="pp-site-notes__item"><span class="pp-site-notes__dot pp-site-notes__dot--agent"></span>Ask Batsi suggests. HR approves every action.</li>
<li class="pp-site-notes__item"><span class="pp-site-notes__dot"></span>Built for South Africa: BCEA, UIF, SARS, POPIA</li>
</ul>
</div>

  `,
  host: { 'id': 'modules', 'class': 'pp-site-section', 'aria-labelledby': 'lmd-h' },
})
export class PpSiteLandModules {
  private readonly clock = inject(DemoClock);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  /** The Ask Batsi card's question as it is being typed (blank until the section scrolls into view). */
  protected readonly ask = signal('');

  constructor() {
    afterNextRender(() => this.clock.onView(this.el, () => this.type(), 0.35));
  }

  /** Types each question at 48ms a letter, holds it 1.8s, then deletes it at 22ms a letter (the approved page's timings). */
  private type(): void {
    const qs = QUESTIONS;
    let qi = 0, ci = 0, del = false;
    const tick = (): void => {
      const q = qs[qi];
      if (!del) { ci++; this.ask.set(q.slice(0, ci)); if (ci === q.length) { del = true; this.clock.at(1800, tick); return; } }
      else { ci--; this.ask.set(q.slice(0, ci)); if (ci === 0) { del = false; qi = (qi + 1) % qs.length; } }
      this.clock.at(del ? 22 : 48, tick);
    };
    tick();
  }
}
