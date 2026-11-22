import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, ViewEncapsulation, afterNextRender, inject, signal } from '@angular/core';
import { PpIcon } from '../../../core/icon';
import { PpSiteBand } from '../../band';
import { PpSiteFooter } from '../../footer';
import { PpSiteHeader } from '../../header';
import { PpSitePage } from '../../page';
import { BAND_LIGHTS, BAND_LIGHTS_PHONE } from '../../sections/closing';
import { PpSiteLandPilot } from '../../sections/pilot';
import { ONBOARDING_DEMOS, ONBOARDING_ENDING, ONBOARDING_TABS, ONBOARDING_TOP } from '../content';
import { PpSiteLearnPage } from '../learn.page';
import { PpSiteLearnDocRead, PpSiteLearnLiveStatus } from '../learn.panels';
import { PpSiteMotion } from '../../motion';
import { PpOnbMotion } from './onboarding.motion';
import { PpOnbCard } from './onboarding.card';
import { PpOnbDemo } from './onboarding.demo';
import { PpOnbContract, PpOnbExit, PpOnbLaptop, PpOnbPhone } from './onboarding.panels';

/**
 * The Onboarding and Offboarding Learn more page, `/product/onboarding` (SITE-10): the pilot bar, the header, the page top with its hero card, the sub-menu, the six
 * demos (the new employee's phone, documents read and matched, follow-ups, contract and probation, laptop and access, offboarding), Ask Batsi, the trust strip,
 * "Works together with", the questions, the closing band and the footer, in the kit's order ("Onboarding page", `ui_kits/site-pages.html`). Every word is data in
 * `content/onboarding.ts`; the panels are the kit's markup (`onboarding.panels.ts` and the shared ones of SITE-08) and what moves in them is the kit's script
 * (`onboarding.engines.ts`). Imports nothing from core/auth, so it prerenders and the route loads no signed-in code. Link targets stay as the landing's until SITE-16.
 */
@Component({
  selector: 'app-onboarding-page',
  imports: [PpIcon, PpSitePage, PpSiteHeader, PpSiteFooter, PpSiteBand, PpSiteLandPilot, PpSiteLearnPage, PpSiteLearnDocRead, PpSiteLearnLiveStatus, PpOnbCard, PpOnbDemo,
    PpOnbPhone, PpOnbContract, PpOnbLaptop, PpOnbExit],
  providers: [{ provide: PpSiteMotion, useClass: PpOnbMotion }],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The kit's page has no body margin. The style is added while the page is on screen and goes with it, so signed-in pages keep theirs.
  encapsulation: ViewEncapsulation.None,
  styles: 'body { margin: 0; }',
  template: `
    <div ppSitePilot></div>
    <div ppSitePage>
      <header ppSiteHeader></header>
      <div ppSiteLearnPage uid="onboarding" [top]="top" [tabs]="tabs" [ending]="ending">
        <div ppSiteLearnCard ppOnbCard></div>
        <section ppOnbDemo id="employee" uid="d1" [text]="demos.phone" engine="phone"><div ppOnbPhone></div></section>
        <section ppOnbDemo id="documents" uid="d2" [text]="demos.read" engine="doc-read" cream flip><div ppSiteLearnDocRead></div></section>
        <section ppOnbDemo id="follow-ups" uid="d3" [text]="demos.follow" engine="live-status"><div ppSiteLearnLiveStatus></div></section>
        <section ppOnbDemo id="contract" uid="d4" [text]="demos.contract" engine="contract" cream flip><div ppOnbContract></div></section>
        <section ppOnbDemo id="laptop" uid="d5" [text]="demos.laptop" engine="checklist"><div ppOnbLaptop></div></section>
        <section ppOnbDemo id="offboarding" uid="d6" [text]="demos.exit" engine="checklist" cream flip><div ppOnbExit></div></section>
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
export class OnboardingPage {
  private readonly doc = inject(DOCUMENT);
  protected readonly top = ONBOARDING_TOP;
  protected readonly tabs = ONBOARDING_TABS;
  protected readonly ending = ONBOARDING_ENDING;
  protected readonly demos = ONBOARDING_DEMOS;
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
