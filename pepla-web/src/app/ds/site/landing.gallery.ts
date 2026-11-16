import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PpSiteStage } from './frame';
import { PpSiteLandBatsi } from './sections/batsi';
import { LANDING_LIGHTS, LANDING_LIGHTS_PHONE, PpSiteLandHero } from './sections/hero';
import { PpSiteLandModules } from './sections/modules';
import { PpSiteLandOnboarding } from './sections/onboarding';
import { PpSiteLandPilot } from './sections/pilot';
import { PpSiteLandRecruitment } from './sections/recruitment';
import { PpSiteLandAbout } from './sections/about';
import { PpSiteLandCompliance } from './sections/compliance';
import { PpSiteLandLeave } from './sections/leave';

/**
 * /dev/site-landing: each landing section on its own, desktop and phone, as the kit's "Site landing page" shows it, so the tests,
 * the parity check and the side-by-side page can compare it with the kit. Dev only: not linked from anywhere, not prerendered.
 * Each is a `section[data-example]` with an `h2` for its name and a `[data-example-body]` that holds exactly what the kit holds.
 */
@Component({
  selector: 'app-site-landing-gallery',
  imports: [PpSiteStage, PpSiteLandPilot, PpSiteLandHero, PpSiteLandModules, PpSiteLandBatsi, PpSiteLandRecruitment, PpSiteLandOnboarding, PpSiteLandCompliance, PpSiteLandLeave, PpSiteLandAbout],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="pp-stack pp-gap-600" aria-label="Landing sections">
      <h1 class="pp-text-heading-large">Landing sections</h1>
      @for (d of devices; track d.id) {
        <section class="pp-stack pp-gap-200" [id]="'land-pilot-' + d.id" [attr.data-example]="'Pilot bar, ' + d.id" data-part="landing"><h2 class="pp-text-heading-small">Pilot bar, {{ d.id }}</h2>
          <div data-example-body><div ppSiteStage [device]="d.id"><div ppSitePilot></div></div></div></section>
        <section class="pp-stack pp-gap-200" [id]="'land-hero-' + d.id" [attr.data-example]="'Hero and Ask Batsi peek, ' + d.id" data-part="landing"><h2 class="pp-text-heading-small">Hero and Ask Batsi peek, {{ d.id }}</h2>
          <div data-example-body><div ppSiteStage [device]="d.id"><div ppSiteLandHero [lights]="d.lights"></div></div></div></section>
        <section class="pp-stack pp-gap-200" [id]="'land-modules-' + d.id" [attr.data-example]="'Modules, ' + d.id" data-part="landing"><h2 class="pp-text-heading-small">Modules, {{ d.id }}</h2>
          <div data-example-body><div ppSiteStage [device]="d.id"><section ppSiteLandModules></section></div></div></section>
        <section class="pp-stack pp-gap-200" [id]="'land-batsi-' + d.id" [attr.data-example]="'Ask Batsi, ' + d.id" data-part="landing"><h2 class="pp-text-heading-small">Ask Batsi, {{ d.id }}</h2>
          <div data-example-body><div ppSiteStage [device]="d.id"><section ppSiteLandBatsi></section></div></div></section>
        <section class="pp-stack pp-gap-200" [id]="'land-recruitment-' + d.id" [attr.data-example]="'Recruitment, ' + d.id" data-part="landing"><h2 class="pp-text-heading-small">Recruitment, {{ d.id }}</h2>
          <div data-example-body><div ppSiteStage [device]="d.id"><section ppSiteLandRecruitment></section></div></div></section>
        <section class="pp-stack pp-gap-200" [id]="'land-onboarding-' + d.id" [attr.data-example]="'Onboarding and Offboarding, ' + d.id" data-part="landing"><h2 class="pp-text-heading-small">Onboarding and Offboarding, {{ d.id }}</h2>
          <div data-example-body><div ppSiteStage [device]="d.id"><section ppSiteLandOnboarding></section></div></div></section>
        <section class="pp-stack pp-gap-200" [id]="'land-compliance-' + d.id" [attr.data-example]="'Compliance Management, ' + d.id" data-part="landing"><h2 class="pp-text-heading-small">Compliance Management, {{ d.id }}</h2>
          <div data-example-body><div ppSiteStage [device]="d.id"><section ppSiteLandCompliance></section></div></div></section>
        <section class="pp-stack pp-gap-200" [id]="'land-leave-' + d.id" [attr.data-example]="'Leave Management, ' + d.id" data-part="landing"><h2 class="pp-text-heading-small">Leave Management, {{ d.id }}</h2>
          <div data-example-body><div ppSiteStage [device]="d.id"><section ppSiteLandLeave></section></div></div></section>
        <section class="pp-stack pp-gap-200" [id]="'land-about-' + d.id" [attr.data-example]="'About, ' + d.id" data-part="landing"><h2 class="pp-text-heading-small">About, {{ d.id }}</h2>
          <div data-example-body><div ppSiteStage [device]="d.id"><section ppSiteLandAbout></section></div></div></section>
      }
    </main>
  `,
})
export class SiteLandingGalleryPage {
  protected readonly devices = [
    { id: 'desktop' as const, lights: LANDING_LIGHTS },
    { id: 'phone' as const, lights: LANDING_LIGHTS_PHONE },
  ];
}
