import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, ViewEncapsulation, afterNextRender, inject, signal } from '@angular/core';
import { PpIcon } from '../../../core/icon';
import { PpSiteBand } from '../../band';
import { PpSiteFooter } from '../../footer';
import { PpSiteHeader } from '../../header';
import { PpSitePage } from '../../page';
import { BAND_LIGHTS, BAND_LIGHTS_PHONE } from '../../sections/closing';
import { PpSiteLandPilot } from '../../sections/pilot';
import { RECRUITMENT_DEMOS, RECRUITMENT_ENDING, RECRUITMENT_TABS, RECRUITMENT_TOP } from '../content';
import { PpSiteLearnPage } from '../learn.page';
import { PpRecruitCard } from './recruitment.card';
import { PpRecruitBoardDemo, PpRecruitDemo } from './recruitment.demo';
import { PpRecruitBoard, PpRecruitRisk, PpRecruitScore } from './recruitment.panels';
import { PpSiteLearnTimeline } from '../learn.panels';

/**
 * The Recruitment Learn more page, `/product/recruitment` (SITE-09): the pilot bar, the header, the page top with its hero card, the sub-menu, the five
 * demos (hiring board, interview panels, reminders and follow-ups, candidate risk, offer to onboarding), Ask Batsi, the trust strip, "Works together with",
 * the questions, the closing band and the footer, in the kit's order ("Recruitment page", `ui_kits/site-pages.html`). Every word is data in
 * `content/recruitment.ts`; the panels are the kit's markup (`recruitment.panels.ts`) and what moves in them is the kit's script (`recruitment.engines.ts`).
 * Imports nothing from core/auth, so it prerenders and the route loads no signed-in code. Link targets stay as the landing's until SITE-16.
 */
@Component({
  selector: 'app-recruitment-page',
  imports: [PpIcon, PpSitePage, PpSiteHeader, PpSiteFooter, PpSiteBand, PpSiteLandPilot, PpSiteLearnPage, PpSiteLearnTimeline, PpRecruitCard, PpRecruitDemo, PpRecruitBoardDemo,
    PpRecruitBoard, PpRecruitScore, PpRecruitRisk],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The kit's page has no body margin. The style is added while the page is on screen and goes with it, so signed-in pages keep theirs.
  encapsulation: ViewEncapsulation.None,
  styles: 'body { margin: 0; }',
  template: `
    <div ppSitePilot></div>
    <div ppSitePage>
      <header ppSiteHeader></header>
      <div ppSiteLearnPage uid="recruitment" [top]="top" [tabs]="tabs" [ending]="ending">
        <div ppSiteLearnCard ppRecruitCard></div>
        <section ppRecruitBoardDemo id="hiring-board" uid="board" [text]="demos.board" engine="board"><div ppRecruitBoard></div></section>
        <section ppRecruitDemo id="panels" uid="score" [text]="demos.score" engine="score" cream flip><div ppRecruitScore></div></section>
        <section ppRecruitDemo id="follow-ups" uid="follow" [text]="demos.follow" engine="timeline"><div ppSiteLearnTimeline></div></section>
        <section ppRecruitDemo id="risk" uid="risk" [text]="demos.risk" engine="risk" cream flip><div ppRecruitRisk></div></section>
        <section ppSiteBand ppSiteLearnBand id="demo" reveal [lights]="phone() ? bandPhone : bandDesktop" eyebrow="Book a demo" title="Naleko" accent="People."
          lead="Every employee hired, onboarded and compliant. One app for Recruitment, Onboarding and Offboarding, Leave Management and Compliance Management, with Ask Batsi built in.">
          <a class="pp-site-button pp-site-button--dark pp-site-button--large" href="#demo"><span>Book a demo</span><svg ppIcon="arrow-right" /></a>
          <a class="pp-site-button pp-site-button--line pp-site-button--large" href="#get-started">Get started</a>
        </section>
      </div>
      <footer ppSiteFooter></footer>
    </div>
  `,
  host: { '(click)': 'stay($event)' },
})
export class RecruitmentPage {
  private readonly doc = inject(DOCUMENT);
  protected readonly top = RECRUITMENT_TOP;
  protected readonly tabs = RECRUITMENT_TABS;
  protected readonly ending = RECRUITMENT_ENDING;
  protected readonly demos = RECRUITMENT_DEMOS;
  protected readonly bandDesktop = BAND_LIGHTS;
  protected readonly bandPhone = BAND_LIGHTS_PHONE;
  protected readonly phone = signal(false);

  constructor() {
    afterNextRender(() => {
      const q = this.doc.defaultView?.matchMedia?.('(max-width: 767px)');
      if (!q) return;
      this.phone.set(q.matches);
      q.addEventListener('change', (e) => this.phone.set(e.matches));
    });
  }

  /**
   * The site's `<base href="/">` would send a link such as `#demo` to the home page. On this page a link to a place on the page scrolls there, and a `#`
   * link (a page that does not exist yet) stays put. Any other link, and a link whose place is not on this page, behaves as it always did.
   */
  protected stay(e: Event): void {
    if (e.defaultPrevented) return;
    const a = (e.target as Element | null)?.closest?.('a[href^="#"]');
    const href = a?.getAttribute('href');
    if (!a || !href) return;
    if (href === '#') { e.preventDefault(); return; }
    const to = this.doc.getElementById(href.slice(1));
    if (!to) return;
    e.preventDefault();
    to.scrollIntoView({ behavior: this.doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }
}
