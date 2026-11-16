import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, afterNextRender, inject, signal } from '@angular/core';
import { PpIcon } from '../../core/icon';
import { PpSiteBand } from '../band';
import { PpSiteFooter } from '../footer';
import { PpSiteHeader } from '../header';
import { PpSitePage } from '../page';
import { PpSiteLandAbout } from './about';
import { PpSiteLandBatsi } from './batsi';
import { BAND_LIGHTS, BAND_LIGHTS_PHONE } from './closing';
import { PpSiteLandCompliance } from './compliance';
import { LANDING_LIGHTS, LANDING_LIGHTS_PHONE, PpSiteLandHero } from './hero';
import { PpSiteLandIntegrations } from './integrations';
import { PpSiteLandLeave } from './leave';
import { PpSiteLandModules } from './modules';
import { PpSiteLandOnboarding } from './onboarding';
import { PpSiteLandPilot } from './pilot';
import { PpSiteLandPlatform } from './platform';
import { PpSiteLandRecruitment } from './recruitment';
import { PpSiteLandTrust } from './trust';

/**
 * The whole landing page, assembled from the parts in the approved order: pilot bar, header and sheet, hero with the Ask Batsi peek,
 * Modules, Ask Batsi, Recruitment, Onboarding and Offboarding, Compliance, Leave, Trust and POPIA, Integrations, Platform, About,
 * the closing band and the footer. Nothing here is new: each section is the one on its own kit page. SITE-01's public route renders
 * this; link targets are the kit's until SITE-06. Under 768px the lights use the phone placements.
 * Spec: SITE-04, kit: project/ui_kits/site-landing.md
 */
@Component({
  selector: 'div[ppSiteLanding]',
  imports: [PpSitePage, PpSiteHeader, PpSiteFooter, PpSiteBand, PpIcon, PpSiteLandPilot, PpSiteLandHero, PpSiteLandModules, PpSiteLandBatsi, PpSiteLandRecruitment,
    PpSiteLandOnboarding, PpSiteLandCompliance, PpSiteLandLeave, PpSiteLandTrust, PpSiteLandIntegrations, PpSiteLandPlatform, PpSiteLandAbout],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div ppSitePilot></div>
    <div ppSitePage>
      <header ppSiteHeader></header>
      <div ppSiteLandHero [lights]="phone() ? heroPhone : heroDesktop"></div>
      <section ppSiteLandModules></section>
      <section ppSiteLandBatsi></section>
      <section ppSiteLandRecruitment></section>
      <section ppSiteLandOnboarding></section>
      <section ppSiteLandCompliance></section>
      <section ppSiteLandLeave></section>
      <section ppSiteLandTrust></section>
      <section ppSiteLandIntegrations></section>
      <section ppSiteLandPlatform></section>
      <section ppSiteLandAbout></section>
      <section ppSiteBand id="demo" reveal [lights]="phone() ? bandPhone : bandDesktop" eyebrow="Book a demo" title="Naleko" accent="People."
        lead="Every employee hired, onboarded and compliant. One app for Recruitment, Onboarding and Offboarding, Leave Management and Compliance Management, with Ask Batsi built in."
        note="Get started creates a company account. The Naleko team calls every new company.">
        <a class="pp-site-button pp-site-button--dark pp-site-button--large" href="#demo"><span>Book a demo</span><svg ppIcon="arrow-right" /></a>
        <a class="pp-site-button pp-site-button--line pp-site-button--large" href="#get-started">Get started</a>
      </section>
      <footer ppSiteFooter></footer>
    </div>
  `,
})
export class PpSiteLanding {
  private readonly win = inject(DOCUMENT).defaultView;
  protected readonly heroDesktop = LANDING_LIGHTS;
  protected readonly heroPhone = LANDING_LIGHTS_PHONE;
  protected readonly bandDesktop = BAND_LIGHTS;
  protected readonly bandPhone = BAND_LIGHTS_PHONE;
  protected readonly phone = signal(false);

  constructor() {
    afterNextRender(() => {
      const q = this.win?.matchMedia?.('(max-width: 767px)');
      if (!q) return;
      this.phone.set(q.matches);
      q.addEventListener('change', (e) => this.phone.set(e.matches));
    });
  }
}
