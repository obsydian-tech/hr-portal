import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, ViewEncapsulation, afterNextRender, inject, signal } from '@angular/core';
import { PpIcon } from '../../../core/icon';
import { PpSiteBand } from '../../band';
import { PpSiteFooter } from '../../footer';
import { PpSiteHeader } from '../../header';
import { PpSitePage } from '../../page';
import { BAND_LIGHTS, BAND_LIGHTS_PHONE } from '../../sections/closing';
import { PpSiteLandPilot } from '../../sections/pilot';
import { COMPLIANCE_DEMOS, COMPLIANCE_ENDING, COMPLIANCE_TABS, COMPLIANCE_TOP } from '../content';
import { PpSiteLearnPage } from '../learn.page';
import { PpSiteMotion } from '../../motion';
import { PpCompMotion } from './compliance.motion';
import { PpCompCard } from './compliance.card';
import { PpCompDemo } from './compliance.demo';
import { PpCompClearance, PpCompReminders, PpCompRegister, PpCompRenewal, PpCompRequirements } from './compliance.panels';

/**
 * The Compliance Management Learn more page, `/product/compliance` (SITE-11): the pilot bar, the header, the page top with its hero card, the sub-menu, the five
 * demos (requirements per role, the certificate register, reminders, renewals read, not cleared to work), Ask Batsi, the trust strip, "Works together with", the
 * questions, the closing band and the footer, in the kit's order ("Compliance page", `ui_kits/site-pages.html`). Every word is data in `content/compliance.ts`; the
 * panels are the kit's markup (`compliance.panels.ts`) and what moves in them is the kit's script (`compliance.engines.ts`). Imports nothing from core/auth, so it
 * prerenders and the route loads no signed-in code. Link targets stay as the landing's until SITE-16.
 */
@Component({
  selector: 'app-compliance-page',
  imports: [PpIcon, PpSitePage, PpSiteHeader, PpSiteFooter, PpSiteBand, PpSiteLandPilot, PpSiteLearnPage, PpCompCard, PpCompDemo,
    PpCompRequirements, PpCompRegister, PpCompReminders, PpCompRenewal, PpCompClearance],
  providers: [{ provide: PpSiteMotion, useClass: PpCompMotion }],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The kit's page has no body margin. The style is added while the page is on screen and goes with it, so signed-in pages keep theirs.
  encapsulation: ViewEncapsulation.None,
  styles: 'body { margin: 0; }',
  template: `
    <div ppSitePilot></div>
    <div ppSitePage>
      <header ppSiteHeader></header>
      <div ppSiteLearnPage uid="compliance" [top]="top" [tabs]="tabs" [ending]="ending">
        <div ppSiteLearnCard ppCompCard></div>
        <section ppCompDemo id="requirements" uid="d1" [text]="demos.req" engine="req"><div ppCompRequirements></div></section>
        <section ppCompDemo id="register" uid="d2" [text]="demos.reg" engine="reg" cream flip><div ppCompRegister></div></section>
        <section ppCompDemo id="reminders" uid="d3" [text]="demos.rem" engine="rem"><div ppCompReminders></div></section>
        <section ppCompDemo id="renewals" uid="d4" [text]="demos.read" engine="read" cream flip><div ppCompRenewal></div></section>
        <section ppCompDemo id="not-cleared" uid="d5" [text]="demos.nc" engine="nc"><div ppCompClearance></div></section>
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
export class CompliancePage {
  private readonly doc = inject(DOCUMENT);
  protected readonly top = COMPLIANCE_TOP;
  protected readonly tabs = COMPLIANCE_TABS;
  protected readonly ending = COMPLIANCE_ENDING;
  protected readonly demos = COMPLIANCE_DEMOS;
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
